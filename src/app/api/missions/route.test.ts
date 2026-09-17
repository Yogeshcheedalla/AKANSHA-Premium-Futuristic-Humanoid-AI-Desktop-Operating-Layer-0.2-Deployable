import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;

import { GET } from '@/app/api/missions/route';
import { auth } from '@/core/auth/session';

const URL_ = 'https://akansha-gamma.vercel.app/api/missions';

test('missions: unauthenticated => 401', async () => {
  const res = await GET(new Request(URL_));
  assert.equal(res.status, 401);
});

test('missions: authenticated => real orchestrator active list (empty when none running)', async () => {
  const g = auth.issueGuest();
  const res = await GET(new Request(URL_, { headers: { authorization: 'Bearer ' + g!.token } }));
  assert.equal(res.status, 200);
  const b: any = await res.json();
  assert.equal(b.ok, true);
  assert.ok(Array.isArray(b.active), 'active missions array');
  assert.equal(b.active.length, 0, 'this test process runs no missions, so the honest answer is empty (not the old hardcoded demo missions)');
});
