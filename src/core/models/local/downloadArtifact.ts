/**
 * Artifact download for model provisioning — a thin, honest utility used by the
 * EXISTING provisionAndVerify pipeline (it is not a new system):
 *   • https sources only (the signed catalog's pinned URL);
 *   • streamed to disk, never buffered whole in memory;
 *   • size sanity-checked against the manifest's declared size (±15% ceiling /
 *     ±10% floor) — a truncated or wrong artifact fails integrity anyway;
 *     this just surfaces the reason earlier;
 *   • stall timeout so a dead upstream degrades instead of hanging;
 *   • ABORTABLE: an external AbortSignal stops the stream, kills nothing that
 *     could still write, and the .part file is DELETED — a cancelled download
 *     can never leave a file that masquerades as the artifact;
 *   • writes to a .part file and renames only on complete success.
 * Nothing here verifies anything — SHA-256 + GGUF integrity remain the
 * ModelIntegrity/provisionAndVerify pipeline's exclusive job.
 */
import { createWriteStream } from 'node:fs';
import { mkdirSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DownloadResult { ok: boolean; bytes?: number; cancelled?: boolean; reason?: string }

export async function downloadArtifactToFile(
  url: string,
  destPath: string,
  declaredSizeBytes?: number,
  opts: {
    stallMs?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    onProgress?: (bytesSoFar: number) => void;
  } = {},
): Promise<DownloadResult> {
  if (!/^https:\/\//i.test(url)) return { ok: false, reason: 'only https artifact URLs are allowed' };
  if (opts.signal?.aborted) return { ok: false, cancelled: true };
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { redirect: 'follow', ...(opts.signal ? { signal: opts.signal } : {}) });
  } catch (e: any) {
    if (opts.signal?.aborted) return { ok: false, cancelled: true };
    return { ok: false, reason: 'fetch-failed:' + String(e?.message || e).slice(0, 120) };
  }
  if (!res.ok) return { ok: false, reason: `http-${res.status}` };
  if (!res.body) return { ok: false, reason: 'empty-response-body' };

  const tmp = destPath + '.part';
  try { mkdirSync(dirname(destPath), { recursive: true }); } catch { /* exists */ }
  const out = createWriteStream(tmp);
  const reader = res.body.getReader();
  let bytes = 0;
  const stallMs = opts.stallMs ?? 30000;
  const abortCleanup = (): DownloadResult => {
    try { out.destroy(); } catch { /* closed */ }
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
    return { ok: false, cancelled: true };
  };
  const failCleanup = (reason: string): DownloadResult => {
    try { out.destroy(); } catch { /* closed */ }
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
    return { ok: false, reason };
  };
  try {
    for (;;) {
      if (opts.signal?.aborted) return abortCleanup();
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('stall-timeout')), stallMs).unref?.()),
      ]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      opts.onProgress?.(bytes);
      if (declaredSizeBytes && bytes > declaredSizeBytes * 1.15) return failCleanup(`stream exceeded declared size (${bytes} > ${declaredSizeBytes})`);
      if (!out.write(Buffer.from(chunk.value))) await new Promise<void>((r) => out.once('drain', r));
    }
  } catch (e: any) {
    if (opts.signal?.aborted) return abortCleanup();
    return failCleanup('download-failed:' + String(e?.message || e).slice(0, 120));
  }
  if (opts.signal?.aborted) return abortCleanup();
  await new Promise<void>((r, j) => { out.on('finish', r); out.on('error', j); out.end(); });

  if (declaredSizeBytes) {
    const actual = statSync(tmp).size;
    const lo = declaredSizeBytes * 0.9, hi = declaredSizeBytes * 1.1;
    if (actual < lo || actual > hi) return failCleanup(`size mismatch: ${actual} vs declared ${declaredSizeBytes}`);
  }
  renameSync(tmp, destPath);
  return { ok: true, bytes };
}
