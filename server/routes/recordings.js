import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { execute, queryOne, queryAll, lastInsertRowId } from '../db/database.js';
import { transcribe } from '../services/transcription/index.js';
import { summarize } from '../services/summary/index.js';
import { runPipeline } from '../services/pipeline.js';
import { getAudioDuration } from '../utils/audio.js';
import { validateModel } from '../middleware/tier.js';
import { getAppDataDir, getAudioDir, getRuntimeMode } from '../utils/platform-paths.js';
import { exec } from 'child_process';

// Rate limiter for AI-heavy endpoints (transcribe, summarize, ask)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,             // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。しばらく待ってから再試行してください。' },
});

// Rate limiter for file uploads (disk space protection)
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,              // 5 uploads per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'アップロードが多すぎます。しばらく待ってから再試行してください。' },
});

const router = Router();

const DATA_DIR = getAppDataDir();
const AUDIO_DIR = getAudioDir();

// Ensure audio directory exists
fs.mkdirSync(AUDIO_DIR, { recursive: true });

/**
 * Resolve audio path safely, preventing directory traversal.
 * Returns null if the resolved path escapes AUDIO_DIR.
 */
function safeAudioPath(filePath) {
  const resolved = path.resolve(AUDIO_DIR, filePath);
  if (!resolved.startsWith(path.resolve(AUDIO_DIR))) return null;
  return resolved;
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIO_DIR),
  filename: (req, file, cb) => {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const uuid = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `rec_${ts}_${uuid}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.webm', '.ogg', '.flac'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported format: ${ext}. Allowed: ${allowed.join(', ')}`));
    }
  },
});

// POST /api/recordings/upload — Upload audio file
router.post('/upload', uploadLimiter, upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'ファイルが選択されていません' });
    }

    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const id = `rec_${ts}`;
    const title = req.body.title || null;

    execute(
      `INSERT INTO recordings (id, title, file_path, recorded_at, status)
       VALUES (?, ?, ?, ?, 'uploaded')`,
      [id, title, req.file.filename, now.toISOString()]
    );

    // Save highlights if provided
    if (req.body.highlights) {
      try {
        const highlights = JSON.parse(req.body.highlights);
        if (!Array.isArray(highlights)) throw new Error('not array');
        for (const h of highlights) {
          const ts = Number(h.timestamp);
          const label = String(h.label || '').slice(0, 500);
          if (!Number.isFinite(ts)) continue;
          execute(
            'INSERT INTO highlights (recording_id, timestamp_sec, label) VALUES (?, ?, ?)',
            [id, ts, label]
          );
        }
      } catch (e) {
        console.warn('Failed to parse highlights:', e.message);
      }
    }

    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [id]);

    // Auto-export copy (fire and forget) with path validation
    const exportDir = process.env.EXPORT_AUDIO_PATH;
    if (exportDir) {
      try {
        // Resolve symlinks to prevent symlink attacks
        const realExport = fs.realpathSync(exportDir);
        const stat = fs.statSync(realExport);
        if (stat.isDirectory()) {
          const src = path.join(AUDIO_DIR, req.file.filename);
          const dest = path.join(realExport, req.file.filename);
          // Ensure dest stays within the export directory
          if (!path.resolve(dest).startsWith(path.resolve(realExport))) {
            console.warn(`[Export] Path traversal blocked: ${dest}`);
          } else {
            fs.copyFile(src, dest, (err) => {
              if (err) console.warn(`[Export] Failed to copy to ${dest}:`, err.message);
              else console.log(`[Export] Copied to ${dest}`);
            });
          }
        } else {
          console.warn(`[Export] EXPORT_AUDIO_PATH is not a directory: ${realExport}`);
        }
      } catch (e) {
        console.warn(`[Export] EXPORT_AUDIO_PATH error: ${e.message}`);
      }
    }

    // Upload options: auto_summarize, template_id, granularity
    const autoSummarize = req.body.auto_summarize !== 'false'; // default true
    const pipelineOptions = {};
    if (req.body.template_id) pipelineOptions.templateId = req.body.template_id;
    if (req.body.granularity) pipelineOptions.granularity = req.body.granularity;
    if (req.body.provider) pipelineOptions.provider = req.body.provider;
    if (req.body.model) pipelineOptions.model = req.body.model;
    pipelineOptions.skipSummary = !autoSummarize;

    // Start pipeline in background (don't await)
    runPipeline(id, pipelineOptions).catch(err => {
      console.error(`Pipeline failed for ${id}:`, err.message);
    });

    res.status(201).json(recording);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'アップロードに失敗しました' });
  }
});

