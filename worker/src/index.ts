import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verify } from './routes/verify';
import { openaiProxy } from './routes/openai';
import { anthropicProxy } from './routes/anthropic';
import { transcribeProxy } from './routes/transcribe';
import { imageGenerationProxy, imageEditProxy } from './routes/images';
import { geminiProxy } from './routes/gemini';
import { verifyJWT } from './auth';

export interface Env {
  CODES: KVNamespace;
  JWT_SECRET: string;
  OPENAI_API_KEY: string;
  DEEPGRAM_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_GEMINI_API_KEY: string;
  GROK_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS — allow all origins. Requests can come from:
//   - Electron app's bundled Express (server-to-server)
//   - Capacitor mobile app (origin is `capacitor://localhost` or similar)
app.use('*', cors());

// Health check (no auth) — used by uptime monitoring + setup wizard
app.get('/health', (c) => c.json({ status: 'ok', version: '1.1.0' }));

// Code verification — issues JWT in exchange for a valid trial/subscription code
app.post('/verify', verify);

// LLM proxies — all require JWT auth (verified inside each handler)
app.post('/v1/chat/completions', openaiProxy);          // OpenAI / Grok
app.post('/v1/messages', anthropicProxy);                // Anthropic
app.post('/v1/transcribe', transcribeProxy);             // Deepgram (raw audio)
app.post('/v1/audio/transcriptions', whisperProxy);      // OpenAI Whisper

// Image generation — gpt-image-2. The Worker holds the OpenAI Verified
// Organization key so end users skip the ID verification dance.
app.post('/v1/images/generations', imageGenerationProxy);
app.post('/v1/images/edits', imageEditProxy);

// Google Gemini — the SDK uses /v1beta/models/<model>:generateContent
app.post('/v1beta/models/:model/generateContent', geminiProxy);
app.post('/v1beta/models/:model{.+}', geminiProxy); // catch-all for streaming variants

export default app;

/**
 * OpenAI Whisper proxy (audio file uploads as multipart/form-data).
 * Defined inline because it's a thin pass-through and doesn't need its own
 * file. Body is forwarded as-is so that multipart boundaries are preserved.
 */
async function whisperProxy(c: any) {
  const jwt = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!jwt) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT(jwt, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);

  const body = await c.req.arrayBuffer();
  const headers = new Headers(c.req.raw.headers);
  headers.set('Authorization', `Bearer ${c.env.OPENAI_API_KEY}`);
  headers.delete('host');
  headers.delete('content-length');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers,
    body,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
