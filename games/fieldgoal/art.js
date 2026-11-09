/* Field Goal art: the night stadium, the painted field and the people on it.
   Everything is drawn with canvas calls. main.js draws the stadium and field
   once per kick into an offscreen canvas and only redraws players, posts,
   ribbons and the ball every frame. */

export const COL = {
  home: '#a3262a', homeDark: '#5e1416', cream: '#efe7d4', gold: '#e2b23c',
  away: '#e9edf2', awayTrim: '#1f3b66', awayPants: '#c3c9d3',
  post: '#ffd34d', postHi: '#fff3b0', postLo: '#a87b10',
  skin: ['#e9b893', '#c98e64', '#8d5a3b', '#5c3b28', '#f2cfa8']
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const DISPLAY = '"Big Shoulders Display", Impact, "Arial Narrow", sans-serif';

/* ---------- Small offscreen images ---------- */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

let grassImg = null;
function grassTile() {
  if (grassImg) return grassImg;
  const c = canvas(128, 128), g = c.getContext('2d'), r = rng(7);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 128, y = r() * 128, l = r();
    g.fillStyle = l < 0.55 ? `rgba(0,0,0,${0.08 + r() * 0.16})` : `rgba(200,240,180,${0.04 + r() * 0.08})`;
    g.fillRect(x, y, 1, 1 + r() * 3);
  }
  return grassImg = c;
}

const glyphs = new Map();
/* A white numeral or word with a soft worn edge, for painting on the grass. */
function paintImg(text, w, h, { fill = '#f4f1e8', stroke = null, lw = 0, size = 0.92, weight = 900, spacing = 0 } = {}) {
  const key = [text, w, h, fill, stroke, lw, size, weight, spacing].join('|');
  if (glyphs.has(key)) return glyphs.get(key);
  const c = canvas(w, h), g = c.getContext('2d');
  g.font = `${weight} ${Math.round(h * size)}px ${DISPLAY}`;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g && spacing) g.letterSpacing = spacing + 'px';
  const m = g.measureText(text);
  const tw = m.width, sx = tw > w * 0.96 ? (w * 0.96) / tw : 1;
  g.translate(w / 2, h * 0.5 + (m.actualBoundingBoxAscent || h * size * 0.7) / 2);
  g.scale(sx, 1);
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.lineJoin = 'round'; g.strokeText(text, 0, 0); }
  g.fillStyle = fill; g.fillText(text, 0, 0);
  glyphs.set(key, c);
  return c;
}

let logoImg = null;
function logo() {
  if (logoImg) return logoImg;
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), m = S / 2;
  const ring = (r, col) => { g.fillStyle = col; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fill(); };
  ring(250, 'rgba(244,241,232,.92)'); ring(232, COL.home); ring(200, 'rgba(226,178,60,.95)'); ring(186, COL.homeDark);
  // ball in the middle
  g.save(); g.translate(m, m); g.rotate(-0.5);
  g.fillStyle = '#7a3d1d'; g.beginPath(); g.ellipse(0, 0, 150, 92, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f4f1e8'; g.lineWidth = 10; g.beginPath(); g.moveTo(-58, 0); g.lineTo(58, 0); g.stroke();
  g.lineWidth = 8; for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 16, -16); g.lineTo(i * 16, 16); g.stroke(); }
  g.restore();
  g.font = `900 64px ${DISPLAY}`; g.textAlign = 'center'; g.fillStyle = '#f4f1e8';
  g.fillText('SWEET SPOT', m, m + 160);
  return logoImg = c;
}

/* ---------- Ground texture mapping ----------
   Paints an image flat on the field. uv2xz maps image space (u right, v up,
   both 0..1) to field yards; the quad is split into a grid of triangles so
   perspective holds up. Used only when building the cached layer. */
function tri(g, img, s0, s1, s2, d0, d1, d2) {
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
  const ex = p => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.6, p[1] + dy / l * 0.6]; };
  const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(den) < 1e-6) return;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den;
  const b = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den;
  const c = d0[0] - a * s0[0] - b * s0[1];
  const d = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
  const e = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;
  const f = d0[1] - d * s0[0] - e * s0[1];
  const e0 = ex(d0), e1 = ex(d1), e2 = ex(d2);
  g.save();
  g.beginPath(); g.moveTo(e0[0], e0[1]); g.lineTo(e1[0], e1[1]); g.lineTo(e2[0], e2[1]); g.closePath(); g.clip();
  g.transform(a, d, b, e, c, f);
  const x0 = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0])) - 2), y0 = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1])) - 2);
  const x1 = Math.min(img.width, Math.ceil(Math.max(s0[0], s1[0], s2[0])) + 2), y1 = Math.min(img.height, Math.ceil(Math.max(s0[1], s1[1], s2[1])) + 2);
  if (x1 > x0 && y1 > y0) g.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  g.restore();
}
function mapGround(g, img, P, W, H, uv2xz, nu, nv) {
  const iw = img.width, ih = img.height, grid = [];
  for (let j = 0; j <= nv; j++) {
    const row = [];
    for (let i = 0; i <= nu; i++) { const [x, z] = uv2xz(i / nu, j / nv); row.push(P(x, 0, z)); }
    grid.push(row);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
    const minX = Math.min(a[0], b[0], c[0], d[0]), maxX = Math.max(a[0], b[0], c[0], d[0]);
    const minY = Math.min(a[1], b[1], c[1], d[1]), maxY = Math.max(a[1], b[1], c[1], d[1]);
    if (maxX < 0 || minX > W || maxY < 0 || minY > H) continue;
    const u0 = i / nu * iw, u1 = (i + 1) / nu * iw, v0 = (1 - j / nv) * ih, v1 = (1 - (j + 1) / nv) * ih;
    tri(g, img, [u0, v0], [u1, v0], [u1, v1], a, b, c);
    tri(g, img, [u0, v0], [u1, v1], [u0, v1], a, c, d);
  }
}

