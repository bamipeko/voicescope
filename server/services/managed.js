import { queryOne } from '../db/database.js';
import { getCurrentTier } from '../middleware/tier.js';
import { getProcessingMode } from './processing-mode.js';

// Default Worker URL — override via settings if needed.
// Per 2026-05-02 decision: worker name is `voicescope` (was `voicescope-api`).
// Account workers.dev subdomain is `voicescope` (registered 2026-07-03).
const DEFAULT_WORKER_URL = 'https://voicescope.voicescope.workers.dev';

/**
 * Check if the app should use managed mode (Worker proxy) for API calls.
 *
 * Managed mode is active when:
 *   1. User has free/trial/pro/heavy tier with a valid managed token AND
 *   2. User does NOT have their own API key for the requested provider
 *
 * Note: 'free' is also included because a free activation code
 * (e.g. VSFREE2026) also issues a managed JWT for limited access.
 *
 * @param {string} provider - 'openai' | 'deepgram' | 'anthropic' | 'grok'
 * @returns {{ managed: boolean, workerBaseURL: string, token: string }}
 */
export function isManagedMode(provider = 'openai') {
  const mode = getProcessingMode();

  // In offline mode, never use managed proxy
  if (mode === 'offline') {
    return { managed: false, workerBaseURL: '', token: '' };
  }

  // In ownkey mode, never use managed proxy (use own keys only)
  if (mode === 'ownkey') {
    return { managed: false, workerBaseURL: '', token: '' };
  }

  // managed mode — must have a valid tier
  const { tier } = getCurrentTier();
  if (!['free', 'trial', 'pro', 'heavy'].includes(tier)) {
    return { managed: false, workerBaseURL: '', token: '' };
  }

  // In managed mode, prefer user's own key if available (saves operator cost).
  // Users who want to force Worker usage should remove their own keys.
  const providerKeyMap = {
    openai: 'OPENAI_API_KEY',
    deepgram: 'DEEPGRAM_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    grok: 'GROK_API_KEY',
  };
  const envKey = providerKeyMap[provider];
  if (envKey && process.env[envKey]) {
    return { managed: false, workerBaseURL: '', token: '' };
  }

  // Get managed token (JWT from Worker /verify)
  const tokenRow = queryOne("SELECT value FROM settings WHERE key = 'managed_token'");
  let token = '';
  try { token = tokenRow ? JSON.parse(tokenRow.value) : ''; } catch { token = tokenRow?.value || ''; }

  if (!token) {
    // No token yet — user needs to activate a code first
    return { managed: false, workerBaseURL: '', token: '' };
  }

  // Get Worker URL
  const urlRow = queryOne("SELECT value FROM settings WHERE key = 'managed_worker_url'");
  let workerBaseURL = DEFAULT_WORKER_URL;
  try {
    if (urlRow) workerBaseURL = JSON.parse(urlRow.value) || DEFAULT_WORKER_URL;
  } catch {}

  return { managed: true, workerBaseURL, token };
}
