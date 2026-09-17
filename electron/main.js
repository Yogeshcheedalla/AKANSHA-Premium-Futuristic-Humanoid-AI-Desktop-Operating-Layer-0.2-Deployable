// ============================================================
//  AKANSHA — Electron Desktop Application (main process)
//
//  This is a REAL desktop app: Electron owns the UI window, starts
//  its OWN bundled Next.js backend as a child Node process, waits for
//  the backend to become healthy, then loads the production frontend
//  into its own window (never the user's system browser).
//
//  Lifecycle: STARTING -> HEALTH_CHECK -> READY | ERROR
//  Security:  contextIsolation on, nodeIntegration off, sandbox on,
//             only a narrow preload bridge is exposed.
// ============================================================
'use strict';

const { app, BrowserWindow, Menu, shell, ipcMain, dialog, safeStorage, Tray, nativeImage } = require('electron');
const { spawn, exec } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logic = require('./desktop-logic');

const isDev = !app.isPackaged;
const APP_PATH = isDev ? app.getAppPath() : path.join(process.resourcesPath, 'app');

/** Backend lifecycle state, mirrored to the renderer through the preload bridge. */
let lifecycle = 'STARTING';
let serverProcess = null;
let mainWindow = null;
let quitting = false;
let serverPort = 0;
let tray = null;
let minimizeToTrayEnabled = true;
let voiceState = 'STANDBY';

/**
 * Local desktop identity bootstrap.
 *
 * A single-user desktop must not force the user to open `.akansha-auth.json`
 * and paste a token. The main process generates a strong local access secret
 * ONCE, persists it **encrypted at rest via Windows DPAPI** (Electron
 * safeStorage) under per-user `userData`, hands it to the backend via
 * `AKANSHA_ACCESS_TOKEN` (so the server never needs a cwd-relative file), and
 * exposes it to the renderer over the preload IPC so the UI can exchange it for
 * the httpOnly session cookie automatically. The master secret never enters
 * localStorage, the URL, logs, or the frontend bundle; only the short-lived
 * httpOnly session token reaches the browser context.
 */
let _localAccessSecret = null;
function getLocalAccessSecret() {
  if (_localAccessSecret) return _localAccessSecret;
  const file = path.join(app.getPath('userData'), 'desktop-auth.bin');
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file);
      if (safeStorage.isEncryptionAvailable()) _localAccessSecret = safeStorage.decryptString(raw);
      else _localAccessSecret = raw.toString('utf8');
      if (_localAccessSecret) return _localAccessSecret;
    }
  } catch { /* regenerate below */ }
  _localAccessSecret = crypto.randomBytes(24).toString('base64url');
  try {
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(_localAccessSecret) : Buffer.from(_localAccessSecret, 'utf8');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf, { mode: 0o600 });
  } catch { /* keep in-memory for this run */ }
  return _localAccessSecret;
}

function setLifecycle(state, detail) {
  lifecycle = state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('akansha:lifecycle', { state, detail: detail || null, at: Date.now() });
  }
}

/** Find a free TCP port so multiple apps / dev servers never collide. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function standaloneServerPath() {
  return path.join(APP_PATH, '.next', 'standalone', 'server.js');
}
function nextBinPath() {
  return path.join(APP_PATH, 'node_modules', 'next', 'dist', 'bin', 'next');
}

/** Start the bundled Next.js production server as a child Node process. */
async function startBackend() {
  setLifecycle('STARTING');
  serverPort = Number(process.env.AKANSHA_PORT) || (await findFreePort());

  const bin = nextBinPath();
  if (!fs.existsSync(bin)) {
    setLifecycle('ERROR', `Bundled backend not found at ${bin}`);
    return;
  }

  serverProcess = spawn(
    process.execPath,
    [bin, 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)],
    {
      cwd: APP_PATH,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: String(serverPort),
        // Local desktop identity: the backend reads this instead of a
        // cwd-relative .akansha-auth.json, so a packaged install needs no
        // token file and no developer setup.
        AKANSHA_ACCESS_TOKEN: getLocalAccessSecret(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  serverProcess.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));

  serverProcess.on('exit', (code, signal) => {
    if (quitting) return;
    setLifecycle('ERROR', `Backend exited unexpectedly (code=${code} signal=${signal}).`);
  });
  serverProcess.on('error', (err) => {
    if (quitting) return;
    setLifecycle('ERROR', `Failed to start backend: ${err.message}`);
  });

  waitForHealthy();
}

