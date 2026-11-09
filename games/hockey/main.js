/* Sweet Spot Hockey Shootout.
   Two taps per shot: lock the aim needle across the net, then the power
   meter, which sets the height. The goalie drops into a new butterfly spot
   before every shot and holds it while you shoot. Outcome math lives in
   logic.js. */
import { clamp, lerp, REDUCE } from '../../core/util.js';
import { dailyRng, mulberry32 } from '../../core/seed/seed.js';
import { createMeter } from '../../core/meter/meter.js';
import { nz, tn, coreSfx } from '../../core/audio/audio.js';
import { mountShell } from '../../core/ui/shell.js';
import C from './config.js';
import { aimToX, xToAim, powerToY, yToPower, rollGoalie, resolveShot, isMiss, aimSegments, powerSegments, shotKind, goalieScale, shareText } from './logic.js';

/* ---------- Sound ---------- */
const sfx = {
  ...coreSfx,
  slap() {
    nz({ dur: 0.05, type: 'highpass', f: 1800, g: 0.7, a: 0.001 });
    nz({ dur: 0.09, type: 'lowpass', f: 900, g: 0.6, a: 0.001 });
    tn({ f: 160, f2: 70, dur: 0.09, type: 'triangle', g: 0.4, a: 0.001 });
  },
  ping() {
    tn({ f: 2480, dur: 1.1, type: 'sine', g: 0.16, a: 0.001 });
    tn({ f: 3720, dur: 0.7, type: 'sine', g: 0.07, a: 0.001 });
    tn({ f: 1650, dur: 0.6, type: 'triangle', g: 0.07, a: 0.001 });
  },
  horn(big) {
    const d = big ? 2.2 : 1.6;
    for (const f of [174.6, 220, 261.6]) tn({ f, dur: d, type: 'sawtooth', g: 0.05, a: 0.04, delay: 0.12 });
    tn({ f: 87.3, dur: d, type: 'square', g: 0.03, a: 0.04, delay: 0.12 });
  },
  crowd(big) {
    nz({ dur: big ? 3 : 2.2, f: 900, q: 0.6, g: big ? 0.3 : 0.2, a: 0.2, delay: 0.05 });
    nz({ dur: big ? 2.6 : 1.8, f: 2400, q: 0.7, g: 0.06, a: 0.2, delay: 0.05 });
  },
  twine() { nz({ dur: 0.25, type: 'highpass', f: 3000, g: 0.1, a: 0.005 }); },
  thud() {
    nz({ dur: 0.12, type: 'lowpass', f: 420, g: 0.8, a: 0.001 });
    tn({ f: 110, f2: 55, dur: 0.14, type: 'sine', g: 0.45, a: 0.001 });
  },
  glass() { nz({ dur: 0.25, f: 700, q: 1.2, g: 0.35, a: 0.001 }); tn({ f: 95, f2: 60, dur: 0.3, type: 'sine', g: 0.3, a: 0.001 }); },
  groan() { nz({ dur: 1.4, type: 'lowpass', f: 600, f2: 260, g: 0.14, a: 0.15 }); }
};

/* ---------- Shell ---------- */
const fmtP = v => v.toLocaleString() + ' pts';
const shell = mountShell({
  game: 'hockey', name: 'Hockey Shootout', titleHtml: 'Hockey<br>Shootout',
  lede: 'Skate in, lock your aim across the net, then set the power: more power lifts the puck. The goalie drops into a butterfly, so the ice is crowded and the top shelf is where the points are.',
  rules: [
    ['Aim', 'Tap when the needle sits on green, gold or blue. Red is the goalie.'],
    ['Power', 'Tap again to set the height. Gold is top shelf for 3. Blue is the five-hole for 2. Too much goes off the glass.'],
    ['Misses', 'Saved, wide or over costs a heart. Off the iron is free. Every 5 goals the goalie gets bigger.']
  ],
  modes: [
    { id: 'classic', label: 'Classic', note: 'The goalie takes a new spot before every shot.' },
    { id: 'daily', label: 'Daily challenge', board: 'classic', daily: true, note: 'Everyone faces the same goalie today.' }
  ],
  hud: [
    { id: 'score', label: 'Points' },
    { id: 'goals', label: 'Goals' },
    { hearts: true, label: 'Misses left' },
    { id: 'top', label: 'Top shelf', amber: true }
  ],
  boards: [
    { id: 'today', label: 'Today', mode: 'classic', period: 'daily', note: 'Same goalie for everyone. Resets at midnight UTC.', empty: 'No one has taken today’s shootout yet.' },
    { id: 'all', label: 'All-time', mode: 'classic', period: 'all', note: 'Most points in one run.' }
  ],
  hearts: C.hearts, playLabel: 'Hit the ice', againLabel: 'Shoot again',
  fmt: fmtP,
  share: shareText,
  onStart: startRun,
  onAction: tap,
  onMenu() { G.phase = 'idle'; }
});

/* ---------- Canvas ---------- */
const cvs = shell.canvas, ctx = cvs.getContext('2d');
let X = ctx;                                   // current drawing target (screen or the cached rink)
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cvs.clientWidth; H = cvs.clientHeight;
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize); resize();

/* ---------- Run state ---------- */
const DEMO_GOALIE = { x: 0.18, scale: 1, fiveOpen: true, lean: 1 };
const G = {
  phase: 'idle',               // idle | aim | power | flight | result | over
  rng: Math.random, daily: false,
  score: 0, goals: 0, topShelf: 0, fiveHole: 0, shots: 0, hearts: C.hearts, streak: 0, bestStreak: 0,
  goalie: DEMO_GOALIE, aimSegs: [], aimRes: null, powRes: null, aimX: 0,
  shot: null, t0: 0, lampAt: -1e9, freeze: false
};
const aimMeter = createMeter({ orientation: 'horizontal', speed: C.aim.speed, zones: [] });
const powMeter = createMeter({ orientation: 'vertical', mode: 'fill', speed: 1 / C.power.fillSecs, zones: [] });

function setupShot(now) {
  G.goalie = rollGoalie(G.rng, G.goals);               // three draws every shot (daily determinism)
  G.aimSegs = aimSegments(G.goalie);
  aimMeter.configure({ speed: Math.min(C.aim.speedMax, C.aim.speed + C.aim.speedPerGoal * G.goals) });
  aimMeter.start(now); powMeter.reset();
  G.phase = 'aim'; G.aimRes = null; G.powRes = null; G.shot = null; G.t0 = now;
}

function startRun(mode) {
  G.daily = !!mode.daily;
  G.rng = G.daily ? dailyRng('hockey') : mulberry32((Math.random() * 2 ** 32) >>> 0);
  Object.assign(G, { score: 0, goals: 0, topShelf: 0, fiveHole: 0, shots: 0, hearts: C.hearts, streak: 0, bestStreak: 0 });
  shell.set('score', 0); shell.set('goals', 0); shell.set('top', 0); shell.hearts.set(G.hearts);
  setupShot(performance.now());
}

function tap(time) {
  if (G.phase === 'aim') {
    G.aimRes = aimMeter.stop(time);
    G.aimX = aimToX(G.aimRes.value);
    sfx.tick();
    powMeter.start(time);
    G.phase = 'power';
  } else if (G.phase === 'power') {
    G.powRes = powMeter.stop(time);
    shoot(time, G.powRes.value);
  }
}

/* ---------- World ----------
   x = meters right of the net's center, y = meters up, z = meters toward
   the net from the release point (goal line at z = Z, end boards at z = B). */
const HW = C.goal.halfWidthM, GH = C.goal.heightM, Z = C.goal.lineZ, B = Z + 3.4;
const PUCK_R = 0.05, PUCK_T = 0.03;   // drawn a touch larger than life so it reads on a phone

/* Work out where the puck goes, then animate it there. */
function shoot(now, p) {
  sfx.slap();
  const res = resolveShot(G.aimX, p, G.goalie);
  let ex = res.x * HW, ey = Math.max(PUCK_T / 2, res.y * GH), ez = Z;
  if (res.result === 'saved') ez = Z - 0.22;
  else if (res.result === 'post') ex = Math.sign(res.x) * HW;
  else if (res.result === 'bar') ey = GH;
  G.shot = {
    t0: now, dur: C.flightSecs * (0.9 + 0.2 * Math.abs(res.x)) * 1000,
    res, ex, ey, ez, arc: 0.05 + 0.12 * clamp(res.y, 0, 1), hitAt: 0
  };
  G.phase = 'flight';
}

function placeWord(x, y) {
  const side = x < -0.33 ? 'blocker side' : x > 0.33 ? 'glove side' : 'up the middle';
  if (y < 0.08) return 'Along the ice, ' + side;
  const h = y < 0.35 ? 'Low, ' : y > C.goal.cornerY ? 'High, ' : '';
  const s = h + side;
  return s[0].toUpperCase() + s.slice(1);
}