/* ---------- Stadium (screen space) ----------
   The bowl is laid out relative to the base of the far wall so the sky,
   lights and scoreboard always show no matter how far back the kick is.
   Returns crowd points for the live shimmer and camera flashes. */
export function drawStadium(g, o) {
  const { W, H, baseY, wallTop, cx, ppy, dist, seed } = o;
  const r = rng(seed);
  const hudSafe = o.hudSafe;
  const U = x => clamp((x - cx) / (W * 0.5), -1.5, 1.5);
  const lift = (x, amt) => amt * U(x) * U(x);
  const span = baseY - hudSafe;                       // room between the scoreboard strip and the wall
  const yL1 = x => wallTop - span * 0.30 - lift(x, span * 0.05);
  const yS0 = x => yL1(x) - span * 0.012;
  const yS1 = x => yL1(x) - span * 0.085 - lift(x, span * 0.02);
  const yU1 = x => yS1(x) - span * 0.25 - lift(x, span * 0.07);
  const yR = x => yU1(x) - span * 0.045;
  const towerY = hudSafe + span * 0.06;
  const pts = [];

  /* sky */
  const sky = g.createLinearGradient(0, 0, 0, baseY);
  sky.addColorStop(0, '#02050b'); sky.addColorStop(0.45, '#08111f'); sky.addColorStop(1, '#16273a');
  g.fillStyle = sky; g.fillRect(0, 0, W, baseY + 2);
  for (let i = 0; i < 90; i++) {
    const x = r() * W, y = r() * yR(x) * 0.8;
    g.fillStyle = `rgba(220,230,255,${0.15 + r() * 0.4})`; g.fillRect(x, y, r() < 0.15 ? 1.6 : 1, r() < 0.15 ? 1.6 : 1);
  }
  // light dome over the roof
  const dome = g.createRadialGradient(cx, yR(cx) + span * 0.1, 10, cx, yR(cx) + span * 0.1, W * 0.75);
  dome.addColorStop(0, 'rgba(150,175,205,.32)'); dome.addColorStop(0.5, 'rgba(90,115,150,.12)'); dome.addColorStop(1, 'rgba(60,80,110,0)');
  g.fillStyle = dome; g.fillRect(0, 0, W, baseY);

  const band = (top, bot, fill) => {
    g.beginPath(); g.moveTo(-2, bot(-2));
    for (let x = -2; x <= W + 8; x += 8) g.lineTo(x, bot(x));
    for (let x = W + 8; x >= -2; x -= 8) g.lineTo(x, top(x));
    g.closePath(); g.fillStyle = fill; g.fill();
  };

  /* roof and upper deck shell */
  band(x => yR(x) - 3, x => yU1(x) + 2, '#0b0f16');
  /* scoreboard sits on the roof, between the light towers */
  {
    const bw = Math.min(W * 0.34, 300), roof = yR(cx) - 2, clear = o.clearY ? o.clearY - 8 : roof;
    const bot = Math.min(roof, clear), bh = clamp(Math.min(span * 0.13, bot - hudSafe + 2), 30, 70), bx = cx - bw / 2, by = bot - bh;
    g.fillStyle = '#05070b'; g.fillRect(bx - 5, by - 5, bw + 10, bh + 10);
    g.fillRect(cx - bw * 0.42, by + bh, 5, roof - by - bh + 6); g.fillRect(cx + bw * 0.42 - 5, by + bh, 5, roof - by - bh + 6);
    const sc = g.createLinearGradient(0, by, 0, by + bh);
    sc.addColorStop(0, '#0d1626'); sc.addColorStop(1, '#091019');
    g.fillStyle = sc; g.fillRect(bx, by, bw, bh);
    // LED dot texture
    g.fillStyle = 'rgba(255,255,255,.035)';
    for (let y = by + 1; y < by + bh; y += 3) for (let x = bx + 1; x < bx + bw; x += 3) g.fillRect(x, y, 1, 1);
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,181,71,.8)'; g.shadowBlur = 6;
    g.fillStyle = '#ffb547'; g.font = `800 ${Math.round(bh * 0.24)}px ${DISPLAY}`;
    g.fillText('SWEET SPOT', cx, by + bh * 0.24);
    g.fillStyle = '#f4f1e8'; g.font = `800 ${Math.round(bh * 0.42)}px ${DISPLAY}`;
    g.fillText(`${dist} YARD ATTEMPT`, cx, by + bh * 0.66, bw * 0.9);
    g.restore();
    g.fillStyle = COL.home; g.fillRect(bx, by + bh - 3, bw, 3);
  }

  /* upper deck crowd */
  band(yU1, yS1, '#24161a');
  crowd(g, r, yS1, yU1, W, cx, Math.max(3, ppy * 0.3), 0.985, 0.08, pts, 0.7);
  // upper fascia with a thin LED ribbon
  band(x => yU1(x) - 1, x => yU1(x) + span * 0.022, '#0a0d13');
  ribbon(g, W, x => yU1(x) + span * 0.004, Math.max(3, span * 0.014), 'rgba(163,38,42,.85)', true);

  /* suite level and the press box */
  band(yS1, yS0, '#0c1119');
  for (let x = 0; x < W; x += 7 + r() * 5) {
    const t = yS1(x) + 2, b = yS0(x) - 2;
    if (b - t < 2) continue;
    const lit = r();
    g.fillStyle = lit < 0.7 ? `rgba(255,214,150,${0.25 + r() * 0.45})` : 'rgba(40,52,70,.6)';
    g.fillRect(x, t, 5 + r() * 3, (b - t) * 0.92);
  }
  {
    const pw = Math.min(W * 0.32, 340), ph = span * 0.11, px = cx - pw / 2, py = yS0(cx) - ph;
    g.fillStyle = '#0a0f17'; g.fillRect(px - 4, py - 4, pw + 8, ph + 6);
    const gl = g.createLinearGradient(0, py, 0, py + ph);
    gl.addColorStop(0, 'rgba(190,215,245,.55)'); gl.addColorStop(1, 'rgba(120,150,190,.35)');
    g.fillStyle = gl; g.fillRect(px, py, pw, ph * 0.8);
    g.fillStyle = 'rgba(10,15,24,.85)';
    for (let x = px; x < px + pw; x += pw / 14) g.fillRect(x, py, 2, ph * 0.8);
    for (let i = 0; i < 16; i++) {                      // people behind the glass
      const x = px + 6 + r() * (pw - 12), hh = ph * 0.32;
      g.fillStyle = 'rgba(15,20,30,.75)'; g.fillRect(x, py + ph * 0.8 - hh, hh * 0.5, hh);
      g.beginPath(); g.arc(x + hh * 0.25, py + ph * 0.8 - hh - hh * 0.18, hh * 0.18, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#121a26'; g.fillRect(px - 4, py + ph * 0.8, pw + 8, ph * 0.2);
    g.fillStyle = 'rgba(226,178,60,.8)'; g.fillRect(px - 4, py + ph * 0.8, pw + 8, 1.5);
  }

  /* lower bowl crowd */
  band(yL1, x => wallTop, '#2a171b');
  crowd(g, r, x => wallTop, yL1, W, cx, clamp(ppy * 0.45, 4, 13), 0.975, 0.05, pts, 1);
  // shade the deck fronts a touch darker at the top of each tier
  const shade = g.createLinearGradient(0, yR(cx), 0, wallTop);
  shade.addColorStop(0, 'rgba(4,8,16,.45)'); shade.addColorStop(0.55, 'rgba(4,8,16,.12)'); shade.addColorStop(1, 'rgba(4,8,16,0)');
  g.fillStyle = shade; g.fillRect(0, yR(cx) - span * 0.1, W, wallTop - yR(cx) + span * 0.1);

  /* wall at field level with an LED ribbon board */
  g.fillStyle = '#0a0e14'; g.fillRect(0, wallTop, W, baseY - wallTop + 1);
  ribbon(g, W, () => wallTop + (baseY - wallTop) * 0.12, Math.max(4, (baseY - wallTop) * 0.5), 'rgba(163,38,42,.95)', false, `${Math.round((baseY - wallTop) * 0.36)}px`);
  g.fillStyle = 'rgba(30,70,45,.9)'; g.fillRect(0, baseY - (baseY - wallTop) * 0.3, W, (baseY - wallTop) * 0.3 + 1);

  /* light towers with lens glow */
  const towers = [];
  for (const side of [-1, 1]) {
    const tx = cx + side * Math.min(W * 0.37, 520), bw = clamp(W * 0.075, 40, 96), bh = bw * 0.5;
    const top = towerY, bot = yR(tx);
    g.fillStyle = '#06080c';
    g.beginPath(); g.moveTo(tx - bw * 0.06, top + bh); g.lineTo(tx + bw * 0.06, top + bh); g.lineTo(tx + bw * 0.12, bot + 4); g.lineTo(tx - bw * 0.12, bot + 4); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(30,38,50,.9)'; g.lineWidth = 1;
    for (let y = top + bh + 6; y < bot; y += 9) { g.beginPath(); g.moveTo(tx - bw * 0.1, y); g.lineTo(tx + bw * 0.1, y + 9); g.stroke(); }
    g.fillStyle = '#0b0e14'; g.fillRect(tx - bw / 2 - 3, top - 3, bw + 6, bh + 6);
    const cols = 6, rows = 3, cw = bw / cols, ch = bh / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const lx = tx - bw / 2 + cw * (i + 0.5), ly = top + ch * (j + 0.5), rr = Math.min(cw, ch) * 0.42;
      const lg = g.createRadialGradient(lx, ly, 0, lx, ly, rr);
      lg.addColorStop(0, '#ffffff'); lg.addColorStop(0.6, '#fff6dc'); lg.addColorStop(1, 'rgba(255,230,170,.6)');
      g.fillStyle = lg; g.beginPath(); g.arc(lx, ly, rr, 0, Math.PI * 2); g.fill();
    }
    towers.push({ x: tx, y: top + bh / 2, w: bw, h: bh });
  }

  /* haze in the beams, then the glow over the lamps */
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const t of towers) {
    const gx = cx + (cx - t.x) * 0.15;
    const beam = g.createLinearGradient(t.x, t.y, gx, baseY);
    beam.addColorStop(0, 'rgba(255,244,214,.11)'); beam.addColorStop(1, 'rgba(255,244,214,0)');
    g.fillStyle = beam;
    g.beginPath(); g.moveTo(t.x - t.w * 0.45, t.y); g.lineTo(t.x + t.w * 0.45, t.y);
    g.lineTo(gx + W * 0.25, baseY + span * 0.2); g.lineTo(gx - W * 0.25, baseY + span * 0.2); g.closePath(); g.fill();
    const glow = g.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.w * 2.4);
    glow.addColorStop(0, 'rgba(255,248,225,.75)'); glow.addColorStop(0.25, 'rgba(255,236,190,.22)'); glow.addColorStop(1, 'rgba(255,230,180,0)');
    g.fillStyle = glow; g.fillRect(t.x - t.w * 2.4, t.y - t.w * 2.4, t.w * 4.8, t.w * 4.8);
    const flare = g.createLinearGradient(t.x - W * 0.2, 0, t.x + W * 0.2, 0);
    flare.addColorStop(0, 'rgba(255,240,210,0)'); flare.addColorStop(0.5, 'rgba(255,240,210,.35)'); flare.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = flare; g.fillRect(t.x - W * 0.2, t.y - 1, W * 0.4, 2);
  }
  const haze = g.createLinearGradient(0, yR(cx), 0, baseY);
  haze.addColorStop(0, 'rgba(180,200,230,0)'); haze.addColorStop(0.6, 'rgba(180,200,230,.05)'); haze.addColorStop(1, 'rgba(180,200,230,.09)');
  g.fillStyle = haze; g.fillRect(0, yR(cx), W, baseY - yR(cx));
  g.restore();

  // rim lights along the roof edge
  g.fillStyle = 'rgba(255,240,205,.85)';
  for (let x = 4; x < W; x += 22) g.fillRect(x, yR(x) - 2, 2, 2);

  return { pts, towers };
}

