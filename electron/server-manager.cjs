const { fork } = require('child_process');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let serverProcess = null;

/**
 * Start the Express server as a child process.
 * In production (packaged), serves the built client.
 * Sets DATA_DIR to Electron userData for persistent storage.
 */
async function startServer() {
  const port = 5100;

  // Determine paths
  const isPackaged = app.isPackaged;
  const appPath = isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..');

  const serverEntry = path.join(appPath, 'server', 'index.js');
  const dataDir = path.join(app.getPath('userData'), 'data');

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
    const ffmpegPath = isPackaged
      ? path.join(process.resourcesPath, 'ffmpeg')
      : path.dirname(require.resolve('ffmpeg-static'));
    if (fs.existsSync(ffmpegPath)) {
      env.PATH = ffmpegPath + path.delimiter + (env.PATH || '');
    }
  } catch (e) {
    // ffmpeg-static not available, rely on system ffmpeg
  }

  // Load API keys from electron-store and inject as env vars
  try {
    const { get } = require('./store-manager.cjs');
    const keys = ['DEEPGRAM_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROK_API_KEY'];
    for (const key of keys) {
      const val = get(key);
      if (val) env[key] = val;
    }
  } catch (e) {
    console.warn('[ServerManager] Could not load store keys:', e.message);
  }

  return new Promise((resolve, reject) => {
    serverProcess = fork(serverEntry, [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`[Server] ${data.toString().trim()}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server] ${data.toString().trim()}`);
    });

    serverProcess.on('error', (err) => {
      console.error('[ServerManager] Failed to start server:', err);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`[ServerManager] Server exited with code ${code}`);
      serverProcess = null;
    });

    // Wait a bit for server to start, then resolve
    // In production, the server logs "Server running on port ..."
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(port);
      }
    }, 3000);

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
