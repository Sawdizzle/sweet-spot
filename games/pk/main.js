/* Sweet Spot PK Shootout.
   Two taps per kick: lock the aim needle across the goal, then the power
   meter, which sets the height. The keeper takes a new spot every kick
   and stands still while you shoot. Outcome math lives in logic.js. */
import { clamp, lerp, REDUCE, TOUCH } from '../../core/util.js';
import { dailyRng, mulberry32 } from '../../core/seed/seed.js';
import { createMeter } from '../../core/meter/meter.js';
import { nz, tn, coreSfx } from '../../core/audio/audio.js';
import { mountShell } from '../../core/ui/shell.js';
import C from './config.js';
import { aimToX, powerToY, rollKeeper, resolveShot, isMiss, aimSegments, powerSegments, keeperHalf, shareText } from './logic.js';

/* ---------- Sound ---------- */
const sfx = {
  ...coreSfx,
  kick() { nz({ dur: 0.08, type: 'lowpass', f: 600, g: 0.8, a: 0.001 }); tn({ f: 96, f2: 48, dur: 0.14, type: 'triangle', g: 0.55, a: 0.001 }); },
  net() { nz({ dur: 0.35, type: 'highpass', f: 2600, g: 0.12, a: 0.01 }); nz({ dur: 0.5, f: 1400, q: 0.5, g: 0.1, a: 0.02, delay: 0.03 }); },
  crowd(big) { nz({ dur: big ? 3 : 1.9, f: 900, q: 0.6, g: big ? 0.3 : 0.17, a: 0.2, delay: 0.08 }); nz({ dur: big ? 2.6 : 1.5, f: 2400, q: 0.7, g: 0.06, a: 0.2, delay: 0.08 }); },
  save() { nz({ dur: 0.07, f: 1700, q: 1.4, g: 0.55, a: 0.001 }); tn({ f: 240, f2: 120, dur: 0.1, type: 'triangle', g: 0.3, a: 0.001 }); },
  clang() { tn({ f: 1480, dur: 0.9, type: 'triangle', g: 0.16, a: 0.001 }); tn({ f: 2230, dur: 0.6, type: 'sine', g: 0.08, a: 0.001 }); tn({ f: 980, dur: 0.5, type: 'sine', g: 0.06, a: 0.001 }); },
  groan() { nz({ dur: 1.4, type: 'lowpass', f: 600, f2: 260, g: 0.14, a: 0.15 }); }
};

