// ============================================================
//  AKANSHA — Electron Desktop Shell
//  Runs the Next.js production server and shows the app window.
// ============================================================
const { app, BrowserWindow, shell, Menu, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.AKANSHA_PORT || 3000;
const isDev = !app.isPackaged;
let serverProcess = null;
let mainWindow = null;

function startServer() {
  if (isDev) return;
  const serverPath = path.join(process.resourcesPath, 'app');
  serverProcess = spawn(process.execPath, [path.join(serverPath, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], {
    cwd: serverPath,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: 'pipe',
  });
  serverProcess.stdout.on('data', (d) => console.log(`[akansha] ${d}`));
  serverProcess.stderr.on('data', (d) => console.error(`[akansha] ${d}`));
}

function createWindow() {
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#010208',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the system browser, not the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://localhost:${PORT}`) || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const load = () => mainWindow.loadURL(`http://localhost:${PORT}`);

  if (isDev) {
    load();
  } else {
    // Poll until the Next.js server is accepting connections
    const tryLoad = (attempt) => {
      if (attempt > 60) return load();
      const http = require('http');
      http
        .get(`http://localhost:${PORT}/api/health`, (res) => {
          if (res.statusCode === 200) return load();
          setTimeout(() => tryLoad(attempt + 1), 500);
        })
        .on('error', () => setTimeout(() => tryLoad(attempt + 1), 500));
    };
    tryLoad(0);
  }
}

const template = [
  {
    label: 'Akansha',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  {
    label: 'View',
    submenu: [
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
];

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
