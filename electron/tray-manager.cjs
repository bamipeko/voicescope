const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let mainWindowRef = null;
let isRecording = false;

function createTray(mainWindow) {
  mainWindowRef = mainWindow;

  // Create a simple tray icon (16x16 for Windows)
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  // Fallback: create a simple icon if file doesn't exist
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch (e) {
    // Create a minimal 16x16 icon
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('VoiceScope');
  updateContextMenu();

  tray.on('click', () => {
    if (mainWindowRef) {
      mainWindowRef.show();
      mainWindowRef.focus();
    }
  });
}

function updateContextMenu() {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    {
      label: 'VoiceScope を開く',
      click: () => {
        if (mainWindowRef) {
          mainWindowRef.show();
          mainWindowRef.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: isRecording ? '■ 録音停止 (Ctrl+Shift+R)' : '● 録音開始 (Ctrl+Shift+R)',
      click: () => {
        if (mainWindowRef) {
          mainWindowRef.webContents.send('shortcut:toggle-recording');
          mainWindowRef.show();
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
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray, setRecordingState };
