/**
 * LocalModelRegistry — persists which local models are genuinely USABLE, i.e. have
 * passed integrity (SHA + GGUF) AND a real inference self-test. setupViewModel reads
 * this so OFFLINE AI readiness reflects real state, and it stays empty until an
 * actual inference succeeds (a download/signature/GGUF alone never registers usable).
 *
 * Storage is an app-controlled JSON (under userData in production, the repo data dir
 * otherwise) and is intentionally NOT committed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LocalRuntime } from '@/core/models/local/LocalGgufProvider';
import { runLocalInference } from '@/core/models/local/LocalGgufProvider';
import { verifyArtifact, type ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

export interface UsableLocalModel {
  id: string;
  artifactPath: string;
  sha256: string;
  registeredAt: number;
  benchmark?: { genTps?: number | null; promptTps?: number | null; totalMs?: number; text?: string };
}

function storePath(): string {
  return process.env.AKANSHA_HOME
    ? join(process.env.AKANSHA_HOME, 'data', 'local-model-providers.json')
    : join(process.cwd(), 'data', 'akansha', 'data', 'local-model-providers.json');
}

export function readUsable(): UsableLocalModel[] {
  try {
    const p = storePath();
    if (!existsSync(p)) return [];
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(j.providers) ? j.providers : Array.isArray(j) ? j : [];
  } catch { return []; }
}

/**
 * Readiness surface consumed by the setup VM. A persisted record is only
 * honoured while its ARTIFACT still exists — a deleted/moved model degrades
 * to NOT-INSTALLED truthfully instead of keeping a stale READY. (Full
 * re-verification remains the provisionAndVerify pipeline's job; this is the
 * cheap existence guard the spec's restart test requires.)
 */
export function getUsableLocalModelIds(): string[] {
  return readUsable().filter((m) => existsSync(m.artifactPath)).map((m) => m.id);
}

/** Records whose artifacts no longer exist — surfaced as degraded, never as READY. */
export function getStaleUsableModelIds(): string[] {
  return readUsable().filter((m) => !existsSync(m.artifactPath)).map((m) => m.id);
}

function writeUsable(list: UsableLocalModel[]): void {
  const p = storePath();
  try { mkdirSync(dirname(p), { recursive: true }); } catch { /* ignore */ }
  writeFileSync(p, JSON.stringify({ updated: Date.now(), providers: list }, null, 2), 'utf8');
}

export function unregister(id: string): void {
  writeUsable(readUsable().filter((m) => m.id !== id));
}

/** Only a passing real inference registers (or re-registers) a model as usable. */
export function registerUsable(entry: ManifestModelEntry, artifactPath: string, benchmark: UsableLocalModel['benchmark']): UsableLocalModel {
  const list = readUsable().filter((m) => m.id !== entry.id);
  const rec: UsableLocalModel = { id: entry.id, artifactPath, sha256: entry.sha256, registeredAt: Date.now(), benchmark };
  list.push(rec);
  writeUsable(list);
  return rec;
}

/**
 * End-to-end provisioning of one model into the registry. It obtains the artifact
 * (already-on-disk or injectable download), verifies integrity against the signed
 * manifest entry, then runs a REAL inference self-test. usable is set ONLY on a
 * genuine non-empty generation. On any integrity/inference failure it un-registers
 * and reports the true failure. Cooperative CANCELLATION: the signal is checked
 * before every stage and handed to the inference subprocess — a cancelled job can
 * NEVER reach registerUsable (race-proof: the final gate re-checks after inference).
 */
export async function provisionAndVerify(opts: {
  entry: ManifestModelEntry;
  artifactPath: string;
  runtime: LocalRuntime;
  prompt: string;
  fetchDownload?: (url: string) => Promise<Uint8Array>;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStage?: (stage: 'integrity' | 'inference') => void;
}): Promise<{ ok: boolean; usable: boolean; stage: string; cancelled?: boolean; reason?: string; benchmark?: UsableLocalModel['benchmark'] }> {
  const { entry, artifactPath, runtime, prompt, signal } = opts;
  const cancelRes = () => ({ ok: false, usable: false, stage: 'cancelled', cancelled: true, reason: 'cancelled' });
  if (signal?.aborted) return cancelRes();

  // 1) obtain bytes (download or already-on-disk)
  let bytes: Uint8Array;
  try {
    if (existsSync(artifactPath)) bytes = new Uint8Array(readFileSync(artifactPath));
    else if (opts.fetchDownload) bytes = await opts.fetchDownload(entry.url);
    else return { ok: false, usable: false, stage: 'download', reason: 'no artifact and no downloader provided' };
  } catch (e: any) { return { ok: false, usable: false, stage: 'download', reason: 'fetch-failed:' + (e?.message || e) }; }
  if (signal?.aborted) return cancelRes();

  // 2) integrity: SHA-256 + GGUF container against the signed manifest entry
  opts.onStage?.('integrity');
  const art = verifyArtifact(entry, bytes);
  if (!art.ok) { unregister(entry.id); return { ok: false, usable: false, stage: 'integrity', reason: art.reasons.join(', ') }; }
  if (signal?.aborted) return cancelRes();

  // 3) REAL inference self-test through the detected runtime (abort kills the process)
  opts.onStage?.('inference');
  const infer = await runLocalInference(runtime, artifactPath, prompt, { maxTokens: opts.maxTokens, timeoutMs: opts.timeoutMs, ...(signal ? { signal } : {}) });
  if (infer.cancelled || signal?.aborted) return cancelRes();
  if (!infer.ok || !infer.text.trim()) { unregister(entry.id); return { ok: false, usable: false, stage: 'inference', reason: infer.reason || 'no output' }; }

  // 4) usable ONLY now; record the measured benchmark (prompt/gen t/s are measured)
  const rec = registerUsable(entry, artifactPath, { genTps: infer.genTps ?? null, promptTps: infer.promptTps ?? null, totalMs: infer.totalMs, text: infer.text.slice(0, 200) });
  return { ok: true, usable: true, stage: 'ready', benchmark: rec.benchmark };
}
