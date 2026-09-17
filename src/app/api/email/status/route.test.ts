import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;
delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS; delete process.env.SMTP_FROM;

import { GET } from '@/app/api/email/status/route';
import { auth } from '@/core/auth/session';

const URL_ = 'https://akansha-gamma.vercel.app/api/email/status';

test('email status: unauthenticated => 401', async () => {
  const res = await GET(new Request(URL_));
  assert.equal(res.status, 401);
});

test('email status: authenticated, unconfigured => honest NOT CONFIGURED, no credentials', async () => {
  const g = auth.issueGuest();
  const res = await GET(new Request(URL_, { headers: { authorization: 'Bearer ' + g!.token } }));
  assert.equal(res.status, 200);
  const b: any = await res.json();
  assert.equal(b.ok, true);
  assert.equal(b.configured, false);
  assert.equal(b.status, 'NOT CONFIGURED');
  const raw = JSON.stringify(b);
  assert.ok(!/SECRET|SMTP_PASS|"pass"|"user"|"host"/i.test(raw), 'never leaks credentials/host/user');
});
