import { askLLM } from './ask.js';

// ============================================================
// Local parsers (fast, free, no API needed)
// ============================================================

const PLAUD_PATTERN = /^(.+?)\s{2,}\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*$/;
const COLON_PATTERN = /^([^:：]{1,30})[：:](.+)/;
const SRT_TIME_PATTERN = /^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}$/;
const VTT_TIME_PATTERN = /^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}$/;
const WHISPER_BRACKET = /^\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*(?:-->|→)\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s*(.+)/;
const OTTER_PATTERN = /^(.+?)\s{2,}(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;

function parseTimestamp(ts) {
  const parts = ts.replace(/[.,]/g, ':').split(':').map(Number);
  if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + (parts[1] || 0);
}

/**
 * Detect format and parse locally. Returns null if format is unknown.
 */
function tryLocalParse(text) {
  const rawLines = text.split('\n');

  // 1. Plaud format: "Speaker  (MM:SS)" + next line text
  if (rawLines.some(l => PLAUD_PATTERN.test(l.trim()))) {
    return parsePlaudFormat(rawLines);
  }

  // 2. Otter.ai format: "Speaker  MM:SS" (no parentheses)
  if (rawLines.some(l => OTTER_PATTERN.test(l.trim())) && !rawLines.some(l => COLON_PATTERN.test(l.trim()))) {
    return parsePlaudFormat(rawLines, OTTER_PATTERN);
  }

  // 3. SRT subtitle format
  if (rawLines.some(l => SRT_TIME_PATTERN.test(l.trim()))) {
    return parseSrtFormat(rawLines);
  }

  // 4. VTT subtitle format
  if (rawLines.some(l => VTT_TIME_PATTERN.test(l.trim()))) {
    return parseSrtFormat(rawLines); // same logic works
  }

  // 5. Whisper bracket format: [00:00:00 --> 00:00:03] text
  if (rawLines.some(l => WHISPER_BRACKET.test(l.trim()))) {
    return parseWhisperBracket(rawLines);
  }

  // 6. Colon format: "Speaker: text" (all lines)
  const colonLines = rawLines.filter(l => l.trim());
  if (colonLines.length > 0 && colonLines.filter(l => COLON_PATTERN.test(l)).length > colonLines.length * 0.5) {
    return parseColonFormat(colonLines);
  }

  // Unknown format
  return null;
}

function parsePlaudFormat(rawLines, pattern = PLAUD_PATTERN) {
  const segments = [];
  let cur = { speaker: 'speaker_0', start: 0, text: '' };

  for (const line of rawLines) {
    const m = line.trim().match(pattern);
    if (m) {
      if (cur.text.trim()) {
        segments.push({ start: cur.start, end: parseTimestamp(m[2]), speaker: cur.speaker, text: cur.text.trim() });
      }
      cur = { speaker: m[1].trim(), start: parseTimestamp(m[2]), text: '' };
    } else if (line.trim()) {
      cur.text += (cur.text ? ' ' : '') + line.trim();
    }
  }
  if (cur.text.trim()) {
    segments.push({ start: cur.start, end: cur.start + 30, speaker: cur.speaker, text: cur.text.trim() });
  }
  return segments;
}

function parseSrtFormat(rawLines) {
  const segments = [];
  const timePattern = /(\d{2}:\d{2}:\d{2})[.,](\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2})[.,](\d{3})/;
  let i = 0;
  while (i < rawLines.length) {
    const timeLine = rawLines[i]?.trim();
    const m = timeLine?.match(timePattern);
    if (m) {
      const start = parseTimestamp(m[1]);
      const end = parseTimestamp(m[3]);
      i++;
      let text = '';
      while (i < rawLines.length && rawLines[i].trim() && !rawLines[i].trim().match(/^\d+$/) && !rawLines[i].match(timePattern)) {
        text += (text ? ' ' : '') + rawLines[i].trim();
        i++;
      }
      if (text) segments.push({ start, end, speaker: 'speaker_0', text });
    } else {
      i++;
    }
  }
  return segments;
}

