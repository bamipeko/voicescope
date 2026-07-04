/**
 * Shared provider/model definitions and filtering logic.
 * Used by Settings, RecordingDetail, and CrossAsk pages.
 */

export const ALL_PROVIDER_MODELS = {
  openai: [
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini（推奨）' },
    { value: 'gpt-5-nano', label: 'gpt-5-nano（最安）' },
    { value: 'gpt-5.4', label: 'gpt-5.4（高精度）' },
  ],
  gemini: [
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite（推奨）' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite（最安）' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview（高精度）' },
  ],
  grok: [
    { value: 'grok-4.3', label: 'Grok 4.3（推奨）' },
  ],
  claude: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（推奨）' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6（高精度）' },
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

export function getProviderForModel(model, models = ALL_PROVIDER_MODELS) {
  if (!model) return ''
  for (const [provider, list] of Object.entries(models)) {
    if ((list || []).some(m => m.value === model)) return provider
  }
  return ''
}

export function getModelLabel(model, models = ALL_PROVIDER_MODELS) {
  if (!model) return ''
  for (const list of Object.values(models)) {
    const found = (list || []).find(m => m.value === model)
    if (found) return found.label
  }
  return model
}

export function getGroupedModelOptions(models = ALL_PROVIDER_MODELS) {
  return Object.entries(models)
    .filter(([, list]) => (list || []).length > 0)
    .map(([provider, list]) => ({
      provider,
      label: PROVIDER_LABELS[provider] || provider,
      models: list,
    }))
}

/**
 * Get the default model for a provider from filtered models.
 */
export function getDefaultModel(models, provider) {
  const list = models[provider]
  return list?.[0]?.value || ''
}
