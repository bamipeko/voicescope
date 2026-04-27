#!/usr/bin/env bash
# Build a standalone macOS .app bundle and .dmg for VoiceScope.
#
# Prerequisites:
#   - macOS (or Linux/CI with cross-platform asset hosting, but bundling requires Mac for codesign/dmg)
#   - bun (https://bun.sh) — for single-binary compilation
#   - create-dmg (brew install create-dmg) — optional, for DMG packaging
#
# Usage: ./scripts/build-mac.sh
#        ./scripts/build-mac.sh --arch arm64   (Apple Silicon only)
#        ./scripts/build-mac.sh --arch x64     (Intel only)
#        ./scripts/build-mac.sh --arch both    (default: universal)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH="${2:-both}"
if [ "${1:-}" = "--arch" ]; then
  ARCH="${2:-both}"
fi

APP_NAME="VoiceScope"
BUNDLE_ID="com.voicescope.app"
VERSION="$(node -p "require('./package.json').version")"
BUILD_DIR="$ROOT/dist-mac"
APP_DIR="$BUILD_DIR/$APP_NAME.app"

echo "=== VoiceScope Mac Build ==="
echo "Version:   $VERSION"
echo "Arch:      $ARCH"
echo "Output:    $BUILD_DIR"
echo ""

# Check prerequisites
if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not found. Install from https://bun.sh"
  exit 1
fi

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# 1. Build client
echo "[1/6] Building client (Vite)..."
(cd client && npm run build)

# 2. Compile server to single binary with bun
echo "[2/6] Compiling server with bun..."
COMPILE_TARGETS=()
case "$ARCH" in
  arm64) COMPILE_TARGETS=("bun-darwin-arm64") ;;
  x64)   COMPILE_TARGETS=("bun-darwin-x64") ;;
  both)  COMPILE_TARGETS=("bun-darwin-arm64" "bun-darwin-x64") ;;
  *) echo "Unknown arch: $ARCH"; exit 1 ;;
esac

# bun compile produces ONE binary per target. For "both" we build arm64 first,
# then x64, then lipo-merge into a universal binary.
for TARGET in "${COMPILE_TARGETS[@]}"; do
  OUT_NAME="voicescope-server-${TARGET#bun-darwin-}"
  bun build \
    --compile \
    --target="$TARGET" \
    --minify \
    --sourcemap=none \
    --outfile "$BUILD_DIR/$OUT_NAME" \
    "$ROOT/server/index.js"
done

# 3. Assemble .app bundle contents
echo "[3/6] Assembling .app bundle..."

# If universal, lipo-merge the two binaries
if [ "$ARCH" = "both" ]; then
  lipo -create \
    "$BUILD_DIR/voicescape-server-arm64" \
    "$BUILD_DIR/voicescape-server-x64" \
    -output "$APP_DIR/Contents/MacOS/voicescape-server"
  rm "$BUILD_DIR/voicescape-server-arm64" "$BUILD_DIR/voicescape-server-x64"
else
  ARCH_SUFFIX="${ARCH/x64/x64}"
  mv "$BUILD_DIR/voicescape-server-${ARCH_SUFFIX}" "$APP_DIR/Contents/MacOS/voicescape-server"
fi
chmod +x "$APP_DIR/Contents/MacOS/voicescape-server"

# Copy launcher shim (sets env, starts server)
cp "$ROOT/build/mac/launcher" "$APP_DIR/Contents/MacOS/VoiceScope"
chmod +x "$APP_DIR/Contents/MacOS/VoiceScope"

# Copy client dist, sql-wasm, schema into Resources
cp -R "$ROOT/client/dist" "$APP_DIR/Contents/Resources/client"
cp "$ROOT/node_modules/sql.js/dist/sql-wasm.wasm" "$APP_DIR/Contents/Resources/sql-wasm.wasm"
cp "$ROOT/server/db/schema.sql" "$APP_DIR/Contents/Resources/schema.sql"

# Icon
if [ -f "$ROOT/build/mac/icon.icns" ]; then
  cp "$ROOT/build/mac/icon.icns" "$APP_DIR/Contents/Resources/icon.icns"
fi

# Info.plist (generate with current version)
sed "s/__VERSION__/$VERSION/g; s/__BUNDLE_ID__/$BUNDLE_ID/g" \
  "$ROOT/build/mac/Info.plist.template" > "$APP_DIR/Contents/Info.plist"

# 4. Codesign (ad-hoc, no Apple Dev account)
echo "[4/6] Applying ad-hoc signature..."
codesign --force --deep --sign - "$APP_DIR" || {
  echo "WARNING: codesign failed. App may be blocked by Gatekeeper on first launch."
  echo "         Users can right-click → Open to bypass."
}

# 5. Create DMG (optional — requires create-dmg)
echo "[5/6] Creating DMG..."
if command -v create-dmg >/dev/null 2>&1; then
  DMG_PATH="$BUILD_DIR/$APP_NAME-$VERSION.dmg"
  rm -f "$DMG_PATH"
  create-dmg \
    --volname "$APP_NAME $VERSION" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "$APP_NAME.app" 150 200 \
    --app-drop-link 450 200 \
    --no-internet-enable \
    "$DMG_PATH" \
    "$APP_DIR" || echo "DMG creation failed (create-dmg), falling back to hdiutil"

  if [ ! -f "$DMG_PATH" ]; then
    # Fallback: simple hdiutil dmg
    hdiutil create -volname "$APP_NAME" -srcfolder "$APP_DIR" -ov -format UDZO "$DMG_PATH"
  fi
  echo "Created: $DMG_PATH"
else
  echo "create-dmg not installed (brew install create-dmg). Using hdiutil fallback."
  DMG_PATH="$BUILD_DIR/$APP_NAME-$VERSION.dmg"
  hdiutil create -volname "$APP_NAME" -srcfolder "$APP_DIR" -ov -format UDZO "$DMG_PATH"
  echo "Created: $DMG_PATH"
fi

echo ""
echo "[6/6] Done."
echo "  App:  $APP_DIR"
echo "  DMG:  $BUILD_DIR/$APP_NAME-$VERSION.dmg"
echo ""
echo "Test locally:"
echo "  open \"$APP_DIR\""
