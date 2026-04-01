import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { execute, queryOne, queryAll, lastInsertRowId } from '../db/database.js';
import { transcribe } from '../services/transcription/index.js';
import { summarize } from '../services/summary/index.js';
import { runPipeline } from '../services/pipeline.js';
import { getAudioDuration } from '../utils/audio.js';

const router = Router();

const DATA_DIR = process.env.DATA_DIR || './data';
const AUDIO_DIR = path.resolve(DATA_DIR, 'audio');

// Ensure audio directory exists
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIO_DIR),
  filename: (req, file, cb) => {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `rec_${ts}${ext}`);
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
router.post('/upload', upload.single('audio'), (req, res) => {
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

    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [id]);

    // Start pipeline in background (don't await)
    runPipeline(id).catch(err => {
      console.error(`Pipeline failed for ${id}:`, err.message);
    });

    res.status(201).json(recording);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'アップロードに失敗しました' });
  }
});

// GET /api/recordings — List recordings
router.get('/', (req, res) => {
  try {
    const { tag, q, from, to, limit = 50, offset = 0 } = req.query;
    let sql = 'SELECT r.* FROM recordings r';
    const params = [];
    const conditions = [];

    if (tag) {
      sql += ' JOIN recording_tags rt ON r.id = rt.recording_id JOIN tags t ON rt.tag_id = t.id';
      conditions.push('t.name = ?');
      params.push(tag);
    }

    if (q) {
      conditions.push(`(r.title LIKE ? OR r.id IN (
        SELECT recording_id FROM transcriptions WHERE segments_json LIKE ?
      ))`);
      params.push(`%${q}%`, `%${q}%`);
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
    params.push(Number(limit), Number(offset));

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

    // Parse JSON fields
    if (recording.transcription) {
      try {
        recording.transcription.segments = JSON.parse(recording.transcription.segments_json);
        recording.transcription.speakers = JSON.parse(recording.transcription.speakers_json || '[]');
      } catch {}
    }

    res.json(recording);
  } catch (err) {
    console.error('Detail error:', err);
    res.status(500).json({ error: '録音詳細の取得に失敗しました' });
  }
});

// POST /api/recordings/:id/transcribe — Run transcription
router.post('/:id/transcribe', async (req, res) => {
  try {
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    const audioPath = path.join(AUDIO_DIR, recording.file_path);
    if (!fs.existsSync(audioPath)) {
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
    res.status(500).json({ error: `文字起こしに失敗しました: ${err.message}` });
  }
});

// POST /api/recordings/:id/summarize — Generate summary
router.post('/:id/summarize', async (req, res) => {
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

    const segments = JSON.parse(transcription.segments_json);
    const fullText = segments.map(s => `${s.speaker}: ${s.text}`).join('\n');

    const result = await summarize(fullText, {
      templateId: req.body.template_id,
      provider: req.body.provider,
      model: req.body.model,
    });

    execute(
      `INSERT INTO summaries (recording_id, template_id, llm_provider, llm_model, content)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, result.templateId, result.provider, result.model, result.content]
    );

    const summaryId = lastInsertRowId();
    const summary = queryOne('SELECT * FROM summaries WHERE id = ?', [summaryId]);
    res.status(201).json(summary);
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: `要約生成に失敗しました: ${err.message}` });
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

// PATCH /api/recordings/:id — Update title
router.patch('/:id', (req, res) => {
  try {
    const { title } = req.body;
    execute('UPDATE recordings SET title = ? WHERE id = ?', [title, req.params.id]);
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    res.json(recording);
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: '更新に失敗しました' });
  }
});

// DELETE /api/recordings/:id — Delete recording
router.delete('/:id', (req, res) => {
  try {
    const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    // Delete audio file
    const audioPath = path.join(AUDIO_DIR, recording.file_path);
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    execute('DELETE FROM recordings WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// GET /api/recordings/:id/audio — Stream audio file
router.get('/:id/audio', (req, res) => {
  try {
    const recording = queryOne('SELECT file_path FROM recordings WHERE id = ?', [req.params.id]);
    if (!recording) {
      return res.status(404).json({ error: '録音が見つかりません' });
    }

    const audioPath = path.join(AUDIO_DIR, recording.file_path);
    if (!fs.existsSync(audioPath)) {
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

export default router;
