import OpenAI from 'openai';

export async function summarizeWithOpenAI(text, systemPrompt, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません');
  }

  const model = options.model || 'gpt-5.4-nano';
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
  });

  return response.choices[0].message.content;
}