function resolve(now) {
  const r = G.shot.res;
  G.shots++;
  if (r.result === 'goal') {
    const before = goalieScale(G.goals);
    G.score += r.points; G.goals++; G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak);
    if (r.zone === 'topShelf') G.topShelf++;
    if (r.zone === 'fiveHole') G.fiveHole++;
    const grows = goalieScale(G.goals) > before;
    shell.set('score', G.score.toLocaleString(), { pulse: true });
    shell.set('goals', G.goals);
    if (r.zone === 'topShelf') shell.set('top', G.topShelf, { pulse: true });
    const where = r.zone === 'topShelf' ? 'Upper ' + (r.x < 0 ? 'blocker side' : 'glove side') : r.zone === 'fiveHole' ? 'Right between the pads' : placeWord(r.x, r.y);
    const head = r.zone === 'topShelf' ? 'Top shelf!' : r.zone === 'fiveHole' ? 'Five-hole!' : 'Goal!';
    shell.callout(head, `${where}<b>+${r.points}</b>${grows ? '<br>The goalie gets bigger' : ''}`, r.zone === 'topShelf' ? 'gold' : 'good');
    G.lampAt = now;
    sfx.twine(); sfx.horn(r.zone !== 'open'); sfx.crowd(r.zone !== 'open');
    if (r.zone !== 'open') sfx.perfect();
  } else if (!isMiss(r.result)) {
    G.streak = 0;
    sfx.ping();
    shell.callout(r.result === 'bar' ? 'Off the crossbar' : 'Off the post', 'Off the iron. No harm done.', '');
  } else {
    G.streak = 0;
    G.hearts--; shell.hearts.set(G.hearts);
    if (r.result === 'saved') sfx.thud(); else sfx.glass();
    sfx.heartLost(); sfx.groan();
    const head = { saved: 'Saved', wide: r.x < 0 ? 'Wide left' : 'Wide right', over: 'Off the glass' }[r.result];
    const sub = r.result === 'saved' ? savedWhere(r) + '. ' : '';
    shell.callout(head, sub + (G.hearts > 0 ? `${G.hearts} miss${G.hearts === 1 ? '' : 'es'} left` : 'That’s the run'), 'bad');
  }
  G.phase = 'result'; G.t0 = now;
}
function savedWhere(r) {
  const g = C.goalie, dx = r.x - G.goalie.x;
  if (r.y <= g.padTop) return 'Pad save';
  if (r.y > g.bodyTop) return 'Off the mask';
  if (Math.abs(dx) < 0.17 * G.goalie.scale) return 'Into the chest';
  return dx < 0 ? 'Blocker save' : 'Glove save';
}

function finish() {
  G.phase = 'over';
  const s = n => n === 1 ? '' : 's';
  shell.gameOver({
    score: G.score,
    head: 'Out of misses',
    line: G.topShelf ? `Top shelf ${G.topShelf} time${s(G.topShelf)}` : G.goals ? `${G.goals} goal${s(G.goals)}, none top shelf` : 'No goals this time',
    stats: [['Goals', `${G.goals}/${G.shots}`], ['Top shelf', G.topShelf], ['Five-hole', G.fiveHole], ['Best streak', G.bestStreak]],
    meta: { goals: G.goals, topShelf: G.topShelf, fiveHole: G.fiveHole, shots: G.shots }
  });
}

/* ---------- Layout + projection ----------
   The net gets a set share of the screen; the camera height is then picked
   so the puck sits just above the aim bar. */
const L = { by: 0, px: 0, py: 0, ph: 0, gy: 0, sg: 1, phone: false };
const cam = { c: 30, y: 2, f: 600, hy: 300 };
function layout() {
  const hud = document.getElementById('hud');
  const hudB = hud ? hud.getBoundingClientRect().bottom : 90;
  const phone = L.phone = W < 640;
  L.by = H - (matchMedia('(pointer: coarse)').matches ? 150 : 104);
  L.ph = clamp(Math.min(300, H * 0.42, L.by - 80 - hudB), 80, 300);
  L.py = L.by - 40 - L.ph;
  L.px = W - (phone ? 34 : 70);
  const gw = W * (phone ? 0.72 : 0.42);
  const ghPx = Math.min(gw / (2 * HW / GH), H * (phone ? 0.24 : 0.3));
  const top = Math.max(hudB + 54, H * (phone ? 0.3 : 0.25));
  L.gy = top + ghPx;
  L.sg = ghPx / GH;
  const puckY = L.by - 60;
  cam.f = L.sg * (Z + cam.c);
  cam.y = clamp((puckY - L.gy) * cam.c / (Z * L.sg), 0.5, 6);
  cam.hy = L.gy - cam.y * L.sg;
}
const P = (x, y, z) => {
  const dz = Math.max(0.4, z + cam.c);
  const s = cam.f / dz;
  return [W / 2 + x * s, cam.hy + (cam.y - y) * s, s];
};
/* Goal-space point (x -1..1, y 0..1) on the goal line. */
const GP = (x, y, z = Z) => P(x * HW, y * GH, z);

/* ---------- Drawing helpers ---------- */
function path(pts) {
  X.beginPath(); X.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) X.lineTo(pts[i][0], pts[i][1]);
  X.closePath();
}
function poly(pts, fill) { path(pts); X.fillStyle = fill; X.fill(); }
const ZMIN = () => -cam.c + 0.8;
function groundLine(x1, z1, x2, z2) {
  const zmin = ZMIN();
  if (z1 < zmin && z2 < zmin) return;
  if (z1 < zmin) { const t = (zmin - z1) / (z2 - z1); x1 = lerp(x1, x2, t); z1 = zmin; }
  if (z2 < zmin) { const t = (zmin - z2) / (z1 - z2); x2 = lerp(x2, x1, t); z2 = zmin; }
  const a = P(x1, 0, z1), b = P(x2, 0, z2);
  X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
}
function groundPoly(pts, fill) { poly(pts.map(([x, z]) => P(x, 0, Math.max(ZMIN(), z))), fill); }
function roundRect(x, y, w, h, r) {
  X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r);
  X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath();
}

/* ---------- The rink (static, cached per layout) ---------- */
const rink = document.createElement('canvas');
let rinkKey = '';
function drawRinkCached() {
  const key = [W, H, DPR, L.gy, L.sg, cam.y].map(v => Math.round(v * 100)).join(':');
  if (key !== rinkKey) {
    rinkKey = key;
    rink.width = Math.round(W * DPR); rink.height = Math.round(H * DPR);
    const rc = rink.getContext('2d');
    rc.setTransform(DPR, 0, 0, DPR, 0, 0);
    X = rc; drawRink(); X = ctx;
  }
  ctx.drawImage(rink, 0, 0, W, H);
}