/* ---------- Shell ---------- */
const fmtP = v => v.toLocaleString() + ' pts';
const shell = mountShell({
  game: 'pk', name: 'PK Shootout', titleHtml: 'PK<br>Shootout',
  lede: 'Lock your aim across the goal, then set the power: more power sends the ball higher. Low shots score 1, upper corners score 3, and the keeper moves before every kick.',
  rules: [
    ['Aim', 'Tap when the needle sits on green or gold. Red is the keeper.'],
    ['Power', 'Tap again to set the height. Gold is a top corner. Too much sails over the bar.'],
    ['Misses', 'Saved, wide or over costs a heart. Every 5 goals the keeper gets bigger.']
  ],
  modes: [
    { id: 'classic', label: 'Classic', note: 'The keeper takes a new spot before every kick.' },
    { id: 'daily', label: 'Daily challenge', board: 'classic', daily: true, note: 'Everyone faces the same keeper spots today.' }
  ],
  hud: [
    { id: 'score', label: 'Points' },
    { id: 'goals', label: 'Goals' },
    { hearts: true, label: 'Misses left' },
    { id: 'corners', label: 'Top corners', amber: true }
  ],
  boards: [
    { id: 'today', label: 'Today', mode: 'classic', period: 'daily', note: 'Same keeper spots for everyone. Resets at midnight UTC.', empty: 'No one has taken today’s penalties yet.' },
    { id: 'all', label: 'All-time', mode: 'classic', period: 'all', note: 'Most points in one run.' }
  ],
  hearts: C.hearts, playLabel: 'Step up', againLabel: 'Shoot again',
  fmt: fmtP,
  share: shareText,
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
const DEMO_KEEPER = { x: 0.22, half: C.keeper.half, reach: C.keeper.reach, lean: 1 };
const G = {
  phase: 'idle',               // idle | aim | power | flight | result | over
  rng: Math.random, daily: false,
  score: 0, goals: 0, corners: 0, kicks: 0, hearts: C.hearts, streak: 0, bestStreak: 0,
  keeper: DEMO_KEEPER, aimSegs: [], aimRes: null, powRes: null, aimX: 0,
  shot: null, t0: 0
};
const aimMeter = createMeter({ orientation: 'horizontal', speed: C.aim.speed, zones: [] });
const powMeter = createMeter({ orientation: 'vertical', mode: 'fill', speed: 1 / C.power.fillSecs, zones: [] });

function setupKick(now) {
  G.keeper = rollKeeper(G.rng, G.goals);               // two draws every kick (daily determinism)
  G.aimSegs = aimSegments(G.keeper);
  aimMeter.configure({ speed: Math.min(C.aim.speedMax, C.aim.speed + C.aim.speedPerGoal * G.goals) });
  aimMeter.start(now); powMeter.reset();
  G.phase = 'aim'; G.aimRes = null; G.powRes = null; G.shot = null;
}

function startRun(mode) {
  G.daily = !!mode.daily;
  G.rng = G.daily ? dailyRng('pk') : mulberry32((Math.random() * 2 ** 32) >>> 0);
  Object.assign(G, { score: 0, goals: 0, corners: 0, kicks: 0, hearts: C.hearts, streak: 0, bestStreak: 0 });
  shell.set('score', 0); shell.set('goals', 0); shell.set('corners', 0); shell.hearts.set(G.hearts);
  setupKick(performance.now());
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

/* Work out where the ball goes, then animate it there. */
function shoot(now, p) {
  sfx.kick();
  const res = resolveShot(G.aimX, p, G.keeper);
  const hw = C.goal.halfWidthM, gh = C.goal.heightM;
  let ex = res.x * hw, ey = Math.max(0.11, res.y * gh), ez = 11;
  if (res.result === 'weak') { ex = G.keeper.x * hw * 0.85; ey = 0.11; ez = 10.3; }
  else if (res.result === 'saved') ez = 10.55;
  else if (res.result === 'post') ex = Math.sign(res.x) * hw;
  else if (res.result === 'bar') ey = gh;
  const weak = res.result === 'weak';
  G.shot = {
    t0: now, dur: (weak ? C.weakSecs : C.flightSecs * (0.85 + 0.25 * Math.abs(res.x))) * 1000,
    res, ex, ey, ez, weak, arc: weak ? 0 : 0.25 + 0.2 * clamp(res.y, 0, 1), hitAt: 0
  };
  G.phase = 'flight';
}

function placeWord(x, y) {
  const side = x < -0.33 ? 'left' : x > 0.33 ? 'right' : 'center';
  const h = y < 0.4 ? 'Low ' : y > C.goal.cornerY ? 'High ' : '';
  const s = h + side;
  return s[0].toUpperCase() + s.slice(1);
}

function resolve(now) {
  const r = G.shot.res;
  G.kicks++;
  if (r.result === 'goal') {
    const before = keeperHalf(G.goals);
    G.score += r.points; G.goals++; G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak);
    if (r.corner) G.corners++;
    const grows = keeperHalf(G.goals) > before;
    shell.set('score', G.score.toLocaleString(), { pulse: true });
    shell.set('goals', G.goals);
    if (r.corner) shell.set('corners', G.corners, { pulse: true });
    const sub = `${r.corner ? 'Upper ' + (r.x < 0 ? 'left' : 'right') : placeWord(r.x, r.y)}<b>+${r.points}</b>${grows ? '<br>The keeper gets bigger' : ''}`;
    shell.callout(r.corner ? 'Top corner!' : 'Goal!', sub, r.corner ? 'gold' : 'good');
    sfx.net(); sfx.crowd(r.corner);
    if (r.corner) sfx.perfect();
  } else if (!isMiss(r.result)) {
    G.streak = 0;
    sfx.clang();
    shell.callout(r.result === 'bar' ? 'Off the bar' : 'Off the post', 'No harm done.', '');
  } else {
    G.streak = 0;
    G.hearts--; shell.hearts.set(G.hearts);
    if (r.result === 'saved' || r.result === 'weak') sfx.save(); else if (r.result === 'post' || r.result === 'bar') sfx.clang();
    sfx.heartLost(); sfx.groan();
    const head = { saved: 'Saved', weak: 'Too soft', wide: r.x < 0 ? 'Wide left' : 'Wide right', over: 'Over the bar', post: 'Off the post', bar: 'Off the bar' }[r.result];
    shell.callout(head, G.hearts > 0 ? `${G.hearts} miss${G.hearts === 1 ? '' : 'es'} left` : 'That’s the run', 'bad');
  }
  G.phase = 'result'; G.t0 = now;
}

function finish() {
  G.phase = 'over';
  const s = n => n === 1 ? '' : 's';
  shell.gameOver({
    score: G.score,
    head: 'Out of misses',
    line: G.corners ? `${G.corners} top corner${s(G.corners)}` : G.goals ? `${G.goals} goal${s(G.goals)}, no top corners` : 'No goals this time',
    stats: [['Goals', `${G.goals}/${G.kicks}`], ['Top corners', G.corners], ['Best streak', G.bestStreak], ['Keeper size', `${Math.round(keeperHalf(G.goals) * 100)}%`]],
    meta: { goals: G.goals, corners: G.corners, kicks: G.kicks }
  });
}

/* ---------- Layout + projection ----------
   World: x = meters right of the goal's center, y = meters up,
   z = meters toward the goal from the penalty spot (goal line at z = 11).
   The goal gets a set share of the screen; the camera height is then picked
   so the ball sits just above the aim bar. */
const L = { by: 0, px: 0, py: 0, ph: 0, gy: 0, sg: 1 };
const cam = { c: 8, y: 2, f: 600, hy: 300 };
function layout() {
  const hud = document.getElementById('hud');
  const hudB = hud ? hud.getBoundingClientRect().bottom : 90;
  const phone = W < 640;
  L.by = H - (TOUCH ? 150 : 104);
  L.ph = clamp(Math.min(300, H * 0.42, L.by - 80 - hudB), 80, 300);
  L.py = L.by - 40 - L.ph;
  L.px = W - (phone ? 34 : 70);
  const gw = W * (phone ? 0.74 : 0.6);
  const ghPx = Math.min(gw / 3, H * 0.26);
  const top = Math.max(hudB + 34, H * (phone ? 0.24 : 0.16));
  L.gy = top + ghPx;
  L.sg = ghPx / C.goal.heightM;
  const ballY = L.by - 64;
  cam.f = L.sg * (11 + cam.c);
  cam.y = clamp((ballY - L.gy) * cam.c / (11 * L.sg), 0.8, 5);
  cam.hy = L.gy - cam.y * L.sg;
}
const P = (x, y, z) => {
  const dz = Math.max(0.4, z + cam.c);
  const s = cam.f / dz;
  return [W / 2 + x * s, cam.hy + (cam.y - y) * s, s];
};
/* Goal-space point (x -1..1, y 0..1) on the goal line. */
const GP = (x, y) => P(x * C.goal.halfWidthM, y * C.goal.heightM, 11);

/* ---------- Drawing ---------- */
function poly(pts, fill) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function groundLine(x1, z1, x2, z2) {
  const zmin = -cam.c + 0.6;
  if (z1 < zmin && z2 < zmin) return;
  if (z1 < zmin) { const t = (zmin - z1) / (z2 - z1); x1 = lerp(x1, x2, t); z1 = zmin; }
  if (z2 < zmin) { const t = (zmin - z2) / (z1 - z2); x2 = lerp(x2, x1, t); z2 = zmin; }
  const a = P(x1, 0, z1), b = P(x2, 0, z2);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

function drawScene(now) {
  // sky + lights
  const sky = ctx.createLinearGradient(0, 0, 0, L.gy);
  sky.addColorStop(0, '#050b08'); sky.addColorStop(1, '#13261d');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const wallZ = 20, wallTop = P(0, 9, wallZ)[1], wallBot = P(0, 0, wallZ)[1];
  for (const lx of [0.1, 0.9]) {
    const ly = Math.max(16, wallTop - 30);
    const g = ctx.createRadialGradient(W * lx, ly, 2, W * lx, ly, W * 0.35);
    g.addColorStop(0, 'rgba(255,240,200,.35)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, wallBot);
    ctx.fillStyle = '#fff8e0'; ctx.fillRect(W * lx - 14, ly - 5, 28, 10);
  }
  // stand behind the goal
  ctx.fillStyle = '#0d1813'; ctx.fillRect(0, wallTop, W, wallBot - wallTop + 1);
  const sh = wallBot - wallTop;
  for (let i = 0; i < 220; i++) {
    const sx = (i * 97.3) % W, sy = wallTop + 4 + ((i * 37.7) % Math.max(4, sh * 0.8));
    ctx.fillStyle = i % 9 === 0 ? 'rgba(210,58,46,.35)' : i % 7 === 0 ? 'rgba(255,181,71,.25)' : 'rgba(241,236,224,.12)';
    ctx.fillRect(sx, sy, 2, 2);
  }
  // plain boards along the front of the stand
  const bTop = P(0, 0.9, 19)[1], bBot = P(0, 0, 19)[1];
  ctx.fillStyle = '#143b2d'; ctx.fillRect(0, bTop, W, bBot - bTop);
  ctx.fillStyle = 'rgba(241,236,224,.18)'; ctx.fillRect(0, bTop + (bBot - bTop) * 0.45, W, Math.max(1, (bBot - bTop) * 0.1));
  // grass in mowing stripes
  ctx.fillStyle = '#1d4a31'; ctx.fillRect(0, bBot, W, H - bBot);
  for (let z = 19; z > -cam.c + 0.5; z -= 2) {
    const z0 = Math.max(z - 2, -cam.c + 0.5);
    poly([P(-60, 0, z), P(60, 0, z), P(60, 0, z0), P(-60, 0, z0)], Math.round(z / 2) % 2 ? '#22573a' : '#1f5135');
  }
  // markings: goal line, six-yard box, penalty area, spot, arc
  ctx.strokeStyle = 'rgba(241,236,224,.6)'; ctx.lineWidth = 1.5;
  groundLine(-40, 11, 40, 11);
  for (const [hx, d] of [[9.16, 5.5], [20.16, 16.5]]) {
    groundLine(-hx, 11, -hx, 11 - d); groundLine(hx, 11, hx, 11 - d); groundLine(-hx, 11 - d, hx, 11 - d);
  }
  let prev = null;
  for (let a = -0.93; a <= 0.93; a += 0.06) {             // the D outside the box, radius 9.15 from the spot
    const pt = [Math.sin(a) * 9.15, -Math.cos(a) * 9.15];
    if (prev) groundLine(prev[0], prev[1], pt[0], pt[1]);
    prev = pt;
  }
  const spot = P(0, 0, 0);
  ctx.fillStyle = 'rgba(241,236,224,.8)'; ctx.beginPath(); ctx.ellipse(spot[0], spot[1], spot[2] * 0.12, spot[2] * 0.04, 0, 0, Math.PI * 2); ctx.fill();
}

function drawNet(now) {
  const hw = C.goal.halfWidthM, h = C.goal.heightM, zb = 13, zt = 12.2;
  const s = G.shot, shake = s && s.res.result === 'goal' && s.hitAt ? Math.max(0, 1 - (now - s.hitAt) / 600) : 0;
  const wob = t => shake * Math.sin(now / 30 + t * 9) * 0.12;
  poly([P(-hw, 0, zb), P(hw, 0, zb), P(hw, h, zt), P(-hw, h, zt)], 'rgba(241,236,224,.05)');
  ctx.strokeStyle = 'rgba(241,236,224,.22)'; ctx.lineWidth = 1;
  for (let x = -hw; x <= hw + 0.01; x += 0.3) {           // back netting
    const a = P(x, 0, zb + wob(x)), b = P(x, h, zt + wob(x));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  for (let t = 0; t <= 1.001; t += 0.12) {
    const y = h * t, z = lerp(zb, zt, t);
    const a = P(-hw, y, z + wob(t)), b = P(hw, y, z + wob(t));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  for (const sx of [-hw, hw]) {                             // side netting
    for (let t = 0; t <= 1.001; t += 0.25) {
      const a = P(sx, h * t, 11), b = P(sx, h * t, lerp(zb, zt, t));
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  for (let x = -hw; x <= hw + 0.01; x += 0.6) {             // roof
    const a = P(x, h, 11), b = P(x, h, zt);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
}

function drawFrame(now) {
  const hw = C.goal.halfWidthM, h = C.goal.heightM;
  const s = G.shot, hit = s && (s.res.result === 'post' || s.res.result === 'bar') && s.hitAt ? Math.max(0, 1 - (now - s.hitAt) / 500) : 0;
  const jig = hit * Math.sin(now / 18) * 0.03;
  const l0 = P(-hw, 0, 11), l1 = P(-hw - jig, h, 11), r0 = P(hw, 0, 11), r1 = P(hw + jig, h, 11);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = Math.max(3, l0[2] * 0.12);
  ctx.shadowColor = 'rgba(255,255,255,.35)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.lineTo(r1[0], r1[1]); ctx.lineTo(r0[0], r0[1]); ctx.stroke();
  ctx.shadowBlur = 0;
}

/* Target areas painted on the goal mouth while you aim. */
function drawTargets(now) {
  if (!['aim', 'power'].includes(G.phase)) return;
  const g = C.goal, k = G.keeper;
  const rect = (x0, y0, x1, y1, fill, stroke) => {
    const a = GP(x0, y1), b = GP(x1, y0);
    ctx.fillStyle = fill; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
  };
  rect(-1 + g.post, 0, 1 - g.post, 1 - g.bar, 'rgba(143,224,160,.07)');
  const pulse = 0.22 + 0.08 * Math.sin(now / 220);
  for (const sgn of [-1, 1]) {
    const x0 = sgn < 0 ? -1 + g.post : g.cornerX, x1 = sgn < 0 ? -g.cornerX : 1 - g.post;
    rect(x0, g.cornerY, x1, 1 - g.bar, `rgba(255,181,71,${pulse})`, 'rgba(255,181,71,.8)');
  }
  rect(k.x - k.half, 0, k.x + k.half, k.reach, 'rgba(255,138,122,.22)', 'rgba(255,138,122,.55)');
  // the needle's line through the goal, and the height dot while powering
  const x = G.phase === 'aim' ? aimToX(aimMeter.value(now)) : G.aimX;
  const top = GP(x, 1.25), bot = GP(x, 0);
  ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(bot[0], bot[1]); ctx.stroke(); ctx.restore();
  if (G.phase === 'power') {
    const p = powMeter.value(now), y = p < C.power.weak ? 0 : powerToY(p);
    const d = GP(x, y), r = resolveShot(x, p, k);
    ctx.fillStyle = r.result === 'goal' ? (r.corner ? '#ffb547' : '#8fe0a0') : '#ff8a7a';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(d[0], d[1], Math.max(5, d[2] * 0.16), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

function drawKeeper(now) {
  const k = G.keeper, hw = C.goal.halfWidthM, h = C.goal.heightM, z = 10.7;
  const cx = k.x * hw, half = k.half * hw, reach = k.reach * h;
  const s = G.shot, saving = s && s.hitAt && (s.res.result === 'saved' || s.res.result === 'weak');
  const idle = Math.sin(now / 330) * 0.03;
  const at = (dx, y) => P(cx + dx, y, z);
  const base = at(0, 0), u = base[2];
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(base[0], base[1], half * u * 0.7, u * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round';
  const limb = (a, b, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, w * u); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  const hip = 0.95 + idle, sh = 1.5 + idle, headY = 1.78 + idle;
  // legs spread, knees bent
  for (const sgn of [-1, 1]) {
    limb(at(sgn * 0.12, hip), at(sgn * half * 0.32, 0.5), 0.17, '#1a1f2a');
    limb(at(sgn * half * 0.32, 0.5), at(sgn * half * 0.42, 0.05), 0.15, '#1a1f2a');
    const f = at(sgn * half * 0.45, 0.03);
    ctx.fillStyle = '#0a0d12'; ctx.beginPath(); ctx.ellipse(f[0], f[1], u * 0.13, u * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  }
  // shorts + jersey
  poly([at(-0.24, hip + 0.18), at(0.24, hip + 0.18), at(0.26, hip - 0.12), at(-0.26, hip - 0.12)], '#1a1f2a');
  poly([at(-0.28, sh + 0.05), at(0.28, sh + 0.05), at(0.24, hip + 0.12), at(-0.24, hip + 0.12)], '#e9a93a');
  ctx.strokeStyle = 'rgba(11,22,17,.5)'; ctx.lineWidth = Math.max(1, u * 0.04);
  const c0 = at(-0.26, sh - 0.12), c1 = at(0.26, sh - 0.12);
  ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.stroke();
  // arms out to the edges of his box, gloves at the corners
  for (const sgn of [-1, 1]) {
    const flinch = saving && sgn === k.lean ? 0.12 : 0;
    const handX = sgn * (half - 0.08), handY = reach - 0.12 + flinch;
    const elbow = at(sgn * (0.28 + (half - 0.28) * 0.5), lerp(sh, handY, 0.4));
    limb(at(sgn * 0.26, sh), elbow, 0.13, '#e9a93a');
    limb(elbow, at(handX, handY), 0.11, '#e9a93a');
    const g = at(handX, handY);
    ctx.fillStyle = '#f1ece0'; ctx.beginPath(); ctx.arc(g[0], g[1], Math.max(3, u * 0.12), 0, Math.PI * 2); ctx.fill();
  }
  // head
  const hd = at(0, headY);
  ctx.fillStyle = '#b07a52'; ctx.beginPath(); ctx.arc(hd[0], hd[1], u * 0.13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a1c14'; ctx.beginPath(); ctx.arc(hd[0], hd[1] - u * 0.03, u * 0.13, Math.PI, Math.PI * 2); ctx.fill();
}

function drawShooter() {
  const x0 = -1.35, z = -1.3;            // off to the left so his head clears the goal mouth
  const at = (dx, y) => P(x0 + dx, y, z);
  const base = at(0, 0), u = base[2];
  if (base[1] > H + 40) return;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(base[0], base[1], u * 0.35, u * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round';
  const kicked = G.shot ? 1 : 0;
  const limb = (a, b, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, w * u); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  limb(at(-0.1, 0.9), at(-0.13, 0.05), 0.15, '#e6e1d6');                 // standing leg (socks)
  limb(at(0.1, 0.9), at(0.16 + kicked * 0.25, 0.08 + kicked * 0.25), 0.15, '#e6e1d6');
  poly([at(-0.22, 1.0), at(0.22, 1.0), at(0.24, 0.72), at(-0.24, 0.72)], '#f1ece0');   // shorts
  poly([at(-0.25, 1.48), at(0.25, 1.48), at(0.22, 0.96), at(-0.22, 0.96)], '#b0352c'); // jersey, back view
  limb(at(-0.24, 1.42), at(-0.42, 1.0), 0.1, '#b0352c');
  limb(at(0.24, 1.42), at(0.42 + kicked * 0.1, 1.05), 0.1, '#b0352c');
  const num = at(0, 1.2);
  ctx.save(); ctx.fillStyle = '#f1ece0'; ctx.font = `800 ${Math.max(8, u * 0.32)}px "Big Shoulders Display", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('9', num[0], num[1]); ctx.restore();
  const hd = at(0, 1.62);
  ctx.fillStyle = '#3a2618'; ctx.beginPath(); ctx.arc(hd[0], hd[1], u * 0.12, 0, Math.PI * 2); ctx.fill();
}

function drawBall(x, y, z, spin) {
  const sh = P(x, 0, z), p = P(x, y, z), r = Math.max(2.5, p[2] * 0.11);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(sh[0], sh[1], r * 0.9, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(spin);
  ctx.fillStyle = '#f4f1ea'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1b2420';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36); }
  ctx.closePath(); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 + Math.PI / 2;
    ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* Ball position for the current shot: approach, then what happens after. */
function ballPos(now) {
  const s = G.shot;
  if (!s) return { x: 0, y: 0.11, z: 0, spin: 0 };
  const t = clamp((now - s.t0) / s.dur, 0, 1);
  if (!s.hitAt) {
    const zt = s.weak ? 1 - (1 - t) * (1 - t) : t;
    return {
      x: s.ex * zt, z: s.ez * zt,
      y: lerp(0.11, s.ey, t) + s.arc * 4 * t * (1 - t),
      spin: (now - s.t0) / (s.weak ? 140 : 45)
    };
  }
  const k = clamp((now - s.hitAt) / 700, 0, 1), e = 1 - (1 - k) * (1 - k);
  const ground = v => Math.max(0.11, v);
  const spin = (s.hitAt - s.t0) / 45 + k * 6;
  switch (s.res.result) {
    case 'goal': return { x: s.ex, z: 11 + 1.6 * e, y: ground(s.ey - s.ey * k * k), spin };
    case 'saved': return { x: s.ex + G.keeper.lean * 1.6 * e, z: 10.55 - 3 * e, y: ground(s.ey + 1.2 * k - 3 * k * k), spin };
    case 'weak': return { x: s.ex, z: s.ez, y: 0.11, spin: (s.hitAt - s.t0) / 140 };
    case 'post': return { x: s.ex - Math.sign(s.ex) * 1.3 * e, z: 11 - 2.6 * e, y: ground(s.ey + 0.5 * k - 2 * k * k), spin };
    case 'bar': return { x: s.ex * (1 - 0.2 * e), z: 11 - 2.2 * e, y: ground(s.ey + 1.4 * k - 3.6 * k * k), spin };
    default: { // wide / over: carry on into the stand
      const vx = s.ex / 11, vy = (s.ey - 0.11) / 11 + 0.05;
      return { x: s.ex + vx * 7 * e, z: 11 + 7 * e, y: s.ey + vy * 7 * e, spin };
    }
  }
}

function drawShot(now, behindGoal) {
  const b = ballPos(now);
  const inBack = b.z > 10.75;
  if (inBack !== behindGoal) return;
  drawBall(b.x, b.y, b.z, b.spin);
}

function stepShot(now) {
  const s = G.shot;
  if (!s || s.hitAt || G.phase !== 'flight') return;
  if (now - s.t0 >= s.dur) { s.hitAt = now; resolve(now); }
}

/* Aim bar (bottom) and power bar (right). */
const SEG = {
  wide: 'rgba(255,138,122,.3)', over: 'rgba(255,138,122,.3)', weak: 'rgba(255,138,122,.3)',
  keeper: 'rgba(255,138,122,.8)', saved: 'rgba(255,138,122,.8)',
  post: '#ffd34d', bar: '#ffd34d',
  open: 'rgba(143,224,160,.6)', corner: '#ffb547'
};
const KIND_WORD = { wide: 'Wide', post: 'Post', keeper: 'Keeper', corner: 'Corner line', open: 'Open' };
function drawMeters(now) {
  if (!['aim', 'power', 'flight', 'result'].includes(G.phase)) return;
  const bw = Math.min(440, W * 0.82), bx = (W - bw) / 2, by = L.by, bh = 16;
  // aim
  ctx.fillStyle = 'rgba(9,22,16,.82)'; roundRect(bx - 10, by - 30, bw + 20, bh + 50, 10); ctx.fill();
  for (const sg of G.aimSegs) { ctx.fillStyle = SEG[sg.kind]; ctx.fillRect(bx + sg.start * bw, by, (sg.end - sg.start) * bw + 0.5, bh); }
  const av = G.aimRes ? G.aimRes.value : aimMeter.value(now);
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
  ctx.fillRect(bx + av * bw - 2, by - 9, 4, bh + 18); ctx.shadowBlur = 0;
  const lockedKind = G.aimRes ? (G.aimSegs.find(sg => av >= sg.start && av <= sg.end) || {}).kind : null;
  label(G.phase === 'aim' ? 'Aim: green scores, gold is a corner' : KIND_WORD[lockedKind] || '', W / 2, by - 12);
  // power: segments for the column the needle is on (live while aiming)
  const { px, py, ph } = L, pw = 18;
  const x = G.aimRes ? G.aimX : aimToX(av);
  ctx.fillStyle = 'rgba(9,22,16,.82)'; roundRect(px - 10, py - 30, pw + 20, ph + 40, 10); ctx.fill();
  for (const sg of powerSegments(x, G.keeper)) {
    ctx.fillStyle = SEG[sg.kind] || SEG.wide;
    ctx.fillRect(px, py + (1 - sg.end) * ph, pw, (sg.end - sg.start) * ph + 0.5);
  }
  const pv = G.powRes ? G.powRes.value : G.phase === 'power' ? powMeter.value(now) : 0;
  ctx.fillStyle = 'rgba(241,236,224,.55)'; ctx.fillRect(px + 5, py + (1 - pv) * ph, pw - 10, pv * ph);
  ctx.fillStyle = '#fff'; ctx.fillRect(px - 5, py + (1 - pv) * ph - 2, pw + 10, 4);
  ctx.save(); ctx.font = '700 12px Barlow, sans-serif'; ctx.fillStyle = 'rgba(241,236,224,.7)'; ctx.textAlign = 'center';
  ctx.fillText('Power', px + pw / 2, py - 12); ctx.restore();
  if (G.phase === 'power' && powMeter.expired(now)) { G.powRes = powMeter.stop(now); shoot(now, 1); }
}
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
  if (G.phase === 'idle') { G.keeper = DEMO_KEEPER; G.shot = null; }
  layout();
  stepShot(now);
  drawScene(now);
  drawNet(now);
  drawShot(now, true);
  drawTargets(now);
  drawFrame(now);
  drawKeeper(now);
  drawShot(now, false);
  drawShooter();
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
