import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeRouteRegistry } from './freeRouteRegistry';
import { classifyRouteError } from './routeHealth';

test('unseen route has neutral score, never an optimistic boost', () => {
  freeRouteRegistry.reset();
  assert.equal(freeRouteRegistry.score('ghost'), 0.5);
  assert.equal(freeRouteRegistry.available('ghost'), true);
});

test('successes raise reliability + latency score and clear cooldown', () => {
  freeRouteRegistry.reset();
  freeRouteRegistry.recordSuccess('fastfree', 'm1', 400, { costTier: 'free', local: false });
  freeRouteRegistry.recordSuccess('fastfree', 'm1', 600);
  const m = freeRouteRegistry.get('fastfree', 'm1')!;
  assert.equal(m.attempts, 2);
  assert.equal(m.successes, 2);
  assert.equal(m.successRate, 1);
  assert.ok(m.latencyEwmaMs > 0);
  assert.equal(m.lastState, 'READY');
  assert.ok(freeRouteRegistry.score('fastfree', 'm1') > 0.5);
});

test('rate-limit failure imposes an advisory cooldown; it lifts after the window', () => {
  freeRouteRegistry.reset();
  const state = classifyRouteError('HTTP 429 Too Many Requests', 429); // RATE_LIMITED
  freeRouteRegistry.recordFailure('flaky', 'm2', 900, state, '429');
  assert.equal(freeRouteRegistry.get('flaky', 'm2')!.lastState, 'RATE_LIMITED');
  assert.equal(freeRouteRegistry.available('flaky', 'm2'), false);
  assert.ok(freeRouteRegistry.score('flaky', 'm2') < 0.5);
  // Recovery: a later success clears the cooldown and flips state back to READY.
  freeRouteRegistry.recordSuccess('flaky', 'm2', 500);
  assert.equal(freeRouteRegistry.available('flaky', 'm2'), true);
  assert.equal(freeRouteRegistry.get('flaky', 'm2')!.lastState, 'READY');
});

test('quota-exhaustion is tracked distinctly from a transient rate limit', () => {
  freeRouteRegistry.reset();
  freeRouteRegistry.recordFailure('broke', 'x', 100, classifyRouteError('no credits left', 429), 'no credits');
  assert.equal(freeRouteRegistry.get('broke', 'x')!.lastState, 'QUOTA_EXHAUSTED');
});

test('EWMA latency weights recent samples more than old ones', () => {
  freeRouteRegistry.reset();
  freeRouteRegistry.recordSuccess('slow', 'x', 1000);
  const afterFirst = freeRouteRegistry.get('slow', 'x')!.latencyEwmaMs;
  assert.equal(afterFirst, 1000); // seeded with the first sample
  freeRouteRegistry.recordSuccess('slow', 'x', 4000);
  const afterSecond = freeRouteRegistry.get('slow', 'x')!.latencyEwmaMs;
  assert.ok(afterSecond > afterFirst && afterSecond < 4000); // moved toward 4000, not jumped
});

test('dashboard() exposes only evidence-backed routes with real numbers', () => {
  freeRouteRegistry.reset();
  freeRouteRegistry.recordSuccess('good', 'g', 300, { costTier: 'local', local: true });
  freeRouteRegistry.annotate('neverused', 'n', { costTier: 'free' });
  const rows = freeRouteRegistry.dashboard();
  const ids = rows.map((r) => r.providerId);
  assert.ok(ids.includes('good'));
  assert.ok(!ids.includes('neverused'), 'routes with zero attempts are not shown');
  const good = rows.find((r) => r.providerId === 'good')!;
  assert.equal(good.costTier, 'local');
  assert.equal(good.attempts, 1);
});
