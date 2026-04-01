let store = null;

function initStore() {
  // electron-store uses dynamic import to support ESM/CJS
  const Store = require('electron-store');
  store = new Store({
    name: 'voicescope-config',
    defaults: {
      DEEPGRAM_API_KEY: '',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
      GROK_API_KEY: '',
      windowBounds: { width: 1280, height: 800 },
    },
    encryptionKey: 'voicescope-2026',
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