// Text upload for transcript files (txt/md)
const textUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.md', '.markdown'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// POST /api/recordings/upload-text — Upload pre-transcribed text
router.post('/upload-text', uploadLimiter, textUpload.single('textfile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'テキストファイルが選択されていません' });
    }

    // Read file with encoding auto-detection (handles UTF-8, UTF-16 BE/LE, etc.)
    const rawBuf = fs.readFileSync(path.join(AUDIO_DIR, req.file.filename));
    let textContent;
    if (rawBuf[0] === 0xFE && rawBuf[1] === 0xFF) {
      // UTF-16 Big Endian BOM
      textContent = rawBuf.slice(2).swap16().toString('utf16le');
    } else if (rawBuf[0] === 0xFF && rawBuf[1] === 0xFE) {
      // UTF-16 Little Endian BOM
      textContent = rawBuf.slice(2).toString('utf16le');
    } else if (rawBuf[0] === 0xEF && rawBuf[1] === 0xBB && rawBuf[2] === 0xBF) {
      // UTF-8 BOM
      textContent = rawBuf.slice(3).toString('utf-8');
    } else {
      textContent = rawBuf.toString('utf-8');
    }
    if (!textContent.trim()) {
      return res.status(400).json({ error: 'ファイルの中身が空です' });
    }

    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const uuid = crypto.randomBytes(8).toString('hex');
    const id = `txt_${ts}_${uuid}`;
    const originalFilename = req.file.originalname;
    // Initial title = filename (pipeline will regenerate from content)
    const title = req.body.title || originalFilename.replace(/\.[^.]+$/, '');

    // Create recording entry (no audio file — the text IS the content)
    execute(
      `INSERT INTO recordings (id, title, file_path, recorded_at, status, original_filename)
       VALUES (?, ?, ?, ?, 'transcribed', ?)`,
      [id, title, req.file.filename, now.toISOString(), originalFilename]
    );

    // Smart text parser: try local patterns first, then LLM fallback
    const { parseTextToSegments } = await import('../services/text-parser.js');
    const { segments, speakers, usedLLM } = await parseTextToSegments(textContent);

    if (segments.length === 0) {
      return res.status(400).json({ error: 'テキストからセグメントを抽出できませんでした' });
    }

    // Save transcription — if LLM was used, also save as refined (already cleaned)
    execute(
      `INSERT INTO transcriptions (recording_id, engine, language, segments_json, speakers_json, raw_response_json${usedLLM ? ', refined_segments_json' : ''})
       VALUES (?, ?, ?, ?, ?, ?${usedLLM ? ', ?' : ''})`,
      [
        id, 'text-upload', 'ja',
        JSON.stringify(segments), JSON.stringify(speakers), '{}',
        ...(usedLLM ? [JSON.stringify(segments)] : []),
      ]
    );

    // Upload options
    const autoSummarize = req.body.auto_summarize !== 'false';
    const pipelineOptions = {
      skipTranscription: true,
      skipSummary: !autoSummarize,
      skipRefine: usedLLM, // LLM already refined during parsing
      parsedByLLM: usedLLM, // affects processed_locally determination
    };
    if (req.body.template_id) pipelineOptions.templateId = req.body.template_id;
    if (req.body.granularity) pipelineOptions.granularity = req.body.granularity;
    if (req.body.provider) pipelineOptions.provider = req.body.provider;
    if (req.body.model) pipelineOptions.model = req.body.model;

    // Run pipeline (refine + summarize, skip transcription)
    runPipeline(id, pipelineOptions).catch(err => {
      console.error(`Pipeline failed for ${id}:`, err.message);
    });

    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [id]);
    res.status(201).json(recording);
  } catch (err) {
    console.error('Text upload error:', err);
    res.status(500).json({ error: 'テキストアップロードに失敗しました' });
  }
});

