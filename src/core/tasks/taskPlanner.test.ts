import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTask } from './taskPlanner';

test('a chained open → wait → close goal becomes a multi-step task', async () => {
  const steps = await planTask('open notepad then wait 2 seconds then close it');
  assert.ok(steps && steps.length >= 3, JSON.stringify(steps));
  assert.equal(steps![0].kind, 'action');
  assert.equal((steps![0] as any).actionId, 'desktop.app.launch');
  assert.equal(steps!.find((s) => s.kind === 'wait')!.label, 'wait 2 seconds');
  assert.ok(steps!.some((s) => (s as any).actionId === 'desktop.app.close'));
});

test('a single action is NOT a task (falls to the normal path)', async () => {
  assert.equal(await planTask('open notepad'), null);
});

test('a timed wait alone with one action still qualifies', async () => {
  const steps = await planTask('open notepad and wait 5 seconds');
  assert.ok(steps && steps.length >= 2);
});
