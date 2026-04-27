const { app, BrowserWindow, ipcMain, globalShortcut, session, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Startup debug log (written to userData for packaged app diagnosis)
const LOG_PATH = path.join(app.getPath('userData'), 'startup.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
  console.log(msg);
}
log('=== VoiceScope starting ===');

const { startServer, stopServer } = require('./server-manager.cjs');
log('loaded server-manager');
const { initStore } = require('./store-manager.cjs');
log('loaded store-manager');
const { createTray, destroyTray, setRecordingState, updateMainWindowRef } = require('./tray-manager.cjs');
log('loaded tray-manager');
const { startMonitoring, stopMonitoring } = require('./process-monitor.cjs');
log('loaded process-monitor');
const { checkForUpdates, openReleasePage } = require('./update-checker.cjs');
log('loaded update-checker');

// Disable GPU sandbox (required for rendering on many Windows environments)
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let serverPort = 5100;
// Tracks whether a recording is currently in progress (set via IPC from renderer).
// Used to show a confirmation dialog when the user tries to close the window.
let isRecording = false;
// Generate a random API token per session (never persisted, never logged)
const apiToken = crypto.randomBytes(32).toString('hex');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'VoiceScope',
    backgroundColor: '#393939',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false, // Show after content is ready
  });

  // Server is already running at this point — load the app directly
  const appUrl = `http://localhost:${serverPort}`;
  log(`loading app URL: ${appUrl}`);
  mainWindow.loadURL(appUrl);

  // Show window after page fully loads, then verify React actually rendered
  let reloadAttempted = false;
  mainWindow.webContents.on('did-finish-load', async () => {
    // Show the window after a brief delay
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.show();
        log('window shown (did-finish-load)');
      }
    }, 300);

    // After 2s, check if React has rendered content. If not, force reload once.
    setTimeout(async () => {
      if (!mainWindow || reloadAttempted) return;
      try {
        const hasContent = await mainWindow.webContents.executeJavaScript(
          `document.querySelector('#root')?.children.length > 0`
        );
        if (!hasContent) {
          log('React not mounted after 2s, force reloading (cache bypass)');
          reloadAttempted = true;
          mainWindow.webContents.reloadIgnoringCache();
        } else {
          log('React mounted successfully');
        }
      } catch (e) {
        log(`render check failed: ${e.message}`);
      }
    }, 2000);
  });

  // Fallback: show after 6s even if did-finish-load didn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      log('window shown (timeout fallback)');
    }
  }, 6000);

  // Retry load if it fails (e.g., server not fully ready for static files)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log(`did-fail-load: ${errorCode} ${errorDescription}, retrying in 1s...`);
    setTimeout(() => {
      if (mainWindow) mainWindow.loadURL(appUrl);
    }, 1000);
  });

  // F12 to toggle DevTools (only in dev mode or with --dev flag)
  const devMode = !app.isPackaged || process.argv.includes('--dev');
  if (devMode) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') {
        mainWindow.webContents.toggleDevTools();
      }
    });
  }

  // Prevent navigation to external sites (e.g., links in LLM-generated markdown)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/;
    if (!allowed.test(url) && !url.startsWith('file://')) {
      event.preventDefault();
      // Open external links in default browser
      require('electron').shell.openExternal(url);
    }
  });

  // Block new window creation (target="_blank" links, window.open)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // When minimized during recording, also send a Windows toast (not intrusive)
  // so users know the app is still running in the tray.
  let minimizeNoticeShown = false;
  mainWindow.on('minimize', () => {
    if (!isRecording || minimizeNoticeShown) return;
    minimizeNoticeShown = true;
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        new Notification({
          title: 'VoiceScope — 録音中',
          body: '録音は継続しています。復元はタスクトレイのアイコンから可能です。',
          silent: true,
        }).show();
      }
    } catch {}
  });

  // Guard: block close while a recording is in progress. The user can either
  // stop the recording first, or confirm discard via a dialog.
  mainWindow.on('close', (event) => {
    if (!isRecording || app.isQuitting) return;
    event.preventDefault();
    const { response } = { response: dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['録音を停止して終了', 'キャンセル（録音を続ける）'],
      defaultId: 1,
      cancelId: 1,
      title: 'VoiceScope',
      message: '録音中です',
      detail: 'ウィンドウを閉じると録音が終了します。バックアップから復元は可能ですが、確実ではありません。どうしますか？',
    }) };
    if (response === 0) {
      // User chose to stop: ask renderer to finalize, then close.
      mainWindow?.webContents.send('shortcut:toggle-recording');
      // Allow the renderer a moment to stop+upload before closing.
      setTimeout(() => {
        isRecording = false;
        mainWindow?.close();
      }, 2500);
    }
    // If cancelled, do nothing — window stays open.
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Tray still has a stale reference — clear it so clicks go through showOrCreateWindow
    try { updateMainWindowRef(null); } catch {}
  });
}

// Show existing window, or re-create it if the user previously closed it.
// Called on second-instance, tray click, and activate.
function showOrCreateWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Order matters on Windows: restore BEFORE show, then z-order hack.
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();

    // Windows z-order bug: without this hack, the window sometimes stays
    // behind other apps even after focus(). Briefly toggling alwaysOnTop
    // forces it to the front. https://github.com/electron/electron/issues/2867
    if (process.platform === 'win32') {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
    }
    // Extra insurance — some systems need a second focus call after z-order change
    mainWindow.focus();
    return;
  }
  log('main window missing — re-creating');
  createWindow();
  try { updateMainWindowRef(mainWindow); } catch {}
}

