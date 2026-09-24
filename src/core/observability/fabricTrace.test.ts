import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabricTrace, redactSecrets } from './fabricTrace';
import type { FabricTraceRecord } from './fabricTrace';

const base = (over: Partial<FabricTraceRecord>): FabricTraceRecord => ({
  requestId: 'r1', providerId: 'p', modelId: 'm', attempt: 1, status: 'success',
  latencyMs: 100, failoverCount: 0, costTier: 'free', local: false, at: Date.now(), ...over,
});

test('recent() returns newest-first and respects the limit', () => {
  fabricTrace.clear();
  fabricTrace.record(base({ requestId: 'a' }));
  fabricTrace.record(base({ requestId: 'b' }));
  const recent = fabricTrace.recent(10);
  assert.equal(recent[0].requestId, 'b');
});

test('summary aggregates attempts, failovers and success across a request', () => {
  fabricTrace.clear();
  fabricTrace.record(base({ requestId: 'R', providerId: 'dead', status: 'failure', routeHealth: 'RATE_LIMITED', costTier: 'free' }));
  fabricTrace.record(base({ requestId: 'R', providerId: 'good', status: 'success', failoverCount: 1, costTier: 'local', local: true }));
  const s = fabricTrace.summary('R')!;
  assert.equal(s.attempts, 2);
  assert.equal(s.failoverCount, 1);
  assert.equal(s.succeeded, true);
  assert.equal(s.finalProviderId, 'good');
  assert.equal(s.route, 'local');
});

test('summary of a fully-failed request reports no final provider', () => {
  fabricTrace.clear();
  fabricTrace.record(base({ requestId: 'F', status: 'failure', routeHealth: 'AUTH_REQUIRED' }));
  const s = fabricTrace.summary('F')!;
  assert.equal(s.succeeded, false);
  assert.equal(s.finalProviderId, null);
  assert.equal(s.failoverCount, 1);
});

test('failoverStats counts requests needing failover and groups failures by health', () => {
  fabricTrace.clear();
  fabricTrace.record(base({ requestId: 'X', status: 'failure', routeHealth: 'QUOTA_EXHAUSTED' }));
  fabricTrace.record(base({ requestId: 'X', status: 'success' }));
  fabricTrace.record(base({ requestId: 'Y', status: 'success' }));
  const st = fabricTrace.failoverStats();
  assert.equal(st.requests, 2);
  assert.equal(st.requestsWithFailover, 1);
  assert.equal(st.failuresByHealth.QUOTA_EXHAUSTED, 1);
});

test('records never carry raw secrets — redactSecrets scrubs keys/tokens', () => {
  assert.equal(/sk-[A-Za-z0-9]{8,}/.test(redactSecrets('bad sk-abcdefghij1234')), false);
  assert.match(redactSecrets('Authorization Bearer supersecrettoken123'), /\*\*\*redacted\*\*\*/);
  assert.equal(redactSecrets('').length, 0);
});
