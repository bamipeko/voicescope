import { Router } from 'express';
import { execute, queryAll, queryOne } from '../db/database.js';
import { getRuntimeMode } from '../utils/platform-paths.js';
import { saveKey as saveKeyToConfig } from '../utils/keystore.js';

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

    // Add API key status. For each key, indicate source:
    //   false      — not set
    //   'store'    — user entered via Settings/SetupWizard (electron-store)
    //   'env'      — pre-existing environment variable (e.g. .env file, shell)
    const storeInjected = (process.env.VOICESCOPE_STORE_INJECTED_KEYS || '').split(',').filter(Boolean);
    const keySource = (envName) => {
      if (!process.env[envName]) return false;
      return storeInjected.includes(envName) ? 'store' : 'env';
    };
    settings.api_keys = {
      deepgram: keySource('DEEPGRAM_API_KEY'),
      openai: keySource('OPENAI_API_KEY'),
      gemini: keySource('GEMINI_API_KEY'),
      grok: keySource('GROK_API_KEY'),
      anthropic: keySource('ANTHROPIC_API_KEY'),
    };

    res.json(settings);
  } catch (err) {
    console.error('Settings get error:', err);
    res.status(500).json({ error: '設定の取得に失敗しました' });
  }
});

// Whitelist of allowed setting keys
const ALLOWED_SETTINGS = [
  'default_transcription_engine', 'default_summary_provider', 'default_summary_model',
  'default_ask_provider', 'default_ask_model', 'auto_refine_transcription', 'refine_preference',
  'default_language', 'diarization_enabled', 'custom_keywords', 'recording_mode',
  'local_whisper_model', 'whisper_cpp_model', 'local_ollama_url', 'ollama_model',
  'auto_title',
  'subscription_tier', 'trial_code', 'trial_expiry', 'trial_source',
  'managed_token', 'managed_worker_url',
  'processing_mode',
  'custom_endpoint_url', 'custom_endpoint_model', 'custom_endpoint_api_key', 'custom_endpoint_label',
  'trash_retention_days', 'trash_delete_mode',
];

