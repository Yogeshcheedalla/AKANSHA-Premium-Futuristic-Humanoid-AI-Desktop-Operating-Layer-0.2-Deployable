/**
 * /api/ai/online/connect route tests — the honest OpenRouter behavior at the edge:
 *   1. Unauthenticated -> 401 (guard).
 *   2. ACCOUNTLESS guest + no registered client_id -> 501 NOT CONFIGURED, and the
 *      response never leaks or fabricates an authorize URL. Akansha keeps working
 *      without signup; live OAuth stays blocked until a real client_id exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;
delete process.env.AKANSHA_OPENROUTER_CLIENT_ID;
delete process.env.AKANSHA_OPENROUTER_REDIRECT_URI;

import { POST } from '@/app/api/ai/online/connect/route';
import { auth } from '@/core/auth/session';

const URL_ = 'http://localhost:3000/api/ai/online/connect';

test('connect: unauthenticated request is rejected with 401', async () => {
  const res = await POST(new Request(URL_, { method: 'POST' }));
  assert.equal(res.status, 401);
});

test('connect: accountless guest + no client_id -> honest 501 NOT CONFIGURED (no invented URL)', async () => {
  const g = auth.issueGuest();
  assert.ok(g, 'guest session should be mintable');
  const res = await POST(
    new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer ' + g!.token } })
  );
  assert.equal(res.status, 501);
  const body: any = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.configured, false);
  assert.ok(!('authorizeUrl' in body) || !body.authorizeUrl, 'must NOT return a fabricated authorize URL when unconfigured');
});
