/**
 * Local ASR smoke test — proves a REAL offline transcription with transformers.js
 * (Whisper via onnxruntime-node). Reads a WAV, decodes to 16 kHz mono Float32,
 * runs Whisper, prints the transcript. Run: npx tsx scripts/whisper-smoke.ts <wav>
 * This is the PATH A acceptance: no cloud, no key. READY only if this returns text.
 */
import { readFileSync } from 'node:fs';
import { pipeline, env } from '@huggingface/transformers';

function decodeWavPcm16(buf: Buffer): { data: Float32Array; sampleRate: number } {
  // Minimal RIFF/PCM parser (mono or stereo, 16-bit).
  let offset = 12; let sampleRate = 22050; let channels = 1; let bits = 16; let dataOffset = -1; let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') { dataOffset = offset + 8; dataLen = size; }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error('no data chunk');
  const bytesPer = bits / 8;
  const total = Math.floor(dataLen / bytesPer);
  const mono = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += buf.readInt16LE(dataOffset + (i * channels + c) * bytesPer) / 32768;
    mono[i] = s / channels;
  }
  return { data: mono, sampleRate };
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const idx = i * ratio; const i0 = Math.floor(idx); const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (idx - i0);
  }
  return out;
}

async function main() {
  const wav = process.argv[2] || 'C:/Users/LENOVO/.qwenwork/workspace/mtwu90y10igbcx4a/speech-test.wav';
  env.allowLocalModels = false;
  console.log('loading whisper model (first run downloads)…');
  const t0 = Date.now();
  const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
  const loadMs = Date.now() - t0;
  const { data, sampleRate } = decodeWavPcm16(readFileSync(wav));
  const audio = resample(data, sampleRate, 16000);
  const t1 = Date.now();
  const out = await transcriber(audio);
  const inferMs = Date.now() - t1;
  const text = (Array.isArray(out) ? out[0]?.text : (out as any)?.text) ?? '';
  console.log(JSON.stringify({ transcript: String(text).trim(), loadMs, inferMs, sampleRateIn: sampleRate }));
}
main().catch((e) => { console.error('SMOKE_FAIL', e?.message || e); process.exit(1); });
