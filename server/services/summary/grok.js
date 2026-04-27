import OpenAI from 'openai';
import { isManagedMode } from '../managed.js';

export async function summarizeWithGrok(text, systemPrompt, options = {}) {
  const { managed, workerBaseURL, token } = isManagedMode('grok');

  let client;
  if (managed) {
    // Worker routes grok-* models to api.x.ai
    client = new OpenAI({ apiKey: token, baseURL: `${workerBaseURL}/v1` });
  } else {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) throw new Error('GROK_API_KEY が設定されていません');
    client = new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1' });
  }

  const model = options.model || 'grok-4-1-fast-non-reasoning';

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
  });

  return response.choices[0].message.content;
}
