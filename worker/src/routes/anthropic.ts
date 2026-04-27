import type { Context } from 'hono';
import type { Env } from '../index';
import { verifyJWT } from '../auth';
import { isModelAllowed } from '../middleware/model-guard';
import { checkRateLimit } from '../middleware/rate-limit';

/**
 * POST /v1/messages — Proxy to Anthropic Messages API.
 *
 * The app sends the managed JWT in the x-api-key header
 * (Anthropic SDK sets apiKey → x-api-key).
 * We verify the JWT, replace it with the real Anthropic key, and forward.
 */
export async function anthropicProxy(c: Context<{ Bindings: Env }>) {
  // Auth — Anthropic SDK sends key in x-api-key header
  const token = c.req.header('x-api-key') || c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);

  // Rate limit (per code + per device)
  const allowed = await checkRateLimit(c.env.CODES, payload.code, payload.tier, payload.deviceHash);
  if (!allowed) return c.json({ error: 'Rate limit exceeded' }, 429);

  // Parse body to check model
  const body = await c.req.json();
  const model = body.model || '';

  if (!isModelAllowed(payload.tier, model)) {
    return c.json({ error: `Model ${model} is not allowed for ${payload.tier} tier` }, 403);
  }

  // Forward to Anthropic
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': c.env.ANTHROPIC_API_KEY,
      'anthropic-version': c.req.header('anthropic-version') || '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
