<#
.SYNOPSIS
  Build VoiceScope Windows single-EXE (portable, browser-GUI based).

.DESCRIPTION
  Produces dist-win/VoiceScope.exe — a single-file self-extracting archive
  that installs to %LOCALAPPDATA%\VoiceScope-app and launches the server
  without showing any console window. The server opens the user's default
  browser at http://localhost:5100.

  Prerequisites (install once):
    - Bun           https://bun.sh/install
    - Node.js 20+   https://nodejs.org
    - NSIS 3.x      https://nsis.sourceforge.io  (or: choco install nsis)

  Usage:
    pwsh scripts/build-win-portable.ps1
#>

param(
  [string]$Arch = 'x64'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

$Version = (Get-Content "$RepoRoot/package.json" -Raw | ConvertFrom-Json).version
Write-Host "=== VoiceScope Windows Portable Build ===" -ForegroundColor Cyan
Write-Host "Version: $Version"
Write-Host "Arch:    $Arch"
Write-Host "Root:    $RepoRoot"
Write-Host ""

# Check prerequisites -------------------------------------------------------
function Require-Tool($name, $url) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "$name not found in PATH. Install from $url"
  }
}
Require-Tool 'bun' 'https://bun.sh/install'
Require-Tool 'node' 'https://nodejs.org'
Require-Tool 'makensis' 'https://nsis.sourceforge.io or run: choco install nsis'

# Clean output --------------------------------------------------------------
$DistDir = Join-Path $RepoRoot 'dist-win'
$Staging = Join-Path $DistDir 'staging'
Remove-Item -Recurse -Force $DistDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

# 1. Build React client -----------------------------------------------------
Write-Host "[1/5] Building client (Vite)..." -ForegroundColor Yellow
Push-Location "$RepoRoot/client"
try { npm run build } finally { Pop-Location }

# 2. Bun-compile server to single Windows binary ----------------------------
Write-Host "[2/5] Compiling server with Bun..." -ForegroundColor Yellow
$bunTarget = if ($Arch -eq 'arm64') { 'bun-windows-arm64' } else { 'bun-windows-x64' }
$serverExe = Join-Path $Staging 'voicescape-server.exe'
& bun build `
  --compile `
  --target=$bunTarget `
  --minify `
  --sourcemap=none `
  --outfile $serverExe `
  "$RepoRoot/server/index.js"
if (-not (Test-Path $serverExe)) {
  Write-Error "Bun compile failed — $serverExe not produced"
}

# 3. Assemble staging folder -----------------------------------------------
Write-Host "[3/5] Staging bundled assets..." -ForegroundColor Yellow
# Client static files → staging/client/
Copy-Item -Recurse "$RepoRoot/client/dist" "$Staging/client"

# sql.js WASM — required by the server at runtime
$sqlWasm = "$RepoRoot/node_modules/sql.js/dist/sql-wasm.wasm"
if (-not (Test-Path $sqlWasm)) {
  Write-Error "sql-wasm.wasm not found. Run 'npm install' first."
}
Copy-Item $sqlWasm "$Staging/sql-wasm.wasm"

# Schema SQL
Copy-Item "$RepoRoot/server/db/schema.sql" "$Staging/schema.sql"

# Launchers
Copy-Item "$RepoRoot/build/win/launcher.vbs" "$Staging/launcher.vbs"
Copy-Item "$RepoRoot/build/win/run-console.cmd" "$Staging/run-console.cmd"

# 4. Run makensis to produce the single EXE ---------------------------------
Write-Host "[4/5] Running NSIS to wrap into single EXE..." -ForegroundColor Yellow
$Nsi = Join-Path $RepoRoot 'build/win/installer.nsi'
$OutExe = Join-Path $DistDir 'VoiceScope.exe'
# /DVERSION passes the version into the .nsi as a preprocessor define.
& makensis "/DVERSION=$Version" `
  "/DSTAGING_DIR=$Staging" `
  "/DOUTPUT_EXE=$OutExe" `
  "/DICON_FILE=$RepoRoot/electron/assets/icon.ico" `
  $Nsi
if ($LASTEXITCODE -ne 0) {
  Write-Error "makensis failed with exit code $LASTEXITCODE"
}

# 5. Rename with version + done ---------------------------------------------
$Renamed = Join-Path $DistDir "VoiceScope-$Version.exe"
Copy-Item $OutExe $Renamed -Force

Write-Host ""
Write-Host "[5/5] Done." -ForegroundColor Green
Write-Host "  Single EXE:  $Renamed"
Write-Host "  Unversioned: $OutExe"
Write-Host ""
Write-Host "Test locally:" -ForegroundColor Cyan
Write-Host "  & '$Renamed'"
Write-Host ""
Write-Host "Extracts to: %LOCALAPPDATA%\VoiceScope-app"
Write-Host "User data:   %APPDATA%\VoiceScope"
