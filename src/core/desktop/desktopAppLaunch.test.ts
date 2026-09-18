import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from '@/core/actions/ActionRegistry';
import { ActionDispatcher } from '@/core/actions/ActionDispatcher';
import { registerDesktopCapabilities, isSafeAppName, desktopControlStatus } from './desktopCapabilities';
import type { AppSpec } from '@/core/execution/appRegistry';

const notepad: AppSpec = { aliases: ['notepad'], exe: '%WINDIR%\\System32\\notepad.exe', titleHint: 'notepad', launch: 'store' };
const resolveFake = (q: string) => (q === 'notepad' ? notepad : null);
let n = 0; const rid = () => `desk-${Date.now()}-${n++}`;
type Launcher = { launch(app: string): Promise<{ found: boolean; pid?: number; title?: string }> };
function setup(launcher: Launcher, platform = 'win32') {
  const reg = new ActionRegistry();
  registerDesktopCapabilities({ registry: reg, resolve: resolveFake, launcher, platform });
  return new ActionDispatcher(reg);
}

test('known app + observed process → COMPLETED (verified) through the fabric', async () => {
  let calls = 0;
  const d = setup({ launch: async () => { calls++; return { found: true, pid: 4321, title: 'Untitled - Notepad' }; } });
  const r = await d.dispatch({ actionId: 'desktop.app.launch', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'COMPLETED');
  assert.equal(r.verification?.verified, true);
  assert.equal(r.evidence?.data?.pid, 4321);
  assert.equal(calls, 1);
});

test('unconfirmed → AUTH_REQUIRED; launcher never called', async () => {
  let called = false;
  const d = setup({ launch: async () => { called = true; return { found: true }; } });
  const r = await d.dispatch({ actionId: 'desktop.app.launch', requestId: rid(), payload: { application: 'notepad' } });
  assert.equal(r.status, 'AUTH_REQUIRED');
  assert.equal(called, false);
});

test('malicious app name rejected WITHOUT launching (no shell injection)', async () => {
  let called = false;
  const d = setup({ launch: async () => { called = true; return { found: true }; } });
  const r = await d.dispatch({ actionId: 'desktop.app.launch', requestId: rid(), confirmed: true, payload: { application: 'notepad && whoami' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(called, false);
});

test('unknown app → FAILED at resolve, never COMPLETED', async () => {
  const d = setup({ launch: async () => ({ found: true, pid: 1 }) });
  const r = await d.dispatch({ actionId: 'desktop.app.launch', requestId: rid(), confirmed: true, payload: { application: 'frobnicate' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.stage, 'resolve');
});

test('launch with NO observed process → FAILED (no false success)', async () => {
  const d = setup({ launch: async () => ({ found: false }) });
  const r = await d.dispatch({ actionId: 'desktop.app.launch', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'RUNTIME_START_FAILED');
});

test('non-Windows → DESKTOP_CONTROL_UNAVAILABLE', async () => {
  const d = setup({ launch: async () => ({ found: true }) }, 'darwin');
  const r = await d.dispatch({ actionId: 'desktop.app.launch', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'DESKTOP_CONTROL_UNAVAILABLE');
});

test('idempotency: same requestId launches once', async () => {
  let calls = 0;
  const d = setup({ launch: async () => { calls++; return { found: true, pid: 9 }; } });
  const r = rid();
  await d.dispatch({ actionId: 'desktop.app.launch', requestId: r, confirmed: true, payload: { application: 'notepad' } });
  await d.dispatch({ actionId: 'desktop.app.launch', requestId: r, confirmed: true, payload: { application: 'notepad' } });
  assert.equal(calls, 1);
});

test('isSafeAppName + desktopControlStatus', () => {
  assert.equal(isSafeAppName('notepad'), true);
  assert.equal(isSafeAppName('notepad; powershell'), false);
  assert.equal(isSafeAppName('a|b'), false);
  assert.equal(isSafeAppName(''), false);
  assert.equal(desktopControlStatus('win32'), 'READY');
  assert.equal(desktopControlStatus('linux'), 'UNAVAILABLE');
});
