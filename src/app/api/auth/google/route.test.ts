import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AKANSHA_SECRET = 'test-auth-secret';
Object.assign(process.env, { NODE_ENV: 'production' });
delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;
process.env.AKANSHA_PUBLIC_URL = 'https://akansha-gamma.vercel.app';

import { GET as START } from '@/app/api/auth/google/route';
import { GET as CALLBACK } from '@/app/api/auth/google/callback/route';
import { POST as LOGOUT } from '@/app/api/auth/logout/route';
import { sealTx, randomToken, createVerifier } from '@/core/auth/googleOAuth';

const START_URL = 'https://akansha-gamma.vercel.app/api/auth/google';
const CB_URL = 'https://akansha-gamma.vercel.app/api/auth/google/callback';

test('google start: NOT configured => honest 501, app stays healthy (no broken redirect)', async () => {
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  const res = await START(new Request(START_URL));
  assert.equal(res.status, 501);
  const b: any = await res.json();
  assert.equal(b.configured, false);
  assert.match(b.error, /not configured/i);
});

test('google start: configured => 302 to accounts.google.com + encrypted HttpOnly tx cookie', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'SEC';
  const res = await START(new Request(START_URL));
  assert.equal(res.status, 307);
  const loc = res.headers.get('location') || '';
  assert.ok(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'redirects to Google');
  assert.ok(loc.includes('code_challenge_method=S256') && loc.includes('state='));
  assert.ok(!loc.includes('SEC'), 'secret never in the redirect URL');
  const cookie = res.headers.get('set-cookie') || '';
  assert.ok(/akansha_goauth=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie));
});

test('google callback: missing/expired tx cookie => reject (invalid_state), nothing set', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'SEC';
  const res = await CALLBACK(new Request(CB_URL + '?code=C&state=' + randomToken()));
  assert.equal(res.status, 307);
  assert.match(res.headers.get('location') || '', /auth=invalid_state/);
  assert.ok(!/akansha_session=/.test(res.headers.get('set-cookie') || ''), 'no session on failure');
});

test('google callback: state mismatch => reject (state_mismatch)', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'SEC';
  const tx = { state: randomToken(), verifier: createVerifier(), nonce: randomToken(), exp: Date.now() + 60000 };
  const res = await CALLBACK(new Request(CB_URL + '?code=C&state=WRONG', { headers: { cookie: 'akansha_goauth=' + sealTx(tx) } }));
  assert.match(res.headers.get('location') || '', /auth=state_mismatch/);
});

test('google callback: success => session cookie + redirect /app; tx cleared; no secret/token leaked', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'SEC';
  const tx = { state: randomToken(), verifier: createVerifier(), nonce: randomToken(), exp: Date.now() + 60000 };
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async (u: any) => {
    if (String(u).includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.SECRET_TOKEN' }) };
    if (String(u).includes('/userinfo')) return { ok: true, status: 200, json: async () => ({ sub: 'g-123', email: 'boss@example.com', name: 'Boss', picture: 'https://x/a.png', email_verified: true }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const res = await CALLBACK(new Request(CB_URL + '?code=C&state=' + tx.state, { headers: { cookie: 'akansha_goauth=' + sealTx(tx) } }));
    assert.equal(res.status, 307);
    assert.match(res.headers.get('location') || '', /\/app$/); // fixed destination — no open redirect
    const setc = res.headers.get('set-cookie') || '';
    assert.ok(/akansha_session=/.test(setc) && /HttpOnly/i.test(setc) && /Secure/i.test(setc), 'secure session cookie set');
    assert.ok(/akansha_goauth=;/.test(setc), 'tx cookie cleared (single-use)');
    assert.ok(!setc.includes('ya29.SECRET_TOKEN') && !setc.includes('SEC'), 'no token/secret in cookies');
  } finally {
    globalThis.fetch = orig;
  }
});

test('google callback: even with a redirect param, destination is always /app (open-redirect rejected)', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'SEC';
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async (u: any) => {
    if (String(u).includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.t' }) };
    if (String(u).includes('/userinfo')) return { ok: true, status: 200, json: async () => ({ sub: 'g-9', email: 'a@b.co', name: 'A' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const res = await CALLBACK(new Request(CB_URL + '?code=C&state=x&redirect=https://evil.example', { headers: { cookie: 'akansha_goauth=' + sealTx({ state: 'x', verifier: 'v', nonce: 'n', exp: Date.now() + 60000 }) } }));
    const loc = res.headers.get('location') || '';
    assert.ok(loc.endsWith('/app') && !loc.includes('evil.example'));
  } finally {
    globalThis.fetch = orig;
  }
});

test('logout: clears the session cookie', async () => {
  const res = await LOGOUT(new Request('https://akansha-gamma.vercel.app/api/auth/logout', { method: 'POST' }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') || '', /akansha_session=;.*Max-Age=0/);
});
