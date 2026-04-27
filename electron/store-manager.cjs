const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let store = null;

const STORE_DEFAULTS = {
  DEEPGRAM_API_KEY: '',
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
  GROK_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  windowBounds: { width: 1280, height: 800 },
  meetingAutoRecord: false,
  meetBrowser: 'brave',
  exportAudioPath: '',
  disableUpdateCheck: false,
};

/**
 * Derive a machine-specific encryption key.
 * Uses hostname + username + userData path + a random salt stored alongside the config.
 * The salt is generated once on first run and persisted in a separate file.
 */
function getMachineKey() {
  const configDir = app.getPath('userData');
  const saltFile = path.join(configDir, '.store-salt');

  let salt;
  try {
    salt = fs.readFileSync(saltFile, 'utf-8');
  } catch {
    // First run or salt missing: generate and persist a random salt
    salt = crypto.randomBytes(32).toString('hex');
    try { fs.mkdirSync(configDir, { recursive: true }); } catch {}
    try { fs.writeFileSync(saltFile, salt); } catch {}
  }

  const material = [os.hostname(), os.userInfo().username, app.getPath('userData'), salt].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function initStore() {
  const Store = require('electron-store');
  const machineKey = getMachineKey();
  const configDir = app.getPath('userData');
  const configFile = path.join(configDir, 'voicescope-config.json');

  // If config file exists, try to open with current key
  if (fs.existsSync(configFile)) {
    try {
      const testStore = new Store({
        name: 'voicescope-config',
        defaults: STORE_DEFAULTS,
        encryptionKey: machineKey,
      });
      // Verify it's actually readable (constructor may not throw but data is garbage)
      testStore.get('_migrated');
      store = testStore;
      return store;
    } catch (e) {
      // Config exists but can't be read — likely encrypted with old key.
      // Delete config to start fresh. User will need to re-enter API keys.
      console.warn('[Store] Config unreadable, resetting:', e.message);
      try { fs.unlinkSync(configFile); } catch {}
      // Also delete salt so we get a fresh key for the new config
      const saltFile = path.join(configDir, '.store-salt');
      try { fs.unlinkSync(saltFile); } catch {}
    }
  }

  // Fresh install or reset — regenerate key if salt was deleted
  const freshKey = getMachineKey();
  store = new Store({
    name: 'voicescope-config',
    defaults: STORE_DEFAULTS,
    encryptionKey: freshKey,
  });
  return store;
}

function get(key) {
  if (!store) return null;
  return store.get(key);
}

function set(key, value) {
  if (!store) return;
  store.set(key, value);
}

function getAll() {
  if (!store) return {};
  return store.store;
}

module.exports = { initStore, get, set, getAll };
