import { exec } from 'child_process';

/**
 * Open the given URL in the user's default browser. Cross-platform.
 * Called at startup in standalone mode.
 */
export function openInBrowser(url) {
  let cmd;
  switch (process.platform) {
    case 'darwin':
      cmd = `open "${url}"`;
      break;
    case 'win32':
      // start "" prevents the URL from being mistaken for a window title
      cmd = `start "" "${url}"`;
      break;
    default:
      cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.warn(`[Launcher] Failed to open browser: ${err.message}`);
      console.warn(`[Launcher] Please open ${url} manually.`);
    }
  });
}
