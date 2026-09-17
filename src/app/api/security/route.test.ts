import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_FROM;

import { GET } from '@/app/api/security/route';
import { auth } from '@/core/auth/session';

const URL_ = 'https://akansha-gamma.vercel.app/api/security';

test('security: unauthenticated => 401 (never leak posture)', async () => {
  const res = await GET(new Request(URL_));
  assert.equal(res.status, 401);
});

test('security: authenticated => real identity + honest config + true permission model', async () => {
  const g = auth.issueGuest();
  const res = await GET(new Request(URL_, { headers: { authorization: 'Bearer ' + g!.token } }));
  assert.equal(res.status, 200);
  const b: any = await res.json();
  assert.equal(b.ok, true);

  assert.ok(b.identity && 'role' in b.identity, 'identity present');
  // With credentials cleared, the honest config is false — not a fake "configured".
  assert.equal(b.subsystems.googleAuth, false);
  assert.equal(b.subsystems.transactionalEmail, false);

  // The permission model must mirror the enforcing engine (mutating kinds need perms).
  assert.ok(b.desktopPermissions.actionPermissions.type.includes('WINDOWS_CONTROL'));
  assert.ok(b.desktopPermissions.confirmingKinds.includes('click'));
  assert.ok(b.desktopPermissions.autoRunKinds.includes('observe'));
});

test('security: response never carries secrets/tokens/credential material', async () => {
  const g = auth.issueGuest();
  const res = await GET(new Request(URL_, { headers: { authorization: 'Bearer ' + g!.token } }));
  const raw = JSON.stringify(await res.json());
  assert.ok(!/"encrypted"|"iv"|GOCSPX|Bearer|akansha_session|"pass"|"secret"/i.test(raw), 'no secret/credential/token material leaks');
});
