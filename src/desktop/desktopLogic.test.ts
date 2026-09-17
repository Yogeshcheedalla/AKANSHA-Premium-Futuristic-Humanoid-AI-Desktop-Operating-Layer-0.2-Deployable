import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The desktop decision logic is a pure, Electron-free CommonJS module so it can be
// unit-tested without a display/Electron. main.js imports the SAME module.
const require = createRequire(import.meta.url);
const logic = require('../../electron/desktop-logic.js');

test('tray reflects the authoritative voice state (no second state machine)', () => {
  assert.equal(logic.mapVoiceStateToTray('LISTENING').tooltip, 'Akansha — Listening');
  assert.equal(logic.mapVoiceStateToTray('SPEAKING').label, 'Speaking');
  assert.equal(logic.mapVoiceStateToTray('ERROR').tooltip, 'Akansha — Voice unavailable');
  assert.equal(logic.mapVoiceStateToTray('STANDBY').label, 'Ready');
  assert.equal(logic.mapVoiceStateToTray('WHATEVER').label, 'Ready'); // unknown → safe default
});

test('close behavior: hide to tray only when enabled and not explicitly quitting', () => {
  assert.equal(logic.decideCloseAction({ isQuitting: true, minimizeToTrayEnabled: true }), 'quit');
  assert.equal(logic.decideCloseAction({ isQuitting: false, minimizeToTrayEnabled: true }), 'hide');
  assert.equal(logic.decideCloseAction({ isQuitting: false, minimizeToTrayEnabled: false }), 'quit');
});

test('tray menu exposes ONLY implemented actions and enables the right voice item', () => {
  const idle = logic.buildTrayMenuTemplate({ voiceActive: false, startupEnabled: false, startupSupported: true });
  const ids = idle.filter((i: any) => i.id && i.type !== 'separator').map((i: any) => i.id);
  assert.deepEqual(ids, ['open', 'start-listening', 'stop-listening', 'status', 'settings', 'start-with-windows', 'quit']);
  const start = idle.find((i: any) => i.id === 'start-listening');
  const stop = idle.find((i: any) => i.id === 'stop-listening');
  assert.equal(start.enabled, true); assert.equal(stop.enabled, false);
  const active = logic.buildTrayMenuTemplate({ voiceActive: true, startupEnabled: true, startupSupported: true });
  assert.equal(active.find((i: any) => i.id === 'start-listening').enabled, false);
  assert.equal(active.find((i: any) => i.id === 'stop-listening').enabled, true);
  assert.equal(active.find((i: any) => i.id === 'start-with-windows').checked, true);
});

test('startup: dev / unsafe-path / unsupported-platform are refused (never a bogus target)', () => {
  assert.equal(logic.startupSettingsArgs({ enabled: true, isPackaged: false, exePath: 'C:/dev/electron.exe', platform: 'win32' }).supported, false);
  assert.equal(logic.startupSettingsArgs({ enabled: true, isPackaged: true, exePath: 'C:/app/node_modules/x/electron.exe', platform: 'win32' }).supported, false);
  assert.equal(logic.startupSettingsArgs({ enabled: true, isPackaged: true, exePath: 'C:/Program Files/Akansha/Akansha.exe', platform: 'linux' }).supported, false);
  const ok = logic.startupSettingsArgs({ enabled: true, isPackaged: true, exePath: 'C:/Program Files/Akansha/Akansha.exe', platform: 'win32' });
  assert.equal(ok.supported, true);
  assert.equal(ok.settings.openAtLogin, true);
  assert.equal(ok.settings.path, 'C:/Program Files/Akansha/Akansha.exe');
});

test('second-instance restores/focuses the existing window, never a second one', () => {
  assert.equal(logic.secondInstanceAction({ hasWindow: false, isMinimized: false, isHidden: false }), 'create');
  const a = logic.secondInstanceAction({ hasWindow: true, isMinimized: true, isHidden: true });
  assert.equal(a.restore, true);
  assert.deepEqual(a.steps, ['show', 'restore', 'focus']);
});
