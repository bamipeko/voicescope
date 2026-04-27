import Anthropic from '@anthropic-ai/sdk';
import { isManagedMode } from '../managed.js';

export async function summarizeWithClaude(text, systemPrompt, options = {}) {
  const { managed, workerBaseURL, token } = isManagedMode('anthropic');

  let client;
  if (managed) {
    // Worker's /v1/messages reads x-api-key (JWT token), verifies it, injects real key
    client = new Anthropic({ apiKey: token, baseURL: workerBaseURL });
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY が設定されていません');
    client = new Anthropic({ apiKey });
  }

  const model = options.model || 'claude-sonnet-4-6';

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      { role: 'user', content: text },
    ],
  });

  return response.content[0].text;
}
