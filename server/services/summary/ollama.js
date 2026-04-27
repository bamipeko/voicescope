import OpenAI from 'openai';
import { queryOne } from '../../db/database.js';

export async function summarizeWithOllama(text, systemPrompt, options = {}) {
  // Get Ollama URL from settings or default (restrict to localhost to prevent SSRF)
  const urlSetting = queryOne("SELECT value FROM settings WHERE key = 'local_ollama_url'");
  let baseURL = urlSetting ? JSON.parse(urlSetting.value) : 'http://localhost:11434';
  try {
    const parsed = new URL(baseURL);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      console.warn(`[Ollama] Blocked non-localhost URL: ${baseURL}, falling back to default`);
      baseURL = 'http://localhost:11434';
    }
  } catch {
    baseURL = 'http://localhost:11434';
  }

  // Use explicit model, or fall back to saved default, or llama3.2
  let model = options.model;
  if (!model) {
    const modelSetting = queryOne("SELECT value FROM settings WHERE key = 'ollama_model'");
    try { model = modelSetting ? JSON.parse(modelSetting.value) : 'llama3.2'; } catch { model = 'llama3.2'; }
  }
  if (!model) model = 'llama3.2';

  // Ollama exposes an OpenAI-compatible API at /v1
  // Use long timeout because local models can be slow (especially on CPU)
  const client = new OpenAI({
    baseURL: `${baseURL}/v1`,
    apiKey: 'ollama', // Ollama ignores API key but SDK requires one
    timeout: 300000, // 5 minutes (local models are slow)
    maxRetries: 1,
  });

  console.log(`[Ollama] Requesting model=${model}, text=${text.length} chars`);

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Ollamaから空の応答が返されました。モデルが正しく動作しているか確認してください。');
    }
    return content;
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      throw new Error(`Ollamaに接続できません (${baseURL})。Ollamaが起動しているか確認してください。`);
    }
    if (err.message?.includes('timeout') || err.code === 'ETIMEDOUT') {
      throw new Error(`Ollamaの応答がタイムアウトしました。モデルの処理に時間がかかっている可能性があります。テキストを短くするか、より小さいモデルを使用してください。`);
    }
    console.error(`[Ollama] Error:`, err.message);
    throw new Error(`Ollama要約エラー: ${err.message}`);
  }
}
