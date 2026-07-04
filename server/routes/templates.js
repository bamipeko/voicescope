import { Router } from 'express';
import { execute, executeReturningId, queryOne, queryAll, lastInsertRowId } from '../db/database.js';
import { summarize } from '../services/summary/index.js';

const router = Router();

// GET /api/templates
router.get('/', (req, res) => {
  try {
    const templates = queryAll('SELECT * FROM templates ORDER BY sort_order ASC, id ASC');
    res.json(templates);
  } catch (err) {
    console.error('Templates list error:', err);
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

// POST /api/templates/reorder — Reorder templates by id array
router.post('/reorder', (req, res) => {
  try {
    const { order } = req.body; // array of template ids in desired order
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order配列が必要です' });
    }
    order.forEach((id, index) => {
      execute('UPDATE templates SET sort_order = ? WHERE id = ?', [index, id]);
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Template reorder error:', err);
    res.status(500).json({ error: '並び替えに失敗しました' });
  }
});

// POST /api/templates
router.post('/', (req, res) => {
  try {
    const { name, description, system_prompt, output_format, is_default, preferred_llm_provider, preferred_llm_model } = req.body;

    if (!name || !system_prompt) {
      return res.status(400).json({ error: 'テンプレート名とプロンプトは必須です' });
    }
    if (system_prompt.length > 20000) {
      return res.status(400).json({ error: 'プロンプトが長すぎます（20,000文字以内）' });
    }

    // If setting as default, unset others
    if (is_default) {
      execute('UPDATE templates SET is_default = 0');
    }

    // executeReturningId — sql.js's save() resets last_insert_rowid().
    const id = executeReturningId(
      `INSERT INTO templates (name, description, system_prompt, output_format, is_default, preferred_llm_provider, preferred_llm_model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description || null, system_prompt, output_format || 'markdown', is_default ? 1 : 0, preferred_llm_provider || null, preferred_llm_model || null]
    );
    const template = queryOne('SELECT * FROM templates WHERE id = ?', [id]);
    res.status(201).json(template);
  } catch (err) {
    console.error('Template create error:', err);
    res.status(500).json({ error: 'テンプレートの作成に失敗しました' });
  }
});

// PATCH /api/templates/:id
router.patch('/:id', (req, res) => {
  try {
    const { name, description, system_prompt, output_format, is_default, preferred_llm_provider, preferred_llm_model } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (system_prompt !== undefined) { updates.push('system_prompt = ?'); params.push(system_prompt); }
    if (output_format !== undefined) { updates.push('output_format = ?'); params.push(output_format); }
    if (preferred_llm_provider !== undefined) { updates.push('preferred_llm_provider = ?'); params.push(preferred_llm_provider); }
    if (preferred_llm_model !== undefined) { updates.push('preferred_llm_model = ?'); params.push(preferred_llm_model); }

    if (is_default !== undefined) {
      if (is_default) {
        execute('UPDATE templates SET is_default = 0');
      }
      updates.push('is_default = ?');
      params.push(is_default ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新内容がありません' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);

    execute(`UPDATE templates SET ${updates.join(', ')} WHERE id = ?`, params);
    const template = queryOne('SELECT * FROM templates WHERE id = ?', [req.params.id]);
    res.json(template);
  } catch (err) {
    console.error('Template update error:', err);
    res.status(500).json({ error: 'テンプレートの更新に失敗しました' });
  }
});

// DELETE /api/templates/:id
router.delete('/:id', (req, res) => {
  try {
    const template = queryOne('SELECT * FROM templates WHERE id = ?', [req.params.id]);
    if (!template) {
      return res.status(404).json({ error: 'テンプレートが見つかりません' });
    }

    execute('DELETE FROM templates WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Template delete error:', err);
    res.status(500).json({ error: 'テンプレートの削除に失敗しました' });
  }
});

// POST /api/templates/:id/test — Test template with existing transcription
router.post('/:id/test', async (req, res) => {
  try {
    const template = queryOne('SELECT * FROM templates WHERE id = ?', [req.params.id]);
    if (!template) {
      return res.status(404).json({ error: 'テンプレートが見つかりません' });
    }

    const { recording_id, provider, model } = req.body;
    if (!recording_id) {
      return res.status(400).json({ error: '録音IDを指定してください' });
    }

    const transcription = queryOne(
      'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
      [recording_id]
    );
    if (!transcription) {
      return res.status(400).json({ error: '指定された録音に文字起こしがありません' });
    }

    const segments = JSON.parse(transcription.segments_json);
    const fullText = segments.map(s => `${s.speaker}: ${s.text}`).join('\n');

    const result = await summarize(fullText, {
      templateId: template.id,
      provider,
      model,
    });

    res.json({ content: result.content, provider: result.provider, model: result.model });
  } catch (err) {
    console.error('Template test error:', err);
    res.status(500).json({ error: `テスト実行に失敗しました: ${err.message}` });
  }
});

export default router;