/* Rows of fans between two edge curves. Front rows are drawn last. */
function crowd(g, r, yBot, yTop, W, cx, row0, shrink, empty, pts, light) {
  const hc = yBot(cx) - yTop(cx); if (hc <= 4) return;
  const hs = []; let sum = 0;
  for (let h = row0; sum < hc && hs.length < 80; h *= shrink) { hs.push(h); sum += h; }
  const F = [0]; for (const h of hs) F.push(F[F.length - 1] + h / sum);
  const sect = Math.max(70, W / 7), aisle = Math.max(3, row0 * 0.8);
  const palette = [COL.home, COL.home, '#8f2422', COL.home, COL.cream, '#d9d2c2', COL.gold, '#1d2230', '#2b2f3a', '#3b5f8a', '#46613a', '#6a4a7a', '#c6763a', '#9aa3ad'];
  for (let i = hs.length - 1; i >= 0; i--) {
    const fb = F[i], ft = F[i + 1];
    // riser line
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
    g.beginPath(); for (let x = 0; x <= W; x += 10) { const y = lerp(yBot(x), yTop(x), fb); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    const step0 = Math.max(2.2, hs[i] * 0.66);
    for (let x = r() * step0; x < W + step0; x += step0 * (0.8 + 0.4 * r())) {
      const m = ((x - cx) % sect + sect) % sect;
      if (m < aisle) {
        const yb = lerp(yBot(x), yTop(x), fb), yt = lerp(yBot(x), yTop(x), ft);
        g.fillStyle = 'rgba(120,125,135,.22)'; g.fillRect(x - step0 * 0.5, yt, step0, yb - yt);
        continue;
      }
      if (r() < empty) continue;
      const yb = lerp(yBot(x), yTop(x), fb), yt = lerp(yBot(x), yTop(x), ft), hh = yb - yt;
      const w = step0 * 0.84, lit = 0.6 + 0.4 * light * (1 - i / hs.length);
      const stand = r() < 0.3 ? 0.18 : 0;                // some fans are up
      g.globalAlpha = lit;
      g.fillStyle = palette[(r() * palette.length) | 0];
      g.fillRect(x - w / 2, yb - hh * (0.66 + stand), w, hh * (0.66 + stand));
      g.fillStyle = COL.skin[(r() * COL.skin.length) | 0];
      const hr = Math.max(0.8, hh * 0.2);
      if (hr > 2.2) { g.beginPath(); g.arc(x, yb - hh * (0.8 + stand), hr, 0, Math.PI * 2); g.fill(); }
      else g.fillRect(x - hr, yb - hh * (0.8 + stand) - hr, hr * 2, hr * 2);
      g.globalAlpha = 1;
      if (r() < 0.06) pts.push({ x, y: yb - hh * (0.7 + stand), s: Math.max(1, hh * 0.3), p: r() * 6.28, sp: 0.004 + r() * 0.01 });
    }
  }
}

function ribbon(g, W, yAt, h, col, dots, font) {
  for (let x = 0; x < W; x += 6) { g.fillStyle = col; g.fillRect(x, yAt(x), 6.5, h); }
  if (dots) {
    g.fillStyle = 'rgba(255,214,120,.7)';
    for (let x = 3; x < W; x += 14) g.fillRect(x, yAt(x) + h * 0.35, 3, Math.max(1, h * 0.3));
    return;
  }
  g.save(); g.fillStyle = 'rgba(255,236,200,.92)'; g.font = `800 ${font} ${DISPLAY}`; g.textBaseline = 'middle';
  const y = yAt(0) + h / 2, word = 'SWEET SPOT', gap = 'FIELD GOAL';
  let x = 6, i = 0;
  while (x < W) { const t = i++ % 2 ? gap : word; g.fillText(t, x, y); x += g.measureText(t).width + h * 2.2; }
  g.restore();
}

/* ---------- Field (world space through P) ---------- */
export function drawField(g, o) {
  const { P, W, H, dist, zNear, zWall, hy } = o;
  const side = 26.67, gl = dist - 10;
  const quad = (x0, x1, z0, z1, fill) => {
    const a = P(x0, 0, z0), b = P(x1, 0, z0), c = P(x1, 0, z1), d = P(x0, 0, z1);
    g.fillStyle = fill; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill();
  };
  // surround and sideline areas
  quad(-80, 80, zNear, zWall, '#14321f');
  // mowed stripes, five yards each, counted from the goal line
  for (let z = gl; z > zNear - 5; z -= 5) {
    const k = Math.round((gl - z) / 5);
    quad(-side, side, Math.max(zNear, z - 5), z, k % 2 ? '#2a6b3f' : '#24603a');
  }
  // cross mow: a light checker over the stripes for depth
  for (let z = gl; z > zNear - 5; z -= 5) for (let x = -side; x < side; x += 5.33) {
    if ((Math.round((gl - z) / 5) + Math.round((x + side) / 5.33)) % 2) quad(x, Math.min(side, x + 5.33), Math.max(zNear, z - 5), z, 'rgba(255,255,255,.025)');
  }
  // end zone paint with a soft diagonal sheen
  quad(-side, side, gl, dist, '#6e1a1d');
  for (let x = -side - 10; x < side; x += 2.4) {
    const a = P(clamp(x, -side, side), 0, gl), b = P(clamp(x + 1.2, -side, side), 0, gl), c = P(clamp(x + 1.2 + 10, -side, side), 0, dist), d = P(clamp(x + 10, -side, side), 0, dist);
    g.fillStyle = 'rgba(255,255,255,.035)'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill();
  }
  quad(-side, side, dist, zWall, '#1a4129');

  // grass blades: a noise pattern scaled to the depth of each screen band
  const pat = g.createPattern(grassTile(), 'repeat');
  const top = P(0, 0, zWall)[1];
  for (let y0 = Math.floor(top); y0 < H; y0 += 14) {
    const k = clamp((y0 + 7 - hy) / (H - hy), 0.03, 1) * 1.8;
    g.save(); g.beginPath(); g.rect(0, y0, W, 15); g.clip();
    g.translate(W / 2, hy); g.scale(k, k * 0.5);
    g.fillStyle = pat; g.globalAlpha = 0.9;
    g.fillRect(-W / k, (y0 - hy) / (k * 0.5) - 8, 2 * W / k, 16 / (k * 0.5) + 16);
    g.restore();
  }

  // painted words and numbers go under the lines
  const ez = paintImg('SWEET SPOT', 2048, 300, { fill: '#f4f1e8', stroke: COL.gold, lw: 18, size: 0.9, spacing: 30 });
  mapGround(g, ez, P, W, H, (u, v) => [lerp(-18, 18, u), lerp(gl + 1.6, dist - 1.6, v)], 24, 6);
  // field numbers: tops point to the middle of the field, read from the near sideline
  for (let n = 10; n <= 90; n += 10) {
    const z = gl - n; if (z < zNear + 1 || z > gl) continue;
    const lab = String(Math.min(n, 100 - n)), d1 = lab[0], d2 = lab[1] || '0';
    const toGoal = n < 50 ? 1 : n > 50 ? -1 : 0;           // arrow toward the nearer goal line
    for (const s of [-1, 1]) {
      const xb = s * (side - 7), up = -s;                    // bottom edge 7 yards in, 2 yards tall
      const dw = 1.3, gap = 0.3;
      // digits in reading order: on the left sideline the first digit is farther away
      const first = s < 0 ? [z + gap, z + gap + dw] : [z - gap - dw, z - gap];
      const second = s < 0 ? [z - gap - dw, z - gap] : [z + gap, z + gap + dw];
      const img1 = paintImg(d1, 160, 240, { size: 1.05 }), img2 = paintImg(d2, 160, 240, { size: 1.05 });
      const place = (img, zr) => mapGround(g, img, P, W, H, (u, v) => [xb + up * v * 2, s < 0 ? lerp(zr[1], zr[0], u) : lerp(zr[0], zr[1], u)], 2, 3);
      place(img1, first); place(img2, second);
      if (toGoal) {
        const zEdge = toGoal > 0 ? z + gap + dw + 0.25 : z - gap - dw - 0.25;
        const xt = xb + up * 2, xm = xt - up * 0.25, xl = xt - up * 0.5;
        const a = P(xt, 0, zEdge), b = P(xl, 0, zEdge), c = P(xm, 0, zEdge + toGoal * 0.9);
        g.fillStyle = 'rgba(244,241,232,.9)'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fill();
      }
    }
  }
  // midfield logo when it is in front of the camera
  const mid = gl - 50;
  if (mid - 4.5 > zNear) mapGround(g, logo(), P, W, H, (u, v) => [lerp(-4.5, 4.5, u), lerp(mid - 4.5, mid + 4.5, v)], 8, 8);

  // lines
  const white = 'rgba(246,244,236,.92)';
  for (let z = gl; z > zNear; z -= 5) quad(-side, side, z - 0.055, z + 0.055, white);
  quad(-side, side, gl - 0.11, gl + 0.11, '#ffffff');                     // goal line
  quad(-side, side, dist - 0.11, dist + 0.11, white);                    // end line
  for (const s of [-1, 1]) quad(s * side, s * (side + 2), zNear, dist + 0.11, white);   // sidelines
  quad(-0.5, 0.5, gl - 2 - 0.055, gl - 2 + 0.055, white);                // try line
  for (let z = gl - 1; z > zNear; z--) {
    if ((gl - z) % 5 === 0) continue;
    for (const s of [-1, 1]) {
      quad(s * 3.08, s * 3.75, z - 0.055, z + 0.055, 'rgba(246,244,236,.8)');     // hash marks
      quad(s * (side - 0.85), s * (side - 0.2), z - 0.055, z + 0.055, 'rgba(246,244,236,.8)');
    }
  }
  // pylons at the goal line and end line corners
  for (const z of [gl, dist]) for (const s of [-1, 1]) {
    const a = P(s * side - 0.06, 0, z), b = P(s * side + 0.06, 0.5, z);
    g.fillStyle = '#ff7a1a'; g.fillRect(Math.min(a[0], b[0]), b[1], Math.max(2, Math.abs(b[0] - a[0])), a[1] - b[1]);
  }

  // lighting: brighter where the beams land, darker at the near corners
  const lp = P(0, 0, dist * 0.55);
  const pool = g.createRadialGradient(lp[0], lp[1], 10, lp[0], lp[1], W * 0.9);
  pool.addColorStop(0, 'rgba(255,248,225,.08)'); pool.addColorStop(1, 'rgba(255,248,225,0)');
  g.fillStyle = pool; g.fillRect(0, top, W, H - top);
  const vig = g.createRadialGradient(W / 2, hy, H * 0.2, W / 2, hy, Math.max(W, H) * 0.95);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,6,4,.5)');
  g.fillStyle = vig; g.fillRect(0, top, W, H - top);
}

