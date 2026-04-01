# VoiceScope — Claude Code Rules

## Language
- Code and comments: English
- UI text: Japanese

## Project Structure
- `server/` — Express backend (Node.js, ESM)
- `client/` — React frontend (Vite + Tailwind CSS)
- `electron/` — Electron main process (CJS, .cjs files)
- `data/` — SQLite DB + audio files (Docker volume mount)

## Tech Stack (DO NOT change without approval)
- Frontend: React (Vite) + Tailwind CSS v4 + Zustand
- Backend: Express + sql.js (WASM SQLite)
- Desktop: Electron + electron-builder
- Transcription: Deepgram API (main), OpenAI Whisper API (alt)
- Summary LLM: Gemini API / Grok API / OpenAI API (switchable)
- Storage: Local filesystem + SQLite

## Rules
1. Update STATUS.md at end of each session
2. All API calls must have try-catch with user-friendly error messages
3. API keys in `.env` (server/Docker) or electron-store (desktop). Never hardcode secrets.
4. Commit per feature — don't mix multiple features in one commit
5. Port: 5100
6. Electron main process files use .cjs extension (package.json has "type": "module")

## Dev Commands
- `npm run dev` — Start both server and client in dev mode (web)
- `npm run build` — Build client for production
- `npm start` — Production server (serves built client)
- `npm run setup` — Install all dependencies
- `npm run electron:dev` — Start server + client + Electron window
- `npm run electron:start` — Build + launch Electron
- `npm run electron:build` — Build + package as Windows .exe
