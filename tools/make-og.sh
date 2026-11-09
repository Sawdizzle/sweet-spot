#!/bin/sh
# Renders assets/og/<game>.png (1200x630) from tools/og.html with headless Chrome.
# Needs the dev server running: python3 tools/dev-server.py 8768
# Usage: sh tools/make-og.sh [base-url] [out-dir]
BASE=${1:-http://127.0.0.1:8768}
OUT=${2:-assets/og}
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"
for g in home fieldgoal pk hockey golf drag; do  # baseball keeps assets/og-image.jpg
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1200,630 --virtual-time-budget=4000 \
    --screenshot="$OUT/$g.png" "$BASE/tools/og.html?game=$g" >/dev/null 2>&1
  echo "$OUT/$g.png"
done
