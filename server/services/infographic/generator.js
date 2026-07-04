import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { getInfographicDir } from '../../utils/platform-paths.js';
import { isManagedMode } from '../managed.js';
import { getStyle } from './styles.js';

/**
 * Supported image model: gpt-image-2 only.
 *
 * gpt-image-2 (released 2026-04) is the only model we use because:
 *   - Multilingual text rendering (Japanese / Chinese / Korean) at >99% accuracy.
 *     gpt-image-1 / 1-mini / 1.5 cannot reliably render Japanese — unusable
 *     for our infographic feature whose entire purpose is rendering Japanese
 *     text faithfully.
 *   - Flexible sizes: any edge ≤3840px, divisible by 16, aspect ≤3:1,
 *     total pixels 655,360..8,294,400. We expose curated presets below.
 *   - True 9:16 / 16:9 ratios (gpt-image-1 had to fall back to 2:3 / 3:2).
 */
const MODELS = {
  'gpt-image-2': {
    sizes: {
      '1:1':  '1024x1024',
      '2:3':  '1024x1536',
      '3:2':  '1536x1024',
      '9:16': '1024x1824', // true 9:16 (1024 * 16/9 ≈ 1820, rounded to 16-mult)
      '16:9': '1824x1024',
      '4:5':  '1024x1280',
    },
    // Token-based pricing (USD per image, approx) for the size we actually
    // generate. Used only for cost estimation in the UI / DB.
    pricing: { low: 0.006, medium: 0.053, high: 0.211 },
  },
};

const DEFAULT_MODEL = 'gpt-image-2';

function resolveSize(model, aspectRatio) {
  const cfg = MODELS[model];
  if (!cfg) throw new Error(`Unknown image model: ${model}`);
  return cfg.sizes[aspectRatio] || '1024x1024';
}

function estimateCost(model, quality, n) {
  const cfg = MODELS[model];
  if (!cfg) return 0;
  // 'auto' is decided by OpenAI at generation time — we can't know the
  // exact cost upfront. Use medium as a representative estimate.
  const lookup = quality === 'auto' ? 'medium' : quality;
  const per = cfg.pricing[lookup] ?? cfg.pricing.medium;
  return per * n;
}

