'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────
let serverPort = 3000;
let serverHost = '0.0.0.0';

try {
  // In production, __dirname = app.asar/electron/ — config lives alongside
  const configPath = path.join(__dirname, '..', 'src', 'server-config.json');
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (typeof cfg.frontendPort === 'number') serverPort = cfg.frontendPort;
    if (typeof cfg.host === 'string') serverHost = cfg.host;
  }
} catch (e) {
  console.warn('[Rein] Could not read server-config.json:', e.message);
}

// ─── Mode Detection ─────────────────────────────────────────────────────────
// Set via the electron-dev npm script using cross-env
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';
const IS_DEV = !!DEV_SERVER_URL;

// ─── State ──────────────────────────────────────────────────────────────────
let mainWindow = null;
let serverProcess = null;

// ─── Single Instance Lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ─── Wait for HTTP server ────────────────────────────────────────────────────
function waitForServer(port, retries = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}`, () => {
        req.destroy();
        resolve();
      });
      req.on('error', () => {
        if (++attempts >= retries) {
          reject(new Error(`Server on port ${port} did not start after ${retries} retries`));
          return;
        }
        setTimeout(check, 500);
      });
      req.end();
    };
    check();
  });
}

// ─── Start Production Nitro Server ──────────────────────────────────────────
function resolveServerPath() {
  // Packaged production: resources/app.asar.unpacked/.output/server/index.mjs
  // OR resources/.output/server/index.mjs (extraResources)
  const candidates = [
    path.join(process.resourcesPath, 'app.asar.unpacked', '.output', 'server', 'index.mjs'),
    path.join(process.resourcesPath, '.output', 'server', 'index.mjs'),
    // Dev fallback (running `npm run electron` without packaging)
    path.join(__dirname, '..', '.output', 'server', 'index.mjs'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function startProductionServer() {
  return new Promise((resolve, reject) => {
    const serverPath = resolveServerPath();
    if (!serverPath) {
      reject(new Error('Could not find .output/server/index.mjs — run `npm run build` first'));
      return;
    }

    console.log('[Rein] Starting production server:', serverPath);

    serverProcess = spawn(process.execPath, [serverPath], {
      stdio: IS_DEV ? 'inherit' : 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        HOST: serverHost,
        PORT: String(serverPort),
        NODE_ENV: 'production',
      },
    });

    serverProcess.on('error', (err) => {
      console.error('[Rein] Server process error:', err);
      reject(err);
    });

    waitForServer(serverPort).then(resolve).catch(reject);
  });
}

// ─── Create Window ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Rein',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Allow camera / mic / screen capture
      experimentalFeatures: true,
    },
  });

  const url = IS_DEV
    ? `${DEV_SERVER_URL}/settings`
    : `http://127.0.0.1:${serverPort}/settings`;

  console.log('[Rein] Loading URL:', url);
  mainWindow.loadURL(url);

  // Open DevTools in dev mode only
  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (openUrl.startsWith('http')) {
      shell.openExternal(openUrl);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[Rein] Page failed to load:', code, desc, url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    if (IS_DEV) {
      // Dev mode: Vite serves both the frontend and API — just wait for it
      console.log('[Rein] Dev mode — waiting for Vite server on port', serverPort);
      await waitForServer(serverPort);
    } else {
      // Production mode: spawn Nitro server, then open window
      await startProductionServer();
    }
    createWindow();
  } catch (err) {
    console.error('[Rein] Startup failed:', err);
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked and no windows are open
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  // On macOS keep the app running until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});