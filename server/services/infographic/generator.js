import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { getInfographicDir } from '../../utils/platform-paths.js';
import { isManagedMode } from '../managed.js';
import { getStyle } from './styles.js';

/**
 * Map of supported image model + quality + size combos.
 *
 * gpt-image-1 sizes: 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape).
 * gpt-image-1.5 also supports true 9:16 / 16:9 ratios.
 */
const MODELS = {
  'gpt-image-1': {
    sizes: { '1:1': '1024x1024', '2:3': '1024x1536', '3:2': '1536x1024' },
    // 9:16 not supported natively — fall back to 1024x1536 (portrait, 2:3)
    aspectFallback: { '9:16': '1024x1536', '16:9': '1536x1024', '4:5': '1024x1536' },
    pricing: { low: 0.02, medium: 0.07, high: 0.19 }, // USD per image
  },
  'gpt-image-1-mini': {
    sizes: { '1:1': '1024x1024', '2:3': '1024x1536', '3:2': '1536x1024' },
    aspectFallback: { '9:16': '1024x1536', '16:9': '1536x1024', '4:5': '1024x1536' },
    pricing: { low: 0.005, medium: 0.011, high: 0.05 },
  },
};

function resolveSize(model, aspectRatio) {
  const cfg = MODELS[model];
  if (!cfg) throw new Error(`Unknown image model: ${model}`);
  return cfg.sizes[aspectRatio] || cfg.aspectFallback[aspectRatio] || '1024x1024';
}

function estimateCost(model, quality, n) {
  const cfg = MODELS[model];
  if (!cfg) return 0;
  const per = cfg.pricing[quality] ?? cfg.pricing.medium;
  return per * n;
}

/**
 * Build the final prompt sent to gpt-image-1.
 *
 * Combines:
 *   - The chosen style preset (visual direction)
 *   - The structured content as readable layout instructions
 *   - User-provided custom additions
 *   - Aspect ratio reminder
 */
function buildPrompt({ structure, style, customPrompt, aspectRatio }) {
  const styleDef = style === 'custom' ? null : getStyle(style);

  const lines = [];
  lines.push(`Aspect ratio: ${aspectRatio} portrait infographic poster.`);
  lines.push('Layout: title at top, three numbered key-points stacked vertically, conclusion at the bottom in a highlighted ribbon/banner.');

  if (styleDef) {
    lines.push(`Style: ${styleDef.prompt}.`);
  }

  if (customPrompt) {
    lines.push(`Additional direction from user: ${customPrompt}`);
  }

  if (structure?.color_palette_hint) {
    lines.push(`Color palette hint: ${structure.color_palette_hint}.`);
  }

  // Render the structured content as text the image model will lay out.
  lines.push('');
  lines.push('TEXT TO RENDER (must appear in image, in Japanese, accurately spelled):');
  lines.push(`Title: 「${structure.title}」`);
  if (structure.subtitle) lines.push(`Subtitle: 「${structure.subtitle}」`);

  if (Array.isArray(structure.blocks)) {
    for (const b of structure.blocks) {
      const num = b.number ?? '•';
      lines.push(`Block ${num}: 「${b.headline}」 — ${b.body}`);
    }
  }

  if (structure.conclusion) {
    lines.push(`Conclusion banner: 「${structure.conclusion}」`);
  }

  lines.push('');
  lines.push('Important: render Japanese text accurately and legibly. No misspellings. No Latin substitutes for Japanese characters.');

  return lines.join('\n');
}

function getOpenAIClient() {
  const { managed, workerBaseURL, token } = isManagedMode('openai');
  if (managed) {
    return new OpenAI({ apiKey: token, baseURL: `${workerBaseURL}/v1` });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('画像生成には OPENAI_API_KEY が必要です。設定画面で OpenAI のAPIキーを登録してください。');
  }
  return new OpenAI({ apiKey });
}

