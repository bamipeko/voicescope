/**
 * Platform detection and capability adapter.
 *
 * VoiceScope ships in three runtimes:
 *   1. **Electron desktop** — bundled Express server at localhost:5100
 *   2. **Browser** — talks to a remote Express server (Docker / NAS / cloud)
 *   3. **Capacitor mobile (Android)** — no Express; talks directly to the
 *      Cloudflare Worker (managed mode) or a user-configured local LLM
 *      endpoint (Ollama on PC/NAS, companion Android apps, etc.)
 *
 * Components should never branch on `process.env` or check `window.electron`
 * directly — go through the helpers here so a new platform is one switch
 * statement away.
 */

let cachedPlatform = null;

/**
 * Returns one of: 'electron' | 'capacitor' | 'browser'.
 *
 * Detection order:
 *   1. Capacitor: `window.Capacitor?.isNativePlatform()` is true on iOS/Android
 *   2. Electron: navigator.userAgent contains 'voicescope/' (set by Electron
 *      shell) OR `window.electronAPI` is exposed via preload script
 *   3. Otherwise: browser
 */
export function getPlatform() {
  if (cachedPlatform) return cachedPlatform;

  if (typeof window !== 'undefined') {
    if (window.Capacitor?.isNativePlatform?.()) {
      cachedPlatform = 'capacitor';
    } else if (
      navigator.userAgent.toLowerCase().includes('voicescape/')
      || window.electronAPI
    ) {
      cachedPlatform = 'electron';
    } else {
      cachedPlatform = 'browser';
    }
  } else {
    cachedPlatform = 'browser';
  }

  return cachedPlatform;
}

export const isElectron  = () => getPlatform() === 'electron';
export const isCapacitor = () => getPlatform() === 'capacitor';
export const isBrowser   = () => getPlatform() === 'browser';
export const isMobile    = () => isCapacitor();
export const isDesktop   = () => isElectron();

/**
 * Default API base URL by platform.
 *
 * - Electron: bundled server at port 5100
 * - Capacitor: Cloudflare Worker (managed mode) — overridable via Settings
 * - Browser: same-origin (Docker deploy serves API + client together)
 *
 * Mobile users in **own-key mode** call providers directly from the WebView
 * and bypass this base URL entirely (see `services/managed.js`).
 */
export function getDefaultApiBase() {
  switch (getPlatform()) {
    case 'electron':
      return 'http://localhost:5100';
    case 'capacitor':
      return 'https://voicescope.voicescope.workers.dev'; // override in Settings
    case 'browser':
    default:
      return ''; // same-origin
  }
}

/**
 * Capability flags. Components query these instead of checking the platform.
 *
 * Add new capabilities here as they appear; never spread platform checks
 * across the component tree.
 */
export function hasCapability(name) {
  const p = getPlatform();
  switch (name) {
    case 'reveal-in-explorer':       return p === 'electron';
    case 'native-file-dialog':       return p === 'electron';
    case 'background-recording':     return p === 'capacitor' || p === 'electron';
    case 'system-notification':      return p === 'capacitor' || p === 'electron';
    case 'gallery-save':             return p === 'capacitor';
    case 'android-share-sheet':      return p === 'capacitor';
    case 'sw-cache':                 return p === 'browser' || p === 'electron';
    case 'local-llm-companion':      return p === 'capacitor' || p === 'electron';
    case 'embedded-server':          return p === 'electron';
    default:                         return false;
  }
}