// GET /api/recordings — List recordings
router.get('/', (req, res) => {
  try {
    const { tag, q, from, to, folder, importance } = req.query;
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    // state filter: 'active' (default) | 'archived' | 'trashed' | 'all'
    // include_archived=1 merges archived with active (for "search includes archived")
    const state = req.query.state || 'active';
    const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';

    let sql = 'SELECT r.* FROM recordings r';
    const params = [];
    const conditions = [];

    // Apply state filter
    if (state === 'active') {
      if (includeArchived) {
        conditions.push('r.trashed_at IS NULL');
      } else {
        conditions.push('r.archived_at IS NULL AND r.trashed_at IS NULL');
      }
    } else if (state === 'archived') {
      conditions.push('r.archived_at IS NOT NULL AND r.trashed_at IS NULL');
    } else if (state === 'trashed') {
      conditions.push('r.trashed_at IS NOT NULL');
    }
    // 'all' → no state filter

    if (folder) {
      sql += ' JOIN recording_folders rf ON r.id = rf.recording_id';
      conditions.push('rf.folder_id = ?');
      params.push(Number(folder));
    }

    if (tag) {
      sql += ' JOIN recording_tags rt ON r.id = rt.recording_id JOIN tags t ON rt.tag_id = t.id';
      conditions.push('t.name = ?');
      params.push(tag);
    }

    if (q && q.length <= 200) {
      conditions.push(`(r.title LIKE ? OR r.id IN (
        SELECT recording_id FROM transcriptions WHERE segments_json LIKE ?
      ))`);
      params.push(`%${q}%`, `%${q}%`);
    }

    if (importance) {
      conditions.push('r.importance = ?');
      params.push(Number(importance));
    }

    if (from) {
      conditions.push('r.recorded_at >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('r.recorded_at <= ?');
      params.push(to);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY r.id ORDER BY r.recorded_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const recordings = queryAll(sql, params);

    // Attach tags for each recording
    for (const rec of recordings) {
      rec.tags = queryAll(
        `SELECT t.id, t.name, t.color, rt.source
         FROM tags t JOIN recording_tags rt ON t.id = rt.tag_id
         WHERE rt.recording_id = ?`,
        [rec.id]
      );
    }

    res.json(recordings);
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: '録音一覧の取得に失敗しました' });
  }
});

// GET /api/recordings/counts — Sidebar badge counts for active / archived / trash
// Returns { active, archived, trashed }.
router.get('/counts', (req, res) => {
  try {
    const row = queryOne(`
      SELECT
        SUM(CASE WHEN archived_at IS NULL AND trashed_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN archived_at IS NOT NULL AND trashed_at IS NULL THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN trashed_at IS NOT NULL THEN 1 ELSE 0 END) AS trashed
      FROM recordings
    `);
    res.json({
      active: Number(row?.active) || 0,
      archived: Number(row?.archived) || 0,
      trashed: Number(row?.trashed) || 0,
    });
  } catch (err) {
    console.error('Counts error:', err);
    res.status(500).json({ error: 'カウントの取得に失敗しました' });
  }
});

// ============================================
// Storage Management (must be before /:id routes)
// ============================================

// GET /api/recordings/storage — Get storage statistics
router.get('/storage', (req, res) => {
  try {
    const recordings = queryAll('SELECT id, file_path, importance FROM recordings');
    let totalSize = 0;
    let audioCount = 0;
    const byImportance = { 1: { count: 0, size: 0 }, 2: { count: 0, size: 0 }, 3: { count: 0, size: 0 } };

    for (const rec of recordings) {
      const audioPath = safeAudioPath(rec.file_path);
      let fileSize = 0;
      if (audioPath && fs.existsSync(audioPath)) {
        fileSize = fs.statSync(audioPath).size;
        audioCount++;
      }
      totalSize += fileSize;
      const imp = rec.importance || 1;
      if (byImportance[imp]) {
        byImportance[imp].count++;
        byImportance[imp].size += fileSize;
      }
    }

    const dbPath = path.join(DATA_DIR, 'voicescope.db');
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

    res.json({
      totalRecordings: recordings.length,
      audioFiles: audioCount,
      audioSize: totalSize,
      dbSize,
      totalSize: totalSize + dbSize,
      byImportance,
    });
  } catch (err) {
    console.error('Storage stats error:', err);
    res.status(500).json({ error: 'ストレージ情報の取得に失敗しました' });
  }
});

// DELETE /api/recordings/bulk — Bulk delete recordings by criteria
router.delete('/bulk', (req, res) => {
  try {
    const { importance, olderThanDays, audioOnly } = req.body || {};
    const conditions = [];
    const params = [];

    if (importance !== undefined) {
      conditions.push('r.importance = ?');
      params.push(Number(importance));
    }
    if (olderThanDays !== undefined) {
      conditions.push("r.recorded_at < datetime('now', ? || ' days')");
      params.push(`-${Math.abs(Number(olderThanDays))}`);
    }

    if (conditions.length === 0) {
      return res.status(400).json({ error: '削除条件を指定してください' });
    }

    const targets = queryAll(
      `SELECT r.id, r.file_path FROM recordings r WHERE ${conditions.join(' AND ')}`,
      params
    );

    let deletedCount = 0;
    let freedBytes = 0;

    for (const rec of targets) {
      const audioPath = safeAudioPath(rec.file_path);
      if (audioOnly) {
        if (audioPath && fs.existsSync(audioPath)) {
          freedBytes += fs.statSync(audioPath).size;
          fs.unlinkSync(audioPath);
          deletedCount++;
        }
      } else {
        if (audioPath && fs.existsSync(audioPath)) {
          freedBytes += fs.statSync(audioPath).size;
          fs.unlinkSync(audioPath);
        }
        execute('DELETE FROM recordings WHERE id = ?', [rec.id]);
        deletedCount++;
      }
    }

    res.json({ success: true, deletedCount, freedBytes, audioOnly: !!audioOnly });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: '一括削除に失敗しました' });
  }
});

