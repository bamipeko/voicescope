const { exec } = require('child_process');

// Known meeting app process names (Windows)
const MEETING_APPS = [
  { name: 'Zoom', processes: ['Zoom.exe', 'ZoomIT.exe'] },
  { name: 'Microsoft Teams', processes: ['ms-teams.exe', 'Teams.exe'] },
  { name: 'Google Meet', processes: ['chrome.exe'] }, // Chrome-based, harder to detect
  { name: 'Discord', processes: ['Discord.exe'] },
  { name: 'Slack', processes: ['slack.exe'] },
  { name: 'Webex', processes: ['CiscoCollabHost.exe', 'webexmta.exe'] },
];

let monitorInterval = null;
let detectedApps = new Set();
let onAppDetected = null;
let onAppClosed = null;

/**
 * Check running processes for meeting apps.
 * Windows only — uses tasklist.exe.
 */
function checkProcesses() {
  if (process.platform !== 'win32') return;

  exec('tasklist /FO CSV /NH', { maxBuffer: 1024 * 1024 * 5 }, (err, stdout) => {
    if (err) return;

    const runningProcesses = new Set(
      stdout.split('\n')
        .map(line => {
          const match = line.match(/^"([^"]+)"/);
          return match ? match[1] : null;
        })
        .filter(Boolean)
    );

    const currentlyDetected = new Set();

    for (const app of MEETING_APPS) {
      // Skip Chrome (too generic for Google Meet detection)
      if (app.name === 'Google Meet') continue;

      const isRunning = app.processes.some(p => runningProcesses.has(p));
      if (isRunning) {
        currentlyDetected.add(app.name);

        // Newly detected
        if (!detectedApps.has(app.name)) {
          console.log(`[ProcessMonitor] Detected: ${app.name}`);
          if (onAppDetected) onAppDetected(app.name);
        }
      }
    }

    // Check for closed apps
    for (const appName of detectedApps) {
      if (!currentlyDetected.has(appName)) {
        console.log(`[ProcessMonitor] Closed: ${appName}`);
        if (onAppClosed) onAppClosed(appName);
      }
    }

    detectedApps = currentlyDetected;
  });
}

/**
 * Start monitoring for meeting apps.
 * @param {Object} callbacks - { onDetected, onClosed }
 * @param {number} intervalMs - Check interval (default 5000ms)
 */
function startMonitoring(callbacks = {}, intervalMs = 5000) {
  onAppDetected = callbacks.onDetected || null;
  onAppClosed = callbacks.onClosed || null;

  // Initial check
  checkProcesses();

  // Periodic check
  monitorInterval = setInterval(checkProcesses, intervalMs);
  console.log(`[ProcessMonitor] Started (interval: ${intervalMs}ms)`);
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  detectedApps.clear();
  console.log('[ProcessMonitor] Stopped');
}

function getDetectedApps() {
  return Array.from(detectedApps);
}

module.exports = { startMonitoring, stopMonitoring, getDetectedApps };
