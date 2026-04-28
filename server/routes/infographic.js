import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { exec } from 'child_process';
import { execute, queryOne, queryAll, lastInsertRowId } from '../db/database.js';
import { getInfographicDir, getInfographicRefsDir, getRuntimeMode } from '../utils/platform-paths.js';
import { listStyles } from '../services/infographic/styles.js';
import { structureForInfographic } from '../services/infographic/structurer.js';
import { generateInfographic, MODELS } from '../services/infographic/generator.js';

const router = Router();

// Image generation is expensive — keep the rate limiter strict.
const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '画像生成リクエストが多すぎます。少し待ってから再試行してください。' },
});

// In-memory uploads up to ~12MB each (gpt-image-1 accepts up to 50MB but we cap)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 8 },
});

// ------------------------------------------------------------------
// GET /api/infographic/styles — list available style presets (for UI)
// ------------------------------------------------------------------
router.get('/styles', (req, res) => {
  res.json({
    styles: listStyles(),
    models: Object.keys(MODELS).map((key) => ({
      key,
      qualities: Object.keys(MODELS[key].pricing),
      pricing: MODELS[key].pricing,
    })),
  });
});

// ------------------------------------------------------------------
// POST /api/recordings/:id/infographic/structure
//   Body: { mode: 'whole' | 'split', source: 'summary' | 'transcript',
//           provider, model, summary_id }
//   Returns: { structure: {...} }
// ------------------------------------------------------------------
router.post('/recordings/:id/structure', async (req, res) => {
  try {
    const recording = queryOne('SELECT id FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) return res.status(404).json({ error: '録音が見つかりません' });

    const mode = req.body?.mode === 'split' ? 'split' : 'whole';
    const source = req.body?.source === 'transcript' ? 'transcript' : 'summary';

    let text = '';
    if (source === 'summary') {
      // Use the most recent summary, or specific summary_id if provided
      const sumId = req.body?.summary_id;
      const sum = sumId
        ? queryOne('SELECT content FROM summaries WHERE id = ? AND recording_id = ?', [sumId, req.params.id])
        : queryOne('SELECT content FROM summaries WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1', [req.params.id]);
      if (!sum) {
        return res.status(400).json({ error: '要約がありません。先に要約を生成してください（または source=transcript で文字起こし全文から作成可能）' });
      }
      text = sum.content;
    } else {
      const trans = queryOne(
        'SELECT segments_json, refined_segments_json FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
        [req.params.id]
      );
      if (!trans) return res.status(400).json({ error: '文字起こしがありません' });
      try {
        const segs = trans.refined_segments_json
          ? JSON.parse(trans.refined_segments_json)
          : JSON.parse(trans.segments_json);
        text = segs.map((s) => `${s.speaker || ''}: ${s.text || ''}`).join('\n');
      } catch (e) {
        return res.status(400).json({ error: '文字起こしのパースに失敗しました' });
      }
    }

    const structure = await structureForInfographic(text, {
      mode,
      provider: req.body?.provider,
      model: req.body?.model,
    });

    res.json({ structure, mode, source });
  } catch (err) {
    console.error('Structure error:', err);
    res.status(500).json({ error: err.message || '構造化に失敗しました' });
  }
});

// ------------------------------------------------------------------
// POST /api/recordings/:id/infographic/generate
//   multipart form-data:
//     - structure (string, JSON)        REQUIRED
//     - style (string)                  REQUIRED ('business'|'pop'|'natural'|'minimal'|'custom')
//     - custom_prompt (string)          optional
//     - aspect_ratio (string)           default '2:3'
//     - quality (string)                default 'medium'
//     - model (string)                  default 'gpt-image-1'
//     - n (number)                      default 1
//     - block_id (string)               optional, for split mode
//     - preset_id (number)              optional — load reference images from preset
//     - reference_image_<N> (file)      optional, up to 8 files
//   Returns: { infographic: {...} }
// ------------------------------------------------------------------
router.post(
  '/recordings/:id/generate',
  imageLimiter,
  upload.array('reference_images', 8),
  async (req, res) => {
    try {
      const recording = queryOne('SELECT id FROM recordings WHERE id = ?', [req.params.id]);
      if (!recording) return res.status(404).json({ error: '録音が見つかりません' });

      let structure;
      try {
        structure = JSON.parse(req.body.structure);
      } catch {
        return res.status(400).json({ error: 'structure JSONが不正です' });
      }

      const style = req.body.style || 'natural';
      const customPrompt = req.body.custom_prompt || null;
      const aspectRatio = req.body.aspect_ratio || '2:3';
      const quality = req.body.quality || 'medium';
      const model = req.body.model || 'gpt-image-1';
      const n = Math.max(1, Math.min(4, parseInt(req.body.n) || 1));
      const blockId = req.body.block_id || null;

      // Collect reference images:
      //   1) Files uploaded in this request
      //   2) Files from a saved preset (if preset_id given)
      const refs = [];
      if (Array.isArray(req.files)) {
        for (const f of req.files) {
          refs.push({ buffer: f.buffer, mime: f.mimetype, name: f.originalname });
        }
      }
      if (req.body.preset_id) {
        const preset = queryOne('SELECT * FROM infographic_presets WHERE id = ?', [Number(req.body.preset_id)]);
        if (preset?.reference_image_paths_json) {
          try {
            const paths = JSON.parse(preset.reference_image_paths_json);
            for (const p of paths) {
              const full = path.join(getInfographicRefsDir(), p);
              if (fs.existsSync(full)) {
                refs.push({
                  buffer: fs.readFileSync(full),
                  mime: 'image/png',
                  name: p,
                });
              }
            }
          } catch {}
        }
      }

      // Insert a placeholder row so we can use its id for filenames.
      execute(
        `INSERT INTO infographics (recording_id, block_id, structure_json, style, custom_prompt,
                                   aspect_ratio, quality, model, image_paths_json, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          blockId,
          JSON.stringify(structure),
          style,
          customPrompt,
          aspectRatio,
          quality,
          model,
          '[]',
          0,
        ]
      );
      const infographicId = lastInsertRowId();

      let result;
      try {
        result = await generateInfographic({
          structure,
          style,
          customPrompt,
          aspectRatio,
          quality,
          model,
          n,
          referenceImages: refs,
          recordingId: req.params.id,
          infographicId,
        });
      } catch (err) {
        // Roll back the placeholder row on failure
        execute('DELETE FROM infographics WHERE id = ?', [infographicId]);
        throw err;
      }

      // Update the row with the actual produced files + cost
      execute(
        'UPDATE infographics SET image_paths_json = ?, cost_usd = ? WHERE id = ?',
        [JSON.stringify(result.paths), result.cost, infographicId]
      );

      const row = queryOne('SELECT * FROM infographics WHERE id = ?', [infographicId]);
      res.status(201).json({ infographic: row });
    } catch (err) {
      console.error('Generate infographic error:', err);
      res.status(500).json({ error: err.message || '画像生成に失敗しました' });
    }
  }
);

// ------------------------------------------------------------------
// GET /api/recordings/:id/infographics — list past generations
// ------------------------------------------------------------------
router.get('/recordings/:id/list', (req, res) => {
  try {
    const rows = queryAll(
      'SELECT * FROM infographics WHERE recording_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    // Annotate each row with whether the actual image files exist on disk —
    // helps diagnose the "row exists but image won't load" case.
    for (const r of rows) {
      let paths = [];
      try { paths = JSON.parse(r.image_paths_json || '[]'); } catch {}
      r._files_present = paths.map((p) => ({
        path: p,
        exists: fs.existsSync(path.join(getInfographicDir(), p)),
      }));
    }
    res.json({ infographics: rows });
  } catch (err) {
    console.error('List infographics error:', err);
    res.status(500).json({ error: '一覧取得に失敗しました' });
  }
});

// ------------------------------------------------------------------
// GET /api/infographics/:id/image/:n — stream the Nth image (1-indexed)
// ------------------------------------------------------------------
router.get('/:id/image/:n', (req, res) => {
  try {
    const ig = queryOne('SELECT * FROM infographics WHERE id = ?', [req.params.id]);
    if (!ig) return res.status(404).json({ error: '画像が見つかりません' });

    let paths = [];
    try { paths = JSON.parse(ig.image_paths_json) || []; } catch {}
    const idx = parseInt(req.params.n) - 1;
    if (idx < 0 || idx >= paths.length) return res.status(404).json({ error: '画像が範囲外です' });

    const fp = path.join(getInfographicDir(), paths[idx]);
    if (!fp.startsWith(path.resolve(getInfographicDir()))) {
      return res.status(403).json({ error: 'invalid path' });
    }
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'ファイルが見つかりません' });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(fp).pipe(res);
  } catch (err) {
    console.error('Stream infographic image error:', err);
    res.status(500).json({ error: '画像配信に失敗しました' });
  }
});

// ------------------------------------------------------------------
// POST /api/infographic/:id/reveal — open the OS file manager at the image.
// Body: { n: 1 }  (1-indexed image number, default 1)
// Same Electron/Standalone-only constraint as recordings/reveal.
// ------------------------------------------------------------------
router.post('/:id/reveal', (req, res) => {
  try {
    const mode = getRuntimeMode();
    if (mode !== 'electron' && mode !== 'standalone') {
      return res.status(403).json({ error: 'この環境ではエクスプローラを開けません' });
    }
    const ig = queryOne('SELECT * FROM infographics WHERE id = ?', [req.params.id]);
    if (!ig) return res.status(404).json({ error: '画像が見つかりません' });

    let paths = [];
    try { paths = JSON.parse(ig.image_paths_json) || []; } catch {}
    const idx = Math.max(0, (parseInt(req.body?.n) || 1) - 1);
    if (idx >= paths.length) return res.status(404).json({ error: '画像が範囲外です' });

    const fp = path.join(getInfographicDir(), paths[idx]);
    if (!fp.startsWith(path.resolve(getInfographicDir()))) {
      return res.status(403).json({ error: 'invalid path' });
    }
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'ファイルが見つかりません' });

    let cmd;
    switch (process.platform) {
      case 'win32':
        cmd = `explorer.exe /select,"${fp.replace(/\//g, '\\')}"`;
        break;
      case 'darwin':
        cmd = `open -R "${fp}"`;
        break;
      default:
        cmd = `xdg-open "${path.dirname(fp)}"`;
    }
    exec(cmd, (err) => {
      // explorer.exe always returns code 1 on success — ignore Windows errors
      if (err && process.platform !== 'win32') {
        console.warn('[Infographic reveal] exec error:', err.message);
      }
    });
    res.json({ success: true, path: fp });
  } catch (err) {
    console.error('Reveal infographic error:', err);
    res.status(500).json({ error: 'エクスプローラを開けませんでした' });
  }
});

// ------------------------------------------------------------------
// DELETE /api/infographics/:id — delete a generation (DB row + image files)
// ------------------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const ig = queryOne('SELECT * FROM infographics WHERE id = ?', [req.params.id]);
    if (!ig) return res.status(404).json({ error: '画像が見つかりません' });

    let paths = [];
    try { paths = JSON.parse(ig.image_paths_json) || []; } catch {}
    for (const rel of paths) {
      const fp = path.join(getInfographicDir(), rel);
      if (fp.startsWith(path.resolve(getInfographicDir())) && fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch {}
      }
    }
    execute('DELETE FROM infographics WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete infographic error:', err);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// ------------------------------------------------------------------
// Presets — saved reference images + default style ("brand kit")
// ------------------------------------------------------------------
router.get('/presets', (req, res) => {
  try {
    const rows = queryAll('SELECT * FROM infographic_presets ORDER BY updated_at DESC');
    res.json({ presets: rows });
  } catch (err) {
    res.status(500).json({ error: 'プリセット一覧取得に失敗しました' });
  }
});

router.post('/presets', upload.array('reference_images', 8), (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '名前は必須です' });

    const refsDir = getInfographicRefsDir();
    if (!fs.existsSync(refsDir)) fs.mkdirSync(refsDir, { recursive: true });

    const saved = [];
    if (Array.isArray(req.files)) {
      for (let i = 0; i < req.files.length; i++) {
        const f = req.files[i];
        const ext = path.extname(f.originalname || '.png').toLowerCase() || '.png';
        const filename = `preset_${Date.now()}_${i + 1}${ext}`;
        fs.writeFileSync(path.join(refsDir, filename), f.buffer);
        saved.push(filename);
      }
    }

    execute(
      `INSERT INTO infographic_presets (name, reference_image_paths_json, default_style, default_aspect_ratio, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [
        name,
        JSON.stringify(saved),
        req.body.default_style || null,
        req.body.default_aspect_ratio || null,
        req.body.notes || null,
      ]
    );
    const id = lastInsertRowId();
    const preset = queryOne('SELECT * FROM infographic_presets WHERE id = ?', [id]);
    res.status(201).json({ preset });
  } catch (err) {
    console.error('Create preset error:', err);
    res.status(500).json({ error: 'プリセット作成に失敗しました' });
  }
});

router.delete('/presets/:id', (req, res) => {
  try {
    const preset = queryOne('SELECT * FROM infographic_presets WHERE id = ?', [req.params.id]);
    if (!preset) return res.status(404).json({ error: 'プリセットが見つかりません' });

    let paths = [];
    try { paths = JSON.parse(preset.reference_image_paths_json) || []; } catch {}
    for (const rel of paths) {
      const fp = path.join(getInfographicRefsDir(), rel);
      if (fp.startsWith(path.resolve(getInfographicRefsDir())) && fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch {}
      }
    }
    execute('DELETE FROM infographic_presets WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete preset error:', err);
    res.status(500).json({ error: 'プリセット削除に失敗しました' });
  }
});

// ------------------------------------------------------------------
// GET /api/infographic-presets/:id/image/:n — stream a preset's reference image
// (used by the client to preview saved presets)
// ------------------------------------------------------------------
router.get('/presets/:id/image/:n', (req, res) => {
  try {
    const preset = queryOne('SELECT * FROM infographic_presets WHERE id = ?', [req.params.id]);
    if (!preset) return res.status(404).json({ error: 'プリセットが見つかりません' });

    let paths = [];
    try { paths = JSON.parse(preset.reference_image_paths_json) || []; } catch {}
    const idx = parseInt(req.params.n) - 1;
    if (idx < 0 || idx >= paths.length) return res.status(404).json({ error: '画像が範囲外です' });

    const fp = path.join(getInfographicRefsDir(), paths[idx]);
    if (!fp.startsWith(path.resolve(getInfographicRefsDir()))) {
      return res.status(403).json({ error: 'invalid path' });
    }
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'ファイルが見つかりません' });

    const ext = path.extname(fp).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(fp).pipe(res);
  } catch (err) {
    console.error('Preset image error:', err);
    res.status(500).json({ error: '画像配信に失敗しました' });
  }
});

export default router;