/* The kicking net behind the uprights. */
export function drawNet(g, P, dist) {
  const z = dist + 3, x0 = -5.2, x1 = 5.2, y0 = 3.6, y1 = 12.4;
  g.save();
  const a = P(x0, y0, z), b = P(x1, y1, z);
  g.fillStyle = 'rgba(8,12,18,.28)'; g.fillRect(a[0], b[1], b[0] - a[0], a[1] - b[1]);
  g.strokeStyle = 'rgba(230,235,240,.10)'; g.lineWidth = 1;
  g.beginPath();
  for (let x = x0; x <= x1 + 1e-6; x += 0.45) { const p = P(x, y0, z), q = P(x, y1, z); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }
  for (let y = y0; y <= y1 + 1e-6; y += 0.45) { const p = P(x0, y, z), q = P(x1, y, z); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }
  g.stroke();
  g.strokeStyle = 'rgba(230,235,240,.28)'; g.strokeRect(a[0], b[1], b[0] - a[0], a[1] - b[1]);
  for (const x of [x0 - 0.15, x1 + 0.15]) {
    const p = P(x, 0, z), q = P(x, y1 + 0.4, z);
    g.strokeStyle = '#1b2029'; g.lineWidth = Math.max(1.5, p[2] * 0.12);
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
  }
  g.restore();
}

