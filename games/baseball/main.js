import { $, TAU, D2R, rand, clamp, lerp, ease, REDUCE, TOUCH, store } from '../../core/util.js';
import { todayKey, dailyRng } from '../../core/seed/seed.js';
import { ensureAudio, onAudioReady, nz, tn, coreSfx, bindMuteButton, toggleMute } from '../../core/audio/audio.js';
import { createHearts } from '../../core/hearts/hearts.js';
import { createInitials, cleanIni } from '../../core/initials/initials.js';
import { getClient, identity, colorFor, supaRoom } from '../../core/leaderboard/client.js';

/* Seeded randomness for the daily challenge (see core/seed) */
let prng = Math.random;

/* Player options */
const TEAMS = [
  { id: 'steel', name: 'Steel blue', j: '#3d6f9f', h: '#1d2f4a' },
  { id: 'crimson', name: 'Crimson', j: '#b0352c', h: '#2b1515' },
  { id: 'royal', name: 'Royal', j: '#2f55c9', h: '#f1ece0' },
  { id: 'gold', name: 'Black and gold', j: '#26262b', h: '#d4a72c' },
  { id: 'orange', name: 'Orange', j: '#e2742b', h: '#1b1b1f' },
  { id: 'purple', name: 'Purple', j: '#6b41a8', h: '#e9c84a' },
  { id: 'white', name: 'Home whites', j: '#efeae0', h: '#14213d' }
];
const OPTS = Object.assign({ mode: 'free', hand: 'R', team: 'steel' }, store.get('ss.opts', {}));
const HAND = () => OPTS.hand === 'L' ? -1 : 1;
const TEAM = () => TEAMS.find(t => t.id === OPTS.team) || TEAMS[0];
let RUN_MODE = 'free';
const DERBY_PITCHES = 20;

/* =========================================================
   Field geometry (world units = feet, home plate at origin,
   +y toward center field)
   ========================================================= */
function fenceR(deg) { const a = Math.min(45, Math.abs(deg)); return 400 - 70 * Math.pow(a / 45, 1.6); }
const POLE = fenceR(45), S2 = Math.SQRT1_2, FOUL_OFF = 50;
function surfacePath(p, e) {
  for (let i = 0; i <= 60; i++) {
    const d = -45 + i * 1.5, r = fenceR(d) + e;
    const x = Math.sin(d * D2R) * r, y = Math.cos(d * D2R) * r;
    i ? p.lineTo(x, y) : p.moveTo(x, y);
  }
  const k = FOUL_OFF + e, P = POLE + e;
  p.lineTo(P * S2 + S2 * k, P * S2 - S2 * k);
  p.lineTo(S2 * k, -S2 * k);
  p.arc(0, 0, k, -Math.PI / 4, -3 * Math.PI / 4, true);
  p.lineTo(-P * S2 - S2 * k, P * S2 - S2 * k);
  p.closePath();
  return p;
}
function fenceLine(off) {
  const p = new Path2D();
  for (let i = 0; i <= 60; i++) {
    const d = -45 + i * 1.5, r = fenceR(d) + off;
    const x = Math.sin(d * D2R) * r, y = Math.cos(d * D2R) * r;
    i ? p.lineTo(x, y) : p.moveTo(x, y);
  }
  return p;
}
const P_SURF = surfacePath(new Path2D(), 0);
const P_STANDS = surfacePath(new Path2D(), 80);
const P_SURF_PAD = surfacePath(new Path2D(), 7);
const P_FAIR = (() => { const p = new Path2D(); p.moveTo(0, 0); for (let i = 0; i <= 60; i++) { const d = -45 + i * 1.5, r = fenceR(d); p.lineTo(Math.sin(d * D2R) * r, Math.cos(d * D2R) * r); } p.closePath(); return p; })();
const P_WIDE = (() => { const p = new Path2D(); p.moveTo(0, -2); for (let d = -53; d <= 53; d += 2) p.lineTo(Math.sin(d * D2R) * 175, Math.cos(d * D2R) * 175); p.closePath(); return p; })();
const P_IGRASS = (() => { const p = new Path2D(); p.moveTo(0, 5.7); p.lineTo(58, 63.6); p.lineTo(0, 121.6); p.lineTo(-58, 63.6); p.closePath(); return p; })();
const P_FENCE = fenceLine(0), P_WALL = fenceLine(2.2), P_WALLTOP = fenceLine(4.4);
const BASES = [[63.6, 63.6], [0, 127.3], [-63.6, 63.6]];
const LIGHTS = [[-360, 400], [360, 400], [-215, -70], [215, -70]];

/* Sponsored fields: each page load picks one and paints its logo and URL on the outfield grass.
   Add a project: drop a logo in assets/ and add a row here. w/h are the painted size in feet. */
const FIELDS = [
  { name: 'Run The Play', url: 'runtheplayapp.com', href: 'https://www.runtheplayapp.com', logo: '/assets/field-runtheplay.png', w: 132, h: 87, wall: '#14284b' },
  { name: 'Youth Baseball Time', url: 'youthbaseballtime.com', href: 'https://youthbaseballtime.com', logo: '/assets/field-youthbaseballtime.png', w: 100, h: 96, wall: '#123a6b' },
  { name: 'SlushFun', url: 'slushfun.biz', href: 'https://slushfun.biz', logo: '/assets/field-slushfun.png', w: 176, h: 34, wall: '#12305c' },
  { name: 'Sawman', url: 'sawman.app', href: 'https://sawman.app', logo: '/assets/field-sawman.png', w: 88, h: 88, wall: '#0a1830' },
  { name: 'Saw Tech Solutions', url: 'sawtechsolutions.com', href: 'https://sawtechsolutions.com', logo: '/assets/field-sawtech.svg', w: 60, h: 96, wall: '#16233a' }
];
// ?field=2 pins a field for previewing; otherwise it's random per load
const FIELD = FIELDS[+new URLSearchParams(location.search).get('field') - 1] || FIELDS[(Math.random() * FIELDS.length) | 0];
FIELD.img = new Image(); FIELD.img.src = FIELD.logo;

/* Pitch + swing constants */
const REL_Y = 56.5, CATCH_Y = -3.6, PATH = REL_Y - CATCH_Y, CONTACT_Y = 0.6;
const PC = (REL_Y - CONTACT_Y) / PATH;
const CONTACT_MS = 85;
const WIN = { perfect: 14, great: 32, good: 55, ok: 80, foul: 115 };
const PIVOT = { x: -2.25, y: CONTACT_Y }, BAT_LEN = 3.15, BAT_REST = -2.25;
const TYPES = {
  fastball: { name: 'Fastball', mph: [88, 99], brk: [-0.15, 0.15], w: 32 },
  sinker:   { name: 'Sinker', mph: [86, 95], brk: [-0.9, -0.45], w: 12 },
  slider:   { name: 'Slider', mph: [80, 89], brk: [0.7, 1.3], w: 16 },
  curve:    { name: 'Curveball', mph: [71, 81], brk: [1.3, 2.2], w: 14 },
  change:   { name: 'Changeup', mph: [76, 86], brk: [-0.7, -0.3], w: 16 },
  knuckle:  { name: 'Knuckleball', mph: [63, 72], brk: [-0.3, 0.3], w: 6, min: 8 }
};
const KIND_NAME = { single: 'Single', double: 'Double', triple: 'Triple', hr: 'Home run' };
const KIND_PTS = { single: 100, double: 200, triple: 300, hr: 500 };
const FIELD_POS = [[70, 84], [31, 140], [-31, 140], [-70, 84], [-168, 250], [0, 305], [168, 250]];

/* =========================================================
   Canvas setup
   ========================================================= */
const app = $('#app'), cvs = $('#field'), ctx = cvs.getContext('2d');
const mini = $('#mini'), mctx = mini.getContext('2d');
let W = 0, H = 0, DPR = 1, TOP = 96, BOT = 30;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const r = cvs.getBoundingClientRect(); W = r.width; H = r.height;
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  mini.width = Math.round(170 * DPR); mini.height = Math.round(128 * DPR);
  app.classList.toggle('wide', W >= 980);
  measureTop();
  BOT = W < 640 ? 110 : 34;
}
function measureTop() {
  const r = cvs.getBoundingClientRect(), hb = $('#hud').getBoundingClientRect();
  TOP = Math.max(70, hb.bottom - r.top + 8);
}
function setPaceHidden(h) { const el = $('#pace'); if (el.hidden !== h) { el.hidden = h; measureTop(); } }
const panelW = () => (app.classList.contains('wide') && app.classList.contains('panel-open')) ? 340 : 0;

/* Pre-rendered stands + crowd */
const CROWD = { img: null, dots: [] };
function buildCrowd() {
  const S = 2, X0 = -430, Y1 = 510, w = 860 * S, h = 660 * S;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.setTransform(S, 0, 0, -S, -X0 * S, Y1 * S);
  g.fillStyle = '#132019'; g.fill(P_STANDS);
  g.lineWidth = 1.1;
  for (let e = 12; e < 80; e += 5.5) { g.strokeStyle = 'rgba(255,255,255,0.028)'; g.stroke(surfacePath(new Path2D(), e)); }
  const test = document.createElement('canvas').getContext('2d');
  const pal = ['#d9d2c4', '#a8b6c2', '#c45a4a', '#3f6fa0', '#e2b24f', '#6f8d6a', '#8e7aa8', '#c98a62', '#e9e4da', '#4b5560'];
  for (let x = -420; x <= 420; x += 3.4) {
    for (let y = -130; y <= 500; y += 3.4) {
      const px = x + rand(-1, 1), py = y + rand(-1, 1);
      if (!test.isPointInPath(P_STANDS, px, py) || test.isPointInPath(P_SURF_PAD, px, py)) continue;
      if (Math.random() < 0.13) continue;
      g.fillStyle = pal[(Math.random() * pal.length) | 0];
      g.globalAlpha = rand(0.45, 0.85);
      g.fillRect(px - 0.85, py - 0.85, 1.7, 1.7);
      if (Math.random() < 0.3) CROWD.dots.push([px, py]);
    }
  }
  CROWD.img = c;
}

/* =========================================================
   Game state
   ========================================================= */
const G = {
  state: 'between', demo: true, nextAt: 0,
  balls: 0, strikes: 0, score: 0, disp: 0, streak: 0, runBestStreak: 0, hearts: 3, left: DERBY_PITCHES, pitches: 0, hits: 0, hrs: 0, longestHR: 0,
  pace: [], spray: [], pitch: null, wind: null, swing: null, pending: null, pendingMiss: null,
  hit: null, ghost: null, lastPitch: null,
  shake: 0, flash: 0, hurt: 0, crowdFlashUntil: 0,
  hitstopUntil: 0, slowStart: 0, slowUntil: 0,
  umpPunchUntil: 0, mittPopAt: 0, lastMitt: null,
  fielders: FIELD_POS.map(([x, y]) => ({ hx: x, hy: y, x, y, tx: null, ty: null, speed: 0 }))
};
const cam = { x: 0, y: 31, s: 8 };
// Small screens: S0 is the resting zoom (px per foot). When it gets low, HS enlarges
// everything around home plate and widens the pitch lanes so they stay readable.
let S0 = 8, HS = 1;
const DERBY = () => RUN_MODE === 'derby' && !G.demo;
const parts = [];
const ghostHits = [];
let simT = 0;

