import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Determine the VoiceScope runtime mode.
 * - 'electron'  — launched by Electron main process (exe)
 * - 'docker'    — running inside a Docker container
 * - 'standalone'— launched as a standalone binary (e.g. Mac .app, direct node)
 * - 'dev'       — development (npm run dev)
 */
export function getRuntimeMode() {
  if (process.env.ELECTRON_MODE) return 'electron';
  if (process.env.DOCKER_MODE || fs.existsSync('/.dockerenv')) return 'docker';
  if (process.env.VOICESCOPE_STANDALONE) return 'standalone';
  // In a packaged bun/pkg binary, process.pkg or import.meta.main hints help, but we
  // default to 'standalone' when neither ELECTRON_MODE nor DOCKER_MODE is set AND
  // we're not in a dev context (NODE_ENV=development implies dev).
  if (process.env.NODE_ENV === 'development' && !process.env.VOICESCOPE_STANDALONE) return 'dev';
  return 'standalone';
}

/**
 * Get the OS-appropriate application data directory.
 * - macOS:   ~/Library/Application Support/VoiceScope
 * - Windows: %APPDATA%/VoiceScope
 * - Linux:   ~/.config/voicescope
 * Override with VOICESCOPE_DATA_DIR env var.
 */
export function getAppDataDir() {
  if (process.env.VOICESCOPE_DATA_DIR) return process.env.VOICESCOPE_DATA_DIR;
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);

  const mode = getRuntimeMode();
  if (mode === 'dev' || mode === 'docker') {
    return path.resolve(process.cwd(), 'data');
  }

  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'VoiceScope');
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'VoiceScope');
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'voicescope');
  }
}

/**
 * Directory for audio file storage.
 */
export function getAudioDir() {
  return path.join(getAppDataDir(), 'audio');
}

/**
 * Directory for generated infographic PNGs (one per recording).
 */
export function getInfographicDir() {
  return path.join(getAppDataDir(), 'infographics');
}

/**
 * Directory for reusable reference images (brand kit / preset thumbnails).
 */
export function getInfographicRefsDir() {
  return path.join(getAppDataDir(), 'infographic-refs');
}

/**
 * SQLite database file path.
 */
export function getDatabasePath() {
  return path.join(getAppDataDir(), 'voicescope.db');
}

/**
 * Config file for API keys and user preferences (standalone mode).
 * Structure: { OPENAI_API_KEY: "...", DEEPGRAM_API_KEY: "...", ... }
 */
export function getConfigPath() {
  return path.join(getAppDataDir(), 'config.json');
}

/**
 * Ensure the app data directory and its subdirectories exist.
 * Safe to call multiple times.
 */
export function ensureAppDirs() {
  const dirs = [getAppDataDir(), getAudioDir(), getInfographicDir(), getInfographicRefsDir()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
