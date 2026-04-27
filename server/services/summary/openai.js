import OpenAI from 'openai';
import { isManagedMode } from '../managed.js';

export async function summarizeWithOpenAI(text, systemPrompt, options = {}) {
  const { managed, workerBaseURL, token } = isManagedMode('openai');

  let client;
  if (managed) {
    client = new OpenAI({ apiKey: token, baseURL: `${workerBaseURL}/v1` });
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY が設定されていません');
    client = new OpenAI({ apiKey });
  }

  const model = options.model || 'gpt-5.4-nano';

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
  });

  return response.choices[0].message.content;
}
