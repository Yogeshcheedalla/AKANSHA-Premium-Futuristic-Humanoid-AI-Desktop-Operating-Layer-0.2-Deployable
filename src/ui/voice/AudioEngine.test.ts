import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '@/ui/voice/AudioEngine';

// Minimal browser surface so the guarded start()/stop() paths can run in Node.
// Node exposes a read-only global `navigator`, so we must redefine it.
function withWindow(getUserMedia: any) {
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia } }, configurable: true, writable: true });
}
function cleanupWindow() {
  // @ts-ignore
  delete globalThis.window;
  Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
}

test('AudioEngine.start() is idempotent — a live stream is reused, no second getUserMedia', async () => {
  let gumCalls = 0;
  withWindow(async () => { gumCalls++; return { active: true, getTracks: () => [{ stop() {} }] }; });
  try {
    const e = new AudioEngine();
    // Pretend a pipeline is already live (as if the Command workspace started it).
    (e as any).mediaStream = { active: true, getTracks: () => [{ stop() {} }] };
    const r = await e.start();
    assert.equal(r.ok, true);
    assert.equal(gumCalls, 0, 'must NOT open a second microphone stream');
    assert.equal(e.getState().state, 'LISTENING');
  } finally { cleanupWindow(); }
});

test('AudioEngine.stop() releases the microphone tracks and returns to STANDBY', async () => {
  let stopped = 0;
  withWindow(async () => ({ active: true, getTracks: () => [{ stop() { stopped++; } }] }));
  try {
    const e = new AudioEngine();
    (e as any).mediaStream = { active: true, getTracks: () => [{ stop() { stopped++; } }] };
    (e as any).transition('LISTENING');
    e.stop();
    assert.equal(stopped, 1, 'mic track stopped (no leak)');
    assert.equal((e as any).mediaStream, null);
    assert.equal(e.getState().state, 'STANDBY');
  } finally { cleanupWindow(); }
});

test('AudioEngine state machine rejects invalid transitions (deterministic)', () => {
  const e = new AudioEngine(); // STANDBY
  assert.equal(e.canTransition('LISTENING'), true);
  assert.equal(e.canTransition('INTERRUPTED'), false); // STANDBY -> INTERRUPTED not allowed
  assert.equal(e.transition('INTERRUPTED'), false);
  assert.equal(e.getState().state, 'STANDBY');
});
