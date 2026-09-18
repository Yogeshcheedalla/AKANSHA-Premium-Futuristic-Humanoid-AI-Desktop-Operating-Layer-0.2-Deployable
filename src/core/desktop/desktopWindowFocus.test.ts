import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from '@/core/actions/ActionRegistry';
import { ActionDispatcher } from '@/core/actions/ActionDispatcher';
import { registerDesktopCapabilities } from './desktopCapabilities';
import type { AppSpec } from '@/core/execution/appRegistry';

const notepad: AppSpec = { aliases: ['notepad'], exe: '%WINDIR%\\System32\\notepad.exe', titleHint: 'notepad', processName: 'notepad', launch: 'store' };
const resolveFake = (q: string) => (q === 'notepad' ? notepad : null);
let n = 0; const rid = () => `focus-${Date.now()}-${n++}`;
type Focuser = { focus(app: string): Promise<{ found: boolean; foreground?: boolean; title?: string; foregroundPid?: number; targetPid?: number }> };
const inert = async () => ({ found: true, pid: 1 });

function setup(focuser: Focuser, platform = 'win32') {
  const reg = new ActionRegistry();
  registerDesktopCapabilities({ registry: reg, resolve: resolveFake, launcher: { launch: inert }, closer: { close: async () => ({ wasRunning: false, closed: false, remainingPids: [] }) }, focuser, platform });
  return new ActionDispatcher(reg);
}

test('window brought to foreground → COMPLETED (verified) through the fabric', async () => {
  let calls = 0;
  const d = setup({ focus: async () => { calls++; return { found: true, foreground: true, title: 'Untitled - Notepad', foregroundPid: 4321, targetPid: 4321 }; } });
  const r = await d.dispatch({ actionId: 'desktop.window.focus', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'COMPLETED');
  assert.equal(r.verification?.method, 'foregroundObserved');
  assert.equal(r.evidence?.data?.foregroundPid, 4321);
  assert.equal(calls, 1);
});

test('window exists but could NOT be foregrounded → FAILED (no false success)', async () => {
  const d = setup({ focus: async () => ({ found: true, foreground: false, targetPid: 1, foregroundPid: 999 }) });
  const r = await d.dispatch({ actionId: 'desktop.window.focus', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'VERIFICATION_FAILED');
});

test('no window to focus → APP_NOT_FOUND', async () => {
  const d = setup({ focus: async () => ({ found: false }) });
  const r = await d.dispatch({ actionId: 'desktop.window.focus', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'APP_NOT_FOUND');
});

test('unconfirmed → AUTH_REQUIRED; focuser never called', async () => {
  let called = false;
  const d = setup({ focus: async () => { called = true; return { found: true, foreground: true }; } });
  const r = await d.dispatch({ actionId: 'desktop.window.focus', requestId: rid(), payload: { application: 'notepad' } });
  assert.equal(r.status, 'AUTH_REQUIRED');
  assert.equal(called, false);
});

test('non-Windows → DESKTOP_CONTROL_UNAVAILABLE', async () => {
  const d = setup({ focus: async () => ({ found: true, foreground: true }) }, 'linux');
  const r = await d.dispatch({ actionId: 'desktop.window.focus', requestId: rid(), confirmed: true, payload: { application: 'notepad' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'DESKTOP_CONTROL_UNAVAILABLE');
});

test('idempotency: same requestId focuses once', async () => {
  let calls = 0;
  const d = setup({ focus: async () => { calls++; return { found: true, foreground: true, targetPid: 5, foregroundPid: 5 }; } });
  const r = rid();
  await d.dispatch({ actionId: 'desktop.window.focus', requestId: r, confirmed: true, payload: { application: 'notepad' } });
  await d.dispatch({ actionId: 'desktop.window.focus', requestId: r, confirmed: true, payload: { application: 'notepad' } });
  assert.equal(calls, 1);
});
