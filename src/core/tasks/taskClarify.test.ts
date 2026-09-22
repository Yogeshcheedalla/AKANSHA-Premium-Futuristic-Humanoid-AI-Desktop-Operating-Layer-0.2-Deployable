import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the durable job store. The singleton computes its path lazily per call,
// so setting these at module scope (before any test runs) is sufficient.
process.env.AKANSHA_HOME = mkdtempSync(join(tmpdir(), 'akanasha-task-'));
delete process.env.DATABASE_URL;

import { taskManager } from './TaskManager';

async function until(pred: () => boolean, ms = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return pred();
}

test('a clarify step parks the mission in WAITING_FOR_USER and answer() resumes it to completion', async () => {
  const t = taskManager.create('send java program to Rahul', [
    { kind: 'clarify', label: 'choose platform', field: 'platform', question: 'Which platform — WhatsApp or email?', options: ['WhatsApp', 'email'] },
    { kind: 'wait', label: 'settle', ms: 40 },
  ]);
  taskManager.start(t.taskId);
  assert.ok(await until(() => taskManager.get(t.taskId)?.status === 'WAITING_FOR_USER'), 'should park waiting for user');
  const parked = taskManager.get(t.taskId)!;
  assert.equal(parked.currentStep, 0); // still ON the clarify step (not advanced past it)
  assert.match(parked.pendingQuestion || '', /platform/i);

  const resumed = taskManager.answer(t.taskId, 'platform', 'WhatsApp');
  assert.equal(resumed?.answers.platform, 'WhatsApp');
  assert.ok(await until(() => taskManager.get(t.taskId)?.status === 'COMPLETED'), 'should resume and complete');
  const done = taskManager.get(t.taskId)!;
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.currentStep >= 1, true); // advanced past the satisfied clarify step
});

test('a WAITING_FOR_USER mission stays parked (awaiting the user, not auto-resumed)', async () => {
  const t = taskManager.create('awaiting', [
    { kind: 'clarify', label: 'need recipient', field: 'recipient', question: 'Which Rahul?' },
  ]);
  taskManager.start(t.taskId);
  assert.ok(await until(() => taskManager.get(t.taskId)?.status === 'WAITING_FOR_USER'));
  const parked = taskManager.get(t.taskId)!;
  assert.equal(parked.status, 'WAITING_FOR_USER');
  assert.equal(parked.currentStep, 0);
});