// GET /api/recordings/:id — Get recording detail
router.get('/:id', (req, res) => {
  try {
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    recording.transcription = queryOne(
      'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    recording.summaries = queryAll(
      'SELECT s.*, t.name as template_name FROM summaries s LEFT JOIN templates t ON s.template_id = t.id WHERE s.recording_id = ? ORDER BY s.created_at DESC',
      [req.params.id]
    );
    recording.tags = queryAll(
      `SELECT t.id, t.name, t.color, rt.source
       FROM tags t JOIN recording_tags rt ON t.id = rt.tag_id
       WHERE rt.recording_id = ?`,
      [req.params.id]
    );
    recording.highlights = queryAll(
      'SELECT id, timestamp_sec, label FROM highlights WHERE recording_id = ? ORDER BY timestamp_sec',
      [req.params.id]
    );
    recording.folders = queryAll(
      `SELECT f.id, f.name, f.icon FROM folders f
       JOIN recording_folders rf ON f.id = rf.folder_id
       WHERE rf.recording_id = ?`,
      [req.params.id]
    );

    // Parse JSON fields
    if (recording.transcription) {
      try {
        recording.transcription.segments = JSON.parse(recording.transcription.segments_json);
        recording.transcription.speakers = JSON.parse(recording.transcription.speakers_json || '[]');
        if (recording.transcription.refined_segments_json) {
          recording.transcription.refined_segments = JSON.parse(recording.transcription.refined_segments_json);
        }
      } catch {}
    }

    // Parse summary segment selection
    if (recording.summary_segment_ids_json) {
      try {
        recording.summary_segment_ids = JSON.parse(recording.summary_segment_ids_json);
      } catch {
        recording.summary_segment_ids = [];
      }
    } else {
      recording.summary_segment_ids = [];
    }

    res.json(recording);
  } catch (err) {
    console.error('Detail error:', err);
    res.status(500).json({ error: '録音詳細の取得に失敗しました' });
  }
});