/**
 * Generate one or more infographic images.
 *
 * @param {object} opts
 * @param {object} opts.structure   — structured JSON from structurer.js
 * @param {string} opts.style       — preset key or 'custom'
 * @param {string} [opts.customPrompt]
 * @param {string} opts.aspectRatio — '9:16' | '1:1' | '16:9' | '2:3' | '3:2' | '4:5'
 * @param {string} opts.quality     — 'low' | 'medium' | 'high'
 * @param {string} opts.model       — 'gpt-image-1' | 'gpt-image-1-mini'
 * @param {number} opts.n           — 1..4 typical
 * @param {Array<{buffer:Buffer, mime:string, name:string}>} [opts.referenceImages]
 * @param {string} opts.recordingId — used to namespace output files
 * @param {number} opts.infographicId — primary key from DB row
 *
 * @returns {Promise<{ paths: string[], cost: number, prompt: string }>}
 */
export async function generateInfographic(opts) {
  const {
    structure,
    style,
    customPrompt,
    aspectRatio = '2:3',
    quality = 'medium',
    model = 'gpt-image-1',
    n = 1,
    referenceImages = [],
    recordingId,
    infographicId,
  } = opts;

  if (!MODELS[model]) {
    throw new Error(`未対応のモデル: ${model}`);
  }
  if (n < 1 || n > 4) {
    throw new Error('生成枚数は 1〜4 の範囲で指定してください');
  }

  const client = getOpenAIClient();
  const size = resolveSize(model, aspectRatio);
  const prompt = buildPrompt({ structure, style, customPrompt, aspectRatio });

  console.log(`[Infographic] model=${model} size=${size} quality=${quality} n=${n} refs=${referenceImages.length}`);

  // If reference images provided, use the edit endpoint (multipart).
  // Otherwise use the generation endpoint.
  let response;
  try {
    if (referenceImages.length > 0) {
      // Build a FormData-like input via OpenAI SDK's `images.edit`.
      // SDK accepts file buffers via toFile-equivalent shape.
      const { toFile } = await import('openai');
      const files = await Promise.all(referenceImages.map((r, i) =>
        toFile(r.buffer, r.name || `ref_${i}.png`, { type: r.mime || 'image/png' })
      ));
      response = await client.images.edit({
        model,
        image: files,
        prompt,
        size,
        quality,
        n,
      });
    } else {
      response = await client.images.generate({
        model,
        prompt,
        size,
        quality,
        n,
        // gpt-image-1 returns base64 by default; we store files locally.
      });
    }
  } catch (err) {
    if (err.status === 400) {
      throw new Error(`画像生成API エラー: ${err.message || err.code || '不明な400エラー'}。プロンプト内容や画像参照を確認してください。`);
    }
    if (err.status === 401 || err.status === 403) {
      throw new Error('OpenAI APIキーが無効です。設定画面で確認してください。');
    }
    if (err.status === 429) {
      throw new Error('OpenAIのレート制限に達しました。少し待ってから再試行してください。');
    }
    throw err;
  }

  // Save each generated image (base64 → PNG file)
  const outDir = getInfographicDir();
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const paths = [];
  for (let i = 0; i < (response.data?.length || 0); i++) {
    const item = response.data[i];
    const b64 = item.b64_json || item.b64 || null;
    if (!b64) {
      console.warn(`[Infographic] response item ${i} has no b64_json`);
      continue;
    }
    const filename = `rec_${recordingId}_ig_${infographicId}_${i + 1}.png`;
    const fp = path.join(outDir, filename);
    fs.writeFileSync(fp, Buffer.from(b64, 'base64'));
    paths.push(filename); // store relative; getInfographicDir() resolves
  }

  if (paths.length === 0) {
    throw new Error('画像が生成されませんでした（APIから空の応答）');
  }

  return {
    paths,
    cost: estimateCost(model, quality, paths.length),
    prompt,
    size,
  };
}

export { resolveSize, estimateCost, MODELS };
