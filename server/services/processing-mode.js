import { queryOne } from '../db/database.js';

/**
 * Three processing modes:
 *   'offline' — No external communication. Only whisper.cpp + Ollama allowed.
 *   'ownkey'  — Use user's own API keys directly.
 *   'managed' — Use operator's Worker proxy (managed tier with activation code).
 *
 * Auto-detection when mode is unset:
 *   1. managed_token present → 'managed'
 *   2. Own LLM + transcription keys → 'ownkey'
 *   3. Otherwise → 'offline'
 */
export function getProcessingMode() {
  const row = queryOne("SELECT value FROM settings WHERE key = 'processing_mode'");
  let mode = null;
  try { mode = row ? JSON.parse(row.value) : null; } catch { mode = row?.value || null; }

  if (mode === 'offline' || mode === 'ownkey' || mode === 'managed') {
    return mode;
  }

  // Auto-detect
  const tokenRow = queryOne("SELECT value FROM settings WHERE key = 'managed_token'");
  let token = '';
  try { token = tokenRow ? JSON.parse(tokenRow.value) : ''; } catch {}
  if (token) return 'managed';

  const hasTranscription = !!(process.env.OPENAI_API_KEY || process.env.DEEPGRAM_API_KEY);
  const hasLLM = !!(
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GROK_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
  if (hasTranscription && hasLLM) return 'ownkey';

  return 'offline';
}