/* =========================================================
   Pitch generation and physics
   ========================================================= */
function pickType(u) {
  const pool = Object.entries(TYPES).filter(([, t]) => !t.min || G.pitches >= t.min);
  // derby is batting practice: about four fastballs in five
  const wt = (k, t) => DERBY() && k === 'fastball' ? t.w * 8 : t.w;
  let tot = pool.reduce((s, [k, t]) => s + wt(k, t), 0), r = u * tot;
  for (const [k, t] of pool) { if ((r -= wt(k, t)) <= 0) return k; }
  return 'fastball';
}
function makePitch(release) {
  // Always draw the same number of values so daily sequences stay aligned
  const r = []; for (let i = 0; i < 9; i++) r.push(prng());
  const key = pickType(r[0]), t = TYPES[key];
  const ramp = Math.min(1, 0.82 + G.pitches * 0.008);
  const mph = Math.max(55, lerp(t.mph[0], t.mph[1], r[1]) * ramp);
  // Pitchers work the count: groove it at 3 balls, waste one when ahead 0-2 or 1-2
  let sp = G.pitches < 3 ? 0.78 : 0.62;
  if (!G.demo) { if (G.balls === 3) sp = 0.82; else if (G.strikes === 2 && G.balls < 2) sp = 0.5; }
  if (DERBY()) sp = 1; // derby pitchers groove every one
  const strike = r[2] < sp;
  let xt, dirt = false;
  if (strike) xt = lerp(-0.72, 0.72, r[3]);
  else if (r[4] < 0.27) { dirt = true; xt = lerp(-0.9, 0.9, r[3]); }
  else xt = (r[5] < 0.5 ? -1 : 1) * lerp(1.35, 2.3, r[3]);
  const totalMs = PATH / (mph * 1.46667) * 1000;
  return {
    key, name: t.name, mph: Math.round(mph), strike, dirt, xt,
    x0: -1.1, brk: lerp(t.brk[0], t.brk[1], r[6]), wob: key === 'knuckle', ph: r[7] * TAU,
    bq: lerp(0.82, 0.9, r[8]), totalMs, release, done: false, err: null
  };
}
function pitchPos(p, prog) {
  const y = REL_Y - PATH * prog, q = prog / PC, A = p.xt - p.brk - p.x0;
  let x = q <= 1 ? p.x0 + A * q + p.brk * q * q * q : p.xt + (A + 3 * p.brk) * (q - 1);
  if (p.wob) x += 0.32 * Math.sin(q * 9 + p.ph) * Math.sin(Math.min(q, 1) * Math.PI);
  let z;
  if (p.dirt) {
    if (q < p.bq) z = 6 * (1 - Math.pow(q / p.bq, 1.4));
    else z = Math.max(0, 1.5 * Math.sin(Math.PI * (q - p.bq) / (1.18 - p.bq)));
  } else z = Math.max(0.3, 6 - 3.5 * q + 0.9 * q * (1 - q));
  return { x, y, z };
}

/* =========================================================
   Flow
   ========================================================= */
function scheduleNext(delay) { G.state = 'between'; G.nextAt = performance.now() + delay; }
function beginWindup(now) {
  const dur = 650 + prng() * 550;
  G.wind = { start: now, dur };
  G.pitch = makePitch(now + dur);
  G.swing = null; G.pending = null; G.pendingMiss = null; G.hit = null; G.lastMitt = null;
  G.state = 'windup';
  if (G.demo) {
    const Ta = G.pitch.release + PC * G.pitch.totalMs;
    if (G.pitch.strike && Math.random() < 0.88) G.pitch.autoAt = Ta - CONTACT_MS + rand(-45, 45);
    else if (Math.random() < 0.12) G.pitch.autoAt = Ta - CONTACT_MS + rand(-20, 20);
  }
}
function doSwing(t) {
  if (G.state !== 'pitch' || G.swing) return;
  const p = G.pitch; if (!p || p.done) return;
  G.swing = { start: t };
  if (!G.demo) sfx.whoosh();
  const Ta = p.release + PC * p.totalMs;
  const err = (t + CONTACT_MS) - Ta;
  p.err = err;
  const a = Math.abs(err);
  if (!p.strike) { G.pendingMiss = 'chase'; if (!G.demo) showMeter(err, 'Chased'); return; }
  if (a <= WIN.ok) G.pending = { kind: 'hit', at: Math.max(t + CONTACT_MS, Ta), err };
  else if (a <= WIN.foul) G.pending = { kind: 'foul', at: Math.max(t + CONTACT_MS, Ta), err };
  else G.pendingMiss = 'whiff';
  if (!G.demo) showMeter(err);
}
function qualityOf(a) { return a <= WIN.perfect ? 'perfect' : a <= WIN.great ? 'great' : a <= WIN.good ? 'good' : a <= WIN.ok ? 'ok' : a <= WIN.foul ? 'foul' : 'miss'; }
const Q_LABEL = { perfect: 'Perfect', great: 'Crushed', good: 'Solid', ok: 'Got a piece', foul: 'Just got it', miss: 'Missed' };