// POST /api/recordings/:id/transcribe — Run transcription
router.post('/:id/transcribe', aiLimiter, async (req, res) => {
  try {
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    // Guard: refuse if a transcription / refine / summary is already in flight.
    // Without this, mashing the "再実行" button would queue parallel jobs that
    // race on the transcriptions row and trip the rate limiter.
    if (['transcribing', 'refining', 'summarizing'].includes(recording.status)) {
      return res.status(409).json({
        error: `現在 ${recording.status} 中です。完了するまでお待ちください`,
        status: recording.status,
      });
    }

    const audioPath = safeAudioPath(recording.file_path);
    if (!audioPath || !fs.existsSync(audioPath)) {
      return res.status(404).json({ error: '音声ファイルが見つかりません' });
    }

    execute('UPDATE recordings SET status = ? WHERE id = ?', ['transcribing', req.params.id]);

    const options = {
      engine: req.body.engine,
      language: req.body.language,
      diarize: req.body.diarize,
    };

    const result = await transcribe(audioPath, options);

    // Get duration if not set
    if (!recording.duration_sec) {
      const duration = await getAudioDuration(audioPath);
      if (duration) {
        execute('UPDATE recordings SET duration_sec = ? WHERE id = ?', [duration, req.params.id]);
      }
    }

    // Save transcription
    execute(
      `INSERT INTO transcriptions (recording_id, engine, language, segments_json, speakers_json, raw_response_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        result.engine,
        result.language,
        JSON.stringify(result.segments),
        JSON.stringify(result.speakers),
        JSON.stringify(result.raw_response),
      ]
    );

    execute('UPDATE recordings SET status = ? WHERE id = ?', ['transcribed', req.params.id]);

    const transcription = queryOne(
      'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    transcription.segments = result.segments;
    transcription.speakers = result.speakers;

    res.json(transcription);
  } catch (err) {
    console.error('Transcription error:', err);
    execute('UPDATE recordings SET status = ? WHERE id = ?', ['error', req.params.id]);
    // Surface the actual error message so the user can fix the issue without
    // diving into server logs (e.g. "モデルがDLされていない" / "ffmpeg必要").
    // Strip stack traces to keep the toast readable.
    const detail = (err?.message || String(err) || '').slice(0, 400);
    res.status(500).json({
      error: `文字起こしに失敗しました: ${detail}`,
      detail,
    });
  }
});

// POST /api/recordings/:id/refine — Manually trigger transcription refinement
router.post('/:id/refine', aiLimiter, async (req, res) => {
  try {
    const transcription = queryOne(
      'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    if (!transcription) {
      return res.status(400).json({ error: '文字起こしがありません' });
    }

    const { refineTranscription } = await import('../services/refine.js');
    // Clear existing refinement to re-run
    execute('UPDATE transcriptions SET refined_segments_json = NULL WHERE id = ?', [transcription.id]);
    await refineTranscription(transcription.id);

    const updated = queryOne('SELECT * FROM transcriptions WHERE id = ?', [transcription.id]);
    res.json({
      refined: !!updated.refined_segments_json,
      segments: updated.refined_segments_json ? JSON.parse(updated.refined_segments_json) : null,
    });
  } catch (err) {
    console.error('Refine error:', err);
    res.status(500).json({ error: '整形に失敗しました' });
  }
});

// POST /api/recordings/:id/summarize — Generate summary
router.post('/:id/summarize', aiLimiter, validateModel('summary'), async (req, res) => {
  try {
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    const transcription = queryOne(
      'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    if (!transcription) {
      return res.status(400).json({ error: '先に文字起こしを実行してください' });
    }

    // Prefer refined segments if available, else use original
    let segments;
    try {
      segments = transcription.refined_segments_json
        ? JSON.parse(transcription.refined_segments_json)
        : JSON.parse(transcription.segments_json);
    } catch (e) {
      segments = [];
    }

    // Optional range selection: use only specified segment indices
    // If use_selection=true and recording has saved selection, use those
    // If selected_segment_ids passed explicitly, use those
    let filteredSegments = segments;
    let usedSelection = false;
    if (Array.isArray(req.body.selected_segment_ids) && req.body.selected_segment_ids.length > 0) {
      const ids = new Set(req.body.selected_segment_ids.map(Number));
      filteredSegments = segments.filter((_, i) => ids.has(i));
      usedSelection = true;
    } else if (req.body.use_selection && recording.summary_segment_ids_json) {
      try {
        const ids = new Set(JSON.parse(recording.summary_segment_ids_json).map(Number));
        if (ids.size > 0) {
          filteredSegments = segments.filter((_, i) => ids.has(i));
          usedSelection = true;
        }
      } catch {}
    }

    if (filteredSegments.length === 0) {
      return res.status(400).json({ error: '要約対象のテキストがありません' });
    }

    const fullText = filteredSegments
      .map(s => {
        const speaker = s.speaker || s.label || '';
        const text = s.text || '';
        return speaker ? `${speaker}: ${text}` : text;
      })
      .filter(line => line.trim())
      .join('\n');

    if (!fullText.trim()) {
      return res.status(400).json({ error: '要約対象のテキストが空です' });
    }

    console.log(`[Summarize] ${req.params.id}: ${usedSelection ? `selection ${filteredSegments.length}/${segments.length} segments` : 'full'}, ${fullText.length} chars`);

    const result = await summarize(fullText, {
      templateId: req.body.template_id,
      provider: req.body.provider,
      model: req.body.model,
      granularity: req.body.granularity,
      customPrompt: req.body.custom_prompt,
    });

    execute(
      `INSERT INTO summaries (recording_id, template_id, llm_provider, llm_model, content)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, result.templateId, result.provider, result.model, result.content]
    );

    const summaryId = lastInsertRowId();
    const summary = queryOne('SELECT * FROM summaries WHERE id = ?', [summaryId]);
    if (usedSelection) summary.used_selection = true;
    res.status(201).json(summary);
  } catch (err) {
    console.error('Summary error:', err);
    console.error('Summarize error:', err);
    res.status(500).json({ error: '要約生成に失敗しました。設定やAPIキーを確認してください。' });
  }
});

