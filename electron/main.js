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

const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const { spawn, exec } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;
const APP_PATH = isDev ? app.getAppPath() : path.join(process.resourcesPath, 'app');

/** Backend lifecycle state, mirrored to the renderer through the preload bridge. */
let lifecycle = 'STARTING';
let serverProcess = null;
let mainWindow = null;
let quitting = false;
let serverPort = 0;

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
  return `http://127.0.0.1:${serverPort}/`;
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

// ── Single instance ────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'Akansha', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit' }] },
        { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      ])
    );

    ipcMain.handle('akansha:lifecycle', () => ({ state: lifecycle, port: serverPort }));

    createWindow();
    startBackend();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    killBackend();
  });

  process.on('exit', killBackend);
}
