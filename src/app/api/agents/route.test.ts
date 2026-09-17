import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;

import { GET } from '@/app/api/agents/route';
import { auth } from '@/core/auth/session';

const URL_ = 'https://akansha-gamma.vercel.app/api/agents';
const ALLOWED = new Set(['idle', 'busy', 'paused', 'terminated']);

test('agents: unauthenticated => 401', async () => {
  const res = await GET(new Request(URL_));
  assert.equal(res.status, 401);
});

test('agents: authenticated => real supervisor snapshot; statuses are truthful', async () => {
  const g = auth.issueGuest();
  const res = await GET(new Request(URL_, { headers: { authorization: 'Bearer ' + g!.token } }));
  assert.equal(res.status, 200);
  const b: any = await res.json();
  assert.equal(b.ok, true);
  assert.ok(Array.isArray(b.agents));
  assert.ok(b.budget && typeof b.budget === 'object', 'budget exposed from supervisor');
  assert.equal(typeof b.canDispatch.allowed, 'boolean');
  // No fake "online/success": every status must be a real AgentDescriptor state.
  for (const a of b.agents) assert.ok(ALLOWED.has(a.status), `unexpected status ${a.status}`);
});
