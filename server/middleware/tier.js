import { queryOne } from '../db/database.js';
import { TIERS, ALWAYS_ALLOWED_PROVIDERS } from '../config/tiers.js';

/**
 * Determine the current subscription tier.
 *
 * Priority:
 *   1. Explicit paid plan (pro/heavy) always wins
 *   2. Active trial wins over ownkey
 *   3. If user has own API keys → 'ownkey' (full access)
 *   4. Expired trial with no API keys → 'free'
 */
export function getCurrentTier() {
  // Ownkey requires BOTH transcription AND LLM capability:
  // - Transcription: OpenAI (Whisper) OR Deepgram
  // - LLM (summary/ask): OpenAI, Gemini, Grok, or Anthropic
  // OpenAI alone covers both. Gemini alone is NOT sufficient (no transcription).
  const hasTranscription = !!(
    process.env.OPENAI_API_KEY || process.env.DEEPGRAM_API_KEY
  );
  const hasLLM = !!(
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GROK_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
  const hasOwnKeys = hasTranscription && hasLLM;

  // Read explicit tier setting
  const tierRow = queryOne("SELECT value FROM settings WHERE key = 'subscription_tier'");
  let tier;
  try { tier = tierRow ? JSON.parse(tierRow.value) : null; } catch { tier = tierRow?.value || null; }

  // Paid plans always take priority
  if (tier === 'pro' || tier === 'heavy') {
    return { tier, isExpired: false, expiry: null };
  }

  // Trial / free (activated via code): check expiry
  if (tier === 'trial' || tier === 'free') {
    const expiryRow = queryOne("SELECT value FROM settings WHERE key = 'trial_expiry'");
    let expiry;
    try { expiry = expiryRow ? JSON.parse(expiryRow.value) : ''; } catch { expiry = expiryRow?.value || ''; }

    if (expiry && new Date(expiry) < new Date()) {
      // Expired — fall through to ownkey check
    } else {
      return { tier, isExpired: false, expiry };
    }
  }

  // Own API keys → full access
  if (hasOwnKeys) {
    return { tier: 'ownkey', isExpired: false, expiry: null };
  }

  // No keys, no paid plan, expired/no trial → free (unmanaged, locked)
  return { tier: 'free', isExpired: tier === 'trial' || tier === 'free', expiry: null };
}

/**
 * Express middleware: validate that the requested model is allowed for current tier.
 * @param {string} purpose - 'summary' or 'ask'
 */
export function validateModel(purpose) {
  return (req, res, next) => {
    const requestedModel = req.body?.model;
    const requestedProvider = req.body?.provider;

    // No model specified = will use default, let it through
    if (!requestedModel) return next();

    // Local providers always allowed
    if (requestedProvider && ALWAYS_ALLOWED_PROVIDERS.includes(requestedProvider)) return next();

    const { tier } = getCurrentTier();
    const tierConfig = TIERS[tier];
    if (!tierConfig) return next();

    // null allowedModels = all models allowed
    if (!tierConfig.allowedModels) return next();

    const allowed = tierConfig.allowedModels[purpose];
    if (allowed && !allowed.includes(requestedModel)) {
      return res.status(403).json({
        error: `このモデル (${requestedModel}) は現在のプランでは利用できません`,
        requiredTier: 'pro',
        currentTier: tier,
      });
    }

    next();
  };
}

/**
 * Express middleware: require cross-recording ask capability.
 */
export function requireCrossAsk() {
  return (req, res, next) => {
    const { tier } = getCurrentTier();
    const tierConfig = TIERS[tier];
    if (!tierConfig?.crossAsk) {
      return res.status(403).json({
        error: 'Ask AllはAPIキー設定済みまたはProプラン以上で利用できます',
        requiredTier: 'pro',
        currentTier: tier,
      });
    }
    next();
  };
}
