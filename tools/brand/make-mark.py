"""Generates the Sweet Spot timing-meter mark as SVG.
Usage: python3 tools/brand/make-mark.py  (writes assets/logo-mark.svg, assets/icon.svg, favicon.svg, assets/icon-maskable.svg)"""
import math, os

def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)

def arc(cx, cy, r, a0, a1):
    x0, y0 = pt(cx, cy, r, a0); x1, y1 = pt(cx, cy, r, a1)
    large = 1 if abs(a1 - a0) > 180 else 0
    return f"M{x0:.1f} {y0:.1f} A{r} {r} 0 {large} 1 {x1:.1f} {y1:.1f}"

def meter(cx=256, cy=318, r=168, w=54, needle_deg=266, ticks=True):
    # gauge spans 200..340 degrees (upper arc); sweet spot centered at 270
    segs = [(200, 222, '#ff6a5c'), (222, 252, '#ffb547'), (252, 288, '#3f8a57'), (288, 318, '#ffb547'), (318, 340, '#ff6a5c')]
    out = []
    out.append(f'<path d="{arc(cx, cy, r, 198, 342)}" stroke="#06140e" stroke-width="{w + 16}" stroke-linecap="round" fill="none" opacity=".55"/>')
    for a0, a1, c in segs:
        out.append(f'<path d="{arc(cx, cy, r, a0, a1)}" stroke="{c}" stroke-width="{w}" fill="none"' + (' stroke-linecap="round"' if a0 in (200,) or a1 in (340,) else '') + '/>')
    # glowing sweet spot
    out.append(f'<path d="{arc(cx, cy, r, 259, 281)}" stroke="#8fe0a0" stroke-width="{w + 10}" fill="none" filter="url(#glow)"/>')
    out.append(f'<path d="{arc(cx, cy, r, 259, 281)}" stroke="#c9ffd3" stroke-width="{w - 18}" fill="none"/>')
    # ticks
    for d in (range(205, 340, 15) if ticks else []):
        a, b = pt(cx, cy, r - w / 2 - 14, d), pt(cx, cy, r - w / 2 - 30, d)
        out.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#f1ece0" stroke-opacity=".45" stroke-width="7" stroke-linecap="round"/>')
    # needle
    tip = pt(cx, cy, r + w / 2 + 4, needle_deg)
    l, rr = pt(cx, cy, 15, needle_deg - 90), pt(cx, cy, 15, needle_deg + 90)
    out.append(f'<path d="M{l[0]:.1f} {l[1]:.1f} L{tip[0]:.1f} {tip[1]:.1f} L{rr[0]:.1f} {rr[1]:.1f} Z" fill="#fff" filter="url(#nglow)"/>')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="34" fill="#f1ece0"/><circle cx="{cx}" cy="{cy}" r="16" fill="#d23a2e"/>')
    return '\n'.join(out)

DEFS = '''<defs>
  <radialGradient id="bgd" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#226049"/><stop offset=".65" stop-color="#143b2d"/><stop offset="1" stop-color="#0b2219"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
  <filter id="nglow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#fff" flood-opacity=".7"/></filter>
</defs>'''

def roundel():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Sweet Spot">
{DEFS}
<circle cx="256" cy="256" r="232" fill="url(#bgd)"/>
<circle cx="256" cy="256" r="232" fill="none" stroke="#ffb547" stroke-width="46" opacity=".14"/>
<circle cx="256" cy="256" r="232" fill="none" stroke="#ffb547" stroke-width="18"/>
<g transform="translate(0 20)">{meter()}</g>
</svg>
'''

def tile(pad=0, radius=112, ticks=True, w=54):
    s = (512 - 2 * pad) / 512
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Sweet Spot">
{DEFS}
<rect width="512" height="512" rx="{radius}" fill="url(#bgd)"/>
<rect x="14" y="14" width="484" height="484" rx="{max(0, radius - 14)}" fill="none" stroke="#ffb547" stroke-width="10" opacity="{0 if radius == 0 else .9}"/>
<g transform="translate({256 - 256 * s:.1f} {256 - 256 * s + 30 * s:.1f}) scale({s:.4f})">{meter(ticks=ticks, w=w)}</g>
</svg>
'''

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
open(os.path.join(root, 'assets/logo-mark.svg'), 'w').write(roundel())
open(os.path.join(root, 'assets/icon.svg'), 'w').write(tile())
open(os.path.join(root, 'favicon.svg'), 'w').write(tile(pad=-44, radius=112, ticks=False, w=74))
open(os.path.join(root, 'assets/icon-maskable.svg'), 'w').write(tile(pad=70, radius=0))
open(os.path.join(root, 'assets/icon-apple.svg'), 'w').write(tile(pad=30, radius=0))
print('ok')
