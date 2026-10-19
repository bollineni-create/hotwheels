#!/bin/zsh
# Downloads (or updates) Gridline into ~/hotwheels, builds the Mac app, installs it into /Applications and opens it.
#
#   curl -fsSL https://raw.githubusercontent.com/bollineni-create/hotwheels/main/app/macos/install.sh | zsh
#
# Optional: VISOR_KEY=... AUTODEV_KEY=... before `zsh` builds those API keys in (kept only on this Mac).
set -euo pipefail
DIR="${GRIDLINE_DIR:-$HOME/hotwheels}"

if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo "Install Apple's command-line tools in the window that just opened, then run this command again."
  exit 1
fi

if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" pull --ff-only --quiet
else
  git clone --quiet https://github.com/bollineni-create/hotwheels.git "$DIR"
fi

if [[ -n "${VISOR_KEY:-}${AUTODEV_KEY:-}" ]]; then
  printf '{ "visor": "%s", "autodev": "%s" }\n' "${VISOR_KEY:-}" "${AUTODEV_KEY:-}" > "$DIR/electron/keys.local.json"
  chmod 600 "$DIR/electron/keys.local.json"
fi

"$DIR/app/macos/build.sh"
