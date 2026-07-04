import type { Context } from 'hono';
import type { Env } from '../index';
import { verifyJWT } from '../auth';
import { isModelAllowed } from '../middleware/model-guard';
import { checkRateLimit } from '../middleware/rate-limit';

/**
 * POST /v1beta/models/:model::generateContent — Proxy to Google Gemini.
 *
 * Gemini uses an unusual URL pattern with the model in the path. We extract
 * the model name from the URL and use it for the model-guard check.
 *
 * Note: Gemini SDK passes the API key as a query param (?key=...).
 * To make managed mode work, the client forwards a JWT in the Authorization
 * header instead, and we replace ?key=... with the real Gemini key.
 */
export async function geminiProxy(c: Context<{ Bindings: Env }>) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);

  const allowed = await checkRateLimit(c.env.CODES, payload.code, payload.tier, payload.deviceHash);
  if (!allowed) return c.json({ error: 'Rate limit exceeded' }, 429);

  // Extract model from URL path: /v1beta/models/<model>:generateContent
  const path = c.req.path;
  const m = path.match(/\/v1beta\/models\/([^:]+):generateContent/);
  const model = m?.[1] || '';

  if (!isModelAllowed(payload.tier, model)) {
    return c.json({ error: `Model ${model} is not allowed for ${payload.tier} tier` }, 403);
  }

  const body = await c.req.arrayBuffer();
  const upstream = new URL(`https://generativelanguage.googleapis.com${path}`);
  upstream.searchParams.set('key', c.env.GOOGLE_GEMINI_API_KEY);

  const resp = await fetch(upstream.toString(), {
    method: 'POST',
    headers: { 'Content-Type': c.req.header('Content-Type') || 'application/json' },
    body,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
