import { Router } from 'express';
import { execute, queryAll, queryOne } from '../db/database.js';

const router = Router();

// GET /api/settings — Get all settings
router.get('/', (req, res) => {
  try {
    const rows = queryAll('SELECT * FROM settings');
    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }

    // Add API key status (configured or not, never expose actual keys)
    settings.api_keys = {
      deepgram: !!process.env.DEEPGRAM_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      grok: !!process.env.GROK_API_KEY,
    };

    res.json(settings);
  } catch (err) {
    console.error('Settings get error:', err);
    res.status(500).json({ error: '設定の取得に失敗しました' });
  }
});

// PATCH /api/settings — Update settings
router.patch('/', (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      const jsonValue = JSON.stringify(value);
      const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
      if (existing) {
        execute('UPDATE settings SET value = ? WHERE key = ?', [jsonValue, key]);
      } else {
        execute('INSERT INTO settings (key, value) VALUES (?, ?)', [key, jsonValue]);
      }
    }

    // Return updated settings
    const rows = queryAll('SELECT * FROM settings');
    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    res.json(settings);
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: '設定の更新に失敗しました' });
  }
});

export default router;
