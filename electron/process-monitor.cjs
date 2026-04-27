const { exec } = require('child_process');
const discordRpc = require('./discord-rpc.cjs');

// Known meeting app process names (Windows)
const MEETING_APPS = [
  { name: 'Zoom', processes: ['Zoom.exe', 'ZoomIT.exe'] },
  { name: 'Microsoft Teams', processes: ['ms-teams.exe', 'Teams.exe'] },
  { name: 'Webex', processes: ['CiscoCollabHost.exe', 'webexmta.exe'] },
];

let monitorInterval = null;
let meetInterval = null;
let discordInterval = null;
let detectedApps = new Set();
let onAppDetected = null;
let onAppClosed = null;
let discordConnected = false;

/**
 * Check running processes for meeting apps.
 * Uses lightweight tasklist (no /v) for process-based detection.
 * Windows only.
 */
function checkProcesses() {
  if (process.platform !== 'win32') return;

  // Lightweight: no /v flag — only process names, no WMI window title queries
  exec('tasklist /FO CSV /NH', { maxBuffer: 1024 * 1024 * 2 }, (err, stdout) => {
    if (err) return;

    const lines = stdout.split('\n').filter(Boolean);
    const runningProcesses = new Set();

    for (const line of lines) {
      const match = line.match(/^"([^"]+)"/);
      if (match) runningProcesses.add(match[1]);
    }

    const currentlyDetected = new Set();

    // Process-based detection (Zoom, Teams, Webex)
    for (const app of MEETING_APPS) {
      const isRunning = app.processes.some(p => runningProcesses.has(p));
      if (isRunning) {
        currentlyDetected.add(app.name);
      }
    }

    // Merge with Google Meet state (checked separately)
    if (meetActive) {
      currentlyDetected.add('Google Meet');
    }

    // Detect newly appeared apps
    for (const appName of currentlyDetected) {
      if (!detectedApps.has(appName)) {
        console.log(`[ProcessMonitor] Detected: ${appName}`);
        if (onAppDetected) onAppDetected(appName);
      }
    }

    // Detect closed apps (not Discord — handled by RPC)
    for (const appName of detectedApps) {
      if (appName === 'Discord (Voice)') continue;
      if (!currentlyDetected.has(appName)) {
        console.log(`[ProcessMonitor] Closed: ${appName}`);
        if (onAppClosed) onAppClosed(appName);
      }
    }

    // Update set (preserve Discord state)
    const discordInSet = detectedApps.has('Discord (Voice)');
    detectedApps = currentlyDetected;
    if (discordInSet) detectedApps.add('Discord (Voice)');
  });
}

/**
 * Check Google Meet via browser window title.
 * Targeted: filters to the user's selected browser only (single lightweight call).
 * Configurable via meetBrowser option.
 */
const BROWSER_MAP = {
  chrome: 'chrome.exe',
  brave: 'brave.exe',
  edge: 'msedge.exe',
  firefox: 'firefox.exe',
};
let meetActive = false;
let meetBrowserExe = ''; // set by startMonitoring

function checkGoogleMeet() {
  if (process.platform !== 'win32' || !meetBrowserExe) return;

  // Validate meetBrowserExe is from our whitelist (defense in depth)
  if (!Object.values(BROWSER_MAP).includes(meetBrowserExe)) return;
  exec(`tasklist /v /FI "IMAGENAME eq ${meetBrowserExe}" /FO CSV /NH`, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err) { meetActive = false; return; }
    meetActive = stdout.split('\n').some(line => /Google Meet/i.test(line));
  });
}

/**
 * Check Discord voice channel via local RPC.
 */
async function checkDiscordVoice() {
  // Try to connect if not connected
  if (!discordRpc.isConnected()) {
    discordConnected = await discordRpc.connect();
    if (!discordConnected) return; // Discord not running or can't connect
  }

  const wasInVoice = detectedApps.has('Discord (Voice)');
  const inVoice = await discordRpc.checkVoiceChannel();

  if (inVoice && !wasInVoice) {
    const channel = discordRpc.getVoiceChannel();
    console.log(`[ProcessMonitor] Detected: Discord (Voice) — ${channel}`);
    detectedApps.add('Discord (Voice)');
    if (onAppDetected) onAppDetected('Discord (Voice)');
  } else if (!inVoice && wasInVoice) {
    console.log('[ProcessMonitor] Closed: Discord (Voice)');
    detectedApps.delete('Discord (Voice)');
    if (onAppClosed) onAppClosed('Discord (Voice)');
  }
}

/**
 * Start monitoring for meeting apps.
 * @param {Object} callbacks - { onDetected, onClosed }
 * @param {Object} options - { meetBrowser: 'chrome'|'brave'|'edge'|'firefox'|'none' }
 */
function startMonitoring(callbacks = {}, options = {}) {
  onAppDetected = callbacks.onDetected || null;
  onAppClosed = callbacks.onClosed || null;

  // Configure Google Meet browser detection
  const browserKey = options.meetBrowser || 'chrome';
  meetBrowserExe = BROWSER_MAP[browserKey] || '';
  if (browserKey === 'none') meetBrowserExe = '';

  // Initial checks
  checkProcesses();
  if (meetBrowserExe) checkGoogleMeet();

  // Process check every 30s (lightweight, no WMI)
  monitorInterval = setInterval(checkProcesses, 30000);

  // Google Meet check every 30s (single targeted browser)
  if (meetBrowserExe) {
    meetInterval = setInterval(checkGoogleMeet, 30000);
  }

  // Discord voice check every 30s
  checkDiscordVoice();
  discordInterval = setInterval(checkDiscordVoice, 30000);

  console.log(`[ProcessMonitor] Started (process: 30s, meet: ${meetBrowserExe || 'disabled'} 30s, discord: 30s)`);
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (meetInterval) {
    clearInterval(meetInterval);
    meetInterval = null;
  }
  if (discordInterval) {
    clearInterval(discordInterval);
    discordInterval = null;
  }
  discordRpc.disconnect();
  detectedApps.clear();
  console.log('[ProcessMonitor] Stopped');
}

function getDetectedApps() {
  return Array.from(detectedApps);
}

module.exports = { startMonitoring, stopMonitoring, getDetectedApps };
