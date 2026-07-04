import { queryOne } from '../../db/database.js';

// Uses Ollama's native /api/chat instead of the OpenAI-compat /v1 endpoint.
// Reasons:
//   1. Thinking models (qwen3, gemma4-turbo, ...) burn their whole generation
//      budget on the `reasoning` field and return an EMPTY `content` for long
//      inputs — /api/chat lets us disable thinking via `think: false`.
//   2. Ollama's default num_ctx (4096) silently truncates long transcripts;
//      /api/chat lets us size num_ctx to the input.
const REQUEST_TIMEOUT_MS = 600000; // local models on long inputs are slow
const NUM_PREDICT = 4096;          // summaries never need more output than this
const MIN_CTX = 8192;
const MAX_CTX = 32768;

function resolveBaseUrl() {
  // Get Ollama URL from settings or default (restrict to localhost to prevent SSRF)
  const urlSetting = queryOne("SELECT value FROM settings WHERE key = 'local_ollama_url'");
  let baseURL = 'http://localhost:11434';
  try {
    if (urlSetting) baseURL = JSON.parse(urlSetting.value) || baseURL;
    const parsed = new URL(baseURL);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      console.warn(`[Ollama] Blocked non-localhost URL: ${baseURL}, falling back to default`);
      baseURL = 'http://localhost:11434';
    }
  } catch {
    baseURL = 'http://localhost:11434';
  }
  return baseURL.replace(/\/$/, '');
}

async function fetchJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error || ''; } catch {}
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Check whether the model supports (and defaults to) thinking output. */
async function supportsThinking(baseURL, model) {
  try {
    const info = await fetchJson(`${baseURL}/api/show`, { model }, 15000);
    return Array.isArray(info?.capabilities) && info.capabilities.includes('thinking');
  } catch {
    return false; // unknown model info — don't send `think` to avoid 400s
  }
}

export async function summarizeWithOllama(text, systemPrompt, options = {}) {
  const baseURL = resolveBaseUrl();

  // Use explicit model, or fall back to saved default, or llama3.2
  let model = options.model;
  if (!model) {
    const modelSetting = queryOne("SELECT value FROM settings WHERE key = 'ollama_model'");
    try { model = modelSetting ? JSON.parse(modelSetting.value) : 'llama3.2'; } catch { model = 'llama3.2'; }
  }
  if (!model) model = 'llama3.2';

  // Size the context window to the input (Japanese ≈ 1-2 chars/token) so long
  // transcripts aren't silently truncated, capped so KV cache stays sane.
  const inputChars = text.length + (systemPrompt?.length || 0);
  const numCtx = Math.min(MAX_CTX, Math.max(MIN_CTX, Math.ceil(inputChars * 0.9) + NUM_PREDICT));

  const disableThink = await supportsThinking(baseURL, model);

  console.log(`[Ollama] Requesting model=${model}, text=${text.length} chars, num_ctx=${numCtx}${disableThink ? ', think=off' : ''}`);

  const body = {
    model,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    options: {
      num_ctx: numCtx,
      num_predict: NUM_PREDICT,
    },
  };
  if (disableThink) body.think = false;

  try {
    const response = await fetchJson(`${baseURL}/api/chat`, body, REQUEST_TIMEOUT_MS);

    const content = (response?.message?.content || '').trim();
    if (!content) {
      const thought = (response?.message?.thinking || '').trim();
      throw new Error(
        thought
          ? 'モデルが思考のみで回答を返しませんでした。より小さいモデルに切り替えるか、テキストを短くして再実行してください。'
          : 'Ollamaから空の応答が返されました。モデルが正しく動作しているか確認してください。'
      );
    }
    return content;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Ollamaの応答がタイムアウトしました。モデルの処理に時間がかかっている可能性があります。より小さいモデルを使用するか、テキストを短くしてください。');
    }
    const msg = err.message || '';
    if (err.cause?.code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      throw new Error(`Ollamaに接続できません (${baseURL})。Ollamaが起動しているか確認してください。`);
    }
    console.error(`[Ollama] Error:`, msg);
    throw new Error(`Ollama要約エラー: ${msg}`);
  }
}
