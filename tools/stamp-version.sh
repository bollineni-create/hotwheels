#!/bin/zsh
# Stamps every local script and stylesheet link in the pages with a fresh version (?v=...), so browsers
# and GitHub Pages visitors load the new files after an update instead of a cached mix of old and new.
set -euo pipefail
cd "$(dirname "$0")/.."
V="$(date +%Y%m%d%H%M)"
for page in index.html; do
  perl -pi -e 's#((?:src|href)="(?:js|css)/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"#$1?v='"$V"'"#g' "$page"
done
echo "Stamped version $V"
