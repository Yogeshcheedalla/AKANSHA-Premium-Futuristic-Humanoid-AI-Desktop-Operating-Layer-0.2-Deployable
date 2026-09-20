/**
 * Whisper binary/model provisioning — the SAFE acquisition contract.
 *
 * The rule: never silently download arbitrary binaries. A download is permitted
 * ONLY against a pinned official artifact + a pinned SHA-256; a checksum mismatch
 * is rejected, and a successful download NEVER sets READY — READY requires a real
 * transcription test (see whisperRuntime.proveLocalAsr). If no pinned official
 * artifact is configured, provisioning refuses and the status stays UNAVAILABLE.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ArtifactSpec {
  url: string;        // official release artifact URL (pinned)
  sha256: string;     // pinned expected SHA-256 (lowercase hex)
  version: string;    // exact version
  arch: string;       // e.g. 'x64'
  destDir: string;    // runtime structure location
  kind: 'runtime' | 'model';
}

export interface ProvisionResult {
  ok: boolean;
  path?: string;
  reason?: string;
  state: 'SKIPPED' | 'DOWNLOADING' | 'INTEGRITY_OK' | 'INTEGRITY_FAIL' | 'ERROR';
}

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/**
 * Provision one artifact: download → verify SHA-256 → keep only on match.
 * Returns INTEGRITY_OK (still NOT READY — a transcription test must follow).
 */
export async function provisionArtifact(spec: ArtifactSpec): Promise<ProvisionResult> {
  if (!spec.url || !/^[a-f0-9]{64}$/i.test(spec.sha256)) {
    return { ok: false, state: 'SKIPPED', reason: 'no pinned official artifact + SHA-256 configured — refusing to download an arbitrary binary' };
  }
  const file = join(spec.destDir, spec.url.split('/').pop() || `${spec.kind}.bin`);
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) {
      const res = await fetch(spec.url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
      if (!res.ok || !res.body) return { ok: false, state: 'ERROR', reason: `download failed HTTP ${res.status}` };
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(file);
        const nodeStream = (res as any).body;
        const reader = nodeStream.getReader();
        const pump = async () => {
          while (true) { const { done, value } = await reader.read(); if (done) break; if (!ws.write(value)) await new Promise<void>((r) => ws.once('drain', () => r())); }
          ws.end(); ws.on('finish', resolve); ws.on('error', reject);
        };
        pump().catch(reject);
      });
    }
    const actual = sha256File(file);
    if (actual.toLowerCase() !== spec.sha256.toLowerCase()) {
      return { ok: false, state: 'INTEGRITY_FAIL', reason: `SHA-256 mismatch (expected ${spec.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)` };
    }
    // Integrity passed — but this is NOT READY. A real transcription test must follow.
    return { ok: true, path: file, state: 'INTEGRITY_OK' };
  } catch (e: any) {
    return { ok: false, state: 'ERROR', reason: e?.message || 'provisioning failed' };
  }
}
