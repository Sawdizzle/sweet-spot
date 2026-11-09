/* Sweet Spot Field Goal.
   Two taps per kick: lock the aim needle, then the power meter.
   Wind shifts the aim window and bends the ball in flight. */
import { clamp, lerp, REDUCE, TOUCH } from '../../core/util.js';
import { dailyRng, mulberry32 } from '../../core/seed/seed.js';
import { createMeter } from '../../core/meter/meter.js';
import { nz, tn, coreSfx } from '../../core/audio/audio.js';
import { mountShell } from '../../core/ui/shell.js';
import C from './config.js';
import { drawStadium, drawField, drawNet, drawHolder as artHolder, drawKicker, drawLineman, drawOfficial, drawBall as artBall, COL, applyTeam } from './art.js';

/* Local screenshot hook (localhost only): ?shot=aim|flight&dist=45&hash=L&touch=1&res=good&at=0.55 */
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const QS = LOCAL ? new URLSearchParams(location.search) : null;
const SHOT = QS && QS.get('shot') ? {
  mode: QS.get('shot'), dist: +QS.get('dist') || 0, hash: QS.get('hash'), touch: QS.get('touch') === '1',
  res: QS.get('res') || 'good', at: +QS.get('at') || 0.55, wind: QS.get('wind')
} : null;
const TL = TOUCH || !!(SHOT && SHOT.touch);            // touch layout

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
  onMenu() { G.phase = 'idle'; },
  colors: { label: 'Jersey', default: 'crimson' },
  onTeam(team) { applyTeam(team); bgKey = ''; }   // the cached stadium and field carry team paint
});
applyTeam(shell.team);

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
const V = { dist: 35, hash: 'M', kickAt: 0, powerAt: 0 };   // what the camera shows; holds through the result
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
  if (SHOT && SHOT.hash) G.hash = SHOT.hash;
  if (SHOT && SHOT.wind) { const [m, d] = SHOT.wind.split(',').map(Number); G.wind = { mph: m || 0, deg: d || 0 }; }
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
  V.dist = G.dist; V.hash = G.hash; V.kickAt = 0;
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
    V.powerAt = time;
    G.phase = 'power';
  } else if (G.phase === 'power') {
    G.powRes = powMeter.stop(time);
    kick(time);
  }
}

/* Work out where the ball goes, then animate it there. */
function kick(now, shank = false) {
  sfx.kick();
  V.kickAt = now;
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
  const top = 13.3, ballY = H * (TL ? 0.7 : 0.78), postTopY = H * (W < 640 ? 0.22 : 0.18);
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

/* ---------- Drawing ----------
   The sky, stands, field and net only change when the camera does, so they
   are drawn once per kick distance, hash and screen size into an offscreen
   canvas. Each frame blits that and adds the moving parts on top. */
const bg = document.createElement('canvas'), bgx = bg.getContext('2d');
let bgKey = '', crowdPts = [], fontsTick = 0;
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fontsTick++; });
const PH = { lastNow: 0, confetti: null, flashSeed: 0 };

function hudBottom() {
  const el = document.getElementById('hud');
  const r = el ? el.getBoundingClientRect() : null;
  return r && r.height ? r.bottom + 4 : 90;
}
function buildBackground(dist, hashX) {
  const key = [W, H, DPR, dist, hashX, TL, fontsTick].join('|');
  if (key === bgKey) return;
  bgKey = key;
  const t0 = performance.now();
  bg.width = Math.round(W * DPR); bg.height = Math.round(H * DPR);
  bgx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const zWall = dist + 7, wall = P(0, 0, zWall), wallTop = P(0, 1.5, zWall);
  const st = drawStadium(bgx, {
    W, H, baseY: wall[1], wallTop: wallTop[1], cx: wall[0], ppy: wall[2], dist,
    seed: 4242, hudSafe: Math.min(hudBottom(), wall[1] * 0.4), clearY: P(0, 13.33, dist)[1]
  });
  crowdPts = st.pts;
  drawField(bgx, { P, W, H, dist, zNear: cam.z + 2.5, zWall, hy: cam.hy });
  drawNet(bgx, P, dist);
  if (SHOT) window.__bgMs = Math.round(performance.now() - t0);
}

