/**
 * Allowed models per tier for managed mode.
 * Worker enforces this independently of the app (defense in depth).
 */

const MANAGED_MODELS: Record<string, string[]> = {
  // Free+ tier — Deepgram transcription + cheap/mid LLM + Ask All (test period)
  free: [
    'gpt-5-nano',
    'gpt-5.4-nano',
    'gpt-5.4-mini',
    'whisper-1',
  ],
  trial: [
    'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-nano', 'gpt-5-mini',
    'claude-haiku-4-5-20251001',
    'grok-4-1-fast-non-reasoning',
    'whisper-1',
  ],
  pro: [
    'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-nano', 'gpt-5-mini',
    'claude-haiku-4-5-20251001',
    'grok-4-1-fast-non-reasoning',
    'whisper-1',
  ],
  heavy: [
    'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4', 'gpt-5-nano', 'gpt-5-mini', 'gpt-5',
    'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6',
    'grok-4-1-fast-non-reasoning', 'grok-4-1-fast-reasoning',
    'grok-4.20-0309-non-reasoning', 'grok-4.20-0309-reasoning',
    'whisper-1',
  ],
};

export function isModelAllowed(tier: string, model: string): boolean {
  const allowed = MANAGED_MODELS[tier];
  if (!allowed) return false;
  return allowed.includes(model);
}
