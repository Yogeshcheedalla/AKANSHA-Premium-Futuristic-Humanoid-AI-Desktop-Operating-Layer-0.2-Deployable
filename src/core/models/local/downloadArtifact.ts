/**
 * Artifact download for model provisioning — a thin, honest utility used by the
 * EXISTING provisionAndVerify pipeline (it is not a new system):
 *   • https sources only (the signed catalog's pinned URL);
 *   • streamed to disk, never buffered whole in memory;
 *   • size sanity-checked against the manifest's declared size (±10% tolerance
 *     for transport framing) — a truncated or wrong artifact fails integrity
 *     anyway; this just surfaces the reason earlier;
 *   • stall timeout so a dead upstream degrades instead of hanging;
 *   • writes to a .part file and renames only on complete success, so a partial
 *     download can never masquerade as the artifact.
 * Nothing here verifies anything — SHA-256 + GGUF integrity remain the
 * ModelIntegrity/provisionAndVerify pipeline's exclusive job.
 */
import { createWriteStream } from 'node:fs';
import { mkdirSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DownloadResult { ok: boolean; bytes?: number; reason?: string }

export async function downloadArtifactToFile(url: string, destPath: string, declaredSizeBytes?: number, opts: { stallMs?: number; fetchImpl?: typeof fetch } = {}): Promise<DownloadResult> {
  if (!/^https:\/\//i.test(url)) return { ok: false, reason: 'only https artifact URLs are allowed' };
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { redirect: 'follow' });
  } catch (e: any) { return { ok: false, reason: 'fetch-failed:' + String(e?.message || e).slice(0, 120) }; }
  if (!res.ok) return { ok: false, reason: `http-${res.status}` };
  if (!res.body) return { ok: false, reason: 'empty-response-body' };

  const tmp = destPath + '.part';
  try { mkdirSync(dirname(destPath), { recursive: true }); } catch { /* exists */ }
  const out = createWriteStream(tmp);
  const reader = res.body.getReader();
  let bytes = 0;
  const stallMs = opts.stallMs ?? 30000;
  try {
    for (;;) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('stall-timeout')), stallMs).unref?.()),
      ]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (declaredSizeBytes && bytes > declaredSizeBytes * 1.15) { out.destroy(); return { ok: false, reason: `stream exceeded declared size (${bytes} > ${declaredSizeBytes})` }; }
      if (!out.write(Buffer.from(chunk.value))) await new Promise<void>((r) => out.once('drain', r));
    }
  } catch (e: any) {
    out.destroy();
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
    return { ok: false, reason: 'download-failed:' + String(e?.message || e).slice(0, 120) };
  }
  await new Promise<void>((r, j) => { out.on('finish', r); out.on('error', j); out.end(); });

  if (declaredSizeBytes) {
    const actual = statSync(tmp).size;
    const lo = declaredSizeBytes * 0.9, hi = declaredSizeBytes * 1.1;
    if (actual < lo || actual > hi) { try { unlinkSync(tmp); } catch { /* ignore */ } return { ok: false, reason: `size mismatch: ${actual} vs declared ${declaredSizeBytes}` }; }
  }
  renameSync(tmp, destPath);
  return { ok: true, bytes };
}