function drawScene(now) {
  const dist = V.dist, hashX = HASH_X[V.hash];
  setCamera(dist, hashX);
  buildBackground(dist, hashX);
  ctx.drawImage(bg, 0, 0, W, H);
  const f = G.flight, made = G.phase === 'result' && f && f.result === 'good';
  const flying = G.phase === 'flight';
  // crowd shimmer, busier while the ball is in the air and after a make
  if (!REDUCE) {
    const boost = made ? 0.25 : flying ? 0.12 : 0;
    for (const p of crowdPts) {
      const a = Math.sin(now * p.sp + p.p);
      if (a > 0.6 - boost) { ctx.fillStyle = `rgba(255,248,230,${Math.min(0.8, (a - 0.6 + boost) * 1.2)})`; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
    }
  }
  // camera flashes in the stands
  if ((made || flying) && crowdPts.length) {
    const slot = Math.floor(now / 60), n = made ? (REDUCE ? 2 : 6) : 1;
    for (let i = 0; i < n; i++) {
      const h = Math.abs(Math.sin(slot * 12.9898 + i * 78.233) * 43758.5453) % 1;
      if (!made && h > 0.4) continue;
      const p = crowdPts[Math.floor(h * crowdPts.length)], rr = 3 + p.s * 2;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 3);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.25, 'rgba(230,240,255,.5)'); g.addColorStop(1, 'rgba(230,240,255,0)');
      ctx.fillStyle = g; ctx.fillRect(p.x - rr * 3, p.y - rr * 3, rr * 6, rr * 6);
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(p.x - rr * 2, p.y - 0.5, rr * 4, 1); ctx.fillRect(p.x - 0.5, p.y - rr * 2, 1, rr * 4);
    }
  }
}

