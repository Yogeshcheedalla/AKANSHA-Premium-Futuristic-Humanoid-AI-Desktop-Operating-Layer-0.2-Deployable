import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign as cryptoSign, generateKeyPairSync } from 'node:crypto';

import {
  canonicalJson,
  isChecksumVerified,
  loadSignedManifest,
  parseGgufHeader,
  sha256Hex,
  verifyArtifact,
  verifyManifestSignature,
  type ManifestModelEntry,
  type SignedManifest,
} from '@/core/models/local/ModelIntegrity';

/* ── Ed25519 signed manifest ─────────────────────────────────────────────── */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

function signManifest(m: SignedManifest): string {
  return cryptoSign(null, Buffer.from(canonicalJson(m), 'utf8'), privateKey).toString('base64');
}

const hex64 = 'a'.repeat(64);
const entry: ManifestModelEntry = {
  id: 'qwen-test', file: 'qwen.gguf', url: 'https://huggingface.co/x/qwen.gguf',
  sha256: hex64, sizeBytes: 1234, format: 'gguf', capabilities: ['chat'],
};
const manifest: SignedManifest = { version: 1, issuedAt: Date.now(), models: [entry] };

test('integrity: canonical json is key-order stable', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 1 }));
});

test('integrity: valid signed manifest verifies', () => {
  assert.equal(verifyManifestSignature(manifest, signManifest(manifest), pubPem), true);
});

test('integrity: tampered checksum breaks the signature', () => {
  const sig = signManifest(manifest);
  const tampered: SignedManifest = { ...manifest, models: [{ ...entry, sha256: 'b'.repeat(64) }] };
  assert.equal(verifyManifestSignature(tampered, sig, pubPem), false);
});

test('integrity: wrong public key is rejected', () => {
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) as string;
  assert.equal(verifyManifestSignature(manifest, signManifest(manifest), other), false);
});

test('integrity: loadSignedManifest accepts a good signed manifest', () => {
  const r = loadSignedManifest({ manifest, signatureBase64: signManifest(manifest), publicKeyPem: pubPem });
  assert.equal(r.ok, true);
  assert.equal(r.models.length, 1);
});

test('integrity: loadSignedManifest rejects an entry with no real checksum', () => {
  const bad: SignedManifest = { ...manifest, models: [{ ...entry, sha256: '' }] };
  const r = loadSignedManifest({ manifest: bad, signatureBase64: signManifest(bad), publicKeyPem: pubPem });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith('missing-or-bad-checksum')));
});

test('integrity: loadSignedManifest rejects an insecure download url', () => {
  const bad: SignedManifest = { ...manifest, models: [{ ...entry, url: 'http://x/qwen.gguf' }] };
  const r = loadSignedManifest({ manifest: bad, signatureBase64: signManifest(bad), publicKeyPem: pubPem });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith('insecure-url')));
});

test('integrity: expired manifest rejected; isChecksumVerified strict', () => {
  const past: SignedManifest = { ...manifest, issuedAt: 1_000, expiresAt: 2_000 };
  const r = loadSignedManifest({ manifest: past, signatureBase64: signManifest(past), publicKeyPem: pubPem, now: 9_999_999 });
  assert.ok(r.reasons.includes('expired'));
  assert.equal(isChecksumVerified({ sha256: hex64 }), true);
  assert.equal(isChecksumVerified({ sha256: 'nope' }), false);
});

/* ── GGUF container validation ───────────────────────────────────────────── */
function ggufHeader({ version = 3, nTensors = 7, nKv = 1, arch = 'qwen2' } = {}): Buffer {
  // "general.architecture" KV so the container's loose architecture sniff resolves.
  const valLen = Buffer.alloc(version === 1 ? 4 : 8);
  if (version === 1) valLen.writeUInt32LE(arch.length, 0); else valLen.writeBigUInt64LE(BigInt(arch.length), 0);
  const tail = Buffer.concat([Buffer.from('general.architecture', 'utf8'), Buffer.from([0x08]), valLen, Buffer.from(arch, 'utf8'), Buffer.from('\0\0\0\0')]);
  if (version === 1) {
    const head = Buffer.alloc(16);
    head.write('GGUF', 0, 'latin1');
    head.writeUInt32LE(version, 4);
    head.writeUInt32LE(nTensors, 8);
    head.writeUInt32LE(nKv, 12);
    return Buffer.concat([head, tail]);
  }
  const head = Buffer.alloc(24);
  head.write('GGUF', 0, 'latin1');
  head.writeUInt32LE(version, 4);
  head.writeBigUInt64LE(BigInt(nTensors), 8);
  head.writeBigUInt64LE(BigInt(nKv), 16);
  return Buffer.concat([head, tail]);
}

test('gguf: valid v3 header accepted with architecture', () => {
  const r = parseGgufHeader(ggufHeader());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.version, 3);
  assert.equal(r.nTensors, 7);
  assert.equal(r.nKv, 1);
  assert.equal(r.architecture, 'qwen2');
});

test('gguf: v1 (u32 counts) accepted', () => {
  const r = parseGgufHeader(ggufHeader({ version: 1 }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.nTensors, 7);
  assert.equal(r.nKv, 1);
});

test('gguf: bad magic rejected', () => {
  assert.equal(parseGgufHeader(Buffer.from('NOPE' + 'x'.repeat(40))).ok, false);
});

test('gguf: absurd version rejected (the "GGUF"+ascii blob)', () => {
  assert.equal(parseGgufHeader(Buffer.concat([Buffer.from('GGUF', 'latin1'), Buffer.from('junk-not-metadata'.repeat(200))])).ok, false);
});

test('gguf: implausible kv count rejected', () => {
  assert.equal(parseGgufHeader(ggufHeader({ nKv: 9_999_999 })).ok, false);
});

test('gguf: too-small buffer rejected', () => {
  assert.equal(parseGgufHeader(Buffer.from('GGUF')).ok, false);
});

/* ── verifyArtifact: size + sha + gguf together ──────────────────────────── */
function manifestEntryFor(bytes: Buffer): ManifestModelEntry {
  return { ...entry, sha256: sha256Hex(bytes), sizeBytes: bytes.length };
}

test('verifyArtifact: passes only when size + sha + gguf all agree', () => {
  const bytes = ggufHeader({ arch: 'qwen2' });
  const r = verifyArtifact(manifestEntryFor(bytes), bytes);
  assert.equal(r.ok, true);
  assert.equal(r.header?.architecture, 'qwen2');
});

test('verifyArtifact: tampered bytes fail (sha no longer matches pinned)', () => {
  const bytes = ggufHeader();
  const e = manifestEntryFor(bytes);
  const evil = Buffer.from(bytes);
  evil[evil.length - 1] ^= 0xff; // flip a bit; sha changes
  const r = verifyArtifact(e, evil);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('checksum-mismatch'));
});
