#!/usr/bin/env bash
# Capture spike (2026-11-04): rebuild only the JS bundle with Storybook enabled and swap it into an already
# built iOS simulator .app. This is the "cached native + JS rebundle" path from docs/plan.md.
#
# Usage (from the consumer project's root):
#   ../targus/spike/rebundle.sh <path/to/App.app> [plain|hermes]
#
# `hermes` (default) compiles the bundle to Hermes bytecode with the hermesc that ships in
# ios/Pods, matching what Xcode's "Bundle React Native code and images" phase produces.
# `plain` embeds the JavaScript source as-is to test whether the Hermes runtime accepts it.
set -euo pipefail

APP_PATH="${1:?path to .app}"
MODE="${2:-hermes}"
PROJECT_ROOT="$(pwd)"
OUT_DIR="$PROJECT_ROOT/build/targus-bundle"
rm -rf "$OUT_DIR" && mkdir -p "$OUT_DIR"

export EXPO_PUBLIC_STORYBOOK_ENABLED=true
export EXPO_PUBLIC_TARGUS=true
export NODE_ENV=production

# Same entry resolution and flags as react-native/scripts/react-native-xcode.sh, which is what
# Xcode's "Bundle React Native code and images" phase runs.
ENTRY_FILE="$(node -e "require('expo/scripts/resolveAppEntry')" "$PROJECT_ROOT" ios absolute | tail -n 1)"
MINIFY_ARGS=()
[ "$MODE" = "hermes" ] && MINIFY_ARGS=(--minify false)

echo "== export:embed ($MODE) → $OUT_DIR"
npx expo export:embed \
  --entry-file "$ENTRY_FILE" \
  --platform ios \
  --dev false \
  --reset-cache \
  --bundle-output "$OUT_DIR/main.jsbundle" \
  --assets-dest "$OUT_DIR" \
  ${MINIFY_ARGS[@]+"${MINIFY_ARGS[@]}"}

if [ "$MODE" = "hermes" ]; then
  HERMESC="$PROJECT_ROOT/ios/Pods/hermes-engine/destroot/bin/hermesc"
  [ -x "$HERMESC" ] || { echo "hermesc not found at $HERMESC" >&2; exit 1; }
  echo "== hermesc → bytecode"
  "$HERMESC" -emit-binary -max-diagnostic-width=80 -O \
    -out "$OUT_DIR/main.jsbundle.hbc" "$OUT_DIR/main.jsbundle"
  mv "$OUT_DIR/main.jsbundle.hbc" "$OUT_DIR/main.jsbundle"
fi

echo "== swapping bundle + assets into $APP_PATH"
cp "$OUT_DIR/main.jsbundle" "$APP_PATH/main.jsbundle"
rm -rf "$APP_PATH/assets"
cp -R "$OUT_DIR/assets" "$APP_PATH/assets"
# Simulator builds are ad-hoc signed; the resource change invalidates the seal, so re-sign.
codesign --force --sign - --preserve-metadata=entitlements,flags "$APP_PATH" 2>/dev/null || true

echo "== done: $(du -h "$APP_PATH/main.jsbundle" | cut -f1) bundle in $APP_PATH"
