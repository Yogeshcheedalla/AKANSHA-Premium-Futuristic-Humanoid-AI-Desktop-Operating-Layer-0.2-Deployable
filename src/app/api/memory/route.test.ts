import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.AKANSHA_AUTH_DISABLED;
delete process.env.AKANSHA_GUESTS_DISABLED;

import { GET } from '@/app/api/memory/route';
import { auth } from '@/core/auth/session';

const URL_ = 'https://akansha-gamma.vercel.app/api/memory';

test('memory: unauthenticated => 401', async () => {
  const res = await GET(new Request(URL_));
  assert.equal(res.status, 401);
});

test('memory: authenticated => ok + real stats/items (no fabricated memories)', async () => {
  const g = auth.issueGuest();
  const res = await GET(new Request(URL_, { headers: { authorization: 'Bearer ' + g!.token } }));
  assert.equal(res.status, 200);
  const b: any = await res.json();
  assert.equal(b.ok, true);
  assert.equal(typeof b.stats, 'object');
  assert.ok(Array.isArray(b.items), 'items is a real array');
  // Whatever exists came from the store; count must equal the sum of byType totals.
  const sum = Object.values(b.stats.byType as Record<string, number>).reduce((a: number, c: number) => a + c, 0);
  assert.equal(b.items.length, sum, 'listed items match stats (no extra/fabricated rows)');
});
