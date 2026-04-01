const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Check if running in Electron
  isElectron: true,

  // App info
  getInfo: () => ipcRenderer.invoke('app:info'),

  // Electron store (for API keys in desktop mode)
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),

  // Recording state notifications (for tray icon)
  notifyRecordingStart: () => ipcRenderer.send('recording:start'),
  notifyRecordingStop: () => ipcRenderer.send('recording:stop'),

  // Listen for global shortcut toggle
  onToggleRecording: (callback) => {
    ipcRenderer.on('shortcut:toggle-recording', callback);
    return () => ipcRenderer.removeListener('shortcut:toggle-recording', callback);
  },

  // Show main window
  showWindow: () => ipcRenderer.send('window:show'),
});
