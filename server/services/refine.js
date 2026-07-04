import { queryOne, execute } from '../db/database.js';
import { askLLM } from './ask.js';
import { getProcessingMode } from './processing-mode.js';

const SYSTEM_PROMPT = `あなたは音声文字起こしの整形アシスタントです。以下のルールに従って、文字起こしテキストを整形してください。

【ルール】
1. 明らかな誤字・誤変換を修正する
2. フィラー（えーと、あのー、うーん、まあ、その、ええ）を除去する
3. 句読点を適切に配置する
4. 言い直し・繰り返しを整理する（例: 「それはそれは大事な」→「それは大事な」）
5. 意味は絶対に変えない。内容の追加・削除・言い換えは禁止
6. 話者名やタイムスタンプには触れない
7. 専門用語や固有名詞はそのまま保持する

【入力形式】
JSONの配列で、各要素は {index, text} です。

【出力形式】
同じJSON配列で、textのみ整形して返してください。indexはそのまま返すこと。
JSONのみ出力し、説明は不要です。`;

/* ------------------------------------------------------------------ *
 * Provider lookup helpers
 * ------------------------------------------------------------------ */

function getLocalOllama() {
  const ollamaSetting = queryOne("SELECT value FROM settings WHERE key = 'ollama_model'");
  if (ollamaSetting) {
    try {
      const model = JSON.parse(ollamaSetting.value);
      if (model) return { provider: 'ollama', model };
    } catch {}
  }
  const ollamaUrl = queryOne("SELECT value FROM settings WHERE key = 'local_ollama_url'");
  if (ollamaUrl) return { provider: 'ollama', model: 'llama3.2' };
  return null;
}

function getLocalCustom() {
  const customUrl = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_url'");
  const customModel = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_model'");
  if (customUrl && customModel) {
    try {
      const url = JSON.parse(customUrl.value);
      const model = JSON.parse(customModel.value);
      if (url && model) return { provider: 'custom', model };
    } catch {}
  }
  return null;
}

function getLocalFallback() {
  return getLocalOllama() || getLocalCustom();
}

/**
 * Resolve the primary provider based on user preference and processing mode.
 *
 * Returns: { provider, model } | null
 *
 * Precedence:
 *   1. User explicit preference (refine_preference = 'provider:model')
 *   2. 'auto' mode:
 *      - offline mode → local only
 *      - ownkey/managed → OpenAI → Gemini → Grok → Claude → local
 */
function getRefineConfig() {
  const prefRow = queryOne("SELECT value FROM settings WHERE key = 'refine_preference'");
  let pref = 'auto';
  try { pref = prefRow ? JSON.parse(prefRow.value) : 'auto'; } catch {}

  // Explicit user selection
  if (pref && pref !== 'auto' && pref.includes(':')) {
    const [provider, ...modelParts] = pref.split(':');
    let model = modelParts.join(':'); // handle model names containing ':'

    // Resolve '__default__' placeholder to the user's saved default model
    // (used by Ollama / custom endpoint where the model name is in its own setting)
    if (model === '__default__') {
      if (provider === 'ollama') {
        const ollama = getLocalOllama();
        if (ollama) return ollama;
      } else if (provider === 'custom') {
        const custom = getLocalCustom();
        if (custom) return custom;
      }
      // Fell through — user selected ollama/custom but it isn't configured
      console.warn(`[Refine] User selected ${provider} but no default model is configured`);
      return null;
    }

    return { provider, model };
  }

  // 'auto' mode
  const mode = getProcessingMode();

  if (mode === 'offline') {
    return getLocalFallback();
  }

  // Online-capable modes: prefer cloud (faster), local as last resort
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model: 'gpt-5-nano' };
  if (process.env.GEMINI_API_KEY) return { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
  if (process.env.GROK_API_KEY) return { provider: 'grok', model: 'grok-4.3' };
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'claude', model: 'claude-haiku-4-5-20251001' };

  // No cloud keys → fall back to local
  return getLocalFallback();
}

/**
 * Determine whether an error is recoverable via fallback (quota/auth/rate-limit/network),
 * as opposed to a genuine bug (bad request, invalid input, etc).
 */
function isRecoverableError(err) {
  const msg = (err?.message || '').toLowerCase();
  const status = err?.status || err?.response?.status || 0;

  // HTTP status codes that indicate temporary or billing issues
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  if (status >= 500 && status < 600) return true;

  // Network / connection issues
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' || err?.code === 'ENOTFOUND') return true;

  // Message-based detection for providers that don't set status cleanly
  if (msg.includes('quota') || msg.includes('insufficient_quota')) return true;
  if (msg.includes('rate limit') || msg.includes('rate_limit')) return true;
  if (msg.includes('invalid api key') || msg.includes('authentication')) return true;
  if (msg.includes('timeout') || msg.includes('timed out')) return true;
  if (msg.includes('payment') || msg.includes('billing')) return true;

  return false;
}

