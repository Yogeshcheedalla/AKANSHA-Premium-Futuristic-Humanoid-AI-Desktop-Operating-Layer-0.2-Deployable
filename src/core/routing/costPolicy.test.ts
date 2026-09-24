import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costTierFor, planCostRoute, freeFirstCompare, allRoutesPaid, paidConsentPrompt } from './costPolicy';

test('cost tiers: local < free(openrouter) < paid', () => {
  assert.equal(costTierFor('local'), 'local');
  assert.equal(costTierFor('ollama'), 'local');
  assert.equal(costTierFor('openrouter'), 'free');
  assert.equal(costTierFor('openai'), 'paid');
  assert.equal(costTierFor('some-cloud', { isLocal: true }), 'local'); // override
  assert.equal(costTierFor('openai', { freeModel: true }), 'free');
});

test('self-hosted free gateway tiers as free, not paid (regression)', () => {
  assert.equal(costTierFor('free-gateway'), 'free');
  // and a specific default model id on that gateway must not flip it to paid
  assert.equal(costTierFor('free-gateway'), 'free');
});

test('planCostRoute prefers local, then free, then paid', () => {
  const plan = planCostRoute([
    { providerId: 'openai' },
    { providerId: 'openrouter' },
    { providerId: 'local' },
  ]);
  assert.deepEqual(plan.ordered.map((c) => c.providerId), ['local', 'openrouter', 'openai']);
  assert.equal(plan.recommended?.providerId, 'local');
  assert.equal(plan.requiresPaidConsent, false);
});

test('requiresPaidConsent only when the ONLY routes are paid', () => {
  const plan = planCostRoute([{ providerId: 'openai' }, { providerId: 'anthropic' }]);
  assert.equal(plan.requiresPaidConsent, true);
  assert.match(plan.reason, /ask before spending/i);
});

test('empty candidates → no recommendation, no consent claim', () => {
  const plan = planCostRoute([]);
  assert.equal(plan.recommended, undefined);
  assert.equal(plan.requiresPaidConsent, false);
});

test('freeFirstCompare is a stable cheaper-first tiebreaker', () => {
  const rows = [{ providerId: 'openai' }, { providerId: 'local' }, { providerId: 'openrouter' }];
  assert.deepEqual([...rows].sort(freeFirstCompare).map((r) => r.providerId), ['local', 'openrouter', 'openai']);
});

test('allRoutesPaid: false when any free/local route exists', () => {
  assert.equal(allRoutesPaid([{ providerId: 'openai' }, { providerId: 'openrouter' }]), false);
  assert.equal(allRoutesPaid([{ providerId: 'openai' }, { providerId: 'local' }]), false);
});

test('allRoutesPaid: true only when every route is paid; empty is false', () => {
  assert.equal(allRoutesPaid([{ providerId: 'openai' }, { providerId: 'anthropic' }]), true);
  assert.equal(allRoutesPaid([]), false);
});

test('paidConsentPrompt: not required when a free/local route exists', () => {
  const p = paidConsentPrompt([{ providerId: 'openai', modelId: 'gpt-x' }, { providerId: 'local', modelId: 'qwen' }]);
  assert.equal(p.required, false);
});

test('paidConsentPrompt: required for paid-only, with options + honest unknown cost', () => {
  const p = paidConsentPrompt([{ providerId: 'openai', modelId: 'gpt-x' }]);
  assert.equal(p.required, true);
  assert.equal(p.provider, 'openai');
  assert.equal(p.model, 'gpt-x');
  assert.match(p.cost, /unavailable/i);
  assert.deepEqual(p.options, ['continue-paid', 'use-free-local', 'cancel']);
});

test('free/local selection excludes paid (planCostRoute orders local first)', () => {
  const plan = planCostRoute([{ providerId: 'openai', modelId: 'gpt' }, { providerId: 'local', modelId: 'qwen' }]);
  assert.equal(plan.recommended?.providerId, 'local');
  assert.equal(plan.requiresPaidConsent, false);
});

import { modelCostTier } from './costPolicy';

test('keyless pollinations is FREE at model and provider level', () => {
  assert.equal(modelCostTier('pollinations', 'openai'), 'free');
  assert.equal(modelCostTier('pollinations'), 'free');
});
