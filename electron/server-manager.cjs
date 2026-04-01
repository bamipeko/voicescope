const { spawn } = require('child_process');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let serverProcess = null;

/**
 * Start the Express server as a child process.
 * Uses spawn instead of fork to work with asar-packed apps.
 */
async function startServer() {
  const port = 5100;

  // Determine paths
  const isPackaged = app.isPackaged;

  // In packaged app, files are in app.asar but we use asarUnpack for server/
  // so the actual path is app.asar.unpacked/server/
  let appPath;
  if (isPackaged) {
    // Try unpacked path first (asarUnpack), fall back to asar path
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked');
    const asarPath = path.join(process.resourcesPath, 'app.asar');
    appPath = fs.existsSync(path.join(unpackedPath, 'server')) ? unpackedPath : asarPath;
  } else {
    appPath = path.join(__dirname, '..');
  }

  const serverEntry = path.join(appPath, 'server', 'index.js');
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

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[Server] ${msg}`);
    });

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error(`[Server:err] ${msg}`);
        stderrBuffer += msg + '\n';
      }
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