/* ------------------------------------------------------------------ *
 * Chunking (unchanged)
 * ------------------------------------------------------------------ */

function buildChunks(segments) {
  const chunks = [];
  let currentChunk = [];
  let currentLen = 0;
  const MAX_CHARS = 6000;

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text || '';
    if (currentLen + text.length > MAX_CHARS && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLen = 0;
    }
    currentChunk.push({ index: i, text });
    currentLen += text.length;
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}

/**
 * Apply refinement using a specific config. Returns refined segments.
 * Throws on unrecoverable error; returns partially-refined segments on chunk-level errors.
 */
async function refineWithConfig(segments, config) {
  const chunks = buildChunks(segments);
  const refinedSegments = [...segments];

  for (const chunk of chunks) {
    const content = await askLLM(
      JSON.stringify(chunk),
      SYSTEM_PROMPT,
      { provider: config.provider, model: config.model }
    );
    const jsonStr = content.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, '');
    const refined = JSON.parse(jsonStr);

    for (const item of refined) {
      if (typeof item.index === 'number' && typeof item.text === 'string') {
        refinedSegments[item.index] = {
          ...refinedSegments[item.index],
          text: item.text,
        };
      }
    }
  }
  return refinedSegments;
}

/**
 * Refine transcription segments using the best available LLM.
 *
 * Returns: { refined: boolean, provider, model, fallback?: { reason, primary, fallback } }
 *   - refined=false means refinement was skipped (OFF / no provider / failed with no fallback)
 *   - fallback set when primary failed and local fallback was used
 */
export async function refineTranscription(transcriptionId) {
  const transcription = queryOne('SELECT * FROM transcriptions WHERE id = ?', [transcriptionId]);
  if (!transcription) throw new Error('Transcription not found');

  // Already refined
  if (transcription.refined_segments_json) {
    return { refined: false, reason: 'already-refined' };
  }

  let segments;
  try { segments = JSON.parse(transcription.segments_json); } catch { return { refined: false, reason: 'parse-error' }; }
  if (!segments || segments.length === 0) return { refined: false, reason: 'empty' };

  const primary = getRefineConfig();
  if (!primary) {
    const mode = getProcessingMode();
    const reason = mode === 'offline' ? 'no-local-llm' : 'no-provider';
    console.warn(`[Refine] No provider available (mode=${mode}) — skipping refinement`);
    return { refined: false, reason };
  }

  // Attempt primary
  console.log(`[Refine] Primary: ${primary.provider}/${primary.model}`);
  try {
    const refinedSegments = await refineWithConfig(segments, primary);
    execute(
      'UPDATE transcriptions SET refined_segments_json = ? WHERE id = ?',
      [JSON.stringify(refinedSegments), transcriptionId]
    );
    console.log(`[Refine] Transcription ${transcriptionId} refined with ${primary.provider}/${primary.model}`);
    return { refined: true, provider: primary.provider, model: primary.model };
  } catch (primaryErr) {
    console.warn(`[Refine] Primary ${primary.provider} failed: ${primaryErr.message}`);

    // Don't fallback for code-level bugs (invalid input, etc.)
    if (!isRecoverableError(primaryErr)) {
      console.error(`[Refine] Unrecoverable error — not falling back`);
      return { refined: false, reason: 'primary-failed', error: primaryErr.message };
    }

    // Try local fallback — but only if it's different from what we just tried
    const fallback = getLocalFallback();
    const isSameAsPrimary = fallback && fallback.provider === primary.provider;

    if (!fallback || isSameAsPrimary) {
      console.warn(`[Refine] No local fallback available — skipping refinement`);
      return {
        refined: false,
        reason: 'primary-failed-no-fallback',
        error: primaryErr.message,
        primary: primary.provider,
      };
    }

    console.warn(`[Refine] Falling back to local: ${fallback.provider}/${fallback.model}`);
    try {
      const refinedSegments = await refineWithConfig(segments, fallback);
      execute(
        'UPDATE transcriptions SET refined_segments_json = ? WHERE id = ?',
        [JSON.stringify(refinedSegments), transcriptionId]
      );
      console.log(`[Refine] Transcription ${transcriptionId} refined with ${fallback.provider}/${fallback.model} (fallback)`);
      return {
        refined: true,
        provider: fallback.provider,
        model: fallback.model,
        fallback: {
          reason: primaryErr.message,
          primary: primary.provider,
          fallback: fallback.provider,
        },
      };
    } catch (fallbackErr) {
      console.error(`[Refine] Fallback also failed: ${fallbackErr.message}`);
      return {
        refined: false,
        reason: 'both-failed',
        primaryError: primaryErr.message,
        fallbackError: fallbackErr.message,
      };
    }
  }
}