const BOARD_H = 1.07, GLASS_H = 2.6;
function drawRink() {
  const rng = mulberry32(90210);
  const bTop = P(0, BOARD_H, B)[1], bBot = P(0, 0, B)[1], gTop = P(0, BOARD_H + GLASS_H, B)[1];

  // arena bowl: dark seats under the roof
  const sky = X.createLinearGradient(0, 0, 0, bTop);
  sky.addColorStop(0, '#05080d'); sky.addColorStop(1, '#101722');
  X.fillStyle = sky; X.fillRect(0, 0, W, bBot);

  // crowd, rising row by row away from the glass (back rows first)
  X.save();
  X.filter = 'blur(0.8px)';
  const shirts = ['#2a3a5c', '#7d2730', '#c9ccd2', '#1c2a40', '#3d4f6e', '#9a3b2f', '#e3e1da', '#26303b', '#4a6a8a', '#b8862f'];
  const skins = ['#e0b896', '#c99a74', '#a8744d', '#7a5136', '#f0cfb0'];
  for (let r = 30; r >= 0; r--) {
    const z = B + 1.1 + r * 0.8, seat = 0.45 + r * 0.38;
    const s = P(0, 0, z)[2];
    const xl = (0 - W / 2) / s - 1, xr = (W - W / 2) / s + 1;
    const rowTop = P(0, seat + 1.0, z)[1], rowBot = P(0, seat - 0.45, z)[1];
    if (rowBot < -20) continue;
    // riser wall under this row
    X.fillStyle = r % 2 ? '#0c121b' : '#0e1520';
    X.fillRect(0, rowTop, W, Math.max(1, P(0, seat - 0.42, z - 0.82)[1] - rowTop));
    for (let x = xl + rng() * 0.5; x < xr; x += 0.5 + rng() * 0.18) {
      if (rng() < 0.08) continue;                     // an empty seat
      const lift = rng() < 0.12 ? 0.14 : 0;            // a few on their feet
      const sh = P(x, seat + 0.62 + lift, z), hd = P(x + (rng() - 0.5) * 0.05, seat + 0.86 + lift + rng() * 0.05, z);
      const u = sh[2], wv = 0.2 + rng() * 0.05;
      X.fillStyle = shirts[(rng() * shirts.length) | 0];
      X.beginPath();
      X.moveTo(sh[0] - u * wv, sh[1] + u * 0.6);
      X.lineTo(sh[0] - u * wv, sh[1] + u * 0.08);
      X.quadraticCurveTo(sh[0] - u * wv, sh[1] - u * 0.02, sh[0] - u * 0.08, sh[1] - u * 0.03);
      X.lineTo(sh[0] + u * 0.08, sh[1] - u * 0.03);
      X.quadraticCurveTo(sh[0] + u * wv, sh[1] - u * 0.02, sh[0] + u * wv, sh[1] + u * 0.08);
      X.lineTo(sh[0] + u * wv, sh[1] + u * 0.6); X.closePath(); X.fill();
      X.fillStyle = skins[(rng() * skins.length) | 0];
      X.beginPath(); X.ellipse(hd[0], hd[1], u * 0.085, u * 0.105, 0, 0, Math.PI * 2); X.fill();
      const hair = rng();
      if (hair < 0.7) { X.fillStyle = ['#1d1712', '#3b2717', '#5a3b22', '#8a6a3a', '#2a2a2a'][(rng() * 5) | 0]; X.beginPath(); X.ellipse(hd[0], hd[1] - u * 0.035, u * 0.09, u * 0.08, 0, Math.PI, Math.PI * 2); X.fill(); }
      else if (hair < 0.85) { X.fillStyle = shirts[(rng() * shirts.length) | 0]; X.beginPath(); X.ellipse(hd[0], hd[1] - u * 0.05, u * 0.095, u * 0.07, 0, Math.PI, Math.PI * 2); X.fill(); X.fillRect(hd[0] - u * 0.02, hd[1] - u * 0.06, u * 0.13, u * 0.025); }
    }
  }
  X.restore();
  // the crowd sits in shadow; the rink is the bright thing
  const shade = X.createLinearGradient(0, 0, 0, bTop);
  shade.addColorStop(0, 'rgba(4,7,12,.72)'); shade.addColorStop(1, 'rgba(4,7,12,.38)');
  X.fillStyle = shade; X.fillRect(0, 0, W, bTop);

  // overhead lights spilling down
  const lights = [0.12, 0.38, 0.62, 0.88];
  for (const lx of lights) {
    const g = X.createRadialGradient(W * lx, -H * 0.05, 4, W * lx, -H * 0.05, H * 0.55);
    g.addColorStop(0, 'rgba(225,238,255,.42)'); g.addColorStop(0.35, 'rgba(200,220,255,.12)'); g.addColorStop(1, 'rgba(200,220,255,0)');
    X.fillStyle = g; X.fillRect(0, 0, W, bBot);
    X.fillStyle = 'rgba(240,248,255,.95)'; roundRect(W * lx - 22, 6, 44, 7, 3); X.fill();
  }

  // glass: faint tint, seams at the stanchions, diagonal glare
  X.fillStyle = 'rgba(170,205,230,.07)'; X.fillRect(0, Math.max(0, gTop), W, bTop - Math.max(0, gTop));
  const sAtB = P(0, 0, B)[2];
  const seamX0 = Math.floor(((0 - W / 2) / sAtB) / 1.6) - 1, seamX1 = Math.ceil(((W - W / 2) / sAtB) / 1.6) + 1;
  for (let i = seamX0; i <= seamX1; i++) {
    const x = i * 1.6 + 0.8, a = P(x, BOARD_H, B), b = P(x, BOARD_H + GLASS_H, B);
    X.strokeStyle = 'rgba(210,230,245,.22)'; X.lineWidth = Math.max(1, a[2] * 0.03);
    X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
    // glare streak in each pane
    const g0 = P(x + 0.25, BOARD_H + 0.1, B), g1 = P(x + 0.9, BOARD_H + GLASS_H, B), w = a[2] * 0.22;
    const gr = X.createLinearGradient(g0[0], 0, g0[0] + w * 2, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(235,245,255,.10)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    X.fillStyle = gr;
    path([[g0[0], g0[1]], [g0[0] + w, g0[1]], [g1[0] + w, g1[1]], [g1[0], g1[1]]]); X.fill();
  }
  // top rail of the glass
  X.fillStyle = 'rgba(200,215,230,.35)'; X.fillRect(0, gTop - 2, W, 3);

  // boards: white face, cap rail, navy kick plate, plain panel lines
  const kick = P(0, 0.22, B)[1];
  const bd = X.createLinearGradient(0, bTop, 0, bBot);
  bd.addColorStop(0, '#f4f6f8'); bd.addColorStop(1, '#d8dee4');
  X.fillStyle = bd; X.fillRect(0, bTop, W, bBot - bTop);
  X.fillStyle = '#1d2c4a'; X.fillRect(0, kick, W, bBot - kick);
  X.fillStyle = '#e6a52e'; X.fillRect(0, bTop - 2, W, Math.max(3, (bBot - bTop) * 0.06));
  X.strokeStyle = 'rgba(30,45,70,.12)'; X.lineWidth = 1;
  for (let i = seamX0; i <= seamX1; i++) {
    const a = P(i * 1.6 + 0.8, BOARD_H, B), b = P(i * 1.6 + 0.8, 0.22, B);
    X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
  }
  // scuffs on the boards
  for (let i = 0; i < 40; i++) {
    const x = (rng() * 2 - 1) * 9, y = 0.25 + rng() * 0.5, p = P(x, y, B);
    X.fillStyle = `rgba(20,25,35,${0.05 + rng() * 0.1})`;
    X.fillRect(p[0], p[1], p[2] * (0.03 + rng() * 0.1), Math.max(1, p[2] * 0.01));
  }

  // ice: cool white, brighter toward the camera, with a soft sheen
  const ice = X.createLinearGradient(0, bBot, 0, H);
  ice.addColorStop(0, '#b9cad8'); ice.addColorStop(0.25, '#dbe6ee'); ice.addColorStop(1, '#eef4f8');
  X.fillStyle = ice; X.fillRect(0, bBot, W, H - bBot);
  // reflection of the boards and the kick plate in the ice
  const refl = X.createLinearGradient(0, bBot, 0, bBot + (bBot - bTop) * 0.9);
  refl.addColorStop(0, 'rgba(29,44,74,.35)'); refl.addColorStop(0.25, 'rgba(255,255,255,.35)'); refl.addColorStop(1, 'rgba(255,255,255,0)');
  X.fillStyle = refl; X.fillRect(0, bBot, W, (bBot - bTop) * 0.9);
  // light pools mirrored on the ice
  for (const lx of lights) {
    const cx = W * lx, cy = lerp(bBot, H, 0.35);
    X.save(); X.translate(cx, cy); X.scale(1, 2.6);
    const g = X.createRadialGradient(0, 0, 2, 0, 0, W * 0.12);
    g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    X.fillStyle = g; X.beginPath(); X.arc(0, 0, W * 0.12, 0, Math.PI * 2); X.fill();
    X.restore();
  }

  // markings under the surface: goal line, crease, trapezoid, faceoff circles
  X.strokeStyle = 'rgba(200,30,40,.78)'; X.lineWidth = Math.max(1.5, P(0, 0, Z)[2] * 0.05);
  groundLine(-14, Z, 14, Z);
  X.lineWidth = Math.max(1, P(0, 0, Z)[2] * 0.05);
  groundLine(-HW - 2.4, Z, -HW - 3.4, B); groundLine(HW + 2.4, Z, HW + 3.4, B);
  // crease: straight sides then an arc, painted light blue
  const crease = [[-1.22, Z]];
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI / 2 + Math.PI * i / 24;
    crease.push([Math.sin(a) * 1.22, Z - 1.37 - Math.cos(a) * 0.46]);
  }
  crease.push([1.22, Z]);
  groundPoly(crease, 'rgba(70,150,215,.42)');
  X.strokeStyle = 'rgba(200,30,40,.75)'; X.lineWidth = Math.max(1, P(0, 0, Z - 1)[2] * 0.05);
  for (let i = 0; i < crease.length - 1; i++) groundLine(crease[i][0], crease[i][1], crease[i + 1][0], crease[i + 1][1]);
  for (const sx of [-6.7, 6.7]) {
    let prev = null;
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2, pt = [sx + Math.cos(a) * 4.57, Z - 6.1 + Math.sin(a) * 4.57];
      if (prev) groundLine(prev[0], prev[1], pt[0], pt[1]);
      prev = pt;
    }
    const d = P(sx, 0, Z - 6.1);
    X.fillStyle = 'rgba(200,30,40,.75)'; X.beginPath(); X.ellipse(d[0], d[1], d[2] * 0.3, d[2] * 0.3 * (cam.y / (Z - 6.1 + cam.c)), 0, 0, Math.PI * 2); X.fill();
  }
  // frost over the paint so the lines sit in the ice
  X.fillStyle = 'rgba(235,242,248,.12)'; X.fillRect(0, bBot, W, H - bBot);

  // skate scratches: long curved carves, mostly heading for the net
  X.lineCap = 'round';
  for (let i = 0; i < 320; i++) {
    const z0 = -4 + rng() * (B - 0.4 + 4), x0 = (rng() * 2 - 1) * (3 + (z0 + cam.c) * 0.35);
    const len = 0.6 + rng() * 2.6, dir = (rng() - 0.5) * 1.6, bend = (rng() - 0.5) * 0.8;
    X.strokeStyle = rng() < 0.6 ? `rgba(255,255,255,${0.25 + rng() * 0.35})` : `rgba(120,145,170,${0.08 + rng() * 0.12})`;
    X.lineWidth = rng() < 0.85 ? 0.7 : 1.3;
    X.beginPath();
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, zz = Math.min(B - 0.05, z0 + Math.cos(dir) * len * t), xx = x0 + Math.sin(dir) * len * t + bend * t * t;
      const p = P(xx, 0, Math.max(ZMIN(), zz));
      if (k) X.lineTo(p[0], p[1]); else X.moveTo(p[0], p[1]);
    }
    X.stroke();
  }
  // snow shaved up in the crease
  for (let i = 0; i < 220; i++) {
    const a = rng() * Math.PI, rr = 0.3 + rng() * 1.5, p = P(Math.cos(a) * rr * 1.1, 0, Z - 0.15 - Math.sin(a) * rr * 0.9);
    X.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.3})`;
    X.beginPath(); X.ellipse(p[0], p[1], p[2] * (0.01 + rng() * 0.03), Math.max(0.6, p[2] * 0.004), 0, 0, Math.PI * 2); X.fill();
  }
}

/* Red lamp on the glass behind the net; spins up on a goal. */
function drawLamp(now) {
  const base = P(0, BOARD_H + 0.03, B), u = base[2];
  const on = now - G.lampAt < 2200, flick = on ? 0.6 + 0.4 * Math.sin(now / 60) : 0;
  const cy = base[1] - u * 0.07;
  if (on) {
    X.fillStyle = `rgba(255,40,30,${0.1 * flick})`; X.fillRect(0, 0, W, P(0, BOARD_H, B)[1]);
    const g = X.createRadialGradient(base[0], cy, 2, base[0], cy, u * 1.4);
    g.addColorStop(0, `rgba(255,60,50,${0.6 * flick})`); g.addColorStop(1, 'rgba(255,60,50,0)');
    X.fillStyle = g; X.fillRect(base[0] - u * 1.4, cy - u * 1.4, u * 2.8, u * 2.8);
  }
  X.fillStyle = '#222a35'; X.fillRect(base[0] - u * 0.08, base[1] - u * 0.03, u * 0.16, u * 0.04);
  X.fillStyle = on ? `rgb(255,${70 + 60 * flick | 0},60)` : '#7a2a24';
  X.beginPath(); X.ellipse(base[0], cy, u * 0.055, u * 0.05, 0, Math.PI, Math.PI * 2); X.lineTo(base[0] + u * 0.055, base[1] - u * 0.03); X.lineTo(base[0] - u * 0.055, base[1] - u * 0.03); X.closePath(); X.fill();
  X.fillStyle = 'rgba(255,255,255,.35)'; X.beginPath(); X.ellipse(base[0] - u * 0.02, cy - u * 0.02, u * 0.012, u * 0.02, 0, 0, Math.PI * 2); X.fill();
}

/* ---------- The net ---------- */
const NET = { topD: 0.45, baseD: 1.0 };
/* Base frame shape behind the goal line: from post (t=0) round to center back (t=1). */
const baseCurve = (side, t) => {
  const a = t * Math.PI / 2;
  return [side * HW * Math.cos(a) * 1.05 + side * 0.0, Z + Math.sin(a) * NET.baseD];
};
function netShake(now) {
  const s = G.shot;
  return s && s.res.result === 'goal' && s.hitAt ? Math.max(0, 1 - (now - s.hitAt) / 700) : 0;
}
function drawNetBack(now) {
  const sh = netShake(now), wob = t => sh * Math.sin(now / 35 + t * 7) * 0.06;
  const topBack = (x) => [x, GH * 0.92, Z + NET.topD];
  // shadow inside the net on the ice
  const sp = [];
  for (let i = 0; i <= 12; i++) sp.push(baseCurve(-1, i / 12));
  for (let i = 12; i >= 0; i--) sp.push(baseCurve(1, i / 12));
  groundPoly(sp, 'rgba(30,45,65,.28)');
  // back mesh: a dim fill then a diamond weave of lines
  const pts = [];
  for (let i = 0; i <= 16; i++) { const [x, z] = baseCurve(-1, i / 16); pts.push(P(x, 0, z + wob(i))); }
  for (let i = 16; i >= 0; i--) { const [x, z] = baseCurve(1, i / 16); pts.push(P(x, 0, z + wob(i))); }
  pts.push(P(HW * 0.98, GH * 0.92, Z + NET.topD)); pts.push(P(-HW * 0.98, GH * 0.92, Z + NET.topD));
  // order: base left->center->right, then top right->left
  const fill = X.createLinearGradient(0, P(0, GH, Z)[1], 0, P(0, 0, Z)[1]);
  fill.addColorStop(0, 'rgba(235,240,245,.20)'); fill.addColorStop(1, 'rgba(235,240,245,.08)');
  path([...pts.slice(0, 17), ...pts.slice(17, 34), pts[34], pts[35]]); X.fillStyle = fill; X.fill();
  X.strokeStyle = 'rgba(250,252,255,.42)'; X.lineWidth = 0.8;
  // mesh lines from the top back bar down to the base, both diagonals
  const N = 22;
  const along = t => {                       // a point on the base curve, t from -1 (left post) to 1 (right post)
    const [x, z] = baseCurve(t < 0 ? -1 : 1, 1 - Math.abs(t)); return [x, z];
  };
  for (let i = -N; i <= N; i++) {
    for (const d of [-0.35, 0.35]) {
      const t0 = i / N, t1 = clamp(t0 + d, -1, 1);
      const [bx, bz] = along(t1);
      const a = P(t0 * HW * 0.98, GH * 0.92, Z + NET.topD + wob(i)), b = P(bx, 0, bz + wob(i));
      X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
    }
  }
  // roof mesh between the crossbar and the top back bar
  for (let i = -8; i <= 8; i++) {
    const a = P(i / 8 * HW, GH, Z), b = P(i / 8 * HW * 0.98, GH * 0.92, Z + NET.topD);
    X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
  }
  // side mesh
  for (const sx of [-1, 1]) {
    for (let k = 1; k <= 5; k++) {
      const y = GH * k / 6;
      const [bx, bz] = baseCurve(sx, 0.25);
      const a = P(sx * HW, y, Z), b = P(lerp(sx * HW, bx, 1 - y / GH), y * 0.92, lerp(Z + NET.topD, bz, 1 - y / GH));
      X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
    }
  }
  // white base frame and top back bar
  X.strokeStyle = '#f2f4f6'; X.lineWidth = Math.max(2, P(0, 0, Z + 0.5)[2] * 0.04); X.lineCap = 'round';
  X.beginPath();
  for (let i = 0; i <= 16; i++) { const [x, z] = baseCurve(-1, i / 16), p = P(x, 0.02, z); i ? X.lineTo(p[0], p[1]) : X.moveTo(p[0], p[1]); }
  for (let i = 16; i >= 0; i--) { const [x, z] = baseCurve(1, i / 16), p = P(x, 0.02, z); X.lineTo(p[0], p[1]); }
  X.stroke();
  const t0 = P(-HW * 0.98, GH * 0.92, Z + NET.topD), t1 = P(HW * 0.98, GH * 0.92, Z + NET.topD);
  X.strokeStyle = '#d93a32'; X.lineWidth = Math.max(2, t0[2] * 0.035);
  X.beginPath(); X.moveTo(P(-HW, GH, Z)[0], P(-HW, GH, Z)[1]); X.lineTo(t0[0], t0[1]); X.lineTo(t1[0], t1[1]); X.lineTo(P(HW, GH, Z)[0], P(HW, GH, Z)[1]); X.stroke();
}

/* Posts and crossbar: round red pipe with a highlight. */
function drawFrame(now) {
  const s = G.shot, hit = s && (s.res.result === 'post' || s.res.result === 'bar') && s.hitAt ? Math.max(0, 1 - (now - s.hitAt) / 500) : 0;
  const jig = hit * Math.sin(now / 16) * 0.012;
  const l0 = P(-HW, 0, Z), l1 = P(-HW - jig, GH, Z), r0 = P(HW, 0, Z), r1 = P(HW + jig, GH, Z);
  const w = Math.max(4, l0[2] * 0.06);
  X.lineCap = 'round'; X.lineJoin = 'round';
  const stroke = (col, lw, dx, dy) => {
    X.strokeStyle = col; X.lineWidth = lw;
    X.beginPath(); X.moveTo(l0[0] + dx, l0[1]); X.lineTo(l1[0] + dx, l1[1] + dy); X.lineTo(r1[0] + dx, r1[1] + dy); X.lineTo(r0[0] + dx, r0[1]); X.stroke();
  };
  X.shadowColor = 'rgba(0,0,0,.25)'; X.shadowBlur = 6;
  stroke('#8e1d1a', w, 0, 0);
  X.shadowBlur = 0;
  stroke('#d8322b', w * 0.7, -w * 0.08, -w * 0.08);
  stroke('rgba(255,190,180,.75)', Math.max(1, w * 0.18), -w * 0.2, -w * 0.22);
  if (hit) { X.strokeStyle = `rgba(255,255,255,${hit * 0.8})`; X.lineWidth = w * 1.6 * hit; X.globalAlpha = 0.25; stroke('#fff', w * 2, 0, 0); X.globalAlpha = 1; }
  // little foot caps where the posts meet the ice
  for (const p of [l0, r0]) { X.fillStyle = '#e8eaec'; X.beginPath(); X.ellipse(p[0], p[1], w * 0.9, w * 0.3, 0, 0, Math.PI * 2); X.fill(); }
}

/* Target areas painted on the goal mouth while you aim. */
function drawTargets(now) {
  if (!['aim', 'power'].includes(G.phase)) return;
  const g = C.goal, k = G.goalie, gc = C.goalie;
  const rect = (x0, y0, x1, y1, fill, stroke) => {
    const a = GP(x0, y1), b = GP(x1, y0);
    X.fillStyle = fill; X.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    if (stroke) { X.strokeStyle = stroke; X.lineWidth = 1.5; X.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
  };
  rect(-1 + g.post, 0, 1 - g.post, 1 - g.bar, 'rgba(143,224,160,.08)');
  const pulse = 0.24 + 0.08 * Math.sin(now / 220);
  for (const sgn of [-1, 1]) {
    const x0 = sgn < 0 ? -1 + g.post : g.cornerX, x1 = sgn < 0 ? -g.cornerX : 1 - g.post;
    rect(x0, g.cornerY, x1, 1 - g.bar, `rgba(255,181,71,${pulse})`, 'rgba(255,181,71,.85)');
  }
  // goalie coverage, band by band (the butterfly shape)
  const s = k.scale, red = 'rgba(255,110,95,.16)', redS = 'rgba(255,110,95,.5)';
  const clip = (a, b) => [Math.max(-1, a), Math.min(1, b)];
  for (const [y0, y1, hw] of [[0, gc.padTop, gc.padHalf], [gc.padTop, gc.bodyTop, gc.bodyHalf], [gc.bodyTop, gc.headTop, gc.headHalf]]) {
    const [a, b] = clip(k.x - hw * s, k.x + hw * s);
    rect(a, y0, b, y1, red, redS);
  }
  // the needle's line through the net, and the height dot while powering
  const x = G.phase === 'aim' ? aimToX(aimMeter.value(now)) : G.aimX;
  const top = GP(x, 1.3), bot = GP(x, 0);
  X.save(); X.setLineDash([5, 5]); X.strokeStyle = 'rgba(20,30,45,.7)'; X.lineWidth = 2;
  X.beginPath(); X.moveTo(top[0], top[1]); X.lineTo(bot[0], bot[1]); X.stroke(); X.restore();
  if (G.phase === 'power') {
    const p = powMeter.value(now), y = powerToY(p);
    const d = GP(x, y), kind = shotKind(resolveShot(x, p, k));
    X.fillStyle = SEG_DOT[kind] || '#ff8a7a';
    X.strokeStyle = '#fff'; X.lineWidth = 2;
    X.beginPath(); X.arc(d[0], d[1], Math.max(5, d[2] * 0.05), 0, Math.PI * 2); X.fill(); X.stroke();
  }
}
/* The five-hole glows between the pads (drawn over the goalie). */
function drawFiveHint(now) {
  const k = G.goalie, gc = C.goalie;
  if (!k.fiveOpen || !['aim', 'power'].includes(G.phase)) return;
  const a = GP(k.x - gc.fiveHalf, gc.fiveTop, Z - 0.03), b = GP(k.x + gc.fiveHalf, 0, Z - 0.03);
  X.fillStyle = `rgba(110,200,255,${0.4 + 0.12 * Math.sin(now / 220)})`; X.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  X.strokeStyle = 'rgba(170,225,255,.95)'; X.lineWidth = 1.5; X.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
}
const SEG_DOT = { open: '#8fe0a0', topShelf: '#ffb547', fiveHole: '#6ec8ff' };

/* ---------- The goalie ----------
   Drawn on the goal plane in goal units so his gear matches the coverage
   bands in logic.js exactly: pads to padTop, blocker and glove to bodyHalf,
   shoulders and mask to headTop. He faces the shooter, so his blocker
   (right hand) is on screen left and his catching glove on screen right. */
const GOALIE_COL = { jersey: '#1f4f8a', trim: '#f1ece0', stripe: '#e6a52e', pad: '#f4f2ec', padTrim: '#1f4f8a', pants: '#14233c', mask: '#e9edf2' };
function drawGoalie(now) {
  const k = G.goalie, gc = C.goalie, s = k.scale;
  const shot = G.shot, saving = shot && shot.hitAt && shot.res.result === 'saved';
  const sv = saving ? Math.min(1, (now - shot.hitAt) / 140) : 0;
  const breathe = Math.sin(now / 420) * 0.006;
  const reach = saving ? clamp((shot.res.x - k.x) * 0.35, -0.08, 0.08) * sv : 0;
  const zz = Z - 0.03;
  const at = (dx, y) => GP(k.x + dx * s, y, zz);
  const atA = (dx, y) => GP(k.x + dx, y, zz);        // absolute width (unscaled offset)
  const u = GP(0, 0, zz)[2] * HW;                     // pixels per goal x unit
  const uy = GP(0, 0, zz)[2] * GH;                    // pixels per goal y unit
  const pts = list => list.map(([dx, y]) => at(dx, y));
  const smooth = (list, fill, stroke, lw) => {
    path(list); X.fillStyle = fill; X.fill();
    if (stroke) { X.strokeStyle = stroke; X.lineWidth = lw || 1.2; X.stroke(); }
  };

  // shadow on the ice
  const base = at(0, 0);
  X.fillStyle = 'rgba(20,35,55,.28)';
  X.beginPath(); X.ellipse(base[0], base[1] + 2, gc.padHalf * s * u * 1.02, uy * 0.05, 0, 0, Math.PI * 2); X.fill();

  // pads: flared out along the ice in the butterfly
  const gap = k.fiveOpen ? gc.fiveHalf / s : 0.012;
  const ph = gc.padHalf, pt = gc.padTop;
  for (const sg of [-1, 1]) {
    const inner = sg * gap, outer = sg * ph;
    const face = pts([[inner, 0.0], [outer * 0.97, 0.0], [outer, 0.07], [outer * 0.92, pt * 0.72], [lerp(inner, outer, 0.35), pt * 0.98], [inner, pt * 0.98]]);
    const gr = X.createLinearGradient(0, at(0, pt)[1], 0, at(0, 0)[1]);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#c9cfd6');
    smooth(face, gr, 'rgba(20,30,45,.55)', 1.2);
    // knee rolls and a colored stripe band
    X.strokeStyle = GOALIE_COL.padTrim; X.lineWidth = Math.max(2, uy * 0.035);
    const s0 = at(lerp(inner, outer, 0.1), pt * 0.55), s1 = at(lerp(inner, outer, 0.92), pt * 0.4);
    X.beginPath(); X.moveTo(s0[0], s0[1]); X.lineTo(s1[0], s1[1]); X.stroke();
    X.strokeStyle = GOALIE_COL.stripe; X.lineWidth = Math.max(1, uy * 0.015);
    const s2 = at(lerp(inner, outer, 0.1), pt * 0.42), s3 = at(lerp(inner, outer, 0.92), pt * 0.29);
    X.beginPath(); X.moveTo(s2[0], s2[1]); X.lineTo(s3[0], s3[1]); X.stroke();
    X.strokeStyle = 'rgba(40,55,75,.25)'; X.lineWidth = 1;
    for (const f of [0.3, 0.5, 0.7]) {
      const a = at(lerp(inner, outer, f), 0.02), b = at(lerp(inner, outer, f * 0.95), pt * (0.95 - f * 0.2));
      X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
    }
    // skate toe poking out of the pad
    const toe = at(outer * 1.0, 0.02);
    X.fillStyle = '#20252c'; X.beginPath(); X.ellipse(toe[0], toe[1], u * 0.03 * s, uy * 0.025, 0, 0, Math.PI * 2); X.fill();
  }
  // pants and the gap behind the five-hole
  if (k.fiveOpen) {
    const g0 = atA(-gc.fiveHalf, 0), g1 = atA(gc.fiveHalf, gc.fiveTop);
    X.fillStyle = 'rgba(25,35,50,.35)'; X.fillRect(g0[0], g1[1], g1[0] - g0[0], g0[1] - g1[1]);
  }
  smooth(pts([[-0.2, pt + 0.12], [0.2, pt + 0.12], [0.22, gc.fiveTop + 0.02], [0.06, gc.fiveTop - 0.01], [-0.06, gc.fiveTop - 0.01], [-0.22, gc.fiveTop + 0.02]]), GOALIE_COL.pants, 'rgba(0,0,0,.3)');

  // chest and jersey
  const by = breathe;
  const chest = pts([[-0.25, gc.bodyTop - 0.02 + by], [0.25, gc.bodyTop - 0.02 + by], [0.23, pt + 0.06], [-0.23, pt + 0.06]]);
  const jg = X.createLinearGradient(at(-0.25, 0)[0], 0, at(0.25, 0)[0], 0);
  jg.addColorStop(0, '#173d6c'); jg.addColorStop(0.5, GOALIE_COL.jersey); jg.addColorStop(1, '#173d6c');
  smooth(chest, jg, 'rgba(0,0,0,.35)');
  // jersey stripes at the waist
  for (const [y, col] of [[pt + 0.12, GOALIE_COL.trim], [pt + 0.15, GOALIE_COL.stripe]]) {
    const a = at(-0.23, y), b = at(0.23, y);
    X.strokeStyle = col; X.lineWidth = Math.max(1.5, uy * 0.025);
    X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
  }
  // shoulders (the bulky upper body that covers to headHalf)
  smooth(pts([[-gc.headHalf, gc.bodyTop + 0.06 + by], [gc.headHalf, gc.bodyTop + 0.06 + by], [0.25, gc.bodyTop - 0.06 + by], [-0.25, gc.bodyTop - 0.06 + by]]), '#1a4577', 'rgba(0,0,0,.3)');
  // crest: a plain circle with a chevron, no real marks
  const cr = at(0, (pt + gc.bodyTop) / 2 + 0.04);
  X.fillStyle = GOALIE_COL.trim; X.beginPath(); X.arc(cr[0], cr[1], Math.max(3, uy * 0.06), 0, Math.PI * 2); X.fill();
  X.strokeStyle = GOALIE_COL.jersey; X.lineWidth = Math.max(1.5, uy * 0.02);
  X.beginPath(); X.moveTo(cr[0] - uy * 0.035, cr[1] + uy * 0.015); X.lineTo(cr[0], cr[1] - uy * 0.025); X.lineTo(cr[0] + uy * 0.035, cr[1] + uy * 0.015); X.stroke();

  // stick: from the blocker down to the paddle on the ice
  const bh = gc.bodyHalf;
  const blockY = 0.5 + (reach < 0 ? -reach * 0.8 : 0);
  const hand = at(-bh + 0.07 + Math.min(0, reach), blockY - 0.04);
  const heel = k.fiveOpen ? at(-0.18, 0.02) : at(-0.02, 0.02);
  const toeS = k.fiveOpen ? at(-0.46, 0.02) : at(0.2, 0.02);
  X.lineCap = 'round';
  X.strokeStyle = '#2b2f36'; X.lineWidth = Math.max(2, uy * 0.03);
  X.beginPath(); X.moveTo(hand[0], hand[1]); X.lineTo(heel[0], heel[1]); X.stroke();
  X.strokeStyle = '#2b2f36'; X.lineWidth = Math.max(3, uy * 0.05);
  X.beginPath(); X.moveTo(heel[0], heel[1]); X.lineTo(toeS[0], toeS[1]); X.stroke();
  X.strokeStyle = 'rgba(255,255,255,.5)'; X.lineWidth = 1;
  X.beginPath(); X.moveTo(heel[0], heel[1] - uy * 0.012); X.lineTo(toeS[0], toeS[1] - uy * 0.012); X.stroke();

  // blocker (screen left): a flat board with a cuff
  const bx0 = -bh + Math.min(0, reach * 1.2), bx1 = bx0 + 0.15;
  smooth(pts([[bx0, blockY + 0.16], [bx1, blockY + 0.16], [bx1, blockY - 0.04], [bx0, blockY - 0.04]]), '#f4f2ec', 'rgba(20,30,45,.6)', 1.4);
  smooth(pts([[bx0 + 0.02, blockY + 0.12], [bx1 - 0.02, blockY + 0.12], [bx1 - 0.02, blockY + 0.04], [bx0 + 0.02, blockY + 0.04]]), GOALIE_COL.jersey);
  smooth(pts([[bx1, blockY + 0.08], [bx1 + 0.06, blockY + 0.1], [bx1 + 0.07, blockY + 0.0], [bx1, blockY - 0.02]]), GOALIE_COL.jersey, 'rgba(0,0,0,.3)');

  // catching glove (screen right): a rounded mitt with a cuff and web
  const gyc = 0.56 + (reach > 0 ? reach * 1.5 : 0), gx1 = bh + Math.max(0, reach * 1.2);
  const gcx = at(gx1 - 0.085, gyc);
  const gr = 0.085 * s * u, grY = 0.11 * uy;
  X.fillStyle = '#f4f2ec'; X.strokeStyle = 'rgba(20,30,45,.6)'; X.lineWidth = 1.4;
  X.beginPath(); X.ellipse(gcx[0], gcx[1], gr, grY, -0.2, 0, Math.PI * 2); X.fill(); X.stroke();
  X.fillStyle = GOALIE_COL.jersey;
  X.beginPath(); X.ellipse(gcx[0] - gr * 0.15, gcx[1] + grY * 0.25, gr * 0.55, grY * 0.45, -0.2, 0, Math.PI * 2); X.fill();
  X.strokeStyle = 'rgba(20,30,45,.55)'; X.lineWidth = 1;
  X.beginPath(); X.moveTo(gcx[0] + gr * 0.2, gcx[1] - grY * 0.9); X.lineTo(gcx[0] + gr * 0.55, gcx[1] - grY * 0.2); X.stroke();
  X.beginPath(); X.moveTo(gcx[0] + gr * 0.5, gcx[1] - grY * 0.75); X.lineTo(gcx[0] + gr * 0.1, gcx[1] - grY * 0.35); X.stroke();
  // arms to the gloves
  X.strokeStyle = GOALIE_COL.jersey; X.lineWidth = Math.max(3, uy * 0.07);
  const shL = at(-0.2, gc.bodyTop - 0.06 + by), shR = at(0.2, gc.bodyTop - 0.06 + by);
  const bl = at(bx1 + 0.03, blockY + 0.06), gl = at(gx1 - 0.16, gyc - 0.02);
  X.beginPath(); X.moveTo(shL[0], shL[1]); X.quadraticCurveTo(at(-0.27, 0.6)[0], at(-0.27, 0.6)[1], bl[0], bl[1]); X.stroke();
  X.beginPath(); X.moveTo(shR[0], shR[1]); X.quadraticCurveTo(at(0.27, 0.62)[0], at(0.27, 0.62)[1], gl[0], gl[1]); X.stroke();
  X.strokeStyle = GOALIE_COL.trim; X.lineWidth = Math.max(1, uy * 0.02);
  for (const [a, b] of [[at(-0.27, 0.6), bl], [at(0.27, 0.62), gl]]) {
    X.beginPath(); X.moveTo(lerp(a[0], b[0], 0.55), lerp(a[1], b[1], 0.55) - uy * 0.02); X.lineTo(lerp(a[0], b[0], 0.65), lerp(a[1], b[1], 0.65) - uy * 0.02); X.stroke();
  }

  // mask: rounded shell, cage, small chin guard
  const hd = at(0, (gc.bodyTop + gc.headTop) / 2 + 0.035 + by);
  const mw = Math.min(gc.headHalf * 0.72 * s, 0.13) * u, mh = (gc.headTop - gc.bodyTop) * 0.5 * uy;
  const mg = X.createRadialGradient(hd[0] - mw * 0.3, hd[1] - mh * 0.4, 1, hd[0], hd[1], mw * 1.3);
  mg.addColorStop(0, '#ffffff'); mg.addColorStop(1, '#aeb6c0');
  X.fillStyle = mg; X.strokeStyle = 'rgba(20,30,45,.6)'; X.lineWidth = 1.2;
  X.beginPath(); X.ellipse(hd[0], hd[1], mw, mh, 0, 0, Math.PI * 2); X.fill(); X.stroke();
  X.fillStyle = GOALIE_COL.jersey;                    // painted stripe over the dome
  X.beginPath(); X.ellipse(hd[0], hd[1] - mh * 0.45, mw * 0.25, mh * 0.45, 0, Math.PI, Math.PI * 2); X.fill();
  X.fillStyle = 'rgba(20,28,40,.85)';
  X.beginPath(); X.ellipse(hd[0], hd[1] + mh * 0.18, mw * 0.62, mh * 0.5, 0, 0, Math.PI * 2); X.fill();
  X.strokeStyle = '#d9dde2'; X.lineWidth = Math.max(1, mw * 0.06);
  for (let i = -2; i <= 2; i++) { X.beginPath(); X.moveTo(hd[0] + i * mw * 0.22, hd[1] - mh * 0.25); X.lineTo(hd[0] + i * mw * 0.2, hd[1] + mh * 0.62); X.stroke(); }
  for (const f of [0.05, 0.35]) { X.beginPath(); X.moveTo(hd[0] - mw * 0.6, hd[1] + mh * f); X.lineTo(hd[0] + mw * 0.6, hd[1] + mh * f); X.stroke(); }
}

/* ---------- The shooter ----------
   Seen from behind, skating in, stick on the ice with the puck on his
   forehand. Placed left of the puck so he does not block the net. */
const SHOOTER_COL = { jersey: '#a8322b', trim: '#f1ece0', pants: '#141c2b', helmet: '#141c2b', socks: '#a8322b' };
function shooterSpot() {
  // world x so his right shoulder clears the left post on screen
  const z = -0.75, s = P(0, 0, z)[2];
  const post = GP(-1, 0)[0];
  const want = Math.min(post - 0.5 * s, W / 2 - 0.7 * s);
  // on a narrow phone he slides partly off the left edge rather than cover the net
  return { x: Math.max((want - W / 2) / s, (-0.3 * s - W / 2) / s), z };
}
function drawShooter(now) {
  const { x: x0, z } = shooterSpot();
  const glide = G.phase === 'aim' || G.phase === 'power' || G.phase === 'idle' ? Math.sin(now / 380) : 0;
  const shot = G.shot, follow = shot ? clamp((now - shot.t0) / 160, 0, 1) : 0;
  const at = (dx, y, dz = 0) => P(x0 + dx, y, z + dz);
  const u = at(0, 0)[2];
  const limb = (a, b, w, col) => { X.strokeStyle = col; X.lineWidth = Math.max(2, w * u); X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke(); };
  X.lineCap = 'round'; X.lineJoin = 'round';
  // shadow
  const sh = at(0, 0);
  X.fillStyle = 'rgba(20,35,55,.25)'; X.beginPath(); X.ellipse(sh[0], sh[1], u * 0.45, u * 0.08, 0, 0, Math.PI * 2); X.fill();
  // legs in stride: one pushing out behind, one under him
  const push = 0.1 + 0.06 * glide;
  for (const [sx, kz, fz, lift] of [[-1, 0.05, -0.1 - push, 0.06], [1, 0.08, 0.15, 0]]) {
    const hip = at(sx * 0.12, 0.88), knee = at(sx * 0.2, 0.5, kz), ankle = at(sx * (0.26 + (sx < 0 ? push : 0)), 0.1 + lift, fz);
    limb(hip, knee, 0.2, SHOOTER_COL.pants);
    limb(knee, ankle, 0.15, SHOOTER_COL.socks);
    const sockStripe = [lerp(knee[0], ankle[0], 0.45), lerp(knee[1], ankle[1], 0.45)];
    X.strokeStyle = SHOOTER_COL.trim; X.lineWidth = Math.max(1, u * 0.05);
    X.beginPath(); X.moveTo(sockStripe[0] - u * 0.07, sockStripe[1]); X.lineTo(sockStripe[0] + u * 0.07, sockStripe[1]); X.stroke();
    // skate boot and blade
    X.fillStyle = '#16181c';
    roundRect(ankle[0] - u * 0.08, ankle[1] - u * 0.04, u * 0.16, u * 0.12, u * 0.03); X.fill();
    X.fillStyle = '#cfd6dd'; X.fillRect(ankle[0] - u * 0.09, ankle[1] + u * 0.08, u * 0.18, Math.max(1.5, u * 0.02));
  }
  // breezers
  poly([at(-0.27, 1.02), at(0.27, 1.02), at(0.3, 0.68), at(0.02, 0.62), at(-0.3, 0.68)], SHOOTER_COL.pants);
  X.strokeStyle = SHOOTER_COL.jersey; X.lineWidth = Math.max(1, u * 0.03);
  for (const sx of [-1, 1]) { const a = at(sx * 0.28, 1.0), b = at(sx * 0.3, 0.7); X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke(); }
  // jersey, back view, leaning forward a touch
  const lean = 0.06;
  const jg = X.createLinearGradient(at(-0.3, 0)[0], 0, at(0.3, 0)[0], 0);
  jg.addColorStop(0, '#7d231e'); jg.addColorStop(0.45, SHOOTER_COL.jersey); jg.addColorStop(1, '#8a2822');
  poly([at(-0.31, 1.52, lean), at(0.31, 1.52, lean), at(0.3, 0.96), at(-0.3, 0.96)], jg);
  for (const [y, col, w] of [[1.06, SHOOTER_COL.trim, 0.05], [1.12, '#1d2c4a', 0.035]]) {
    const a = at(-0.3, y), b = at(0.3, y);
    X.strokeStyle = col; X.lineWidth = Math.max(1, u * w); X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.stroke();
  }
  // number on the back
  const num = at(0, 1.3, lean * 0.6);
  X.save(); X.font = `800 ${Math.max(10, u * 0.3)}px "Big Shoulders Display", sans-serif`;
  X.textAlign = 'center'; X.textBaseline = 'middle';
  X.lineWidth = Math.max(1, u * 0.025); X.strokeStyle = '#1d2c4a'; X.strokeText('17', num[0], num[1]);
  X.fillStyle = SHOOTER_COL.trim; X.fillText('17', num[0], num[1]); X.restore();
  // stick: hands low and right, blade on the ice behind the puck; it whips through on the shot
  const bladeX = -0.16 + follow * 0.25, bladeY = 0.015 + follow * 0.45, bladeZ = 0.75 - 0.03 + follow * 0.35;
  const top = at(0.12 + follow * 0.1, 1.05 + follow * 0.25, 0.05);
  const low = at(0.36 + follow * 0.1, 0.78 + follow * 0.3, 0.2);
  const heel = P(bladeX - 0.04, bladeY, z + bladeZ), toe = P(bladeX + 0.2, bladeY + follow * 0.05, z + bladeZ + 0.02);
  limb(top, heel, 0.045, '#2a2622');
  X.strokeStyle = '#d9b26a'; X.lineWidth = Math.max(1, u * 0.012);
  X.beginPath(); X.moveTo(lerp(top[0], heel[0], 0.05), lerp(top[1], heel[1], 0.05)); X.lineTo(lerp(top[0], heel[0], 0.9), lerp(top[1], heel[1], 0.9)); X.stroke();
  X.strokeStyle = '#1b1b1b'; X.lineWidth = Math.max(3, heel[2] * 0.05);
  X.beginPath(); X.moveTo(heel[0], heel[1]); X.lineTo(toe[0], toe[1]); X.stroke();
  X.strokeStyle = 'rgba(255,255,255,.7)'; X.lineWidth = Math.max(1, heel[2] * 0.012);
  X.beginPath(); X.moveTo(lerp(heel[0], toe[0], 0.2), heel[1]); X.lineTo(lerp(heel[0], toe[0], 0.7), lerp(heel[1], toe[1], 0.7)); X.stroke();
  // arms and gloves
  const shL = at(-0.27, 1.46, lean), shR = at(0.27, 1.46, lean);
  limb(shL, lerp2(shL, top, 0.55, -u * 0.05), 0.14, SHOOTER_COL.jersey);
  limb(lerp2(shL, top, 0.55, -u * 0.05), top, 0.12, SHOOTER_COL.jersey);
  limb(shR, lerp2(shR, low, 0.5, u * 0.04), 0.14, SHOOTER_COL.jersey);
  limb(lerp2(shR, low, 0.5, u * 0.04), low, 0.12, SHOOTER_COL.jersey);
  for (const g of [top, low]) {
    X.fillStyle = '#1d2c4a'; roundRect(g[0] - u * 0.075, g[1] - u * 0.07, u * 0.15, u * 0.15, u * 0.04); X.fill();
    X.fillStyle = SHOOTER_COL.jersey; X.fillRect(g[0] - u * 0.075, g[1] + u * 0.02, u * 0.15, u * 0.035);
  }
  // shoulders yoke stripe
  X.strokeStyle = SHOOTER_COL.trim; X.lineWidth = Math.max(1, u * 0.035);
  X.beginPath(); X.moveTo(shL[0], shL[1] + u * 0.08); X.lineTo(shR[0], shR[1] + u * 0.08); X.stroke();
  // helmet from behind, with a visor edge
  const hd = at(0.02, 1.68, lean + 0.04);
  X.fillStyle = SHOOTER_COL.helmet; X.beginPath(); X.ellipse(hd[0], hd[1], u * 0.13, u * 0.14, 0, 0, Math.PI * 2); X.fill();
  X.fillStyle = 'rgba(255,255,255,.18)'; X.beginPath(); X.ellipse(hd[0] - u * 0.04, hd[1] - u * 0.06, u * 0.05, u * 0.03, -0.4, 0, Math.PI * 2); X.fill();
  X.fillStyle = '#3a2618'; X.fillRect(hd[0] - u * 0.07, hd[1] + u * 0.1, u * 0.14, u * 0.06);
  X.strokeStyle = 'rgba(190,220,240,.6)'; X.lineWidth = Math.max(1, u * 0.02);
  X.beginPath(); X.moveTo(hd[0] - u * 0.13, hd[1] + u * 0.02); X.lineTo(hd[0] - u * 0.16, hd[1] + u * 0.06); X.stroke();
  X.beginPath(); X.moveTo(hd[0] + u * 0.13, hd[1] + u * 0.02); X.lineTo(hd[0] + u * 0.16, hd[1] + u * 0.06); X.stroke();
}
const lerp2 = (a, b, t, dx) => [lerp(a[0], b[0], t) + dx, lerp(a[1], b[1], t)];

/* ---------- The puck ---------- */
function drawPuck(x, y, z, spin, tilt = 0) {
  const sh = P(x, 0, z), p = P(x, y, z), r = Math.max(3, p[2] * PUCK_R), t = Math.max(2, p[2] * PUCK_T);
  const flat = clamp(0.28 + tilt, 0.2, 0.9);
  if (y > 0.03) { X.fillStyle = 'rgba(20,35,55,.25)'; X.beginPath(); X.ellipse(sh[0], sh[1], r, r * 0.25, 0, 0, Math.PI * 2); X.fill(); }
  X.fillStyle = '#0d0f12';
  X.beginPath(); X.ellipse(p[0], p[1], r, r * flat, 0, 0, Math.PI); X.lineTo(p[0] - r, p[1] - t); X.ellipse(p[0], p[1] - t, r, r * flat, 0, Math.PI, 0, true); X.closePath(); X.fill();
  X.fillStyle = '#25282e'; X.beginPath(); X.ellipse(p[0], p[1] - t, r, r * flat, 0, 0, Math.PI * 2); X.fill();
  X.strokeStyle = 'rgba(255,255,255,.35)'; X.lineWidth = Math.max(1, r * 0.08);
  X.beginPath(); X.ellipse(p[0], p[1] - t, r * 0.92, r * flat * 0.92, 0, Math.PI + spin % (Math.PI * 2), Math.PI + 0.9 + spin % (Math.PI * 2)); X.stroke();
  // knurled edge ticks
  X.strokeStyle = 'rgba(255,255,255,.12)'; X.lineWidth = 1;
  for (let i = 0; i < 6; i++) { const a = spin + i * Math.PI / 3, c = Math.cos(a); if (Math.sin(a) < 0) continue; X.beginPath(); X.moveTo(p[0] + c * r, p[1] - t + Math.sin(a) * r * flat); X.lineTo(p[0] + c * r, p[1] + Math.sin(a) * r * flat); X.stroke(); }
}

/* Puck position for the current shot: release, then what happens after. */
function puckPos(now) {
  const s = G.shot;
  const rest = { x: -0.02, y: PUCK_T / 2, z: 0, spin: now / 900, tilt: 0 };
  if (!s) return rest;
  const t = clamp((now - s.t0) / s.dur, 0, 1);
  if (!s.hitAt) {
    return {
      x: s.ex * t, z: s.ez * t,
      y: lerp(PUCK_T / 2, s.ey, t) + s.arc * 4 * t * (1 - t),
      spin: (now - s.t0) / 25, tilt: 0.05
    };
  }
  const k = clamp((now - s.hitAt) / 700, 0, 1), e = 1 - (1 - k) * (1 - k);
  const ice = v => Math.max(PUCK_T / 2, v);
  const spin = (s.hitAt - s.t0) / 25 + k * 8;
  switch (s.res.result) {
    case 'goal': return { x: s.ex * (1 - 0.15 * e), z: Z + 0.75 * e, y: ice(s.ey * (1 - k * k)), spin, tilt: 0.3 * (1 - k) };
    case 'saved': {
      const side = Math.sign(s.ex - G.goalie.x * HW) || G.goalie.lean;
      return { x: s.ex + side * 1.4 * e, z: s.ez - 2.2 * e, y: ice(s.ey + 0.5 * k - 1.8 * k * k), spin, tilt: 0.4 };
    }
    case 'post': return { x: s.ex - Math.sign(s.ex) * 1.5 * e, z: Z - 2.4 * e, y: ice(s.ey + 0.3 * k - 1.3 * k * k), spin, tilt: 0.3 };
    case 'bar': return { x: s.ex * (1 - 0.2 * e), z: Z - 2 * e, y: ice(s.ey + 0.9 * k - 2.4 * k * k), spin, tilt: 0.5 };
    default: { // wide / over: carry on to the boards or the glass, then drop
      const vx = s.ex / Z, vy = (s.ey - PUCK_T / 2) / Z;
      const d = B - 0.1 - Z, hitT = 0.45;
      if (k < hitT) { const f = k / hitT; return { x: s.ex + vx * d * f, z: Z + d * f, y: s.ey + vy * d * f, spin, tilt: 0.2 }; }
      const f = (k - hitT) / (1 - hitT);
      const hy = s.ey + vy * d;
      return { x: s.ex + vx * d + vx * 0.8 * f, z: B - 0.1 - 1.2 * f, y: ice(hy + 0.2 * f - hy * f * f * 1.4), spin, tilt: 0.4 };
    }
  }
}

function drawShot(now, layer) {
  const b = puckPos(now);
  const l = b.z > Z - 0.08 ? 'back' : 'front';
  if (l !== layer) return;
  // a short streak behind a fast puck
  const s = G.shot;
  if (s && !s.hitAt && G.phase === 'flight') {
    const t = clamp((now - s.t0) / s.dur, 0, 1), tb = Math.max(0, t - 0.18);
    const a = P(s.ex * tb, lerp(PUCK_T / 2, s.ey, tb) + s.arc * 4 * tb * (1 - tb), s.ez * tb), c = P(b.x, b.y, b.z);
    const gr = X.createLinearGradient(a[0], a[1], c[0], c[1]);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.55)');
    X.strokeStyle = gr; X.lineWidth = Math.max(2, c[2] * PUCK_R * 1.2); X.lineCap = 'round';
    X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(c[0], c[1]); X.stroke();
  }
  drawPuck(b.x, b.y, b.z, b.spin, b.tilt);
}

function stepShot(now) {
  const s = G.shot;
  if (!s || s.hitAt || G.phase !== 'flight') return;
  if (now - s.t0 >= s.dur) { s.hitAt = now; resolve(now); }
}

/* Spray of ice off the goalie or the posts. */
function drawSpray(now) {
  const s = G.shot;
  if (!s || !s.hitAt) return;
  const k = (now - s.hitAt) / 450;
  if (k > 1 || !['saved', 'post', 'bar'].includes(s.res.result)) return;
  const rng = mulberry32(s.t0 | 0);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, v = 0.2 + rng() * 0.5;
    const p = P(s.ex + Math.cos(a) * v * k, s.ey + Math.sin(a) * v * k * 0.8, s.ez - 0.1);
    X.fillStyle = `rgba(255,255,255,${(1 - k) * 0.8})`;
    X.beginPath(); X.arc(p[0], p[1], Math.max(1, p[2] * 0.012), 0, Math.PI * 2); X.fill();
  }
}

/* ---------- Meters: aim bar (bottom) and power bar (right) ---------- */
const SEG = {
  wide: 'rgba(255,138,122,.3)', over: 'rgba(255,138,122,.3)',
  goalie: 'rgba(255,138,122,.8)', saved: 'rgba(255,138,122,.8)',
  post: '#ffd34d', bar: '#ffd34d',
  open: 'rgba(143,224,160,.6)', corner: '#ffb547', topShelf: '#ffb547', fiveHole: '#6ec8ff'
};
const KIND_WORD = { wide: 'Wide', post: 'Post', goalie: 'Goalie', corner: 'Top shelf line', fiveHole: 'Five-hole line', open: 'Open' };
function drawMeters(now) {
  if (!['aim', 'power', 'flight', 'result'].includes(G.phase)) return;
  const bw = Math.min(440, W * 0.82), bx = (W - bw) / 2, by = L.by, bh = 16;
  // aim
  ctx.fillStyle = 'rgba(9,16,26,.84)'; X = ctx; roundRect(bx - 10, by - 30, bw + 20, bh + 50, 10); ctx.fill();
  for (const sg of G.aimSegs) { ctx.fillStyle = SEG[sg.kind]; ctx.fillRect(bx + sg.start * bw, by, (sg.end - sg.start) * bw + 0.5, bh); }
  const av = G.aimRes ? G.aimRes.value : aimMeter.value(now);
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
  ctx.fillRect(bx + av * bw - 2, by - 9, 4, bh + 18); ctx.shadowBlur = 0;
  const lockedKind = G.aimRes ? (G.aimSegs.find(sg => av >= sg.start && av <= sg.end) || {}).kind : null;
  label(G.phase === 'aim' ? 'Aim: green scores, gold is top shelf' : KIND_WORD[lockedKind] || '', W / 2, by - 12);
  // power: segments for the column the needle is on (live while aiming)
  const { px, py, ph } = L, pw = 18;
  const x = G.aimRes ? G.aimX : aimToX(av);
  ctx.fillStyle = 'rgba(9,16,26,.84)'; roundRect(px - 10, py - 30, pw + 20, ph + 40, 10); ctx.fill();
  for (const sg of powerSegments(x, G.goalie)) {
    ctx.fillStyle = SEG[sg.kind] || SEG.wide;
    ctx.fillRect(px, py + (1 - sg.end) * ph, pw, (sg.end - sg.start) * ph + 0.5);
  }
  const pv = G.powRes ? G.powRes.value : G.phase === 'power' ? powMeter.value(now) : 0;
  ctx.fillStyle = 'rgba(241,236,224,.55)'; ctx.fillRect(px + 5, py + (1 - pv) * ph, pw - 10, pv * ph);
  ctx.fillStyle = '#fff'; ctx.fillRect(px - 5, py + (1 - pv) * ph - 2, pw + 10, 4);
  ctx.save(); ctx.font = '700 12px Barlow, sans-serif'; ctx.fillStyle = 'rgba(241,236,224,.75)'; ctx.textAlign = 'center';
  ctx.fillText('Power', px + pw / 2, py - 12); ctx.restore();
  if (G.phase === 'power' && powMeter.expired(now)) { G.powRes = powMeter.stop(now); shoot(now, 1); }
}
function label(text, x, y) {
  if (!text) return;
  ctx.save(); ctx.font = '800 18px "Big Shoulders Display", sans-serif'; ctx.fillStyle = '#f1ece0'; ctx.textAlign = 'center';
  ctx.fillText(text, x, y); ctx.restore();
}

/* ---------- Loop ---------- */
function update(now) {
  if (G.clock != null) now = G.clock;
  if (G.phase === 'idle') { G.goalie = DEMO_GOALIE; G.shot = null; }
  X = ctx;
  layout();
  stepShot(now);
  drawRinkCached();
  drawLamp(now);
  drawNetBack(now);
  drawShot(now, 'back');
  drawTargets(now);
  drawFrame(now);
  drawGoalie(now);
  drawFiveHint(now);
  drawSpray(now);
  drawShot(now, 'front');
  drawShooter(now);
  drawMeters(now);
  if (G.phase === 'result' && !G.freeze && now - G.t0 > C.resultSecs * 1000) {
    if (G.hearts <= 0) finish(); else setupShot(now);
  }
}
function frame(now) { update(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
if (REDUCE) C.flightSecs *= 0.8;

/* Test hook for local dev only. ?shot=aim|power|<x>,<y> starts a run and
   stops at that point; &gx=, &five=0|1 and &scale= pin the goalie. */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.__game = { G, aimMeter, powMeter, tap, step: update };
  const q = new URLSearchParams(location.search), want = q.get('shot');
  if (want) {
    setTimeout(() => {
      document.getElementById('play').click();
      const pin = () => {
        if (q.has('gx')) G.goalie.x = +q.get('gx');
        if (q.has('five')) G.goalie.fiveOpen = q.get('five') === '1';
        if (q.has('scale')) G.goalie.scale = +q.get('scale');
        G.aimSegs = aimSegments(G.goalie);
      };
      pin();
      setInterval(() => update(performance.now()), 40);   // headless Chrome is stingy with frames
      if (want === 'aim') return;
      setTimeout(() => {
        if (want === 'power') { tap(performance.now()); G.clock = performance.now() + 450; return; }
        const [sx, sy] = want.split(',').map(Number), mid = q.has('mid') ? +q.get('mid') : null;
        const now = performance.now();
        G.aimRes = { value: xToAim(sx) }; G.aimX = sx; G.freeze = true;
        G.powRes = { value: yToPower(sy) };
        shoot(now, yToPower(sy));
        const s = G.shot;
        if (mid != null) { s.t0 = now - s.dur * mid; G.clock = now; return; }
        s.t0 = now - s.dur - 900; s.hitAt = now - 900; resolve(now);
        G.clock = now; G.lampAt = G.shot.res.result === 'goal' ? now - 120 : G.lampAt;
      }, 400);
    }, 300);
  }
}
