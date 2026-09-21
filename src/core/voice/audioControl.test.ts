import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideEndpoint, decideBargeIn, readAudioHealth, shouldRejectOwnSpeech } from './audioControl';

const base = { minSpeechMs: 300, baseTrailingMs: 700 };

test('endpointing does NOT cut a short mid-sentence pause', () => {
  const r = decideEndpoint({ ...base, speechMs: 1200, trailingSilenceMs: 400, partialStableMs: 300 });
  assert.equal(r, 'continue');
});

test('endpointing finalizes on a stable trailing silence', () => {
  const r = decideEndpoint({ ...base, speechMs: 1500, trailingSilenceMs: 900, partialStableMs: 500 });
  assert.equal(r, 'finalize');
});

test('endpointing keeps listening while the partial is still moving (unstable)', () => {
  // trailing 800ms but partial only stable 100ms → needs 700+500=1200 → continue
  const r = decideEndpoint({ ...base, speechMs: 1500, trailingSilenceMs: 800, partialStableMs: 100 });
  assert.equal(r, 'continue');
});

test('a sub-threshold blip is rejected, not transcribed', () => {
  const r = decideEndpoint({ ...base, speechMs: 120, trailingSilenceMs: 800, partialStableMs: 800 });
  assert.equal(r, 'reject');
});

test('barge-in requires sustained near-end speech, not a click', () => {
  assert.equal(decideBargeIn({ assistantSpeaking: true, nearEndSpeechMs: 60, energy: 0.09, threshold: 0.05, minSpeechMs: 260 }), false); // short click
  assert.equal(decideBargeIn({ assistantSpeaking: true, nearEndSpeechMs: 300, energy: 0.02, threshold: 0.05, minSpeechMs: 260 }), false); // low fan
  assert.equal(decideBargeIn({ assistantSpeaking: true, nearEndSpeechMs: 300, energy: 0.08, threshold: 0.05, minSpeechMs: 260 }), true); // real "stop"
  assert.equal(decideBargeIn({ assistantSpeaking: false, nearEndSpeechMs: 999, energy: 0.9, threshold: 0.05, minSpeechMs: 260 }), false); // not speaking
});

test('own-speech rejection guards the turn layer while speaking', () => {
  assert.equal(shouldRejectOwnSpeech({ isSpeaking: true, echoCancellationActive: true }), true);
  assert.equal(shouldRejectOwnSpeech({ isSpeaking: false, echoCancellationActive: true }), false);
});

test('readAudioHealth reflects the ACTUAL settings (verified), not assumptions', () => {
  const h = readAudioHealth({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  assert.equal(h.echoCancellation, true); assert.equal(h.noiseSuppression, true); assert.equal(h.autoGainControl, true); assert.equal(h.verified, true);
  const off = readAudioHealth({ echoCancellation: false });
  assert.equal(off.echoCancellation, false); // reports the truth, even if it's off
});
