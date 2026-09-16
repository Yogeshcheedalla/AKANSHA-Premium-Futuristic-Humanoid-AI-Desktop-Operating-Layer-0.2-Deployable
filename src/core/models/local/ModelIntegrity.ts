/**
 * Model Integrity — the trust boundary for any LOCAL model file.
 *
 * This is the capability ported (concept, not code) from the separate JS
 * prototype into Akansha's real TypeScript architecture. Nothing here reaches
 * the network or runs a binary; it is pure, deterministic and offline-testable.
 *
 * Three independent guarantees must ALL hold before a model may be used:
 *   1. Ed25519 signed manifest — the operator (not the app) pins an exact
 *      artifact URL + size + SHA-256, and signs it with a private key whose
 *      PUBLIC half Akansha verifies against. We never invent a checksum.
 *   2. SHA-256 of the downloaded bytes equals the signed, expected digest.
 *   3. GGUF structure parses as a loadable container (version 1/2/3 with
 *      plausible tensor/KV counts) — a file whose bytes hash correctly but is
 *      not a real GGUF is still rejected.
 *
 * "VERIFIED bytes" is NOT "USABLE model": a model is only usable after a real
 * inference test (see LocalGgufProvider). This module is the integrity layer
 * that gates everything downstream.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/* ── Signed manifest ─────────────────────────────────────────────────────── */

export interface ManifestModelEntry {
  id: string;
  file: string;            // local filename after install
  url: string;             // trusted https source (Hugging Face / pinned release)
  sha256: string;          // operator-supplied, 64-hex. NEVER fabricated here.
  sizeBytes: number;
  format: 'gguf';
  quant?: string;
  parameters?: string;
  contextLength?: number;
  capabilities?: string[];
  license?: string;
  source?: string;
  minimumRamGB?: number;
  minimumStorageGB?: number;
  requiresGpu?: boolean;
}

export interface SignedManifest {
  version: number;
  issuedAt: number;        // epoch ms
  expiresAt?: number;      // epoch ms; optional freshness bound
  models: ManifestModelEntry[];
}

const HEX64 = /^[a-f0-9]{64}$/i;

/** A manifest entry is only install-eligible if it carries a REAL 64-hex SHA. */
export function isChecksumVerified(entry: Partial<ManifestModelEntry> | undefined | null): boolean {
  return !!entry && typeof entry.sha256 === 'string' && HEX64.test(entry.sha256);
}

