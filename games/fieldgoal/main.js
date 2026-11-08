/* Sweet Spot Field Goal.
   Two taps per kick: lock the aim needle, then the power meter.
   Wind shifts the aim window and bends the ball in flight. */
import { clamp, lerp, REDUCE, TOUCH } from '../../core/util.js';
import { dailyRng, mulberry32 } from '../../core/seed/seed.js';
import { createMeter } from '../../core/meter/meter.js';
import { nz, tn, coreSfx } from '../../core/audio/audio.js';
import { mountShell } from '../../core/ui/shell.js';
import C from './config.js';

/* ---------- Sound ---------- */
const sfx = {
  ...coreSfx,
  kick() { nz({ dur: 0.09, type: 'lowpass', f: 700, g: 0.7, a: 0.001 }); tn({ f: 110, f2: 55, dur: 0.12, type: 'triangle', g: 0.5, a: 0.001 }); },
  good(big) { nz({ dur: big ? 3 : 1.8, f: 900, q: 0.6, g: big ? 0.28 : 0.16, a: 0.2 }); nz({ dur: big ? 2.6 : 1.5, f: 2400, q: 0.7, g: 0.06, a: 0.2 }); },
  doink() { tn({ f: 1480, dur: 0.9, type: 'triangle', g: 0.16, a: 0.001 }); tn({ f: 2230, dur: 0.6, type: 'sine', g: 0.08, a: 0.001 }); tn({ f: 980, dur: 0.5, type: 'sine', g: 0.06, a: 0.001 }); },
  groan() { nz({ dur: 1.4, type: 'lowpass', f: 600, f2: 260, g: 0.14, a: 0.15 }); }
};

/* ---------- Shell ---------- */
const fmtY = v => v.toLocaleString() + ' yds';
const shell = mountShell({
  game: 'fieldgoal', name: 'Field Goal', titleHtml: 'Field<br>Goal',
  lede: 'Lock the aim needle, then the power meter. Wind moves the target, and every make backs you up five yards, out to 60.',
  rules: [
    ['Aim', 'Tap when the needle sits in the green. Wind shifts the green.'],
    ['Power', 'Tap again in the green band. Short falls short, too much sprays.'],
    ['Misses', 'Three misses end the run. Hitting the upright costs nothing.']
  ],
  modes: [
    { id: 'classic', label: 'Classic', note: 'Random wind every kick. Hashes go left, middle, right.' },
    { id: 'daily', label: 'Daily challenge', board: 'classic', daily: true, note: 'Everyone gets the same wind and hashes today.' }
  ],
  hud: [
    { id: 'score', label: 'Yards made' },
    { id: 'dist', label: 'Distance', unit: 'yds', init: C.distance.start },
    { hearts: true, label: 'Misses left' },
    { id: 'wind', label: 'Wind', unit: 'mph', amber: true, init: '0' }
  ],
  boards: [
    { id: 'today', label: 'Today', mode: 'classic', period: 'daily', note: 'Same wind and hashes for everyone. Resets at midnight UTC.', empty: 'No one has kicked today’s challenge yet.' },
    { id: 'all', label: 'All-time', mode: 'classic', period: 'all', note: 'Most total yards in one run.' }
  ],
  hearts: C.hearts, playLabel: 'Kick off', againLabel: 'Kick again',
  fmt: fmtY,
  share: (score, meta) => meta && meta.longest
    ? `I made a ${meta.longest}-yarder on Sweet Spot Field Goal (${score} total yards).`
    : `I scored ${score} yards on Sweet Spot Field Goal.`,
  onStart: startRun,
  onAction: tap,
  onMenu() { G.phase = 'idle'; }
});

/* ---------- Canvas ---------- */
const cvs = shell.canvas, ctx = cvs.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cvs.clientWidth; H = cvs.clientHeight;
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize); resize();