/* ---------- People ----------
   Each figure is drawn around a ground point (x, y) at s pixels per yard,
   in local yards: u to the right, v up. */
function limb(g, x, y, s, u1, v1, u2, v2, w, col) {
  g.strokeStyle = col; g.lineWidth = Math.max(1, w * s); g.lineCap = 'round';
  g.beginPath(); g.moveTo(x + u1 * s, y - v1 * s); g.lineTo(x + u2 * s, y - v2 * s); g.stroke();
}
function blob(g, x, y, s, pts, col) {
  g.fillStyle = col; g.beginPath();
  pts.forEach(([u, v], i) => i ? g.lineTo(x + u * s, y - v * s) : g.moveTo(x + u * s, y - v * s));
  g.closePath(); g.fill();
}
function shadow(g, x, y, s, rx, alpha = 0.35) {
  const gr = g.createRadialGradient(x, y, 0, x, y, rx * s);
  gr.addColorStop(0, `rgba(0,0,0,${alpha})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(x, y); g.scale(1, 0.28); g.translate(-x, -y);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, rx * s, 0, Math.PI * 2); g.fill(); g.restore();
}
function helmetBack(g, x, y, s, u, v, r, shell, stripe) {
  const cx = x + u * s, cy = y - v * s, R = r * s;
  const hg = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.1);
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.18, shell); hg.addColorStop(1, '#2a0809');
  g.fillStyle = hg; g.beginPath(); g.ellipse(cx, cy, R, R * 1.02, 0, 0, Math.PI * 2); g.fill();
  if (stripe) { g.fillStyle = stripe; g.fillRect(cx - R * 0.14, cy - R, R * 0.28, R * 1.9); }
}
function jerseyNumber(g, x, y, s, u, v, h, num, col) {
  if (h * s < 5) return;
  g.save(); g.fillStyle = col; g.font = `800 ${Math.round(h * s)}px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num, x + u * s, y - v * s); g.restore();
}