// PATCH /api/settings — Update settings
router.patch('/', (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_SETTINGS.includes(key)) {
        console.warn(`[Settings] Rejected unknown key: ${key}`);
        continue;
      }
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

// POST /api/settings/api-keys — Update API keys in server process at runtime
// Called from Electron client after saving keys to electron-store
const ALLOWED_KEYS = ['DEEPGRAM_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROK_API_KEY', 'ANTHROPIC_API_KEY', 'EXPORT_AUDIO_PATH'];

router.post('/api-keys', (req, res) => {
  // Allowed in Electron mode (IPC-driven) and Standalone mode (writes to config.json).
  // Blocked in Docker mode — use .env there.
  const mode = getRuntimeMode();
  if (mode === 'docker') {
    return res.status(403).json({ error: 'Docker環境ではこのエンドポイントは使用できません。.envファイルでAPIキーを設定してください。' });
  }
  try {
    const keys = req.body;
    const MAX_KEY_LENGTH = 512;
    let updated = 0;
    const injected = (process.env.VOICESCOPE_STORE_INJECTED_KEYS || '').split(',').filter(Boolean);
    for (const [key, value] of Object.entries(keys)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      if (value && typeof value === 'string') {
        if (value.length > MAX_KEY_LENGTH) {
          console.warn(`[Settings] Rejected key ${key}: too long (${value.length} chars)`);
          continue;
        }
        process.env[key] = value;
        if (!injected.includes(key)) injected.push(key);
        // In standalone mode, persist to config.json (encrypted).
        if (mode === 'standalone') saveKeyToConfig(key, value);
        updated++;
      }
    }
    process.env.VOICESCOPE_STORE_INJECTED_KEYS = injected.join(',');
    console.log(`[Settings] Updated ${updated} API key(s) at runtime (mode=${mode})`);
    const keySrc = (envName) => {
      if (!process.env[envName]) return false;
      return injected.includes(envName) ? 'store' : 'env';
    };
    res.json({
      success: true,
      updated,
      api_keys: {
        deepgram: keySrc('DEEPGRAM_API_KEY'),
        openai: keySrc('OPENAI_API_KEY'),
        gemini: keySrc('GEMINI_API_KEY'),
        grok: keySrc('GROK_API_KEY'),
        anthropic: keySrc('ANTHROPIC_API_KEY'),
      },
    });
  } catch (err) {
    console.error('API keys update error:', err);
    res.status(500).json({ error: 'APIキーの更新に失敗しました' });
  }
});

// POST /api/settings/activate-trial — Activate with a code (Worker-first, local fallback)
router.post('/activate-trial', async (req, res) => {
  try {
    const { code } = req.body;
    const normalizedCode = (code || '').trim().toUpperCase();
    if (!normalizedCode) return res.status(400).json({ error: 'コードを入力してください' });

    const upsert = (key, value) => execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
      [key, JSON.stringify(value), JSON.stringify(value)]
    );

    // Generate device hash for Worker verification
    const os = await import('os');
    const crypto = await import('crypto');
    const deviceHash = crypto.createHash('sha256')
      .update([os.hostname(), os.userInfo().username].join('|'))
      .digest('hex').slice(0, 16);

    // Try Worker verification first (enables managed mode with JWT)
    const { MANAGED_WORKER_URL } = await import('../config/tiers.js');
    let workerResult = null;

    try {
      const resp = await fetch(`${MANAGED_WORKER_URL}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizedCode, deviceHash }),
        signal: AbortSignal.timeout(10000),
      });

      if (resp.ok) {
        workerResult = await resp.json();
      }
    } catch (e) {
      console.log('[Activate] Worker unreachable, trying local fallback');
    }

    if (workerResult?.success) {
      // Worker verification succeeded — save JWT for managed mode
      upsert('subscription_tier', workerResult.tier);
      upsert('trial_code', normalizedCode);
      upsert('trial_expiry', workerResult.expiry);
      upsert('trial_source', workerResult.source);
      upsert('managed_token', workerResult.token);

      return res.json({
        success: true,
        tier: workerResult.tier,
        expiry: workerResult.expiry,
        days: workerResult.days,
        source: workerResult.source,
        managed: true,
      });
    }

    // Worker unreachable — cannot verify code without server
    return res.status(503).json({
      error: 'コード検証サーバーに接続できません。インターネット接続を確認してください。',
    });
  } catch (err) {
    console.error('Activate trial error:', err);
    res.status(500).json({ error: 'コードの有効化に失敗しました' });
  }
});

// POST /api/settings/test-custom-endpoint — probe a user-provided OpenAI-compatible URL
// Body: { url?: string } — if omitted, tests the saved endpoint
// Returns: { ok: boolean, models?: [], error?: string }
router.post('/test-custom-endpoint', async (req, res) => {
  try {
    const { validateCustomURL } = await import('../services/summary/custom.js');
    let url = req.body?.url;
    if (!url) {
      const row = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_url'");
      try { url = row ? JSON.parse(row.value) : null; } catch { url = row?.value; }
    }
    if (!url) return res.status(400).json({ ok: false, error: 'URLが指定されていません' });

    const safe = validateCustomURL(url);
    if (!safe) {
      return res.status(400).json({ ok: false, error: 'localhost または LAN 内のアドレスのみ許可されています' });
    }

    // Try /v1/models (standard OpenAI-compatible endpoint)
    const normalized = safe.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/models';
    try {
      const resp = await fetch(normalized, { signal: AbortSignal.timeout(4000) });
      if (!resp.ok) {
        return res.json({ ok: false, error: `エンドポイントが応答しましたが、HTTP ${resp.status} を返しました` });
      }
      const data = await resp.json();
      const models = (data.data || data.models || [])
        .map(m => (typeof m === 'string' ? m : (m.id || m.name)))
        .filter(Boolean);
      return res.json({ ok: true, models });
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        return res.json({ ok: false, error: '接続タイムアウト（4秒）。サーバーが起動しているか確認してください。' });
      }
      return res.json({ ok: false, error: `接続失敗: ${err.message}` });
    }
  } catch (err) {
    console.error('Custom endpoint test error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/settings/tier — Get current tier info
router.get('/tier', async (req, res) => {
  try {
    const { getCurrentTier } = await import('../middleware/tier.js');
    const { TIERS } = await import('../config/tiers.js');

    const tierInfo = getCurrentTier(); // { tier, isExpired, expiry }
    const tierConfig = TIERS[tierInfo.tier] || TIERS['ownkey'];

    // Include activation source if available
    let source = null;
    try {
      const sourceRow = queryOne("SELECT value FROM settings WHERE key = 'trial_source'");
      if (sourceRow) source = JSON.parse(sourceRow.value);
    } catch {}

    // Determine which providers/models are available
    const { isManagedMode } = await import('../services/managed.js');
    const { MANAGED_ALLOWED_MODELS_BY_TIER } = await import('../config/tiers.js');
    const { getProcessingMode } = await import('../services/processing-mode.js');

    const managed = isManagedMode('openai').managed;
    const processingMode = getProcessingMode();
    const managedAllowedModels = managed
      ? (MANAGED_ALLOWED_MODELS_BY_TIER[tierInfo.tier] || MANAGED_ALLOWED_MODELS_BY_TIER.pro)
      : null;

    // Build available providers list based on API keys + managed mode
    const availableProviders = [];
    if (process.env.OPENAI_API_KEY || managed) availableProviders.push('openai');
    if (process.env.GEMINI_API_KEY) availableProviders.push('gemini'); // Gemini: own key only
    if (process.env.GROK_API_KEY || managed) availableProviders.push('grok');
    if (process.env.ANTHROPIC_API_KEY || managed) availableProviders.push('claude');
    // Fetch installed Ollama models (if any)
    let ollamaModels = [];
    try {
      const urlRow = queryOne("SELECT value FROM settings WHERE key = 'local_ollama_url'");
      const ollamaUrl = urlRow ? JSON.parse(urlRow.value) : 'http://localhost:11434';
      const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (resp.ok) {
        const data = await resp.json();
        ollamaModels = (data.models || []).map(m => ({ value: m.name, label: m.name }));
        if (ollamaModels.length > 0) availableProviders.push('ollama');
      }
    } catch {
      // Ollama not available — don't add to providers
    }

    // Custom OpenAI-compatible endpoint (LM Studio / llama.cpp / Jan / LocalAI)
    let customModels = [];
    let customLabel = null;
    try {
      const { validateCustomURL } = await import('../services/summary/custom.js');
      const urlRow = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_url'");
      const modelRow = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_model'");
      const labelRow = queryOne("SELECT value FROM settings WHERE key = 'custom_endpoint_label'");

      let customUrl = null;
      let savedModel = null;
      try { customUrl = urlRow ? JSON.parse(urlRow.value) : null; } catch { customUrl = urlRow?.value; }
      try { savedModel = modelRow ? JSON.parse(modelRow.value) : null; } catch { savedModel = modelRow?.value; }
      try { customLabel = labelRow ? JSON.parse(labelRow.value) : null; } catch { customLabel = labelRow?.value; }

      if (customUrl) {
        const safe = validateCustomURL(customUrl);
        if (safe) {
          // Try to enumerate via /v1/models, fall back to manually-specified model only
          try {
            const normalized = safe.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/models';
            const resp = await fetch(normalized, { signal: AbortSignal.timeout(1500) });
            if (resp.ok) {
              const data = await resp.json();
              const ids = (data.data || data.models || [])
                .map(m => (typeof m === 'string' ? m : (m.id || m.name)))
                .filter(Boolean);
              customModels = ids.map(id => ({ value: id, label: id }));
            }
          } catch {}

          // Ensure manually-set model is always present even if /v1/models failed
          if (savedModel && !customModels.some(m => m.value === savedModel)) {
            customModels.unshift({ value: savedModel, label: savedModel });
          }

          if (customModels.length > 0) availableProviders.push('custom');
        }
      }
    } catch {
      // Custom endpoint not available
    }

    res.json({
      ...tierInfo,
      ...tierConfig,
      source,
      managed,
      processingMode,
      availableProviders,
      managedAllowedModels,
      ollamaModels,
      customModels,
      customLabel,
      runtimeMode: getRuntimeMode(),
    });
  } catch (err) {
    console.error('Tier info error:', err);
    res.status(500).json({ error: 'ティア情報の取得に失敗しました' });
  }
});

export default router;
