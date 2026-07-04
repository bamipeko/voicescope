# VoiceScope Worker one-shot deploy script (PowerShell 5.1 compatible)
# Usage:  cd Z:\projects\voicescape\worker ; .\deploy.ps1
# - Logs into Cloudflare if needed (browser opens once — click Approve)
# - Sets secrets from ..\.env without echoing values
# - Seeds activation codes, deploys, and runs smoke tests

$ErrorActionPreference = 'Stop'
$workerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $workerDir

Write-Host "== VoiceScope Worker deploy ==" -ForegroundColor Cyan

# 1. Dependencies
if (-not (Test-Path (Join-Path $workerDir 'node_modules'))) {
  Write-Host "[1/6] npm install..."
  npm install
} else {
  Write-Host "[1/6] node_modules OK"
}

# 2. Login check (browser opens if token expired)
# NOTE: capture via cmd — PS 5.1 turns native stderr into a terminating error
# under $ErrorActionPreference='Stop' when redirected with 2>&1
Write-Host "[2/6] Cloudflare login check..."
$who = cmd /c "npx wrangler whoami 2>&1" | Out-String
if ($who -match 'Not logged in') {
  Write-Host "  -> Browser will open. Click 'Allow' to authorize wrangler." -ForegroundColor Yellow
  npx wrangler login
}

# 3. Secrets from ..\.env (values are never printed)
Write-Host "[3/6] Setting secrets from .env..."
$envPath = Join-Path (Split-Path -Parent $workerDir) '.env'
$envMap = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') {
    $envMap[$Matches[1]] = $Matches[2]
  }
}

# .env name -> Worker secret name
$mapping = @{
  'OPENAI_API_KEY'   = 'OPENAI_API_KEY'
  'DEEPGRAM_API_KEY' = 'DEEPGRAM_API_KEY'
  'GEMINI_API_KEY'   = 'GOOGLE_GEMINI_API_KEY'
  'GROK_API_KEY'     = 'GROK_API_KEY'
}

$existing = cmd /c "npx wrangler secret list 2>nul" | Out-String

foreach ($src in $mapping.Keys) {
  $dest = $mapping[$src]
  if (-not $envMap.ContainsKey($src)) {
    Write-Host "  SKIP $dest (no $src in .env)" -ForegroundColor Yellow
    continue
  }
  $envMap[$src] | npx wrangler secret put $dest | Out-Null
  Write-Host "  set $dest"
}

# ANTHROPIC_API_KEY is not in .env — managed Claude summaries stay disabled until added
if ($existing -notmatch 'ANTHROPIC_API_KEY') {
  Write-Host "  NOTE: ANTHROPIC_API_KEY not set (Claude via managed plan disabled; other providers unaffected)" -ForegroundColor Yellow
}

# JWT_SECRET: generate once, never regenerate (would invalidate issued tokens)
if ($existing -match 'JWT_SECRET') {
  Write-Host "  JWT_SECRET already set — keeping it"
} else {
  $jwt = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  $jwt | npx wrangler secret put JWT_SECRET | Out-Null
  Write-Host "  set JWT_SECRET (generated)"
}

# 4. Seed activation codes (same definitions as scripts/seed-codes.js)
Write-Host "[4/6] Seeding activation codes..."
$codes = @{
  'VSTEST2026'   = '{"tier":"trial","days":14,"source":"VoiceScope","maxActivations":100,"enabled":true}'
  'VSFRIEND2026' = '{"tier":"trial","days":14,"source":"VoiceScope","maxActivations":50,"enabled":true}'
}
foreach ($code in $codes.Keys) {
  npx wrangler kv key put --binding CODES --remote "code:$code" $codes[$code] | Out-Null
  Write-Host "  seeded code:$code"
}

# 5. Deploy
Write-Host "[5/6] Deploying..."
npx wrangler deploy

# 6. Smoke tests
Write-Host "[6/6] Smoke tests..."
$base = 'https://voicescope.voicescope.workers.dev'
$health = Invoke-RestMethod -Uri "$base/health" -Method Get
Write-Host "  /health -> $($health | ConvertTo-Json -Compress)"

$verifyBody = '{"code":"VSTEST2026","deviceHash":"deploy-script-test-0001"}'
$verify = Invoke-RestMethod -Uri "$base/verify" -Method Post -ContentType 'application/json' -Body $verifyBody
Write-Host "  /verify -> tier=$($verify.tier) expiry=$($verify.expiry)"

$chatBody = '{"model":"gpt-5-nano","messages":[{"role":"user","content":"say OK"}],"max_tokens":10}'
$chat = Invoke-RestMethod -Uri "$base/v1/chat/completions" -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $($verify.token)" } -Body $chatBody
Write-Host "  /v1/chat/completions -> $($chat.choices[0].message.content)"

Write-Host ""
Write-Host "DONE. Next: launch VoiceScope, Settings -> plan, enter trial code VSTEST2026, run a summary." -ForegroundColor Green
