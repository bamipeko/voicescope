const { app, BrowserWindow, ipcMain, globalShortcut, session } = require('electron');
const path = require('path');
const { startServer, stopServer } = require('./server-manager.cjs');
const { initStore } = require('./store-manager.cjs');
const { createTray, destroyTray, setRecordingState } = require('./tray-manager.cjs');

// Disable GPU if running over network drive or in headless environments
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
    // Dark title bar on Windows
    titleBarStyle: 'default',
    autoHideMenuBar: true,
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

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
  // Allow getDisplayMedia to capture system audio without picker dialog
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Grant system audio loopback automatically
    callback({ audio: 'loopback' });
  });
}

// IPC handlers
function setupIPC() {
  // Get stored settings (API keys, preferences)
  ipcMain.handle('store:get', (event, key) => {
    const Store = require('./store-manager.cjs');
    return Store.get(key);
  });

  ipcMain.handle('store:set', (event, key, value) => {
    const Store = require('./store-manager.cjs');
    Store.set(key, value);
  });

  // Check if running in Electron
  ipcMain.handle('app:isElectron', () => true);

  // Get app info
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataPath: app.getPath('userData'),
  }));

  // Recording state for tray icon
  ipcMain.on('recording:start', () => {
    setRecordingState(true);
  });

  ipcMain.on('recording:stop', () => {
    setRecordingState(false);
  });

  // Show window
  ipcMain.on('window:show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Global shortcuts
function registerShortcuts() {
  // Ctrl+Shift+R to toggle recording
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

  // Start embedded Express server
  serverPort = await startServer();
  console.log(`[Electron] Server started on port ${serverPort}`);

  // Setup
  setupAudioCapture();
  setupIPC();
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
  // Don't quit on macOS (standard behavior)
  if (process.platform !== 'darwin') {
    // On Windows, we keep running in tray
    // app.quit() is only called from tray "Quit"
  }
});
