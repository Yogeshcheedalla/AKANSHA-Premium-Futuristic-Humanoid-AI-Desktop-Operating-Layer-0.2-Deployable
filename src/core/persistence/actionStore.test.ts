import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toExecutionRow, persistActionExecution } from './actionStore';
import type { ActionRequest, ActionResult } from '@/core/actions/types';

const req: ActionRequest = { actionId: 'memory.write', requestId: 'r1', userId: 'u1', missionId: 'm1' };
const result: ActionResult = {
  actionId: 'memory.write', requestId: 'r1', status: 'COMPLETED', startedAt: 1000, completedAt: 2000,
  verification: { verified: true, method: 'evidence:memory' },
  evidence: { kind: 'memory', observed: true, summary: 'stored', data: { memoryId: 'mem-1' } },
};

test('toExecutionRow maps a verified result without secrets', () => {
  const row = toExecutionRow(req, result);
  assert.equal(row.requestId, 'r1');
  assert.equal(row.actionId, 'memory.write');
  assert.equal(row.userId, 'u1');
  assert.equal(row.missionId, 'm1');
  assert.equal(row.verified, true);
  assert.equal(row.status, 'COMPLETED');
  assert.deepEqual(row.evidence, { kind: 'memory', summary: 'stored', data: { memoryId: 'mem-1' } });
  assert.equal(row.failure, null);
});

test('persistActionExecution inserts via the provided client', async () => {
  let captured: any = null;
  const client = { insert: () => ({ values: (v: any) => { captured = v; return { onConflictDoNothing: async () => {} }; } }) };
  const ok = await persistActionExecution(req, result, client);
  assert.equal(ok, true);
  assert.equal(captured.requestId, 'r1');
  assert.equal(captured.verified, true);
});

test('persistActionExecution degrades to false when the client throws (offline / no DB)', async () => {
  const client = { insert: () => { throw new Error('no db'); } };
  assert.equal(await persistActionExecution(req, result, client), false);
});
