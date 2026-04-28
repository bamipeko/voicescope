import fs from 'fs';
import path from 'path';
import { isManagedMode } from '../managed.js';

/**
 * xAI Grok Speech-to-Text.
 *
 * Endpoint: POST https://api.x.ai/v1/stt
 * Auth:     Bearer $XAI_API_KEY
 * Body:     multipart/form-data with 'file' field and optional 'model', 'language', etc.
 *
 * The exact response schema is not fully public as of 2026-04-18 release,
 * so this implementation is defensive: it tries to extract word-level or
 * segment-level data in several shapes and falls back to a single segment
 * with the raw text if neither is present.
 *
 * Pricing (2026-04): $0.10/hour batch — ~40% cheaper than Deepgram.
 */
const GROK_STT_ENDPOINT = 'https://api.x.ai/v1/stt';
const DEFAULT_MODEL = 'grok-stt';

export async function transcribeWithGrokSTT(audioPath, options = {}) {
  const language = (!options.language || options.language === 'auto') ? 'ja' : options.language;
  const { managed, workerBaseURL, token } = isManagedMode('grok');

  let endpoint, authHeader;
  if (managed) {
    // Managed mode would proxy through our Cloudflare Worker.
    // Worker route /v1/stt is not implemented yet (Phase 3) — fall back to direct if worker doesn't have it.
    endpoint = `${workerBaseURL}/v1/stt`;
    authHeader = `Bearer ${token}`;
  } else {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) {
      throw new Error('Grok STT を使うには GROK_API_KEY が必要です。設定画面で xAI のAPIキーを登録してください。');
    }
    endpoint = GROK_STT_ENDPOINT;
    authHeader = `Bearer ${apiKey}`;
  }

  // Build multipart/form-data using Node's FormData (available in Node 18+)
  const form = new FormData();
  const audioBuffer = fs.readFileSync(audioPath);
  const mimeType = guessMimeType(audioPath);
  form.append('file', new Blob([audioBuffer], { type: mimeType }), path.basename(audioPath));
  form.append('model', options.model || DEFAULT_MODEL);
  form.append('language', language);
  form.append('response_format', 'verbose_json'); // request rich format; server may downgrade
  form.append('timestamp_granularities[]', 'word');
  if (options.diarize !== false) {
    form.append('diarize', 'true');
  }
  // Bias toward the requested language. Grok STT (2026-04 release) sometimes
  // mixes English into Japanese audio when language detection is uncertain.
  // OpenAI-compatible STT APIs accept a 'prompt' to nudge the model.
  if (language === 'ja') {
    form.append('prompt', '日本語の会話の文字起こしです。すべて日本語で書き起こしてください。固有名詞や英単語が登場した場合のみ英字を使ってください。');
  }

  const startedAt = Date.now();
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: authHeader },
    body: form,
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const err = await resp.json();
      detail = err.error?.message || err.message || JSON.stringify(err);
    } catch {
      detail = await resp.text().catch(() => '');
    }
    throw new Error(`Grok STT API error (${resp.status}): ${detail || resp.statusText}`);
  }

  // Grok may return JSON; older tooling sometimes returns plain text for response_format=text.
  // Handle both to be safe.
  const contentType = resp.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await resp.json();
  } else {
    data = { text: await resp.text() };
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[Grok STT] Transcribed in ${durationMs}ms, response keys: ${Object.keys(data).join(', ')}`);

  return normalizeGrokResponse(data, language);
}

/**
 * Normalize various response shapes into VoiceScope's internal segment format.
 *
 * Possible shapes we handle:
 *   A) OpenAI Whisper-style verbose_json:
 *      { text, language, segments: [{ start, end, text, ... }], words: [{ start, end, word, speaker? }] }
 *   B) Deepgram-like:
 *      { results: { channels: [{ alternatives: [{ words: [...], transcript }] }] } }
 *   C) Minimal:
 *      { text: "..." }
 */
function normalizeGrokResponse(data, language) {
  const speakerSet = new Set();
  const segments = [];

  // Shape A: OpenAI-compatible verbose_json with words array
  if (Array.isArray(data.words) && data.words.length > 0) {
    const MAX_SEGMENT_SEC = 20;
    const PAUSE_THRESHOLD = 1.5;
    let current = null;

    for (const w of data.words) {
      const speakerId = `speaker_${w.speaker ?? 0}`;
      const wordText = w.word || w.text || '';
      const start = typeof w.start === 'number' ? w.start : 0;
      const end = typeof w.end === 'number' ? w.end : start;
      speakerSet.add(speakerId);

      const shouldSplit = !current
        || current.speaker !== speakerId
        || (start - current.end) > PAUSE_THRESHOLD
        || (end - current.start) > MAX_SEGMENT_SEC;

      if (shouldSplit) {
        if (current) segments.push(current);
        current = { start, end, speaker: speakerId, text: wordText };
      } else {
        current.end = end;
        current.text = current.text + (needsSpace(current.text, wordText) ? ' ' : '') + wordText;
      }
    }
    if (current) segments.push(current);
  }

  // Shape A2: segments array (no words) — trust the provided segmentation
  else if (Array.isArray(data.segments) && data.segments.length > 0) {
    for (const s of data.segments) {
      const speakerId = `speaker_${s.speaker ?? 0}`;
      speakerSet.add(speakerId);
      segments.push({
        start: typeof s.start === 'number' ? s.start : 0,
        end: typeof s.end === 'number' ? s.end : 0,
        speaker: speakerId,
        text: (s.text || '').trim(),
      });
    }
  }

  // Shape C: minimal text only
  else if (data.text) {
    speakerSet.add('speaker_0');
    segments.push({
      start: 0,
      end: 0,
      speaker: 'speaker_0',
      text: data.text.trim(),
    });
  }

  if (segments.length === 0) {
    throw new Error('Grok STT: 応答から文字起こしを抽出できませんでした');
  }

  const speakers = Array.from(speakerSet).map((id) => ({ id, label: id }));
  return {
    engine: 'grok-stt',
    language: data.language || language || 'unknown',
    segments,
    speakers,
    raw_response: data,
  };
}

function needsSpace(left, right) {
  if (!left) return false;
  // Japanese / Chinese: no spaces between characters
  const cjkRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff00-\uffef]/;
  const leftLast = left.slice(-1);
  const rightFirst = right.slice(0, 1);
  if (cjkRegex.test(leftLast) && cjkRegex.test(rightFirst)) return false;
  // Don't double-space around punctuation
  if (/[.,!?;:、。]/.test(rightFirst)) return false;
  return true;
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.webm': 'audio/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.mp4': 'audio/mp4',
  };
  return map[ext] || 'application/octet-stream';
}
