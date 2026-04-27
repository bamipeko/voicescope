/**
 * Shared provider/model definitions and filtering logic.
 * Used by Settings, RecordingDetail, and CrossAsk pages.
 */

export const ALL_PROVIDER_MODELS = {
  openai: [
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5.4-nano', label: 'gpt-5.4-nano' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5-nano', label: 'gpt-5-nano' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-5', label: 'gpt-5' },
  ],
  gemini: [
    { value: 'gemini-3-flash-preview', label: 'gemini-3-flash' },
    { value: 'gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite' },
    { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro' },
  ],
  grok: [
    { value: 'grok-4-1-fast-non-reasoning', label: 'grok-4-1-fast' },
    { value: 'grok-4-1-fast-reasoning', label: 'grok-4-1 推論' },
    { value: 'grok-4.20-0309-non-reasoning', label: 'grok-4.20' },
    { value: 'grok-4.20-0309-reasoning', label: 'grok-4.20 推論' },
  ],
  claude: [
    { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  ],
  ollama: [], // populated dynamically from local Ollama
  custom: [], // populated dynamically from configured custom endpoint
}

export const PROVIDER_LABELS = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  grok: 'Grok',
  claude: 'Claude',
  ollama: 'Ollama (ローカル)',
  custom: 'カスタム (OpenAI互換)',
}

/**
 * Get filtered providers and models based on tier info.
 *
 * @param {object} tierInfo — from appStore (includes availableProviders, managedAllowedModels)
 * @param {string} purpose — 'summary' or 'ask'
 * @returns {{ providers: string[], models: Record<string, Array> }}
 */
export function getAvailableModels(tierInfo, purpose = 'summary') {
  const available = tierInfo?.availableProviders || Object.keys(ALL_PROVIDER_MODELS)
  const managedModels = tierInfo?.managedAllowedModels?.[purpose]
  const ollamaModels = tierInfo?.ollamaModels || []
  const customModels = tierInfo?.customModels || []

  const providers = available.filter(p => p in ALL_PROVIDER_MODELS || p === 'ollama' || p === 'custom')
  const models = {}

  for (const provider of providers) {
    // Local providers: use dynamically fetched model lists
    if (provider === 'ollama') {
      models[provider] = ollamaModels
      continue
    }
    if (provider === 'custom') {
      models[provider] = customModels
      continue
    }
    const allModels = ALL_PROVIDER_MODELS[provider] || []
    if (managedModels) {
      // In managed mode, only show allowed models
      models[provider] = allModels.filter(m => managedModels.includes(m.value))
    } else {
      models[provider] = allModels
    }
  }

  return { providers, models }
}

/**
 * Build MODEL_TO_PROVIDER reverse lookup from filtered models.
 */
export function buildModelToProvider(models) {
  const map = {}
  for (const [provider, list] of Object.entries(models)) {
    for (const m of list) map[m.value] = provider
  }
  return map
}

/**
 * Get the default model for a provider from filtered models.
 */
export function getDefaultModel(models, provider) {
  const list = models[provider]
  return list?.[0]?.value || ''
}
