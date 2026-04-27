import { Router } from 'express';
import { execute, queryOne, queryAll } from '../db/database.js';

const router = Router();

// GET /api/folders — List all folders with recording counts
router.get('/', (req, res) => {
  try {
    const folders = queryAll(`
      SELECT f.*, COUNT(rf.recording_id) as recording_count
      FROM folders f
      LEFT JOIN recording_folders rf ON f.id = rf.folder_id
      GROUP BY f.id
      ORDER BY f.sort_order, f.name
    `);
    res.json(folders);
  } catch (err) {
    console.error('Folders list error:', err);
    res.status(500).json({ error: 'フォルダの取得に失敗しました' });
  }
});

// POST /api/folders — Create a folder
router.post('/', (req, res) => {
  try {
    const { name, icon, auto_tag_ids } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'フォルダ名を入力してください' });
    }
    const maxOrder = queryOne('SELECT MAX(sort_order) as m FROM folders')?.m || 0;
    execute(
      'INSERT INTO folders (name, icon, sort_order, auto_tag_ids) VALUES (?, ?, ?, ?)',
      [name.trim(), icon || '📁', maxOrder + 1, JSON.stringify(auto_tag_ids || [])]
    );
    const folder = queryOne('SELECT * FROM folders ORDER BY id DESC LIMIT 1');
    res.status(201).json(folder);
  } catch (err) {
    console.error('Folder create error:', err);
    res.status(500).json({ error: 'フォルダの作成に失敗しました' });
  }
});

// PATCH /api/folders/:id — Update a folder
router.patch('/:id', (req, res) => {
  try {
    const folder = queryOne('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) return res.status(404).json({ error: 'フォルダが見つかりません' });

    const { name, icon, auto_tag_ids, sort_order } = req.body;
    if (name !== undefined) execute('UPDATE folders SET name = ? WHERE id = ?', [name.trim(), folder.id]);
    if (icon !== undefined) execute('UPDATE folders SET icon = ? WHERE id = ?', [icon, folder.id]);
    if (auto_tag_ids !== undefined) execute('UPDATE folders SET auto_tag_ids = ? WHERE id = ?', [JSON.stringify(auto_tag_ids), folder.id]);
    if (sort_order !== undefined) execute('UPDATE folders SET sort_order = ? WHERE id = ?', [sort_order, folder.id]);

    const updated = queryOne('SELECT * FROM folders WHERE id = ?', [folder.id]);
    res.json(updated);
  } catch (err) {
    console.error('Folder update error:', err);
    res.status(500).json({ error: 'フォルダの更新に失敗しました' });
  }
});

// DELETE /api/folders/:id — Delete a folder (recordings are NOT deleted)
router.delete('/:id', (req, res) => {
  try {
    const folder = queryOne('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) return res.status(404).json({ error: 'フォルダが見つかりません' });
    execute('DELETE FROM folders WHERE id = ?', [folder.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Folder delete error:', err);
    res.status(500).json({ error: 'フォルダの削除に失敗しました' });
  }
});

// POST /api/folders/:id/recordings/:recordingId — Add recording to folder
router.post('/:id/recordings/:recordingId', (req, res) => {
  try {
    execute(
      'INSERT OR IGNORE INTO recording_folders (recording_id, folder_id) VALUES (?, ?)',
      [req.params.recordingId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Folder add recording error:', err);
    res.status(500).json({ error: 'フォルダへの追加に失敗しました' });
  }
});

// DELETE /api/folders/:id/recordings/:recordingId — Remove recording from folder
router.delete('/:id/recordings/:recordingId', (req, res) => {
  try {
    execute(
      'DELETE FROM recording_folders WHERE recording_id = ? AND folder_id = ?',
      [req.params.recordingId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Folder remove recording error:', err);
    res.status(500).json({ error: 'フォルダからの削除に失敗しました' });
  }
});

/**
 * Auto-assign recordings to folders based on tag rules.
 * Called after tags are assigned to a recording.
 */
export function autoAssignFolders(recordingId) {
  try {
    const folders = queryAll('SELECT id, auto_tag_ids FROM folders');
    const recordingTags = queryAll(
      'SELECT tag_id FROM recording_tags WHERE recording_id = ?',
      [recordingId]
    );
    const tagIds = new Set(recordingTags.map(rt => rt.tag_id));

    for (const folder of folders) {
      let autoTags;
      try {
        autoTags = JSON.parse(folder.auto_tag_ids || '[]');
      } catch (e) {
        autoTags = [];
      }
      if (autoTags.length === 0) continue;

      // If recording has any of the auto-assign tags, add to folder
      const match = autoTags.some(id => tagIds.has(id));
      if (match) {
        execute(
          'INSERT OR IGNORE INTO recording_folders (recording_id, folder_id) VALUES (?, ?)',
          [recordingId, folder.id]
        );
      }
    }
  } catch (err) {
    console.error('Auto-assign folders error:', err);
  }
}

export default router;