/* Holder, kneeling on the right knee to the left of the ball, seen from behind. */
export function drawHolder(g, x, y, s, { hasBall }) {
  shadow(g, x + 0.1 * s, y, s, 0.75);
  const pants = COL.cream, sock = COL.home, cleat = '#111';
  // down leg: knee on the turf, shin back toward the camera
  limb(g, x, y, s, 0.12, 0.62, 0.2, 0.1, 0.2, pants);
  limb(g, x, y, s, 0.2, 0.08, 0.12, -0.2, 0.15, sock);
  limb(g, x, y, s, 0.12, -0.2, 0.1, -0.3, 0.13, cleat);
  // up leg: knee raised, foot planted ahead
  limb(g, x, y, s, -0.1, 0.62, -0.26, 0.46, 0.21, pants);
  limb(g, x, y, s, -0.26, 0.46, -0.22, 0.05, 0.15, sock);
  limb(g, x, y, s, -0.22, 0.04, -0.2, 0.0, 0.14, cleat);
  // torso leaning forward
  const jg = g.createLinearGradient(x - 0.3 * s, 0, x + 0.3 * s, 0);
  jg.addColorStop(0, COL.homeDark); jg.addColorStop(0.45, COL.home); jg.addColorStop(1, '#7c1c1f');
  blob(g, x, y, s, [[-0.19, 0.56], [0.2, 0.56], [0.3, 0.98], [0.2, 1.1], [-0.2, 1.1], [-0.3, 0.98]], jg);
  g.fillStyle = COL.cream; g.fillRect(x - 0.19 * s, y - 0.6 * s, 0.39 * s, 0.05 * s);   // belt line
  jerseyNumber(g, x, y, s, 0, 0.82, 0.28, '12', COL.cream);
  // right arm to the ball, or lifted once it is kicked
  if (hasBall) { limb(g, x, y, s, 0.24, 1.0, 0.44, 0.66, 0.13, COL.home); limb(g, x, y, s, 0.44, 0.66, 0.55, 0.36, 0.1, '#1b1b1b'); }
  else { limb(g, x, y, s, 0.24, 1.0, 0.44, 0.92, 0.13, COL.home); limb(g, x, y, s, 0.44, 0.92, 0.5, 1.2, 0.1, '#1b1b1b'); }
  limb(g, x, y, s, -0.25, 1.0, -0.33, 0.72, 0.13, COL.home);
  helmetBack(g, x, y, s, 0.02, 1.24, 0.15, COL.home, 'rgba(244,241,232,.85)');
}

