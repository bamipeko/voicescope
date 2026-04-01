# VoiceScope — Claude Code Rules

## Language
- Code and comments: English
- UI text: Japanese

## Project Structure
- `server/` — Express backend (Node.js)
- `client/` — React frontend (Vite + Tailwind CSS)
- `data/` — SQLite DB + audio files (Docker volume mount)

## Tech Stack (DO NOT change without approval)
- Frontend: React (Vite) + Tailwind CSS + Zustand
- Backend: Express + better-sqlite3
- Transcription: Deepgram API (main), OpenAI Whisper API (alt)
- Summary LLM: Gemini API / Grok API / OpenAI API (switchable)
- Storage: Local filesystem + SQLite

## Rules
1. Update STATUS.md at end of each session
2. All API calls must have try-catch with user-friendly error messages
3. API keys in `.env` only (loaded via dotenv). Never hardcode secrets.
4. Commit per feature — don't mix multiple features in one commit
5. Port: 5100

## Dev Commands
- `npm run dev` — Start both server and client in dev mode
- `npm run build` — Build client for production
- `npm start` — Production server (serves built client)
- `npm run setup` — Install all dependencies
