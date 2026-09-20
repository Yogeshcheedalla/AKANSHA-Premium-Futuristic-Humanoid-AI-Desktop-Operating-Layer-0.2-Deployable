import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRuntimeStatus, classifyGenerationError } from './providerBootstrap';
import { modelCostTier } from '../routing/costPolicy';

const route = (over: any = {}) => ({
  enabled: true, credentialConfigured: true, health: 'AVAILABLE' as const,
  modelCount: 3, costTier: 'paid' as const, ...over,
});

test('status: local verified model wins over everything', () => {
  const r = computeRuntimeStatus({ localReady: true, routes: [route()] });
  assert.equal(r.status, 'LOCAL_READY');
  assert.equal(r.usable, true);
});

test('status: healthy free provider → FREE_ONLINE_READY', () => {
  const r = computeRuntimeStatus({ localReady: false, routes: [route({ costTier: 'free' })] });
  assert.equal(r.status, 'FREE_ONLINE_READY');
});

test('status: only paid healthy providers → PAID_ONLY (consent path)', () => {
  const r = computeRuntimeStatus({ localReady: false, routes: [route({ costTier: 'paid' })] });
  assert.equal(r.status, 'PAID_ONLY');
});

test('status: every provider auth-rejected → AUTH_REQUIRED, NOT usable', () => {
  const r = computeRuntimeStatus({ localReady: false, routes: [route({ health: 'AUTH_REQUIRED' }), route({ providerId: 'x', health: 'RATE_LIMITED' })] });
  assert.equal(r.status, 'AUTH_REQUIRED');
  assert.equal(r.usable, false);
});

test('status: nothing configured → NO_PROVIDER (never a fake ONLINE)', () => {
  const r = computeRuntimeStatus({ localReady: false, routes: [] });
  assert.equal(r.status, 'NO_PROVIDER');
});

test('status: healthy but zero discovered models is NOT usable', () => {
  const r = computeRuntimeStatus({ localReady: false, routes: [route({ modelCount: 0 })] });
  assert.equal(r.status, 'NO_PROVIDER'); // nothing routable — honest dead-end bucket
  assert.equal(r.usable, false);
});

test('error classification: 401/credits → AUTH_REQUIRED, 429 → RATE_LIMITED, network → UNAVAILABLE', () => {
  assert.equal(classifyGenerationError('HTTP 401: invalid api key'), 'AUTH_REQUIRED');
  assert.equal(classifyGenerationError('You have no credits remaining'), 'AUTH_REQUIRED');
  assert.equal(classifyGenerationError('HTTP 429 rate limit exceeded'), 'RATE_LIMITED');
  assert.equal(classifyGenerationError('fetch failed: ENOTFOUND'), 'UNAVAILABLE');
  assert.equal(classifyGenerationError('weird upstream'), 'DEGRADED');
});

test('cost tiers: openrouter/free and :free models are FREE; openrouter/auto and metered models are PAID', () => {
  assert.equal(modelCostTier('openrouter', 'openrouter/free'), 'free');
  assert.equal(modelCostTier('openrouter', 'meta-llama/llama-3.3-70b-instruct:free'), 'free');
  assert.equal(modelCostTier('openrouter', 'openrouter/auto'), 'paid');
  assert.equal(modelCostTier('openrouter', 'anthropic/claude-sonnet-4'), 'paid');
  assert.equal(modelCostTier('groq', 'llama-3.3-70b-versatile', { freeModel: true }), 'free');
  assert.equal(modelCostTier('ollama', 'anything'), 'local');
});
