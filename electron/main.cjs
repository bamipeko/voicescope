const { app, BrowserWindow, ipcMain, globalShortcut, session, dialog } = require('electron');
const path = require('path');
const { startServer, stopServer } = require('./server-manager.cjs');
const { initStore } = require('./store-manager.cjs');
const { createTray, destroyTray, setRecordingState } = require('./tray-manager.cjs');

// Disable GPU sandbox (fixes issues on some environments)
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let serverPort = 5100;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'VoiceScope',
    backgroundColor: '#111827',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false, // Don't show until ready
  });

  // Show loading page first, then load app when server is confirmed
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Retry loading if server isn't ready yet
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`[Electron] Page load failed (${errorCode}), retrying in 1s...`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`http://localhost:${serverPort}`);
      }
    }, 1000);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Minimize to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// Handle desktopCapturer for system audio (no dialog)
function setupAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    callback({ audio: 'loopback' });
  });
}

// IPC handlers
function setupIPC() {
  ipcMain.handle('store:get', (event, key) => {
    const Store = require('./store-manager.cjs');
    return Store.get(key);
  });

  ipcMain.handle('store:set', (event, key, value) => {
    const Store = require('./store-manager.cjs');
    Store.set(key, value);
  });

  ipcMain.handle('app:isElectron', () => true);

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataPath: app.getPath('userData'),
  }));

  ipcMain.on('recording:start', () => {
    setRecordingState(true);
  });

  ipcMain.on('recording:stop', () => {
    setRecordingState(false);
  });

  ipcMain.on('window:show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Global shortcuts
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (mainWindow) {
      mainWindow.webContents.send('shortcut:toggle-recording');
      mainWindow.show();
    }
  });
}

app.whenReady().then(async () => {
  // Initialize electron-store
  initStore();

  // Setup IPC before window creation
  setupAudioCapture();
  setupIPC();

  // Start embedded Express server
  try {
    serverPort = await startServer();
    console.log(`[Electron] Server started on port ${serverPort}`);
  } catch (err) {
    console.error('[Electron] Server failed to start:', err);
    dialog.showErrorBox(
      'VoiceScope - サーバー起動エラー',
      `サーバーの起動に失敗しました。\n\n${err.message}\n\nアプリを再インストールしてください。`
    );
    app.quit();
    return;
  }

  // Create window and tray
  createWindow();
  createTray(mainWindow);
  registerShortcuts();
});

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyTray();
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running in tray on Windows
  }
});
