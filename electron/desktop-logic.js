// ============================================================
//  AKANSHA — Desktop shell PURE logic (Electron-free, testable)
//
//  The decision logic for the tray, close-to-tray behaviour, login-item
//  startup and the tray<->voice state mapping lives here as pure functions so
//  it can be unit-tested in Node without Electron, a display, or a microphone.
//  electron/main.js imports these and wires them to the real Electron APIs —
//  there is exactly ONE authority for each decision, shared by the app.
// ============================================================
'use strict';

/**
 * Map the authoritative voice state (the SAME states AudioEngine emits) to a
 * human tooltip + short tray label. We never invent a second voice state machine;
 * these keys mirror AudioEngine's VoiceState plus the desktop lifecycle.
 */
function mapVoiceStateToTray(state) {
  switch (state) {
    case 'LISTENING': return { tooltip: 'Akansha — Listening', label: 'Listening' };
    case 'PROCESSING': return { tooltip: 'Akansha — Understanding', label: 'Understanding' };
    case 'SPEAKING': return { tooltip: 'Akansha — Speaking', label: 'Speaking' };
    case 'INTERRUPTED': return { tooltip: 'Akansha — Interrupted', label: 'Interrupted' };
    case 'MUTED': return { tooltip: 'Akansha — Paused', label: 'Paused' };
    case 'ERROR': return { tooltip: 'Akansha — Voice unavailable', label: 'Unavailable' };
    case 'STANDBY':
    default: return { tooltip: 'Akansha — Ready', label: 'Ready' };
  }
}

/**
 * Decide what to do when the user closes the main window. To keep a background
 * assistant we hide to tray instead of quitting — UNLESS the user explicitly
 * quit (tray Quit / app.quit) or minimize-to-tray is disabled.
 */
function decideCloseAction({ isQuitting, minimizeToTrayEnabled }) {
  if (isQuitting) return 'quit';
  if (minimizeToTrayEnabled) return 'hide';
  return 'quit';
}

/**
 * Build the tray menu as PLAIN descriptors (main.js maps them to Electron Menu
 * items). Only actions that are actually implemented are exposed — no fake
 * entries. `voiceActive` toggles which voice item is enabled.
 */
function buildTrayMenuTemplate({ voiceActive, startupEnabled, startupSupported }) {
  return [
    { id: 'open', label: 'Open Akansha', enabled: true },
    { id: 'sep1', type: 'separator' },
    { id: 'start-listening', label: 'Start Listening', enabled: !voiceActive },
    { id: 'stop-listening', label: 'Stop Listening', enabled: !!voiceActive },
    { id: 'sep2', type: 'separator' },
    { id: 'status', label: 'Status', enabled: true },
    { id: 'settings', label: 'Settings', enabled: true },
    {
      id: 'start-with-windows',
      label: 'Start with Windows',
      type: 'checkbox',
      checked: !!startupEnabled,
      enabled: !!startupSupported,
    },
    { id: 'sep3', type: 'separator' },
    { id: 'quit', label: 'Quit Akansha', enabled: true },
  ];
}

/**
 * Login-item arguments. CRITICAL SAFETY: never register a developer-machine path
 * (dev mode / node_modules / npx) as the startup target — only a packaged
 * executable. When unsupported (dev, or a platform without login items) we
 * report supported:false rather than silently writing a bogus entry.
 */
function startupSettingsArgs({ enabled, isPackaged, exePath, platform }) {
  if (!isPackaged) return { supported: false, reason: 'not-packaged' };
  if (!exePath || /node_modules|[\\/]npm|[\\/]npx/i.test(exePath)) return { supported: false, reason: 'unsafe-path' };
  if (platform !== 'win32' && platform !== 'darwin') return { supported: false, reason: 'unsupported-platform' };
  return { supported: true, settings: { openAtLogin: !!enabled, path: exePath } };
}

/** Single-instance: what the already-running instance should do on a 2nd launch. */
function secondInstanceAction({ hasWindow, isMinimized, isHidden }) {
  if (!hasWindow) return 'create';
  const steps = [];
  if (isHidden) steps.push('show');
  if (isMinimized) steps.push('restore');
  steps.push('focus');
  return { restore: true, steps };
}

module.exports = {
  mapVoiceStateToTray,
  decideCloseAction,
  buildTrayMenuTemplate,
  startupSettingsArgs,
  secondInstanceAction,
};
