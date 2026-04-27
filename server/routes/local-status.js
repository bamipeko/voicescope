import { Router } from 'express';
import { queryOne } from '../db/database.js';
import {
  getWhisperCppStatus,
  downloadWhisperCpp,
  downloadModel as downloadWhisperModel,
} from '../services/transcription/whisper-cpp.js';

const router = Router();

let cachedStatus = null;
let cacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

// Track active downloads
const activeDownloads = new Map(); // key -> { stage, status, progress }

/**
 * Check if Ollama is running and list available models.
 */
async function checkOllama() {
  const urlSetting = queryOne("SELECT value FROM settings WHERE key = 'local_ollama_url'");
  let baseURL = urlSetting ? JSON.parse(urlSetting.value) : 'http://localhost:11434';
  // Restrict to localhost to prevent SSRF
  try {
    const parsed = new URL(baseURL);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      baseURL = 'http://localhost:11434';
    }
  } catch { baseURL = 'http://localhost:11434'; }

  const result = { available: false, version: null, models: [], url: baseURL };

  try {
    const versionRes = await fetch(`${baseURL}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (versionRes.ok) {
      const data = await versionRes.json();
      result.version = data.version;
      result.available = true;
    }
  } catch {
    return result;
  }

  try {
    const modelsRes = await fetch(`${baseURL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (modelsRes.ok) {
      const data = await modelsRes.json();
      result.models = (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        modified: m.modified_at,
      }));
    }
  } catch {}

  return result;
}

/**
 * Check if faster-whisper (Python) is available.
 */
async function checkFasterWhisper() {
  try {
    const { checkFasterWhisper: check } = await import('../services/transcription/faster-whisper.js');
    return await check();
  } catch {
    return { available: false, version: null, gpu: false };
  }
}

// GET /api/local-status — Check availability of local services
router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === '1';

    if (cachedStatus && !forceRefresh && (now - cacheTime) < CACHE_TTL) {
      return res.json({ ...cachedStatus, downloads: Object.fromEntries(activeDownloads) });
    }

    const [ollama, fasterWhisper] = await Promise.all([
      checkOllama(),
      checkFasterWhisper(),
    ]);

    const whisperCpp = getWhisperCppStatus();

    cachedStatus = {
      ollama,
      fasterWhisper,
      whisperCpp,
      checkedAt: new Date().toISOString(),
    };
    cacheTime = now;

    res.json({ ...cachedStatus, downloads: Object.fromEntries(activeDownloads) });
  } catch (err) {
    console.error('Local status check error:', err);
    res.status(500).json({ error: 'ローカルサービスの状態確認に失敗しました' });
  }
});

// POST /api/local-status/whisper-cpp/setup — Download whisper.cpp binary
router.post('/whisper-cpp/setup', async (req, res) => {
  if (activeDownloads.has('whisper-cpp-binary')) {
    return res.json({ message: 'ダウンロード中です', status: activeDownloads.get('whisper-cpp-binary') });
  }

  res.json({ message: 'whisper.cpp のダウンロードを開始しました' });

  // Run download in background
  activeDownloads.set('whisper-cpp-binary', { stage: 'binary', status: 'starting', progress: 0 });

  try {
    await downloadWhisperCpp((progress) => {
      activeDownloads.set('whisper-cpp-binary', progress);
    });
    activeDownloads.set('whisper-cpp-binary', { stage: 'binary', status: 'done', progress: 1 });
    // Clear cache so next status check reflects new state
    cachedStatus = null;
  } catch (err) {
    console.error('[whisper-cpp] Setup failed:', err);
    activeDownloads.set('whisper-cpp-binary', { stage: 'binary', status: 'error', error: err.message });
  }

  // Clean up download status after 30s
  setTimeout(() => activeDownloads.delete('whisper-cpp-binary'), 30000);
});

// POST /api/local-status/whisper-cpp/download-model — Download a whisper model
router.post('/whisper-cpp/download-model', async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model パラメータが必要です' });

  const downloadKey = `whisper-model-${model}`;
  if (activeDownloads.has(downloadKey)) {
    return res.json({ message: 'ダウンロード中です', status: activeDownloads.get(downloadKey) });
  }

  res.json({ message: `モデル "${model}" のダウンロードを開始しました` });

  activeDownloads.set(downloadKey, { stage: 'model', model, status: 'starting', progress: 0 });

  try {
    await downloadWhisperModel(model, (progress) => {
      activeDownloads.set(downloadKey, progress);
    });
    activeDownloads.set(downloadKey, { stage: 'model', model, status: 'done', progress: 1 });
    cachedStatus = null;
  } catch (err) {
    console.error(`[whisper-cpp] Model download failed (${model}):`, err);
    activeDownloads.set(downloadKey, { stage: 'model', model, status: 'error', error: err.message });
  }

  setTimeout(() => activeDownloads.delete(downloadKey), 30000);
});

// POST /api/local-status/ollama/pull — Pull an Ollama model
router.post('/ollama/pull', async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model パラメータが必要です' });

  const urlSetting = queryOne("SELECT value FROM settings WHERE key = 'local_ollama_url'");
  const baseURL = urlSetting ? JSON.parse(urlSetting.value) : 'http://localhost:11434';

  const downloadKey = `ollama-${model}`;
  activeDownloads.set(downloadKey, { stage: 'ollama-pull', model, status: 'pulling', progress: 0 });

  res.json({ message: `Ollamaモデル "${model}" のダウンロードを開始しました` });

  try {
    const pullRes = await fetch(`${baseURL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    });

    if (!pullRes.ok) {
      throw new Error(`Ollama pull failed: ${pullRes.status}`);
    }

    // Ollama streams progress as NDJSON
    const reader = pullRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.total && data.completed) {
            activeDownloads.set(downloadKey, {
              stage: 'ollama-pull', model, status: 'pulling',
              progress: data.completed / data.total,
              detail: data.status,
            });
          }
        } catch {}
      }
    }

    activeDownloads.set(downloadKey, { stage: 'ollama-pull', model, status: 'done', progress: 1 });
    cachedStatus = null;
  } catch (err) {
    console.error(`[Ollama] Pull failed (${model}):`, err);
    activeDownloads.set(downloadKey, {
      stage: 'ollama-pull', model, status: 'error',
      error: err.message?.includes('ECONNREFUSED')
        ? 'Ollamaに接続できません。Ollamaが起動しているか確認してください。'
        : err.message,
    });
  }

  setTimeout(() => activeDownloads.delete(downloadKey), 30000);
});

// GET /api/local-status/downloads — Check active download progress
router.get('/downloads', (req, res) => {
  res.json(Object.fromEntries(activeDownloads));
});

export default router;
