import crypto from 'crypto';
process.env.AKANSHA_SECRET = 'test-auth-secret';
delete process.env.AKANSHA_AUTH_DISABLED;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auth } from '@/core/auth/session';
import { authorize } from '@/core/auth/guard';

const req = (token: string, url = 'https://akansha-gamma.vercel.app/api/cognitive') =>
  new Request(url, { headers: { authorization: 'Bearer ' + token } });

test('multiple devices for the SAME Google user get independent sessions (distinct jti)', () => {
  const a = auth.issueIdentity({ sub: 'g-shared', provider: 'google', email: 'shared@example.com', name: 'S' });
  const b = auth.issueIdentity({ sub: 'g-shared', provider: 'google', email: 'shared@example.com', name: 'S' });
  assert.notEqual(a.principal.jti, b.principal.jti, 'each session has a stable unique id');
  assert.equal(a.principal.sub, b.principal.sub);
  assert.ok(auth.authenticate(req(a.token)), 'device A active');
  assert.ok(auth.authenticate(req(b.token)), 'device B active');
});

test('logging out one device revokes only that session; the other device stays signed in', () => {
  const a = auth.issueIdentity({ sub: 'g-multi-' + crypto.randomBytes(4).toString('hex'), provider: 'google', email: 'm@example.com' });
  const b = auth.issueIdentity({ sub: a.principal.sub, provider: 'google', email: 'm@example.com' });
  auth.revoke(a.principal.jti);
  assert.equal(auth.authenticate(req(a.token)), null, 'revoked device is rejected');
  assert.ok(auth.authenticate(req(b.token)), 'other device unaffected (per-jti isolation)');
});

test('a valid GUEST session still cannot reach sensitive operations from any client', () => {
  const g = auth.issueGuest();
  assert.ok(g, 'guest issued');
  const res = authorize(req(g!.token, 'https://akansha-gamma.vercel.app/api/execute'), 'sensitive');
  assert.equal(res.ok, false, 'guest blocked from sensitive');
});
