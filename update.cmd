@echo off
setlocal enabledelayedexpansion
echo ========================================
echo   VoiceScope: Build + Install + Launch
echo ========================================
echo.

set BUILD_DIR=C:\projects\voicescope-build\dist-electron
set SCRIPT_DIR=%~dp0
if "%SCRIPT_DIR:~-1%"=="\" set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%

echo [Stage 1/4] Building installer (this may take a few minutes) ...
call "%SCRIPT_DIR%\build-exe.cmd" --no-pause --no-explorer
if errorlevel 1 (
    echo.
    echo [ABORT] Build failed. See messages above.
    pause
    exit /b 1
)
echo.

echo [Stage 2/4] Locating newest installer ...
set INSTALLER=
for /f "delims=" %%i in ('dir /b /o-d "%BUILD_DIR%\VoiceScope Setup*.exe" 2^>nul') do (
    if not defined INSTALLER set INSTALLER=%BUILD_DIR%\%%i
)
if not defined INSTALLER (
    echo.
    echo [ABORT] No installer found in %BUILD_DIR%
    pause
    exit /b 1
)
echo Found: %INSTALLER%
echo.

echo [Stage 3/4] Closing any running VoiceScope, then silent-installing ...
taskkill /F /IM VoiceScope.exe 2>nul
timeout /t 2 /nobreak >nul

:: NSIS supports /S for silent install regardless of oneClick setting.
"%INSTALLER%" /S
:: NSIS exits before the install fully settles on disk; brief wait helps.
timeout /t 4 /nobreak >nul
echo Install completed.
echo.

echo [Stage 4/4] Launching VoiceScope ...
:: NSIS per-user install (perMachine:false) puts the exe under %LOCALAPPDATA%\Programs\VoiceScope.
:: We also probe %PROGRAMFILES% for the rare case it was previously installed per-machine.
set VSPATH_USER=%LOCALAPPDATA%\Programs\VoiceScope\VoiceScope.exe
set VSPATH_MACHINE=%PROGRAMFILES%\VoiceScope\VoiceScope.exe

set LAUNCH=
if exist "%VSPATH_USER%"    set LAUNCH=%VSPATH_USER%
if not defined LAUNCH if exist "%VSPATH_MACHINE%" set LAUNCH=%VSPATH_MACHINE%

if defined LAUNCH (
    echo Launching: %LAUNCH%
    start "" "%LAUNCH%"
) else (
    echo Could not auto-locate VoiceScope.exe.
    echo Tried:
    echo   %VSPATH_USER%
    echo   %VSPATH_MACHINE%
    echo Please launch manually from the Start Menu.
)
echo.

echo ========================================
echo   Done. New version is now installed.
echo ========================================
echo.
pause
