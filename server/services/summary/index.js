import { summarizeWithGemini } from './gemini.js';
import { summarizeWithGrok } from './grok.js';
import { summarizeWithOpenAI } from './openai.js';
import { summarizeWithClaude } from './claude.js';
import { summarizeWithOllama } from './ollama.js';
import { summarizeWithCustom } from './custom.js';
import { queryOne } from '../../db/database.js';
import { getProcessingMode } from '../processing-mode.js';

const providers = {
  gemini: summarizeWithGemini,
  grok: summarizeWithGrok,
  openai: summarizeWithOpenAI,
  claude: summarizeWithClaude,
  ollama: summarizeWithOllama,
  custom: summarizeWithCustom,
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
    provider = setting ? JSON.parse(setting.value) : 'openai';
  }
  if (!model) {
    const setting = queryOne("SELECT value FROM settings WHERE key = 'default_summary_model'");
    model = setting ? JSON.parse(setting.value) : 'gpt-5.4-mini';
  }

  // OFFLINE MODE: force local provider (Ollama or custom endpoint)
  const processingMode = getProcessingMode();
  if (processingMode === 'offline' && !['ollama', 'custom'].includes(provider)) {
    // Prefer existing Ollama default, but if a custom endpoint is configured and user picked custom, keep it.
    console.log('[Summary] Offline mode: forcing local provider');
    provider = 'ollama';
    const ollamaModelSetting = queryOne("SELECT value FROM settings WHERE key = 'ollama_model'");
    model = ollamaModelSetting ? JSON.parse(ollamaModelSetting.value) : 'llama3.2';
  }

  const summarizeFn = providers[provider];
  if (!summarizeFn) {
    throw new Error(`Unknown LLM provider: ${provider}. Available: ${Object.keys(providers).join(', ')}`);
  }

  // Apply granularity modifier to the system prompt
  const granularity = options.granularity || 'normal'; // 'brief' | 'normal' | 'detailed'
  // Custom prompt overrides template system_prompt entirely
  let systemPrompt = options.customPrompt || template.system_prompt;

  if (granularity === 'brief') {
    systemPrompt = `【出力粒度: 簡易】500〜1000文字で、要点のみ読みやすくまとめてください。結論と重要ポイントに絞り、議論の経緯は省略してください。抽象的な表現ではなく、具体的な内容（名前、数字、固有名詞）を盛り込んでください。\n\n${systemPrompt}`;
  } else if (granularity === 'detailed') {
    systemPrompt = `【出力粒度: 詳細】文字数制限なし。すべての議論・発言・ニュアンスを漏らさず記録してください。誰が何を言い、それに対してどう展開したかの経緯も含めてください。結論に至ったプロセス、反論、代替案も網羅してください。\n\n${systemPrompt}`;
  } else {
    systemPrompt = `【出力粒度: 通常】2000〜3000文字程度で、議論の流れと結論を網羅してください。抽象的なまとめではなく、具体的な内容（誰が何を言ったか、具体的な数字や案）まで記載してください。\n\n${systemPrompt}`;
  }

  const content = await summarizeFn(transcriptionText, systemPrompt, { model });

  return {
    templateId: template.id,
    provider,
    model,
    granularity,
    content,
  };
}
