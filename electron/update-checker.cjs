const { net, app, shell } = require('electron');

const GITHUB_OWNER = 'bamipeko';
const GITHUB_REPO = 'voicescope';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

/**
 * Check if the machine has internet connectivity.
 */
function isOnline() {
  return net.isOnline();
}

/**
 * Check GitHub Releases for a newer version.
 * Returns { hasUpdate, latestVersion, downloadUrl, releaseNotes } or null.
 * Skips silently if offline or disabled.
 */
async function checkForUpdates() {
  try {
    // Skip if no internet
    if (!isOnline()) {
      console.log('[UpdateChecker] Offline, skipping');
      return null;
    }

    // Skip if disabled via setting
    try {
      const Store = require('./store-manager.cjs');
      if (Store.get('disableUpdateCheck')) {
        console.log('[UpdateChecker] Disabled by user setting');
        return null;
      }
    } catch {}

    const currentVersion = app.getVersion();

    const response = await new Promise((resolve, reject) => {
      const request = net.request({
        url: RELEASES_URL,
        headers: { 'User-Agent': `VoiceScope/${currentVersion}` },
      });

      let body = '';
      request.on('response', (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => resolve(body));
      });
      request.on('error', reject);

      // Timeout after 10s
      setTimeout(() => reject(new Error('timeout')), 10000);
      request.end();
    });

    const release = JSON.parse(response);
    const latestTag = release.tag_name || '';
    const latestVersion = latestTag.replace(/^v/, '');

    if (!latestVersion) return null;

    // Compare versions (simple semver)
    if (isNewer(latestVersion, currentVersion)) {
      // Find .exe asset for download
      const exeAsset = (release.assets || []).find(a => a.name.endsWith('.exe'));
      return {
        hasUpdate: true,
        latestVersion,
        currentVersion,
        downloadUrl: exeAsset?.browser_download_url || release.html_url,
        releaseUrl: release.html_url,
        releaseNotes: (release.body || '').slice(0, 500),
      };
    }

    return { hasUpdate: false, currentVersion, latestVersion };
  } catch (err) {
    console.log(`[UpdateChecker] Check failed (non-critical): ${err.message}`);
    return null;
  }
}

/**
 * Simple semver comparison: is `a` newer than `b`?
 */
function isNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}

/**
 * Open release page in default browser.
 */
function openReleasePage(url) {
  shell.openExternal(url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
}

module.exports = { checkForUpdates, openReleasePage };
