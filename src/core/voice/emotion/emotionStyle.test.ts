import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveEmotionStyle, prosodyFor, styleFromTurn } from './emotionStyle';

test('success is celebratory, failure is apologetic, greeting is warm, urgency is urgent', () => {
  assert.equal(deriveEmotionStyle({ status: 'COMPLETED' }), 'CELEBRATORY');
  assert.equal(deriveEmotionStyle({ status: 'FAILED' }), 'APOLOGETIC');
  assert.equal(deriveEmotionStyle({ isGreeting: true }), 'WARM');
  assert.equal(deriveEmotionStyle({ urgentWords: true }), 'URGENT');
  assert.equal(deriveEmotionStyle({ distressedWords: true }), 'CONCERNED');
  assert.equal(deriveEmotionStyle({}), 'NEUTRAL');
});

test('prosody stays within safe SpeechSynthesis bounds', () => {
  for (const s of ['WARM', 'CELEBRATORY', 'APOLOGETIC', 'URGENT', 'NEUTRAL'] as const) {
    const p = prosodyFor(s);
    assert.ok(p.rate >= 0.7 && p.rate <= 1.3, `rate ${p.rate}`);
    assert.ok(p.pitch >= 0.6 && p.pitch <= 1.6, `pitch ${p.pitch}`);
  }
});

test('styleFromTurn maps a real turn to a delivery style (facts unchanged)', () => {
  assert.equal(styleFromTurn('hello', { status: 'COMPLETED' }).style, 'WARM');
  assert.equal(styleFromTurn('do it now urgent', { status: 'COMPLETED' }).style, 'URGENT');
  assert.equal(styleFromTurn('run task', { status: 'FAILED', failureClass: 'X' }).style, 'APOLOGETIC');
});
