import crypto from 'crypto';
process.env.AKANSHA_SECRET = 'test-auth-secret';
delete process.env.AKANSHA_AUTH_DISABLED;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken, type Principal } from '@/core/auth/tokens';
import { auth } from '@/core/auth/session';

const jti = () => crypto.randomBytes(12).toString('hex');
const base = (over: Partial<Principal> = {}): Principal => ({
  sub: 'g-1', role: 'user', iat: Date.now(), exp: Date.now() + 60_000, jti: jti(), ...over,
});

test('signToken → verifyToken round-trips a valid principal unchanged', () => {
  const p = base({ provider: 'google', email: 'x@y.z' });
  assert.deepEqual(verifyToken(signToken(p)), p);
});

test('an expired token is rejected (session expiry is enforced on the server)', () => {
  const p = base({ iat: Date.now() - 120_000, exp: Date.now() - 1 });
  assert.equal(verifyToken(signToken(p)), null);
});

test('a tampered token is rejected (role elevation + bad signature + garbage)', () => {
  const tok = signToken(base({ role: 'guest' }));
  const [body, sig] = tok.split('.');
  const forgedBody = Buffer.from(JSON.stringify(base({ role: 'admin', sub: 'attacker' }))).toString('base64url');
  assert.equal(verifyToken(`${forgedBody}.${sig}`), null, 'body swapped under the old signature');
  assert.equal(verifyToken(`${body}.${'A'.repeat(sig.length)}`), null, 'signature altered');
  assert.equal(verifyToken('not-a-token'), null);
  assert.equal(verifyToken(undefined), null);
});

test('logout revokes a session: authenticate() stops accepting the same token', () => {
  const s = auth.issueIdentity({ sub: 'g-9', provider: 'google', email: 'z@y.z', name: 'Z' });
  const req = () => new Request('https://akansha-gamma.vercel.app/api/auth/session', { headers: { authorization: 'Bearer ' + s.token } });
  assert.equal(auth.authenticate(req())?.sub, 'g-9', 'accepted before logout');
  auth.revoke(s.principal.jti);
  assert.equal(auth.authenticate(req()), null, 'rejected after logout (revoked jti)');
});
