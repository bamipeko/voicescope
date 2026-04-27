const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let mainWindowRef = null;
let showOrCreateRef = null;
let isRecording = false;

function createTray(mainWindow, showOrCreate) {
  mainWindowRef = mainWindow;
  showOrCreateRef = showOrCreate;

  // Create a simple tray icon (16x16 for Windows)
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch (e) {
    // Generate a 16x16 red circle icon as fallback (PNG with alpha)
    const size = 16;
    const buf = Buffer.alloc(size * size * 4); // RGBA
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - 7.5, dy = y - 7.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * size + x) * 4;
        if (dist <= 6.5) {
          buf[i] = 220; buf[i + 1] = 50; buf[i + 2] = 50; // red
          buf[i + 3] = dist > 5.5 ? Math.round(255 * (6.5 - dist)) : 255; // anti-alias
        }
      }
    }
    icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  }

  tray = new Tray(icon);
  tray.setToolTip('VoiceScope');
  updateContextMenu();

  tray.on('click', () => {
    if (showOrCreateRef) {
      showOrCreateRef();
    } else if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.show();
      mainWindowRef.focus();
    }
  });
}

function updateMainWindowRef(mainWindow) {
  mainWindowRef = mainWindow;
}

function updateContextMenu() {
  if (!tray || tray.isDestroyed()) return;

  const menu = Menu.buildFromTemplate([
    {
      label: 'VoiceScope を開く',
      click: () => {
        if (showOrCreateRef) {
          showOrCreateRef();
        } else if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.show();
          mainWindowRef.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: isRecording ? '■ 録音停止 (Ctrl+Shift+F8)' : '● 録音開始 (Ctrl+Shift+F8)',
      click: () => {
        if (showOrCreateRef) {
          showOrCreateRef();
        }
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.webContents.send('shortcut:toggle-recording');
        }
      },
    },
    { type: 'separator' },
    {
      label: '終了',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(isRecording ? 'VoiceScope (録音中...)' : 'VoiceScope');
}

function setRecordingState(recording) {
  isRecording = recording;
  updateContextMenu();
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}

module.exports = { createTray, destroyTray, setRecordingState, updateMainWindowRef };
