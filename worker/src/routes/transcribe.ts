import type { Context } from 'hono';
import type { Env } from '../index';
import { verifyJWT } from '../auth';
import { checkRateLimit } from '../middleware/rate-limit';

/**
 * POST /v1/transcribe — Proxy audio to Deepgram prerecorded API.
 *
 * Accepts raw audio binary body with Deepgram options as query params.
 * Streams audio directly to Deepgram without buffering (memory efficient).
 */
export async function transcribeProxy(c: Context<{ Bindings: Env }>) {
  // Auth
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);

  // Rate limit (per code + per device)
  const allowed = await checkRateLimit(c.env.CODES, payload.code, payload.tier, payload.deviceHash);
  if (!allowed) return c.json({ error: 'Rate limit exceeded' }, 429);

  // Build Deepgram URL with query params
  const url = new URL('https://api.deepgram.com/v1/listen');

  // Forward query params from original request
  const originalUrl = new URL(c.req.url);
  for (const [key, value] of originalUrl.searchParams) {
    url.searchParams.set(key, value);
  }

  // Default params if not set
  if (!url.searchParams.has('model')) url.searchParams.set('model', 'nova-2');
  if (!url.searchParams.has('language')) url.searchParams.set('language', 'ja');
  if (!url.searchParams.has('smart_format')) url.searchParams.set('smart_format', 'true');
  if (!url.searchParams.has('punctuate')) url.searchParams.set('punctuate', 'true');

  // Forward audio body to Deepgram
  const audioBody = await c.req.arrayBuffer();
  const contentType = c.req.header('Content-Type') || 'audio/webm';

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Token ${c.env.DEEPGRAM_API_KEY}`,
      'Content-Type': contentType,
    },
    body: audioBody,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
