#!/usr/bin/env bash
# Quick local test of standalone mode (no Electron, no Docker).
# Runs the server with standalone env vars and opens a browser.
#
# Useful for verifying that:
#   - Data directory is chosen correctly (~/.Library/Application Support/VoiceScope on Mac)
#   - API keys persist across restarts in config.json
#   - Browser auto-opens
#
# Usage: ./scripts/test-standalone.sh
set -e
cd "$(dirname "$0")/.."

npm run build

echo "=== Starting in STANDALONE mode ==="
echo "  Data dir: $HOME/Library/Application Support/VoiceScope (macOS)"
echo "           or %APPDATA%\\VoiceScope (Windows)"
echo "  Browser should open automatically."
echo "  Ctrl+C to stop."
echo ""

VOICESCOPE_STANDALONE=1 NODE_ENV=production node server/index.js
