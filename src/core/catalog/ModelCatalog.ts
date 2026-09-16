/**
 * Model Catalog — a FIRST-CLASS, signed, extensible description of available
 * models, kept SEPARATE from any UI. The UI consumes this; it must never
 * hard-code a model list. Reuses the exact integrity primitives from
 * ModelIntegrity (canonical JSON + Ed25519), so a catalog is trusted the same
 * way a signed manifest is — no unsigned entry can be installed.
 *
 * This is the "ModelCatalogService" data contract from the production design:
 * every field the Model Center needs to render an honest card, plus the
 * integrity fields (sha256 + signature).
 */
import { canonicalJson, verifyManifestSignature, type ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

export type ModelFormat = 'gguf' | 'safetensors' | 'mlmodelc' | 'onnx';
export type ModelFamily = 'qwen' | 'llama' | 'mistral' | 'gemma' | 'phi' | 'other';
export type BenchmarkSource = 'measured' | 'estimated';

/** Performance + quality metadata. source MUST be 'measured' only if a real
 *  benchmark ran; otherwise 'estimated' and the UI labels it Estimated. */
export interface BenchmarkMetadata {
  source: BenchmarkSource;
  promptTokensPerSec?: number;
  generationTokensPerSec?: number;
  memoryGB?: number;
  firstTokenLatencyMs?: number;
  measuredOn?: { deviceId?: string; at?: number; runtimeVersion?: string };
}

export interface CatalogModel {
  id: string;
  family: ModelFamily;
  version: string;                 // e.g. "2.5"
  parameters: string;              // e.g. "1.5B"
  quantization?: string;           // e.g. "Q4_K_M"
  format: ModelFormat;
  downloadSizeBytes: number;
  installedSizeBytes: number;
  minimumRamGB: number;
  recommendedRamGB: number;
  minimumStorageGB: number;
  gpuRequirements?: { required: boolean; minVramGB?: number };
  accelerationSupport: string[];   // e.g. ['cpu','cuda','metal','vulkan']
  platforms: string[];             // ['win32','darwin','linux','android']
  architecture?: string[];         // ['x64','arm64']
  runtimeRequirement: string;      // which runtime this needs, e.g. 'llama.cpp'
  contextLength: number;
  capabilities: string[];          // chat/reasoning/coding/embeddings/vision...
  quality: { chat: string; reasoning: string; coding: string }; // 'Good'|'Medium'...
  bestFor?: string;
  drawbacks?: string;
  internetRequired: boolean;
  benchmark: BenchmarkMetadata;
  license: string;
  sourceUrl: string;               // https artifact source
  sha256: string;                  // 64-hex, operator-pinned (never invented)
  signature: string;               // base64 Ed25519 over the canonical entry
}

export interface ModelCatalog {
  schema: 'akansha/model-catalog/1';
  version: number;
  issuedAt: number;
  expiresAt?: number;
  models: CatalogModel[];
}

/** The signed envelope: the catalog body + a detached Ed25519 signature over canonical(catalog). */
export interface SignedCatalog {
  catalog: ModelCatalog;
  signatureBase64: string;
}

/** A catalog entry that is eligible for the integrity/provisioning layer. */
export function toManifestEntry(m: CatalogModel): ManifestModelEntry {
  return {
    id: m.id,
    file: `${m.id}.${m.format}`,
    url: m.sourceUrl,
    sha256: m.sha256,
    sizeBytes: m.downloadSizeBytes,
    format: m.format === 'gguf' ? 'gguf' : 'gguf', // only GGUF is provisionable today
    quant: m.quantization,
    parameters: m.parameters,
    contextLength: m.contextLength,
    capabilities: m.capabilities,
    license: m.license,
    source: m.sourceUrl,
    minimumRamGB: m.minimumRamGB,
    minimumStorageGB: m.minimumStorageGB,
    requiresGpu: m.gpuRequirements?.required ?? false,
  };
}

/**
 * Validate a signed catalog against a public key. An entry is only kept if it
 * has a real https source + 64-hex checksum + a syntactically valid signature
 * field; the WHOLE catalog is rejected if the aggregate signature is bad, so a
 * tampered model list is never trusted.
 */
export function validateSignedCatalog(signed: SignedCatalog, publicKeyPem: string, now = Date.now()): { ok: boolean; reasons: string[]; models: CatalogModel[] } {
  const reasons: string[] = [];
  const c = signed.catalog;
  if (!c || c.schema !== 'akansha/model-catalog/1') reasons.push('bad-schema');
  if (!Array.isArray(c?.models) || c.models.length === 0) reasons.push('empty-catalog');
  if (!verifyManifestSignature(c as unknown as never, signed.signatureBase64, publicKeyPem)) reasons.push('bad-signature');
  if (typeof c?.issuedAt === 'number' && c.issuedAt > now + 60_000) reasons.push('issued-at-future');
  if (typeof c?.expiresAt === 'number' && now > c.expiresAt) reasons.push('expired');
  for (const m of c?.models || []) {
    if (!/^https:\/\//i.test(m.sourceUrl || '')) reasons.push(`insecure-url:${m.id}`);
    if (!/^[a-f0-9]{64}$/i.test(m.sha256 || '')) reasons.push(`bad-checksum:${m.id}`);
    if (!m.signature) reasons.push(`missing-entry-signature:${m.id}`);
  }
  return { ok: reasons.length === 0, reasons, models: reasons.length === 0 ? c.models : [] };
}

/** Deterministic identity for a catalog entry (for diffing/updates). */
export function canonicalEntry(m: CatalogModel): string {
  return canonicalJson(m);
}
