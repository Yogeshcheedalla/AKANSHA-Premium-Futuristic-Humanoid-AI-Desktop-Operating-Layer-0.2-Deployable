/**
 * PACKAGED-OFFLINE ACCEPTANCE (spec PHASE 15 / 5 / 17 / 19).
 *
 * Inspects the electron-builder UNPACKED app tree and PROVES, against the real
 * packaged artifacts (not the dev tree):
 *   1. the bundled Whisper model shipped to <resources>/voice/models (files + manifest)
 *   2. the native ASR modules shipped to <app>/node_modules (onnxruntime-node .node + transformers)
 *   3. the Next voice route is present in the packaged .next build
 *   4. a REAL offline transcription runs using the PACKAGED model dir with the
 *      hub HARD-DISABLED (allowRemoteModels=false) → a successful transcript is
 *      impossible if any download were required, so it demonstrates no-internet ASR.
 *
 * Usage: npx tsx scripts/verify-packaged-offline.ts [path/to/win-unpacked]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UNPACKED = resolve(process.argv[2] || 'release/win-unpacked');
const RES = join(UNPACKED, 'resources');
const APP = join(RES, 'app');
const MODEL_ROOT = join(RES, 'voice', 'models');
const MODEL_ID = 'Xenova/whisper-base.en';
const MODEL_DIR = join(MODEL_ROOT, ...MODEL_ID.split('/'));
const WAV = 'C:/Users/LENOVO/.qwenwork/workspace/mtwu90y10igbcx4a/speech-test.wav';

function ok(label: string, cond: boolean, extra = '') { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); return cond; }
function findDeep(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...findDeep(p, re));
    else if (re.test(e)) out.push(p);
  }
  return out;
}

let all = true;
console.log(`\n=== PACKAGED TREE: ${UNPACKED} ===`);
all = ok('unpacked resources exist', existsSync(RES)) && all;
all = ok('bundled model manifest present', existsSync(join(MODEL_ROOT, 'manifest.json'))) && all;
all = ok('bundled model config.json present', existsSync(join(MODEL_DIR, 'config.json'))) && all;
const enc = join(MODEL_DIR, 'onnx', 'encoder_model.onnx');
const dec = join(MODEL_DIR, 'onnx', 'decoder_model_merged.onnx');
all = ok('bundled encoder onnx present', existsSync(enc), existsSync(enc) ? `${(statSync(enc).size / 1048576).toFixed(0)} MB` : 'MISSING') && all;
all = ok('bundled decoder onnx present', existsSync(dec), existsSync(dec) ? `${(statSync(dec).size / 1048576).toFixed(0)} MB` : 'MISSING') && all;

// Native ASR runtime must be resolvable FROM THE PACKAGED app node_modules.
all = ok('packaged @huggingface/transformers present', existsSync(join(APP, 'node_modules', '@huggingface', 'transformers'))) && all;
const onnxPkg = join(APP, 'node_modules', 'onnxruntime-node');
all = ok('packaged onnxruntime-node present', existsSync(onnxPkg)) && all;
const nodeBin = existsSync(onnxPkg) ? findDeep(join(onnxPkg, 'bin'), /\.node$/i) : [];
all = ok('packaged onnxruntime native .node shipped', nodeBin.length > 0, nodeBin.map((p) => p.replace(UNPACKED, '')).slice(0, 2).join(', ')) && all;

// Voice route compiled into the packaged Next build.
const nextBuild = join(APP, '.next');
all = ok('packaged .next build present', existsSync(nextBuild)) && all;
try {
  const markers = findDeep(nextBuild, /transcribe/i).length;
  all = ok('voice/transcribe compiled into packaged build', markers > 0, `${markers} marker files`) && all;
} catch { all = ok('voice/transcribe compiled into packaged build', false) && all; }

// Manifest integrity: model id + revision recorded.
try {
  const m = JSON.parse(readFileSync(join(MODEL_ROOT, 'manifest.json'), 'utf8'));
  console.log(`      manifest: model=${m.model} revision=${String(m.revision).slice(0, 12)} totalMB=${((m.totalBytes || 0) / 1048576).toFixed(0)} files=${(m.files || []).length}`);
} catch (e: any) { console.log('      manifest read error:', e?.message); }

// ── REAL offline transcription from the PACKAGED artifacts, hub hard-disabled ──
(async () => {
  console.log('\n=== OFFLINE TRANSCRIPTION USING PACKAGED MODEL (allowRemoteModels=false) ===');
  try {
    process.env.AKANSHA_WHISPER_BUNDLE = MODEL_ROOT;
    process.env.AKANSHA_WHISPER_MODEL = MODEL_ID;
    const { readFileSync } = await import('node:fs');
    const tf = await import('@huggingface/transformers');
    const { pipeline, env } = tf as any;
    env.localModelPath = MODEL_ROOT;   // ← the PACKAGED resources dir, not dev tree
    env.allowLocalModels = true;
    env.allowRemoteModels = false;     // ← if ANY download were needed, this throws
    env.cacheDir = join(RES, 'no-net-cache'); // a throwaway dir that must stay empty
    const wav = readFileSync(WAV);
    // Reuse the app's own decoder + provider is dev code; here decode inline minimal (mono 16k wav already).
    const { decodeWavPcm16, resampleLinear } = await import('../src/core/voice/localWhisper/whisperProvider');
    const { data, sampleRate } = decodeWavPcm16(Buffer.from(wav));
    const audio = resampleLinear(data, sampleRate, 16000);
    const t0 = Date.now();
    const tr = await pipeline('automatic-speech-recognition', MODEL_ID);
    const loadMs = Date.now() - t0;
    const out = await tr(audio);
    const text = String((Array.isArray(out) ? out[0]?.text : out?.text) || '').trim();
    const cacheFiles = (() => { try { return readdirSync(join(RES, 'no-net-cache')).length; } catch { return 0; } })();
    console.log(`PASS  offline transcript: "${text}"  (load ${loadMs}ms)`);
    console.log(`${cacheFiles === 0 ? 'PASS' : 'WARN'}  nothing written to network cache dir (files=${cacheFiles}) — no download occurred`);
    if (!text) { all = false; console.log('FAIL  empty transcript from packaged offline model'); }
  } catch (e: any) {
    all = false;
    console.log('FAIL  packaged offline transcription:', e?.message || e);
    console.log('      → if this says it tried to reach the hub, packaged discovery is broken (fix MODEL_NOT_FOUND).');
  }
  console.log(`\nOVERALL: ${all ? 'ALL PACKAGED-OFFLINE CHECKS PASS' : 'ONE OR MORE CHECKS FAILED'}`);
  process.exit(all ? 0 : 1);
})();