/* Kicker, back to the camera. k: 0 stance, 0..1 approach, swing 0..1 the kick. */
export function drawKicker(g, x, y, s, { swing = -1, step = 0, t = 0 }) {
  shadow(g, x, y, s, 0.7);
  const pants = COL.cream, sock = COL.home, cleat = '#121212';
  let lf, rf, lk, rk, lean = 0, armL, armR;
  if (swing < 0) {
    const bob = Math.sin(t / 380) * 0.015, st = step;
    lf = [-0.14 + st * 0.05, 0]; rf = [0.16, -0.05 - st * 0.15];
    lk = [-0.12, 0.5 + bob]; rk = [0.13, 0.48 + bob];
    lean = 0.05 + st * 0.08; armL = [-0.36, 1.0]; armR = [0.36, 1.0];
  } else {
    const k = swing, back = Math.max(0, 1 - k * 3), thru = Math.min(1, Math.max(0, (k - 0.25) / 0.75));
    lf = [-0.1, 0]; lk = [-0.12, 0.5];
    // kicking foot: drawn back behind (lower on screen), then high and away
    rf = [lerp(0.2, 0.36, thru), lerp(-0.3 * (1 - back * 0.3), 1.2, thru)];
    rk = [lerp(0.2, 0.26, thru), lerp(0.35, 0.98, thru)];
    lean = -0.04 - thru * 0.06; armL = [-0.62, 1.42]; armR = [0.42, 1.0 + thru * 0.2];
  }
  const hipY = 0.95, sh = 1.58;
  // plant leg
  limb(g, x, y, s, -0.1, hipY, lk[0], lk[1], 0.22, pants);
  limb(g, x, y, s, lk[0], lk[1], lf[0], lf[1] + 0.06, 0.15, sock);
  limb(g, x, y, s, lf[0], lf[1] + 0.05, lf[0] + 0.02, lf[1], 0.15, cleat);
  // kicking leg drawn on top when behind, under the body when through
  const kickLeg = () => {
    limb(g, x, y, s, 0.1, hipY, rk[0], rk[1], 0.22, pants);
    limb(g, x, y, s, rk[0], rk[1], rf[0], rf[1] + 0.06, 0.15, sock);
    limb(g, x, y, s, rf[0], rf[1] + 0.05, rf[0], rf[1], 0.16, cleat);
  };
  const legBehind = swing < 0 || swing < 0.3;
  if (!legBehind) kickLeg();
  // torso
  const ox = lean;
  const jg = g.createLinearGradient(x - 0.3 * s, 0, x + 0.3 * s, 0);
  jg.addColorStop(0, COL.homeDark); jg.addColorStop(0.45, COL.home); jg.addColorStop(1, '#7c1c1f');
  blob(g, x, y, s, [[-0.18, hipY - 0.04], [0.18, hipY - 0.04], [0.26 + ox, sh - 0.08], [0.18 + ox, sh + 0.02], [-0.18 + ox, sh + 0.02], [-0.26 + ox, sh - 0.08]], jg);
  g.fillStyle = COL.cream; g.fillRect(x - 0.18 * s, y - (hipY + 0.02) * s, 0.36 * s, 0.05 * s);
  jerseyNumber(g, x, y, s, ox * 0.6, 1.3, 0.3, '3', COL.cream);
  limb(g, x, y, s, -0.23 + ox, sh - 0.06, armL[0], armL[1], 0.12, COL.home);
  limb(g, x, y, s, 0.23 + ox, sh - 0.06, armR[0], armR[1], 0.12, COL.home);
  helmetBack(g, x, y, s, ox, sh + 0.17, 0.15, COL.home, 'rgba(244,241,232,.85)');
  if (legBehind) kickLeg();
}

