import OpenAI from 'openai';

export async function summarizeWithGrok(text, systemPrompt, options = {}) {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY が設定されていません');
  }

  const model = options.model || 'grok-4-1-fast-non-reasoning';
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.x.ai/v1',
  });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
  });

  return response.choices[0].message.content;
}
