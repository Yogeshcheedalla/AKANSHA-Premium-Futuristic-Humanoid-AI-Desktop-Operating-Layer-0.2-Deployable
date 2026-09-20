import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionLedger } from '@/core/runtime/ExecutionLedger';

test('ledger: a repeated requestId executes exactly once (replays result)', async () => {
  const ledger = new ExecutionLedger();
  let calls = 0;
  const fn = async () => { calls += 1; return { value: calls }; };
  const a = await ledger.run('utt-123', fn);
  const b = await ledger.run('utt-123', fn); // duplicate final utterance / retried HTTP
  assert.equal(calls, 1);
  assert.deepEqual(a, { value: 1 });
  assert.deepEqual(b, a);
});

test('ledger: concurrent duplicates of one requestId share a single execution', async () => {
  const ledger = new ExecutionLedger();
  let calls = 0;
  const slow = async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return calls; };
  const [x, y] = await Promise.all([ledger.run('utt-999', slow), ledger.run('utt-999', slow)]);
  assert.equal(calls, 1);
  assert.equal(x, y);
});

test('ledger: distinct requestIds execute independently', async () => {
  const ledger = new ExecutionLedger();
  let calls = 0;
  await ledger.run('a', async () => { calls += 1; });
  await ledger.run('b', async () => { calls += 1; });
  assert.equal(calls, 2);
});

test('ledger: nested execution MUST use a scoped id — same-id nesting deadlocks (packaged "open notepad" regression)', async () => {
  const ledger = new ExecutionLedger();
  // The bug shape: outer holds the id across an await, inner joins its own
  // in-flight promise → circular wait. Prove it hangs, then prove the fix.
  const deadlocked = await Promise.race([
    ledger.run('req-x', async () => { await Promise.resolve(); return ledger.run('req-x', async () => 'inner'); }).then(() => 'resolved'),
    new Promise((r) => setTimeout(() => r('deadlocked'), 250)),
  ]);
  assert.equal(deadlocked, 'deadlocked');

  const fixed = await ledger.run('req-y', async () => {
    await Promise.resolve();
    return ledger.run('req-y:fabric', async () => 'inner-ok');
  });
  assert.equal(fixed, 'inner-ok');
});
