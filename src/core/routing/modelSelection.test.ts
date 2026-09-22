import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectModel, derivePolicy, type ModelCandidate } from './modelSelection';

const c = (o: Partial<ModelCandidate> & { providerId: string; modelId: string }): ModelCandidate => ({
  costTier: 'free', local: false, capabilities: { chat: true }, health: 'READY', ...o,
});

const POOL: ModelCandidate[] = [
  c({ providerId: 'openai', modelId: 'gpt-5', costTier: 'paid', capabilities: { chat: true, coding: true, reasoning: true, toolCalling: true }, contextTokens: 200000 }),
  c({ providerId: 'omniroute', modelId: 'horde-only', costTier: 'free', capabilities: { chat: true, coding: true, reasoning: true }, contextTokens: 32000 }),
  c({ providerId: 'pollinations', modelId: 'openai-fast', costTier: 'free', capabilities: { chat: true }, contextTokens: 32000 }),
  c({ providerId: 'ollama', modelId: 'llama-3.2-3b', costTier: 'local', local: true, capabilities: { chat: true, coding: true }, contextTokens: 128000, ramGB: 4 }),
  c({ providerId: 'ollama', modelId: 'qwen-32b', costTier: 'local', local: true, capabilities: { chat: true, coding: true, reasoning: true }, contextTokens: 128000, ramGB: 24 }),
  c({ providerId: 'groq', modelId: 'llama-guard', costTier: 'free', health: 'RATE_LIMITED', capabilities: { chat: true } }),
  c({ providerId: 'gemini', modelId: 'gemini-vision', costTier: 'free', capabilities: { chat: true, vision: true }, contextTokens: 1000000 }),
];

test('derivePolicy maps natural language to explicit policies', () => {
  assert.equal(derivePolicy('work offline, no internet'), 'OFFLINE_ONLY');
  assert.equal(derivePolicy('use free only, do not pay'), 'FREE_ONLY');
  assert.equal(derivePolicy('use free models'), 'FREE_FIRST');
  assert.equal(derivePolicy('answer quickly'), 'FASTEST');
  assert.equal(derivePolicy('what is the capital of France'), 'AUTO');
});

test('FREE_ONLY never selects a paid model even if it is the strongest', () => {
  const r = selectModel({ coding: true }, 'FREE_ONLY', POOL);
  assert.ok(r.decision);
  assert.notEqual(r.decision!.costTier, 'paid');
  assert.notEqual(r.decision!.providerId, 'openai');
});

test('OFFLINE_ONLY selects only a local model', () => {
  const r = selectModel({ coding: true }, 'OFFLINE_ONLY', POOL, { freeRamGB: 16 });
  assert.ok(r.decision);
  assert.equal(r.decision!.source, 'local');
});

test('a local model needing more RAM than available is blocked, not attempted', () => {
  const r = selectModel({ coding: true }, 'OFFLINE_ONLY', POOL, { freeRamGB: 8 });
  // llama-3.2-3b (4GB) fits; qwen-32b (24GB) must not be chosen.
  assert.ok(r.decision);
  assert.equal(r.decision!.modelId, 'llama-3.2-3b');
});

test('vision requirement filters out text-only models', () => {
  const r = selectModel({ vision: true }, 'FREE_FIRST', POOL);
  assert.ok(r.decision);
  assert.equal(r.decision!.modelId, 'gemini-vision');
});

test('unhealthy providers are circuit-broken out of selection', () => {
  const r = selectModel({ chat: true } as never, 'FREE_ONLY', POOL);
  assert.ok(r.decision);
  assert.notEqual(r.decision!.providerId, 'groq'); // RATE_LIMITED excluded
});

test('coding prefers a coding-capable free model over a plain chat model', () => {
  const r = selectModel({ coding: true }, 'FREE_ONLY', POOL);
  assert.ok(r.decision);
  assert.ok(['horde-only', 'llama-3.2-3b'].includes(r.decision!.modelId));
  assert.ok(r.decision!.capabilitiesMatched.includes('coding'));
});

test('paid is only offered with explicit consent flag when policy allows', () => {
  const onlyPaid = [c({ providerId: 'openai', modelId: 'gpt-5', costTier: 'paid', capabilities: { chat: true } })];
  const r = selectModel({}, 'BEST_AVAILABLE', onlyPaid);
  assert.ok(r.decision);
  assert.equal(r.decision!.requiresPaidConsent, true);
});

test('no eligible model under policy returns a truthful blocked reason (never a fake pick)', () => {
  const r = selectModel({ vision: true }, 'OFFLINE_ONLY', POOL, { freeRamGB: 16 });
  assert.equal(r.decision, null);
  assert.ok(r.blockedReason);
});

test('fallbacks list other eligible candidates', () => {
  const r = selectModel({ coding: true }, 'FREE_ONLY', POOL, { freeRamGB: 32 });
  assert.ok(r.decision);
  assert.ok(r.decision!.fallbacks.length >= 1);
});