function healthUrl() {
  return `http://127.0.0.1:${serverPort}/api/health`;
}

/** Poll /api/health until the server answers 2xx (the app runs even without a DB). */
function waitForHealthy(attempt = 0) {
  setLifecycle('HEALTH_CHECK');
  const req = http
    .get(healthUrl(), (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setLifecycle('READY');
        loadFrontend();
      } else if (attempt < 120) {
        setTimeout(() => waitForHealthy(attempt + 1), 500);
      } else {
        setLifecycle('ERROR', 'Backend did not become healthy in time.');
      }
    })
    .on('error', () => {
      if (attempt < 120) setTimeout(() => waitForHealthy(attempt + 1), 500);
      else setLifecycle('ERROR', 'Backend is not reachable.');
    });
  req.setTimeout(2000, () => req.destroy(new Error('health timeout')));
}

function frontendUrl() {
  // The desktop shell loads the authenticated Akansha APPLICATION (/app), not the
  // public landing page (now served at "/"). The local runtime + llama.cpp stay here.
  return `http://127.0.0.1:${serverPort}/app`;
}

function loadFrontend() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(frontendUrl());
}

function loadErrorPage(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safe = String(message || 'Unknown error').replace(/[<>&]/g, '');
  const html = `data:text/html,${encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>Akansha</title>
     <style>body{background:#010208;color:#f0f4ff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
     .card{max-width:520px;padding:32px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.03)}
     h1{font-size:18px;margin:0 0 8px;color:#ff6b81}p{font-size:13px;line-height:1.6;color:rgba(240,244,255,.7)}code{color:#00f0ff}</style></head>
     <body><div class="card"><h1>Akansha backend could not start</h1><p>${safe}</p>
     <p>Retry: close this window and launch Akansha again. If it persists, check the logs.</p></div></body></html>`
  )}`;
  mainWindow.loadURL(html);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#010208',
    title: 'Akansha',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(APP_PATH, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Never let the app navigate away from its own backend; external links go to the OS browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`) && !url.startsWith('data:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${serverPort}`)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    setLifecycle('ERROR', `Renderer crashed (${details.reason}).`);
  });

  mainWindow.on('close', (e) => {
    // Deliberate minimize-to-tray: hide instead of quitting unless the user
    // explicitly quit or tray is unavailable. Prevents a zombie-less surprise and
    // keeps the background assistant alive; tray Quit still truly terminates.
    const action = logic.decideCloseAction({ isQuitting: quitting, minimizeToTrayEnabled: minimizeToTrayEnabled && !!tray });
    if (action === 'hide') { e.preventDefault(); mainWindow.hide(); }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Show the window immediately so the user sees progress, then swap to the frontend when ready.
  loadErrorPage('Starting Akansha backend…');
}

function killBackend() {
  if (!serverProcess) return;
  const pid = serverProcess.pid;
  try {
    if (process.platform === 'win32' && pid) {
      exec(`taskkill /pid ${pid} /T /F`, () => {});
    } else {
      serverProcess.kill('SIGTERM');
    }
  } catch {
    /* best effort */
  }
  serverProcess = null;
}

// ── Startup (login item) — packaged executable only ────────────
function getStartupStatus() {
  try {
    const s = app.getLoginItemSettings();
    return { supported: app.isPackaged, enabled: !!(s && s.openAtLogin) };
  } catch {
    return { supported: false, enabled: false };
  }
}
function setStartupEnabled(enabled) {
  const args = logic.startupSettingsArgs({ enabled, isPackaged: app.isPackaged, exePath: process.execPath, platform: process.platform });
  if (!args.supported) return { ok: false, reason: args.reason };
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return { ok: true, enabled: !!enabled };
  } catch (e) {
    return { ok: false, reason: e?.message || 'set-failed' };
  }
}