/** Deterministic serialization (sorted keys) so sign/verify are stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',') + '}';
}

/** Verify an Ed25519 detached signature (base64) over the canonical manifest. */
export function verifyManifestSignature(manifest: SignedManifest, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey({ key: publicKeyPem, format: 'pem' });
    return cryptoVerify(null, Buffer.from(canonicalJson(manifest), 'utf8'), key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

export interface ManifestValidation {
  ok: boolean;
  reasons: string[];
  models: ManifestModelEntry[];
}

/**
 * Validate a signed manifest against the bundled public key. Returns the model
 * entries ONLY when the signature is valid and every entry has a real checksum;
 * otherwise returns explicit reasons (honest failure, never a silent pass).
 */
export function loadSignedManifest(input: {
  manifest: SignedManifest;
  signatureBase64: string;
  publicKeyPem: string;
  now?: number;
}): ManifestValidation {
  const { manifest, signatureBase64, publicKeyPem, now = Date.now() } = input;
  const reasons: string[] = [];

  if (!manifest || !Array.isArray(manifest.models) || manifest.models.length === 0) {
    reasons.push('manifest-empty');
  }
  if (!verifyManifestSignature(manifest, signatureBase64, publicKeyPem)) {
    reasons.push('bad-signature');
  }
  if (typeof manifest.issuedAt !== 'number' || manifest.issuedAt > now + 60_000) {
    reasons.push('issued-at-future');
  }
  if (typeof manifest.expiresAt === 'number' && now > manifest.expiresAt) {
    reasons.push('expired');
  }
  // Every entry must be a real, checksummed GGUF artifact.
  for (const m of manifest.models || []) {
    if (!isChecksumVerified(m)) reasons.push(`missing-or-bad-checksum:${m.id || '?'}`);
    if (m.format !== 'gguf') reasons.push(`unsupported-format:${m.id || '?'}`);
    if (!/^https:\/\//i.test(m.url || '')) reasons.push(`insecure-url:${m.id || '?'}`);
    if (!Number.isFinite(m.sizeBytes) || m.sizeBytes <= 0) reasons.push(`bad-size:${m.id || '?'}`);
  }

  return { ok: reasons.length === 0, reasons, models: reasons.length === 0 ? manifest.models : [] };
}

/* ── SHA-256 of bytes ────────────────────────────────────────────────────── */

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function checksumMatches(actualHex: string, expectedHex: string): boolean {
  return typeof actualHex === 'string' && typeof expectedHex === 'string' && actualHex.toLowerCase() === expectedHex.toLowerCase();
}

/* ── GGUF container validation ───────────────────────────────────────────── */
/**
 * Robust GGUF CONTAINER-level validation (not a full KV-metadata walk, which
 * varies between GGUF generators and false-negatives on real files). We confirm:
 *   - magic == "GGUF"
 *   - version ∈ {1, 2, 3}          (a "GGUF"+ascii blob fails: version is absurd)
 *   - declared tensor & KV counts are finite, non-negative, and plausible
 *     (u64 for v2/v3, u32 for v1) — random bytes blow these up
 *   - the file is larger than a fixed header
 * The inference runtime (llama.cpp) remains the ultimate authority on loadability.
 */
const GGUF_MAGIC = 'GGUF';
const HEADER_FIXED = 4 + 4 + 8 + 8; // magic + version + n_tensors(u64) + n_kv(u64)
const MAX_KV = 200_000;
const MAX_TENSORS = 200_000_000;

export interface GgufHeader {
  ok: boolean;
  reason?: string;
  version?: number;
  nTensors?: number;
  nKv?: number;
  architecture?: string | null;
}

export function parseGgufHeader(buf: Uint8Array): GgufHeader {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (!buf || buf.length < HEADER_FIXED) return { ok: false, reason: 'too-small' };
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== GGUF_MAGIC) return { ok: false, reason: 'bad-magic' };
  const version = view.getUint32(4, true);
  if (version !== 1 && version !== 2 && version !== 3) return { ok: false, reason: 'unsupported-version:' + version };

  let nTensors: number, nKv: number;
  if (version === 1) {
    nTensors = view.getUint32(8, true);
    nKv = view.getUint32(12, true);
  } else {
    nTensors = Number(view.getBigUint64(8, true));
    nKv = Number(view.getBigUint64(16, true));
  }
  if (!Number.isFinite(nTensors) || nTensors < 0 || nTensors > MAX_TENSORS) return { ok: false, reason: 'bad-tensor-count', version, nTensors, nKv };
  if (!Number.isFinite(nKv) || nKv < 1 || nKv > MAX_KV) return { ok: false, reason: 'bad-kv-count', version, nTensors, nKv };

  // Best-effort architecture sniff (never a hard failure).
  let architecture: string | null = null;
  const text = Buffer.from(buf).toString('latin1', HEADER_FIXED, Math.min(buf.length, HEADER_FIXED + 4096));
  const idx = text.indexOf('general.architecture');
  if (idx >= 0) {
    const m = /[\x20-\x7e]{2,20}/.exec(text.slice(idx + 'general.architecture'.length).replace(/\0+/g, ' '));
    if (m) architecture = m[0].trim().split(' ')[0] || null;
  }
  return { ok: true, version, nTensors, nKv, architecture };
}

/**
 * Full integrity check of an actual downloaded artifact: size + SHA-256 + GGUF
 * container, all measured against a signed manifest entry. Pure over a Buffer so
 * it is exercised offline in tests and in production over a real file read.
 */
export function verifyArtifact(entry: ManifestModelEntry, bytes: Uint8Array): { ok: boolean; reasons: string[]; header?: GgufHeader } {
  const reasons: string[] = [];
  if (bytes.length !== entry.sizeBytes) reasons.push(`size-mismatch:${bytes.length}!=${entry.sizeBytes}`);
  if (!checksumMatches(sha256Hex(bytes), entry.sha256)) reasons.push('checksum-mismatch');
  const header = parseGgufHeader(bytes);
  if (!header.ok) reasons.push('gguf:' + header.reason);
  return { ok: reasons.length === 0, reasons, header };
}
