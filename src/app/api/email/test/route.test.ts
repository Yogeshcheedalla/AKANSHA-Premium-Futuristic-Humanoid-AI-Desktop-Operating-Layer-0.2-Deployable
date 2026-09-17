import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;
delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS; delete process.env.SMTP_FROM;

import { POST } from '@/app/api/email/test/route';
import { auth } from '@/core/auth/session';

const URL_ = 'https://akansha-gamma.vercel.app/api/email/test';
const bearer = (t: string) => ({ headers: { authorization: 'Bearer ' + t } });

test('email test: unauthenticated => 401', async () => {
  assert.equal((await POST(new Request(URL_, { method: 'POST' }))).status, 401);
});

test('email test: guest (accountless) => 403 (never a guest-triggerable send)', async () => {
  const g = auth.issueGuest();
  assert.equal((await POST(new Request(URL_, { method: 'POST', ...bearer(g!.token) }))).status, 403);
});

test('email test: real account + SMTP unconfigured => honest NOT_CONFIGURED (no fake SENT)', async () => {
  const s = auth.issueIdentity({ sub: 'g-1', provider: 'google', email: 'me@example.com', name: 'Me' });
  const res = await POST(new Request(URL_, { method: 'POST', ...bearer(s.token) }));
  assert.equal(res.status, 200);
  const b: any = await res.json();
  assert.equal(b.ok, false);
  assert.equal(b.status, 'NOT_CONFIGURED');
});

test('email test: refuses to send to anyone other than the caller (no open relay)', async () => {
  const s = auth.issueIdentity({ sub: 'g-2', provider: 'google', email: 'me@example.com' });
  const res = await POST(new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer(s.token).headers) }, body: JSON.stringify({ to: 'victim@elsewhere.com' }) }));
  assert.equal(res.status, 403);
  const b: any = await res.json();
  assert.equal(b.status, 'REFUSED');
});

test('email test: never leaks recipient/host/secret in responses', async () => {
  const s = auth.issueIdentity({ sub: 'g-3', provider: 'google', email: 'me@example.com' });
  const res = await POST(new Request(URL_, { method: 'POST', ...bearer(s.token) }));
  const raw = JSON.stringify(await res.json());
  assert.ok(!/smtp|host|user|pass|@example\.com/i.test(raw), 'no credentials or recipient in the payload');
});
