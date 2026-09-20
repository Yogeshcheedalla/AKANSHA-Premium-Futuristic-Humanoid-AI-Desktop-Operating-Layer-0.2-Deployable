import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSegment, serverAsrFailure, parseVoiceSessionCommand } from '@/ui/voice/AudioEngine';

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

test('continuous voice never auto-stops on provider/route issues; only a lost mic is fatal', () => {
  assert.equal(serverAsrFailure('NO_TRANSCRIPTION_PROVIDER', 1), 'retry');
  assert.equal(serverAsrFailure('AUTH_FAILED', 9), 'retry');
  assert.equal(serverAsrFailure('RATE_LIMITED', 9), 'retry');
  assert.equal(serverAsrFailure('UNAVAILABLE', 9), 'retry');
  assert.equal(serverAsrFailure('MICROPHONE_LOST', 1), 'fatal');
});

test('spoken "stop the voice mode" / "start the voice mode" are recognized', () => {
  assert.equal(parseVoiceSessionCommand('stop the voice mode'), 'stop');
  assert.equal(parseVoiceSessionCommand('Stop listening.'), 'stop');
  assert.equal(parseVoiceSessionCommand('please turn off voice'), 'stop');
  assert.equal(parseVoiceSessionCommand('start the voice mode'), 'start');
  assert.equal(parseVoiceSessionCommand('resume listening'), 'start');
  // A real task must NOT be treated as a session command.
  assert.equal(parseVoiceSessionCommand('open notepad'), null);
  assert.equal(parseVoiceSessionCommand('what is my voice mode'), null);
});