function makeHit(err) {
  const q = qualityOf(Math.abs(err));
  let deg = clamp(err / WIN.foul * 52, -50, 50) + rand(-5, 5);
  let d, h, style;
  if (q === 'perfect') { deg = clamp(deg, -38, 38); d = rand(408, 472); h = rand(85, 120); style = 'fly'; }
  else if (q === 'great') { d = rand(322, 405); h = rand(60, 92); style = 'fly'; }
  else if (q === 'good') { d = rand(218, 318); h = rand(16, 34); style = 'liner'; }
  else { d = rand(100, 195); if (Math.random() < 0.5) { h = rand(3, 6); style = 'ground'; } else { h = rand(9, 16); style = 'liner'; } }
  deg = clamp(deg, -43.5, 43.5) * HAND();
  const fr = fenceR(deg);
  let kind;
  if (d > fr + 3) kind = 'hr';
  else {
    if (d > fr - 12) d = fr - 12 - rand(0, 6);
    if (d < 180) kind = 'single';
    else if (d < 278) kind = 'double';
    else kind = (Math.abs(deg) > 11 && Math.abs(deg) < 38) ? 'triple' : 'double';
  }
  return { q, deg, d, h, style, kind };
}
function resolveContact(o, now) {
  const p = G.pitch, cp = pitchPos(p, PC);
  const ox = cp.x * HS, oy = CONTACT_Y;
  if (!G.demo) updRadar(p);
  if (o.kind === 'hit') {
    const m = makeHit(o.err);
    const stays = DERBY() && m.kind !== 'hr'; // derby: anything short of the wall costs a pitch
    if (!G.demo) {
      G.hits++;
      if (stays) { G.streak = 0; updStreak(false); useLeft(); }
      else { G.streak++; G.runBestStreak = Math.max(G.runBestStreak, G.streak); updStreak(true); }
      resetCount();
    }
    const mult = multFor(G.streak);
    const pts = stays ? 0 : Math.round((KIND_PTS[m.kind] + (m.q === 'perfect' ? 100 : 0)) * mult);
    const T = 1.05 + m.d / 245;
    G.hit = {
      ...m, a: m.deg * D2R, ox, oy, start: simT, T, pts, trail: [],
      roll: m.kind === 'hr' ? 0 : m.style === 'fly' ? rand(8, 18) : rand(14, 30),
      rollT: m.kind === 'hr' ? 0.25 : 0.75, landed: false, settled: false, cleared: false, foul: false
    };
    G.hit.lx = ox + Math.sin(G.hit.a) * m.d; G.hit.ly = oy + Math.cos(G.hit.a) * m.d;
    const power = m.q === 'perfect' ? 1 : m.q === 'great' ? 0.8 : m.q === 'good' ? 0.6 : 0.42;
    if (!G.demo) {
      sfx.crack(power);
      G.shake = REDUCE ? 0 : (m.q === 'perfect' ? 11 : m.q === 'great' ? 6 : 3);
      if (m.q === 'perfect' && !REDUCE) G.flash = 1;
      if (m.q === 'perfect' || m.q === 'great') {
        G.hitstopUntil = now + (m.q === 'perfect' ? 90 : 55);
        G.slowStart = G.hitstopUntil; G.slowUntil = G.hitstopUntil + (m.q === 'perfect' ? 650 : 380);
      }
      if (m.kind === 'hr') G.hrPending = true;
      emitHit(G.hit);
    }
    contactBurst(ox, oy, power);
    assignFielders(G.hit);
  } else {
    const back = Math.random() < 0.35;
    const deg = back ? 180 + rand(-30, 30) : Math.sign(o.err || 1) * HAND() * rand(52, 100);
    const d = back ? rand(45, 75) : rand(70, 170);
    G.hit = { q: 'foul', deg, a: deg * D2R, d, h: rand(25, 60), style: 'fly', kind: 'foul', ox, oy, start: simT, T: 0.9 + d / 260, pts: 0, trail: [], roll: 4, rollT: 0.3, landed: false, settled: false, foul: true };
    G.hit.lx = ox + Math.sin(G.hit.a) * d; G.hit.ly = oy + Math.cos(G.hit.a) * d;
    if (!G.demo) {
      sfx.crack(0.3);
      if (DERBY()) { G.streak = 0; updStreak(false); useLeft(); showCallout('Foul ball', leftText(), 'mini'); }
      else if (G.strikes < 2) { G.strikes++; updCount(); showCallout('Foul ball', `Strike ${G.strikes === 1 ? 'one' : 'two'}`, 'mini'); }
      else showCallout('Foul ball', 'Still alive with two strikes', 'mini');
    }
    contactBurst(ox, oy, 0.25);
  }
  G.state = 'inplay';
}
function multFor(streak) { return 1 + Math.min(3, Math.floor(streak / 5) * 0.5); }
function resolveMitt(now) {
  const p = G.pitch; p.done = true;
  const fin = pitchPos(p, 1);
  G.lastMitt = { x: fin.x, y: CATCH_Y + 0.4 };
  G.mittPopAt = now;
  if (!G.demo) sfx.pop();
  if (DERBY()) {
    if (G.pendingMiss) { G.streak = 0; updStreak(false); useLeft(); showCallout('Swing and a miss', leftText(), 'mini out'); }
    else showCallout('Taken', 'No swing, no pitch used', 'mini');
    updRadar(p);
    finalizePitch();
  } else if (!G.demo) {
    if (G.pendingMiss === 'chase') addStrike('Chased one outside the lanes', false);
    else if (G.pendingMiss === 'whiff') addStrike(p.err < 0 ? 'Swinging, way out in front' : 'Swinging, too late on it', false);
    else if (p.strike) { G.umpPunchUntil = now + 700; addStrike('Called, it caught the plate', true); }
    else addBall();
    updRadar(p);
    finalizePitch();
  }
  G.state = 'after';
  G.nextAt = now + (runDone() ? 1400 : 950);
}
function runDone() { return !G.demo && (RUN_MODE === 'derby' ? G.left <= 0 : G.hearts <= 0); }
function useLeft() { G.left = Math.max(0, G.left - 1); setText('#sLeft', G.left); pulse($('#sLeft')); }
function leftText() { return G.left <= 0 ? 'That was the last pitch' : `${G.left} pitch${G.left === 1 ? '' : 'es'} left`; }
function addStrike(reason, looking) {
  G.strikes++;
  if (G.strikes >= 3) {
    G.hearts = Math.max(0, G.hearts - 1);
    G.streak = 0; updStreak(false); updHearts(true);
    sfx.out();
    G.hurt = 1; G.shake = REDUCE ? 0 : 4;
    const left = G.hearts === 2 ? 'Two outs left' : G.hearts === 1 ? 'One out left' : 'That\'s the third out';
    showCallout(looking ? 'Struck out looking' : 'Strike three', left, 'out');
    resetCount();
  } else {
    showCallout(`Strike ${G.strikes === 1 ? 'one' : 'two'}`, reason, 'mini out');
    updCount();
  }
}
function addBall() {
  G.balls++;
  if (G.balls >= 4) {
    const pts = Math.round(75 * multFor(G.streak));
    G.score += pts; sfx.eye();
    showCallout('Walk', 'Take your base', '', `+${pts}`);
    resetCount();
  } else {
    sfx.eye();
    showCallout(`Ball ${['one', 'two', 'three'][G.balls - 1]}`, `Count is ${G.balls}-${G.strikes}`, 'mini');
    updCount();
  }
}
function resetCount() { G.balls = 0; G.strikes = 0; updCount(); }
function updCount() {
  [...$('#lb').children].forEach((el, i) => el.classList.toggle('on', i < G.balls));
  [...$('#ls').children].forEach((el, i) => el.classList.toggle('on', i < G.strikes));
}
function finalizePitch() {
  G.pitches++;
  G.pace.push(G.score);
  updPace();
  pushPresence();
}
function assignFielders(h) {
  const tx = h.kind === 'hr' ? h.ox + Math.sin(h.a) * (fenceR(h.deg) - 7) : h.ox + Math.sin(h.a) * (h.d + h.roll);
  const ty = h.kind === 'hr' ? h.oy + Math.cos(h.a) * (fenceR(h.deg) - 7) : h.oy + Math.cos(h.a) * (h.d + h.roll);
  const ranked = G.fielders.map(f => ({ f, d: Math.hypot(f.x - tx, f.y - ty) })).sort((a, b) => a.d - b.d);
  const arrive = h.T + h.rollT + 0.15;
  const f1 = ranked[0].f; f1.tx = tx; f1.ty = ty; f1.speed = ranked[0].d / arrive;
  const f2 = ranked[1].f; f2.tx = lerp(f2.x, tx, 0.45); f2.ty = lerp(f2.y, ty, 0.45); f2.speed = ranked[1].d * 0.45 / arrive;
}
function updateHit(now) {
  const h = G.hit; if (!h) return;
  const p = (simT - h.start) / h.T;
  if (!h.landed) {
    h.pos = hitPos(h, Math.min(1, p));
    h.trail.push([h.pos.x, h.pos.y, h.pos.z]); if (h.trail.length > 18) h.trail.shift();
    if (h.kind === 'hr' && !h.cleared && h.pos.r > fenceR(h.deg)) { h.cleared = true; celebrateHR(now, h); }
    if (p >= 1) { h.landed = true; h.landAt = simT; onLand(h, now); }
  } else {
    const rp = Math.min(1, (simT - h.landAt) / h.rollT);
    const r = h.d + h.roll * (1 - (1 - rp) * (1 - rp));
    h.pos = { x: h.ox + Math.sin(h.a) * r, y: h.oy + Math.cos(h.a) * r, z: 0, r };
    if (h.trail.length) h.trail.shift();
    if (rp >= 1 && !h.settled) {
      h.settled = true;
      if (!G.demo) finalizePitch();
      G.state = 'after';
      G.nextAt = now + (h.kind === 'hr' ? 1500 : h.foul ? 450 : 850);
    }
  }
}
function hitPos(h, p) {
  let r, z;
  if (h.style === 'fly') { r = h.d * (1 - Math.pow(1 - p, 1.35)); z = h.h * 4 * p * (1 - p); }
  else if (h.style === 'liner') { r = h.d * (1 - Math.pow(1 - p, 1.6)); z = h.h * 4 * p * (1 - p); }
  else { r = h.d * (1 - Math.pow(1 - p, 1.8)); z = Math.abs(Math.sin(p * Math.PI * 3.2)) * h.h * (1 - p) * 1.4; }
  return { x: h.ox + Math.sin(h.a) * r, y: h.oy + Math.cos(h.a) * r, z, r };
}
function onLand(h, now) {
  dust(h.pos.x, h.pos.y, h.kind === 'hr' ? 0 : 1);
  if (h.foul || G.demo) return;
  if (h.kind !== 'hr') {
    G.score += h.pts;
    G.spray.push({ x: h.pos.x, y: h.pos.y, hr: false });
    if (DERBY()) showCallout(KIND_NAME[h.kind], `Stayed in the park. ${leftText()}`, 'mini');
    else showCallout(KIND_NAME[h.kind], `${Math.round(h.d)} ft`, h.kind === 'triple' ? 'hr' : '', `+${h.pts}`);
    sfx.crowd(false);
  }
}
function celebrateHR(now, h) {
  const dist = Math.round(h.d);
  if (!G.demo) {
    G.score += h.pts; G.hrs++; setText('#sHRs', G.hrs);
    G.longestHR = Math.max(G.longestHR, dist);
    G.spray.push({ x: h.lx, y: h.ly, hr: true });
    showCallout('Home run', `${dist} ft`, 'hr long', `+${h.pts}`);
    sfx.crowd(true); sfx.organ();
    G.crowdFlashUntil = now + 2600;
  }
  fireworks(h.pos.x, h.pos.y + 25, G.demo ? 1 : 3);
}

/* =========================================================
   Particles
   ========================================================= */
function contactBurst(x, y, power) {
  const n = Math.round(10 + power * 22);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(6, 28) * power + 3;
    parts.push({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.2, 0.45), size: rand(1.2, 2.6), c: Math.random() < 0.6 ? '#fff6dc' : '#ffcf7a' });
  }
  parts.push({ k: 'ring', x, y, life: 0, max: 0.35, r0: 0.6, r1: 4 + power * 6 });
}
function dust(x, y, amt) {
  if (!amt) return;
  for (let i = 0; i < 9; i++) {
    const a = rand(0, TAU), sp = rand(2, 9);
    parts.push({ k: 'dust', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.5, 0.9), r: rand(1.4, 3) });
  }
}
function fireworks(x, y, bursts) {
  const cols = ['#ffb547', '#f1ece0', '#ff6a5a', '#8fd3ff', '#9cf0b0'];
  for (let b = 0; b < bursts; b++) {
    const cx = x + rand(-55, 55), cy = y + rand(-10, 50), delay = b * 0.3, c = cols[(Math.random() * cols.length) | 0];
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * TAU + rand(-0.05, 0.05), sp = rand(40, 78);
      parts.push({ k: 'fw', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: -delay, max: rand(1.2, 1.8), size: rand(2.4, 3.8), c });
    }
  }
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life += dt;
    if (p.life > p.max) { parts.splice(i, 1); continue; }
    if (p.life < 0) continue;
    if (p.vx != null) {
      const drag = p.k === 'fw' ? 2.2 : p.k === 'dust' ? 3 : 5;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.exp(-drag * dt); p.vy *= Math.exp(-drag * dt);
    }
  }
}

/* =========================================================
   Main loop
   ========================================================= */
let last = performance.now();
function frame(now) {
  const dtR = Math.min(0.05, (now - last) / 1000); last = now;
  let ts = 1;
  if (now < G.hitstopUntil) ts = 0;
  else if (now < G.slowUntil) { const k = (now - G.slowStart) / (G.slowUntil - G.slowStart); ts = 0.28 + 0.72 * k * k; }
  const dt = dtR * ts; simT += dt;
  update(now, dtR, dt);
  render(now, dtR);
  requestAnimationFrame(frame);
}
function update(now, dtR, dt) {
  switch (G.state) {
    case 'between': if (now >= G.nextAt) beginWindup(now); break;
    case 'windup': if (now >= G.pitch.release) { G.state = 'pitch'; if (!G.demo) sfx.release(); } break;
    case 'pitch': {
      const p = G.pitch, prog = (now - p.release) / p.totalMs;
      if (G.demo && !G.swing && p.autoAt && now >= p.autoAt) doSwing(p.autoAt);
      if (G.pending) { if (now >= G.pending.at) { const o = G.pending; G.pending = null; resolveContact(o, now); } }
      else if (prog >= 1 && !p.done) resolveMitt(now);
      break;
    }
    case 'inplay': updateHit(now); break;
    case 'after':
      if (G.hit && !G.hit.settled) updateHit(now);
      if (now >= G.nextAt) {
        if (runDone()) gameOver();
        else scheduleNext(G.hit && !G.hit.foul ? 1050 : 320);
      }
      break;
  }
  // Fielders
  const hitLive = G.hit && !G.hit.foul && (G.state === 'inplay' || G.state === 'after');
  for (const f of G.fielders) {
    if (hitLive && f.tx != null) {
      const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy), step = f.speed * dt;
      if (d > 0.3) { f.x += dx / d * Math.min(step, d); f.y += dy / d * Math.min(step, d); }
    } else {
      f.tx = null;
      const k = 1 - Math.exp(-dtR * 1.6);
      f.x = lerp(f.x, f.hx, k); f.y = lerp(f.y, f.hy, k);
    }
  }
  updateParts(dt);
  for (let i = ghostHits.length - 1; i >= 0; i--) if (now - ghostHits[i].start > 9000) ghostHits.splice(i, 1);
  // Camera
  const t = camTarget();
  const k = 1 - Math.exp(-dtR * (t.follow ? 3.4 : 2.6));
  cam.x = lerp(cam.x, t.x, k); cam.y = lerp(cam.y, t.y, k);
  cam.s = Math.exp(lerp(Math.log(cam.s), Math.log(t.s), k));
  G.shake *= Math.exp(-dtR * 9); G.flash *= Math.exp(-dtR * 7); G.hurt *= Math.exp(-dtR * 2.5);
  // Score count-up
  if (Math.abs(G.disp - G.score) > 0.5) { G.disp += (G.score - G.disp) * Math.min(1, dtR * 9); setText('#sScore', Math.round(G.disp).toLocaleString()); }
  else if (G.disp !== G.score) { G.disp = G.score; setText('#sScore', G.score.toLocaleString()); }
}
function camTarget() {
  const fw = W - panelW(), avH = Math.max(200, H - TOP - BOT);
  const s0 = Math.max(0.5, Math.min(avH / 86, fw / 30));
  S0 = s0; HS = clamp(1 + (9 - s0) * 0.3, 1, 2.2);
  const h = G.hit;
  if (h && h.pos && (G.state === 'inplay' || G.state === 'after')) {
    const pts = [[0, -8], [h.pos.x, h.pos.y]];
    if (!h.landed) pts.push([lerp(h.pos.x, h.lx, 0.35), lerp(h.pos.y, h.ly, 0.35)]);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = 42;
    const s = clamp(Math.min(fw * 0.9 / (x1 - x0 + pad * 2), avH * 0.9 / (y1 - y0 + pad * 2)), 0.9, s0);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s, follow: true };
  }
  return { x: 0, y: 31, s: s0, follow: false };
}

