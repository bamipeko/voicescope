import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import { getConfigPath, getRuntimeMode } from './platform-paths.js';

const ALLOWED_KEYS = new Set([
  'DEEPGRAM_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROK_API_KEY',
  'ANTHROPIC_API_KEY',
]);

/**
 * Derive a machine-bound key for encryption. Not cryptographically bulletproof
 * (hostname+username is guessable), but raises the bar against casual exfiltration
 * of the config.json file.
 */
function deriveMachineKey() {
  const seed = [os.hostname(), os.userInfo().username, 'voicescope-v1'].join('|');
  return crypto.createHash('sha256').update(seed).digest();
}

function encrypt(plaintext) {
  const key = deriveMachineKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(payload) {
  try {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const key = deriveMachineKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function readConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(obj) {
  const p = getConfigPath();
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), { mode: 0o600 });
}

/**
 * Load API keys from the config file into process.env.
 * Runs at startup in standalone mode (similar to electron-store loading in Electron mode).
 */
export function loadKeysIntoEnv() {
  const mode = getRuntimeMode();
  if (mode !== 'standalone') return 0;

  const cfg = readConfig();
  const enc = cfg._keys || {};
  let loaded = 0;
  for (const [k, v] of Object.entries(enc)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    const plain = decrypt(v);
    if (plain && !process.env[k]) {
      process.env[k] = plain;
      loaded++;
    }
  }
  // Mark them as user-provided (so the UI can show "保存済み" correctly)
  if (loaded > 0) {
    const injected = (process.env.VOICESCOPE_STORE_INJECTED_KEYS || '').split(',').filter(Boolean);
    for (const k of Object.keys(enc)) {
      if (ALLOWED_KEYS.has(k) && !injected.includes(k)) injected.push(k);
    }
    process.env.VOICESCOPE_STORE_INJECTED_KEYS = injected.join(',');
  }
  return loaded;
}

/**
 * Save an API key to the config file (standalone mode only).
 * Encrypted with a machine-bound key.
 */
export function saveKey(envName, value) {
  if (!ALLOWED_KEYS.has(envName)) return false;
  const cfg = readConfig();
  if (!cfg._keys) cfg._keys = {};
  if (value) {
    cfg._keys[envName] = encrypt(value);
  } else {
    delete cfg._keys[envName];
  }
  writeConfig(cfg);
  // Also reflect into process.env immediately
  if (value) {
    process.env[envName] = value;
  } else {
    delete process.env[envName];
  }
  return true;
}

/**
 * Check whether a key is saved (without decrypting it).
 */
export function hasKey(envName) {
  if (!ALLOWED_KEYS.has(envName)) return false;
  const cfg = readConfig();
  return !!(cfg._keys && cfg._keys[envName]);
}