// POST /api/recordings/:id/ask — Ask AI a question about a recording
router.post('/:id/ask', aiLimiter, validateModel('ask'), async (req, res) => {
  try {
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    const transcription = queryOne(
      'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    if (!transcription) {
      return res.status(400).json({ error: '先に文字起こしを実行してください' });
    }

    const { question, history, provider, model } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ error: '質問を入力してください' });
    }

    let segments;
    try {
      segments = JSON.parse(transcription.segments_json);
    } catch (e) {
      segments = [];
    }
    const fullText = segments.map(s => `${s.speaker}: ${s.text}`).join('\n');

    // Build summaries context if available
    const summaries = queryAll(
      'SELECT content FROM summaries WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    const summaryContext = summaries.length > 0 ? `\n\n【要約】\n${summaries[0].content}` : '';

    // Build highlights context
    const hlRows = queryAll(
      'SELECT timestamp_sec, label FROM highlights WHERE recording_id = ? ORDER BY timestamp_sec',
      [req.params.id]
    );
    const highlightContext = hlRows.length > 0
      ? `\n\n【ハイライト・メモ】\n${hlRows.map(h => {
          const m = Math.floor(h.timestamp_sec / 60);
          const s = Math.floor(h.timestamp_sec % 60);
          const time = `${m}:${String(s).padStart(2, '0')}`;
          return `- ${time}${h.label ? ': ' + h.label : ' (マーク)'}`;
        }).join('\n')}`
      : '';

    // Build conversation history for multi-turn
    const historyText = (history || [])
      .map(h => `${h.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${h.content}`)
      .join('\n');
    const historySection = historyText ? `\n\n【これまでの会話】\n${historyText}` : '';

    const systemPrompt = `あなたは録音内容の分析アシスタントです。以下の文字起こしデータと要約に基づいて、ユーザーの質問に正確に回答してください。
回答は根拠となる発言を引用しながら、簡潔で分かりやすく回答してください。
文字起こしに含まれない情報については「この録音には該当する情報がありません」と答えてください。`;

    const userMessage = `【録音タイトル】${recording.title || '無題'}

【文字起こし】
${fullText}${summaryContext}${highlightContext}${historySection}

【質問】${question}`;

    // Use same provider resolution as summaries
    const { askLLM } = await import('../services/ask.js');
    const answer = await askLLM(userMessage, systemPrompt, { provider, model });

    // Save to chat history
    execute('INSERT INTO chat_messages (recording_id, role, content) VALUES (?, ?, ?)',
      [req.params.id, 'user', question]);
    execute('INSERT INTO chat_messages (recording_id, role, content) VALUES (?, ?, ?)',
      [req.params.id, 'assistant', answer]);

    res.json({ answer });
  } catch (err) {
    console.error('Ask AI error:', err);
    console.error('Ask error:', err);
    res.status(500).json({ error: 'AI応答に失敗しました。設定やAPIキーを確認してください。' });
  }
});

