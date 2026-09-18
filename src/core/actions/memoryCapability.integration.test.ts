import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@/core/actions/capabilities'; // registers memory.write on the fabric
import { actionRegistry } from './ActionRegistry';
import { actionDispatcher } from './ActionDispatcher';
import { eventBus } from '@/core/events/EventBus';
import { memorySystem } from '@/core/memory/MemorySystem';

let n = 0;
const rid = () => `memcap-${Date.now()}-${n++}`;

test('memory.write is registered on the Action Fabric', () => {
  assert.ok(actionRegistry.has('memory.write'), 'real capability must be registered');
});

test('real memory.write through the fabric → COMPLETED with observed read-back + event', async () => {
  const r = rid(); const uid = 'u-' + r;
  let completed = 0;
  const off = eventBus.on('action.completed', (e) => { if (e.requestId === r) completed++; });
  try {
    const res = await actionDispatcher.dispatch({ actionId: 'memory.write', requestId: r, userId: uid,
      payload: { text: 'The user prefers the dark theme', userId: uid, explicitRemember: true } });
    assert.equal(res.status, 'COMPLETED', 'a real store + read-back should verify');
    assert.equal(res.verification?.verified, true);
    const mid = res.evidence?.data?.memoryId as string | undefined;
    assert.ok(mid, 'memory id returned from the real write');
    assert.ok(memorySystem.retrieveMemory(String(mid)), 'read-back from the real store proves persistence');
    assert.ok(completed >= 1, 'fabric emitted action.completed → execution went THROUGH the fabric');
  } finally { off(); }
});

test('a sensitive memory.write is NOT reported as success (fabric enforces verification)', async () => {
  const res = await actionDispatcher.dispatch({ actionId: 'memory.write', requestId: rid(),
    payload: { text: 'my password is hunter2 supersecret', explicitRemember: true } });
  assert.notEqual(res.status, 'COMPLETED', 'a refused/never-store write must never be COMPLETED');
  assert.equal(res.verification?.verified, false);
});

test('bypass guard: an unregistered action cannot produce a verified result via the fabric', async () => {
  const res = await actionDispatcher.dispatch({ actionId: 'memory.write.missing', requestId: rid() });
  assert.equal(res.status, 'UNAVAILABLE');
});
