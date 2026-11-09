#!/bin/sh
# Renders brand PNGs from the SVGs made by make-mark.py.
# Chrome draws each SVG at 512px, Pillow scales them down and writes favicon.ico.
# Run from the repo root: python3 tools/brand/make-mark.py && sh tools/brand/render.sh
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT="$PWD"
TMP="$ROOT/.brand-tmp"
mkdir -p "$TMP"

shot() { # svg-path-from-root  out-name-in-tmp
  printf '<html><body style="margin:0;background:transparent"><img src="file://%s" width="512" height="512" style="display:block"></body></html>' "$ROOT/$1" > "$TMP/p.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor=1 --window-size=512,512 --screenshot="$TMP/$2" "file://$TMP/p.html" >/dev/null 2>&1
}
shot assets/icon.svg icon.png
shot assets/icon-maskable.svg mask.png
shot assets/icon-apple.svg apple.png
shot favicon.svg fav.png

python3 - "$TMP" <<'PYIN'
import sys
from PIL import Image
t = sys.argv[1]
def out(src, size, dst, mode='RGBA'):
    Image.open(f'{t}/{src}').convert(mode).resize((size, size), Image.LANCZOS).save(dst)
    print(dst)
out('icon.png', 192, 'assets/icon-192.png')
out('icon.png', 512, 'assets/icon-512.png')
out('mask.png', 192, 'assets/icon-maskable-192.png')
out('mask.png', 512, 'assets/icon-maskable-512.png')
out('apple.png', 180, 'apple-touch-icon.png', 'RGB')
Image.open(f'{t}/fav.png').convert('RGBA').save('favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('favicon.ico')
PYIN

# Lockups: mark plus wordmark, on dark and light backgrounds (1200x400)
for theme in dark light; do
  if [ "$theme" = dark ]; then BG='#0b1611'; FG='#f1ece0'; else BG='#f1ece0'; FG='#0b1611'; fi
  cat > "$TMP/l.html" <<HTML
<html><head><link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&display=swap" rel="stylesheet"></head>
<body style="margin:0;width:1200px;height:400px;background:$BG;display:flex;align-items:center;gap:44px;padding:0 70px;box-sizing:border-box">
<img src="file://$ROOT/assets/logo-mark.svg" width="280" height="280">
<div style="font:900 170px/.82 'Big Shoulders Display',sans-serif;color:$FG;letter-spacing:-.01em">Sweet<br><span style="color:#ffb547">Spot</span></div>
</body></html>
HTML
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,400 \
    --virtual-time-budget=4000 --screenshot="$TMP/lockup-$theme.png" "file://$TMP/l.html" >/dev/null 2>&1
  cp "$TMP/lockup-$theme.png" "assets/logo-lockup-$theme.png"
  echo "assets/logo-lockup-$theme.png"
done
rm -rf "$TMP"
