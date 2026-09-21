/**
 * Local Whisper ASR — REAL offline speech-to-text through a whisper.cpp runtime,
 * behind the existing provider/voice abstraction (NOT a second voice pipeline).
 *
 * Truth contract (mirrors local llama.cpp):
 *   DISCOVERED → (DOWNLOADING → INTEGRITY_CHECK) → RUNTIME_TEST → MODEL_TEST → READY
 * READY is reached ONLY after a real transcription of a known utterance produces
 * the expected text. A binary merely existing is NEVER enough, and an unverified
 * download is rejected. When no trusted official artifact is available the status
 * is honestly UNAVAILABLE — never a fake READY.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LocalAsrState =
  | 'UNAVAILABLE'      // no trusted runtime/model obtainable
  | 'DISCOVERED'       // runtime + model found, not yet proven
  | 'RUNTIME_TESTING'
  | 'READY'            // a REAL transcription succeeded
  | 'ERROR';

export interface WhisperRuntime {
  binaryPath: string;   // whisper-cli(.exe)
  modelPath: string;    // ggml-*.bin
  version: string;
  arch: string;
  source: 'packaged' | 'akanasha-home' | 'configured' | 'dev';
}

export interface LocalAsrStatus {
  state: LocalAsrState;
  runtime?: WhisperRuntime;
  latencyMs?: number;
  reason?: string;
  checkedAt: number;
}

/** Deterministic discovery across the approved locations. Never downloads. */
export function discoverWhisper(env: NodeJS.ProcessEnv = process.env): WhisperRuntime | null {
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const roots: { dir: string; source: WhisperRuntime['source'] }[] = [];
  if (env.WHISPER_CPP_PATH) roots.push({ dir: env.WHISPER_CPP_PATH, source: 'configured' });
  if (env.AKANSHA_PACKAGED_RUNTIME) roots.push({ dir: join(env.AKANSHA_PACKAGED_RUNTIME, '..', 'whisper'), source: 'packaged' });
  if (env.AKANSHA_HOME) roots.push({ dir: join(env.AKANSHA_HOME, 'runtimes', 'whisper'), source: 'akanasha-home' });
  roots.push({ dir: join(process.cwd(), 'runtime', 'whisper'), source: 'dev' });

  for (const { dir, source } of roots) {
    const bin = join(dir, exe);
    if (!existsSync(bin)) continue;
    // Model: prefer an explicit env, else a ggml-*.bin beside the binary.
    let model = env.WHISPER_MODEL || '';
    if (!model || !existsSync(model)) {
      try {
        const { readdirSync } = require('node:fs') as typeof import('node:fs');
        const cand = readdirSync(dir).find((f) => /^ggml-.*\.bin$/i.test(f));
        model = cand ? join(dir, cand) : '';
      } catch { model = ''; }
    }
    if (!model || !existsSync(model)) continue;
    return { binaryPath: bin, modelPath: model, version: 'discovered', arch: process.arch, source };
  }
  return null;
}

/** Run a REAL transcription with whisper.cpp. Returns the transcript text. */
export async function transcribeWithWhisper(rt: WhisperRuntime, wavPath: string, lang = 'en'): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const { stdout } = await execFileAsync(
    rt.binaryPath,
    ['-m', rt.modelPath, '-f', wavPath, '-l', lang, '-np', '-nt'],
    { timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  );
  const text = String(stdout || '').replace(/\s+/g, ' ').trim();
  return { text, latencyMs: Date.now() - t0 };
}

/**
 * Prove the runtime with a real transcription of a KNOWN utterance. Only a
 * non-empty transcript that contains the expected keyword yields READY.
 */
export async function proveLocalAsr(rt: WhisperRuntime, knownWav: string, expectedWord: string): Promise<LocalAsrStatus> {
  try {
    const { text, latencyMs } = await transcribeWithWhisper(rt, knownWav);
    const ok = text.length > 0 && text.toLowerCase().includes(expectedWord.toLowerCase());
    return ok
      ? { state: 'READY', runtime: rt, latencyMs, reason: `transcribed "${text}"`, checkedAt: Date.now() }
      : { state: 'ERROR', runtime: rt, latencyMs, reason: text ? `unexpected transcript "${text}"` : 'empty transcript', checkedAt: Date.now() };
  } catch (e: any) {
    return { state: 'ERROR', runtime: rt, reason: e?.message || 'transcription failed', checkedAt: Date.now() };
  }
}

let cached: LocalAsrStatus | null = null;
/** Current honest status: discover + (if a known test wav exists) prove. */
export async function localAsrStatus(env: NodeJS.ProcessEnv = process.env, knownWav?: string): Promise<LocalAsrStatus> {
  if (cached && Date.now() - cached.checkedAt < 5 * 60_000) return cached;
  const rt = discoverWhisper(env);
  if (!rt) { cached = { state: 'UNAVAILABLE', reason: 'no trusted whisper.cpp runtime + ggml model found in approved locations', checkedAt: Date.now() }; return cached; }
  if (knownWav && existsSync(knownWav)) {
    cached = await proveLocalAsr(rt, knownWav, 'akansha');
    return cached;
  }
  cached = { state: 'DISCOVERED', runtime: rt, reason: 'runtime + model present; real transcription test not yet run', checkedAt: Date.now() };
  return cached;
}

export function __resetLocalAsrCache() { cached = null; }
