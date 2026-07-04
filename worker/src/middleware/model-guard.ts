/**
 * Allowed models per tier for managed mode.
 * Worker enforces this independently of the app (defense in depth).
 */

// Gemini text models.
const GEMINI_LIGHT = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'];
const GEMINI_HEAVY = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'];

// Image generation models. gpt-image-2 requires OpenAI Verified Organization,
// which is exactly the friction the managed plan eliminates for end users.
const IMAGE_LIGHT: string[] = []; // image gen not in free/trial — too expensive
const IMAGE_PRO   = ['gpt-image-2'];                       // low / medium quality
const IMAGE_HEAVY = ['gpt-image-2'];                       // any quality including high

const MANAGED_MODELS: Record<string, string[]> = {
  // Free+ tier — Deepgram transcription + cheap/mid LLM + Ask All (test period).
  // No image generation, no Claude (cost control).
  free: [
    'gpt-5-nano',
    'whisper-1',
    'gemini-2.5-flash-lite',
    ...IMAGE_LIGHT,
  ],
  trial: [
    'gpt-5.4-mini', 'gpt-5-nano',
    'claude-haiku-4-5-20251001',
    'grok-4.3',
    'whisper-1',
    ...GEMINI_LIGHT,
    ...IMAGE_PRO, // trial gets image gen too — strong upsell hook
  ],
  pro: [
    'gpt-5.4-mini', 'gpt-5-nano',
    'claude-haiku-4-5-20251001',
    'grok-4.3',
    'whisper-1',
    ...GEMINI_LIGHT,
    ...IMAGE_PRO,
  ],
  heavy: [
    'gpt-5.4-mini', 'gpt-5-nano', 'gpt-5.4',
    'claude-haiku-4-5-20251001', 'claude-sonnet-4-6',
    'grok-4.3',
    'whisper-1',
    ...GEMINI_HEAVY,
    ...IMAGE_HEAVY,
  ],
};

export function isModelAllowed(tier: string, model: string): boolean {
  const allowed = MANAGED_MODELS[tier];
  if (!allowed) return false;
  return allowed.includes(model);
}
