import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waves, runDag } from './dagExecutor';
import type { Subtask } from './goalPlanner';

const s = (id: string, dependsOn: string[] = []): Subtask => ({ id, label: id, capability: null, dependsOn });

test('waves groups independent subtasks together and orders by dependency', () => {
  const graph = [s('a'), s('b'), s('c', ['a', 'b']), s('d')];
  const w = waves(graph);
  assert.deepEqual(w[0].sort(), ['a', 'b', 'd']); // independent first wave
  assert.deepEqual(w[1], ['c']); // depends on a,b
});

test('independent branches run concurrently; a dependent runs after them', async () => {
  const graph = [s('a'), s('b'), s('c', ['a', 'b'])];
  let peak = 0, active = 0;
  const res = await runDag(graph, async (t) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return { id: t.id, status: 'COMPLETED' as const };
  });
  assert.equal(res.get('c')!.status, 'COMPLETED');
  assert.ok(peak >= 2, `expected concurrency, peak=${peak}`);
});

test('a failed dependency SKIPS its dependents but leaves independent branches running', async () => {
  const graph = [s('a'), s('b'), s('c', ['a'])];
  const res = await runDag(graph, async (t) =>
    t.id === 'a' ? { id: 'a', status: 'FAILED' as const, error: 'boom' } : { id: t.id, status: 'COMPLETED' as const });
  assert.equal(res.get('a')!.status, 'FAILED');
  assert.equal(res.get('b')!.status, 'COMPLETED'); // independent unaffected
  assert.equal(res.get('c')!.status, 'SKIPPED');   // dependent on failed a
});
