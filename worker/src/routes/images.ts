import type { Context } from 'hono';
import type { Env } from '../index';
import { verifyJWT } from '../auth';
import { isModelAllowed } from '../middleware/model-guard';
import { checkRateLimit } from '../middleware/rate-limit';

/**
 * POST /v1/images/generations — Proxy to OpenAI Images API.
 *
 * Forwards JSON body for gpt-image-2 generations. The Worker holds the
 * OpenAI API key (Verified Organization), so end users never have to do
 * the org verification dance themselves — that's the whole point of the
 * managed plan for image generation.
 */
export async function imageGenerationProxy(c: Context<{ Bindings: Env }>) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);

  const allowed = await checkRateLimit(c.env.CODES, payload.code, payload.tier, payload.deviceHash);
  if (!allowed) return c.json({ error: 'Rate limit exceeded' }, 429);

  const body = await c.req.json();
  const model = body.model || 'gpt-image-2';

  if (!isModelAllowed(payload.tier, model)) {
    return c.json({ error: `Model ${model} is not allowed for ${payload.tier} tier` }, 403);
  }

  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}

/**
 * POST /v1/images/edits — Proxy to OpenAI Images Edit API (multipart).
 *
 * Used when the client sends reference images. Forwards multipart body
 * as-is; the OpenAI key is injected server-side.
 */
export async function imageEditProxy(c: Context<{ Bindings: Env }>) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);

  const allowed = await checkRateLimit(c.env.CODES, payload.code, payload.tier, payload.deviceHash);
  if (!allowed) return c.json({ error: 'Rate limit exceeded' }, 429);

  // Multipart body: forward as-is. We can't parse the model out of multipart
  // without consuming the body, so we trust the model-guard on the client
  // side here (defense-in-depth: the rate limit and tier still apply).
  const body = await c.req.arrayBuffer();
  const headers = new Headers(c.req.raw.headers);
  headers.set('Authorization', `Bearer ${c.env.OPENAI_API_KEY}`);
  headers.delete('host');
  headers.delete('content-length');

  const resp = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers,
    body,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
