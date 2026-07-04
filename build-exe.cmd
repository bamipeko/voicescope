@echo off
echo ========================================
echo   VoiceScope .exe Build Script
echo ========================================
echo.

:: Parse flags. Accepted in any order:
::   --no-pause      Don't pause at the end (used when chained from update.cmd)
::   --no-explorer   Don't open dist-electron folder after success
set NO_PAUSE=
set NO_EXPLORER=
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--no-pause"    set NO_PAUSE=1
if /i "%~1"=="--no-explorer" set NO_EXPLORER=1
shift
goto :parse_args
:args_done

set LOCAL_DIR=C:\projects\voicescope-build
:: %~dp0 ends with \ which breaks quoted paths in robocopy
set NAS_DIR=%~dp0
if "%NAS_DIR:~-1%"=="\" set NAS_DIR=%NAS_DIR:~0,-1%

echo [1/5] Cleaning previous build artifacts...
taskkill /F /IM VoiceScope.exe 2>nul
taskkill /F /IM "VoiceScope Setup*.exe" 2>nul
timeout /t 3 /nobreak >nul
if exist "%LOCAL_DIR%\dist-electron" (
    rmdir /s /q "%LOCAL_DIR%\dist-electron" 2>nul
    if exist "%LOCAL_DIR%\dist-electron" (
        echo    WARNING: dist-electron still locked, retrying...
        timeout /t 5 /nobreak >nul
        rmdir /s /q "%LOCAL_DIR%\dist-electron" 2>nul
    )
    if exist "%LOCAL_DIR%\dist-electron" (
        echo    ERROR: Cannot delete dist-electron. Close any running VoiceScope and try again.
        pause
        exit /b 1
    )
)
echo.

echo [2/5] Syncing NAS to local...
if not exist "%LOCAL_DIR%" mkdir "%LOCAL_DIR%"
robocopy "%NAS_DIR%" "%LOCAL_DIR%" /MIR /XD node_modules client\node_modules dist-electron data .git /XF .env voicescope.db *.log /NFL /NDL /NJH /NJS /NC /NS
echo.

echo [3/5] Installing dependencies (clean)...
cd /d "%LOCAL_DIR%"
:: Remove node_modules to ensure fresh install with updated deps
if exist node_modules\helmet (echo    Root deps OK) else (
    echo    Root deps outdated, reinstalling...
    rmdir /s /q node_modules 2>nul
)
call npm install --no-audit --no-fund
cd /d "%LOCAL_DIR%\client"
if exist node_modules\rehype-sanitize (echo    Client deps OK) else (
    echo    Client deps outdated, reinstalling...
    rmdir /s /q node_modules 2>nul
)
call npm install --no-audit --no-fund
cd /d "%LOCAL_DIR%"
echo.

echo [4/5] Building client + packaging .exe ...
echo (This may take a few minutes)
call npm run electron:build
echo.

echo [5/5] Done!
echo.
dir /b "%LOCAL_DIR%\dist-electron\VoiceScope Setup*.exe" 2>nul
if %ERRORLEVEL%==0 (
    echo.
    echo Output: %LOCAL_DIR%\dist-electron\
    if not defined NO_EXPLORER explorer "%LOCAL_DIR%\dist-electron"
) else (
    echo Build failed. Check the errors above.
    if defined NO_PAUSE exit /b 1
)
echo.
:: Skip pause when invoked from update.cmd (workflow chains build -> install -> launch)
if defined NO_PAUSE goto :end
pause
:end
