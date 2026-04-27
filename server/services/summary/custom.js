import OpenAI from 'openai';
import { queryOne } from '../../db/database.js';

/**
 * Custom OpenAI-compatible endpoint provider.
 * Works with LM Studio, llama.cpp server, Jan, LocalAI, KoboldCpp, etc.
 * User configures baseURL + model name in settings.
 *
 * For safety, this restricts URLs to localhost / private network ranges
 * (prevents SSRF to arbitrary external services).
 */
function getCustomConfig() {
  const urlRow = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_url'");
  const modelRow = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_model'");
  const keyRow = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_api_key'");

  let baseURL = null;
  let model = null;
  let apiKey = 'not-needed'; // Most local servers ignore this

  try { baseURL = urlRow ? JSON.parse(urlRow.value) : null; } catch { baseURL = urlRow?.value || null; }
  try { model = modelRow ? JSON.parse(modelRow.value) : null; } catch { model = modelRow?.value || null; }
  try {
    const k = keyRow ? JSON.parse(keyRow.value) : null;
    if (k) apiKey = k;
  } catch {}

  return { baseURL, model, apiKey };
}

function validateCustomURL(urlStr) {
  let parsed;
  try { parsed = new URL(urlStr); } catch { return null; }

  // Only allow http(s)
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  const host = parsed.hostname;
  // Allow localhost variants
  if (['localhost', '127.0.0.1', '::1'].includes(host)) return parsed.toString();

  // Allow private network ranges (LAN)
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [parseInt(v4[1]), parseInt(v4[2])];
    if (a === 10) return parsed.toString();
    if (a === 172 && b >= 16 && b <= 31) return parsed.toString();
    if (a === 192 && b === 168) return parsed.toString();
  }

  // Block public addresses to prevent SSRF
  return null;
}

export async function summarizeWithCustom(text, systemPrompt, options = {}) {
  const cfg = getCustomConfig();
  if (!cfg.baseURL) throw new Error('カスタムエンドポイントのURLが設定されていません（設定画面で登録してください）');

  const safeURL = validateCustomURL(cfg.baseURL);
  if (!safeURL) {
    throw new Error(`カスタムエンドポイントのURLが不正です (${cfg.baseURL})。localhost か LAN 内のアドレスを指定してください。`);
  }

  const model = options.model || cfg.model;
  if (!model) throw new Error('カスタムエンドポイントのモデル名が設定されていません');

  // Normalize: ensure baseURL ends without trailing /v1 duplication
  const normalizedBase = safeURL.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';

  const client = new OpenAI({
    baseURL: normalizedBase,
    apiKey: cfg.apiKey,
    timeout: 300000, // 5min — local models can be slow
    maxRetries: 1,
  });

  console.log(`[Custom] Requesting ${normalizedBase}, model=${model}, text=${text.length} chars`);

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    });
    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error('カスタムエンドポイントから空の応答が返されました。');
    return content;
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      throw new Error(`カスタムエンドポイント (${cfg.baseURL}) に接続できません。サーバーが起動しているか確認してください。`);
    }
    if (err.message?.includes('timeout') || err.code === 'ETIMEDOUT') {
      throw new Error(`カスタムエンドポイントの応答がタイムアウトしました。より小さなモデルを使うか、テキストを短くしてください。`);
    }
    console.error(`[Custom] Error:`, err.message);
    throw new Error(`カスタムエンドポイント要約エラー: ${err.message}`);
  }
}

// Export helpers for the tier/settings endpoints
export { getCustomConfig, validateCustomURL };
