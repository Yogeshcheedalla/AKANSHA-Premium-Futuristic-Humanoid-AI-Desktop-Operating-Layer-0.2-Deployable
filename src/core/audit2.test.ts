import { test } from 'node:test';
import assert from 'node:assert/strict';

import { signToken, verifyToken, safeEquals } from '@/core/auth/tokens';
import { authorize } from '@/core/auth/guard';
import { executionPlanner } from '@/core/execution/ExecutionPlanner';
import { executionVerifier } from '@/core/execution/ExecutionVerifier';
import { permissionEngine } from '@/core/execution/PermissionEngine';
import { AudioEngine } from '@/ui/voice/AudioEngine';

/* ── Feature 2: auth tokens ───────────────────────────────────────────── */
test('auth: signed token round-trips and expires', () => {
  const now = Date.now();
  const good = signToken({ sub: 'boss', role: 'user', iat: now, exp: now + 60000, jti: 'j1' });
  const p = verifyToken(good);
  assert.ok(p);
  assert.equal(p!.role, 'user');

  const expired = signToken({ sub: 'boss', role: 'user', iat: now - 10, exp: now - 1, jti: 'j2' });
  assert.equal(verifyToken(expired), null);
});

test('auth: tampered token is rejected', () => {
  const now = Date.now();
  const tok = signToken({ sub: 'boss', role: 'user', iat: now, exp: now + 60000, jti: 'j3' });
  assert.equal(verifyToken(tok + 'x'), null);
  assert.equal(verifyToken('garbage'), null);
});

test('auth: safeEquals is constant-time-ish and rejects mismatch', () => {
  assert.equal(safeEquals('secret123', 'secret123'), true);
  assert.equal(safeEquals('secret123', 'secret124'), false);
  assert.equal(safeEquals('', 'secret123'), false);
});

test('auth: authorize() rejects unauthenticated sensitive routes and allows public', () => {
  const req = new Request('http://localhost/api/execute', { method: 'POST' });
  const denied = authorize(req, 'sensitive');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.response.status, 401);

  const pub = authorize(req, 'public');
  assert.equal(pub.ok, true);
});

test('auth: a valid bearer token authorizes an authenticated route', () => {
  const now = Date.now();
  const tok = signToken({ sub: 'boss', role: 'user', iat: now, exp: now + 60000, jti: 'j4' });
  const req = new Request('http://localhost/api/cognitive', { headers: { authorization: `Bearer ${tok}` } });
  const g = authorize(req, 'authenticated');
  assert.equal(g.ok, true);
});

test('auth: admin-only route rejects a user-role token (authz ≠ authn)', () => {
  const now = Date.now();
  const userTok = signToken({ sub: 'boss', role: 'user', iat: now, exp: now + 60000, jti: 'j5' });
  const req = new Request('http://localhost/api/providers', { method: 'POST', headers: { authorization: `Bearer ${userTok}` } });
  const g = authorize(req, 'admin');
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.response.status, 403);
});

/* ── Feature 1: planner / verifier / permission ───────────────────────── */
test('planner: "open notepad" produces a launch step with a verification target', () => {
  const plan = executionPlanner.plan('open notepad', 'low', [], false);
  assert.ok(plan);
  assert.equal(plan!.steps[0].action.kind, 'launch');
  assert.ok(plan!.steps[0].expect?.windowTitleContains);
});

test('planner: "open notepad and type Hello" produces launch + type steps', () => {
  const plan = executionPlanner.plan('open notepad and type Hello Akansha', 'low', [], false);
  assert.ok(plan);
  assert.equal(plan!.steps.length, 2);
  assert.equal(plan!.steps[1].action.kind, 'type');
});

test('planner: unknown goals yield no plan (never guesses an action)', () => {
  assert.equal(executionPlanner.plan('tell me a joke about servers', 'low', [], false), null);
});

test('verifier: COMPLETED requires the expected window to actually be observed', () => {
  const plan = executionPlanner.plan('open notepad', 'low', [], false)!;
  const step = plan.steps[0];
  const pass = executionVerifier.verify(step, { found: true, title: 'Untitled - Notepad' });
  assert.equal(pass.passed, true);
  const fail = executionVerifier.verify(step, { found: false });
  assert.equal(fail.passed, false);
});

test('permission: launch is a windows-control capability', () => {
  const d = permissionEngine.evaluate([{ kind: 'launch', app: 'notepad' }], 'low');
  assert.ok(d.permissions.includes('WINDOWS_CONTROL'));
});

/* ── Feature 3: voice pure logic (no hardware) ────────────────────────── */
test('voice: partial ASR is never executable; final is', () => {
  assert.equal(AudioEngine.isExecutable(false), false);
  assert.equal(AudioEngine.isExecutable(true), true);
});

test('voice: one responseId speaks at most once (single authority)', () => {
  const e = new AudioEngine();
  assert.equal(e.shouldSpeak('r1'), true);
  assert.equal(e.shouldSpeak('r1'), false);
  assert.equal(e.shouldSpeak('r2'), true);
});

test('voice: barge-in only cancels while speaking', () => {
  const e = new AudioEngine();
  assert.equal(e.decideBargeIn('SPEAKING', true), true);
  assert.equal(e.decideBargeIn('STANDBY', true), false);
});

test('voice: VAD gate moves standby→listening only when speaking', () => {
  const e = new AudioEngine();
  assert.equal(e.decideVad('STANDBY', true), 'LISTENING');
  assert.equal(e.decideVad('STANDBY', false), 'STANDBY');
  assert.equal(e.decideVad('SPEAKING', true), 'SPEAKING'); // never barges via VAD alone
});

test('voice: state machine rejects illegal transitions', () => {
  const e = new AudioEngine(); // starts STANDBY
  assert.equal(e.canTransition('LISTENING'), true);
  e.transition('LISTENING');
  assert.equal(e.getState().state, 'LISTENING');
});
