'use strict';

const { app, BrowserWindow, shell, desktopCapturer, ipcMain, session } = require('electron');
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

// ─── Start Production Server (vite preview) ─────────────────────────────────
// vite preview serves the built output AND runs configurePreviewServer
// which attaches all /api/* routes (signal, token, ip, input).
function startProductionServer() {
  return new Promise((resolve, reject) => {
    console.log('[Rein] Starting production server via vite preview on port', serverPort);

    const isWin = process.platform === 'win32';

    // Use shell:true — required on Windows for npx/npm scripts, harmless on macOS/Linux
    serverProcess = spawn(
      'npx',
      ['vite', 'preview', '--host', '--port', String(serverPort)],
      {
        stdio: 'ignore',
        windowsHide: true,
        shell: true,
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'production' },
      }
    );

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
      preload: path.join(__dirname, 'main-preload.cjs'),
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

  // ── Screen Capture Handler (Interactive Source Picker) ──
  // Use session.defaultSession for global coverage across all windows and subframes.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    console.log('[Electron] Display media request received at defaultSession level');
    // Create a small selection window
    let pickerWindow = new BrowserWindow({
      width: 500,
      height: 600,
      parent: mainWindow,
      modal: true,
      title: 'Choose what to share',
      backgroundColor: '#1a1a2e',
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    });

    // Handle source selection from the picker window
    ipcMain.once('source-selected', (event, sourceId) => {
      if (pickerWindow) {
        pickerWindow.close();
        pickerWindow = null;
      }

      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        const selectedSource = sources.find(s => s.id === sourceId);
        if (selectedSource) {
          callback({ video: selectedSource, audio: 'loopback' });
        } else {
          callback({});
        }
      });
    });

    // Handle request for sources from the picker window
    ipcMain.handleOnce('get-sources', async () => {
      const sources = await desktopCapturer.getSources({ 
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });
      
      return sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL()
      }));
    });

    pickerWindow.loadFile(path.join(__dirname, 'picker.html'));
    
    pickerWindow.on('closed', () => {
      ipcMain.removeHandler('get-sources');
      // If closed without selection, callback with empty to cancel
      if (pickerWindow) callback({});
    });
  });

  // ── Source Picker IPC Handler (for direct React API calls) ──
  ipcMain.handle('show-source-picker', async () => {
    return new Promise((resolve) => {
      let pickerWindow = new BrowserWindow({
        width: 500,
        height: 600,
        parent: mainWindow,
        modal: true,
        title: 'Choose what to share',
        backgroundColor: '#1a1a2e',
        webPreferences: {
          preload: path.join(__dirname, 'picker-preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
        }
      });

      // Handle source selection
      ipcMain.once('source-selected', (event, sourceId) => {
        if (pickerWindow) {
          pickerWindow.close();
          pickerWindow = null;
          resolve(sourceId);
        }
      });

      // Provide sources to the picker window
      ipcMain.handleOnce('get-sources-internal', async () => {
        const sources = await desktopCapturer.getSources({ 
          types: ['window', 'screen'],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true
        });
        return sources.map(s => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.toDataURL()
        }));
      });

      pickerWindow.loadFile(path.join(__dirname, 'picker.html'));

      pickerWindow.on('closed', () => {
        ipcMain.removeHandler('get-sources-internal');
        if (pickerWindow) {
          pickerWindow = null;
          resolve(null);
        }
      });
    });
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