/* =========================================================
   Rendering
   ========================================================= */
let OX = 0, OY = 0;
function worldTransform() { ctx.setTransform(DPR * cam.s, 0, 0, -DPR * cam.s, DPR * OX, DPR * OY); }
function render(now) {
  const s = cam.s;
  const fw = W - panelW(), avH = Math.max(200, H - TOP - BOT);
  const sx = G.shake ? rand(-G.shake, G.shake) : 0, sy = G.shake ? rand(-G.shake, G.shake) : 0;
  OX = fw / 2 - cam.x * s + sx; OY = TOP + avH / 2 + cam.y * s + sy;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#09130e'; ctx.fillRect(0, 0, W, H);
  // stadium light glow
  ctx.globalCompositeOperation = 'lighter';
  for (const [lx, ly] of LIGHTS) {
    const px = OX + lx * s, py = OY - ly * s, r = Math.max(120, 230 * s);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,244,214,0.16)'); g.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  if (CROWD.img) ctx.drawImage(CROWD.img, OX - 430 * s, OY - 510 * s, 860 * s, 660 * s);

  worldTransform();
  drawField(s, now);
  if (now < G.crowdFlashUntil && s < 5) {
    ctx.fillStyle = '#fff';
    const n = 60;
    for (let i = 0; i < n; i++) {
      const d = CROWD.dots[(Math.random() * CROWD.dots.length) | 0]; if (!d) break;
      ctx.globalAlpha = Math.random(); ctx.fillRect(d[0] - 1, d[1] - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  if (G.state === 'windup' || G.state === 'pitch') drawLanes(s);
  for (const f of G.fielders) {
    const tgt = G.hit && G.hit.pos && !G.hit.foul ? G.hit.pos : { x: 0, y: 0 };
    person(f.x, f.y, Math.atan2(tgt.y - f.y, tgt.x - f.x), '#ebe5d6', '#9a2e26', { glove: 1, sc: Math.max(1, (S0 < 8 ? 4.2 : 2.8) / s) });
  }
  drawPitcher(now);
  drawUmpire(now);
  drawCatcher(now);
  drawBatter(now);
  drawBalls(now, s);
  drawGhostBalls(now, s);
  drawParts(s);

  // Screen-space effects
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  if (G.hurt > 0.02) {
    const hg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    hg.addColorStop(0, 'rgba(200,30,20,0)'); hg.addColorStop(1, `rgba(200,30,20,${0.45 * G.hurt})`);
    ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
  }
  if (G.flash > 0.02) { ctx.fillStyle = `rgba(255,248,230,${0.38 * G.flash})`; ctx.fillRect(0, 0, W, H); }
  drawMini(now);
}
const lw = (ft, px) => Math.max(ft, px / cam.s);
function drawBands() {
  ctx.save(); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = -28; i < 28; i += 2) ctx.fillRect(i * 18, -520, 18, 1040);
  ctx.fillStyle = 'rgba(0,0,0,0.055)';
  for (let j = -28; j < 28; j += 2) ctx.fillRect(-520, j * 18, 1040, 18);
  ctx.restore();
}
function wText(str, x, y, rot, size, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1, -1); ctx.rotate(rot);
  ctx.font = `800 ${size}px "Big Shoulders Display", Impact, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.fillText(str, 0, 0); ctx.restore();
}
function drawField(s) {
  const c = ctx;
  // grass
  c.fillStyle = '#2c6838'; c.fill(P_SURF);
  c.save(); c.clip(P_SURF); drawBands();
  // warning track
  c.strokeStyle = '#8e5532'; c.lineWidth = 28; c.stroke(P_FENCE);
  c.restore();
  // sponsor paint in center field
  if (s < 5) {
    const im = FIELD.img;
    c.globalAlpha = 0.9;
    if (im.complete && im.naturalWidth) { c.save(); c.translate(0, 205 + FIELD.h / 2); c.scale(1, -1); c.drawImage(im, -FIELD.w / 2, -FIELD.h / 2, FIELD.w, FIELD.h); c.restore(); }
    wText(FIELD.url.toUpperCase(), 0, 186, 0, Math.min(19, 400 / FIELD.url.length), 'rgba(244,240,230,0.9)');
    c.globalAlpha = 1;
  }
  // infield dirt
  c.save(); c.clip(P_WIDE); c.fillStyle = '#b5633a'; c.beginPath(); c.arc(0, 60.5, 95, 0, TAU); c.fill(); c.restore();
  // infield grass
  c.save(); c.clip(P_IGRASS); c.fillStyle = '#2f6f3c'; c.fill(P_IGRASS); drawBands(); c.restore();
  // cutouts
  c.fillStyle = '#b5633a';
  for (const [bx, by] of BASES) { c.beginPath(); c.arc(bx, by, 8, 0, TAU); c.fill(); }
  c.beginPath(); c.arc(0, 0, 13, 0, TAU); c.fill();
  c.fillStyle = '#ad5b34'; c.beginPath(); c.arc(0, 60.5, 9, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,220,180,0.08)'; c.beginPath(); c.arc(0, 60.5, 5, 0, TAU); c.fill();
  // dirt texture speckles near home (cheap)
  // chalk
  c.strokeStyle = 'rgba(244,240,230,0.92)'; c.lineCap = 'butt';
  c.lineWidth = lw(0.33, 1.4);
  c.beginPath(); c.moveTo(0.71, 0); c.lineTo(POLE * S2, POLE * S2); c.moveTo(-0.71, 0); c.lineTo(-POLE * S2, POLE * S2); c.stroke();
  c.lineWidth = lw(0.25, 1.2);
  c.beginPath(); c.arc(-38, -28, 2.6, 0, TAU); c.stroke(); c.beginPath(); c.arc(38, -28, 2.6, 0, TAU); c.stroke();
  c.save(); c.scale(HS, HS); c.lineWidth /= HS;
  c.strokeRect(-5.21, -3.71, 4, 6); c.strokeRect(1.21, -3.71, 4, 6);
  c.beginPath(); c.moveTo(-1.6, -3.71); c.lineTo(-1.6, -8.5 + 3.4 * (HS - 1) / HS); c.lineTo(1.6, -8.5 + 3.4 * (HS - 1) / HS); c.lineTo(1.6, -3.71); c.stroke();
  c.restore();
  // bases
  c.fillStyle = '#f6f2e8';
  for (const [bx, by] of BASES) { c.save(); c.translate(bx, by); c.rotate(Math.PI / 4); c.fillRect(-0.75, -0.75, 1.5, 1.5); c.restore(); }
  c.fillRect(-1, 60.25, 2, 0.5);
  c.save(); c.scale(HS, HS);
  c.beginPath(); c.moveTo(-0.71, 0); c.lineTo(0.71, 0); c.lineTo(0.71, -0.71); c.lineTo(0, -1.42); c.lineTo(-0.71, -0.71); c.closePath(); c.fill();
  c.restore();
  // wall
  c.lineJoin = 'round';
  c.strokeStyle = FIELD.wall; c.lineWidth = 4.4; c.stroke(P_WALL);
  c.strokeStyle = '#e8c547'; c.lineWidth = lw(0.6, 1.2); c.stroke(P_WALLTOP);
  // foul poles
  c.fillStyle = '#ffd84a';
  c.beginPath(); c.arc(POLE * S2 + 1.6, POLE * S2 + 1.6, lw(1.4, 3), 0, TAU); c.fill();
  c.beginPath(); c.arc(-POLE * S2 - 1.6, POLE * S2 + 1.6, lw(1.4, 3), 0, TAU); c.fill();
  // distances
  if (s < 4.5) {
    for (const d of [-41, -22, 0, 22, 41]) {
      const r = fenceR(d) - 8;
      wText(String(Math.round(fenceR(d))), Math.sin(d * D2R) * r, Math.cos(d * D2R) * r, d * D2R, 8, 'rgba(244,240,230,0.82)');
    }
  }
}
function drawLanes(s) {
  const c = ctx, x = 0.83 * HS;
  c.fillStyle = 'rgba(255,255,255,0.045)'; c.fillRect(-x, 0.2, x * 2, 22);
  c.strokeStyle = 'rgba(255,255,255,0.34)'; c.lineWidth = lw(0.08, 1.2);
  c.setLineDash([1.1, 0.9]);
  c.beginPath(); c.moveTo(-x, 0.2); c.lineTo(-x, 22); c.moveTo(x, 0.2); c.lineTo(x, 22); c.stroke();
  c.setLineDash([]);
}
function ellipse(x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); ctx.fill(); }
function person(x, y, face, jersey, cap, o = {}) {
  const c = ctx; c.save(); c.translate(x, y); c.rotate(face - Math.PI / 2);
  if (o.sc && o.sc !== 1) c.scale(o.sc, o.sc);
  c.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(0.4, -0.4, 1.3, 0.8);
  const hands = o.hands || [[0.95, 0.5], [-0.95, 0.5]];
  // arms
  c.strokeStyle = jersey; c.lineWidth = 0.34; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0.85, 0); c.lineTo(hands[0][0], hands[0][1]); c.moveTo(-0.85, 0); c.lineTo(hands[1][0], hands[1][1]); c.stroke();
  c.fillStyle = jersey; ellipse(0, 0, 1.15, 0.6);
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.08; c.stroke();
  hands.forEach((h, i) => {
    if (o.glove === i) { c.fillStyle = '#7a4524'; ellipse(h[0], h[1], 0.36, 0.36); }
    else { c.fillStyle = '#c99068'; ellipse(h[0], h[1], 0.2, 0.2); }
  });
  if (o.knee) { c.fillStyle = o.pants || '#d9d3c4'; ellipse(o.knee[0], o.knee[1], 0.32, 0.32); }
  c.fillStyle = cap; ellipse(0, 0.04, 0.46, 0.46);
  ellipse(0, 0.46, 0.33, 0.2);
  c.restore();
}
function batAngle(now) {
  const sw = G.swing;
  if (!sw) return BAT_REST + Math.sin(now / 380) * 0.07;
  const t = now - sw.start;
  if (t < 0) return BAT_REST;
  if (t < CONTACT_MS) { const k = t / CONTACT_MS; return BAT_REST * (1 - k * k); }
  if (t < CONTACT_MS + 170) { const k = (t - CONTACT_MS) / 170; return 2.5 * (1 - (1 - k) * (1 - k)); }
  if (t < CONTACT_MS + 340) return 2.5;
  const k = Math.min(1, (t - CONTACT_MS - 340) / 420);
  return 2.5 + (BAT_REST + TAU - 2.5) * ease(k);
}
function drawBat(a, alpha) {
  const c = ctx, cs = Math.cos(a), sn = Math.sin(a), px = PIVOT.x, py = PIVOT.y;
  c.globalAlpha = alpha; c.lineCap = 'round';
  c.strokeStyle = '#b98a52'; c.lineWidth = 0.17;
  c.beginPath(); c.moveTo(px - cs * 0.25, py - sn * 0.25); c.lineTo(px + cs * 1.35, py + sn * 1.35); c.stroke();
  c.strokeStyle = '#ddb47b'; c.lineWidth = 0.34;
  c.beginPath(); c.moveTo(px + cs * 1.2, py + sn * 1.2); c.lineTo(px + cs * BAT_LEN, py + sn * BAT_LEN); c.stroke();
  c.strokeStyle = '#1e1e22'; c.lineWidth = 0.2;
  c.beginPath(); c.moveTo(px - cs * 0.2, py - sn * 0.2); c.lineTo(px + cs * 0.45, py + sn * 0.45); c.stroke();
  c.globalAlpha = 1;
}
function drawBatter(now) {
  ctx.save();
  if (HS !== 1) { ctx.translate(0, CONTACT_Y); ctx.scale(HS, HS); ctx.translate(0, -CONTACT_Y); }
  if (HAND() < 0) ctx.scale(-1, 1);
  drawBatterInner(now);
  ctx.restore();
}
function drawBatterInner(now) {
  const team = TEAM();
  const a = batAngle(now);
  const norm = ((a - BAT_REST) % TAU + TAU) % TAU;
  const k = G.swing ? clamp(norm / (2.5 - BAT_REST), 0, 1) : 0;
  const face = lerp(0, 1.1, ease(k));
  const bx = -3.05, by = -0.3, rot = face - Math.PI / 2;
  const c = ctx;
  c.save(); c.translate(bx, by); c.rotate(rot);
  c.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(0.4, -0.4, 1.35, 0.85);
  c.restore();
  const sh = (lx, ly) => [bx + lx * Math.cos(rot) - ly * Math.sin(rot), by + lx * Math.sin(rot) + ly * Math.cos(rot)];
  const s1 = sh(0.9, 0), s2 = sh(-0.9, 0);
  if (G.swing) for (let i = 4; i >= 1; i--) drawBat(batAngle(now - i * 13), 0.09 * (5 - i));
  c.strokeStyle = team.j; c.lineWidth = 0.36; c.lineCap = 'round';
  c.beginPath(); c.moveTo(s1[0], s1[1]); c.lineTo(PIVOT.x, PIVOT.y); c.moveTo(s2[0], s2[1]); c.lineTo(PIVOT.x, PIVOT.y); c.stroke();
  c.save(); c.translate(bx, by); c.rotate(rot);
  c.fillStyle = team.j; ellipse(0, 0, 1.2, 0.62);
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.08; c.stroke();
  c.restore();
  drawBat(a, 1);
  c.fillStyle = '#1b1b1f'; ellipse(PIVOT.x, PIVOT.y, 0.24, 0.24);
  c.fillStyle = team.h; ellipse(bx + 0.1, by + 0.05, 0.53, 0.53);
  ellipse(bx + 0.1, by + 0.52, 0.36, 0.22);
  c.fillStyle = 'rgba(255,255,255,0.18)'; ellipse(bx - 0.08, by + 0.18, 0.18, 0.12);
}
function drawPitcher(now) {
  let w = 0, follow = 0;
  if (G.state === 'windup' && G.wind) w = clamp((now - G.wind.start) / G.wind.dur, 0, 1);
  else if (G.pitch && G.state !== 'between' && now >= G.pitch.release) { w = 1; follow = clamp((now - G.pitch.release) / 280, 0, 1); }
  const stride = ease(clamp((w - 0.55) / 0.45, 0, 1));
  // Enlarged on small screens; shifted so the release hand still meets the ball's start point
  const sc = Math.max(1, 2.4 / cam.s, S0 < 9 ? Math.min(3.2, 18 / S0) : 1);
  const px = (sc - 1) - 1.1 * (HS - 1);
  const by = 61.2 + 2.1 * (sc - 1) - 2.4 * stride - 0.7 * follow;
  let hand;
  if (w < 0.35) hand = [0.15, 0.55];
  else if (w < 0.75) { const t = ease((w - 0.35) / 0.4); hand = [lerp(0.15, 1.35, t), lerp(0.55, -1.3, t)]; }
  else { const t = (w - 0.75) / 0.25; hand = [lerp(1.35, 1.0, t * t), lerp(-1.3, 2.1, t * t)]; }
  if (follow > 0) { const t = ease(follow); hand = [lerp(1.0, -0.7, t), lerp(2.1, 1.3, t)]; }
  const glove = w < 0.35 ? [-0.1, 0.6] : [lerp(-0.1, -1.05, clamp((w - 0.35) / 0.3, 0, 1)), lerp(0.6, 1.25, stride)];
  const knee = w > 0.22 && w < 0.62 ? [-0.25, 0.4 + 0.7 * Math.sin((w - 0.22) / 0.4 * Math.PI)] : null;
  person(px, by, -Math.PI / 2, '#ebe5d6', '#9a2e26', { hands: [hand, glove], glove: 1, knee, sc });
  if (G.state === 'windup' || G.state === 'between') {
    ctx.fillStyle = '#fff'; ellipse(px - hand[0] * sc, by - hand[1] * sc, 0.17 * sc, 0.17 * sc);
  }
}
function drawCatcher(now) {
  let mx = 0;
  if (G.pitch && (G.state === 'pitch')) {
    const prog = clamp((now - G.pitch.release) / G.pitch.totalMs, 0, 1);
    mx = lerp(0, pitchPos(G.pitch, 1).x, ease(clamp(prog * 1.3, 0, 1)));
  } else if (G.lastMitt) mx = G.lastMitt.x;
  const pop = now - G.mittPopAt < 160 ? Math.sin((now - G.mittPopAt) / 160 * Math.PI) * 0.25 : 0;
  person(0, -4.1 - (HS - 1), Math.PI / 2, '#2a3038', '#20252b', { hands: [[0.9, 0.3], [clamp(mx, -1.9, 1.9) - 0.0, 0.85 - pop]], glove: 1, sc: HS });
}
function drawUmpire(now) {
  const punch = now < G.umpPunchUntil;
  person(0.7 * HS, -6.6 - 2.5 * (HS - 1), Math.PI / 2, '#1c2432', '#131924', { hands: punch ? [[2.0, 0.4], [-0.9, 0.4]] : [[0.9, 0.35], [-0.9, 0.35]], sc: HS });
}
function drawBall(x, y, z, R, alpha) {
  const c = ctx;
  c.globalAlpha = alpha * 0.35; c.fillStyle = '#000';
  ellipse(x + z * 0.3, y - z * 0.3, R * 0.95, R * 0.8);
  c.globalAlpha = alpha;
  const gx = x, gy = y;
  c.fillStyle = 'rgba(255,255,240,0.18)'; ellipse(gx, gy, R * 2.1, R * 2.1);
  c.fillStyle = '#fbf8f0'; ellipse(gx, gy, R, R);
  if (R * cam.s > 5) {
    c.strokeStyle = '#d23a2e'; c.lineWidth = R * 0.14;
    c.beginPath(); c.arc(gx - R * 0.9, gy, R * 0.75, -0.9, 0.9); c.stroke();
    c.beginPath(); c.arc(gx + R * 0.9, gy, R * 0.75, Math.PI - 0.9, Math.PI + 0.9); c.stroke();
  }
  c.globalAlpha = 1;
}
function drawBalls(now, s) {
  const baseR = Math.max(0.42 * HS, (S0 < 8 ? 5 : 3.6) / s);
  if (G.state === 'pitch' && G.pitch) {
    const p = G.pitch;
    let prog = (now - p.release) / p.totalMs;
    if (G.pending && prog > PC) prog = PC;
    prog = Math.min(prog, 1);
    for (let i = 6; i >= 1; i--) {
      const q = prog - i * 0.011; if (q < 0) continue;
      const b = pitchPos(p, q);
      ctx.globalAlpha = 0.07 * (7 - i); ctx.fillStyle = '#fff'; ellipse(b.x * HS, b.y, baseR * (1 - i * 0.08), baseR * (1 - i * 0.08)); ctx.globalAlpha = 1;
    }
    const b = pitchPos(p, prog);
    if (p.dirt && Math.abs(prog / PC - p.bq) < 0.02 && !p.dusted) { p.dusted = true; dust(b.x * HS, b.y, 1); }
    drawBall(b.x * HS, b.y, b.z, baseR * (1 + b.z * 0.03), 1);
  } else if ((G.state === 'after' || G.state === 'between') && G.lastMitt && !G.hit) {
    drawBall(G.lastMitt.x * HS, G.lastMitt.y + 0.5, 1.5, 0.35 * HS, 0.9);
  }
  const h = G.hit;
  if (h && h.pos && (G.state === 'inplay' || G.state === 'after')) {
    const R = Math.max(0.42, (S0 < 8 ? 5.2 : 4.2) / s) * (1 + h.pos.z / 70);
    if (h.trail.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < h.trail.length; i++) {
        const a = i / h.trail.length;
        ctx.strokeStyle = `rgba(255,248,225,${a * 0.5})`; ctx.lineWidth = R * 1.3 * a;
        ctx.beginPath(); ctx.moveTo(h.trail[i - 1][0], h.trail[i - 1][1]); ctx.lineTo(h.trail[i][0], h.trail[i][1]); ctx.stroke();
      }
    }
    drawBall(h.pos.x, h.pos.y, h.pos.z, R, 1);
  }
}
function drawGhostBalls(now, s) {
  if (s > 4) return;
  for (const g of ghostHits) {
    const p = (now - g.start) / 1900; if (p > 1.2) continue;
    const pp = Math.min(1, p), r = g.d * (1 - Math.pow(1 - pp, 1.35));
    const x = Math.sin(g.a) * r, y = Math.cos(g.a) * r;
    const R = Math.max(0.5, 4 / s);
    ctx.globalAlpha = 0.65 * (p > 1 ? (1.2 - p) * 5 : 1);
    ctx.strokeStyle = g.color; ctx.lineWidth = R * 0.5; ctx.beginPath(); ctx.arc(x, y, R * 1.6, 0, TAU); ctx.stroke();
    ctx.fillStyle = g.color; ellipse(x, y, R, R);
    ctx.globalAlpha = 1;
  }
}
function drawParts(s) {
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    if (p.life < 0) continue;
    const t = p.life / p.max;
    if (p.k === 'spark' || p.k === 'fw') {
      ctx.globalAlpha = (1 - t) * (p.k === 'fw' ? 0.95 : 1);
      ctx.fillStyle = p.c; const r = (p.size / s) * (p.k === 'fw' ? 1 : 1);
      ellipse(p.x, p.y, Math.max(r, 0.08), Math.max(r, 0.08));
    } else if (p.k === 'ring') {
      ctx.globalAlpha = (1 - t) * 0.8; ctx.strokeStyle = '#fff3d2'; ctx.lineWidth = lw(0.12, 2);
      ctx.beginPath(); ctx.arc(p.x, p.y, lerp(p.r0, p.r1, ease(t)), 0, TAU); ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const p of parts) {
    if (p.k !== 'dust' || p.life < 0) continue;
    const t = p.life / p.max;
    ctx.globalAlpha = (1 - t) * 0.5; ctx.fillStyle = '#d2915f';
    const r = p.r * (0.6 + t); ellipse(p.x, p.y, r, r);
  }
  ctx.globalAlpha = 1;
}
function drawMini(now) {
  const m = mctx, ms = 0.235;
  m.setTransform(DPR, 0, 0, DPR, 0, 0); m.clearRect(0, 0, 170, 128);
  m.setTransform(DPR * ms, 0, 0, -DPR * ms, DPR * 85, DPR * (420 * ms + 6));
  m.fillStyle = '#1e4a2c'; m.fill(P_SURF);
  m.fillStyle = '#25583a'; m.fill(P_FAIR);
  m.save(); m.clip(P_WIDE); m.fillStyle = '#8f5434'; m.beginPath(); m.arc(0, 60.5, 95, 0, TAU); m.fill(); m.restore();
  m.fillStyle = '#25583a'; m.fill(P_IGRASS);
  m.strokeStyle = 'rgba(241,236,224,.5)'; m.lineWidth = 4; m.stroke(P_FENCE);
  for (const sp of G.spray) {
    const r = Math.hypot(sp.x, sp.y), k = r > 412 ? 412 / r : 1;
    m.fillStyle = sp.hr ? '#ffb547' : '#f1ece0'; m.beginPath(); m.arc(sp.x * k, sp.y * k, sp.hr ? 10 : 7, 0, TAU); m.fill();
  }
  for (const g of ghostHits) {
    const age = (now - g.start) / 1000, p = Math.min(1, age / 1.9), r = g.d * (1 - Math.pow(1 - p, 1.35));
    const x = Math.sin(g.a) * r, y = Math.cos(g.a) * r;
    const fade = age > 6 ? Math.max(0, 1 - (age - 6) / 3) : 1;
    m.globalAlpha = 0.55 * fade; m.strokeStyle = g.color; m.lineWidth = 4;
    m.beginPath(); m.moveTo(0, 0); m.lineTo(x, y); m.stroke();
    m.globalAlpha = fade; m.fillStyle = g.color; m.beginPath(); m.arc(x, y, g.k === 'hr' ? 11 : 8, 0, TAU); m.fill();
    m.globalAlpha = 1;
  }
  const h = G.hit;
  if (h && h.pos && !h.foul && !G.demo) { m.fillStyle = '#fff'; m.beginPath(); m.arc(h.pos.x, h.pos.y, 8, 0, TAU); m.fill(); }
}

/* =========================================================
   HUD
   ========================================================= */
function setText(sel, v) { const el = $(sel); if (el.textContent !== String(v)) el.textContent = v; }
function pulse(el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
const hearts = createHearts($('#hearts'), { count: 3 });
const buildHearts = () => hearts.build();
function updHearts(anim) { hearts.set(G.hearts); }
function updStreak(up) {
  setText('#sStreak', G.streak);
  const m = multFor(G.streak);
  setText('#sMult', '×' + (m % 1 ? m.toFixed(1) : m));
  if (up) { pulse($('#sStreak')); if (G.streak && G.streak % 5 === 0) pulse($('#sMult')); }
}
function updRadar(p) { if (!p) return; setText('#sMph', p.mph); setText('#sType', p.name); pulse($('#sMph')); }
let calloutTimer = 0;
function showCallout(big, sub, cls, pts) {
  const el = $('#callout');
  el.className = '';
  el.querySelector('.big').textContent = big;
  const s = el.querySelector('.sub'); s.textContent = sub || '';
  if (pts) { const b = document.createElement('b'); b.textContent = pts; s.appendChild(b); }
  void el.offsetWidth;
  el.className = 'show ' + (cls || '');
}
const METER_RANGE = 130;
function buildMeter() {
  const zones = [['miss', 130, 'rgba(255,255,255,.08)'], ['foul', WIN.foul, '#5d4b39'], ['ok', WIN.ok, '#8a7247'], ['good', WIN.good, '#c08f3f'], ['great', WIN.great, '#eab04c'], ['perfect', WIN.perfect, '#fff2c8']];
  const stops = [];
  const pct = v => 50 + v / METER_RANGE * 50;
  for (let i = 0; i < zones.length; i++) { const z = zones[i]; stops.push(`${z[2]} ${pct(-z[1])}%`, `${z[2]} ${pct(-(zones[i + 1] ? zones[i + 1][1] : 0))}%`); }
  for (let i = zones.length - 1; i >= 0; i--) { const z = zones[i]; stops.push(`${z[2]} ${pct(zones[i + 1] ? zones[i + 1][1] : 0)}%`, `${z[2]} ${pct(z[1])}%`); }
  $('#mbar').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
}
let meterTimer = 0;
function showMeter(err, label) {
  const a = Math.abs(err), q = qualityOf(a);
  $('#mq').textContent = label || Q_LABEL[q];
  $('#mval').textContent = a < 3 ? 'right on time' : `${Math.round(a)} ms ${err < 0 ? 'early' : 'late'}`;
  $('#mark').style.left = clamp(50 + err / METER_RANGE * 50, 1, 99) + '%';
  $('#meter').classList.add('show');
  clearTimeout(meterTimer); meterTimer = setTimeout(() => $('#meter').classList.remove('show'), 1700);
}
function resetHud() {
  G.disp = 0; setText('#sScore', '0'); updStreak(false); buildHearts(); updHearts(false); updCount();
  const derby = RUN_MODE === 'derby';
  $('#hearts').hidden = derby; $('#sLeft').hidden = !derby; $('#sCount').hidden = derby; $('#sHRs').hidden = !derby;
  setText('#sOutsLab', derby ? 'Pitches left' : 'Outs left'); setText('#sCountLab', derby ? 'Home runs' : 'Count');
  setText('#sStreakLab', derby ? 'HR streak' : 'Hit streak');
  setText('#sLeft', G.left); setText('#sHRs', G.hrs);
  setText('#sMph', '-'); setText('#sType', 'Radar gun');
}

/* =========================================================
   Pace vs ghost
   ========================================================= */
async function pickGhost() {
  let best = null;
  const daily = RUN_MODE === 'daily', today = todayKey();
  if (RUN_MODE === 'derby') { G.ghost = null; setPaceHidden(true); return; }
  for (const [id, d] of players) {
    const sc = daily ? (d.dailyDate === today ? +d.dailyBest || 0 : 0) : +d.bestScore || 0;
    const arr = daily ? d.dailyGhost : d.ghost;
    if (Array.isArray(arr) && arr.length && sc > (best ? best.score : 0)) best = { id, score: sc, arr: arr.map(n => +n || 0) };
  }
  if (!best) {
    if (daily && local.daily && local.daily.date === today && local.daily.pace.length) best = { id: myId, score: local.daily.score, arr: local.daily.pace };
    else if (!daily && local.pace && local.pace.length) best = { id: myId, score: local.bestScore, arr: local.pace };
  }
  G.ghost = best;
  if (!best) { setPaceHidden(true); return; }
  let label = RUN_MODE === 'daily' ? 'your run today' : 'your best run';
  if (best.id && best.id !== myId && USER) { const ps = await USER.profiles([best.id]); label = `${(ps[best.id] && ps[best.id].name) || 'Top run'}’s best`; }
  else if (best.id && best.id !== myId) label = `${cleanIni((players.get(best.id) || {}).initials) || 'Top run'}’s best`;
  G.ghost.label = label;
  updPace();
}
function updPace() {
  const g = G.ghost, el = $('#pace');
  if (!g || G.demo) { setPaceHidden(true); return; }
  setPaceHidden(false);
  const i = G.pitches - 1;
  const gs = i < 0 ? 0 : g.arr[Math.min(i, g.arr.length - 1)];
  const done = i >= g.arr.length - 1 && i >= 0;
  const d = G.score - gs;
  $('#paceName').textContent = done ? `Past ${g.label}'s final pitch` : `Pace vs ${g.label}`;
  const delta = $('#paceDelta');
  delta.textContent = (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toLocaleString();
  delta.className = d > 0 ? 'up' : d < 0 ? 'down' : '';
  const max = Math.max(g.score, G.score, 1);
  $('#paceYou').style.left = (G.score / max * 100) + '%';
  $('#paceGhost').style.left = (gs / max * 100) + '%';
}

/* =========================================================
   Run lifecycle
   ========================================================= */
let local = store.get('ss.best', { bestScore: 0, bestStreak: 0, longestHR: 0, pace: [] });
function startRun() {
  ensureAudio();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  RUN_MODE = OPTS.mode;
  prng = RUN_MODE === 'daily' ? dailyRng('baseball') : Math.random;
  Object.assign(G, { balls: 0, strikes: 0, demo: false, score: 0, disp: 0, streak: 0, runBestStreak: 0, hearts: 3, left: DERBY_PITCHES, pitches: 0, hits: 0, hrs: 0, longestHR: 0, pace: [], spray: [], hit: null, pitch: null, swing: null, pending: null, pendingMiss: null, lastMitt: null, hrPending: false });
  resetHud();
  $('#menu').classList.remove('show'); $('#over').classList.remove('show');
  if (!app.classList.contains('wide')) app.classList.remove('panel-open');
  pickGhost();
  scheduleNext(900);
  pushPresence();
}
function gameOver() {
  G.state = 'over';
  const daily = RUN_MODE === 'daily', today = todayKey();
  const prevDaily = local.daily && local.daily.date === today ? local.daily.score : 0;
  const derby = RUN_MODE === 'derby';
  const prevBest = derby ? +local.derby || 0 : daily ? prevDaily : local.bestScore;
  const isPB = G.score > prevBest;
  $('#oHead').textContent = derby ? `HR derby, ${DERBY_PITCHES} pitches` : daily ? `Daily challenge, ${today}` : 'That\'s three outs';
  $('#oScore').textContent = G.score.toLocaleString();
  $('#oStreak').textContent = G.runBestStreak;
  $('#oHR').textContent = G.longestHR ? G.longestHR + ' ft' : '-';
  $('#oHits').textContent = G.hits;
  $('#oHRs').textContent = G.hrs;
  $('#oLine').textContent = isPB && prevBest > 0 ? (derby ? 'New derby best' : daily ? 'New best for today' : 'New personal best')
    : isPB ? (derby ? 'First derby on the books' : daily ? 'Today\'s run is on the books' : 'First run on the books')
    : prevBest > 0 ? `Your ${derby ? 'derby ' : ''}best${daily ? ' today' : ''} is ${prevBest.toLocaleString()}`
    : derby ? 'Only homers score. Square one up and the pitch is free.' : 'Swing at the strikes and let the wide ones go';
  $('#oNote').textContent = '';
  // Does this run change anything on the board? Then it earns initials.
  const cp = (DB && myId && players.get(myId)) || null;
  const bestS = cp ? +cp.bestScore || 0 : local.bestScore;
  const bestK = cp ? +cp.bestStreak || 0 : local.bestStreak;
  const bestH = cp ? +cp.longestHR || 0 : local.longestHR;
  const bestD = cp ? (cp.dailyDate === today ? +cp.dailyBest || 0 : 0) : prevDaily;
  const bestY = cp ? +cp.derbyBest || 0 : +local.derby || 0;
  const recs = [];
  if (derby) { if (G.score > bestY) recs.push('derby best'); }
  else {
    if (daily && G.score > bestD) recs.push('today\'s best');
    if (G.score > bestS) recs.push('high score');
    if (G.runBestStreak > bestK) recs.push('hit streak');
  }
  if (G.longestHR > bestH) recs.push('longest homer');
  const qualifies = G.score > 0 && recs.length > 0;
  // Derby runs keep their own best; they never touch the three-outs records
  const allPB = !derby && G.score > local.bestScore;
  local = {
    bestScore: derby ? local.bestScore : Math.max(local.bestScore, G.score),
    bestStreak: derby ? local.bestStreak : Math.max(local.bestStreak, G.runBestStreak),
    longestHR: Math.max(local.longestHR, G.longestHR), pace: allPB ? G.pace.slice(0, 400) : local.pace,
    daily: daily ? (isPB ? { date: today, score: G.score, pace: G.pace.slice(0, 400) } : local.daily) : local.daily,
    derby: derby ? Math.max(prevBest, G.score) : +local.derby || 0
  };
  store.set('ss.best', local);
  $('#over').classList.add('show');
  G.demo = true; G.hit = null; prng = Math.random; resetCount();
  setPaceHidden(true);
  pushPresence();
  if (qualifies) {
    $('#iniHead').textContent = recs.includes('high score') || recs.includes('today\'s best') ? 'New high score' : `New ${recs[0]}`;
    ini.open(v => submitRun(isPB, v));
  } else {
    ini.close();
    setTimeout(() => $('#again').focus({ preventScroll: true }), 50);
    submitRun(isPB, store.get('ss.ini', ''));
  }
  scheduleNext(1600);
}

/* =========================================================
   Pinball initials
   ========================================================= */
const ini = createInitials({
  onOpen() { $('#oActions').hidden = true; app.classList.toggle('entering', TOUCH); },
  onClose() { $('#oActions').hidden = false; app.classList.remove('entering'); },
  onDone() {
    pushPresence(); renderBoard();
    setTimeout(() => $('#again').focus({ preventScroll: true }), 50);
  }
});

/* =========================================================
   Input
   ========================================================= */
const evTime = e => { const t = e.timeStamp, n = performance.now(); return (t > 0 && Math.abs(t - n) < 500) ? t : n; };
function overlayUp() { return $('#menu').classList.contains('show') || $('#over').classList.contains('show'); }
window.addEventListener('keydown', e => {
  if (ini.active) { ini.key(e); return; }
  if (e.code === 'Space' || e.key === ' ') {
    if (e.target && e.target.closest && e.target.closest('#panel') && e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    if (e.repeat) return;
    if (overlayUp()) { startRun(); return; }
    if (!G.demo) doSwing(evTime(e));
  } else if (e.key === 'l' || e.key === 'L') togglePanel();
  else if (e.key === 'm' || e.key === 'M') toggleMute();
  else if (e.key === 'Escape' && app.classList.contains('panel-open') && !app.classList.contains('wide')) togglePanel(false);
  else if (e.key === 'Escape' && $('#over').classList.contains('show')) toMenu();
});
cvs.addEventListener('pointerdown', e => {
  if (overlayUp() || G.demo) return;
  ensureAudio();
  doSwing(evTime(e));
});
$('#play').addEventListener('click', startRun);
$('#again').addEventListener('click', startRun);
$('#seeBoard').addEventListener('click', () => togglePanel(true));
function toMenu() {
  if (ini.active) return;
  $('#over').classList.remove('show');
  $('#menu').classList.add('show');
  renderOpts();
  $('#menuBest').innerHTML = local.bestScore > 0 ? `Your best: <strong>${local.bestScore.toLocaleString()}</strong>. ${startHint}` : startHint;
  if (!app.classList.contains('wide')) app.classList.remove('panel-open');
  setTimeout(() => $('#play').focus({ preventScroll: true }), 50);
}
$('#toMenu').addEventListener('click', toMenu);
$('#panelToggle').addEventListener('click', () => togglePanel());
$('#closePanel').addEventListener('click', () => togglePanel(false));
function togglePanel(force) {
  const open = force != null ? force : !app.classList.contains('panel-open');
  app.classList.toggle('panel-open', open);
  $('#panelToggle').setAttribute('aria-expanded', String(open));
  store.set('ss.panel', open);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setBoardTab(b.dataset.tab)));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (G.state === 'windup' || G.state === 'pitch')) {
    G.swing = null; G.pending = null; G.pendingMiss = null; G.pitch = null; G.state = 'between'; G.nextAt = performance.now() + 1400;
  }
});
window.addEventListener('resize', resize);

