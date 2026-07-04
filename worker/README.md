# VoiceScope API Worker

Cloudflare Worker that proxies LLM / transcription / image generation
requests for the **managed plan** (Trial / Pro / Heavy). The Worker
holds the operator's API keys (including the OpenAI Verified Organization
key needed for `gpt-image-2`), so end users only need to enter a trial
code — no per-provider account setup.

## Architecture

```
Mobile / Desktop App
       │
       │ Bearer <JWT>
       ▼
   Cloudflare Worker (this repo)
       │
       ├── verifies JWT (issued by /verify)
       ├── checks tier × model allowlist
       ├── enforces per-code + per-device rate limits
       │
       └── forwards to upstream:
              ├── OpenAI       (/v1/chat/completions, /v1/audio/transcriptions, /v1/images/*)
              ├── Anthropic    (/v1/messages)
              ├── Google       (/v1beta/models/...)
              ├── xAI Grok     (api.x.ai)
              └── Deepgram     (api.deepgram.com)
```

## Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET  | `/health` | Liveness probe | none |
| POST | `/verify` | Trial code → JWT | code + deviceHash |
| POST | `/v1/chat/completions` | OpenAI / Grok LLM | JWT |
| POST | `/v1/messages` | Anthropic Claude | JWT (`x-api-key` or `Authorization`) |
| POST | `/v1/transcribe` | Deepgram (raw audio) | JWT |
| POST | `/v1/audio/transcriptions` | OpenAI Whisper (multipart) | JWT |
| POST | `/v1/images/generations` | gpt-image-2 (JSON) | JWT |
| POST | `/v1/images/edits` | gpt-image-2 with refs (multipart) | JWT |
| POST | `/v1beta/models/:model:generateContent` | Google Gemini | JWT |

## First-time setup

### 1. Install Wrangler & login

```powershell
npm install -g wrangler
wrangler login
```

### 2. Install dependencies

```powershell
cd Z:\projects\voicescape\worker
npm install
```

### 3. Create the KV namespace

```powershell
wrangler kv:namespace create CODES
```

Copy the returned `id` into `wrangler.toml` (already present:
`889b99951eca43da9ed20fabb1202728` — replace if you create a new one).

### 4. Set secrets

Each command will prompt you to paste the value (input hidden):

```powershell
wrangler secret put JWT_SECRET            # any long random string, 64+ chars
wrangler secret put OPENAI_API_KEY        # sk-... (Verified Org account)
wrangler secret put DEEPGRAM_API_KEY      # for transcription
wrangler secret put ANTHROPIC_API_KEY     # sk-ant-... (optional)
wrangler secret put GOOGLE_GEMINI_API_KEY # AIza... (optional)
wrangler secret put GROK_API_KEY          # xai-... (optional)
```

Generate `JWT_SECRET` with:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 5. Seed initial codes

Edit `scripts/seed-codes.js` (or use the existing `seed.json` /
`seed-free.json`) and run:

```powershell
npm run seed
```

This populates KV with code definitions like:
```json
{
  "code:VSTEST2026": {
    "tier": "trial",
    "days": 14,
    "source": "internal-test",
    "maxActivations": 1,
    "enabled": true
  }
}
```

### 6. Deploy

```powershell
npm run deploy
```

Output: `https://voicescope-api.<your-account>.workers.dev`

### 7. Test

```powershell
# Health
curl https://voicescope-api.<your-account>.workers.dev/health

# Verify code → get JWT
curl -X POST https://voicescope-api.<your-account>.workers.dev/verify `
  -H "Content-Type: application/json" `
  -d '{\"code\":\"VSTEST2026\",\"deviceHash\":\"abc123def456\"}'
```

## Local development

```powershell
npm run dev
```

Wrangler runs the Worker locally at `http://localhost:8787` using a local KV
emulator. Secrets are NOT loaded locally; use `.dev.vars` for local testing:

```
# .dev.vars (gitignored)
JWT_SECRET=local-test-secret
OPENAI_API_KEY=sk-...
```

## Tier × Model matrix

See `src/middleware/model-guard.ts` for the source of truth. Summary:

| Tier | Cheap LLM | Mid LLM | Top LLM | Whisper | Image gen |
|---|---|---|---|---|---|
| free | ✓ | – | – | ✓ | – |
| trial | ✓ | ✓ | – | ✓ | ✓ |
| pro | ✓ | ✓ | – | ✓ | ✓ |
| heavy | ✓ | ✓ | ✓ | ✓ | ✓ |

## Rate limits (per hour)

See `src/middleware/rate-limit.ts`:

| Tier | Per code | Per device |
|---|---|---|
| free | 30 | 30 |
| trial | 60 | 60 |
| pro | 120 | 120 |
| heavy | 300 | 300 |

Both per-code and per-device caps must be under the limit. This prevents
trial-code sharing via VPN / multi-device abuse.

## Disabling a leaked code

```powershell
wrangler kv:key put --binding=CODES "code:LEAKED2026" '{\"tier\":\"trial\",\"days\":14,\"source\":\"x\",\"maxActivations\":0,\"enabled\":false}'
```

Or just delete:
```powershell
wrangler kv:key delete --binding=CODES "code:LEAKED2026"
```

Existing JWTs remain valid until they expire (max = code's `days`).

## Pricing (Cloudflare Workers free tier as of 2026)

- 100,000 requests/day free
- 10ms CPU time per request free
- KV: 100,000 reads / 1,000 writes / 1GB storage free per day

For ~1000 active users doing 50 calls/day each = 50K/day, easily within free.
At scale, the **Workers Paid** plan ($5/mo flat) covers ~10M requests/month.
