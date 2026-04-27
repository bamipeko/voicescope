@echo off
REM VoiceScope debug launcher — runs the server in a visible console.
REM
REM Ship this alongside voicescape-server.exe so users can double-click it
REM when the normal (hidden) launcher doesn't open the browser. The console
REM window shows real-time server logs, which helps diagnose issues such as
REM missing API keys, port conflicts, or antivirus interference.
REM
REM Close the window or press Ctrl+C to stop the server.

setlocal
cd /d "%~dp0"
set VOICESCOPE_STANDALONE=1
set VOICESCOPE_CLIENT_DIST=%~dp0client
set VOICESCOPE_SQLJS_WASM=%~dp0sql-wasm.wasm
set VOICESCOPE_SCHEMA_SQL=%~dp0schema.sql
set NODE_ENV=production

echo ============================================
echo   VoiceScope - debug console
echo   Data dir: %LocalAppData%\VoiceScope
echo   This window shows live server logs.
echo   Close it or press Ctrl+C to stop.
echo ============================================
echo.

"%~dp0voicescape-server.exe"

echo.
echo Server exited. Press any key to close this window.
pause > nul
endlocal