/* =========================================================
   Audio (synthesized)
   ========================================================= */
/* Crowd hum under the game, started once the AudioContext exists. */
onAudioReady(({ ctx, master, nb }) => {
  const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 0.5;
  const g = ctx.createGain(); g.gain.value = 0.022;
  src.connect(f).connect(g).connect(master); src.start();
});
bindMuteButton($('#mute'));
const sfx = {
  ...coreSfx,
  whoosh() { nz({ dur: 0.22, f: 380, f2: 2400, q: 0.8, g: 0.16, a: 0.07 }); },
  crack(p) { nz({ dur: 0.08, type: 'highpass', f: 1700, g: 0.9 * p + 0.1, a: 0.001 }); nz({ dur: 0.05, f: 3300, q: 5, g: 0.5 * p, a: 0.001 }); tn({ f: 200, f2: 85, dur: 0.13, type: 'triangle', g: 0.55 * p + 0.05, a: 0.001 }); },
  pop() { nz({ dur: 0.07, type: 'lowpass', f: 900, g: 0.6, a: 0.001 }); tn({ f: 150, f2: 70, dur: 0.09, g: 0.4, a: 0.001 }); },
  release() { nz({ dur: 0.14, f: 900, f2: 300, q: 1, g: 0.05, a: 0.03 }); },
  out: coreSfx.heartLost,
  eye: coreSfx.perfect,
  crowd(big) { nz({ dur: big ? 3.4 : 1.5, f: 900, q: 0.6, g: big ? 0.3 : 0.12, a: big ? 0.25 : 0.15 }); nz({ dur: big ? 3.1 : 1.3, f: 2500, q: 0.7, g: big ? 0.11 : 0.04, a: 0.2 }); },
  organ() { [392, 523.25, 659.25, 783.99].forEach((f, i) => tn({ f, dur: i === 3 ? 0.65 : 0.17, type: 'square', g: 0.045, delay: 0.25 + i * 0.13 })); }
};

