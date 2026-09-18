import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from './ActionRegistry';
import { ActionDispatcher } from './ActionDispatcher';
import { requireObservedEvidence, httpOkWithContent } from './VerificationEngine';
import { deriveCapabilityStatus } from '../status/TruthfulStatus';
import type { Evidence } from './types';

const ev = (kind = 'tool', observed = true): Evidence => ({ kind, summary: `${kind} observed`, observed });
let n = 0; const rid = () => `req-${Date.now()}-${n++}`;

test('COMPLETED requires observed evidence; a bare "success" with no evidence FAILS verification', async () => {
  const reg = new ActionRegistry();
  const d = new ActionDispatcher(reg);
  reg.register({ actionId: 'a.evidence', execute: async () => ({ output: 'ok', evidence: ev() }) });
  reg.register({ actionId: 'a.noevidence', execute: async () => ({ output: 'the LLM said DONE' /* no evidence */ }) });

  const good = await d.dispatch({ actionId: 'a.evidence', requestId: rid() });
  assert.equal(good.status, 'COMPLETED');
  assert.equal(good.verification?.verified, true);

  const bad = await d.dispatch({ actionId: 'a.noevidence', requestId: rid() });
  assert.equal(bad.status, 'FAILED');
  assert.equal(bad.failure?.code, 'VERIFICATION_FAILED'); // NO EVIDENCE = NO SUCCESS
});

test('HTTP 200 with non-matching content is NOT success (httpOkWithContent)', async () => {
  const reg = new ActionRegistry();
  const d = new ActionDispatcher(reg);
  reg.register({ actionId: 'a.http', verify: httpOkWithContent((data) => (data as { ok?: boolean }).ok === true),
    execute: async () => ({ evidence: { kind: 'http', summary: '200', observed: true, data: { ok: false } } }) });
  const r = await d.dispatch({ actionId: 'a.http', requestId: rid() });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'VERIFICATION_FAILED');
});

test('idempotency: the same requestId executes exactly once', async () => {
  const reg = new ActionRegistry();
  const d = new ActionDispatcher(reg);
  let calls = 0;
  reg.register({ actionId: 'a.idem', execute: async () => { calls++; return { evidence: ev() }; } });
  const r = rid();
  await d.dispatch({ actionId: 'a.idem', requestId: r });
  await d.dispatch({ actionId: 'a.idem', requestId: r });
  assert.equal(calls, 1, 'duplicate requestId must not re-execute');
});

test('confirmation gate: a confirmation-required action without confirmation is AUTH_REQUIRED, not executed', async () => {
  const reg = new ActionRegistry();
  const d = new ActionDispatcher(reg);
  let ran = false;
  reg.register({ actionId: 'a.confirm', requiresConfirmation: true, execute: async () => { ran = true; return { evidence: ev() }; } });
  const r = await d.dispatch({ actionId: 'a.confirm', requestId: rid() });
  assert.equal(r.status, 'AUTH_REQUIRED');
  assert.equal(ran, false);
  const ok = await d.dispatch({ actionId: 'a.confirm', requestId: rid(), confirmed: true });
  assert.equal(ok.status, 'COMPLETED');
});

test('unregistered action is UNAVAILABLE (no fabricated success)', async () => {
  const d = new ActionDispatcher(new ActionRegistry());
  const r = await d.dispatch({ actionId: 'nope', requestId: rid() });
  assert.equal(r.status, 'UNAVAILABLE');
});

test('truthful status derives READY only when every real signal passes', () => {
  assert.equal(deriveCapabilityStatus({ registered: false, configured: false, credentialPresent: false, healthOk: false, testPassed: false }), 'UNAVAILABLE');
  assert.equal(deriveCapabilityStatus({ registered: true, configured: false, credentialPresent: false, healthOk: false, testPassed: false }), 'CONFIG_REQUIRED');
  assert.equal(deriveCapabilityStatus({ registered: true, configured: true, credentialPresent: false, healthOk: true, testPassed: true }), 'AUTH_REQUIRED');
  assert.equal(deriveCapabilityStatus({ registered: true, configured: true, credentialPresent: true, healthOk: false, testPassed: false }), 'BLOCKED');
  assert.equal(deriveCapabilityStatus({ registered: true, configured: true, credentialPresent: true, healthOk: true, testPassed: false }), 'CONFIG_REQUIRED');
  assert.equal(deriveCapabilityStatus({ registered: true, configured: true, credentialPresent: true, healthOk: true, testPassed: true }), 'READY');
});

test('default verification strategy requires observed evidence', () => {
  assert.equal(requireObservedEvidence({ output: 'x', evidence: undefined }).verified, false);
  assert.equal(requireObservedEvidence({ output: 'x', evidence: ev('http', false) }).verified, false);
  assert.equal(requireObservedEvidence({ output: 'x', evidence: ev('http', true) }).verified, true);
});
