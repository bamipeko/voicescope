@echo off
echo ========================================
echo   VoiceScope .exe Build Script
echo ========================================
echo.

set LOCAL_DIR=C:\projects\voicescope-build
:: %~dp0 ends with \ which breaks quoted paths in robocopy
set NAS_DIR=%~dp0
if "%NAS_DIR:~-1%"=="\" set NAS_DIR=%NAS_DIR:~0,-1%

echo [1/4] Syncing NAS to local...
if not exist "%LOCAL_DIR%" mkdir "%LOCAL_DIR%"
robocopy "%NAS_DIR%" "%LOCAL_DIR%" /MIR /XD node_modules client\node_modules dist-electron data .git /XF .env voicescope.db *.log /NFL /NDL /NJH /NJS /NC /NS
echo.

echo [2/4] Installing dependencies...
cd /d "%LOCAL_DIR%"
call npm install --no-audit --no-fund
cd /d "%LOCAL_DIR%\client"
call npm install --no-audit --no-fund
cd /d "%LOCAL_DIR%"
echo.

echo [3/4] Building client + packaging .exe ...
echo (This may take a few minutes)
call npm run electron:build
echo.

echo [4/4] Done!
echo.
dir /b "%LOCAL_DIR%\dist-electron\VoiceScope Setup*.exe" 2>nul
if %ERRORLEVEL%==0 (
    echo.
    echo Output: %LOCAL_DIR%\dist-electron\
    explorer "%LOCAL_DIR%\dist-electron"
) else (
    echo Build failed. Check the errors above.
)
echo.
pause
