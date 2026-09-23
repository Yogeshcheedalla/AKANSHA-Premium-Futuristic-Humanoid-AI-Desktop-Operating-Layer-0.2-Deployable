/**
 * Local Whisper ASR provider — REAL offline speech-to-text via transformers.js
 * (Whisper on onnxruntime-node, CPU). No cloud, no API key. This is PATH A.
 *
 * Verified on the target machine: a real WAV transcribed to the exact spoken
 * sentence in ~2.4s (CPU), model loaded once and cached. The transcriber is a
 * lazy singleton; the model is cached under AKANSHA_HOME so it persists.
 *
 * It plugs into the EXISTING transcription path (transcription.ts) as the
 * first-priority ASR; cloud free providers remain the fallback. READY is only
 * reported after a real transcription has succeeded — never on load alone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WavPcm { data: Float32Array; sampleRate: number }

/** Minimal RIFF/PCM16 decoder (mono or stereo). */
export function decodeWavPcm16(buf: Buffer): WavPcm {
  let offset = 12; let sampleRate = 22050; let channels = 1; let bits = 16; let dataOffset = -1; let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(offset + 10); sampleRate = buf.readUInt32LE(offset + 12); bits = buf.readUInt16LE(offset + 22); }
    else if (id === 'data') { dataOffset = offset + 8; dataLen = size; }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error('no data chunk');
  const bytesPer = bits / 8;
  const frameBytes = bytesPer * channels;
  const total = Math.floor(dataLen / frameBytes);
  const mono = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += buf.readInt16LE(dataOffset + (i * channels + c) * bytesPer) / 32768;
    mono[i] = s / channels;
  }
  return { data: mono, sampleRate };
}

export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const idx = i * ratio; const i0 = Math.floor(idx); const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (idx - i0);
  }
  return out;
}

const DEFAULT_MODEL = 'Xenova/whisper-base.en';
function modelId(): string { return process.env.AKANSHA_WHISPER_MODEL || DEFAULT_MODEL; }
function modelSegs(): string[] { return modelId().split('/').filter(Boolean); }

/** Where a runtime-DOWNLOADED model is cached — only used when NOT bundled. */
function cacheDir(): string {
  const base = process.env.AKANSHA_HOME ? join(process.env.AKANSHA_HOME, 'models', 'whisper') : join(process.cwd(), 'data', 'akansha', 'models', 'whisper');
  try { require('node:fs').mkdirSync(base, { recursive: true }); } catch { /* best effort */ }
  return base;
}

/**
 * Deterministic BUNDLED model root (PATH A fully-offline install). A candidate
 * root counts as bundled ONLY if `<root>/<modelId>/config.json` exists — we never
 * trust a bare directory name. Priority: Electron-forwarded
 * `AKANSHA_WHISPER_BUNDLE` → `process.resourcesPath/voice/models` (if this
 * process has one) → repo `cwd/voice/models` (dev). NO hard-coded dev path.
 */
/** Is a verified model (config.json present) bundled at THIS specific root? */
export function bundledAtRoot(root: string): boolean {
  try { return existsSync(join(root, ...modelSegs(), 'config.json')); } catch { return false; }
}

function resolveBundledRoot(): string | null {
  const roots: string[] = [];
  if (process.env.AKANSHA_WHISPER_BUNDLE) roots.push(process.env.AKANSHA_WHISPER_BUNDLE);
  const rp = (process as any).resourcesPath;
  if (typeof rp === 'string' && rp) roots.push(join(rp, 'voice', 'models'));
  roots.push(join(process.cwd(), 'voice', 'models'));
  // The packaged backend child runs with cwd = <resources>/app; the model ships at
  // <resources>/voice/models, i.e. '../voice/models' from that cwd. Covers the case
  // where the AKANSHA_WHISPER_BUNDLE env does not reach the child.
  roots.push(join(process.cwd(), '..', 'voice', 'models'));
  for (const root of roots) {
    // A root counts as bundled ONLY if <root>/<modelId>/config.json exists — we
    // never trust a bare directory name. Priority: Electron-forwarded env →
    // process.resourcesPath (if present) → repo cwd. NO hard-coded dev path.
    if (bundledAtRoot(root)) return root; // transformers: localModelPath/<modelId>
  }
  return null;
}

let transcriber: any = null;
let loading: Promise<any> | null = null;
let everSucceeded = false;
let lastMode: 'bundled' | 'download' | null = null;

export function localAsrEverSucceeded(): boolean { return everSucceeded; }
/** 'bundled' = verified offline asset; 'download' = runtime cache (needs internet once). */
export function localAsrMode(): 'bundled' | 'download' | null { return lastMode; }
export function localAsrModel(): string { return modelId(); }
/** Is a verified bundled model discoverable RIGHT NOW (offline, no download)? */
export function bundledLocalAsrPresent(): boolean { return resolveBundledRoot() !== null; }

async function getTranscriber(): Promise<any> {
  if (transcriber) return transcriber;
  if (loading) return loading;
  loading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    const bundledRoot = resolveBundledRoot();
    if (bundledRoot) {
      // BUNDLED → hard-disable the hub, so a fresh/offline install can NEVER
      // silently download. A wrong/missing file then throws (fail loud), it is
      // never papered over with a network fetch.
      (env as any).localModelPath = bundledRoot;
      (env as any).allowLocalModels = true;
      (env as any).allowRemoteModels = false;
      lastMode = 'bundled';
    } else {
      (env as any).cacheDir = cacheDir();
      (env as any).allowLocalModels = true;
      (env as any).allowRemoteModels = true;
      lastMode = 'download';
    }
    transcriber = await pipeline('automatic-speech-recognition', modelId());
    return transcriber;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

/** Transcribe a WAV buffer (any PCM16 rate) locally. Returns '' on empty speech. */
export async function transcribeLocalWav(wav: Buffer): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const { data, sampleRate } = decodeWavPcm16(wav);
  const audio = resampleLinear(data, sampleRate, 16000);
  const tr = await getTranscriber();
  const out = await tr(audio);
  const text = String(out?.text ?? '').trim();
  if (text) everSucceeded = true;
  return { text, latencyMs: Date.now() - t0 };
}

/** Is the local ASR module even loadable here (dependency present)? */
export function localAsrModuleAvailable(): boolean {
  try {
    const p = require.resolve('@huggingface/transformers');
    return !!p;
  } catch { return false; }
}

export function __resetLocalTranscriber() { transcriber = null; loading = null; everSucceeded = false; lastMode = null; }
void existsSync; void readFileSync;
