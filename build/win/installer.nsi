; VoiceScope single-EXE portable build (Windows).
;
; Produces VoiceScope.exe — a single-file self-extracting executable.
;
; Behaviour on double-click:
;   1. Silently extracts bundled files to %LOCALAPPDATA%\VoiceScope-app (no UI)
;   2. Spawns launcher.vbs via wscript.exe (hidden, no console window)
;   3. launcher.vbs starts voicescape-server.exe with standalone env vars
;   4. Server auto-opens the user's default browser at http://localhost:5100
;
; Re-running the .exe re-extracts (overwrites) — this handles version updates.
; If the server is already running on port 5100, the new process detects
; EADDRINUSE and just opens the browser (see server/index.js).
;
; Build:  makensis /DVERSION=0.12.0 installer.nsi

!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef STAGING_DIR
  !define STAGING_DIR "..\..\dist-win\staging"
!endif
!ifndef OUTPUT_EXE
  !define OUTPUT_EXE "..\..\dist-win\VoiceScope.exe"
!endif
!ifndef ICON_FILE
  !define ICON_FILE "..\..\electron\assets\icon.ico"
!endif

Name "VoiceScope"
OutFile "${OUTPUT_EXE}"
Icon "${ICON_FILE}"

; Silent install: no dialogs, no progress bar. User just double-clicks, sees
; nothing for ~2 seconds, then the browser opens.
SilentInstall silent

; Per-user — no UAC prompt.
RequestExecutionLevel user

; Version resource info shown in File Explorer Properties
VIProductVersion "${VERSION}.0"
VIFileVersion    "${VERSION}.0"
VIAddVersionKey  "ProductName"      "VoiceScope"
VIAddVersionKey  "FileDescription"  "VoiceScope - Voice transcription & AI summary"
VIAddVersionKey  "FileVersion"      "${VERSION}.0"
VIAddVersionKey  "ProductVersion"   "${VERSION}.0"
VIAddVersionKey  "CompanyName"      "VoiceScope"
VIAddVersionKey  "LegalCopyright"   "MIT License"
VIAddVersionKey  "OriginalFilename" "VoiceScope.exe"

Section "Extract and launch"
  ; Always overwrite to ensure the user gets the latest files.
  SetOverwrite on
  SetOutPath "$LOCALAPPDATA\VoiceScope-app"

  ; Bundle everything from the staging folder (server exe, client/, wasm, schema, vbs, cmd).
  File /r "${STAGING_DIR}\*.*"

  ; Breadcrumb for update/debug tooling
  FileOpen $0 "$LOCALAPPDATA\VoiceScope-app\.version" w
  FileWrite $0 "${VERSION}"
  FileClose $0

  ; Fire launcher.vbs via wscript (hidden — no console window flashes).
  ; Exec is non-blocking; NSIS exits immediately after spawning.
  Exec 'wscript.exe "$LOCALAPPDATA\VoiceScope-app\launcher.vbs"'
SectionEnd