// Handle desktopCapturer for system audio (no dialog)
function setupAudioCapture() {
  const { desktopCapturer } = require('electron');
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      // Must provide a screen source alongside loopback audio for Electron to
      // properly create audio tracks in the returned MediaStream.
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({ audio: 'loopback' });
      }
    } catch (err) {
      log(`setDisplayMediaRequestHandler error: ${err.message}`);
      callback({ audio: 'loopback' });
    }
  });
}

// Whitelist of keys allowed via IPC store access
const STORE_ALLOWED_KEYS = [
  'DEEPGRAM_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROK_API_KEY', 'ANTHROPIC_API_KEY',
  'windowBounds', 'meetingAutoRecord', 'meetBrowser', 'exportAudioPath', 'disableUpdateCheck',
];

// IPC handlers
function setupIPC() {
  ipcMain.handle('store:get', (event, key) => {
    if (!STORE_ALLOWED_KEYS.includes(key)) return null;
    const Store = require('./store-manager.cjs');
    return Store.get(key);
  });

  ipcMain.handle('store:set', (event, key, value) => {
    if (!STORE_ALLOWED_KEYS.includes(key)) return;
    const Store = require('./store-manager.cjs');
    Store.set(key, value);
  });

  ipcMain.handle('app:isElectron', () => true);

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataPath: app.getPath('userData'),
  }));

  // Expose API token to renderer (for authenticating requests to embedded server)
  ipcMain.handle('app:getApiToken', () => apiToken);

  ipcMain.on('recording:start', () => {
    isRecording = true;
    setRecordingState(true);
  });

  ipcMain.on('recording:stop', () => {
    isRecording = false;
    setRecordingState(false);
  });

  ipcMain.on('window:show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Directory picker dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'エクスポート先フォルダを選択',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Meeting auto-record setting
  ipcMain.handle('meeting:getAutoRecord', () => {
    const Store = require('./store-manager.cjs');
    return Store.get('meetingAutoRecord') || false;
  });

  ipcMain.handle('meeting:setAutoRecord', (event, enabled) => {
    const Store = require('./store-manager.cjs');
    Store.set('meetingAutoRecord', enabled);
    if (enabled) {
      startMeetingMonitor();
    } else {
      stopMonitoring();
    }
  });

  // Update checker
  ipcMain.handle('app:checkForUpdates', () => checkForUpdates());
  ipcMain.handle('app:openReleasePage', (event, url) => openReleasePage(url));

  // Meet browser setting
  ipcMain.handle('meeting:getBrowser', () => {
    const Store = require('./store-manager.cjs');
    return Store.get('meetBrowser') || 'brave';
  });

  ipcMain.handle('meeting:setBrowser', (event, browser) => {
    const Store = require('./store-manager.cjs');
    Store.set('meetBrowser', browser);
    // Restart monitoring if active
    if (Store.get('meetingAutoRecord')) {
      stopMonitoring();
      startMeetingMonitor();
    }
  });
}

// Meeting app monitor
function startMeetingMonitor() {
  const Store = require('./store-manager.cjs');
  const meetBrowser = Store.get('meetBrowser') || 'brave';
  startMonitoring({
    onDetected: (appName) => {
      if (mainWindow) {
        mainWindow.webContents.send('meeting:detected', appName);
      }
    },
    onClosed: (appName) => {
      if (mainWindow) {
        mainWindow.webContents.send('meeting:closed', appName);
      }
    },
  }, { meetBrowser });
}

// Global shortcuts
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+F8', () => {
    showOrCreateWindow();
    if (mainWindow) mainWindow.webContents.send('shortcut:toggle-recording');
  });

  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    if (mainWindow) {
      mainWindow.webContents.send('shortcut:mark-highlight');
    }
  });
}

app.whenReady().then(async () => {
  log('app.whenReady fired');

  // Initialize electron-store
  try {
    initStore();
    log('initStore OK');
  } catch (err) {
    log(`initStore FAILED: ${err.message}\n${err.stack}`);
    dialog.showErrorBox('VoiceScope', `Store init failed: ${err.message}`);
    app.quit();
    return;
  }

  // Clear browser cache if version changed (prevents stale JS/CSS after update)
  try {
    const Store = require('./store-manager.cjs');
    const lastVersion = Store.get('_lastVersion');
    const currentVersion = app.getVersion();
    if (lastVersion !== currentVersion) {
      log(`version changed ${lastVersion} → ${currentVersion}, clearing all caches`);
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({
        storages: ['cachestorage', 'serviceworkers'],
      });
      Store.set('_lastVersion', currentVersion);
      log('cache cleared');
    }
  } catch (e) {
    log(`cache clear failed (non-critical): ${e.message}`);
  }

  // Setup IPC before window creation
  setupAudioCapture();
  log('setupAudioCapture OK');
  setupIPC();
  log('setupIPC OK');

  // Start embedded Express server
  try {
    log('starting server...');
    serverPort = await startServer({ apiToken });
    log(`server started on port ${serverPort}`);
  } catch (err) {
    log(`server FAILED: ${err.message}\n${err.stack}`);
    dialog.showErrorBox(
      'VoiceScope - サーバー起動エラー',
      `サーバーの起動に失敗しました。\n\n${err.message}\n\nアプリを再インストールしてください。`
    );
    app.quit();
    return;
  }

  // Create window and tray
  log('creating window...');
  createWindow();
  log('createWindow OK');
  createTray(mainWindow, showOrCreateWindow);
  log('createTray OK');
  registerShortcuts();
  log('startup complete');

  // Start meeting monitor if enabled
  const Store = require('./store-manager.cjs');
  if (Store.get('meetingAutoRecord')) {
    startMeetingMonitor();
  }
});

app.on('second-instance', () => {
  log('second-instance event — showing/recreating window');
  showOrCreateWindow();
});

app.on('activate', () => {
  showOrCreateWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopMonitoring();
  destroyTray();
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running in tray on Windows
  }
});
