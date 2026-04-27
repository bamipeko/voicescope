import type { Context } from 'hono';
import type { Env } from '../index';
import { verifyJWT } from '../auth';
import { isModelAllowed } from '../middleware/model-guard';
import { checkRateLimit } from '../middleware/rate-limit';

/**
 * POST /v1/chat/completions — Proxy to OpenAI or Grok (xAI).
 *
 * Routes based on model name:
 *   gpt-* → api.openai.com
 *   grok-* → api.x.ai
 */
export async function openaiProxy(c: Context<{ Bindings: Env }>) {
  // Auth
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);

  // Rate limit (per code + per device)
  const allowed = await checkRateLimit(c.env.CODES, payload.code, payload.tier, payload.deviceHash);
  if (!allowed) return c.json({ error: 'Rate limit exceeded' }, 429);

  // Parse body to check model
  const body = await c.req.json();
  const model = body.model || '';

  // Model guard
  if (!isModelAllowed(payload.tier, model)) {
    return c.json({ error: `Model ${model} is not allowed for ${payload.tier} tier` }, 403);
  }

  // Determine upstream
  let upstream: string;
  let apiKey: string;

  if (model.startsWith('grok-')) {
    upstream = 'https://api.x.ai/v1/chat/completions';
    apiKey = c.env.GROK_API_KEY;
  } else {
    upstream = 'https://api.openai.com/v1/chat/completions';
    apiKey = c.env.OPENAI_API_KEY;
  }

  // Forward request
  const resp = await fetch(upstream, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
