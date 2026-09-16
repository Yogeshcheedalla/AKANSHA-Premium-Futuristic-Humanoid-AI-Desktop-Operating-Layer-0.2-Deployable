/**
 * DEV-ONLY fixture catalog.
 *
 * Lets the first-run Model Center and the install/verify state machine be exercised
 * end-to-end WITHOUT downloading a real multi-GB model. This is a test/dev fixture —
 * it is signed by an EPHEMERAL key generated at call time, marked
 * `environment:'development'` + `fixture:true`, and is REJECTED in production by
 * catalogProvider (which only enables it when an explicit dev flag is set).
 *
 * Security is NOT weakened: the fixture entries carry a REAL SHA-256 of their real
 * (tiny) GGUF bytes and a valid signature, so integrity/GGUF/signature verification
 * genuinely pass — which is exactly what lets the UI reach INSTALLING/VERIFYING.
 * But `usable` is still gated on a REAL inference self-test (LocalGgufProvider /
 * ModelManager.recordInference). Because a fixture is never fed through a real
 * inference run, it honestly stays NOT-USABLE / OFFLINE NOT READY. A fixture can
 * never make an unverified artifact executable.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { canonicalJson, sha256Hex } from '@/core/models/local/ModelIntegrity';
import type { CatalogModel, ModelCatalog, SignedCatalog } from '@/core/catalog/ModelCatalog';

/** A minimal but structurally valid GGUF v3 header (magic+version+counts+arch KV). */
export function fixtureGgufBytes(arch = 'qwen2', nTensors = 7, nKv = 1): Uint8Array {
  const h = Buffer.alloc(24);
  h.write('GGUF', 0, 'latin1');
  h.writeUInt32LE(3, 4);
  h.writeBigUInt64LE(BigInt(nTensors), 8);
  h.writeBigUInt64LE(BigInt(nKv), 16);
  const valLen = Buffer.alloc(8); valLen.writeBigUInt64LE(BigInt(arch.length), 0);
  return new Uint8Array(Buffer.concat([h, Buffer.from('general.architecture', 'utf8'), Buffer.from([8]), valLen, Buffer.from(arch, 'utf8'), Buffer.from([0, 0, 0, 0])]));
}

function signEntry(archive: Buffer, priv: ReturnType<typeof generateKeyPairSync>['privateKey']): string {
  return cryptoSign(null, archive, priv).toString('base64');
}

export interface FixtureCatalog {
  signed: SignedCatalog;
  publicKeyPem: string;
  /** Real bytes for each fixture id — lets tests run integrity→(no)inference. */
  artifactBytes: Record<string, Uint8Array>;
}

/**
 * Build a fresh, self-consistent signed fixture catalog. `now` injectable.
 * Three cards deliberately cover the UI states: compatible / insufficient / unsupported.
 */
export function buildFixtureCatalog(now = Date.now()): FixtureCatalog {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

  const defs: Array<{ id: string; family: CatalogModel['family']; parameters: string; ram: number; recRam: number; storage: number; platforms: string[]; accel: string[] }> = [
    { id: 'fixture-qwen-1.5b', family: 'qwen', parameters: '1.5B', ram: 4, recRam: 6, storage: 2, platforms: ['win32', 'darwin', 'linux'], accel: ['cpu'] },
    { id: 'fixture-llama-70b', family: 'llama', parameters: '70B', ram: 64, recRam: 96, storage: 80, platforms: ['win32', 'darwin', 'linux'], accel: ['cpu', 'cuda'] },
    { id: 'fixture-plan9-model', family: 'other', parameters: '3B', ram: 8, recRam: 8, storage: 4, platforms: ['plan9'], accel: ['cpu'] },
  ];

  const artifactBytes: Record<string, Uint8Array> = {};
  const models: CatalogModel[] = defs.map((d) => {
    const bytes = fixtureGgufBytes(d.id.includes('llama') ? 'llama' : 'qwen2');
    artifactBytes[d.id] = bytes;
    const sha = sha256Hex(Buffer.from(bytes));
    // per-entry detached signature over the canonical entry (minus the sig field)
    const entryCore: Omit<CatalogModel, 'signature'> = {
      id: d.id, family: d.family, version: '1', parameters: d.parameters, quantization: 'Q4_K_M',
      format: 'gguf', downloadSizeBytes: bytes.length, installedSizeBytes: bytes.length,
      minimumRamGB: d.ram, recommendedRamGB: d.recRam, minimumStorageGB: d.storage,
      accelerationSupport: d.accel, platforms: d.platforms, architecture: ['x64', 'arm64'],
      runtimeRequirement: 'llama.cpp', contextLength: 4096, capabilities: ['chat'],
      quality: { chat: 'Good', reasoning: 'Medium', coding: 'Medium' }, internetRequired: false,
      benchmark: { source: 'estimated', generationTokensPerSec: 42 }, license: 'apache-2.0',
      sourceUrl: `https://fixture.invalid.akansha.local/${d.id}.gguf`, sha256: sha,
    };
    const signature = signEntry(Buffer.from(canonicalJson(entryCore), 'utf8'), privateKey);
    return { ...entryCore, signature } as CatalogModel;
  });

  const catalog: ModelCatalog = {
    schema: 'akansha/model-catalog/1', version: 1, issuedAt: now,
    environment: 'development', fixture: true, models,
  };
  const signatureBase64 = cryptoSign(null, Buffer.from(canonicalJson(catalog), 'utf8'), privateKey).toString('base64');
  return { signed: { catalog, signatureBase64 }, publicKeyPem, artifactBytes };
}
