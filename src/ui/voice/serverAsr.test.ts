import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSegment, serverAsrFailure } from '@/ui/voice/AudioEngine';

test('segment opens exactly when the user starts speaking', () => {
  assert.equal(decideSegment(false, true, 0, { ttsSpeaking: false }), 'start');
});

test('segment stays open through short pauses and closes after the silence gap', () => {
  assert.equal(decideSegment(true, false, 300, { ttsSpeaking: false }), 'hold');
  assert.equal(decideSegment(true, false, 699, { ttsSpeaking: false }), 'hold');
  assert.equal(decideSegment(true, false, 700, { ttsSpeaking: false }), 'stop');
});

test('never opens or cuts a segment while Akansha herself is speaking (echo guard)', () => {
  assert.equal(decideSegment(false, true, 0, { ttsSpeaking: true }), 'hold');
  assert.equal(decideSegment(true, false, 5000, { ttsSpeaking: true }), 'hold');
});

test('silence never opens a segment', () => {
  assert.equal(decideSegment(false, false, 0, { ttsSpeaking: false }), 'hold');
});

test('missing transcription provider is fatal, transient upstream is retryable', () => {
  assert.equal(serverAsrFailure('NO_TRANSCRIPTION_PROVIDER', 1), 'fatal');
  assert.equal(serverAsrFailure('AUTH_FAILED', 1), 'fatal');
  assert.equal(serverAsrFailure('RATE_LIMITED', 1), 'retry');
  assert.equal(serverAsrFailure('UNAVAILABLE', 2), 'retry');
  assert.equal(serverAsrFailure('UNAVAILABLE', 3), 'fatal');
});
