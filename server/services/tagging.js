import { summarize } from './summary/index.js';
import { queryAll } from '../db/database.js';

const TAG_PROMPT = `あなたはテキスト分析アシスタントです。以下の会話テキストに適切なタグを3〜5個提案してください。

ルール:
- タグは短く簡潔に（1〜4語程度）
- 日本語で
- 会話の主題、種類、関連する分野を反映
- JSON配列で返してください（例: ["プロジェクト管理", "デザインレビュー", "締め切り"]）

JSON配列のみを返してください。他のテキストは不要です。`;

export async function suggestTags(transcriptionText, options = {}) {
  // Get existing tags for context
  const existingTags = queryAll('SELECT name FROM tags ORDER BY name');
  const existingTagNames = existingTags.map(t => t.name);

  let prompt = TAG_PROMPT;
  if (existingTagNames.length > 0) {
    prompt += `\n\n既存のタグ一覧（できるだけこの中から選んでください）:\n${existingTagNames.join(', ')}`;
  }

  const provider = options.provider || 'gemini';
  const model = options.model || 'gemini-3.1-flash-lite-preview';

  // Use summary infrastructure with tag-specific prompt
  const { summarizeWithGemini } = await import('./summary/gemini.js');
  const { summarizeWithGrok } = await import('./summary/grok.js');
  const { summarizeWithOpenAI } = await import('./summary/openai.js');

  const providers = { gemini: summarizeWithGemini, grok: summarizeWithGrok, openai: summarizeWithOpenAI };
  const fn = providers[provider] || summarizeWithGemini;

  const result = await fn(transcriptionText, prompt, { model });

  // Parse JSON array from response
  try {
    const match = result.match(/\[[\s\S]*?\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch {}

  return [];
}
