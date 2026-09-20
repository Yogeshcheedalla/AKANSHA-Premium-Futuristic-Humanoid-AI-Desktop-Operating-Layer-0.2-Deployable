import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCandidates, redactSecrets } from './transcription';

const rec = (over: any = {}) => ({
  providerId: 'p', name: 'P', type: 'openai-compatible', baseUrl: 'https://api.example.com/v1',
  enabled: true, credentialConfigured: true, settings: {}, ...over,
});

test('candidates: OpenAI-compatible with key → audio endpoint shape', () => {
  const c = listCandidates([rec({ providerId: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })]);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'openai-audio');
  assert.equal(c[0].baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(c[0].model, 'whisper-large-v3');
});

test('candidates: custom transcription model honored', () => {
  const c = listCandidates([rec({ settings: { transcriptionModel: 'whisper-large-v3-turbo' } })]);
  assert.equal(c[0].model, 'whisper-large-v3-turbo');
});

test('candidates: gemini gets the native inline shape with a default model', () => {
  const c = listCandidates([rec({ providerId: 'gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/' })]);
  assert.equal(c[0].kind, 'gemini-inline');
  assert.equal(c[0].model, 'gemini-2.0-flash');
  assert.equal(c[0].baseUrl, 'https://generativelanguage.googleapis.com/v1beta'); // trailing slash trimmed
});

test('candidates: disabled / keyless / local / openrouter never qualify', () => {
  const c = listCandidates([
    rec({ providerId: 'off', enabled: false }),
    rec({ providerId: 'nokey', credentialConfigured: false }),
    rec({ providerId: 'ollama', type: 'ollama', baseUrl: 'http://127.0.0.1:11434' }),
    rec({ providerId: 'or', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }),
    rec({ providerId: 'nourl', baseUrl: null }),
  ]);
  assert.deepEqual(c, []);
});

test('redactSecrets strips key-shaped text from provider errors', () => {
  const dirty = 'auth failed for sk-abc123DEF456ghi and key=g0odAIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ123456 Bearer zzzzzzzzzzzzzzzzzzzzzz';
  const clean = redactSecrets(dirty);
  assert.ok(!clean.includes('abc123DEF456'));
  assert.ok(!clean.includes('AIzaSy'));
  assert.ok(!clean.includes('zzzzzzzz'));
  assert.ok(clean.includes('[redacted]'));
});
