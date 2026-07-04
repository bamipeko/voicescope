/**
 * Local LLM / transcription endpoint configuration.
 *
 * VoiceScope's "local processing" path is preserved on every platform,
 * including mobile. The way it works varies:
 *
 * - **Desktop (Electron)**: bundled support for Ollama at localhost:11434
 *   and whisper.cpp via ffmpeg + child process.
 *
 * - **Mobile (Capacitor / Android)**: We do NOT ship a local LLM in the
 *   APK (model files are 500MB-4GB, would explode app size). Instead we
 *   support three external paths, all via HTTP:
 *
 *     1. **Home server**: Run Ollama on user's PC/NAS (RTX 5070 Ti at
 *        home). Mobile points at `http://192.168.0.x:11434` or via
 *        Tailscale/VPN for remote access. Best perf, no app bloat.
 *     2. **Companion Android app**: Apps like "Maid"
 *        (github.com/Mobile-Artificial-Intelligence/maid), "Layla"
 *        (layla-network.ai), or "MLC Chat" run llama.cpp/MLC on-device
 *        and expose an OpenAI-compatible HTTP endpoint at
 *        `http://localhost:<port>`. We just call that endpoint.
 *     3. **Termux + Ollama**: Power users run Ollama inside Termux on the
 *        same Android device. Endpoint is `http://localhost:11434`.
 *
 *   For transcription:
 *     - Whisper-compatible Android apps with HTTP endpoints (rare)
 *     - whisper.cpp via Termux
 *     - **Or fall back to managed mode for transcription only** while
 *       keeping LLM local — both can be configured independently.
 *
 * Storage: persisted via the unified `storage.js` adapter so settings
 * survive app restarts on every platform.
 */

import { storageGet, storageSet } from './storage';

const KEYS = {
  llmEndpoint:    'localEndpoint.llm.url',          // e.g. http://192.168.0.10:11434
  llmModel:       'localEndpoint.llm.defaultModel', // e.g. llama3.2:8b
  llmFormat:      'localEndpoint.llm.format',       // 'ollama' | 'openai-compat'
  whisperEndpoint:'localEndpoint.whisper.url',      // e.g. http://192.168.0.10:9000
  whisperModel:   'localEndpoint.whisper.model',    // e.g. medium
  enabled:        'localEndpoint.enabled',          // 'true' | 'false'
};

/**
 * Suggested presets to seed the Settings UI dropdown. Users pick one and
 * tweak the URL to point at their actual host.
 */
export const ENDPOINT_PRESETS = [
  {
    id: 'home-pc-ollama',
    label: '自宅 PC の Ollama (Wi-Fi 経由)',
    description: 'メイン PC で `ollama serve` を起動。同じ Wi-Fi 内のスマホから叩く想定',
    url: 'http://192.168.0.10:11434',
    format: 'ollama',
    sample: 'http://<PCのLAN IP>:11434',
  },
  {
    id: 'home-pc-tailscale',
    label: '自宅 PC の Ollama (Tailscale 経由)',
    description: 'Tailscale で外出先からも自宅 PC に接続。100.x.x.x の Tailnet IP を指定',
    url: 'http://100.64.0.10:11434',
    format: 'ollama',
    sample: 'http://<Tailnet IP>:11434',
  },
  {
    id: 'nas-ollama',
    label: 'NAS の Ollama (UGREEN DXP2800 など)',
    description: 'Docker コンテナで Ollama を NAS 稼働。GPU は無いので軽量モデル限定',
    url: 'http://192.168.0.92:11434',
    format: 'ollama',
    sample: 'http://192.168.0.92:11434',
  },
  {
    id: 'companion-app',
    label: 'コンパニオン Android アプリ (Maid / Layla / MLC Chat)',
    description: '同じ端末上で llama.cpp/MLC を動かす別アプリの HTTP エンドポイントを叩く',
    url: 'http://localhost:8080',
    format: 'openai-compat',
    sample: 'http://localhost:<port>',
  },
  {
    id: 'termux-ollama',
    label: 'Termux 内の Ollama (上級者)',
    description: 'Android の Termux で `pkg install ollama` → `ollama serve`。ローカル完結',
    url: 'http://localhost:11434',
    format: 'ollama',
    sample: 'http://localhost:11434',
  },
  {
    id: 'custom',
    label: 'カスタム (URL を直接入力)',
    description: '上記以外の OpenAI 互換エンドポイント (LM Studio / vLLM / TGI など)',
    url: '',
    format: 'openai-compat',
    sample: 'http://...',
  },
];

export async function getLocalEndpoint() {
  const enabled = (await storageGet(KEYS.enabled)) === 'true';
  return {
    enabled,
    llm: {
      url:          await storageGet(KEYS.llmEndpoint)      || '',
      model:        await storageGet(KEYS.llmModel)         || '',
      format:       await storageGet(KEYS.llmFormat)        || 'ollama',
    },
    whisper: {
      url:          await storageGet(KEYS.whisperEndpoint)  || '',
      model:        await storageGet(KEYS.whisperModel)     || '',
    },
  };
}

export async function setLocalEndpoint(cfg) {
  if (cfg.enabled !== undefined) await storageSet(KEYS.enabled, cfg.enabled ? 'true' : 'false');
  if (cfg.llm) {
    if (cfg.llm.url    !== undefined) await storageSet(KEYS.llmEndpoint, cfg.llm.url);
    if (cfg.llm.model  !== undefined) await storageSet(KEYS.llmModel, cfg.llm.model);
    if (cfg.llm.format !== undefined) await storageSet(KEYS.llmFormat, cfg.llm.format);
  }
  if (cfg.whisper) {
    if (cfg.whisper.url   !== undefined) await storageSet(KEYS.whisperEndpoint, cfg.whisper.url);
    if (cfg.whisper.model !== undefined) await storageSet(KEYS.whisperModel, cfg.whisper.model);
  }
}

/**
 * Quick reachability test. Tries `GET <url>/api/version` (Ollama) then
 * `GET <url>/v1/models` (OpenAI-compatible). Returns { ok, version, models }
 * or throws on failure.
 */
export async function pingLocalEndpoint(url, format = 'ollama') {
  if (!url) throw new Error('URL を入力してください');
  const trimmed = url.replace(/\/$/, '');

  if (format === 'ollama') {
    const r = await fetch(`${trimmed}/api/version`, { method: 'GET' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    return { ok: true, version: json.version || 'unknown', kind: 'ollama' };
  }

  // OpenAI-compatible
  const r = await fetch(`${trimmed}/v1/models`, { method: 'GET' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  const models = Array.isArray(json.data) ? json.data.map((m) => m.id) : [];
  return { ok: true, kind: 'openai-compat', models };
}