/* ---------- Run state ---------- */
const HASH_X = { L: -3.08, M: 0, R: 3.08 };
const G = {
  phase: 'idle',               // idle | aim | power | flight | result | over
  rng: Math.random, daily: false,
  score: 0, dist: C.distance.start, hearts: C.hearts, kicks: 0, makes: 0, longest: 0, perfects: 0,
  hash: 'M', wind: { mph: 0, deg: 0 },
  aim: null, power: null, aimRes: null, powRes: null,
  flight: null, t0: 0
};
const aimMeter = createMeter({ orientation: 'horizontal', speed: 1, zones: [] });
const powMeter = createMeter({ orientation: 'vertical', mode: 'fill', speed: 1 / C.power.fillSecs, zones: [] });

const distT = () => (G.dist - C.distance.start) / (C.distance.max - C.distance.start);
const crossMph = () => G.wind.mph * Math.sin(G.wind.deg * Math.PI / 180);   // + blows right
const tailMph = () => G.wind.mph * Math.cos(G.wind.deg * Math.PI / 180);    // + helps
const driftYds = () => crossMph() * C.wind.driftPerMph * (G.dist / 40);
const toBar = x => (x + C.aim.spanYds) / (2 * C.aim.spanYds);
const fromBar = v => v * 2 * C.aim.spanYds - C.aim.spanYds;
const opening = () => C.aim.postHalf * (G.hash === 'M' ? 1 : C.aim.offHashNarrow);
const reqPower = () => clamp(lerp(C.power.reqAt20, C.power.reqAt60, distT()) - tailMph() * C.power.headwindPerMph, 0.15, 0.86);

function rollConditions() {
  const r = G.rng;
  const maxW = lerp(C.wind.maxAt20, C.wind.maxAt60, distT());
  const a = r(), b = r(), c = r();                      // always three draws per kick (daily determinism)
  G.wind = { mph: Math.round(a * maxW), deg: Math.round(b * 360) };
  G.hash = G.daily ? ['L', 'M', 'R'][Math.floor(c * 3)] : ['L', 'M', 'R'][G.kicks % 3];
  G.wobble = r() < 0.5 ? -1 : 1;
}
function windArrow() {
  const d = ((G.wind.deg % 360) + 360) % 360;
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round(d / 45) % 8];
}
function setupKick(now) {
  rollConditions();
  const half = opening(), d = driftYds(), center = -d;
  const pf = half * C.aim.perfectFrac;
  aimMeter.configure({
    speed: lerp(C.aim.speedAt20, C.aim.speedAt60, distT()),
    zones: [
      { id: 'perfect', start: toBar(center - pf), end: toBar(center + pf) },
      { id: 'good', start: toBar(center - half + 0.12), end: toBar(center + half - 0.12) }
    ]
  });
  const req = reqPower();
  powMeter.configure({
    zones: [
      { id: 'perfect', start: req + C.power.perfectFrom, end: req + C.power.perfectTo },
      { id: 'good', start: req, end: req + C.power.goodBand }
    ]
  });
  aimMeter.start(now); powMeter.reset();
  G.phase = 'aim'; G.aimRes = null; G.powRes = null; G.flight = null;
  shell.set('dist', G.dist);
  shell.set('wind', G.wind.mph ? `${G.wind.mph} ${windArrow()}` : '0');
}

function startRun(mode) {
  G.daily = !!mode.daily;
  G.rng = G.daily ? dailyRng('fieldgoal') : mulberry32((Math.random() * 2 ** 32) >>> 0);
  Object.assign(G, { score: 0, dist: C.distance.start, hearts: C.hearts, kicks: 0, makes: 0, longest: 0, perfects: 0 });
  shell.set('score', 0); shell.hearts.set(G.hearts);
  setupKick(performance.now());
}

function tap(time) {
  if (G.phase === 'aim') {
    G.aimRes = aimMeter.stop(time);
    sfx.tick();
    powMeter.start(time);
    G.phase = 'power';
  } else if (G.phase === 'power') {
    G.powRes = powMeter.stop(time);
    kick(time);
  }
}

