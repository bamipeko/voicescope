const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Check if running in Electron
  isElectron: true,

  // App info
  getInfo: () => ipcRenderer.invoke('app:info'),
  // API token for authenticating requests to embedded server
  getApiToken: () => ipcRenderer.invoke('app:getApiToken'),

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

  // Listen for highlight shortcut
  onMarkHighlight: (callback) => {
    ipcRenderer.on('shortcut:mark-highlight', callback);
    return () => ipcRenderer.removeListener('shortcut:mark-highlight', callback);
  },

  // Show main window
  showWindow: () => ipcRenderer.send('window:show'),

  // Update checker
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  openReleasePage: (url) => ipcRenderer.invoke('app:openReleasePage', url),

  // Meeting auto-record setting
  getMeetingAutoRecord: () => ipcRenderer.invoke('meeting:getAutoRecord'),
  setMeetingAutoRecord: (enabled) => ipcRenderer.invoke('meeting:setAutoRecord', enabled),

  // Meet browser setting
  getMeetBrowser: () => ipcRenderer.invoke('meeting:getBrowser'),
  setMeetBrowser: (browser) => ipcRenderer.invoke('meeting:setBrowser', browser),

  // Directory picker dialog
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),

  // Meeting app detection
  onMeetingDetected: (callback) => {
    const handler = (event, appName) => callback(appName);
    ipcRenderer.on('meeting:detected', handler);
    return () => ipcRenderer.removeListener('meeting:detected', handler);
  },
  onMeetingClosed: (callback) => {
    const handler = (event, appName) => callback(appName);
    ipcRenderer.on('meeting:closed', handler);
    return () => ipcRenderer.removeListener('meeting:closed', handler);
  },
});
