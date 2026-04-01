@echo off
chcp 65001 >nul
echo ========================================
echo   VoiceScope .exe ビルドスクリプト
echo ========================================
echo.

:: ローカルの作業ディレクトリ
set LOCAL_DIR=C:\projects\voicescope-build
set NAS_DIR=%~dp0

:: ローカルにコピー（初回は全コピー、以降は差分）
echo [1/4] NAS → ローカルに同期中...
if not exist "%LOCAL_DIR%" mkdir "%LOCAL_DIR%"
robocopy "%NAS_DIR%" "%LOCAL_DIR%" /MIR /XD node_modules client\node_modules dist-electron data .git /XF .env voicescope.db *.log /NFL /NDL /NJH /NJS /NC /NS
echo.

:: 依存インストール
echo [2/4] 依存パッケージをインストール中...
cd /d "%LOCAL_DIR%"
call npm install --no-audit --no-fund >nul 2>&1
cd client && call npm install --no-audit --no-fund >nul 2>&1
cd /d "%LOCAL_DIR%"
echo.

:: ビルド
echo [3/4] クライアントビルド + .exe パッケージング中...
echo （数分かかります）
call npm run electron:build
echo.

:: 結果
echo [4/4] 完了！
echo.
if exist "%LOCAL_DIR%\dist-electron\VoiceScope Setup*.exe" (
    echo ★ インストーラーはここにあります:
    dir /b "%LOCAL_DIR%\dist-electron\VoiceScope Setup*.exe"
    echo.
    echo パス: %LOCAL_DIR%\dist-electron\
    explorer "%LOCAL_DIR%\dist-electron"
) else (
    echo ✕ ビルドに失敗しました。上のエラーを確認してください。
)
echo.
pause