/* Players, officials, posts and ball, back to front. */
function drawActors(now) {
  const dist = V.dist, hashX = HASH_X[V.hash], f = G.flight;
  const ball = ballPos(now);
  const layers = [];
  const post = G.phase === 'flight' || G.phase === 'result';
  // officials under the uprights
  const offPose = !(G.phase === 'result' && f) ? 'down' : f.result === 'good' ? 'good' : 'wave';
  for (const sx of [-1, 1]) layers.push([dist + 0.8, () => { const p = P(sx * C.aim.postHalf, 0, dist + 0.8); drawOfficial(ctx, p[0], p[1], p[2], offPose, now + sx * 90); }]);
  layers.push([dist, () => drawPosts(now)]);
  // the line: rushers face us, blockers show their backs
  const rise = post ? clamp((now - V.kickAt) / 300, 0, 1) : 0;
  for (let i = -4; i <= 4; i++) {
    const z = 8.3 + (i % 2 ? 0.25 : 0), x = hashX + i * 1.12 + 0.3, up = post && Math.abs(i) <= 1;
    layers.push([z, () => { const p = P(x, 0, z); drawLineman(ctx, p[0], p[1], p[2], { away: true, rise, armsUp: up }); }]);
  }
  const nums = ['72', '65', '77', '51', '58', '61', '74', '88', '84'];
  for (let i = -4; i <= 4; i++) {
    const z = Math.abs(i) === 4 ? 6.4 : 7, x = hashX + i * (Math.abs(i) === 4 ? 1.15 : 0.98);
    layers.push([z, () => { const p = P(x, 0, z); drawLineman(ctx, p[0], p[1], p[2], { rise: rise * 0.4, num: nums[i + 4] }); }]);
  }
  layers.push([0.05, () => { const p = P(hashX - 0.55, 0, 0.05); artHolder(ctx, p[0], p[1], p[2], { hasBall: !f }); }]);
  if (!f) layers.push([0, () => { const p = P(hashX, 0.17, 0); artBall(ctx, p[0], p[1], p[2] * 0.17, 0, true); }]);
  const k = kickerPos(now, hashX);
  layers.push([k.z, () => { const p = P(k.x, 0, k.z); drawKicker(ctx, p[0], p[1], p[2], k); }]);
  if (ball) layers.push([ball.z > dist + 0.02 ? ball.z : Math.min(ball.z, dist - 0.01), () => drawBallFlight(ball, now)]);
  // ground shadow of the ball goes under everyone
  if (ball) {
    const sh = P(ball.x, 0, ball.z), hgt = Math.max(0, ball.y);
    const rr = sh[2] * (0.22 + hgt * 0.02), a = 0.38 / (1 + hgt * 0.12);
    ctx.save(); ctx.translate(sh[0], sh[1]); ctx.scale(1, 0.32);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  layers.sort((a, b) => b[0] - a[0]);
  for (const l of layers) l[1]();
  drawCelebration(now);
}

function kickerPos(now, hashX) {
  const stance = [hashX - 1.45, -2.6], plant = [hashX - 0.34, -0.32];
  const appr = t => { const p = clamp(t, 0, 1), e = p * p * (3 - 2 * p) * 0.45; return [lerp(stance[0], plant[0], e), lerp(stance[1], plant[1], e)]; };
  if (G.flight && V.kickAt) {
    const k = clamp((now - V.kickAt) / 520, 0, 1);
    const from = appr((V.kickAt - V.powerAt) / 650), m = clamp(k / 0.22, 0, 1);
    return { x: lerp(from[0], plant[0], m), z: lerp(from[1], plant[1], m), swing: k, t: now };
  }
  if (G.phase === 'power') {
    const p = appr((now - V.powerAt) / 650);
    return { x: p[0], z: p[1], swing: -1, step: Math.abs(Math.sin((now - V.powerAt) / 140)) * 0.6, t: now };
  }
  return { x: stance[0], z: stance[1], swing: -1, step: 0, t: now };
}

/* Gooseneck goalpost: padded base set back from the end line, a curved
   neck to the crossbar, shaded uprights and wind ribbons on top. */
function drawPosts(now) {
  const z = V.dist, bar = 3.33, top = bar + 10, half = C.aim.postHalf, f = G.flight;
  const glow = G.phase === 'result' && f && f.result === 'good' ? Math.max(0, 1 - (now - G.t0) / 1400) : 0;
  let shake = 0, hit = 0;
  if (f && f.result === 'doink') {
    const dt = now - f.t0 - f.dur;
    if (dt > 0) { shake = Math.sin(dt / 26) * Math.exp(-dt / 280) * 0.35; hit = Math.sign(f.finalX); }
  }
  const s = P(0, bar, z)[2], lw = Math.max(2.5, s * 0.2);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // base pad and gooseneck
  const zb = z + 2, pb = P(0, 0, zb), pt = P(0, 2, zb), ps = pb[2];
  const neck = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    if (t <= 0.45) neck.push(P(0, lerp(0, 2.55, t / 0.45), zb));
    else { const u = (t - 0.45) / 0.55, y = (1 - u) * (1 - u) * 2.55 + 2 * u * (1 - u) * 3.45 + u * u * bar, zz = (1 - u) * (1 - u) * zb + 2 * u * (1 - u) * zb + u * u * z; neck.push(P(0, y, zz)); }
  }
  const path = pts => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); };
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = lw * 1.5 + 2; path(neck); ctx.stroke();
  ctx.strokeStyle = COL.post; ctx.lineWidth = lw * 1.5; path(neck); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,243,176,.8)'; ctx.lineWidth = Math.max(1, lw * 0.35);
  ctx.beginPath(); neck.forEach((p, i) => i ? ctx.lineTo(p[0] - lw * 0.3, p[1]) : ctx.moveTo(p[0] - lw * 0.3, p[1])); ctx.stroke();
  const padW = 0.62 * ps, padH = pb[1] - pt[1];
  const pg = ctx.createLinearGradient(pb[0] - padW / 2, 0, pb[0] + padW / 2, 0);
  pg.addColorStop(0, COL.homeDark); pg.addColorStop(0.4, COL.home); pg.addColorStop(0.6, COL.homeHi); pg.addColorStop(1, COL.homeDark);
  ctx.fillStyle = pg; ctx.fillRect(pb[0] - padW / 2, pt[1], padW, padH);
  ctx.fillStyle = COL.cream; ctx.fillRect(pb[0] - padW / 2, pt[1] + padH * 0.1, padW, Math.max(1, padH * 0.06));
  ctx.fillRect(pb[0] - padW / 2, pt[1] + padH * 0.84, padW, Math.max(1, padH * 0.06));
  // crossbar and uprights
  const l0 = P(-half, bar, z), r0 = P(half, bar, z);
  const tipL = P(-half + (hit < 0 ? shake : 0), top, z), tipR = P(half + (hit > 0 ? shake : 0), top, z);
  const up = (b, t) => { ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.quadraticCurveTo(b[0] + (t[0] - b[0]) * 0.2, (b[1] + t[1]) / 2, t[0], t[1]); };
  if (glow > 0) { ctx.shadowColor = 'rgba(255,211,77,.9)'; ctx.shadowBlur = 26 * glow; }
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = lw + 2;
  ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(r0[0], r0[1]); ctx.stroke(); up(l0, tipL); ctx.stroke(); up(r0, tipR); ctx.stroke();
  ctx.shadowBlur = 0;
  const cg = ctx.createLinearGradient(0, l0[1] - lw / 2, 0, l0[1] + lw / 2);
  cg.addColorStop(0, COL.postHi); cg.addColorStop(0.45, COL.post); cg.addColorStop(1, COL.postLo);
  ctx.strokeStyle = cg; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(r0[0], r0[1]); ctx.stroke();
  for (const [b, t] of [[l0, tipL], [r0, tipR]]) {
    const ug = ctx.createLinearGradient(b[0] - lw / 2, 0, b[0] + lw / 2, 0);
    ug.addColorStop(0, COL.postLo); ug.addColorStop(0.35, COL.post); ug.addColorStop(0.55, COL.postHi); ug.addColorStop(1, COL.postLo);
    ctx.strokeStyle = ug; up(b, t); ctx.stroke();
  }
  if (glow > 0) {
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,220,120,${0.5 * glow})`; ctx.lineWidth = lw * 2.5;
    ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(r0[0], r0[1]); ctx.stroke(); up(l0, tipL); ctx.stroke(); up(r0, tipR); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  ribbon(-half + (hit < 0 ? shake : 0), top, z, now, 0);
  ribbon(half + (hit > 0 ? shake : 0), top, z, now, 1.7);
}

/* A streamer on top of an upright. It streams with the wind and droops when calm. */
function ribbon(x, y, z, now, phase) {
  const mph = G.wind.mph, st = clamp(mph / 14, 0, 1), rad = G.wind.deg * Math.PI / 180;
  let dx = Math.sin(rad) * st, dy = -(1 - st) * 0.95 - 0.08, dz = Math.cos(rad) * st;
  const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  const len = 1.8, N = 10, pts = [];
  const vertical = Math.abs(dy) > 0.7;
  for (let i = 0; i <= N; i++) {
    const d = len * i / N, w = (0.05 + 0.13 * st) * Math.sin(now / (95 - 45 * st) - i * 0.85 + phase) * (i / N);
    pts.push(P(x + dx * d + (vertical ? w : 0), y + dy * d + (vertical ? 0 : w), z + dz * d));
  }
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#e8452c'; ctx.lineWidth = Math.max(2.5, pts[0][2] * 0.16);
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,200,170,.6)'; ctx.lineWidth = Math.max(0.8, pts[0][2] * 0.04);
  ctx.stroke(); ctx.restore();
}

/* Ball position for the current frame, with the same flight math as before.
   Also settles the kick (resolve) at the same moment it always has. */
function ballPos(now) {
  const f = G.flight; if (!f) return null;
  const dist = V.dist;
  let t = clamp((now - f.t0) / f.dur, 0, 1);
  let x, y, z;
  if (f.result === 'short') {
    z = f.reach * t; x = f.x0 + (f.aimX - f.x0) * t * (f.reach / dist) + f.drift * (t * f.reach / dist) ** 2;
    y = 4 * f.apex * 0.75 * t * (1 - t);
  } else {
    z = dist * t; x = f.x0 + (f.aimX - f.x0) * t + f.drift * t * t;
    y = 4 * f.apex * t * (1 - t) + 5.5 * t;
    if (f.result === 'doink' && t >= 1) {                 // bounce back off the post
      const k = clamp((now - f.t0 - f.dur) / 700, 0, 1);
      z = dist - 8 * k; x = f.finalX + Math.sign(f.finalX) * 2 * k; y = 5.5 + 2 * k - 9 * k * k;
      const kl = 0.9006;                                   // where that arc meets the turf
      if (k > kl) y = 1.1 * Math.sin(Math.PI * (k - kl) / (1 - kl));
    } else if (t >= 1) {                                   // carry on past the plane of the posts
      const e = (now - f.t0 - f.dur) / 1000;
      if (f.result === 'good') { const m = clamp(e / 0.12, 0, 1); z = dist + 3 * m; y = Math.max(3.8, 5.5 - Math.max(0, e - 0.12) * 4); }
      else { const tt = 1 + clamp(e, 0, 0.6) * 0.5; z = dist * tt; x = f.x0 + (f.aimX - f.x0) * tt + f.drift * tt * tt; y = Math.max(0, 4 * f.apex * tt * (1 - tt) + 5.5 * tt); }
    }
  }
  const done = f.result === 'doink' ? now - f.t0 >= f.dur + 700 : t >= 1;
  if (done && G.phase === 'flight') resolve(now);
  if (f.result === 'doink' && t >= 1 && !f.clanged) { f.clanged = true; f.clangAt = now; sfx.doink(); }
  const landed = f.result === 'short' && t >= 1;
  return { x, y: Math.max(0, y), z, t, spin: landed ? 0.4 : (Math.min(now, f.t0 + f.dur + 900) - f.t0) / 70 };
}

function drawBallFlight(b, now) {
  const f = G.flight, p = P(b.x, b.y, b.z), r = Math.max(4, p[2] * 0.27);
  // faint trail from the last few moments of the same path
  if (G.phase === 'flight' && b.t > 0.02 && f.result !== 'doink' || (f.result === 'doink' && b.t < 1)) {
    ctx.save(); ctx.lineCap = 'round';
    let prev = p;
    for (let i = 1; i <= 9; i++) {
      const tt = Math.max(0, b.t - i * 0.018);
      let x, y, z;
      if (f.result === 'short') { z = f.reach * tt; x = f.x0 + (f.aimX - f.x0) * tt * (f.reach / V.dist) + f.drift * (tt * f.reach / V.dist) ** 2; y = 4 * f.apex * 0.75 * tt * (1 - tt); }
      else { z = V.dist * tt; x = f.x0 + (f.aimX - f.x0) * tt + f.drift * tt * tt; y = 4 * f.apex * tt * (1 - tt) + 5.5 * tt; }
      const q = P(x, y, z);
      ctx.strokeStyle = `rgba(255,244,220,${0.42 * (1 - i / 10)})`; ctx.lineWidth = Math.max(1.2, r * 0.8 * (1 - i / 11));
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      prev = q;
    }
    ctx.restore();
  }
  // soft halo so the ball reads against the crowd
  const hg = ctx.createRadialGradient(p[0], p[1], r * 0.5, p[0], p[1], r * 2.2);
  hg.addColorStop(0, 'rgba(255,246,225,.55)'); hg.addColorStop(1, 'rgba(255,246,225,0)');
  ctx.fillStyle = hg; ctx.fillRect(p[0] - r * 2.2, p[1] - r * 2.2, r * 4.4, r * 4.4);
  artBall(ctx, p[0], p[1], r, b.spin, false, true);
  // sparks where it rings off the upright
  if (f.result === 'doink' && f.clangAt && now - f.clangAt < 320) {
    const k = (now - f.clangAt) / 320, c = P(f.finalX, 5.5, V.dist), rr = c[2] * (0.3 + k * 1.2);
    ctx.save(); ctx.strokeStyle = `rgba(255,236,170,${1 - k})`; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + 0.3;
      ctx.beginPath(); ctx.moveTo(c[0] + Math.cos(a) * rr * 0.4, c[1] + Math.sin(a) * rr * 0.4); ctx.lineTo(c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr); ctx.stroke();
    }
    ctx.restore();
  }
}

/* Confetti on long makes and perfect kicks. */
function drawCelebration(now) {
  const f = G.flight, dt = Math.min(50, now - (PH.lastNow || now)); PH.lastNow = now;
  const made = G.phase === 'result' && f && f.result === 'good';
  if (made && !f.confettiDone) {
    f.confettiDone = true;
    if (V.dist >= 45 || f.perfect) {
      const cols = [COL.home, COL.cream, COL.gold, '#ffffff', '#ffb547'], n = REDUCE ? 40 : 140;
      PH.confetti = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: -10 - Math.random() * H * 0.25, vx: (Math.random() - 0.5) * 0.08, vy: 0.16 + Math.random() * 0.16,
        a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.02, w: 4 + Math.random() * 5, h: 2 + Math.random() * 3,
        c: cols[(Math.random() * cols.length) | 0], p: Math.random() * 6.28
      }));
    }
  }
  if (!PH.confetti) return;
  if (G.phase !== 'result') { PH.confetti = null; return; }
  for (const q of PH.confetti) {
    q.x += (q.vx + Math.sin(now / 300 + q.p) * 0.04) * dt; q.y += q.vy * dt; q.a += q.va * dt;
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a); ctx.scale(1, Math.cos(now / 160 + q.p));
    ctx.fillStyle = q.c; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); ctx.restore();
  }
}

/* Aim bar (bottom) and power bar (right). */
function drawMeters(now) {
  if (!['aim', 'power', 'flight', 'result'].includes(G.phase)) return;
  const bw = Math.min(440, W * 0.82), bx = (W - bw) / 2, by = H - (TL ? 150 : 104), bh = 16;
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
  if (G.phase === 'idle') { G.dist = 35; G.hash = 'M'; G.wind = { mph: 8, deg: 70 }; V.dist = 35; V.hash = 'M'; }
  drawScene(now);
  drawActors(now);
  drawMeters(now);
  if (G.phase === 'result' && now - G.t0 > C.resultSecs * 1000) {
    if (G.hearts <= 0) finish(); else setupKick(now);
  }
}
function frame(now) {
  if (SHOT && SHOT.mode === 'flight' && G.flight) now = Math.min(now, G.flight.t0 + SHOT.at * G.flight.dur);
  update(now); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (REDUCE) C.flightSecs *= 0.7;

/* Screenshot setup for local dev only: start a run at a set distance and hash,
   and for ?shot=flight fire a kick and hold the clock partway through it. */
if (SHOT) setTimeout(() => {
  document.getElementById('play').click();
  document.getElementById('menu').style.display = 'none';
  if (SHOT.dist) { G.dist = SHOT.dist; setupKick(performance.now()); }
  if (SHOT.mode === 'flight') {
    const now = performance.now(), half = opening(), d = driftYds();
    const aimX = SHOT.res === 'doink' ? half + 0.05 - d : SHOT.res === 'left' ? -half - 1.5 - d : SHOT.res === 'right' ? half + 1.5 - d : -d;
    G.aimRes = { value: toBar(aimX), zoneId: 'perfect' };
    G.powRes = { value: SHOT.res === 'short' ? reqPower() * 0.7 : reqPower() + 0.1, zoneId: 'perfect' };
    V.powerAt = now - 500; G.phase = 'power'; kick(now);
  }
}, 300);

/* Test hook for local dev only. */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__game = { G, aimMeter, powMeter, tap, step: update };