/* Work out where the ball goes, then animate it there. */
function kick(now, shank = false) {
  sfx.kick();
  const req = reqPower(), p = shank ? 1 : G.powRes.value;
  const half = opening(), drift = driftYds();
  let aimX = fromBar(G.aimRes.value);
  const over = p > req + C.power.goodBand;
  if (over) aimX += G.wobble * C.power.overkickWobble * 2 * C.aim.spanYds * (0.6 + 0.4 * G.rng());
  else G.rng();                                          // keep draw count fixed
  const finalX = aimX + drift;
  const short = p < req;
  const off = Math.abs(finalX);
  let result;
  if (short) result = 'short';
  else if (off <= half - 0.12) result = 'good';
  else if (off <= half + C.aim.postThick) result = 'doink';
  else result = finalX < 0 ? 'left' : 'right';
  const perfect = result === 'good' && G.aimRes.zoneId === 'perfect' && G.powRes.zoneId === 'perfect';
  G.flight = {
    t0: now, dur: C.flightSecs * 1000 * (0.75 + 0.25 * (G.dist / 60)),
    x0: HASH_X[G.hash], aimX, drift, finalX, result, perfect,
    reach: short ? G.dist * clamp(p / req, 0.35, 0.97) : G.dist,
    apex: 4 + G.dist * 0.16 + (over ? 3 : 0)
  };
  G.phase = 'flight';
}

function resolve(now) {
  const f = G.flight;
  G.kicks++;
  if (f.result === 'good') {
    const pts = f.perfect ? Math.round(G.dist * (1 + C.scoring.perfectBonus)) : G.dist;
    G.score += pts; G.makes++; G.longest = Math.max(G.longest, G.dist);
    if (f.perfect) G.perfects++;
    shell.set('score', G.score.toLocaleString(), { pulse: true });
    shell.callout(f.perfect ? 'Perfect!' : 'It’s good!', `${G.dist} yards<b>+${pts}</b>`, f.perfect ? 'gold' : 'good');
    sfx.good(G.dist >= 45 || f.perfect);
    if (f.perfect) sfx.perfect();
    G.dist = Math.min(C.distance.max, G.dist + C.distance.step);
  } else if (f.result === 'doink') {
    shell.callout('Doink!', 'Off the upright. No harm done.', '');
  } else {
    G.hearts--; shell.hearts.set(G.hearts);
    sfx.heartLost(); sfx.groan();
    shell.callout(f.result === 'short' ? 'Short' : f.result === 'left' ? 'Wide left' : 'Wide right',
      G.hearts > 0 ? `${G.hearts} miss${G.hearts === 1 ? '' : 'es'} left` : 'That’s the run', 'bad');
  }
  G.phase = 'result'; G.t0 = now;
}

function finish() {
  G.phase = 'over';
  shell.gameOver({
    score: G.score,
    head: 'Out of misses',
    line: G.longest ? `Long of ${G.longest} yards` : 'No makes this time',
    stats: [['Makes', `${G.makes}/${G.kicks}`], ['Longest', G.longest ? G.longest + ' yds' : '-'], ['Perfect kicks', G.perfects], ['Last try', G.dist + ' yds']],
    meta: { longest: G.longest, makes: G.makes, kicks: G.kicks, perfects: G.perfects }
  });
}

/* ---------- Projection ----------
   World: x = yards left/right of the posts' center, y = yards up,
   z = yards downfield from the ball. Focal length is picked so the
   goalposts take a set share of the screen: closer kicks look bigger. */
let cam = { x: 0, y: 4, z: -22, f: 600, hy: 300 };
/* Camera sits behind the ball, farther back on longer kicks. Focal length
   is chosen so the ball (near the bottom) and the top of the uprights
   (near the top) both fit on screen. */
