#!/bin/zsh
# Builds Gridline.app for macOS from this repository.
#
#   ./app/macos/build.sh               build into build/, install into /Applications and open it
#   ./app/macos/build.sh --no-install  build only
#
# The app reads its pages live from this repository (so edits show up without rebuilding) and falls back
# to the copies bundled inside it if the repository moves. Rebuild after changing anything in app/macos.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
APP="$ROOT/build/Gridline.app"
RES="$APP/Contents/Resources"
KEYS="$ROOT/electron/keys.local.json"

# A free auto.dev key turns on real listings. It stays in this folder (git ignores it) and in the app.
if [[ ! -f "$KEYS" && -t 0 ]]; then
  read "key?Paste your auto.dev API key for real listings (or press Enter to skip): "
  if [[ -n "$key" ]]; then
    printf '{ "autodev": "%s" }\n' "$key" > "$KEYS"
    chmod 600 "$KEYS"
  fi
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES"
cp Info.plist "$APP/Contents/"
/usr/libexec/PlistBuddy -c "Add :GridlineSourceFolder string $ROOT" "$APP/Contents/Info.plist"

# App icon, made from the 1024px PNG
ICONSET="$ROOT/build/AppIcon.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ROOT/assets/icons/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ROOT/assets/icons/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns -o "$RES/AppIcon.icns" "$ICONSET"
rm -rf "$ICONSET"

# Bundled fallback copy of the web app
cp "$ROOT/index.html" "$RES/"
cp -R "$ROOT/css" "$ROOT/js" "$ROOT/assets" "$RES/"
[[ -f "$KEYS" ]] && cp "$KEYS" "$RES/keys.local.json"

# A universal binary for Apple Silicon and Intel Macs
swiftc -O -target arm64-apple-macos13.0  -o "$APP/Contents/MacOS/Gridline-arm64"  Sources/main.swift
swiftc -O -target x86_64-apple-macos13.0 -o "$APP/Contents/MacOS/Gridline-x86_64" Sources/main.swift
lipo -create -output "$APP/Contents/MacOS/Gridline" "$APP/Contents/MacOS/Gridline-arm64" "$APP/Contents/MacOS/Gridline-x86_64"
rm "$APP/Contents/MacOS/Gridline-arm64" "$APP/Contents/MacOS/Gridline-x86_64"
codesign --force --deep --sign - "$APP"
echo "Built $APP (reads live from $ROOT)"

if [[ "${1:-}" != "--no-install" ]]; then
  pkill -x Gridline 2>/dev/null || true
  sleep 1
  rm -rf /Applications/Gridline.app
  cp -R "$APP" /Applications/
  echo "Installed /Applications/Gridline.app"
  open /Applications/Gridline.app
fi
