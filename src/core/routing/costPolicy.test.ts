import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costTierFor, planCostRoute, freeFirstCompare } from './costPolicy';

test('cost tiers: local < free(openrouter) < paid', () => {
  assert.equal(costTierFor('local'), 'local');
  assert.equal(costTierFor('ollama'), 'local');
  assert.equal(costTierFor('openrouter'), 'free');
  assert.equal(costTierFor('openai'), 'paid');
  assert.equal(costTierFor('some-cloud', { isLocal: true }), 'local'); // override
  assert.equal(costTierFor('openai', { freeModel: true }), 'free');
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