// GET /api/recordings/:id/chat — Get chat history
router.get('/:id/chat', (req, res) => {
  try {
    const messages = queryAll(
      'SELECT role, content, created_at FROM chat_messages WHERE recording_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(messages);
  } catch (err) {
    console.error('Chat history error:', err);
    res.status(500).json({ error: 'チャット履歴の取得に失敗しました' });
  }
});

// DELETE /api/recordings/:id/chat — Clear chat history
router.delete('/:id/chat', (req, res) => {
  try {
    execute('DELETE FROM chat_messages WHERE recording_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Chat clear error:', err);
    res.status(500).json({ error: 'チャット履歴の削除に失敗しました' });
  }
});

// DELETE /api/summaries/:id — Delete a summary
router.delete('/summaries/:id', (req, res) => {
  try {
    execute('DELETE FROM summaries WHERE id = ?', [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Summary delete error:', err);
    res.status(500).json({ error: '要約の削除に失敗しました' });
  }
});

// POST /api/recordings/:id/reprocess — Re-run full pipeline
router.post('/:id/reprocess', aiLimiter, (req, res) => {
  try {
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    // Clear previous error title
    if (recording.title?.startsWith('[Error]')) {
      execute('UPDATE recordings SET title = NULL WHERE id = ?', [req.params.id]);
    }

    // Reset status and re-run pipeline
    execute('UPDATE recordings SET status = ? WHERE id = ?', ['uploaded', req.params.id]);

    runPipeline(req.params.id).catch(err => {
      console.error(`Reprocess pipeline failed for ${req.params.id}:`, err.message);
    });

    res.json({ success: true, message: 'パイプラインを再実行しています' });
  } catch (err) {
    console.error('Reprocess error:', err);
    res.status(500).json({ error: '再処理に失敗しました' });
  }
});

// PATCH /api/recordings/:id — Update title / importance / summary selection
router.patch('/:id', (req, res) => {
  try {
    const { title, importance, summary_segment_ids, processed_locally, acknowledge_warning } = req.body;
    if (title !== undefined) {
      execute('UPDATE recordings SET title = ? WHERE id = ?', [title, req.params.id]);
    }
    if (importance !== undefined) {
      const val = Math.max(1, Math.min(3, Number(importance) || 1));
      execute('UPDATE recordings SET importance = ? WHERE id = ?', [val, req.params.id]);
    }
    if (summary_segment_ids !== undefined) {
      // Accept array of segment indices, or null/[] to clear
      const value = Array.isArray(summary_segment_ids) && summary_segment_ids.length > 0
        ? JSON.stringify(summary_segment_ids.map(Number).filter(n => Number.isFinite(n)))
        : null;
      execute('UPDATE recordings SET summary_segment_ids_json = ? WHERE id = ?', [value, req.params.id]);
    }
    if (processed_locally !== undefined) {
      execute('UPDATE recordings SET processed_locally = ? WHERE id = ?', [processed_locally ? 1 : 0, req.params.id]);
    }
    if (acknowledge_warning) {
      // Clear the refine warning (user has seen the toast)
      execute('UPDATE recordings SET refine_warning = NULL WHERE id = ?', [req.params.id]);
    }
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    res.json(recording);
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: '更新に失敗しました' });
  }
});

// POST /api/recordings/:id/archive — Move to archive (hidden from dashboard, still searchable opt-in)
router.post('/:id/archive', (req, res) => {
  try {
    const rec = queryOne('SELECT id FROM recordings WHERE id = ?', [req.params.id]);
    if (!rec) return res.status(404).json({ error: '録音が見つかりません' });
    // Archiving always clears trashed_at (mutually exclusive)
    execute(
      'UPDATE recordings SET archived_at = ?, trashed_at = NULL WHERE id = ?',
      [new Date().toISOString(), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Archive error:', err);
    res.status(500).json({ error: 'アーカイブに失敗しました' });
  }
});

// POST /api/recordings/:id/trash — Move to trash (will be auto-purged after N days)
router.post('/:id/trash', (req, res) => {
  try {
    const rec = queryOne('SELECT id FROM recordings WHERE id = ?', [req.params.id]);
    if (!rec) return res.status(404).json({ error: '録音が見つかりません' });
    execute(
      'UPDATE recordings SET trashed_at = ?, archived_at = NULL WHERE id = ?',
      [new Date().toISOString(), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Trash error:', err);
    res.status(500).json({ error: 'ゴミ箱への移動に失敗しました' });
  }
});

// POST /api/recordings/:id/restore — Restore from archive or trash back to active
router.post('/:id/restore', (req, res) => {
  try {
    const rec = queryOne('SELECT id FROM recordings WHERE id = ?', [req.params.id]);
    if (!rec) return res.status(404).json({ error: '録音が見つかりません' });
    execute('UPDATE recordings SET archived_at = NULL, trashed_at = NULL WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: '復元に失敗しました' });
  }
});

// POST /api/recordings/trash/empty — Permanently delete everything in trash
router.post('/trash/empty', (req, res) => {
  try {
    const items = queryAll('SELECT id, file_path FROM recordings WHERE trashed_at IS NOT NULL');
    for (const item of items) {
      const audioPath = safeAudioPath(item.file_path);
      if (audioPath && fs.existsSync(audioPath)) {
        try { fs.unlinkSync(audioPath); } catch {}
      }
      execute('DELETE FROM recordings WHERE id = ?', [item.id]);
    }
    res.json({ success: true, deleted: items.length });
  } catch (err) {
    console.error('Empty trash error:', err);
    res.status(500).json({ error: 'ゴミ箱の空操作に失敗しました' });
  }
});

// DELETE /api/recordings/:id — Move to trash (default) or permanently delete with ?permanent=1
router.delete('/:id', (req, res) => {
  try {
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    const permanent = req.query.permanent === '1' || req.query.permanent === 'true';

    if (!permanent) {
      // Soft delete: move to trash. The cleanup scheduler will purge after retention.
      execute(
        'UPDATE recordings SET trashed_at = ?, archived_at = NULL WHERE id = ?',
        [new Date().toISOString(), req.params.id]
      );
      return res.json({ success: true, trashed: true });
    }

    // Permanent delete: remove audio file and cascade-delete DB rows.
    const audioPath = safeAudioPath(recording.file_path);
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
    execute('DELETE FROM recordings WHERE id = ?', [req.params.id]);
    res.json({ success: true, permanent: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// POST /api/recordings/:id/reveal — Show the recording's audio file in the OS file manager.
// Body: { target: 'audio' | 'data_dir' } — 'audio' highlights the specific audio file,
//                                          'data_dir' opens the VoiceScope data folder (contains voicescape.db).
//
// Only available in Electron / Standalone modes — opening a file manager on a
// remote Docker host doesn't help the user (it would open on the server, not the client).
router.post('/:id/reveal', (req, res) => {
  try {
    const mode = getRuntimeMode();
    if (mode !== 'electron' && mode !== 'standalone') {
      return res.status(403).json({
        error: 'この環境ではエクスプローラを開けません（Docker/Web経由のため、サーバ側のファイルマネージャは開きません）',
      });
    }

    const target = req.body?.target || 'audio';

    if (target === 'data_dir') {
      const dir = getAppDataDir();
      openInFileManager(dir);
      return res.json({ success: true, path: dir, target });
    }

    // 'audio' — highlight the specific audio file
    const recording = queryOne('SELECT file_path FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) return res.status(404).json({ error: '録音が見つかりません' });

    const audioPath = safeAudioPath(recording.file_path);
    if (!audioPath || !fs.existsSync(audioPath)) {
      // Audio is missing (deleted, audio_only trash mode, etc.) — fall back to opening the folder.
      openInFileManager(getAudioDir());
      return res.json({ success: true, path: getAudioDir(), target: 'audio_dir_fallback' });
    }

    revealInFileManager(audioPath);
    res.json({ success: true, path: audioPath, target: 'audio' });
  } catch (err) {
    console.error('Reveal error:', err);
    res.status(500).json({ error: 'エクスプローラを開けませんでした' });
  }
});

/**
 * Highlight a specific file in the OS file manager (cross-platform).
 * Windows: `explorer /select,"<path>"`
 * macOS:   `open -R "<path>"`
 * Linux:   opens the containing folder (xdg-open doesn't support highlighting)
 */
function revealInFileManager(filePath) {
  let cmd;
  switch (process.platform) {
    case 'win32':
      // Windows paths may contain spaces — quote them, and explorer wants the raw path
      // after /select, with NO space between comma and path.
      cmd = `explorer.exe /select,"${filePath.replace(/\//g, '\\')}"`;
      break;
    case 'darwin':
      cmd = `open -R "${filePath}"`;
      break;
    default:
      cmd = `xdg-open "${path.dirname(filePath)}"`;
  }
  exec(cmd, (err) => {
    // explorer.exe on Windows always returns exit code 1 even on success — ignore.
    if (err && process.platform !== 'win32') {
      console.warn('[Reveal] exec error:', err.message);
    }
  });
}

function openInFileManager(dirPath) {
  let cmd;
  switch (process.platform) {
    case 'win32':
      cmd = `explorer.exe "${dirPath.replace(/\//g, '\\')}"`;
      break;
    case 'darwin':
      cmd = `open "${dirPath}"`;
      break;
    default:
      cmd = `xdg-open "${dirPath}"`;
  }
  exec(cmd, (err) => {
    if (err && process.platform !== 'win32') {
      console.warn('[Reveal] exec error:', err.message);
    }
  });
}

// GET /api/recordings/:id/audio — Stream audio file
router.get('/:id/audio', (req, res) => {
  try {
    const recording = queryOne('SELECT file_path FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    const audioPath = safeAudioPath(recording.file_path);
    if (!audioPath || !fs.existsSync(audioPath)) {
      return res.status(404).json({ error: '音声ファイルが見つかりません' });
    }

    const stat = fs.statSync(audioPath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'audio/mpeg',
      });
      fs.createReadStream(audioPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'audio/mpeg',
      });
      fs.createReadStream(audioPath).pipe(res);
    }
  } catch (err) {
    console.error('Audio stream error:', err);
    res.status(500).json({ error: '音声配信に失敗しました' });
  }
});

// PATCH /api/transcriptions/:id — Edit transcription text/speakers
router.patch('/transcriptions/:id', (req, res) => {
  try {
    const { segments_json, speakers_json } = req.body;
    const updates = [];
    const params = [];

    if (segments_json !== undefined) {
      updates.push('segments_json = ?');
      params.push(typeof segments_json === 'string' ? segments_json : JSON.stringify(segments_json));
    }
    if (speakers_json !== undefined) {
      updates.push('speakers_json = ?');
      params.push(typeof speakers_json === 'string' ? speakers_json : JSON.stringify(speakers_json));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新内容がありません' });
    }

    params.push(req.params.id);
    execute(`UPDATE transcriptions SET ${updates.join(', ')} WHERE id = ?`, params);

    // Update known speakers
    if (speakers_json) {
      const speakers = typeof speakers_json === 'string' ? JSON.parse(speakers_json) : speakers_json;
      for (const s of speakers) {
        if (s.label && s.label !== s.id) {
          const existing = queryOne('SELECT id FROM known_speakers WHERE name = ?', [s.label]);
          if (existing) {
            execute('UPDATE known_speakers SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [existing.id]);
          } else {
            execute('INSERT INTO known_speakers (name) VALUES (?)', [s.label]);
          }
        }
      }
    }

    const transcription = queryOne('SELECT * FROM transcriptions WHERE id = ?', [req.params.id]);
    res.json(transcription);
  } catch (err) {
    console.error('Transcription update error:', err);
    res.status(500).json({ error: '文字起こしの更新に失敗しました' });
  }
});

// Get known speakers for autocomplete
router.get('/known-speakers', (req, res) => {
  try {
    const speakers = queryAll(
      'SELECT name, usage_count FROM known_speakers ORDER BY usage_count DESC, last_used_at DESC LIMIT 50'
    );
    res.json(speakers);
  } catch (err) {
    console.error('Known speakers fetch error:', err);
    res.status(500).json({ error: '話者リストの取得に失敗しました' });
  }
});

export default router;
