import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ensure the security model is exercised (not the dev bypass).
delete process.env.AKANSHA_AUTH_DISABLED;
process.env.AKANSHA_ACCESS_TOKEN = 'test-user-passphrase';
process.env.AKANSHA_ADMIN_TOKEN = 'test-admin-passphrase';

import { auth } from '@/core/auth/session';
import { authorize } from '@/core/auth/guard';

const reqWith = (token: string) =>
  new Request('http://localhost/api', { headers: { cookie: `akansha_session=${token}` } });

test('accountless guest: no passphrase needed to start a session', () => {
  const g = auth.issueGuest();
  assert.ok(g && g.principal.role === 'guest');
});

test('guest can use chat-level (authenticated) routes', () => {
  const g = auth.issueGuest()!;
  const r = authorize(reqWith(g.token), 'authenticated');
  assert.equal(r.ok, true);
});

test('guest CANNOT reach sensitive/admin (no security weakening)', () => {
  const g = auth.issueGuest()!;
  const s = authorize(reqWith(g.token), 'sensitive');
  assert.equal(s.ok, false);
  if (!s.ok) assert.equal(s.response.status, 403);
  const a = authorize(reqWith(g.token), 'admin');
  assert.equal(a.ok, false);
});

test('a real user session still reaches sensitive (guest is strictly weaker)', () => {
  const u = auth.issue('test-user-passphrase');
  assert.ok(u && u.principal.role === 'user');
  assert.equal(authorize(reqWith(u!.token), 'authenticated').ok, true);
  assert.equal(authorize(reqWith(u!.token), 'sensitive').ok, true);
});

test('admin still reaches admin; user does not', () => {
  const admin = auth.issue('test-admin-passphrase')!;
  const user = auth.issue('test-user-passphrase')!;
  assert.equal(authorize(reqWith(admin.token), 'admin').ok, true);
  assert.equal(authorize(reqWith(user.token), 'admin').ok, false);
});

test('AKANSHA_GUESTS_DISABLED blocks guest sessions', () => {
  process.env.AKANSHA_GUESTS_DISABLED = 'true';
  try { assert.equal(auth.issueGuest(), null); }
  finally { delete process.env.AKANSHA_GUESTS_DISABLED; }
});

test('no-session request is rejected (401) for authenticated level', () => {
  const r = authorize(new Request('http://localhost/api'), 'authenticated');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.response.status, 401);
});
