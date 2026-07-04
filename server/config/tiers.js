/**
 * Subscription tier definitions.
 *
 * Tiers:
 *   ownkey  — User provides their own API keys. All features unlocked, no cost.
 *   trial   — 14-day trial with pro-level features.
 *   pro     — "Omakase Pro" ¥980/month. Standard models, managed API keys.
 *   heavy   — "Omakase Heavy" ¥2,480/month. All models, managed API keys.
 *   free    — Expired trial / no plan. Very limited models.
 */

export const TIERS = {
  ownkey: {
    label: '自前APIキー',
    description: '自分のAPIキーで全機能を利用',
    price: null,
    allowedModels: null, // null = all models allowed
    crossAsk: true,
  },
  trial: {
    label: 'トライアル',
    description: '14日間無料体験（Pro相当）',
    price: null,
    allowedModels: null, // same as pro during trial
    crossAsk: true,
    durationDays: 14,
  },
  pro: {
    label: 'おまかせ Pro',
    description: '標準モデルで文字起こし・要約',
    price: '¥980/月',
    allowedModels: {
      summary: [
        'gpt-5.4-mini', 'gpt-5-nano',
        'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite',
        'claude-haiku-4-5-20251001',
        'grok-4.3',
      ],
      ask: [
        'gpt-5.4-mini', 'gpt-5-nano',
        'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite',
        'claude-haiku-4-5-20251001',
        'grok-4.3',
      ],
    },
    crossAsk: true,
  },
  heavy: {
    label: 'おまかせ Heavy',
    description: '高性能モデル使い放題',
    price: '¥2,480/月',
    allowedModels: null, // all models
    crossAsk: true,
  },
  free: {
    label: 'Free+',
    description: 'テスト用無料プラン（Deepgram + 最安モデル）',
    price: null,
    allowedModels: {
      summary: ['gpt-5-nano', 'gemini-2.5-flash-lite'],
      ask: ['gpt-5-nano', 'gemini-2.5-flash-lite'],
    },
    crossAsk: true,
  },
};

// Activation codes are managed exclusively in Cloudflare Workers KV.
// No codes are stored in the app binary (prevents extraction from exe).
// To add/remove codes, use: cd worker && npx wrangler kv key put --binding CODES --remote "code:XXXX" --path scripts/seed.json

// Providers that are always allowed regardless of tier (local = user's own compute)
// 'custom' = user-configured OpenAI-compatible endpoint (LM Studio, llama.cpp, Jan, etc.) — restricted to localhost/LAN
export const ALWAYS_ALLOWED_PROVIDERS = ['ollama', 'custom'];

// Cloudflare Worker URL for managed mode
export const MANAGED_WORKER_URL = 'https://voicescope.voicescope.workers.dev';

// Models available in managed mode per tier.
// Keep these in sync with worker/src/middleware/model-guard.ts
export const MANAGED_ALLOWED_MODELS_BY_TIER = {
  free: {
    summary: ['gpt-5-nano', 'gemini-2.5-flash-lite'],
    ask: ['gpt-5-nano', 'gemini-2.5-flash-lite'],
  },
  trial: {
    summary: [
      'gpt-5.4-mini', 'gpt-5-nano',
      'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite',
      'claude-haiku-4-5-20251001',
      'grok-4.3',
    ],
    ask: [
      'gpt-5.4-mini', 'gpt-5-nano',
      'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite',
      'claude-haiku-4-5-20251001',
      'grok-4.3',
    ],
  },
  pro: {
    summary: [
      'gpt-5.4-mini', 'gpt-5-nano',
      'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite',
      'claude-haiku-4-5-20251001',
      'grok-4.3',
    ],
    ask: [
      'gpt-5.4-mini', 'gpt-5-nano',
      'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite',
      'claude-haiku-4-5-20251001',
      'grok-4.3',
    ],
  },
  heavy: {
    summary: [
      'gpt-5.4-mini', 'gpt-5-nano', 'gpt-5.4',
      'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview',
      'claude-haiku-4-5-20251001', 'claude-sonnet-4-6',
      'grok-4.3',
    ],
    ask: [
      'gpt-5.4-mini', 'gpt-5-nano', 'gpt-5.4',
      'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview',
      'claude-haiku-4-5-20251001', 'claude-sonnet-4-6',
      'grok-4.3',
    ],
  },
};

// Legacy alias — defaults to pro tier models for backward compat
export const MANAGED_ALLOWED_MODELS = MANAGED_ALLOWED_MODELS_BY_TIER.pro;