// ── Tray (ONE instance) reflecting the authoritative voice state ─
function trayImage() {
  try {
    const p = path.join(APP_PATH, 'build', 'icon.png');
    if (fs.existsSync(p)) return nativeImage.createFromPath(p).resize({ width: 16, height: 16 });
  } catch { /* fall through */ }
  // A 1x1 transparent icon keeps the Tray alive where a real icon is absent.
  return nativeImage.createEmpty();
}
function updateTray() {
  if (!tray) return;
  const { tooltip } = logic.mapVoiceStateToTray(voiceState);
  try { tray.setToolTip(tooltip); } catch { /* ignore */ }
  const startup = getStartupStatus();
  const voiceActive = voiceState === 'LISTENING' || voiceState === 'PROCESSING' || voiceState === 'SPEAKING' || voiceState === 'INTERRUPTED';
  const template = logic.buildTrayMenuTemplate({ voiceActive, startupEnabled: startup.enabled, startupSupported: startup.supported });
  const menu = Menu.buildFromTemplate(
    template.map((item) => {
      if (item.type === 'separator') return { type: 'separator' };
      if (item.id === 'start-with-windows') {
        return { label: item.label, type: 'checkbox', checked: item.checked, enabled: item.enabled, click: (mi) => setStartupEnabled(mi.checked) };
      }
      return {
        label: item.label,
        enabled: item.enabled,
        click: () => onTrayAction(item.id),
      };
    })
  );
  tray.setContextMenu(menu);
}
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function sendVoiceCommand(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('akansha:voice-command', { action });
}
function onTrayAction(id) {
  switch (id) {
    case 'open': showMainWindow(); break;
    case 'start-listening': showMainWindow(); sendVoiceCommand('start'); break;
    case 'stop-listening': sendVoiceCommand('stop'); break;
    case 'status': showMainWindow(); break;
    case 'settings': showMainWindow(); break;
    case 'quit': quitting = true; app.quit(); break;
    default: break;
  }
}
function createTray() {
  if (tray) return;
  try {
    tray = new Tray(trayImage());
    tray.on('click', () => showMainWindow());
    updateTray();
  } catch { /* tray unsupported in this environment */ }
}

// ── Single instance ────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Restore/focus the EXISTING instance (never a second server/window/engine).
    const action = logic.secondInstanceAction({
      hasWindow: !!(mainWindow && !mainWindow.isDestroyed()),
      isMinimized: !!(mainWindow && mainWindow.isMinimized()),
      isHidden: !!(mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()),
    });
    if (action === 'create') { createWindow(); return; }
    showMainWindow();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'Akansha', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit' }] },
        { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      ])
    );

    ipcMain.handle('akansha:lifecycle', () => ({ state: lifecycle, port: serverPort }));
    // Local desktop auto-unlock: the renderer exchanges this for the httpOnly
    // session cookie. Only available inside the packaged/desktop app.
    ipcMain.handle('akansha:bootstrap-passphrase', () => getLocalAccessSecret());

    // Narrow desktop IPC (no Node/FS exposure): startup + window + voice state.
    ipcMain.handle('akansha:get-startup', () => getStartupStatus());
    ipcMain.handle('akansha:set-startup', (_e, enabled) => setStartupEnabled(!!enabled));
    ipcMain.on('akansha:voice-state', (_e, state) => { voiceState = String(state || 'STANDBY'); updateTray(); });
    ipcMain.handle('akansha:show-window', () => { showMainWindow(); return { ok: true }; });
    ipcMain.handle('akansha:hide-window', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); return { ok: true }; });
    ipcMain.handle('akansha:quit', () => { quitting = true; app.quit(); return { ok: true }; });

    createWindow();
    startBackend();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // With minimize-to-tray, closing the window hides it; the app stays alive in
    // the tray. Only quit when the user explicitly quit (or tray is unavailable).
    if (minimizeToTrayEnabled && tray) return;
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    try { if (tray) { tray.destroy(); tray = null; } } catch { /* ignore */ }
    killBackend();
  });

  process.on('exit', killBackend);
}
