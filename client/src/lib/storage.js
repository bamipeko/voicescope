/**
 * Cross-platform key-value storage.
 *
 * - Electron: `window.electronAPI.storeGet/Set` (electron-store IPC)
 * - Capacitor: `@capacitor/preferences` (encrypted on Android via Keystore)
 * - Browser: `localStorage` fallback
 *
 * Always async so callers don't have to branch.
 *
 * Use this for: API keys, user preferences, last-selected models, etc.
 * NOT for: large blobs (use Filesystem), bulk data (use SQLite).
 */

import { isCapacitor, isElectron } from './platform';

let _cap = null;
async function loadCapacitorPreferences() {
  if (_cap) return _cap;
  // Lazy import so the bundle doesn't try to resolve `@capacitor/preferences`
  // in browser/electron builds where it isn't installed.
  try {
    const mod = await import('@capacitor/preferences');
    _cap = mod.Preferences;
    return _cap;
  } catch {
    return null;
  }
}

export async function storageGet(key) {
  if (isCapacitor()) {
    const Pref = await loadCapacitorPreferences();
    if (Pref) {
      const { value } = await Pref.get({ key });
      return value;
    }
  }
  if (isElectron() && window.electronAPI?.storeGet) {
    return await window.electronAPI.storeGet(key);
  }
  // Browser fallback
  return localStorage.getItem(key);
}

export async function storageSet(key, value) {
  if (isCapacitor()) {
    const Pref = await loadCapacitorPreferences();
    if (Pref) {
      await Pref.set({ key, value: String(value) });
      return;
    }
  }
  if (isElectron() && window.electronAPI?.storeSet) {
    await window.electronAPI.storeSet(key, value);
    return;
  }
  localStorage.setItem(key, String(value));
}

export async function storageRemove(key) {
  if (isCapacitor()) {
    const Pref = await loadCapacitorPreferences();
    if (Pref) {
      await Pref.remove({ key });
      return;
    }
  }
  if (isElectron() && window.electronAPI?.storeRemove) {
    await window.electronAPI.storeRemove(key);
    return;
  }
  localStorage.removeItem(key);
}
