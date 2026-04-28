import { askLLM } from '../ask.js';

/**
 * Convert raw transcription / summary text into a structured JSON shape that's
 * easy for the image-generation prompt to render. Two modes:
 *
 *   mode='whole'  — produce ONE structured infographic block covering the entire content.
 *   mode='split'  — split the content into multiple thematic blocks; the user
 *                   then picks which block(s) to render. Designed for long
 *                   recordings (e.g. 1-hour live streams) where a single
 *                   image can't carry everything.
 */

const SYSTEM_PROMPT_WHOLE = `あなたはインフォグラフィック設計のプロです。
以下の文字起こし/要約を、1枚のインフォグラフィックに最適化されたJSON構造に変換してください。

【出力ルール】
- 必ず日本語で書く
- タイトルは20文字以内、キャッチーで核心を捉える
- 重要ポイントは3〜4個に絞る（詰め込みすぎない）
- 各ポイントは見出し(8〜15文字)+本文(40〜80文字)の構成
- 結論は「学びの核」を1文で

【出力JSON形式】
{
  "title": "string",
  "subtitle": "string (30文字以内)",
  "blocks": [
    {"number": 1, "headline": "string", "body": "string"},
    {"number": 2, "headline": "string", "body": "string"},
    {"number": 3, "headline": "string", "body": "string"}
  ],
  "conclusion": "string",
  "color_palette_hint": "提案する色の方向性 (例: '落ち着いたグリーン+ベージュ')"
}

JSONのみ出力。説明や前置きは不要。`;

const SYSTEM_PROMPT_SPLIT = `あなたはインフォグラフィック設計のプロです。
以下の長尺コンテンツ（ライブ配信・会議・授業等の文字起こし）を、テーマごとの「学びブロック」に分割してください。

【目的】
読み手にとって「持ち帰り価値」のある単位に切り分け、各ブロックを独立したインフォグラフィックとして使えるようにする。

【ブロック分けの方針】
- 短い要約ではなく、学び/気づき/具体例がきちんと伝わる単位
- 1ブロックは独立して理解できる完結した「テーマ」にする
- 全体で 3〜7 ブロック程度
- 重複・抽象すぎる総括ブロックは作らない

【各ブロックの構成】
- 中核メッセージとなる "title" (20文字以内)
- "subtitle" で文脈を補足 (30文字以内)
- 重要ポイント "blocks" (3つ): 見出し+本文
- "conclusion" でブロックの学びを1文に
- "color_palette_hint" 配色の方向性

【出力JSON形式】
{
  "topics": [
    {
      "id": "topic_1",
      "title": "string",
      "subtitle": "string",
      "blocks": [
        {"number": 1, "headline": "string", "body": "string"},
        {"number": 2, "headline": "string", "body": "string"},
        {"number": 3, "headline": "string", "body": "string"}
      ],
      "conclusion": "string",
      "color_palette_hint": "string"
    },
    {"id": "topic_2", ... }
  ]
}

JSONのみ出力。説明や前置きは不要。日本語必須。`;

function extractJson(content) {
  // Tolerate ```json fences, leading whitespace, trailing chatter
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;

  // If still has trailing junk, find the last balanced }
  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: find the largest JSON-looking substring
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
    throw new Error('LLMの応答をJSONとしてパースできませんでした');
  }
}

/**
 * Produce a structured infographic JSON.
 *
 * @param {string} text - the source text (full transcript or existing summary)
 * @param {object} options
 * @param {'whole'|'split'} options.mode
 * @param {string} options.provider - LLM provider for structuring (default openai)
 * @param {string} options.model - LLM model
 */
export async function structureForInfographic(text, options = {}) {
  const mode = options.mode || 'whole';
  const systemPrompt = mode === 'split' ? SYSTEM_PROMPT_SPLIT : SYSTEM_PROMPT_WHOLE;

  if (!text || !text.trim()) {
    throw new Error('構造化する元テキストが空です');
  }

  // Truncate extremely long input to keep token costs bounded.
  // gpt-5 family handles ~50k tokens easily, but 30k chars (~7-10k tokens)
  // is enough for a 1-hour transcription.
  const MAX_CHARS = 30000;
  const input = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n\n[以下省略]' : text;

  const content = await askLLM(input, systemPrompt, {
    provider: options.provider,
    model: options.model,
  });

  const parsed = extractJson(content);

  // Sanity-check the shape
  if (mode === 'split') {
    if (!Array.isArray(parsed?.topics) || parsed.topics.length === 0) {
      throw new Error('split モードでトピックが返されませんでした');
    }
  } else {
    if (!parsed?.title || !Array.isArray(parsed?.blocks)) {
      throw new Error('whole モードで必要なフィールドが揃っていません');
    }
  }

  return parsed;
}
