import { summarizeWithGemini } from './summary/gemini.js';
import { summarizeWithGrok } from './summary/grok.js';
import { summarizeWithOpenAI } from './summary/openai.js';
import { summarizeWithClaude } from './summary/claude.js';
import { summarizeWithOllama } from './summary/ollama.js';
import { summarizeWithCustom } from './summary/custom.js';
import { queryOne } from '../db/database.js';
import { getProcessingMode } from './processing-mode.js';

const providers = {
  gemini: summarizeWithGemini,
  grok: summarizeWithGrok,
  openai: summarizeWithOpenAI,
  claude: summarizeWithClaude,
  ollama: summarizeWithOllama,
  custom: summarizeWithCustom,
};

/**
 * Ask a question to the configured LLM.
 * Uses dedicated ask provider/model settings, falls back to summary settings.
 */
export async function askLLM(userMessage, systemPrompt, options = {}) {
  let provider = options.provider;
  let model = options.model;

  if (!provider) {
    const askProv = queryOne("SELECT value FROM settings WHERE key = 'default_ask_provider'");
    if (askProv) {
      try { provider = JSON.parse(askProv.value); } catch (e) { provider = askProv.value; }
    } else {
      const summaryProv = queryOne("SELECT value FROM settings WHERE key = 'default_summary_provider'");
      if (summaryProv) {
        try { provider = JSON.parse(summaryProv.value); } catch (e) { provider = summaryProv.value; }
      } else {
        provider = 'openai';
      }
    }
  }

  if (!model) {
    const askModel = queryOne("SELECT value FROM settings WHERE key = 'default_ask_model'");
    if (askModel) {
      try { model = JSON.parse(askModel.value); } catch (e) { model = askModel.value; }
    } else {
      const summaryModel = queryOne("SELECT value FROM settings WHERE key = 'default_summary_model'");
      if (summaryModel) {
        try { model = JSON.parse(summaryModel.value); } catch (e) { model = summaryModel.value; }
      } else {
        model = 'gpt-5.4-mini';
      }
    }
  }

  // OFFLINE MODE: force local provider (Ollama or custom endpoint)
  const processingMode = getProcessingMode();
  if (processingMode === 'offline' && !['ollama', 'custom'].includes(provider)) {
    console.log('[Ask] Offline mode: forcing local provider');
    provider = 'ollama';
    const ollamaModelSetting = queryOne("SELECT value FROM settings WHERE key = 'ollama_model'");
    try { model = ollamaModelSetting ? JSON.parse(ollamaModelSetting.value) : 'llama3.2'; } catch { model = 'llama3.2'; }
  }

  const llmFn = providers[provider];
  if (!llmFn) {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }

  return llmFn(userMessage, systemPrompt, { model });
}
