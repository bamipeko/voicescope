import { summarizeWithGemini } from './gemini.js';
import { summarizeWithGrok } from './grok.js';
import { summarizeWithOpenAI } from './openai.js';
import { queryOne } from '../../db/database.js';

const providers = {
  gemini: summarizeWithGemini,
  grok: summarizeWithGrok,
  openai: summarizeWithOpenAI,
};

export async function summarize(transcriptionText, options = {}) {
  // Determine template
  let template = null;
  if (options.templateId) {
    template = queryOne('SELECT * FROM templates WHERE id = ?', [options.templateId]);
  }
  if (!template) {
    template = queryOne('SELECT * FROM templates WHERE is_default = 1');
  }
  if (!template) {
    template = queryOne('SELECT * FROM templates ORDER BY id LIMIT 1');
  }
  if (!template) {
    throw new Error('テンプレートが見つかりません');
  }

  // Determine provider and model
  let provider = options.provider || template.preferred_llm_provider;
  let model = options.model || template.preferred_llm_model;

  if (!provider) {
    const setting = queryOne("SELECT value FROM settings WHERE key = 'default_summary_provider'");
    provider = setting ? JSON.parse(setting.value) : 'gemini';
  }
  if (!model) {
    const setting = queryOne("SELECT value FROM settings WHERE key = 'default_summary_model'");
    model = setting ? JSON.parse(setting.value) : 'gemini-3.1-flash-lite-preview';
  }

  const summarizeFn = providers[provider];
  if (!summarizeFn) {
    throw new Error(`Unknown LLM provider: ${provider}. Available: ${Object.keys(providers).join(', ')}`);
  }

  const content = await summarizeFn(transcriptionText, template.system_prompt, { model });

  return {
    templateId: template.id,
    provider,
    model,
    content,
  };
}
