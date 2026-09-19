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

const { app, BrowserWindow, Menu, shell, ipcMain, dialog, safeStorage, Tray, nativeImage, clipboard } = require('electron');
const { spawn, exec } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logic = require('./desktop-logic');
const { createBackendLogger } = require('./backendLogger');

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

// Durable, redacted backend diagnostics (userData/backend.log) + last error for the UI.
let backendLog = null;
let lastError = null;
let frontendLoaded = false;
let healthAttempts = 0;
function logEvent(level, event, data) { try { if (backendLog) backendLog[level](event, data); } catch { /* never crash on logging */ } }

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
  logEvent(state === 'ERROR' ? 'error' : 'info', 'lifecycle', { state, detail: detail || null });
  if (state === 'ERROR') {
    lastError = { stage: detail || 'unknown', reason: detail || 'Unknown error', at: new Date().toISOString(), port: serverPort, pid: serverProcess ? serverProcess.pid : null };
    if (!frontendLoaded) loadErrorPage(detail, { error: true });
  }
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
  frontendLoaded = false;
  healthAttempts = 0;
  serverPort = Number(process.env.AKANSHA_PORT) || (await findFreePort());

  const bin = nextBinPath();
  logEvent('info', 'spawn_plan', { exe: process.execPath, entry: bin, cwd: APP_PATH, port: serverPort, packaged: app.isPackaged });
  if (!fs.existsSync(bin)) {
    logEvent('error', 'backend_missing', { entry: bin, cwd: APP_PATH });
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
        // The backend runs as a node child (no process.resourcesPath), so forward the
        // bundled runtime dir; discovery reads AKANSHA_PACKAGED_RUNTIME.
        AKANSHA_PACKAGED_RUNTIME: app.isPackaged ? path.join(process.resourcesPath, 'runtime', 'llama') : '',
        // Local desktop identity: the backend reads this instead of a
        // cwd-relative .akansha-auth.json, so a packaged install needs no
        // token file and no developer setup.
        AKANSHA_ACCESS_TOKEN: getLocalAccessSecret(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  logEvent('info', 'spawned', { pid: serverProcess.pid, port: serverPort });

  serverProcess.stdout.on('data', (d) => { const t = String(d); process.stdout.write(`[backend] ${t}`); logEvent('info', 'stdout', { text: t.trim() }); });
  serverProcess.stderr.on('data', (d) => { const t = String(d); process.stderr.write(`[backend] ${t}`); logEvent('warn', 'stderr', { text: t.trim() }); });

  serverProcess.on('exit', (code, signal) => {
    logEvent('error', 'exit', { code, signal, healthAttempts, frontendLoaded });
    if (quitting) return;
    if (!frontendLoaded) setLifecycle('ERROR', `Backend exited unexpectedly (code=${code} signal=${signal}).`);
    serverProcess = null;
  });
  serverProcess.on('error', (err) => {
    logEvent('error', 'spawn_error', { message: err.message });
    if (quitting) return;
    setLifecycle('ERROR', `Failed to start backend: ${err.message}`);
  });

  waitForHealthy();
}

function healthUrl() {
  return `http://127.0.0.1:${serverPort}/api/health`;
}

/** Poll /api/health until the server answers 2xx (the app runs even without a DB). */
let healthStartTs = 0;
function waitForHealthy(attempt = 0) {
  healthAttempts = attempt;
  if (attempt === 0) healthStartTs = Date.now();
  setLifecycle('HEALTH_CHECK');
  const started = Date.now();
  const req = http
    .get(healthUrl(), (res) => {
      const latencyMs = Date.now() - started;
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logEvent('info', 'health_ok', { attempt, status: res.statusCode, latencyMs, totalMs: Date.now() - healthStartTs });
        setLifecycle('READY');
        loadFrontend();
      } else if (attempt < 120) {
        setTimeout(() => waitForHealthy(attempt + 1), 500);
      } else {
        const alive = !!(serverProcess && serverProcess.pid);
        logEvent('error', 'health_timeout', { attempt, status: res.statusCode, alive, totalMs: Date.now() - healthStartTs });
        setLifecycle('ERROR', alive
          ? 'Backend process is alive but the health check never became ready.'
          : 'Backend did not become healthy in time.');
      }
    })
    .on('error', () => {
      if (attempt < 120) setTimeout(() => waitForHealthy(attempt + 1), 500);
      else {
        const alive = !!(serverProcess && serverProcess.pid);
        logEvent('error', 'health_unreachable', { attempt, alive, totalMs: Date.now() - healthStartTs });
        setLifecycle('ERROR', alive
          ? 'Backend process is alive but health endpoint is unreachable.'
          : 'Backend is not reachable.');
      }
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
  frontendLoaded = true;
  logEvent('info', 'frontend_loaded', { url: frontendUrl() });
  mainWindow.loadURL(frontendUrl());
}

function loadErrorPage(message, opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const isError = !!opts.error;
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, '');
  const e = lastError || {};
  const buttons = isError
    ? `<div class="btns">
         <button onclick="akanshaDesktop.retryBackend()">RETRY</button>
         <button onclick="akanshaDesktop.openBackendLogs()">OPEN LOGS</button>
         <button onclick="akanshaDesktop.copyBackendDiagnostic()">COPY DIAGNOSTIC</button>
         <button class="quit" onclick="akanshaDesktop.quit()">QUIT</button>
       </div>`
    : '';
  const detail = isError
    ? `<div class="grid">
         <span>Failure stage</span><code>${esc(e.stage || message || 'unknown')}</code>
         <span>Reason</span><code>${esc(e.reason || message || 'Unknown error')}</code>
         <span>Timestamp</span><code>${esc(e.at || new Date().toISOString())}</code>
         <span>Port</span><code>${esc(e.port || serverPort || 'n/a')}</code>
         <span>Backend PID</span><code>${esc(e.pid || 'n/a')}</code>
       </div>`
    : '';
  const title = isError ? 'Akansha backend startup failed' : 'Starting Akansha…';
  const sub = isError ? 'The bundled local backend did not become ready. The details below come from the diagnostic log.' : (esc(message) || 'Please wait.');
  const html = `data:text/html,${encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>Akansha</title>
     <style>
       body{background:#010208;color:#f0f4ff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
       .card{max-width:640px;padding:34px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:rgba(255,255,255,.03)}
       h1{font-size:18px;margin:0 0 10px;color:${isError ? '#ff6b81' : '#8fe9ff'}}
       p{font-size:13px;line-height:1.6;color:rgba(240,244,255,.7);margin:0 0 18px}
       code{color:#00f0ff;font-size:12px;word-break:break-all}
       .grid{display:grid;grid-template-columns:130px 1fr;gap:8px 14px;font-size:12px;margin-bottom:20px}
       .grid span{color:rgba(240,244,255,.45);text-transform:uppercase;letter-spacing:.06em;font-size:10px;align-self:center}
       .btns{display:flex;gap:10px;flex-wrap:wrap}
       button{cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:.04em;padding:10px 16px;border-radius:11px;border:1px solid rgba(0,240,255,.4);background:rgba(0,240,255,.1);color:#8fe9ff}
       button:hover{background:rgba(0,240,255,.2)}
       button.quit{border-color:rgba(255,107,129,.4);background:rgba(255,107,129,.08);color:#ff9aa8}
     </style></head>
     <body><div class="card"><h1>${title}</h1><p>${sub}</p>${detail}${buttons}</div></body></html>`
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
  logEvent('info', 'shutdown', { pid });
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
    try {
      backendLog = createBackendLogger(app.getPath('userData'));
      logEvent('info', 'app_start', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform });
    } catch { /* logging is best-effort */ }
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

    // Backend diagnostics controls (used by the startup-failure screen).
    ipcMain.handle('akansha:retry-backend', () => { logEvent('info', 'retry', {}); killBackend(); startBackend(); return { ok: true }; });
    ipcMain.handle('akansha:open-backend-logs', async () => {
      try { const p = backendLog ? backendLog.getLogPath() : ''; const err = await shell.openPath(p); return { ok: !err, path: p, error: err || null }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    ipcMain.handle('akansha:copy-backend-diagnostic', () => {
      try { clipboard.writeText(backendLog ? backendLog.diagnosticReport() : 'No diagnostic log available.'); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });

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
