// ============================================================
//  AKANSHA — Electron preload (secure bridge)
//
//  contextIsolation is ON and nodeIntegration is OFF. The renderer
//  gets ONLY these narrow, read-only capabilities. There is no
//  arbitrary shell execution, no filesystem access, and no Node API
//  exposure. Any privileged computer-use action must still go through
//  the server-side Master Orchestrator -> Risk -> Permission ->
//  Execution -> Verification pipeline, never through this bridge.
// ============================================================
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('akanshaDesktop', {
  // Whether this UI is running inside the packaged desktop app.
  isDesktop: true,
  platform: process.platform,
  appVersion: (() => {
    try {
      return require('electron').app.getVersion();
    } catch {
      return 'unknown';
    }
  })(),

  // Subscribe to backend lifecycle transitions (STARTING/HEALTH_CHECK/READY/ERROR).
  onLifecycle(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('akansha:lifecycle', handler);
    return () => ipcRenderer.removeListener('akansha:lifecycle', handler);
  },

  // One-shot read of the current lifecycle state.
  getLifecycle() {
    return ipcRenderer.invoke('akansha:lifecycle');
  },

  // Local desktop identity bootstrap: returns the access secret so the UI can
  // exchange it for the httpOnly session cookie automatically (no manual token).
  // Browser (non-desktop) users never get this and still use the manual gate.
  getBootstrapPassphrase() {
    return ipcRenderer.invoke('akansha:bootstrap-passphrase');
  },

  // ── Desktop shell: startup + window + voice sync (narrow, no Node/FS) ──
  getStartup() { return ipcRenderer.invoke('akansha:get-startup'); },
  setStartup(enabled) { return ipcRenderer.invoke('akansha:set-startup', !!enabled); },
  showWindow() { return ipcRenderer.invoke('akansha:show-window'); },
  hideWindow() { return ipcRenderer.invoke('akansha:hide-window'); },
  quit() { return ipcRenderer.invoke('akansha:quit'); },

  // Tray -> renderer: start/stop the SAME authoritative AudioEngine (no 2nd mic).
  onVoiceCommand(callback) {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on('akansha:voice-command', handler);
    return () => ipcRenderer.removeListener('akansha:voice-command', handler);
  },
  // Renderer -> tray: mirror the real voice state (tooltip + menu enablement).
  reportVoiceState(state) { ipcRenderer.send('akansha:voice-state', String(state || 'STANDBY')); },
});
