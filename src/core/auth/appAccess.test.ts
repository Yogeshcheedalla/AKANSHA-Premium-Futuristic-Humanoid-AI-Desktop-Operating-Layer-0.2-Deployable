import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAppAccess, isAppSession } from '@/core/auth/appAccess';
import type { Principal } from '@/core/auth/tokens';

const user = (provider = 'google'): Principal => ({ sub: 'g1', role: 'user', provider, iat: 0, exp: Date.now() + 60000, jti: 'j', email: 'a@b.co' });
const guest: Principal = { sub: 'guest', role: 'guest', iat: 0, exp: Date.now() + 60000, jti: 'jg' };

test('isAppSession: real user session counts; guest/none do not', () => {
  assert.equal(isAppSession(user('google')), true);
  assert.equal(isAppSession(user(undefined)), true); // desktop local bootstrap is also a 'user'
  assert.equal(isAppSession(guest), false);
  assert.equal(isAppSession(null), false);
});

test('decideAppAccess: user session => APP (even if google not configured)', () => {
  assert.equal(decideAppAccess({ principal: user(), googleConfigured: false }).view, 'APP');
});

test('decideAppAccess: guest/none + google configured => GOOGLE_GATE (mandatory, no guest bypass)', () => {
  assert.equal(decideAppAccess({ principal: guest, googleConfigured: true }).view, 'GOOGLE_GATE');
  assert.equal(decideAppAccess({ principal: null, googleConfigured: true }).view, 'GOOGLE_GATE');
});

test('decideAppAccess: no session + google NOT configured => honest NOT_CONFIGURED', () => {
  const d = decideAppAccess({ principal: null, googleConfigured: false });
  assert.equal(d.view, 'NOT_CONFIGURED');
  assert.match(d.reason, /not configured/i);
});
