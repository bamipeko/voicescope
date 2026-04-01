import { Router } from 'express';
import { execute, queryOne, queryAll, lastInsertRowId } from '../db/database.js';

const router = Router();

// GET /api/tags — List all tags
router.get('/', (req, res) => {
  try {
    const tags = queryAll(`
      SELECT t.*, COUNT(rt.recording_id) as recording_count
      FROM tags t LEFT JOIN recording_tags rt ON t.id = rt.tag_id
      GROUP BY t.id ORDER BY t.name
    `);
    res.json(tags);
  } catch (err) {
    console.error('Tags list error:', err);
    res.status(500).json({ error: 'タグ一覧の取得に失敗しました' });
  }
});

// POST /api/recordings/:recordingId/tags — Add tag to recording
router.post('/recordings/:recordingId/tags', (req, res) => {
  try {
    const { name, color, source } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'タグ名は必須です' });
    }

    // Find or create tag
    let tag = queryOne('SELECT * FROM tags WHERE name = ?', [name]);
    if (!tag) {
      execute('INSERT INTO tags (name, color) VALUES (?, ?)', [name, color || '#6B7280']);
      const id = lastInsertRowId();
      tag = queryOne('SELECT * FROM tags WHERE id = ?', [id]);
    }

    // Link to recording (ignore if already linked)
    const existing = queryOne(
      'SELECT * FROM recording_tags WHERE recording_id = ? AND tag_id = ?',
      [req.params.recordingId, tag.id]
    );
    if (!existing) {
      execute(
        'INSERT INTO recording_tags (recording_id, tag_id, source) VALUES (?, ?, ?)',
        [req.params.recordingId, tag.id, source || 'manual']
      );
    }

    res.status(201).json(tag);
  } catch (err) {
    console.error('Tag add error:', err);
    res.status(500).json({ error: 'タグの追加に失敗しました' });
  }
});

// DELETE /api/recordings/:recordingId/tags/:tagId — Remove tag from recording
router.delete('/recordings/:recordingId/tags/:tagId', (req, res) => {
  try {
    execute(
      'DELETE FROM recording_tags WHERE recording_id = ? AND tag_id = ?',
      [req.params.recordingId, Number(req.params.tagId)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Tag remove error:', err);
    res.status(500).json({ error: 'タグの削除に失敗しました' });
  }
});

export default router;