/**
 * Build the final prompt sent to gpt-image-2.
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
 * @param {string} opts.model       — 'gpt-image-2' (only supported value)
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
    quality = 'low',
    model = DEFAULT_MODEL,
    n = 1,
    referenceImages = [],
    recordingId,
    infographicId,
  } = opts;

  if (!MODELS[model]) {
    throw new Error(`未対応のモデル: ${model}（gpt-image-2 のみ対応）`);
  }
  // gpt-image-2 quality: 'auto' (default) | 'low' | 'medium' | 'high'
  const VALID_QUALITY = new Set(['auto', 'low', 'medium', 'high']);
  if (!VALID_QUALITY.has(quality)) {
    throw new Error(`未対応の品質: ${quality}（auto / low / medium / high のいずれか）`);
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
        // gpt-image-2 returns base64 by default; we store files locally.
      });
    }
  } catch (err) {
    // Show the actual API message — generic messages like "key is invalid"
    // are misleading when the real cause is e.g. "gpt-image-2 requires
    // organization verification" or "model not yet enabled on this account".
    const apiMsg = err?.error?.message || err?.message || err?.code || '不明なエラー';
    const apiCode = err?.error?.code || err?.code || '';
    const apiType = err?.error?.type || err?.type || '';
    const detail = `${apiMsg}${apiCode ? ` [code=${apiCode}]` : ''}${apiType ? ` [type=${apiType}]` : ''}`;
    console.error(`[Infographic] OpenAI API error status=${err.status} detail=${detail}`);

    if (err.status === 400) {
      throw new Error(`画像生成APIエラー(400): ${detail}`);
    }
    if (err.status === 401) {
      throw new Error(`OpenAI 認証エラー(401): ${detail}\nAPIキーが無効か期限切れの可能性があります。設定画面で確認してください。`);
    }
    if (err.status === 403) {
      // Most common 403 cause for new models: org not verified / model not
      // yet rolled out to this account. DO NOT say "key is invalid" — that
      // sends users on a wild goose chase when the key is fine.
      throw new Error(
        `OpenAI アクセス拒否(403): ${detail}\n`
        + `APIキー自体は有効でも、gpt-image-2 に組織が未対応の可能性があります。`
        + `\n対処: ① https://platform.openai.com/settings/organization/general で組織の Verification を完了`
        + `\n      ② プロジェクトのモデル許可リストに gpt-image-2 が含まれているか確認`
      );
    }
    if (err.status === 404) {
      throw new Error(
        `モデルが見つかりません(404): ${detail}\n`
        + `gpt-image-2 がこのAPIキーでまだ使えない可能性があります。`
        + `組織の Verification が完了しているか、または OpenAI のロールアウト対象か確認してください。`
      );
    }
    if (err.status === 429) {
      throw new Error(`OpenAI レート制限(429): ${detail}\n少し待ってから再試行してください。`);
    }
    if (err.status >= 500) {
      throw new Error(`OpenAI サーバーエラー(${err.status}): ${detail}\n時間を置いて再試行してください。`);
    }
    throw new Error(`画像生成失敗: ${detail}`);
  }

  // Save each generated image. gpt-image-2 returns b64_json by default,
  // but some accounts / fallback paths may return only `url`. Handle both.
  const outDir = getInfographicDir();
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Diagnostic: log shape of response so post-mortem is easy if something breaks.
  // Top-level keys help us catch SDK version mismatches where the response
  // payload moves between fields (data → output → images, etc.) across major
  // SDK upgrades.
  const topKeys = Object.keys(response || {}).join(',');
  console.log(`[Infographic] response top-level keys: ${topKeys}`);

  // gpt-image-2 may return data under several possible field names depending
  // on SDK version. Be defensive and check the most likely candidates.
  const dataArr =
    (Array.isArray(response.data) && response.data)
    || (Array.isArray(response.images) && response.images)
    || (Array.isArray(response.output) && response.output)
    || (Array.isArray(response.results) && response.results)
    || [];
  const shapes = dataArr.map((item, i) => {
    const keys = Object.keys(item || {});
    const sample = keys.slice(0, 6).join(',');
    return `[${i}: ${sample || 'empty'}]`;
  }).join(' ');
  console.log(`[Infographic] Got ${dataArr.length} item(s) from API. Shapes: ${shapes}`);

  // If we got 0 items, dump a small slice of the raw response so we can
  // figure out what the SDK actually gave us.
  if (dataArr.length === 0) {
    try {
      const rawSnippet = JSON.stringify(response, null, 2).slice(0, 800);
      console.warn(`[Infographic] Empty data array — raw response snippet:\n${rawSnippet}`);
    } catch (e) {
      console.warn(`[Infographic] Empty data array (could not stringify): ${e.message}`);
    }
  }

  const paths = [];
  // Filename pattern was previously `rec_<recId>_ig_<rowId>_<n>.png`. That
  // looks unique but breaks if the DB is reset / recreated — new row id 1
  // would overwrite the old row id 1's PNG that's still on disk. We now
  // include a millisecond timestamp so two generations can never collide,
  // even across DB rebuilds.
  const ts = Date.now();
  for (let i = 0; i < dataArr.length; i++) {
    const item = dataArr[i] || {};
    const filename = `rec_${recordingId}_ig_${infographicId}_${ts}_${i + 1}.png`;
    const fp = path.join(outDir, filename);

    // Belt-and-suspenders: refuse to clobber an existing file. With the
    // timestamp this should never happen, but better to fail loudly than
    // silently overwrite a user's prior generation.
    if (fs.existsSync(fp)) {
      console.warn(`[Infographic] Refusing to overwrite existing file: ${fp}`);
      continue;
    }

    try {
      // Try every known b64 field name across SDK versions / model families.
      const b64 =
        item.b64_json
        || item.b64
        || item.image
        || item.image_b64
        || item.data
        || (item.content && item.content.b64_json)
        || null;
      const url = item.url || item.image_url || item.href || null;

      if (b64 && typeof b64 === 'string') {
        fs.writeFileSync(fp, Buffer.from(b64, 'base64'));
        paths.push(filename);
      } else if (url) {
        // Fallback: some models return a URL instead of base64. Fetch it.
        console.log(`[Infographic] Item ${i} returned URL, fetching: ${url}`);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(fp, buf);
        paths.push(filename);
      } else {
        console.warn(`[Infographic] Item ${i} has no recognized b64/url field. All keys: ${Object.keys(item).join(',')}`);
        try {
          console.warn(`[Infographic] Item ${i} value snippet: ${JSON.stringify(item).slice(0, 400)}`);
        } catch {}
      }
    } catch (writeErr) {
      console.error(`[Infographic] Failed to save item ${i}:`, writeErr.message);
    }
  }

  if (paths.length === 0) {
    // Detailed error so the user can see what came back
    throw new Error(`画像が生成されませんでした。APIレスポンス: items=${dataArr.length}, shapes=${shapes}`);
  }
  console.log(`[Infographic] Saved ${paths.length} file(s) to ${outDir}`);

  // Auto-export copy: same pattern as audio export — if the user has set
  // EXPORT_INFOGRAPHIC_PATH in settings, copy each generated PNG to that
  // folder using a human-readable filename so they can immediately see /
  // post-process the images outside the app.
  const exportDir = process.env.EXPORT_INFOGRAPHIC_PATH;
  if (exportDir) {
    try {
      const realExport = fs.realpathSync(exportDir);
      const stat = fs.statSync(realExport);
      if (stat.isDirectory()) {
        // Build a filename prefix that's friendly to humans:
        //   <recordingId>_<style>_<aspect>_<quality>_<infographicId>_<n>.png
        const safeStyle = (style || 'style').replace(/[^a-z0-9_-]/gi, '');
        const safeAspect = (aspectRatio || 'auto').replace(':', 'x');
        const safeQuality = (quality || 'medium').replace(/[^a-z0-9]/gi, '');
        for (let i = 0; i < paths.length; i++) {
          const src = path.join(outDir, paths[i]);
          const exportName = `${recordingId}_${safeStyle}_${safeAspect}_${safeQuality}_ig${infographicId}_${i + 1}.png`;
          const dest = path.join(realExport, exportName);
          if (!path.resolve(dest).startsWith(path.resolve(realExport))) {
            console.warn(`[InfographicExport] Path traversal blocked: ${dest}`);
            continue;
          }
          try {
            fs.copyFileSync(src, dest);
            console.log(`[InfographicExport] Copied ${dest}`);
          } catch (e) {
            console.warn(`[InfographicExport] copy failed: ${e.message}`);
          }
        }
      } else {
        console.warn(`[InfographicExport] Not a directory: ${realExport}`);
      }
    } catch (e) {
      console.warn(`[InfographicExport] Path error: ${e.message}`);
    }
  }

  return {
    paths,
    cost: estimateCost(model, quality, paths.length),
    prompt,
    size,
  };
}

export { resolveSize, estimateCost, MODELS, DEFAULT_MODEL };