/* A blocker seen from behind in a crouch (home) or a rusher facing us (away). */
export function drawLineman(g, x, y, s, { away = false, rise = 0, armsUp = false, num = '' }) {
  shadow(g, x, y, s, 0.5, 0.3);
  const h = lerp(away ? 1.1 : 0.98, 1.6, rise);
  const pants = away ? COL.awayPants : COL.cream, shirt = away ? COL.away : COL.home, hel = away ? COL.awayTrim : COL.home;
  limb(g, x, y, s, -0.16, h * 0.5, -0.28, 0.02, 0.18, pants);
  limb(g, x, y, s, 0.16, h * 0.5, 0.28, 0.02, 0.18, pants);
  limb(g, x, y, s, -0.28, 0.1, -0.28, 0.0, 0.14, away ? COL.awayTrim : COL.home);
  limb(g, x, y, s, 0.28, 0.1, 0.28, 0.0, 0.14, away ? COL.awayTrim : COL.home);
  blob(g, x, y, s, [[-0.24, h * 0.45], [0.24, h * 0.45], [0.33, h * 0.85], [0.22, h * 0.95], [-0.22, h * 0.95], [-0.33, h * 0.85]], shirt);
  if (away) {
    g.fillStyle = COL.awayTrim; g.fillRect(x - 0.33 * s, y - h * 0.87 * s, 0.66 * s, 0.06 * s);
    if (armsUp) { limb(g, x, y, s, -0.26, h * 0.86, -0.36, h * 1.35, 0.1, shirt); limb(g, x, y, s, 0.26, h * 0.86, 0.36, h * 1.35, 0.1, shirt); }
    else { limb(g, x, y, s, -0.28, h * 0.84, -0.36, h * 0.5, 0.1, shirt); limb(g, x, y, s, 0.28, h * 0.84, 0.36, h * 0.5, 0.1, shirt); }
    const cx = x, cy = y - (h + 0.08) * s, R = 0.15 * s;
    g.fillStyle = hel; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(200,205,215,.8)'; g.lineWidth = Math.max(1, R * 0.18);
    g.beginPath(); g.moveTo(cx - R * 0.6, cy + R * 0.1); g.lineTo(cx + R * 0.6, cy + R * 0.1); g.moveTo(cx - R * 0.5, cy + R * 0.45); g.lineTo(cx + R * 0.5, cy + R * 0.45); g.stroke();
  } else {
    if (num) jerseyNumber(g, x, y, s, 0, h * 0.72, 0.24, num, COL.cream);
    helmetBack(g, x, y, s, 0, h + 0.06, 0.15, COL.home, 'rgba(244,241,232,.8)');
  }
}

/* Official in stripes, facing the field. pose: 'down' | 'good' | 'wave' */
export function drawOfficial(g, x, y, s, pose, t) {
  shadow(g, x, y, s, 0.45, 0.3);
  limb(g, x, y, s, -0.09, 0.95, -0.12, 0.02, 0.17, '#15171c');
  limb(g, x, y, s, 0.09, 0.95, 0.12, 0.02, 0.17, '#15171c');
  const top = 1.6;
  blob(g, x, y, s, [[-0.2, 0.92], [0.2, 0.92], [0.24, top - 0.05], [-0.24, top - 0.05]], '#f4f4f0');
  g.fillStyle = '#111';
  for (let i = -2; i <= 2; i++) g.fillRect(x + (i * 0.09 - 0.022) * s, y - (top - 0.05) * s, 0.045 * s, (top - 0.97) * s);
  let a1, a2;
  if (pose === 'good') { a1 = [-0.3, 2.35]; a2 = [0.3, 2.35]; }
  else if (pose === 'wave') { const w = Math.sin(t / 110) * 0.45; a1 = [-0.1 + w, 1.3]; a2 = [0.1 - w, 1.36]; }
  else { a1 = [-0.3, 1.0]; a2 = [0.3, 1.0]; }
  limb(g, x, y, s, -0.22, top - 0.1, a1[0], a1[1], 0.09, '#e9e9e4');
  limb(g, x, y, s, 0.22, top - 0.1, a2[0], a2[1], 0.09, '#e9e9e4');
  g.fillStyle = COL.skin[1]; g.beginPath(); g.arc(x, y - (top + 0.14) * s, 0.12 * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f7f7f2'; g.fillRect(x - 0.13 * s, y - (top + 0.3) * s, 0.26 * s, 0.1 * s);
}

/* The ball. spin turns it end over end; r is half its length in pixels. */
export function drawBall(g, x, y, r, spin, held, rim) {
  const c = Math.cos(spin), sn = Math.sin(spin);
  const h = held ? r : r * (0.62 + 0.38 * Math.abs(c)), w = r * 0.62;
  g.save(); g.translate(x, y);
  const bg = g.createRadialGradient(-w * 0.35, -h * 0.4, r * 0.05, 0, 0, r * 1.05);
  bg.addColorStop(0, '#c67a46'); bg.addColorStop(0.45, '#8a4a24'); bg.addColorStop(1, '#3d1d0c');
  g.fillStyle = bg; g.beginPath(); g.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); g.fill();
  if (rim) { g.strokeStyle = 'rgba(255,240,215,.75)'; g.lineWidth = Math.max(1, r * 0.09); g.stroke(); }
  const face = held ? 0.35 : sn;                       // laces show when they turn toward us
  if (face > 0 && r > 2.5) {
    const ly = held ? 0 : -c * h * 0.25, len = held ? h * 0.42 : h * 0.4 * (0.4 + 0.6 * Math.abs(c));
    g.globalAlpha = Math.min(1, face * 1.4);
    g.strokeStyle = '#f4f1e8'; g.lineWidth = Math.max(1, r * 0.1); g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, ly - len); g.lineTo(0, ly + len); g.stroke();
    g.lineWidth = Math.max(0.8, r * 0.07);
    for (let i = -2; i <= 2; i++) { const yy = ly + i * len * 0.4; g.beginPath(); g.moveTo(-w * 0.22, yy); g.lineTo(w * 0.22, yy); g.stroke(); }
    g.globalAlpha = 1;
  }
  g.restore();
}
