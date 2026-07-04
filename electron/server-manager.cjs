const { spawn, execSync } = require('child_process');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

let serverProcess = null;

/**
 * Start the Express server as a child process.
 * Uses spawn instead of fork to work with asar-packed apps.
 */
/**
 * Kill any existing process on the given port (Windows only).
 */
function killProcessOnPort(port) {
  // Validate port is a safe integer to prevent command injection
  const portNum = parseInt(port, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return;

  try {
    const result = execSync(`netstat -ano | findstr :${portNum} | findstr LISTENING`, { encoding: 'utf-8' });
    const lines = result.trim().split('\n');
    for (const line of lines) {
      const pid = line.trim().split(/\s+/).pop();
      // Validate PID is numeric only
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          console.log(`[ServerManager] Killed existing process on port ${portNum} (PID ${pid})`);
        } catch (e) {
          // Process may have already exited
        }
      }
    }
  } catch (e) {
    // No process on port, that's fine
  }
}

/**
 * Check if a port is available.
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port);
  });
}

async function startServer(options = {}) {
  const port = 5100;

  // Kill any leftover process from a previous crash
  const available = await isPortAvailable(port);
  if (!available) {
    console.log(`[ServerManager] Port ${port} in use, killing existing process...`);
    killProcessOnPort(port);
    // Wait a moment for port to free up
    await new Promise(r => setTimeout(r, 1000));
  }

  // Determine paths
  const isPackaged = app.isPackaged;

  // With asar enabled, unpacked files are at resources/app.asar.unpacked/
  const appPath = isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.join(__dirname, '..');

  // Use CJS wrapper in packaged mode (ELECTRON_RUN_AS_NODE doesn't respect "type": "module")
  const serverEntry = isPackaged
    ? path.join(appPath, 'server', 'start.cjs')
    : path.join(appPath, 'server', 'index.js');
  const dataDir = path.join(app.getPath('userData'), 'data');

  console.log(`[ServerManager] isPackaged: ${isPackaged}`);
  console.log(`[ServerManager] appPath: ${appPath}`);
  console.log(`[ServerManager] serverEntry: ${serverEntry}`);
  console.log(`[ServerManager] dataDir: ${dataDir}`);
  console.log(`[ServerManager] serverEntry exists: ${fs.existsSync(serverEntry)}`);

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const audioDir = path.join(dataDir, 'audio');
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }

  // Build env for the server process
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    NODE_ENV: isPackaged ? 'production' : 'development',
    ELECTRON_MODE: '1',
  };

  // Try to add ffmpeg-static to PATH if available
  try {
    let ffmpegDir;
    if (isPackaged) {
      ffmpegDir = path.join(process.resourcesPath, 'ffmpeg');
    } else {
      ffmpegDir = path.dirname(require.resolve('ffmpeg-static'));
    }
    if (fs.existsSync(ffmpegDir)) {
      env.PATH = ffmpegDir + path.delimiter + (env.PATH || '');
    }
  } catch (e) {
    // ffmpeg-static not available, rely on system ffmpeg
  }

  // Load API keys from electron-store and inject as env vars.
  // Track which keys came from the store (vs external env) so the UI can
  // distinguish "user entered via Settings" from "auto-detected from shell env".
  try {
    const { get } = require('./store-manager.cjs');
    const keys = ['DEEPGRAM_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROK_API_KEY', 'ANTHROPIC_API_KEY'];
    const storeInjected = [];
    for (const key of keys) {
      const val = get(key);
      if (val) {
        env[key] = val;
        storeInjected.push(key);
      }
    }
    env.VOICESCOPE_STORE_INJECTED_KEYS = storeInjected.join(',');
    const exportPath = get('exportAudioPath');
    if (exportPath) env.EXPORT_AUDIO_PATH = exportPath;
    const exportInfographicPath = get('exportInfographicPath');
    if (exportInfographicPath) env.EXPORT_INFOGRAPHIC_PATH = exportInfographicPath;
  } catch (e) {
    console.warn('[ServerManager] Could not load store keys:', e.message);
  }

  // Inject API token for request authentication
  if (options.apiToken) {
    env.VOICESCOPE_API_TOKEN = options.apiToken;
  }

  // Find Node.js executable
  // In packaged Electron, process.execPath is the Electron executable
  // We need to use the bundled Node.js or system Node
  const nodeExe = isPackaged
    ? process.execPath  // Electron itself can run JS via child_process
    : process.execPath; // In dev, this is node

  return new Promise((resolve, reject) => {
    // Use spawn with node to execute the ESM server
    // Electron's bundled node supports ESM
    if (isPackaged) {
      // In packaged mode, use Electron's node by setting ELECTRON_RUN_AS_NODE
      serverProcess = spawn(process.execPath, [serverEntry], {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } else {
      // In dev mode, use system node
      serverProcess = spawn('node', [serverEntry], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    }

    let stderrBuffer = '';

    // Persist server stdout/stderr to a file the user can actually open.
    // %APPDATA%\VoiceScope\logs\server-YYYY-MM-DD.log
    let logStream = null;
    try {
      const userData = app.getPath('userData');
      const logsDir = path.join(userData, 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const logPath = path.join(logsDir, `server-${today}.log`);
      logStream = fs.createWriteStream(logPath, { flags: 'a' });
      logStream.write(`\n========== Session start: ${new Date().toISOString()} ==========\n`);
      console.log(`[ServerManager] Logging server output to ${logPath}`);
    } catch (e) {
      console.warn('[ServerManager] Could not open log file:', e.message);
    }

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.trim()) console.log(`[Server] ${msg.trim()}`);
      if (logStream) logStream.write(msg);
    });

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.trim()) {
        console.error(`[Server:err] ${msg.trim()}`);
        stderrBuffer += msg.trim() + '\n';
      }
      if (logStream) logStream.write(`[STDERR] ${msg}`);
    });

    serverProcess.on('error', (err) => {
      console.error('[ServerManager] Failed to spawn server:', err);
      reject(new Error(`Server spawn failed: ${err.message}`));
    });

    serverProcess.on('exit', (code) => {
      console.log(`[ServerManager] Server exited with code ${code}`);
      if (!resolved && code !== 0) {
        reject(new Error(`Server crashed (exit code ${code})\n${stderrBuffer}`));
      }
      serverProcess = null;
    });

    // Wait for server to report ready, or timeout
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Even if we didn't see the "Server running" message, resolve anyway
        // The retry logic in main.cjs will handle connection failures
        console.log('[ServerManager] Timeout waiting for server ready signal, proceeding anyway');
        resolve(port);
      }
    }, 8000);

    serverProcess.stdout.on('data', (data) => {
      if (!resolved && data.toString().includes('Server running')) {
        resolved = true;
        clearTimeout(timeout);
        resolve(port);
      }
    });
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

module.exports = { startServer, stopServer };