/* =========================================================
   Cloud: leaderboard (db), identity (user), live ghosts (room)
   ========================================================= */
let DB = null, USER = null, ROOM = null, myId = null;
/* Local dev never writes to the shared leaderboard unless ?cloud=1 is in the URL. */
const cloudWrite = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || new URLSearchParams(location.search).has('cloud');
const players = new Map();
let boardTab = 'score';
const TABS = {
  today: { key: 'dailyBest', fmt: v => v.toLocaleString(), filter: d => d.dailyDate === todayKey() },
  score: { key: 'bestScore', fmt: v => v.toLocaleString() },
  streak: { key: 'bestStreak', fmt: v => String(v) },
  hr: { key: 'longestHR', fmt: v => v + ' ft' },
  derby: { key: 'derbyBest', fmt: v => v.toLocaleString() }
};
/* Supabase backend: see core/leaderboard */
let SB = null;
async function fetchBoard() {
  if (!SB) return;
  const { data, error } = await SB.from('sweet_spot_players')
    .select('id,initials,best_score,best_streak,longest_hr,ghost,daily_date,daily_best,daily_ghost,derby_best')
    .order('best_score', { ascending: false }).limit(500);
  if (error) { if (!players.size) { DB = null; localBoard(); } return; }
  DB = DB || {};
  players.clear();
  for (const r of data) players.set(r.id, {
    initials: r.initials, bestScore: r.best_score, bestStreak: r.best_streak, longestHR: r.longest_hr,
    ghost: r.ghost, dailyDate: r.daily_date, dailyBest: r.daily_best, dailyGhost: r.daily_ghost, derbyBest: r.derby_best
  });
  renderBoard();
}
async function initCloud() {
  SB = getClient();
  if (!SB) { localBoard(); return; }
  myId = identity().id;
  DB = {};
  await fetchBoard();
  setInterval(() => { if (!document.hidden) fetchBoard(); }, 45000);
  try {
    ROOM = supaRoom(SB, myId, { channel: 'sweet-spot-field', events: ['hit', 'board'] });
    ROOM.onPeers(() => renderLive());
    ROOM.on('board', () => fetchBoard());
    ROOM.on('hit', m => {
      const d = m.data || {};
      const a = +d.a, dist = +d.d;
      if (!isFinite(a) || !isFinite(dist) || dist < 0 || dist > 520 || Math.abs(a) > 60) return;
      addGhostHit(m.by, a, dist, d.k === 'hr' ? 'hr' : String(d.k || ''));
    });
    pushPresence();
  } catch (e) { ROOM = null; }
}
async function addGhostHit(by, aDeg, dist, kind) {
  let color = colorFor(by), name = 'Someone', avatar = '';
  if (ROOM) { const peer = ROOM.peers().find(p => p.by === by); if (peer && peer.presence && cleanIni(peer.presence.ini)) name = cleanIni(peer.presence.ini); }
  ghostHits.push({ a: aDeg * D2R, d: dist, k: kind, start: performance.now(), color });
  if (ghostHits.length > 24) ghostHits.shift();
  const pIni = cleanIni((players.get(by) || {}).initials);
  if (kind === 'hr') toast(avatar, `${pIni || name} hit a ${Math.round(dist)} ft home run`);
}
function emitHit(h) {
  if (!ROOM) return;
  try { ROOM.emit('hit', { a: Math.round(h.deg * 10) / 10, d: Math.round(h.d), k: h.kind }).catch(() => {}); } catch (e) {}
}
let presTimer = 0, lastPres = '';
function pushPresence() {
  if (!ROOM) return;
  clearTimeout(presTimer);
  presTimer = setTimeout(() => {
    const p = { playing: !G.demo, score: G.score, streak: G.streak, hearts: G.hearts, ini: cleanIni(store.get('ss.ini', '')) };
    const key = JSON.stringify(p); if (key === lastPres) return; lastPres = key;
    try { ROOM.presence(p).catch(() => {}); } catch (e) {}
  }, 250);
}
let renderTok = 0;
function localBoard() {
  const tab = TABS[boardTab];
  const v = boardTab === 'today' ? (local.daily && local.daily.date === todayKey() ? local.daily.score : 0) : boardTab === 'derby' ? +local.derby || 0 : +local[tab.key] || 0;
  const ol = $('#board'); ol.innerHTML = '';
  if (v > 0) {
    const li = document.createElement('li'); li.className = 'me';
    li.innerHTML = '<span class="rk">1</span><span class="ini"></span><span class="nm"></span><span class="vl"></span>';
    li.querySelector('.ini').textContent = cleanIni(store.get('ss.ini', '')) || '···';
    li.querySelector('.nm').textContent = 'This device';
    li.querySelector('.vl').textContent = tab.fmt(v);
    ol.appendChild(li);
  }
  $('#boardNote').textContent = 'Can\'t reach the shared leaderboard right now. Your bests are kept on this device in the meantime.';
}
async function renderBoard() {
  if (!DB) { localBoard(); return; }
  const tok = ++renderTok, tab = TABS[boardTab];
  const rows = [...players.entries()].filter(([, d]) => !tab.filter || tab.filter(d)).map(([id, d]) => ({ id, v: +d[tab.key] || 0 })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  const ol = $('#board'), note = $('#boardNote');
  if (!rows.length) { ol.innerHTML = ''; note.textContent = boardTab === 'today' ? 'No one has played today\'s challenge yet. Pick Daily challenge and set the pace.' : boardTab === 'derby' ? 'No derby scores yet. Pick HR derby and put one over the wall.' : 'No scores yet. Finish a run to claim the top spot.'; return; }
  const show = rows.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
  const mi = rows.findIndex(r => r.id === myId);
  if (mi >= 10) show.push({ ...rows[mi], rank: mi + 1, gap: true });
  const ps = USER ? await USER.profiles(show.map(r => r.id)) : {};
  if (tok !== renderTok) return;
  ol.innerHTML = '';
  for (const r of show) {
    const p = ps[r.id] || {};
    const li = document.createElement('li');
    if (r.id === myId) li.classList.add('me');
    if (r.gap) li.classList.add('gap');
    const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = r.rank;
    const ini = document.createElement('span'); ini.className = 'ini'; ini.textContent = cleanIni((players.get(r.id) || {}).initials) || '···';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.id === myId ? 'You' : (p.name || '');
    const vl = document.createElement('span'); vl.className = 'vl'; vl.textContent = tab.fmt(r.v);
    li.append(rk, ini, nm, vl); ol.appendChild(li);
  }
  note.textContent = boardTab === 'today' ? 'Everyone faces the same pitches today. Resets at midnight UTC.' : boardTab === 'streak' ? 'Most hits in a row without making an out.' : boardTab === 'hr' ? 'Longest home run in a single swing.' : boardTab === 'derby' ? `Best HR derby score. ${DERBY_PITCHES} pitches, and homers don\'t use one up.` : 'Best score in one run of three outs.';
}
let liveTok = 0;
async function renderLive() {
  if (!ROOM) return;
  const tok = ++liveTok;
  const peers = ROOM.peers().filter(p => !p.isMe && p.presence && p.presence.playing);
  const ids = [...new Set(peers.map(p => p.by).filter(Boolean))];
  const ps = USER && ids.length ? await USER.profiles(ids) : {};
  if (tok !== liveTok) return;
  const ul = $('#live'); ul.innerHTML = '';
  $('#liveNote').hidden = peers.length > 0;
  peers.sort((a, b) => (+b.presence.score || 0) - (+a.presence.score || 0));
  for (const p of peers) {
    const pr = (p.by && ps[p.by]) || {};
    const li = document.createElement('li');
    const img = document.createElement('img'); img.alt = '';
    if (pr.avatarUrl) img.src = pr.avatarUrl; else { img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; img.style.background = colorFor(p.by); }
    const mid = document.createElement('div');
    const pIni = cleanIni(p.presence.ini) || cleanIni((players.get(p.by) || {}).initials);
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = pIni ? `${pIni}  ${pr.name || ''}`.trim() : (pr.name || 'Player');
    const meta = document.createElement('div'); meta.className = 'meta';
    const dot = document.createElement('span'); dot.className = 'dot';
    meta.append(dot, document.createTextNode(`Streak ${Math.max(0, +p.presence.streak || 0)}`));
    mid.append(nm, meta);
    const sc = document.createElement('div'); sc.className = 'sc'; sc.textContent = (Math.max(0, +p.presence.score || 0)).toLocaleString();
    const hs = document.createElement('span'); hs.className = 'hs'; hs.textContent = '♥'.repeat(clamp(+p.presence.hearts || 0, 0, 3));
    sc.appendChild(hs);
    li.append(img, mid, sc); ul.appendChild(li);
  }
}
function toast(avatar, text) {
  const box = $('#toasts');
  const el = document.createElement('div'); el.className = 'toast';
  if (avatar) { const img = document.createElement('img'); img.alt = ''; img.src = avatar; el.appendChild(img); }
  const sp = document.createElement('span'); sp.textContent = text; el.appendChild(sp);
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
}
async function submitRun(isPB, initials) {
  if (!cloudWrite) {
    $('#oNote').textContent = 'Local test run. Not sent to the leaderboard (add ?cloud=1 to send).';
    return;
  }
  if (!SB || !myId) {
    $('#oNote').textContent = 'Couldn’t reach the leaderboard. This run is saved on this device.';
    return;
  }
  const prev = players.get(myId) || {};
  const today = todayKey();
  const { sec } = identity();
  const ini = cleanIni(initials) || cleanIni(prev.initials) || null;
  const derby = RUN_MODE === 'derby';
  const { error } = derby
    ? await SB.rpc('sweet_spot_submit_derby', { p_id: myId, p_secret: sec, p_initials: ini, p_score: G.score, p_homers: G.hrs, p_hr: G.longestHR })
    : await SB.rpc('sweet_spot_submit', {
      p_id: myId, p_secret: sec, p_initials: ini,
      p_score: G.score, p_streak: G.runBestStreak, p_hr: G.longestHR, p_homers: G.hrs,
      p_pace: G.pace.slice(0, 400), p_daily: RUN_MODE === 'daily'
    });
  if (error) {
    $('#oNote').textContent = 'Couldn’t reach the leaderboard just now. This run is saved on this device.';
    return;
  }
  if (derby) {
    if (G.score > (+prev.derbyBest || 0)) {
      const rank = [...players.entries()].filter(([id, d]) => id !== myId && (+d.derbyBest || 0) > G.score).length + 1;
      $('#oNote').textContent = rank === 1 ? 'That puts you at the top of the derby board.' : `That puts you at #${rank} on the derby board.`;
    }
    await fetchBoard();
    if (ROOM) { try { ROOM.emit('board', {}).catch(() => {}); } catch (e) {} }
    return;
  }
  const beatCloud = G.score > (+prev.bestScore || 0);
  const beatDaily = RUN_MODE === 'daily' && (prev.dailyDate !== today || G.score > (+prev.dailyBest || 0));
  if (beatDaily) {
    const rank = [...players.entries()].filter(([id, d]) => id !== myId && d.dailyDate === today && (+d.dailyBest || 0) > G.score).length + 1;
    $('#oNote').textContent = rank === 1 ? 'You lead today\'s challenge.' : `You're #${rank} in today's challenge.`;
  } else if (beatCloud) {
    const rank = [...players.entries()].filter(([id, d]) => id !== myId && (+d.bestScore || 0) > G.score).length + 1;
    $('#oNote').textContent = rank === 1 ? 'That puts you at the top of the board.' : `That puts you at #${rank} on the board.`;
  }
  await fetchBoard();
  if (ROOM) { try { ROOM.emit('board', {}).catch(() => {}); } catch (e) {} }
}

/* =========================================================
   Boot
   ========================================================= */
function setBoardTab(t) {
  boardTab = t;
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === t)));
  renderBoard();
}
function renderOpts() {
  document.querySelectorAll('#optMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === OPTS.mode)));
  document.querySelectorAll('#optHand button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === OPTS.hand)));
  document.querySelectorAll('#optTeam button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === OPTS.team)));
  $('#modeNote').textContent = OPTS.mode === 'daily'
    ? `Everyone gets the same ${todayKey()} pitch sequence. Your pace bar chases today's leader, pitch for pitch.`
    : OPTS.mode === 'derby' ? `${DERBY_PITCHES} pitches, mostly fastballs. Only home runs score. Homers and pitches you don't swing at are free.`
    : 'Random pitches every run. Scores count toward the all-time board.';
}
const MODE_TAB = { daily: 'today', derby: 'derby' };
function saveOpts() { store.set('ss.opts', OPTS); renderOpts(); }
const tw = $('#optTeam');
for (const t of TEAMS) {
  const b = document.createElement('button');
  b.dataset.v = t.id; b.setAttribute('aria-label', t.name); b.title = t.name;
  b.style.setProperty('--j', t.j); b.style.setProperty('--h', t.h);
  b.addEventListener('click', () => { OPTS.team = t.id; saveOpts(); });
  tw.appendChild(b);
}
document.querySelectorAll('#optMode button').forEach(b => b.addEventListener('click', () => { OPTS.mode = b.dataset.v; saveOpts(); setBoardTab(MODE_TAB[OPTS.mode] || 'score'); }));
document.querySelectorAll('#optHand button').forEach(b => b.addEventListener('click', () => { OPTS.hand = b.dataset.v; saveOpts(); }));
renderOpts();
if (MODE_TAB[OPTS.mode]) { boardTab = MODE_TAB[OPTS.mode]; document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === boardTab))); }
buildHearts(); buildMeter(); updStreak(false);
const startHint = TOUCH ? 'Tap the field to swing.' : 'Press <kbd>Space</kbd> to start.';
$('#menuBest').innerHTML = local.bestScore > 0 ? `Your best: <strong>${local.bestScore.toLocaleString()}</strong>. ${startHint}` : startHint;
{
  const a = document.createElement('a'); a.href = FIELD.href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = FIELD.url;
  $('#fieldAd').append(`Tonight's field: ${FIELD.name}. `, a);
}
resize();
const panelPref = store.get('ss.panel', null);
togglePanel(panelPref != null ? panelPref && app.classList.contains('wide') : app.classList.contains('wide') && W >= 1180);
resize();
cam.s = camTarget().s;
const boot = () => { buildCrowd(); scheduleNext(1200); requestAnimationFrame(t => { last = t; frame(t); }); };
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(boot, boot);
localBoard();
initCloud();
