import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import {
  decodeWavPcm16,
  resampleLinear,
  localAsrModuleAvailable,
  localAsrEverSucceeded,
  bundledLocalAsrPresent,
  bundledAtRoot,
  __resetLocalTranscriber,
} from './whisperProvider';
import { encodeWavPcm16 } from '../audioControl';
import { listCandidates, transcribeAudio } from '../transcription';
import { systemDimensions } from '@/core/runtime/systemStatus';

// ── PATH A (free offline Whisper) must NEVER depend on a key. These tests lock
//    in the pure signal-processing + wiring that makes 100%-free voice work. ────

test('encodeWavPcm16 → decodeWavPcm16 round-trips a mono signal', () => {
  const input = new Float32Array([0, 0.25, -0.5, 0.75, -1, 0.5]);
  const wav = encodeWavPcm16(input, 16000);
  const { data, sampleRate } = decodeWavPcm16(Buffer.from(wav));
  assert.equal(sampleRate, 16000);
  assert.equal(data.length, input.length);
  for (let i = 0; i < input.length; i++) {
    assert.ok(Math.abs(data[i] - input[i]) < 0.001, `sample ${i}: ${data[i]} vs ${input[i]}`);
  }
});

test('decodeWavPcm16 averages stereo channels to mono', () => {
  // Build a tiny stereo PCM16 WAV by hand (both channels identical → mono matches).
  const samples = 4;
  const buf = Buffer.alloc(44 + samples * 2 * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); // 2 channels
  buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000 * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 4, 40);
  let off = 44;
  const vals = [0.5, -0.5, 0.25, -0.25, 0.5, -0.5, 0.25, -0.25]; // L,R per frame
  for (const v of vals) { buf.writeInt16LE(Math.round(v * 0x7fff), off); off += 2; }
  const { data, sampleRate } = decodeWavPcm16(buf);
  assert.equal(sampleRate, 8000);
  assert.equal(data.length, samples); // averaged to 4 mono samples
});

test('resampleLinear is identity when rates match and shortens on downsample', () => {
  const x = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(resampleLinear(x, 16000, 16000), x);
  const half = resampleLinear(x, 32000, 16000);
  assert.equal(half.length, 4);
});

test('local ASR module (transformers.js) is loadable in this environment → free voice has a path', () => {
  assert.equal(localAsrModuleAvailable(), true);
});

test('free local ASR never reports everSucceeded on module presence alone (no fake ready)', () => {
  __resetLocalTranscriber();
  assert.equal(localAsrEverSucceeded(), false);
});

test('listCandidates is empty without keys — free local path does not depend on it', () => {
  const rows = [{ providerId: 'x', name: 'X', type: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true, credentialConfigured: false, settings: {} }];
  assert.deepEqual(listCandidates(rows), []); // no credential → no cloud candidate; local still runs first in transcribeAudio
});

test('empty audio returns EMPTY_AUDIO immediately — never a silent cloud/paid fallback', async () => {
  const r = await transcribeAudio(Buffer.alloc(0), 'audio/wav');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EMPTY_AUDIO');
});

test('systemDimensions reports free offline voice as AVAILABLE (not UNAVAILABLE, not faked READY) when module loads', () => {
  __resetLocalTranscriber();
  const snapshot = { status: 'OFFLINE', routes: [], local: { runtimeReady: false } } as any;
  const d = systemDimensions(snapshot);
  assert.equal(d.voiceInput, 'LOCAL_WHISPER_AVAILABLE');
});

test('bundledAtRoot requires an actual config.json at <root>/<modelId> — never a bare dir', () => {
  const root = mkdtempSync(pjoin(tmpdir(), 'akanasha-whisper-'));
  assert.equal(bundledAtRoot(root), false, 'empty dir is not a bundle');
  mkdirSync(pjoin(root, 'Xenova', 'whisper-base.en'), { recursive: true });
  assert.equal(bundledAtRoot(root), false, 'bare model dir without config.json is still not a bundle');
  writeFileSync(pjoin(root, 'Xenova', 'whisper-base.en', 'config.json'), '{}');
  assert.equal(bundledAtRoot(root), true, 'config.json present → a discoverable bundle location');
});

test('systemDimensions.asr is an honest free-first LOCAL/WHIPPER privacy block', () => {
  __resetLocalTranscriber();
  const snapshot = { status: 'OFFLINE', routes: [], local: { runtimeReady: false } } as any;
  const d = systemDimensions(snapshot);
  assert.equal(d.asr.engine, 'whisper');
  assert.equal(d.asr.local, true);
  assert.equal(d.asr.model, 'Xenova/whisper-base.en');
  const present = bundledLocalAsrPresent();
  assert.equal(d.asr.bundled, present);
  // Only the verified bundled asset guarantees NO network for transcription.
  assert.equal(d.asr.networkRequiredForTranscription, !present);
});
