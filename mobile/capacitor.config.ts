import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for VoiceScope Android.
 *
 * `webDir` points to the shared client build output. Running `npm run sync`
 * from this directory triggers `npm run build` in ../client first, then
 * Capacitor copies the resulting `dist/` into the Android project.
 *
 * In dev mode you can set `server.url` to your Vite dev server (typically
 * http://10.0.2.2:5173 for the Android emulator pointing at host's
 * localhost) to get HMR; uncomment the block below.
 */
const config: CapacitorConfig = {
  appId: 'com.bamipeko.voicescape',
  appName: 'VoiceScope',
  webDir: '../client/dist',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true, // chrome://inspect during dev
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      androidIsEncryption: false, // set true if you want SQLCipher
    },
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: '#1e1e20',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
  // Uncomment for live-reload during dev (requires `npm run live-reload`):
  // server: {
  //   url: 'http://10.0.2.2:5173',
  //   cleartext: true,
  // },
};

export default config;
