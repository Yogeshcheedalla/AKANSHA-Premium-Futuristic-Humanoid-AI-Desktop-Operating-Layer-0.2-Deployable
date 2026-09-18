import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from '@/core/actions/ActionRegistry';
import { ActionDispatcher } from '@/core/actions/ActionDispatcher';
import { registerDesktopCapabilities } from './desktopCapabilities';
import type { AppSpec } from '@/core/execution/appRegistry';
import type { ProcessCloseResult } from '@/core/execution/types';

const notepad: AppSpec = { aliases: ['notepad'], exe: '%WINDIR%\\System32\\notepad.exe', titleHint: 'notepad', processName: 'notepad', launch: 'store' };
const resolveFake = (q: string) => (q === 'notepad' ? notepad : null);
let n = 0; const rid = () => `close-${Date.now()}-${n++}`;
type Closer = { close(app: string): Promise<ProcessCloseResult> };
const noLaunch = async () => ({ found: true, pid: 1 });

function setup(closer: Closer, platform = 'win32') {
  const reg = new ActionRegistry();
  registerDesktopCapabilities({ registry: reg, resolve: resolveFake, launcher: { launch: noLaunch }, closer, platform });
  return new ActionDispatcher(reg);
}

test('known running app observed terminating → COMPLETED through the fabric', async () => {
  let calls = 0;
  const d = setup({ close: async () => { calls++; return { wasRunning: true, closed: true, killedPid: 4321, remainingPids: [] }; } });
  const r = await d.dispatch({ actionId: 'desktop.app.close', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'COMPLETED');
  assert.equal(r.verification?.method, 'processTerminated');
  assert.equal(r.evidence?.data?.killedPid, 4321);
  assert.equal(calls, 1);
});

test('unconfirmed → AUTH_REQUIRED; closer never called', async () => {
  let called = false;
  const d = setup({ close: async () => { called = true; return { wasRunning: true, closed: true, remainingPids: [] }; } });
  const r = await d.dispatch({ actionId: 'desktop.app.close', requestId: rid(), payload: { application: 'notepad' } });
  assert.equal(r.status, 'AUTH_REQUIRED');
  assert.equal(called, false);
});

test('process still running after terminate attempt → FAILED (survived, no false success)', async () => {
  const d = setup({ close: async () => ({ wasRunning: true, closed: false, remainingPids: [999] }) });
  const r = await d.dispatch({ actionId: 'desktop.app.close', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'VERIFICATION_FAILED');
});

test('app not running → FAILED at execute (cannot claim we closed nothing)', async () => {
  const d = setup({ close: async () => ({ wasRunning: false, closed: false, remainingPids: [] }) });
  const r = await d.dispatch({ actionId: 'desktop.app.close', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'APP_NOT_FOUND');
});

test('malicious app name rejected WITHOUT calling closer (no shell injection)', async () => {
  let called = false;
  const d = setup({ close: async () => { called = true; return { wasRunning: true, closed: true, remainingPids: [] }; } });
  const r = await d.dispatch({ actionId: 'desktop.app.close', requestId: rid(), confirmed: true, payload: { application: 'notepad; powershell' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(called, false);
});

test('unknown app → FAILED at resolve', async () => {
  const d = setup({ close: async () => ({ wasRunning: true, closed: true, remainingPids: [] }) });
  const r = await d.dispatch({ actionId: 'desktop.app.close', requestId: rid(), confirmed: true, payload: { application: 'frobnicate' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.stage, 'resolve');
});

test('non-Windows → DESKTOP_CONTROL_UNAVAILABLE', async () => {
  const d = setup({ close: async () => ({ wasRunning: true, closed: true, remainingPids: [] }) }, 'linux');
  const r = await d.dispatch({ actionId: 'desktop.app.close', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'DESKTOP_CONTROL_UNAVAILABLE');
});

test('idempotency: same requestId closes once', async () => {
  let calls = 0;
  const d = setup({ close: async () => { calls++; return { wasRunning: true, closed: true, remainingPids: [] }; } });
  const r = rid();
  await d.dispatch({ actionId: 'desktop.app.close', requestId: r, confirmed: true, payload: { application: 'notepad' } });
  await d.dispatch({ actionId: 'desktop.app.close', requestId: r, confirmed: true, payload: { application: 'notepad' } });
  assert.equal(calls, 1);
});
