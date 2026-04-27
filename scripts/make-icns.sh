#!/usr/bin/env bash
# Generate a macOS .icns icon from a source PNG (ideally 1024x1024).
# Usage: ./scripts/make-icns.sh <source.png>
#
# Requires macOS (uses iconutil + sips).
set -euo pipefail

SRC="${1:-$(cd "$(dirname "$0")/.." && pwd)/electron/assets/icon.png}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/build/mac/icon.icns"

if [ ! -f "$SRC" ]; then
  echo "Source icon not found: $SRC"
  echo "Place a 1024x1024 PNG at electron/assets/icon.png or pass a path."
  exit 1
fi

TMP="$(mktemp -d)"
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"

# Apple requires these exact sizes + @2x variants
for size in 16 32 128 256 512; do
  sips -z $size $size "$SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$TMP"
echo "Created: $OUT"
