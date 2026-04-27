import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verify } from './routes/verify';
import { openaiProxy } from './routes/openai';
import { anthropicProxy } from './routes/anthropic';
import { transcribeProxy } from './routes/transcribe';

export interface Env {
  CODES: KVNamespace;
  JWT_SECRET: string;
  OPENAI_API_KEY: string;
  DEEPGRAM_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GROK_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS — allow all origins (requests come from desktop app server-side)
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));


// Code verification
app.post('/verify', verify);

// LLM proxies (all require JWT auth)
app.post('/v1/chat/completions', openaiProxy);
app.post('/v1/messages', anthropicProxy);
app.post('/v1/transcribe', transcribeProxy);

// Whisper transcription (OpenAI-compatible)
app.post('/v1/audio/transcriptions', async (c) => {
  // Forward to OpenAI Whisper API
  const jwt = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!jwt) return c.json({ error: 'Unauthorized' }, 401);

  const { verifyJWT } = await import('./auth');
  const payload = await verifyJWT(jwt, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);

  const body = await c.req.arrayBuffer();
  const headers = new Headers(c.req.raw.headers);
  headers.set('Authorization', `Bearer ${c.env.OPENAI_API_KEY}`);
  headers.delete('host');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers,
    body,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
});

export default app;