function parseWhisperBracket(rawLines) {
  const segments = [];
  for (const line of rawLines) {
    const m = line.trim().match(WHISPER_BRACKET);
    if (m) {
      segments.push({
        start: parseTimestamp(m[1]),
        end: parseTimestamp(m[2]),
        speaker: 'speaker_0',
        text: m[3].trim(),
      });
    }
  }
  return segments;
}

function parseColonFormat(lines) {
  return lines.map((line, i) => {
    const match = line.match(COLON_PATTERN);
    return {
      start: i * 10,
      end: (i + 1) * 10,
      speaker: match ? match[1].trim() : 'speaker_0',
      text: match ? match[2].trim() : line.trim(),
    };
  });
}

// ============================================================
// LLM parser + refiner (fallback for unknown formats, 1 API call)
// ============================================================

const LLM_PARSE_PROMPT = `あなたは文字起こしテキストの構造化・整形の専門家です。
以下のテキストを分析し、JSON配列として構造化してください。

【やること（1回で完結）】
1. テキストの形式を自動判定する（タイムスタンプ付き、話者ラベル付き、プレーンテキスト等）
2. 話者名とタイムスタンプがあれば正確に抽出する
3. フィラー（えー、あの、うーん等）を除去し、句読点を整理する（意味は変えない）
4. 言い直し・重複を整理する
5. 結果をJSON配列で返す

【出力形式】
JSON配列のみを返してください。説明は不要です。
各要素: {"speaker": "話者名", "start": 秒数, "text": "整形済みテキスト"}
- 話者が不明ならspeakerは"speaker_0"
- タイムスタンプが不明ならstartは0から10秒刻み
- textは整形済み（フィラー除去・句読点整理済み）

【重要ルール】
- 内容の追加・削除・言い換えは禁止。整形のみ
- JSON以外のテキストは出力しない`;

/**
 * Parse text to segments. Tries local parsers first, falls back to LLM.
 * Returns { segments, speakers, usedLLM }
 */
export async function parseTextToSegments(text) {
  // Try local parsing first
  const localResult = tryLocalParse(text);
  if (localResult && localResult.length > 0) {
    const speakers = [...new Set(localResult.map(s => s.speaker))].map(s => ({ id: s, label: s }));
    console.log(`[TextParser] Local parse: ${localResult.length} segments, ${speakers.length} speakers`);
    return { segments: localResult, speakers, usedLLM: false };
  }

  // Fallback: LLM parse + refine in one call
  console.log(`[TextParser] Unknown format, using LLM (${text.length} chars)`);
  try {
    // Chunk if too long (6000 chars ≈ 2000 tokens per chunk)
    const MAX_CHARS = 12000;
    const inputText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n...(以降省略)' : text;

    const response = await askLLM(inputText, LLM_PARSE_PROMPT, {
      provider: 'openai',
      model: 'gpt-5-nano',
    });

    // Parse JSON from response
    const jsonStr = response.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
    const match = jsonStr.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('LLM returned non-JSON');

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty result');

    // Normalize
    const segments = parsed.map((s, i) => ({
      start: typeof s.start === 'number' ? s.start : i * 10,
      end: typeof s.end === 'number' ? s.end : (typeof s.start === 'number' ? s.start + 30 : (i + 1) * 10),
      speaker: s.speaker || 'speaker_0',
      text: (s.text || '').trim(),
    })).filter(s => s.text);

    const speakers = [...new Set(segments.map(s => s.speaker))].map(s => ({ id: s, label: s }));
    console.log(`[TextParser] LLM parse: ${segments.length} segments, ${speakers.length} speakers`);
    return { segments, speakers, usedLLM: true };
  } catch (err) {
    console.error('[TextParser] LLM parse failed:', err.message);

    // Final fallback: treat as plain text, line by line
    const lines = text.split('\n').filter(l => l.trim());
    const segments = lines.map((line, i) => ({
      start: i * 10,
      end: (i + 1) * 10,
      speaker: 'speaker_0',
      text: line.trim(),
    }));
    const speakers = [{ id: 'speaker_0', label: 'speaker_0' }];
    console.log(`[TextParser] Fallback plain: ${segments.length} segments`);
    return { segments, speakers, usedLLM: false };
  }
}
