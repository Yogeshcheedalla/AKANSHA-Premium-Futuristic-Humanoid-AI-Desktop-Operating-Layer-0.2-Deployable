import { test } from 'node:test';
import assert from 'node:assert/strict';

// Env MUST be set before importing the route (tsx transpiles imports to in-place
// requires, so these run first). Akansha_SECRET drives session + tx signing; SMTP is
// explicitly cleared so the welcome path is a real, hermetic no-op (never a fake SENT).
process.env.AKANSHA_SECRET = 'test-auth-secret';
process.env.AKANSHA_PUBLIC_URL = 'https://akansha-gamma.vercel.app';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'SEC';
delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;
delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS; delete process.env.SMTP_FROM;

import { GET as CALLBACK } from '@/app/api/auth/google/callback/route';
import { eventBus } from '@/core/events/EventBus';
import { sealTx, randomToken, createVerifier } from '@/core/auth/googleOAuth';

const CB_URL = 'https://akansha-gamma.vercel.app/api/auth/google/callback';

/** Mock Google's token + userinfo endpoints; returns a restore() for globalThis.fetch. */
function mockGoogle(sub: string, email: string, name: string): () => void {
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async (u: any) => {
    if (String(u).includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.tok' }) };
    if (String(u).includes('/userinfo')) return { ok: true, status: 200, json: async () => ({ sub, email, name, email_verified: true }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return () => { globalThis.fetch = orig; };
}

/** Run one successful callback with a fresh, valid single-use tx cookie. */
function callbackOnce(): Promise<Response> {
  const tx = { state: randomToken(), verifier: createVerifier(), nonce: randomToken(), exp: Date.now() + 60000 };
  return CALLBACK(new Request(CB_URL + '?code=C&state=' + tx.state, { headers: { cookie: 'akansha_goauth=' + sealTx(tx) } }));
}

test('callback: brand-new account fires EXACTLY ONE best-effort welcome, and auth still succeeds', async () => {
  const sub = 'wl-new-' + randomToken();
  const restore = mockGoogle(sub, 'newuser@example.com', 'New User');
  const welcome: any[] = [];
  const off = eventBus.on('email.dispatched', (e) => { if (e.payload?.kind === 'welcome') welcome.push(e); });
  try {
    const res = await callbackOnce();
    assert.equal(res.status, 307);
    assert.match(res.headers.get('location') || '', /\/app$/, 'sign-in still lands on /app');
    assert.match(res.headers.get('set-cookie') || '', /akansha_session=/, 'session issued despite the welcome path');
    assert.equal(welcome.length, 1, 'welcome attempted exactly once for a new account');
    assert.equal(welcome[0].payload.status, 'NOT_CONFIGURED', 'honest no-op when SMTP unconfigured (never a fake SENT)');
  } finally { off(); restore(); }
});

test('callback: a REPEAT sign-in of the same account does NOT re-send a welcome', async () => {
  const sub = 'wl-ret-' + randomToken();
  const r1 = mockGoogle(sub, 'returning@example.com', 'Returning');
  try { await callbackOnce(); /* first login creates the account (welcome fires once) */ }
  finally { r1(); }

  const welcome: any[] = [];
  const off = eventBus.on('email.dispatched', (e) => { if (e.payload?.kind === 'welcome') welcome.push(e); });
  const r2 = mockGoogle(sub, 'returning@example.com', 'Returning');
  try {
    const res = await callbackOnce(); // second login, SAME subject
    assert.equal(res.status, 307);
    assert.equal(welcome.length, 0, 'no welcome re-send on return visits');
  } finally { off(); r2(); }
});

test('callback: the welcome event NEVER carries the recipient address or any secret/token', async () => {
  const sub = 'wl-priv-' + randomToken();
  const restore = mockGoogle(sub, 'privacy@example.com', 'Privacy');
  const dispatched: any[] = [];
  const off = eventBus.on('*', (e) => { if (e.type === 'email.dispatched') dispatched.push(e); });
  try {
    await callbackOnce();
    const json = JSON.stringify(dispatched);
    assert.ok(json.includes('welcome'), 'a welcome dispatch was recorded');
    assert.ok(!json.includes('privacy@example.com'), 'recipient email is never in the event');
    assert.ok(!json.includes('SEC') && !json.includes('ya29'), 'no secret/token leaks into the event');
    assert.equal(dispatched[0].payload.kind, 'welcome');
    assert.ok(!('email' in dispatched[0].payload) && !('to' in dispatched[0].payload), 'payload carries no address field');
  } finally { off(); restore(); }
});
