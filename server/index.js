import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db/database.js';
import recordingsRouter from './routes/recordings.js';
import templatesRouter from './routes/templates.js';
import tagsRouter from './routes/tags.js';
import settingsRouter from './routes/settings.js';
import localStatusRouter from './routes/local-status.js';
import foldersRouter from './routes/folders.js';
import crossAskRouter from './routes/cross-ask.js';
import infographicRouter from './routes/infographic.js';
import { getRuntimeMode, getAppDataDir } from './utils/platform-paths.js';
import { loadKeysIntoEnv } from './utils/keystore.js';
import { openInBrowser } from './utils/launch-browser.js';
import { startTrashCleanupScheduler } from './services/trash-cleanup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect runtime mode early (electron / docker / standalone / dev)
const RUNTIME_MODE = getRuntimeMode();

// In standalone mode, load encrypted API keys from config.json into process.env
// (Electron mode injects these via IPC; Docker mode uses .env)
if (RUNTIME_MODE === 'standalone') {
  const loaded = loadKeysIntoEnv();
  console.log(`[Standalone] Loaded ${loaded} key(s) from config.json`);
}

const app = express();
const PORT = process.env.PORT || 5100;

// Security headers with CSP (permissive for Electron but still protective)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "https://*.deepgram.com", "https://api.openai.com", "https://generativelanguage.googleapis.com", "https://api.x.ai", "https://api.anthropic.com", "https://*.workers.dev"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: only allow same-origin and known localhost ports
const ALLOWED_PORTS = new Set([String(PORT), '5173', '5174']); // server + vite dev
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (Electron, curl, server-to-server)
    if (!origin) return cb(null, true);
    // Allow localhost on known ports only
    const match = origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(?::(\d+))?$/);
    if (match) {
      const port = match[2] || '80';
      if (ALLOWED_PORTS.has(port)) return cb(null, true);
    }
    cb(new Error('CORS blocked'));
  },
}));
app.use(express.json({ limit: '5mb' }));

// API authentication token (set by Electron at startup, skipped in dev mode)
const API_TOKEN = process.env.VOICESCOPE_API_TOKEN || '';
const API_TOKEN_BUF = API_TOKEN ? Buffer.from(API_TOKEN) : null;

// Simple in-memory rate limiter for auth failures
const authFailures = new Map(); // ip -> { count, resetAt }
const AUTH_FAIL_LIMIT = 20;     // max failures per window
const AUTH_FAIL_WINDOW = 60000; // 1 minute

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, fail] of authFailures) {
    if (now >= fail.resetAt) authFailures.delete(ip);
  }
}, 300000).unref();

app.use('/api', (req, res, next) => {
  // Skip auth if no token is configured (dev mode / Docker)
  if (!API_TOKEN_BUF) return next();
  // Allow health check without auth
  if (req.path === '/health') return next();

  // Rate limit check
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const fail = authFailures.get(ip);
  if (fail && fail.count >= AUTH_FAIL_LIMIT && now < fail.resetAt) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Token from header preferred; query param allowed only for audio streaming
  // (<audio src> cannot set custom headers)
  const isAudioStream = /^\/recordings\/[^/]+\/audio$/.test(req.path);
  const provided = req.headers['x-api-token'] || (isAudioStream ? (req.query.token || '') : '');
  const providedBuf = Buffer.from(provided);

  // Timing-safe comparison (prevents timing attacks)
  let valid = false;
  if (providedBuf.length === API_TOKEN_BUF.length) {
    valid = crypto.timingSafeEqual(providedBuf, API_TOKEN_BUF);
  }

  if (!valid) {
    // Record failure for rate limiting
    if (fail && now < fail.resetAt) {
      fail.count++;
    } else {
      authFailures.set(ip, { count: 1, resetAt: now + AUTH_FAIL_WINDOW });
    }
    console.warn(`[Auth] Failed from ${ip}: ${req.method} ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/recordings', recordingsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/tags', tagsRouter);
// Tag routes that need recording context
app.use('/api', tagsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/local-status', localStatusRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/ask-cross', crossAskRouter);
// Infographic generation:
//  POST /api/infographic/recordings/:id/structure  — LLM-structure summary
//  POST /api/infographic/recordings/:id/generate   — image generation
//  GET  /api/infographic/recordings/:id/list       — past generations
//  GET  /api/infographic/:id/image/:n              — stream a generated PNG
//  CRUD /api/infographic/presets                   — saved brand kits
app.use('/api/infographic', infographicRouter);

// Serve static client in production, Electron, and standalone
// (dev mode uses Vite dev server on port 5173)
if (RUNTIME_MODE !== 'dev') {
  // Resolve client dist path. When bundled via bun --compile, assets live next to
  // the binary; VOICESCOPE_CLIENT_DIST env var overrides for packaging flexibility.
  const clientDist = process.env.VOICESCOPE_CLIENT_DIST
    || path.join(__dirname, '..', 'client', 'dist');

  app.use('/assets', express.static(path.join(clientDist, 'assets'), {
    maxAge: '30d',
    immutable: true,
  }));
  app.use(express.static(clientDist, {
    maxAge: 0,
    etag: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    },
  }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Initialize DB then start server
initDatabase().then(() => {
  const server = app.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`[${RUNTIME_MODE}] VoiceScope server running on ${url}`);
    console.log(`[${RUNTIME_MODE}] Data directory: ${getAppDataDir()}`);
    // Log API key status for debugging (never log actual keys)
    console.log(`[Config] DEEPGRAM_API_KEY: ${process.env.DEEPGRAM_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`[Config] GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`[Config] OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`[Config] GROK_API_KEY: ${process.env.GROK_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`[Config] ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET'}`);

    // In standalone mode, open the user's browser automatically.
    // VOICESCOPE_NO_BROWSER=1 disables this (for CI or headless use).
    if (RUNTIME_MODE === 'standalone' && !process.env.VOICESCOPE_NO_BROWSER) {
      setTimeout(() => openInBrowser(url), 800);
    }

    // Purge expired trash items now, and every 6 hours afterwards.
    // This is what makes "30日間起動しなかった場合は次回起動時に削除" work.
    startTrashCleanupScheduler();
  });

  // Handle EADDRINUSE gracefully: another VoiceScope instance is already running,
  // so just point the user's browser at the existing one and exit.
  // This prevents scary "server crashed" UX when user double-clicks the .exe twice.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const url = `http://localhost:${PORT}`;
      console.log(`[${RUNTIME_MODE}] Port ${PORT} already in use — assuming another instance; opening browser`);
      if (RUNTIME_MODE === 'standalone' && !process.env.VOICESCOPE_NO_BROWSER) {
        openInBrowser(url);
        // Give the spawned browser a moment before we exit
        setTimeout(() => process.exit(0), 500);
      } else {
        process.exit(1);
      }
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