function setCamera(dist, hashX) {
  const top = 13.3, ballY = H * (TOUCH ? 0.7 : 0.78), postTopY = H * (W < 640 ? 0.22 : 0.18);
  cam.z = -(12 + dist * 0.5);
  cam.x = hashX * 0.6;
  const dzB = -cam.z, dzP = dist - cam.z;
  cam.f = (ballY - postTopY) / (cam.y / dzB + (top - cam.y) / dzP);
  const maxGap = W * 0.46;                               // keep the posts inside narrow phones
  if (2 * C.aim.postHalf * cam.f / dzP > maxGap) cam.f = maxGap * dzP / (2 * C.aim.postHalf);
  cam.hy = ballY - cam.y * cam.f / dzB;
}
const P = (x, y, z) => {
  const dz = Math.max(0.5, z - cam.z);
  return [W / 2 + (x - cam.x) * cam.f / dz, cam.hy + (cam.y - y) * cam.f / dz, cam.f / dz];
};

/* ---------- Drawing ---------- */
function drawScene(now) {
  const dist = G.dist, hashX = HASH_X[G.hash];
  setCamera(dist, hashX);
  // sky + lights
  const sky = ctx.createLinearGradient(0, 0, 0, cam.hy);
  sky.addColorStop(0, '#050b08'); sky.addColorStop(1, '#13261d');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, cam.hy + 2);
  for (const lx of [0.12, 0.88]) {
    const g = ctx.createRadialGradient(W * lx, cam.hy * 0.25, 2, W * lx, cam.hy * 0.25, W * 0.35);
    g.addColorStop(0, 'rgba(255,240,200,.35)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, cam.hy);
    ctx.fillStyle = '#fff8e0'; ctx.fillRect(W * lx - 14, cam.hy * 0.25 - 5, 28, 10);
  }
  // stands
  const standTop = cam.hy - Math.max(26, H * 0.06);
  ctx.fillStyle = '#0d1813'; ctx.fillRect(0, standTop, W, cam.hy - standTop + 1);
  ctx.fillStyle = 'rgba(241,236,224,.12)';
  for (let i = 0; i < 140; i++) { const sx = (i * 97.3) % W, sy = standTop + 3 + ((i * 37) % Math.max(4, cam.hy - standTop - 6)); ctx.fillRect(sx, sy, 2, 2); }
  // ground
  ctx.fillStyle = '#1d4a31'; ctx.fillRect(0, cam.hy, W, H - cam.hy);
  const far = dist + 12, side = 26.67;
  for (let z = -10; z < far; z += 5) {
    const a = P(-side, 0, z), b = P(side, 0, z), c = P(side, 0, z + 5), d = P(-side, 0, z + 5);
    const inEnd = z >= dist - 10 && z < dist;
    ctx.fillStyle = inEnd ? '#173d29' : (Math.floor((z + 10) / 5) % 2 ? '#22573a' : '#1f5135');
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(241,236,224,.55)'; ctx.lineWidth = 1.5;
  for (let z = dist - 10; z > -10; z -= 5) {          // yard lines from the goal line back
    const a = P(-side, 0, z), b = P(side, 0, z);
    ctx.globalAlpha = z === dist - 10 ? 0.95 : 0.5;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const sx of [-side, side]) { const a = P(sx, 0, -10), b = P(sx, 0, dist); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  ctx.fillStyle = 'rgba(241,236,224,.5)';
  for (let z = dist - 11; z > -10; z--) for (const hx of [-3.08, 3.08]) { const p = P(hx, 0, z); ctx.fillRect(p[0] - p[2] * 0.25, p[1] - 0.5, p[2] * 0.5, 1.2); }
  drawPosts(dist, now);
  drawHolder(hashX);
}

function drawPosts(dist, now) {
  const z = dist, bar = 3.33, top = bar + 10, half = C.aim.postHalf;
  const glow = G.phase === 'result' && G.flight && G.flight.result === 'good' ? 1 - (now - G.t0) / 1400 : 0;
  ctx.lineCap = 'round';
  const base = P(0, 0, z), cb = P(0, bar, z), l0 = P(-half, bar, z), r0 = P(half, bar, z), l1 = P(-half, top, z), r1 = P(half, top, z);
  const lw = Math.max(2, base[2] * 0.22);
  if (glow > 0) { ctx.shadowColor = 'rgba(255,211,77,.9)'; ctx.shadowBlur = 24 * glow; }
  ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = lw * 1.3;
  ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(cb[0], cb[1]); ctx.stroke();
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(r0[0], r0[1]); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
  ctx.shadowBlur = 0;
  // wind ribbons on top of each upright
  const sway = Math.sin(now / 260) * 0.25;
  const len = 0.6 + G.wind.mph * 0.12, dx = Math.sin(G.wind.deg * Math.PI / 180) * len;
  for (const p of [l1, r1]) {
    ctx.strokeStyle = '#d23a2e'; ctx.lineWidth = Math.max(2, p[2] * 0.3);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(p[0] + dx * p[2] * 0.5, p[1] + (sway + 0.3) * p[2], p[0] + dx * p[2], p[1] + (0.6 + sway) * p[2] * (G.wind.mph ? 0.6 : 2)); ctx.stroke();
  }
}

function drawHolder(hashX) {
  const b = P(hashX, 0, 0), s = b[2];
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(b[0] - s * 0.9, b[1] + s * 0.05, s * 0.7, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e6e1d6';                               // holder: kneeling jersey
  ctx.beginPath(); ctx.ellipse(b[0] - s * 1.05, b[1] - s * 0.55, s * 0.36, s * 0.5, -0.15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b0352c';
  ctx.beginPath(); ctx.arc(b[0] - s * 1.0, b[1] - s * 1.12, s * 0.2, 0, Math.PI * 2); ctx.fill();
  if (!G.flight) drawBall(b[0], b[1] - s * 0.17, s * 0.17, 0);
}

function drawBall(x, y, r, spin) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(spin);
  ctx.fillStyle = '#8a4a24'; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.62, r, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath(); ctx.moveTo(0, -r * 0.45); ctx.lineTo(0, r * 0.45); ctx.stroke();
  ctx.restore();
}

function drawFlight(now) {
  const f = G.flight; if (!f) return;
  let t = clamp((now - f.t0) / f.dur, 0, 1);
  let x, y, z;
  if (f.result === 'short') {
    z = f.reach * t; x = f.x0 + (f.aimX - f.x0) * t * (f.reach / G.dist) + f.drift * (t * f.reach / G.dist) ** 2;
    y = 4 * f.apex * 0.75 * t * (1 - t);
  } else {
    z = G.dist * t; x = f.x0 + (f.aimX - f.x0) * t + f.drift * t * t;
    y = 4 * f.apex * t * (1 - t) + 5.5 * t;
    if (f.result === 'doink' && t >= 1) {                 // bounce back off the post
      const k = clamp((now - f.t0 - f.dur) / 700, 0, 1);
      z = G.dist - 8 * k; x = f.finalX + Math.sign(f.finalX) * 2 * k; y = 5.5 + 2 * k - 9 * k * k;
    }
  }
  // shadow
  const sh = P(x, 0, z);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(sh[0], sh[1], sh[2] * 0.25, sh[2] * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  const p = P(x, Math.max(0, y), z);
  drawBall(p[0], p[1], Math.max(2.2, p[2] * 0.17), (now - f.t0) / 60);
  const done = f.result === 'doink' ? now - f.t0 >= f.dur + 700 : t >= 1;
  if (done && G.phase === 'flight') resolve(now);
  if (f.result === 'doink' && t >= 1 && !f.clanged) { f.clanged = true; sfx.doink(); }
}

/* Aim bar (bottom) and power bar (right). */
function drawMeters(now) {
  if (!['aim', 'power', 'flight', 'result'].includes(G.phase)) return;
  const bw = Math.min(440, W * 0.82), bx = (W - bw) / 2, by = H - (TOUCH ? 150 : 104), bh = 16;
  // aim
  ctx.fillStyle = 'rgba(9,22,16,.82)'; roundRect(bx - 10, by - 30, bw + 20, bh + 50, 10); ctx.fill();
  ctx.fillStyle = 'rgba(255,138,122,.35)'; roundRect(bx, by, bw, bh, 6); ctx.fill();
  for (const z of aimMeter.zones().slice().reverse()) {
    ctx.fillStyle = z.id === 'perfect' ? '#8fe0a0' : 'rgba(143,224,160,.45)';
    ctx.fillRect(bx + z.start * bw, by, (z.end - z.start) * bw, bh);
  }
  // post markers at the shifted opening edges
  const center = -driftYds(), half = opening();
  ctx.fillStyle = '#ffd34d';
  for (const e of [center - half, center + half]) ctx.fillRect(bx + toBar(e) * bw - 1.5, by - 6, 3, bh + 12);
  const av = G.aimRes ? G.aimRes.value : aimMeter.value(now);
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
  ctx.fillRect(bx + av * bw - 2, by - 9, 4, bh + 18); ctx.shadowBlur = 0;
  label(G.phase === 'aim' ? 'Aim: tap in the green' : G.aimRes ? zoneWord(G.aimRes.zoneId) : '', W / 2, by - 14);
  // power
  const ph = Math.min(H * 0.42, 300), pw = 18, px = W - (W < 640 ? 34 : 70), py = by - 40 - ph;
  ctx.fillStyle = 'rgba(9,22,16,.82)'; roundRect(px - 10, py - 30, pw + 20, ph + 40, 10); ctx.fill();
  ctx.fillStyle = 'rgba(255,138,122,.35)'; roundRect(px, py, pw, ph, 6); ctx.fill();
  const req = reqPower();
  ctx.fillStyle = 'rgba(255,181,71,.35)'; ctx.fillRect(px, py, pw, (1 - (req + C.power.goodBand)) * ph);
  for (const z of powMeter.config.zones.slice().reverse()) {
    ctx.fillStyle = z.id === 'perfect' ? '#8fe0a0' : 'rgba(143,224,160,.45)';
    ctx.fillRect(px, py + (1 - z.end) * ph, pw, (z.end - z.start) * ph);
  }
  const pv = G.powRes ? G.powRes.value : G.phase === 'power' ? powMeter.value(now) : 0;
  ctx.fillStyle = 'rgba(241,236,224,.85)'; ctx.fillRect(px + 4, py + (1 - pv) * ph, pw - 8, pv * ph);
  ctx.fillStyle = '#fff'; ctx.fillRect(px - 5, py + (1 - pv) * ph - 2, pw + 10, 4);
  ctx.save(); ctx.font = '700 12px Barlow, sans-serif'; ctx.fillStyle = 'rgba(241,236,224,.7)'; ctx.textAlign = 'center';
  ctx.fillText('Power', px + pw / 2, py - 12); ctx.restore();
  if (G.phase === 'power' && powMeter.expired(now)) { G.powRes = powMeter.stop(now); kick(now, true); }
}
const zoneWord = id => id === 'perfect' ? 'Perfect' : id === 'good' ? 'Good' : 'Off';
function label(text, x, y) {
  if (!text) return;
  ctx.save(); ctx.font = '800 18px "Big Shoulders Display", sans-serif'; ctx.fillStyle = '#f1ece0'; ctx.textAlign = 'center';
  ctx.fillText(text, x, y); ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ---------- Loop ---------- */
function update(now) {
  if (G.phase === 'idle') { G.dist = 35; G.hash = 'M'; G.wind = { mph: 8, deg: 70 }; }
  drawScene(now);
  drawFlight(now);
  drawMeters(now);
  if (G.phase === 'result' && now - G.t0 > C.resultSecs * 1000) {
    if (G.hearts <= 0) finish(); else setupKick(now);
  }
}
function frame(now) { update(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
if (REDUCE) C.flightSecs *= 0.7;

/* Test hook for local dev only. */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__game = { G, aimMeter, powMeter, tap, step: update };
