/* Sweet Spot Drag Racing.
   Tap on green to launch (reaction time is everything), then tap once per
   gear with the needle in the shift band. Race the leader's ghost to the line.
   Race math lives in logic.js; this file handles input, sound and drawing. */
import { clamp, REDUCE } from '../../core/util.js';
import { dailyRng, mulberry32 } from '../../core/seed/seed.js';
import { A, nz, tn, coreSfx, onAudioReady } from '../../core/audio/audio.js';
import { mountShell } from '../../core/ui/shell.js';
import { shade, isLight } from '../../core/ui/teams.js';
import { getTop } from '../../core/leaderboard/scores.js';
import { cleanIni } from '../../core/initials/initials.js';
import { secs } from '../../core/games.js';
import * as L from './logic.js';
import C from './config.js';

/* A session with no clean run still goes through gameOver (submit: false),
   which records it on this device. This value sorts last and reads "No time". */
const NO_TIME = 999999;
const fmt = v => v >= NO_TIME ? 'No time' : secs(v);
const s3 = ms => (ms / 1000).toFixed(3);

/* ---------- Sound ---------- */
const sfx = {
  ...coreSfx,
  amber() { tn({ f: 880, dur: 0.09, type: 'square', g: 0.045 }); },
  green() { tn({ f: 1320, dur: 0.24, type: 'square', g: 0.06 }); },
  shift() { nz({ dur: 0.05, type: 'highpass', f: 3200, g: 0.22, a: 0.001 }); tn({ f: 190, f2: 95, dur: 0.08, type: 'square', g: 0.05, a: 0.001 }); },
  chirp() { nz({ dur: 0.55, f: 2600, f2: 1700, q: 5, g: 0.2, a: 0.01 }); },
  bang() { nz({ dur: 1.3, type: 'lowpass', f: 1500, f2: 110, g: 0.9, a: 0.001 }); tn({ f: 72, f2: 28, dur: 0.7, type: 'sawtooth', g: 0.3, a: 0.001 }); },
  buzz() { tn({ f: 150, dur: 0.45, type: 'sawtooth', g: 0.08 }); },
  finish(win) { (win ? [523.25, 659.25, 783.99] : [392, 329.63]).forEach((f, i) => tn({ f, dur: 0.16, type: 'square', g: 0.04, delay: i * 0.09 })); }
};
/* Engine drone: two detuned oscillators through a lowpass. Pitch follows the needle. */
let drone = null;
onAudioReady(a => {
  const c = a.ctx;
  const o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
  o1.type = 'sawtooth'; o2.type = 'square';
  f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 2;
  g.gain.value = 0;
  o1.connect(f); o2.connect(f); f.connect(g).connect(a.master);
  o1.start(); o2.start();
  drone = { o1, o2, f, g, level: 0, rpm: 0 };
});
function setDrone(rpm, level) {
  if (!drone || !A.ctx) return;
  if (Math.abs(rpm - drone.rpm) < 0.004 && Math.abs(level - drone.level) < 0.002) return;
  drone.rpm = rpm; drone.level = level;
  const t = A.ctx.currentTime, hz = 38 + rpm * 140;
  drone.g.gain.setTargetAtTime(level, t, 0.05);
  drone.o1.frequency.setTargetAtTime(hz, t, 0.015);
  drone.o2.frequency.setTargetAtTime(hz * 0.5 + 1.5, t, 0.015);
  drone.f.frequency.setTargetAtTime(260 + rpm * 2200, t, 0.03);
}

/* ---------- Shell ---------- */
const shell = mountShell({
  game: 'drag', name: 'Drag Racing', titleHtml: 'Drag<br>Racing',
  lede: 'Launch on green, shift in the band, and never sit on redline. Race the leader’s ghost down the quarter mile.',
  rules: [
    ['Launch', `Tap the moment the tree goes green. That tap is your launch, so reaction time is your start. Under ${s3(C.launch.perfectMs)} s is a perfect launch with a small boost. Tap before green and it’s a red light.`],
    ['Shift', 'Tap once per gear when the needle is in the green. Early bogs, late wastes time, dead center gives a small boost.'],
    ['Engines', 'Hold redline too long and the engine blows. Three blown engines or red lights end the session. Your best clean run counts.']
  ],
  modes: [
    { id: 'classic', label: 'Classic', note: 'New tree timing and shift bands every run. Race the all-time leader’s ghost.' },
    { id: 'daily', label: 'Daily challenge', board: 'classic', daily: true, note: 'Same tree and shift bands for everyone today. Race today’s leader.' }
  ],
  hud: [
    { id: 'score', label: 'Best', init: '-' },
    { id: 'time', label: 'Time', unit: 's', init: '0.000' },
    { hearts: true, label: 'Engines' },
    { id: 'mph', label: 'Speed', unit: 'mph', amber: true, init: '0' }
  ],
  boards: [
    { id: 'today', label: 'Today', mode: 'classic', period: 'daily', note: 'Same tree and shift bands for everyone. Resets at midnight UTC.', empty: 'No one has run today’s challenge yet.' },
    { id: 'all', label: 'All-time', mode: 'classic', period: 'all', note: 'Quickest quarter mile, green light to finish line.' }
  ],
  hearts: C.hearts, playLabel: 'Stage', againLabel: 'Race again',
  fmt,
  share: (score, meta) => score >= NO_TIME
    ? 'I couldn’t put down a clean run on Sweet Spot Drag Racing.'
    : `I ran a ${s3(score)} on Sweet Spot Drag Racing${meta && meta.trap ? ` at ${Math.round(meta.trap)} mph` : ''}.`,
  onStart: startSession,
  onAction: tap,
  onMenu() { G.phase = 'idle'; setDrone(0, 0); },
  colors: { label: 'Car', default: 'crimson' },
  onTeam: applyTeam
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

/* ---------- State ---------- */
const G = {
  phase: 'idle',               // idle | stage | tree | race | done | fault | over
  daily: false, stream: null, params: L.makeRunParams(mulberry32(7)),
  hearts: C.hearts, runs: 0, clean: 0, best: null, bestRec: null,
  t0: 0, greenAt: 0, launchAt: 0, gearAt: 0, endAt: 0, lit: 0,
  gear: 0, reaction: 0, launchRes: null, shifts: [], race: null,
  finishV: 0, endRpm: 0, endX: 0, endV: 0, fault: null, lastEt: null,
  ghost: houseGhost(), ghostRun: null, ghostTok: 0,
  fx: [], parts: [], flameAt: -1e9, shake: { t0: -1e9, amp: 0, dur: 1 }, camLag: 0, lastNow: 0
};

function houseGhost() { return { ...L.houseGhost(), name: C.house.name, leader: false }; }

/* Ghost: the board leader for this mode, or the house car. */
function loadGhost(mode) {
  const tok = ++G.ghostTok;
  G.ghost = houseGhost();
  const daily = !!mode.daily;
  let req;
  try { req = getTop({ game: 'drag', mode: 'classic', period: daily ? 'daily' : 'all', limit: 1 }); } catch (e) { return; }
  Promise.resolve(req).then(rows => {
    if (tok !== G.ghostTok || !rows || !rows.length) return;
    const row = rows[0], g = L.decodeGhost(row.meta && row.meta.ghost);
    if (!g) return;
    G.ghost = { ...g, name: cleanIni(row.initials) || '???', leader: true, daily };
    if (G.phase === 'stage' || G.phase === 'tree') G.ghostRun = L.ghostPlayer(G.ghost);
  }).catch(() => {});
}

function startSession(mode) {
  G.daily = !!mode.daily;
  G.stream = G.daily ? dailyRng('drag') : null;
  Object.assign(G, { hearts: C.hearts, runs: 0, clean: 0, best: null, bestRec: null, lastEt: null });
  shell.set('score', '-'); shell.hearts.set(G.hearts);
  loadGhost(mode);
  setupRun(performance.now());
}

/* One draw from the day's stream per run keeps run N identical for everyone. */
function nextSeed() { return G.stream ? (G.stream() * 2 ** 32) >>> 0 : (Math.random() * 2 ** 32) >>> 0; }

function setupRun(now, reuse = false) {
  if (!reuse) G.params = L.makeRunParams(mulberry32(nextSeed()));
  Object.assign(G, {
    phase: 'stage', t0: now, greenAt: now + L.greenAtMs(G.params), launchAt: 0, gearAt: 0, endAt: 0, lit: 0,
    gear: 0, reaction: 0, launchRes: null, shifts: [], race: null, fault: null, fx: [], parts: [], flameAt: -1e9, camLag: 0
  });
  G.ghostRun = G.ghost ? L.ghostPlayer(G.ghost) : null;
  shell.set('time', '0.000'); shell.set('mph', '0');
}

/* ---------- Input ---------- */
function tap(time) {
  const P = G.phase;
  if (P === 'stage' || P === 'tree') {
    const r = L.startTap(G.params, time - G.t0);
    if (r.kind === 'redlight') fault('redlight', time, r.early);
    else if (r.kind === 'launch') launch(time, r.reaction);
  } else if (P === 'race') {
    if (G.gear < L.TOP && time - G.gearAt >= C.shift.lockoutMs) shift(time);
  } else if ((P === 'done' || P === 'fault') && time - G.endAt > C.tapAfterResultMs) {
    next(time);
  }
}

/* The tap on green is the launch. Reaction time decides how good it is. */
function launch(time, reaction) {
  const j = L.judgeLaunch(reaction);
  Object.assign(G, { phase: 'race', reaction, launchRes: j, launchAt: time, gearAt: time, gear: 0, flameAt: time });
  G.race = L.createRace();
  G.race.addLoss(j.loss);
  sfx.chirp();
  if (j.zone === 'perfect') sfx.perfect();
  shake(time, 5, 420);
  const word = { perfect: 'Perfect launch', good: 'Good launch', slow: 'Slow launch' }[j.zone];
  feedback(word, j.zone === 'perfect' ? '#ffb547' : j.zone === 'good' ? '#8fe0a0' : '#ff8a7a', time, `Reaction ${s3(reaction)} s`);
}

function shift(time) {
  const g = G.gear, j = L.judgeShift(G.params, g, time - G.gearAt);
  if (j.zone === 'blown') { fault('blown', time); return; }
  const t = Math.max(G.race.t, Math.round(time - G.launchAt));
  G.race.advanceTo(t);
  G.race.addLoss(j.loss);
  G.shifts.push([t, j.loss]);
  G.gear = g + 1; G.gearAt = time; G.flameAt = time;
  shake(time, 1.6, 140);
  sfx.shift();
  if (j.zone === 'perfect') sfx.perfect();
  const word = { perfect: 'Perfect', good: 'Good', early: 'Early', late: 'Late' }[j.zone];
  feedback(word + (j.loss > 0 ? `  +${s3(j.loss)}` : ''), j.zone === 'perfect' ? '#ffb547' : j.zone === 'good' ? '#8fe0a0' : '#ff8a7a', time);
}

function fault(kind, now, early = 0) {
  const x = playerX(now), v = playerV(now);
  Object.assign(G, { phase: 'fault', fault: kind, endAt: now, endX: x, endV: v, endRpm: needle(now) });
  G.hearts--; G.runs++;
  shell.hearts.set(G.hearts);
  sfx.heartLost();
  const left = G.hearts > 0 ? `${G.hearts} engine${G.hearts === 1 ? '' : 's'} left` : 'That’s the session';
  if (kind === 'blown') {
    sfx.bang(); shake(now, 9, 700);
    shell.callout('Engine blown', `Held gear ${G.gear + 1} on the limiter. ${left}`, 'bad');
  } else if (kind === 'redlight') {
    sfx.buzz();
    shell.callout('Red light', `Left ${s3(early)} s before green. ${left}`, 'bad');
  } else {
    sfx.buzz();
    shell.callout('Missed the start', `No launch after green. ${left}`, 'bad');
  }
  shell.set('mph', '0');
}

function finishRun(now) {
  const race = G.race, et = Math.round(G.reaction + race.finishT);
  const trap = L.trapMph(race.finishT);
  G.finishV = race.speed();
  Object.assign(G, { phase: 'done', endAt: now, endRpm: needle(now), lastEt: et });
  G.runs++; G.clean++;
  const ghost = L.encodeGhost({ r: G.reaction, l: G.launchRes.loss, s: G.shifts, e: et });
  const pb = G.best == null || et < G.best;
  if (pb) {
    G.best = et;
    G.bestRec = { ghost, reaction: G.reaction, trap };
    shell.set('score', s3(et), { pulse: true });
  }
  const gh = G.ghost, win = !gh || et < gh.e;
  const vs = gh ? (win ? `Beat ${gh.leader ? gh.name : 'the house car'} by ${s3(gh.e - et)}` : `${gh.leader ? gh.name : 'House car'} by ${s3(et - gh.e)}`) : '';
  shell.set('time', s3(et));
  shell.callout(`${s3(et)} s`, `${trap} mph${vs ? `<b>${vs}</b>` : ''}`, pb ? 'gold' : 'good');
  sfx.finish(win);
}

function next(now) {
  if (G.hearts <= 0) finish();
  else setupRun(now);
}

function finish() {
  G.phase = 'over';
  setDrone(0, 0);
  if (G.best == null) {
    shell.gameOver({
      score: NO_TIME, submit: false,
      head: 'No clean runs',
      line: 'Three faults and no finish. Wait for green, then shift before redline.',
      stats: [['Runs', G.runs], ['Clean runs', 0]],
      meta: { runs: G.runs }
    });
    return;
  }
  const b = G.bestRec;
  shell.gameOver({
    score: G.best,
    head: 'Out of engines',
    line: `Best run ${s3(G.best)} s at ${b.trap} mph`,
    stats: [['Reaction', s3(b.reaction) + ' s'], ['Trap speed', b.trap + ' mph'], ['Clean runs', `${G.clean}/${G.runs}`], ['Ghost', G.ghost ? s3(G.ghost.e) + ' s' : '-']],
    meta: { ghost: b.ghost, reaction: b.reaction, trap: b.trap, runs: G.runs, best: G.best }
  });
}

function feedback(text, color, t0, sub = '') { G.fx.push({ text, color, t0, sub }); if (G.fx.length > 3) G.fx.shift(); }
function shake(t0, amp, dur) { if (!REDUCE) G.shake = { t0, amp, dur }; }

/* ---------- Derived values ---------- */
function playerX(now) {
  switch (G.phase) {
    case 'race': return G.race.x();
    case 'done': return L.DIST + L.coastX(G.finishV, now - G.endAt);
    case 'fault': return G.endX + L.coastX(G.fault === 'blown' ? G.endV : 2.5, now - G.endAt, G.fault === 'blown' ? 7 : 6);
    default: return 0;
  }
}
function playerV(now) {
  switch (G.phase) {
    case 'race': return G.race.speed();
    case 'done': return L.coastV(G.finishV, now - G.endAt);
    case 'fault': return G.fault === 'blown' ? L.coastV(G.endV, now - G.endAt, 7) : 0;
    default: return 0;
  }
}
const ghostLive = () => G.ghostRun && G.phase !== 'idle' && G.phase !== 'over';
function ghostX(now) { return ghostLive() ? G.ghostRun.xAt(now - G.greenAt) : 0; }
function ghostV(now) { return ghostLive() ? G.ghostRun.speedAt(now - G.greenAt) : 0; }
function needle(now) {
  const P = G.phase;
  if (P === 'stage' || P === 'tree') { const ms = now - G.t0; return ms < C.tree.stageMs ? 0.14 : L.stagedRpm(ms); }
  if (P === 'race') {
    const v = L.gearRpm(G.params, G.gear, now - G.gearAt);
    return v >= 1 ? 1 - Math.random() * 0.025 : v;
  }
  if (P === 'done') return Math.max(0.12, G.endRpm - (now - G.endAt) / 1800);
  if (P === 'fault') return Math.max(G.fault === 'blown' ? 0 : 0.12, G.endRpm - (now - G.endAt) / 700);
  return 0.12 + Math.sin(now / 140) * 0.006;
}

/* ---------- Layout ----------
   The night scene fills the top of the canvas (sky runs behind the HUD).
   Under it a dash panel holds the tree and the tach, kept above the bottom
   72 px so the corner buttons never cover them. */
function layout() {
  const hud = document.getElementById('hud');
  const hb = hud ? hud.getBoundingClientRect().bottom - cvs.getBoundingClientRect().top : 90;
  const top = Math.max(56, hb + 6), bottom = H - 72;
  const panelH = clamp((bottom - top) * 0.46, 190, 300);
  const sceneB = Math.round(bottom - panelH);
  const nearH = Math.round(clamp(sceneB * 0.075, 22, 38));
  const trackB = sceneB - nearH;
  const th = Math.round(clamp((sceneB - top) * 0.52, 100, 240));
  const trackT = trackB - th;
  const wallH = Math.round(clamp(th * 0.15, 14, 30));
  const wallT = trackT - wallH;
  const standH = Math.round(clamp(th * 0.62, 60, 150));
  const horizon = wallT - standH;
  const carL = Math.round(Math.min(th * 0.9, W * 0.34, 250));
  const pTop = sceneB + 30, ph = Math.max(90, bottom - pTop);
  const R = Math.round(clamp(Math.min(ph * 0.45, W * 0.27), 40, 150));
  const tw = Math.round(R * 0.74), gap = Math.round(R * 0.34), gx = Math.round((W - (tw + gap + 2 * R)) / 2);
  const cy = pTop + ph * 0.5;
  return {
    top, sceneB, nearH, trackB, th, trackT, wallH, wallT, standH, horizon, carL,
    yFar: trackT + th * 0.42, yMid: trackT + th * 0.53, yNear: trackT + th * 0.9,
    pTop, tree: { x: gx, y: cy - R * 1.02, w: tw, h: R * 2.04 }, tach: { x: gx + tw + gap + R, y: cy, r: R }
  };
}

/* ---------- Projection ----------
   An oblique night view. Each depth row scrolls at its own rate, so a line
   across the track leans like real perspective and the background drifts
   slower than the track. */
const CAR_M = 5.6;                                  // car length in meters
const S_TOP = 0.9, S_WALL = 0.86, S_NEAR = 1.06, PAR_STAND = 0.45, PAR_FAR = 0.12;
const FT = 0.3048;
const BOARDS = [[60, '60 FT'], [330, '330 FT'], [660, '660 FT'], [1000, '1000 FT']];
let AX = 0, CX = 0, PPM = 1, LY = null;
const X = (m, s) => AX + (m - CX) * PPM * s;
/* ---------- Team colors ----------
   The player's car wears the picked team colors. The ghost stays a
   translucent tint: amber by default, ice blue when the team itself is
   amber, gold or orange, so the two cars never read alike. */
const GHOST_AMBER = { a: '255,181,71', l1: '255,226,170', l2: '255,200,120', l3: '255,220,160', p: '255,240,210', d: '190,120,30', k1: '40,30,10', k2: '20,14,4', k3: '30,22,8', k4: '60,40,10', hex: '#ffb547' };
const GHOST_ICE = { a: '110,190,255', l1: '190,228,255', l2: '150,210,255', l3: '185,225,255', p: '225,242,255', d: '40,110,190', k1: '8,22,40', k2: '4,12,22', k3: '6,16,30', k4: '12,36,62', hex: '#6ebeff' };
function hsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
/* Close to the amber ghost: a saturated, mid-light color within 28 degrees of its hue. */
function nearAmber(hex) { const c = hsl(hex); return c.s > 0.35 && c.l > 0.25 && c.l < 0.85 && Math.abs(c.h - 36) < 28; }
const lum = hex => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
let TEAM = shell.team, GP = GHOST_AMBER, ACCENT = '#b0352c';
const ga = (k, a) => `rgba(${GP[k]},${a})`;
function setTeamColors(t) {
  TEAM = t;
  GP = nearAmber(t.j) || nearAmber(t.h) ? GHOST_ICE : GHOST_AMBER;
  ACCENT = lum(t.j) > 60 ? t.j : t.h;       // progress bar fill that shows on the dark wall
}
function applyTeam(t) {
  setTeamColors(t);
  if (K.key) { const cl = K.car.cl; K.car = buildCar(cl, false); K.ghostCar = buildCar(cl, true); }
}
setTeamColors(shell.team);

const sAt = y => S_TOP + (1 - S_TOP) * clamp((y - LY.trackT) / LY.th, 0, 1);
const hash = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const posMod = (a, b) => ((a % b) + b) % b;

/* ---------- Cached art ----------
   Static layers are drawn once per size into offscreen canvases. */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * DPR)); c.height = Math.max(1, Math.ceil(h * DPR));
  const x = c.getContext('2d');
  x.setTransform(DPR, 0, 0, DPR, 0, 0);
  return { c, x, w, h };
}
function glowSprite(rgb, size = 64) {
  const s = makeCanvas(size, size), x = s.x, r = size / 2;
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.22, `rgba(${rgb},.55)`); g.addColorStop(0.55, `rgba(${rgb},.14)`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return s;
}
function roundRectOn(x, a, b, w, h, r) {
  x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
}

let K = { key: '' };
function ensureCache(lay) {
  const key = [W, H, DPR, lay.horizon, lay.th, lay.standH, lay.wallH, lay.nearH, lay.carL, lay.tach.r, lay.sceneB].join(',');
  if (key === K.key) return;
  const rnd = mulberry32(20261108);
  K = { key };
  K.glowW = glowSprite('255,236,200');
  K.glowA = glowSprite('255,181,71');
  K.glowG = glowSprite('120,255,150');
  K.glowR = glowSprite('255,60,40');
  K.glowB = glowSprite('150,200,255');
  K.smoke = (() => {
    // a lumpy puff: a few soft blobs, grey rather than white so it reads as smoke at night
    const s = makeCanvas(64, 64), x = s.x;
    for (const [bx, by, br] of [[32, 34, 24], [22, 28, 14], [42, 26, 15], [30, 20, 12], [44, 40, 12]]) {
      const g = x.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(190,192,196,.45)'); g.addColorStop(0.6, 'rgba(160,162,168,.2)'); g.addColorStop(1, 'rgba(150,152,158,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    }
    return s;
  })();
  K.flame = (() => {
    const s = makeCanvas(128, 40), x = s.x;
    const g = x.createLinearGradient(128, 0, 0, 0);
    g.addColorStop(0, 'rgba(210,235,255,1)'); g.addColorStop(0.18, 'rgba(255,230,150,1)'); g.addColorStop(0.5, 'rgba(255,140,40,.85)'); g.addColorStop(1, 'rgba(255,60,20,0)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(128, 20); x.bezierCurveTo(124, 2, 70, 4, 0, 20); x.bezierCurveTo(70, 36, 124, 38, 128, 20); x.fill();
    return s;
  })();
  buildSky(lay, rnd); buildStands(lay, rnd); buildWalls(lay, rnd); buildAsphalt(rnd);
  K.car = buildCar(lay.carL, false); K.ghostCar = buildCar(lay.carL, true);
  buildPanel(lay); buildTach(lay.tach.r); buildTree(lay.tree);
  // track depth shading: far side darker, near side lit by the poles
  const tg = ctx.createLinearGradient(0, lay.trackT, 0, lay.trackB);
  tg.addColorStop(0, 'rgba(0,0,0,.45)'); tg.addColorStop(0.45, 'rgba(0,0,0,.1)'); tg.addColorStop(1, 'rgba(0,0,0,.25)');
  K.trackShade = tg;
}

function buildSky(lay, rnd) {
  const h = lay.wallT + 2, s = makeCanvas(W, h), x = s.x;
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#02040b'); g.addColorStop(0.45, '#081029'); g.addColorStop(0.8, '#1b1a38'); g.addColorStop(1, '#3a2c3a');
  x.fillStyle = g; x.fillRect(0, 0, W, h);
  for (let i = 0; i < Math.round(W / 6); i++) {
    const sx = rnd() * W, sy = rnd() * lay.horizon * 0.9, a = 0.15 + rnd() * 0.6, r = rnd() < 0.08 ? 1.3 : 0.7;
    x.fillStyle = `rgba(230,236,255,${a})`; x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.fill();
  }
  // haze from the stadium lights
  const hz = x.createRadialGradient(W / 2, lay.horizon + lay.standH * 0.3, 0, W / 2, lay.horizon + lay.standH * 0.3, Math.max(W, 400) * 0.7);
  hz.addColorStop(0, 'rgba(255,214,160,.22)'); hz.addColorStop(0.5, 'rgba(255,190,140,.07)'); hz.addColorStop(1, 'rgba(255,190,140,0)');
  x.fillStyle = hz; x.fillRect(0, 0, W, h);
  K.sky = s;
  // far tree line and town lights, a repeating strip
  const fh = Math.round(lay.standH * 0.55), f = makeCanvas(600, fh), fx = f.x;
  fx.fillStyle = '#060912';
  fx.beginPath(); fx.moveTo(0, fh);
  for (let i = 0; i <= 60; i++) { const px = i * 10, py = fh * (0.35 + 0.35 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)) + rnd() * 0.12); fx.lineTo(px, i === 60 ? fh * 0.5 : py); }
  fx.lineTo(600, fh); fx.closePath(); fx.fill();
  fx.fillStyle = '#0a0e1a'; fx.fillRect(80, fh * 0.25, 26, fh); fx.fillRect(330, fh * 0.15, 18, fh); fx.fillRect(470, fh * 0.3, 34, fh);
  for (let i = 0; i < 26; i++) { fx.fillStyle = `rgba(255,${200 + rnd() * 40 | 0},140,${0.3 + rnd() * 0.5})`; fx.fillRect(rnd() * 600, fh * (0.4 + rnd() * 0.5), 1.5, 1.5); }
  K.far = f;
}

function buildStands(lay, rnd) {
  const h = lay.standH, w = 420, s = makeCanvas(w, h), x = s.x;
  // roof canopy and back wall
  x.fillStyle = '#0d1018'; x.fillRect(0, 0, w, h);
  const roofH = Math.max(5, h * 0.11);
  x.fillStyle = '#1c2230'; x.fillRect(0, 0, w, roofH);
  x.fillStyle = '#2b3242'; x.fillRect(0, roofH - 2, w, 2);
  for (let i = 0; i < w; i += 21) {
    x.fillStyle = 'rgba(255,240,205,.95)'; x.fillRect(i + 8, roofH - 3, 5, 2);
    const lg = x.createLinearGradient(0, roofH, 0, roofH + h * 0.4);
    lg.addColorStop(0, 'rgba(255,230,190,.12)'); lg.addColorStop(1, 'rgba(255,230,190,0)');
    x.fillStyle = lg; x.beginPath(); x.moveTo(i + 6, roofH); x.lineTo(i + 15, roofH); x.lineTo(i + 24, roofH + h * 0.4); x.lineTo(i - 3, roofH + h * 0.4); x.fill();
  }
  // tiers of seats with a crowd
  const rows = Math.max(4, Math.min(8, Math.round(h / 16))), y0 = roofH + h * 0.06, y1 = h * 0.9, rh = (y1 - y0) / rows;
  const shirts = ['#5a2a2a', '#2a3a5a', '#3d4a3a', '#5a4a2a', '#4a2a4a', '#2a4a4a', '#6a6a6a', '#7a3328', '#264a7a', '#8a7a4a'];
  for (let r = 0; r < rows; r++) {
    const ry = y0 + r * rh, lit = 0.55 + 0.45 * (r / rows);
    x.fillStyle = `rgb(${22 * lit | 0},${26 * lit | 0},${36 * lit | 0})`; x.fillRect(0, ry, w, rh);
    x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(0, ry + rh - 1.5, w, 1.5);
    const hr = rh * 0.2;
    for (let px = hr * 2; px < w - hr * 2; px += hr * 2.6 + rnd() * hr * 1.4) {
      if (rnd() < 0.12) continue;
      const by = ry + rh - 1, hy = by - rh * 0.55 - rnd() * rh * 0.12;
      x.globalAlpha = 0.55 + 0.45 * lit;
      x.fillStyle = shirts[(rnd() * shirts.length) | 0];
      x.beginPath(); x.ellipse(px, by - rh * 0.12, hr * 1.25, rh * 0.32, 0, Math.PI, 0); x.fill();
      x.fillStyle = rnd() < 0.5 ? '#2a1d17' : '#4a3426';
      x.beginPath(); x.arc(px, hy, hr, 0, Math.PI * 2); x.fill();
      if (rnd() < 0.08) { x.fillRect(px - hr * 1.6, hy - hr * 2.2, hr * 0.5, hr * 2); }   // a raised arm
    }
    x.globalAlpha = 1;
  }
  // columns and the rail
  x.fillStyle = '#05070b';
  for (let i = 0; i < w; i += 140) x.fillRect(i, roofH, 4, h - roofH);
  x.fillStyle = '#141924'; x.fillRect(0, y1, w, h - y1);
  x.fillStyle = 'rgba(255,181,71,.55)'; x.fillRect(0, y1, w, 1.5);
  x.fillStyle = 'rgba(241,236,224,.35)'; x.fillRect(0, y1 - rh * 0.25, w, 1);
  K.stand = s;
}

function concrete(x, w, h, top, mid, low, rnd) {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(0.18, mid); g.addColorStop(1, low);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 18; i++) { x.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.06)'; x.fillRect(rnd() * w, rnd() * h, 1, 1); }
  x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(0, 0, 1.5, h);
  x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(1.5, 0, 1, h);
}
function buildWalls(lay, rnd) {
  const fw = makeCanvas(150, lay.wallH);
  concrete(fw.x, 150, lay.wallH, '#c9c9bf', '#8c8d86', '#55574f', rnd);
  fw.x.fillStyle = 'rgba(0,0,0,.35)'; fw.x.fillRect(0, lay.wallH - 3, 150, 3);
  K.wallFar = fw;
  const nw = makeCanvas(190, lay.nearH);
  concrete(nw.x, 190, lay.nearH, '#8d8e88', '#4c4f4b', '#262825', rnd);
  nw.x.fillStyle = 'rgba(255,255,255,.18)'; nw.x.fillRect(0, 0, 190, 2);
  K.wallNear = nw;
}
function buildAsphalt(rnd) {
  const s = makeCanvas(256, 128), x = s.x;
  x.fillStyle = '#25282c'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 2600; i++) {
    const v = rnd();
    x.fillStyle = v < 0.45 ? 'rgba(0,0,0,.28)' : v < 0.9 ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.14)';
    x.fillRect(rnd() * 256, rnd() * 128, v > 0.97 ? 2 : 1, 1);
  }
  for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(0,0,0,.07)'; x.beginPath(); x.ellipse(rnd() * 256, rnd() * 128, 20 + rnd() * 40, 4 + rnd() * 8, 0, 0, Math.PI * 2); x.fill(); }
  const pat = ctx.createPattern(s.c, 'repeat');
  if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(1 / DPR));
  K.asphalt = pat;
}

/* Generic pro street car in side view, facing right. No real makes, badges
   or sponsors. Body only; the wheels are drawn live so they can spin.
   Sprite origin: rear axle. CAR geometry is in car lengths. */
const CAR = { rearX: 0.17, rearR: 0.095, frontX: 0.8, frontR: 0.064, padL: 0.36, padT: 0.12, w: 1.42, h: 0.46 };
function buildCar(cl, ghost) {
  const s = makeCanvas(cl * CAR.w, cl * CAR.h), x = s.x;
  const gy = cl * (CAR.padT + 0.32), ox = cl * CAR.padL;
  const P = (u, v) => [ox + u * cl, gy - v * cl];
  const mv = (u, v) => x.moveTo(...P(u, v)), ln = (u, v) => x.lineTo(...P(u, v));
  const qc = (cu, cv, u, v) => { const [a, b] = P(cu, cv), [c, d] = P(u, v); x.quadraticCurveTo(a, b, c, d); };
  // wheelie bar: two struts and a small wheel that sits just off the ground
  x.strokeStyle = ghost ? ga('a', .7) : '#3a3d42'; x.lineWidth = Math.max(1.2, cl * 0.011);
  x.beginPath(); mv(0.12, 0.06); ln(-0.25, 0.03); mv(0.06, 0.1); ln(-0.25, 0.03); x.stroke();
  x.fillStyle = ghost ? ga('a', .5) : '#111'; x.beginPath(); x.arc(...P(-0.25, 0.028), cl * 0.022, 0, Math.PI * 2); x.fill();
  x.fillStyle = ghost ? ga('a', .7) : '#9aa0a6'; x.beginPath(); x.arc(...P(-0.25, 0.028), cl * 0.009, 0, Math.PI * 2); x.fill();
  // dark wheel wells
  x.fillStyle = ghost ? ga('k2', .6) : '#07080a';
  for (const [u, r] of [[CAR.rearX, CAR.rearR], [CAR.frontX, CAR.frontR]]) { x.beginPath(); x.arc(...P(u, r), (r + 0.014) * cl, Math.PI, 0); x.fill(); }
  // body outline
  const body = () => {
    x.beginPath();
    mv(0.012, 0.07); ln(0.004, 0.165); qc(0.01, 0.192, 0.05, 0.195); ln(0.25, 0.195);
    qc(0.3, 0.205, 0.35, 0.27); qc(0.37, 0.288, 0.43, 0.29); ln(0.53, 0.287);
    qc(0.57, 0.284, 0.66, 0.205); ln(0.71, 0.196);
    ln(0.725, 0.228); ln(0.83, 0.228); ln(0.85, 0.19);
    qc(0.95, 0.172, 0.985, 0.13); qc(1.0, 0.105, 0.998, 0.07); ln(0.99, 0.045); ln(0.9, 0.042);
    const fr = (CAR.frontR + 0.014) * cl, rr = (CAR.rearR + 0.014) * cl;
    ln(CAR.frontX + CAR.frontR + 0.014, CAR.frontR); x.arc(...P(CAR.frontX, CAR.frontR), fr, 0, Math.PI, true);
    ln(CAR.rearX + CAR.rearR + 0.016, 0.05);
    ln(CAR.rearX + CAR.rearR + 0.014, CAR.rearR); x.arc(...P(CAR.rearX, CAR.rearR), rr, 0, Math.PI, true);
    ln(0.04, 0.062); x.closePath();
  };
  body();
  const [, topY] = P(0, 0.29);
  const g = x.createLinearGradient(0, topY, 0, gy);
  const J = TEAM.j, Hc = TEAM.h;
  if (ghost) { g.addColorStop(0, ga('l1', .75)); g.addColorStop(0.5, ga('a', .5)); g.addColorStop(1, ga('d', .45)); }
  else { g.addColorStop(0, shade(J, 0.4)); g.addColorStop(0.28, shade(J, 0.12)); g.addColorStop(0.62, shade(J, -0.12)); g.addColorStop(1, shade(J, -0.6)); }
  x.fillStyle = g; x.fill();
  if (ghost) { x.strokeStyle = ga('l2', .95); x.lineWidth = Math.max(1, cl * 0.01); x.stroke(); }
  x.save(); body(); x.clip();
  // side stripe, shoulder highlight, rocker shadow
  x.fillStyle = ghost ? ga('p', .35) : Hc;
  x.beginPath(); mv(0.02, 0.118); ln(0.97, 0.104); ln(0.97, 0.088); ln(0.02, 0.1); x.fill();
  x.fillStyle = ghost ? ga('p', .2) : isLight(Hc) ? shade(J, -0.6) : shade(J, 0.55);
  x.beginPath(); mv(0.02, 0.098); ln(0.97, 0.086); ln(0.97, 0.081); ln(0.02, 0.093); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = Math.max(1, cl * 0.008);
  x.beginPath(); mv(0.03, 0.172); ln(0.3, 0.17); mv(0.66, 0.188); qc(0.85, 0.172, 0.97, 0.13); x.stroke();
  x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(ox, gy - 0.06 * cl, cl, 0.06 * cl);
  // door seams
  x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1;
  x.beginPath(); mv(0.35, 0.2); ln(0.34, 0.06); mv(0.62, 0.2); ln(0.63, 0.06); x.stroke();
  x.restore();
  // glass
  x.beginPath(); mv(0.365, 0.262); qc(0.38, 0.278, 0.43, 0.279); ln(0.525, 0.276); qc(0.56, 0.272, 0.632, 0.206); ln(0.37, 0.206); x.closePath();
  const gg = x.createLinearGradient(...P(0.4, 0.28), ...P(0.5, 0.2));
  gg.addColorStop(0, ghost ? ga('k1', .45) : '#2c3c4e'); gg.addColorStop(1, ghost ? ga('k2', .45) : '#0b1118');
  x.fillStyle = gg; x.fill();
  x.fillStyle = 'rgba(255,255,255,.16)';
  x.beginPath(); mv(0.44, 0.279); ln(0.47, 0.279); ln(0.42, 0.206); ln(0.39, 0.206); x.fill();
  x.fillStyle = ghost ? ga('a', .6) : shade(J, -0.45); x.fillRect(...P(0.5, 0.27), cl * 0.012, cl * 0.065);
  // hood scoop mouth
  x.fillStyle = '#050505'; x.fillRect(...P(0.818, 0.226), cl * 0.014, cl * 0.03);
  // rear wing on struts
  x.fillStyle = ghost ? ga('a', .6) : Hc;
  x.fillRect(...P(0.03, 0.235), cl * 0.012, cl * 0.04); x.fillRect(...P(0.09, 0.235), cl * 0.012, cl * 0.04);
  x.beginPath(); mv(-0.015, 0.236); ln(0.13, 0.246); ln(0.13, 0.258); ln(-0.015, 0.252); x.closePath(); x.fill();
  if (!ghost) { x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(...P(-0.01, 0.255), cl * 0.13, 1); }
  // door roundel with a plain number
  if (!ghost) {
    x.fillStyle = Hc; x.beginPath(); x.arc(...P(0.48, 0.145), cl * 0.036, 0, Math.PI * 2); x.fill();
    x.fillStyle = isLight(Hc) ? '#141414' : '#f1ece0'; x.font = `900 ${Math.round(cl * 0.05)}px "Big Shoulders Display", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('1', ...P(0.48, 0.143));
  }
  // lights and the exhaust tip
  x.fillStyle = '#fff4c8'; x.fillRect(...P(0.972, 0.125), cl * 0.02, cl * 0.022);
  x.fillStyle = '#ff3b2f'; x.fillRect(...P(0.002, 0.168), cl * 0.014, cl * 0.022);
  x.fillStyle = '#2a2c30'; x.fillRect(...P(-0.02, 0.07), cl * 0.05, cl * 0.018);
  return { ...s, ox: ox + CAR.rearX * cl, oy: gy - CAR.rearR * cl, cl };
}

function buildPanel(lay) {
  const h = H - lay.sceneB, s = makeCanvas(W, h), x = s.x;
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#11171a'); g.addColorStop(0.12, '#0a0e10'); g.addColorStop(1, '#050707');
  x.fillStyle = g; x.fillRect(0, 0, W, h);
  x.strokeStyle = 'rgba(255,255,255,.025)'; x.lineWidth = 1;
  for (let i = -h; i < W; i += 6) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.stroke(); }
  x.fillStyle = 'rgba(255,181,71,.65)'; x.fillRect(0, 0, W, 2);
  x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, 2, W, 3);
  K.panel = s;
}

const TACH_A0 = Math.PI * 0.75, TACH_SW = Math.PI * 1.5;
const tachAng = v => TACH_A0 + clamp(v, 0, 1.02) * TACH_SW;
function buildTach(R) {
  const pad = R * 0.08, sz = 2 * (R + pad), s = makeCanvas(sz, sz), x = s.x, c = R + pad;
  // chrome bezel
  const bz = x.createLinearGradient(0, c - R, 0, c + R);
  bz.addColorStop(0, '#e7eaec'); bz.addColorStop(0.45, '#7b8186'); bz.addColorStop(0.55, '#3b3f43'); bz.addColorStop(1, '#a9aeb2');
  x.fillStyle = 'rgba(0,0,0,.5)'; x.beginPath(); x.arc(c, c + R * 0.04, R + pad * 0.6, 0, Math.PI * 2); x.fill();
  x.fillStyle = bz; x.beginPath(); x.arc(c, c, R, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#0a0c0d'; x.beginPath(); x.arc(c, c, R * 0.93, 0, Math.PI * 2); x.fill();
  const face = x.createRadialGradient(c, c - R * 0.2, R * 0.1, c, c, R * 0.92);
  face.addColorStop(0, '#1a221e'); face.addColorStop(0.7, '#0b100d'); face.addColorStop(1, '#040605');
  x.fillStyle = face; x.beginPath(); x.arc(c, c, R * 0.91, 0, Math.PI * 2); x.fill();
  // redline arc
  x.lineCap = 'butt';
  x.strokeStyle = 'rgba(241,236,224,.1)'; x.lineWidth = R * 0.07; x.beginPath(); x.arc(c, c, R * 0.82, tachAng(0), tachAng(1)); x.stroke();
  x.strokeStyle = '#d23a2e'; x.lineWidth = R * 0.07; x.beginPath(); x.arc(c, c, R * 0.82, tachAng(0.9), tachAng(1.02)); x.stroke();
  // ticks and numbers
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `800 ${Math.round(R * 0.17)}px "Big Shoulders Display", sans-serif`;
  for (let i = 0; i <= 36; i++) {
    const v = i / 36, a = tachAng(v), major = i % 4 === 0, half = i % 2 === 0;
    const r0 = R * (major ? 0.68 : half ? 0.73 : 0.76), r1 = R * 0.79;
    x.strokeStyle = v >= 0.9 ? '#ff6a55' : major ? '#f1ece0' : 'rgba(241,236,224,.55)';
    x.lineWidth = major ? Math.max(2, R * 0.025) : 1;
    x.beginPath(); x.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); x.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); x.stroke();
    if (major) { x.fillStyle = v >= 0.9 ? '#ff6a55' : '#f1ece0'; x.fillText(String(i / 4), c + Math.cos(a) * R * 0.55, c + Math.sin(a) * R * 0.55); }
  }
  x.fillStyle = 'rgba(241,236,224,.5)'; x.font = `700 ${Math.max(8, Math.round(R * 0.08))}px Barlow, sans-serif`;
  x.fillText('RPM x1000', c, c - R * 0.27);
  // gear window
  roundRectOn(x, c - R * 0.2, c + R * 0.24, R * 0.4, R * 0.3, R * 0.05);
  x.fillStyle = '#030404'; x.fill(); x.strokeStyle = 'rgba(241,236,224,.2)'; x.lineWidth = 1; x.stroke();
  K.tach = { ...s, cc: c };
  // glass glare, drawn over the needle
  const gl = makeCanvas(sz, sz), y = gl.x;
  y.save(); y.beginPath(); y.arc(c, c, R * 0.91, 0, Math.PI * 2); y.clip();
  const gg = y.createLinearGradient(0, c - R, 0, c);
  gg.addColorStop(0, 'rgba(255,255,255,.12)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
  y.fillStyle = gg; y.beginPath(); y.ellipse(c - R * 0.15, c - R * 0.55, R * 0.9, R * 0.5, -0.3, 0, Math.PI * 2); y.fill();
  y.restore();
  K.glare = gl;
}

/* Christmas tree: two columns (ghost lane left, your lane right).
   Pre-stage and stage bulbs on top, three ambers, green, red. */
function buildTree(t) {
  const w = t.w, h = t.h, s = makeCanvas(w, h + 40), x = s.x;
  const cols = [w * 0.28, w * 0.72], bulbs = [];
  const small = w * 0.06, big = w * 0.15;
  const rows = [['pre', 0.075, small], ['stage', 0.15, small], ['a1', 0.29, big], ['a2', 0.43, big], ['a3', 0.57, big], ['green', 0.72, big], ['red', 0.87, big]];
  // pole and base
  const pg = x.createLinearGradient(w * 0.43, 0, w * 0.57, 0);
  pg.addColorStop(0, '#2b3034'); pg.addColorStop(0.5, '#6b7177'); pg.addColorStop(1, '#202427');
  x.fillStyle = pg; x.fillRect(w * 0.44, h - 4, w * 0.12, 40);
  // housing
  const bg = x.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, '#1b1f22'); bg.addColorStop(0.5, '#2c3236'); bg.addColorStop(1, '#121517');
  roundRectOn(x, 0, 0, w, h, w * 0.1); x.fillStyle = bg; x.fill();
  x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 1; x.stroke();
  x.fillStyle = '#0a0c0d'; x.fillRect(w * 0.485, h * 0.03, w * 0.03, h * 0.94);
  const lens = { pre: 'rgba(255,233,176,.12)', stage: 'rgba(255,233,176,.12)', a1: 'rgba(255,181,71,.16)', a2: 'rgba(255,181,71,.16)', a3: 'rgba(255,181,71,.16)', green: 'rgba(120,255,150,.13)', red: 'rgba(255,60,40,.16)' };
  for (const [id, fy, r] of rows) {
    const y = h * fy;
    for (let ci = 0; ci < 2; ci++) {
      const xs = r === small ? [cols[ci] - w * 0.08, cols[ci] + w * 0.08] : [cols[ci]];
      for (const bx of xs) {
        if (r === big) { x.fillStyle = '#050606'; x.beginPath(); x.ellipse(bx, y - r * 0.15, r * 1.32, r * 1.22, 0, Math.PI, 0); x.fill(); }
        x.fillStyle = '#060707'; x.beginPath(); x.arc(bx, y, r * 1.12, 0, Math.PI * 2); x.fill();
        x.fillStyle = lens[id]; x.beginPath(); x.arc(bx, y, r, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(255,255,255,.12)'; x.beginPath(); x.arc(bx - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2); x.fill();
        bulbs.push({ id, x: bx, y, r, col: ci });
      }
    }
  }
  x.fillStyle = 'rgba(241,236,224,.55)'; x.font = `700 ${Math.max(8, Math.round(w * 0.12))}px Barlow, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'top';
  x.fillText('GHOST', cols[0], h + 6 + w * 0.12 * 0); x.fillText('YOU', cols[1], h + 6);
  K.tree = { ...s, bulbs };
}

/* ---------- Drawing ---------- */
function draw(now) {
  const lay = layout(); LY = lay;
  ensureCache(lay);
  const dt = clamp(now - (G.lastNow || now), 0, 50); G.lastNow = now;
  const px = playerX(now), pv = playerV(now);
  // camera: the car pulls ahead under hard acceleration, then the camera catches up
  const accel = G.phase === 'race' ? clamp(1 - (now - G.launchAt) / 2200, 0, 1) : 0;
  const lagT = 1.8 * accel + clamp(pv * 0.012, 0, 0.8);
  G.camLag += (lagT - G.camLag) * (1 - Math.exp(-dt / 260));
  PPM = lay.carL / CAR_M;
  AX = W * (W < 700 ? 0.58 : 0.46);
  CX = px - G.camLag;
  // screen shake
  let sx = 0, sy = 0;
  const sk = G.shake, sk01 = (now - sk.t0) / sk.dur;
  if (sk01 >= 0 && sk01 < 1) { const a = sk.amp * (1 - sk01) * (1 - sk01); sx = (hash(now * 0.37) - 0.5) * 2 * a; sy = (hash(now * 0.71 + 3) - 0.5) * 2 * a; }
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, lay.sceneB); ctx.clip();
  ctx.translate(sx, sy);
  drawBackdrop(now, lay);
  drawTrack(now, lay);
  drawRace(now, lay, px, pv);
  drawSpeedLines(now, lay, pv);
  ctx.restore();
  drawNearWall(now, lay, px);
  ctx.drawImage(K.panel.c, 0, lay.sceneB, W, H - lay.sceneB);
  drawPrompt(lay);
  drawTree(now, lay.tree);
  drawTach(now, lay.tach, pv);
  drawFeedback(now, lay);
}

/* Repeat a tile across the screen at a parallax rate. */
function tileRow(t, y, h, rate, extra = 0) {
  const tw = t.w * (h / t.h), off = posMod(CX * PPM * rate + extra, tw);
  for (let x = -off; x < W + 2; x += tw) ctx.drawImage(t.c, x, y, tw + 0.5, h);
}

function drawBackdrop(now, lay) {
  ctx.drawImage(K.sky.c, 0, 0, W, K.sky.h);
  const fh = K.far.h;
  tileRow(K.far, lay.horizon - fh * 0.7, fh, PAR_FAR);
  // light towers behind the stands
  for (let m = Math.floor((CX - 200) / 90) * 90; m < CX + W / PPM / PAR_STAND + 100; m += 90) {
    const x = AX + (m - CX) * PPM * PAR_STAND * 0.8 + 37;
    if (x < -40 || x > W + 40) continue;
    const ty = lay.horizon - lay.standH * 0.55;
    ctx.fillStyle = '#05070c'; ctx.fillRect(x - 1.5, ty, 3, lay.standH * 0.6);
    ctx.fillStyle = '#1a1f29'; ctx.fillRect(x - 12, ty - 7, 24, 9);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85; ctx.drawImage(K.glowW.c, x - 34, ty - 30, 68, 50);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff6dc'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 10 + i * 5.5, ty - 5, 3.5, 3);
  }
  tileRow(K.stand, lay.horizon, lay.standH, PAR_STAND);
  // camera flashes in the crowd
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const b = Math.floor(now / 80) + i * 977;
    if (hash(b) < 0.86) continue;
    const fx = hash(b + 1) * W, fy = lay.horizon + lay.standH * (0.2 + 0.62 * hash(b + 2));
    ctx.globalAlpha = 0.9; ctx.drawImage(K.glowW.c, fx - 9, fy - 9, 18, 18);
    ctx.fillStyle = '#fff'; ctx.fillRect(fx - 1, fy - 1, 2, 2);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // far wall, light poles and distance boards
  tileRow(K.wallFar, lay.wallT, lay.wallH, S_WALL);
  const mL = CX - AX / (PPM * S_WALL) - 20, mR = CX + (W - AX) / (PPM * S_WALL) + 20;
  for (let m = Math.floor(mL / 40) * 40; m < mR; m += 40) {
    const x = X(m, S_WALL), top = lay.horizon - lay.standH * 0.15;
    ctx.fillStyle = '#2a2e33'; ctx.fillRect(x - 2, top, 4, lay.wallT - top + 2);
    ctx.fillStyle = '#3c424a'; ctx.fillRect(x - 1, top, 1, lay.wallT - top);
    ctx.fillStyle = '#20252c'; ctx.fillRect(x - 14, top - 6, 28, 8);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.9; ctx.drawImage(K.glowW.c, x - 40, top - 32, 80, 56);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fffbe8'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 12 + i * 6.5, top - 4, 4.5, 3.5);
  }
  const bs = lay.wallH / 22;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [ft, label] of BOARDS) {
    const m = ft * FT; if (m < mL || m > mR) continue;
    distanceBoard(X(m, S_WALL), lay.wallT, bs, label, false);
  }
  ctx.textBaseline = 'alphabetic';
}

function distanceBoard(x, wallT, k, label, fin = false) {
  const bw = Math.max(44, 58 * k), bh = Math.max(18, 22 * k), by = wallT - bh - 10 * k;
  ctx.fillStyle = '#1a1d21'; ctx.fillRect(x - bw * 0.3, by + bh, 3, wallT - by - bh); ctx.fillRect(x + bw * 0.3 - 3, by + bh, 3, wallT - by - bh);
  ctx.fillStyle = fin ? '#d23a2e' : '#0e1512'; ctx.fillRect(x - bw / 2, by, bw, bh);
  ctx.strokeStyle = fin ? '#f1ece0' : '#ffb547'; ctx.lineWidth = 1.5; ctx.strokeRect(x - bw / 2 + 1, by + 1, bw - 2, bh - 2);
  ctx.fillStyle = '#f1ece0'; ctx.font = `800 ${Math.round(bh * 0.62)}px "Big Shoulders Display", sans-serif`;
  ctx.fillText(label, x, by + bh / 2 + 1);
}

/* Strip across the track between two distances, leaning with depth. */
function crossQuad(m0, m1, y0 = LY.trackT, y1 = LY.trackB) {
  const s0 = sAt(y0), s1 = sAt(y1);
  ctx.beginPath();
  ctx.moveTo(X(m0, s0), y0); ctx.lineTo(X(m1, s0), y0); ctx.lineTo(X(m1, s1), y1); ctx.lineTo(X(m0, s1), y1); ctx.closePath();
}

function drawTrack(now, lay) {
  const { trackT: T, trackB: B, th } = lay;
  // asphalt, scrolling at the middle depth
  ctx.save();
  const off = posMod(CX * PPM * 0.9, 256);
  ctx.translate(-off, 0);
  ctx.fillStyle = K.asphalt || '#25282c'; ctx.fillRect(off, T, W + 2, th);
  ctx.restore();
  ctx.fillStyle = K.trackShade; ctx.fillRect(0, T, W, th);
  const mL = CX - AX / (PPM * S_TOP) - 10, mR = CX + (W - AX) / (PPM * S_TOP) + 10;
  // burnout box: wet, slightly reflective
  if (mL < -6 && mR > -30) { ctx.fillStyle = 'rgba(120,150,190,.13)'; crossQuad(-30, -6); ctx.fill(); ctx.fillStyle = 'rgba(200,220,255,.06)'; crossQuad(-24, -18); ctx.fill(); }
  // rubber laid down in each lane: two dark grooves that fade down the track
  for (const yc of [lay.yFar, lay.yNear]) {
    for (const [dy, hh] of [[-0.21, 0.06], [-0.005, 0.07]]) {
      const y = yc + dy * th, s = sAt(y), h = hh * th * s;
      for (let m = Math.max(-20, Math.floor(mL / 6) * 6); m < Math.min(mR, 400); m += 6) {
        const a = (0.36 * Math.exp(-Math.max(0, m) / 110) + 0.08) * clamp((m + 20) / 14, 0, 1);
        ctx.fillStyle = `rgba(4,4,5,${a.toFixed(3)})`;
        const x0 = X(m, s), x1 = X(m + 6, s);
        ctx.fillRect(x0, y - h, x1 - x0 + 0.5, h);
      }
    }
    // a lighter band of whole rubber across the lane at the launch
    if (mL < 30) { ctx.fillStyle = 'rgba(0,0,0,.22)'; crossQuad(-2, 25, yc - th * 0.3, yc + th * 0.02); ctx.fill(); }
  }
  // pools of light from the poles
  ctx.globalCompositeOperation = 'lighter';
  for (let m = Math.floor(mL / 40) * 40; m < mR + 40; m += 40) {
    const x = X(m, 0.9);
    ctx.globalAlpha = 0.34; ctx.drawImage(K.glowW.c, x - 30 * PPM * 0.5, T - th * 0.25, 30 * PPM, th * 1.1);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // lane lines
  ctx.fillStyle = 'rgba(241,236,224,.8)';
  ctx.fillRect(0, T + 1, W, 2); ctx.fillRect(0, lay.yMid - 1, W, 2.5); ctx.fillRect(0, B - 3, W, 2.5);
  // start line and staging beams
  if (mL < 2 && mR > -2) {
    ctx.fillStyle = 'rgba(241,236,224,.9)'; crossQuad(-0.25, 0.1); ctx.fill();
    ctx.fillStyle = 'rgba(241,236,224,.5)'; crossQuad(-0.6, -0.5); ctx.fill();
  }
  // timing beams at each board
  for (const [ft] of BOARDS) {
    const m = ft * FT; if (m < mL || m > mR) continue;
    ctx.fillStyle = 'rgba(255,70,50,.35)'; crossQuad(m - 0.06, m + 0.06); ctx.fill();
    beamBox(X(m, S_TOP), T); beamBox(X(m, 1), B);
  }
  // finish line, checkered across the track
  if (L.DIST > mL - 3 && L.DIST < mR + 3) {
    const n = 10, cw = 0.7;
    for (let r = 0; r < n; r++) {
      const y0 = T + r * th / n, y1 = y0 + th / n;
      for (let c = 0; c < 2; c++) { ctx.fillStyle = (r + c) % 2 ? '#f1ece0' : '#141414'; crossQuad(L.DIST + c * cw, L.DIST + (c + 1) * cw, y0, y1); ctx.fill(); }
    }
    beamBox(X(L.DIST, S_TOP), T); beamBox(X(L.DIST, 1), B);
  }
}
function beamBox(x, y) {
  ctx.fillStyle = '#1b1e22'; ctx.fillRect(x - 4, y - 9, 8, 10);
  ctx.fillStyle = '#ff4a35'; ctx.fillRect(x - 1.5, y - 6, 3, 3);
}

function drawRace(now, lay, px, pv) {
  const gx = ghostX(now), gv = ghostV(now);
  const sF = sAt(lay.yFar), sN = sAt(lay.yNear);
  // headlight beams on the asphalt
  ctx.globalCompositeOperation = 'lighter';
  if (G.ghost) { ctx.globalAlpha = 0.18; ctx.drawImage(K.glowW.c, X(gx, sF) - lay.carL * 0.2, lay.yFar - lay.th * 0.12, lay.carL * 1.4 * sF, lay.th * 0.14); }
  ctx.globalAlpha = 0.3; ctx.drawImage(K.glowW.c, X(px, sN) - lay.carL * 0.2, lay.yNear - lay.th * 0.15, lay.carL * 1.6, lay.th * 0.18);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // ghost lane
  if (G.ghost) {
    const nx = X(gx, sF), w = lay.carL * sF;
    if (nx - w > W + 4) edgeArrow(W - 10, lay.yFar - w * 0.12, 1, `Ghost +${Math.round(gx - px)} m`);
    else if (nx < -4) edgeArrow(10, lay.yFar - w * 0.12, -1, `Ghost -${Math.round(px - gx)} m`);
    else {
      const gl = ghostLaunchAt();
      drawCar(K.ghostCar, nx, lay.yFar, sF, gx, gv, gl, ghostFlame(now), now, true);
      ghostLabel(nx - w * 0.5, lay.yFar - w * 0.38, w);
    }
  }
  drawStartTree(now, lay);
  drawParts(now, lay, px, sN, 'back');
  const gl = G.phase === 'race' || G.phase === 'done' || (G.phase === 'fault' && G.fault === 'blown') ? G.launchAt : null;
  const fl = (now - G.flameAt) < 150 || (G.phase === 'race' && needle(now) > 0.985 && hash(Math.floor(now / 45)) > 0.6);
  drawCar(K.car, X(px, sN), lay.yNear, sN, px, pv, gl, fl, now, false);
  drawParts(now, lay, px, sN, 'front');
  drawGantry(lay);
}
function ghostLaunchAt() { return G.ghost && ghostLive() ? G.greenAt + G.ghost.r : null; }
function ghostFlame(now) {
  const gh = G.ghost, run = G.ghostRun;
  if (!gh || !run || !ghostLive()) return false;
  const t = (now - G.greenAt - gh.r) / run.k;
  if (t >= 0 && t < 150) return true;
  for (const [st] of gh.s) if (t >= st && t < st + 150) return true;
  return false;
}

/* Car at nose screen x, ground row y, depth scale s. */
function drawCar(sp, nx, gy, s, xm, v, launchAt, flame, now, ghost) {
  const cl = sp.cl * s, k = s;
  const rearX = nx - cl * (1 - CAR.rearX), rearY = gy - CAR.rearR * cl;
  if (rearX > W + cl * 0.5 || nx < -cl * 0.6) return;
  // wheelie off the line, a little squat on each shift
  let wa = 0;
  if (launchAt != null) { const u = (now - launchAt) / 900; if (u > 0 && u < 1) wa = 0.07 * Math.sin(Math.PI * u) * (1 - 0.4 * u); }
  // contact shadow
  ctx.fillStyle = ghost ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,.5)';
  ctx.beginPath(); ctx.ellipse(nx - cl * 0.48, gy - 1, cl * 0.55, cl * 0.035, 0, 0, Math.PI * 2); ctx.fill();
  const blur = clamp((v - 14) / 40, 0, 1);
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.62;
  ctx.translate(rearX, rearY); ctx.rotate(-wa);
  // motion trail
  if (blur > 0 && !REDUCE) {
    const a0 = ctx.globalAlpha;
    for (let i = 3; i >= 1; i--) { ctx.globalAlpha = a0 * 0.1 * blur * (4 - i) / 3; ctx.drawImage(sp.c, -sp.ox * k - i * 7 * blur * k, -sp.oy * k, sp.w * k, sp.h * k); }
    ctx.globalAlpha = a0;
  }
  // exhaust flame out the back
  if (flame) {
    const fl = cl * (0.28 + 0.12 * hash(now * 0.13)), fh = cl * 0.075;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(K.flame.c, -CAR.rearX * cl - cl * 0.02 - fl, -(0.079 - CAR.rearR) * cl - fh / 2 - cl * 0.0, fl, fh);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(sp.c, -sp.ox * k, -sp.oy * k, sp.w * k, sp.h * k);
  // front wheel rides with the body
  wheel((CAR.frontX - CAR.rearX) * cl, (CAR.rearR - CAR.frontR) * cl, CAR.frontR * cl, xm / (CAR.frontR * CAR_M), blur, ghost);
  // taillight and headlight glow
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = (ghost ? 0.4 : 0.8);
  ctx.drawImage(K.glowR.c, -CAR.rearX * cl - cl * 0.06, -(0.179 - CAR.rearR) * cl - cl * 0.06, cl * 0.12, cl * 0.12);
  ctx.drawImage(K.glowW.c, (0.98 - CAR.rearX) * cl - cl * 0.07, -(0.136 - CAR.rearR) * cl - cl * 0.07, cl * 0.14, cl * 0.14);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  // the rear slick stays planted; extra spin while the tires hook up
  let spin = xm / (CAR.rearR * CAR_M);
  if (launchAt != null) { const u = now - launchAt; if (u > 0) spin += Math.min(u, 500) / 40; }
  ctx.save(); if (ghost) ctx.globalAlpha = 0.62;
  wheel(rearX, rearY, CAR.rearR * cl, spin, blur, ghost);
  ctx.restore();
}

function wheel(x, y, r, ang, blur, ghost) {
  ctx.fillStyle = ghost ? ga('k3', .85) : '#0b0b0c';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ghost ? ga('a', .8) : '#26282b'; ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = ghost ? ga('l2', .5) : '#8e959c';
  ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = ghost ? ga('k4', .6) : '#4e545a';
  ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
  // spokes fade into a blur at speed
  ctx.strokeStyle = ghost ? ga('l3', .8) : '#d5dadf'; ctx.lineWidth = Math.max(1, r * 0.11);
  ctx.globalAlpha *= 1 - 0.75 * blur;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) { const a = ang + i * Math.PI * 0.4; ctx.moveTo(x + Math.cos(a) * r * 0.12, y + Math.sin(a) * r * 0.12); ctx.lineTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5); }
  ctx.stroke();
  ctx.globalAlpha /= 1 - 0.75 * blur;
  if (blur > 0) { ctx.strokeStyle = `rgba(200,205,210,${0.35 * blur})`; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.arc(x, y, r * 0.32, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#e8ebee'; ctx.beginPath(); ctx.arc(x, y, r * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath(); ctx.arc(x, y, r * 0.93, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
}

function ghostLabel(x, y, w) {
  const gh = G.ghost; if (!gh) return;
  const t = gh.leader ? `Ghost: ${gh.name}` : 'Ghost: house car';
  ctx.font = '700 11px Barlow, sans-serif';
  const tw = ctx.measureText(t).width + 14;
  ctx.fillStyle = 'rgba(10,14,12,.75)'; roundRectOn(ctx, x - tw / 2, y - 18, tw, 17, 8); ctx.fill();
  ctx.strokeStyle = ga('a', .8); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = GP.hex; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y - 9.5);
  ctx.textBaseline = 'alphabetic';
}

function edgeArrow(x, y, dir, text) {
  ctx.font = '700 12px Barlow, sans-serif';
  const tw = ctx.measureText(text).width + 30, bx = dir > 0 ? x - tw : x;
  ctx.fillStyle = 'rgba(10,14,12,.78)'; roundRectOn(ctx, bx, y - 12, tw, 24, 12); ctx.fill();
  ctx.strokeStyle = ga('a', .85); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = GP.hex;
  const ax = dir > 0 ? x - 10 : x + 10;
  ctx.beginPath(); ctx.moveTo(ax + dir * 4, y); ctx.lineTo(ax - dir * 4, y - 6); ctx.lineTo(ax - dir * 4, y + 6); ctx.closePath(); ctx.fill();
  ctx.textAlign = dir > 0 ? 'right' : 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x - dir * 20, y + 0.5); ctx.textBaseline = 'alphabetic';
}

/* Tree on its pole between the lanes, just past the start line. */
function treeState(now) {
  const P = G.phase;
  if (P === 'stage' || P === 'tree') return { ...L.treeAt(G.params, now - G.t0), red: false };
  if (P === 'race' || P === 'done') return { pre: true, stage: true, amber: 0, green: true, red: false };
  if (P === 'fault') return { pre: true, stage: true, amber: 0, green: false, red: G.fault === 'redlight' };
  return { pre: false, stage: false, amber: 0, green: false, red: false };
}
function drawStartTree(now, lay) {
  const s = sAt(lay.yMid), x = X(1.4, s);
  if (x < -40 || x > W + 40) return;
  const ph = lay.th * 0.5 * s, bw = lay.th * 0.11 * s, bh = lay.th * 0.36 * s, top = lay.yMid - ph - bh;
  ctx.fillStyle = '#2a2f34'; ctx.fillRect(x - 2, lay.yMid - ph, 4, ph);
  ctx.fillStyle = '#14181b'; roundRectOn(ctx, x - bw / 2, top, bw, bh, 3); ctx.fill();
  const st = treeState(now), r = bw * 0.16;
  const lit = [st.pre, st.stage, st.amber >= 1, st.amber >= 2, st.amber >= 3, st.green, st.red];
  const cols = ['#ffe9b0', '#ffe9b0', '#ffb547', '#ffb547', '#ffb547', '#78ff96', '#ff3c28'];
  const glows = [K.glowW, K.glowW, K.glowA, K.glowA, K.glowA, K.glowG, K.glowR];
  for (let i = 0; i < 7; i++) {
    const by = top + bh * (0.1 + i * 0.13);
    for (const dx of [-0.24, 0.24]) {
      const bx = x + dx * bw;
      ctx.fillStyle = lit[i] ? cols[i] : 'rgba(255,255,255,.08)';
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      if (lit[i]) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glows[i].c, bx - r * 5, by - r * 5, r * 10, r * 10); ctx.globalCompositeOperation = 'source-over'; }
    }
  }
}

/* Finish banner: a checkered sign on two posts at the far edge, facing the
   camera, so it reads clearly as the cars run under its line. */
function drawGantry(lay) {
  const sT = S_TOP, x0 = X(L.DIST - 4, sT), x1 = X(L.DIST + 4, sT);
  if (x1 < -20 || x0 > W + 20) return;
  const bh = lay.th * 0.3, top = lay.trackT - lay.wallH - lay.standH * 0.55, bot = top + bh;
  ctx.fillStyle = '#2b3036';
  ctx.fillRect(x0 - 3, top, 6, lay.trackT - top); ctx.fillRect(x1 - 3, top, 6, lay.trackT - top);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x0 + 2, top + 4, x1 - x0, bh);
  ctx.fillStyle = '#0f1412'; ctx.fillRect(x0, top, x1 - x0, bh);
  const sq = bh * 0.2, n = Math.max(2, Math.round((x1 - x0) / sq));
  for (let i = 0; i < n; i++) {
    const a = x0 + i * (x1 - x0) / n, w = (x1 - x0) / n + 0.5;
    ctx.fillStyle = i % 2 ? '#f1ece0' : '#111'; ctx.fillRect(a, top, w, sq);
    ctx.fillStyle = i % 2 ? '#111' : '#f1ece0'; ctx.fillRect(a, bot - sq, w, sq);
  }
  ctx.strokeStyle = '#f1ece0'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, top, x1 - x0, bh);
  ctx.fillStyle = '#f1ece0'; ctx.font = `900 ${Math.round(bh * 0.46)}px "Big Shoulders Display", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('FINISH', (x0 + x1) / 2, top + bh / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
  ctx.drawImage(K.glowW.c, (x0 + x1) / 2 - (x1 - x0) * 0.7, top - bh * 0.6, (x1 - x0) * 1.4, bh * 2.2);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

/* Smoke and fire, in world meters. Launch smoke from the rear slick,
   fire and smoke from a blown engine. */
function drawParts(now, lay, px, s, layer) {
  if (layer === 'back') {
    const n = REDUCE ? 1 : 4;
    const rearM = px - CAR_M * (1 - CAR.rearX);
    if (G.phase === 'race' && now - G.launchAt < C.launch.smokeMs) {
      for (let i = 0; i < n; i++) G.parts.push({ x: rearM + (Math.random() - 0.7) * 1.4, vx: -0.5 - Math.random() * 4, y: -0.1, vy: -(6 + Math.random() * 40), t0: now, life: 1500 + Math.random() * 900, r0: 0.5, r1: 2.4 + Math.random() * 1.6, kind: 'smoke' });
    }
    if (G.phase === 'fault' && G.fault === 'blown' && now - G.endAt < 1800) {
      const eng = px - CAR_M * 0.2;
      for (let i = 0; i < n; i++) {
        G.parts.push({ x: eng + (Math.random() - 0.5) * 1.2, vx: -2 * Math.random(), y: -CAR_M * 0.2, vy: -(30 + Math.random() * 40), t0: now, life: 1400, r0: 0.4, r1: 2.2, kind: 'smoke' });
        if (now - G.endAt < 1000) G.parts.push({ x: eng + (Math.random() - 0.5) * 0.8, vx: 0, y: -CAR_M * 0.2, vy: -(20 + Math.random() * 30), t0: now, life: 420, r0: 0.4, r1: 0.9, kind: 'fire' });
      }
    }
    if (G.parts.length > 240) G.parts.splice(0, G.parts.length - 240);
    G.parts = G.parts.filter(p => now - p.t0 < p.life);
  }
  const kpx = PPM * s;
  for (const p of G.parts) {
    const k = (now - p.t0) / p.life, front = p.kind === 'fire' || k > 0.25;
    if ((layer === 'front') !== front) continue;
    const t = (now - p.t0) / 1000;
    const x = X(p.x + p.vx * t, s), y = lay.yNear + p.y * kpx + p.vy * t * s, r = (p.r0 + (p.r1 - p.r0) * Math.sqrt(k)) * kpx;
    if (p.kind === 'fire') {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9 * (1 - k);
      ctx.drawImage(K.glowA.c, x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.globalAlpha = 0.42 * (1 - k) * (layer === 'front' ? 0.75 : 1);
      ctx.drawImage(K.smoke.c, x - r, y - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
}

function drawSpeedLines(now, lay, v) {
  if (REDUCE || v < 22) return;
  const a = clamp((v - 22) / 40, 0, 1) * 0.22;
  ctx.strokeStyle = `rgba(241,236,224,${a.toFixed(3)})`; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 18; i++) {
    const y = lay.wallT + (lay.trackB - lay.wallT) * hash(i * 3.1), len = 30 + v * 2.2 * (0.5 + hash(i + 9));
    const sp = v * PPM * (0.8 + 0.6 * hash(i + 4)) / 1000;
    const x = W + len - posMod(now * sp + hash(i + 2) * W * 2, W * 1.8);
    ctx.moveTo(x, y); ctx.lineTo(x + len, y);
  }
  ctx.stroke();
}

function drawNearWall(now, lay, px) {
  const y = lay.trackB;
  tileRow(K.wallNear, y, lay.nearH, S_NEAR);
  // labels and the race progress bar
  const ty = y + lay.nearH * 0.45;
  ctx.font = '700 12px Barlow, sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillStyle = GP.hex; ctx.textAlign = 'left';
  const gh = G.ghost;
  const gname = !gh ? '' : gh.leader ? `Ghost: ${gh.name}, ${gh.daily ? 'today’s' : 'all-time'} leader, ${s3(gh.e)} s` : `Ghost: house car, ${s3(gh.e)} s`;
  ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 4;
  ctx.fillText(gname, 12, ty);
  if (G.phase !== 'idle' && G.phase !== 'over') {
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(241,236,224,.85)';
    ctx.fillText(`Run ${G.runs + (G.phase === 'done' || G.phase === 'fault' ? 0 : 1)}`, W - 12, ty);
  }
  ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic';
  const bx = 12, bw = W - 24, by = lay.sceneB - 6;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(bx, by - 1, bw, 4);
  const pf = clamp(px / L.DIST, 0, 1), gf = clamp(ghostX(now) / L.DIST, 0, 1);
  ctx.fillStyle = ACCENT; ctx.globalAlpha = 0.85; ctx.fillRect(bx, by, bw * pf, 2); ctx.globalAlpha = 1;
  if (G.ghost) { ctx.strokeStyle = GP.hex; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx + gf * bw, by + 1, 3.5, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#f1ece0'; ctx.beginPath(); ctx.arc(bx + pf * bw, by + 1, 3.5, 0, Math.PI * 2); ctx.fill();
}

function drawPrompt(lay) {
  const P = G.phase;
  const msg = {
    stage: 'Staged. Watch the tree.',
    tree: 'Tap the moment it goes green',
    race: G.gear < L.TOP ? 'Shift with the needle in the green' : 'Top gear. Hold it to the line.'
  }[P] || '';
  if (!msg) return;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = P === 'tree' ? '#8fe0a0' : '#f1ece0';
  ctx.font = `800 ${Math.round(clamp(W * 0.05, 16, 22))}px "Big Shoulders Display", sans-serif`;
  ctx.fillText(msg, W / 2, lay.sceneB + 17);
  ctx.textBaseline = 'alphabetic';
}

function drawTree(now, t) {
  ctx.drawImage(K.tree.c, t.x, t.y, K.tree.w, K.tree.h);
  const st = treeState(now);
  const on = { pre: st.pre, stage: st.stage, a1: st.amber >= 1, a2: st.amber >= 2, a3: st.amber >= 3, green: st.green, red: st.red };
  const col = { pre: '#fff1c8', stage: '#fff1c8', a1: '#ffb547', a2: '#ffb547', a3: '#ffb547', green: '#7dff9a', red: '#ff3c28' };
  const glow = { pre: K.glowW, stage: K.glowW, a1: K.glowA, a2: K.glowA, a3: K.glowA, green: K.glowG, red: K.glowR };
  ctx.globalCompositeOperation = 'source-over';
  for (const b of K.tree.bulbs) {
    if (!on[b.id] || (b.id === 'red' && b.col === 0)) continue;
    const x = t.x + b.x, y = t.y + b.y;
    ctx.fillStyle = col[b.id]; ctx.beginPath(); ctx.arc(x, y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.arc(x - b.r * 0.25, y - b.r * 0.25, b.r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glow[b.id].c, x - b.r * 4.5, y - b.r * 4.5, b.r * 9, b.r * 9);
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* Tach: chrome bezel, ticks, redline, shift band, shift light, gear and speed. */
function drawTach(now, t, v) {
  const { x: cx, y: cy, r: R } = t, T = K.tach;
  ctx.drawImage(T.c, cx - T.cc, cy - T.cc, T.w, T.h);
  const P = G.phase, inRace = P === 'race' && G.gear < L.TOP;
  const rpm = needle(now);
  let state = 'off';
  if (inRace) {
    const b = L.band(G.params, G.gear);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(143,224,160,.45)'; ctx.lineWidth = R * 0.12; ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, tachAng(b.lo), tachAng(b.hi)); ctx.stroke();
    ctx.strokeStyle = '#8fe0a0'; ctx.lineWidth = R * 0.16; ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, tachAng(b.plo), tachAng(b.phi)); ctx.stroke();
    state = rpm >= b.lo && rpm <= b.hi ? 'go' : rpm > b.hi ? 'late' : rpm > b.lo - 0.06 ? 'ready' : 'off';
  }
  // shift light pod, upper right of the bezel
  const lx = cx + R * 0.84, ly = cy - R * 0.84, lr = R * 0.15;
  ctx.fillStyle = '#7b8186'; ctx.beginPath(); ctx.arc(lx, ly, lr * 1.25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a0c0d'; ctx.beginPath(); ctx.arc(lx, ly, lr * 1.08, 0, Math.PI * 2); ctx.fill();
  const flash = Math.floor(now / 70) % 2 === 0;
  const lit = state === 'go' ? (flash ? '#7dff9a' : '#ffb547') : state === 'late' ? '#ff3c28' : state === 'ready' ? 'rgba(255,181,71,.45)' : 'rgba(255,181,71,.1)';
  ctx.fillStyle = lit; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.fill();
  if (state === 'go' || state === 'late') {
    ctx.globalCompositeOperation = 'lighter';
    const gs = state === 'late' ? K.glowR : flash ? K.glowG : K.glowA;
    ctx.drawImage(gs.c, lx - lr * 5, ly - lr * 5, lr * 10, lr * 10);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = 'rgba(241,236,224,.6)'; ctx.font = `700 ${Math.max(8, Math.round(R * 0.075))}px Barlow, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('SHIFT', lx, ly - lr * 1.75);
  // gear and speed
  const blown = P === 'fault' && G.fault === 'blown';
  const gear = P === 'race' || P === 'done' || blown ? String(G.gear + 1) : 'N';
  ctx.fillStyle = blown ? '#ff8a7a' : '#ffb547';
  ctx.font = `900 ${Math.round(R * 0.27)}px "Big Shoulders Display", sans-serif`;
  ctx.fillText(gear, cx, cy + R * 0.39);
  ctx.fillStyle = '#f1ece0'; ctx.font = `800 ${Math.round(R * 0.15)}px "Big Shoulders Display", sans-serif`;
  ctx.fillText(`${Math.round(v * L.MPH)} MPH`, cx, cy + R * 0.7);
  // needle
  const a = tachAng(rpm), c = Math.cos(a), s = Math.sin(a), nc = -s, ns = c, w0 = R * 0.035;
  ctx.fillStyle = rpm >= 0.9 ? '#ff4a35' : '#ff7a3c';
  ctx.shadowColor = 'rgba(255,110,60,.7)'; ctx.shadowBlur = R * 0.08;
  ctx.beginPath();
  ctx.moveTo(cx - c * R * 0.16 + nc * w0, cy - s * R * 0.16 + ns * w0);
  ctx.lineTo(cx + c * R * 0.86, cy + s * R * 0.86);
  ctx.lineTo(cx - c * R * 0.16 - nc * w0, cy - s * R * 0.16 - ns * w0);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  const hub = ctx.createRadialGradient(cx - R * 0.03, cy - R * 0.03, 0, cx, cy, R * 0.09);
  hub.addColorStop(0, '#e5e8ea'); hub.addColorStop(1, '#3a3e42');
  ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(K.glare.c, cx - T.cc, cy - T.cc, T.w, T.h);
  ctx.textBaseline = 'alphabetic';
}

function drawFeedback(now, lay) {
  G.fx = G.fx.filter(f => now - f.t0 < 1200);
  const f = G.fx[G.fx.length - 1];
  if (!f) return;
  const k = (now - f.t0) / 1200, y = lay.wallT - lay.standH * 0.35 - k * 12;
  ctx.globalAlpha = 1 - k * k;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 10;
  ctx.fillStyle = f.color; ctx.font = `900 ${Math.round(clamp(W * 0.075, 24, 40))}px "Big Shoulders Display", sans-serif`;
  ctx.fillText(f.text, W / 2, y);
  if (f.sub) { ctx.fillStyle = 'rgba(241,236,224,.92)'; ctx.font = '700 14px Barlow, sans-serif'; ctx.fillText(f.sub, W / 2, y + clamp(W * 0.045, 20, 28)); }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
}

/* ---------- Loop ---------- */
function update(now) {
  const P = G.phase;
  if (P === 'stage' || P === 'tree') {
    const ms = now - G.t0, tr = L.treeAt(G.params, ms), lit = tr.green ? 4 : tr.amber;
    if (lit > G.lit) { if (lit === 4) sfx.green(); else sfx.amber(); G.lit = lit; }
    if (P === 'stage' && ms >= C.tree.firstAmberMs) G.phase = 'tree';
    if (now - G.greenAt > C.tree.timeoutMs) fault('timeout', now);
  } else if (P === 'race') {
    if (L.isBlown(G.params, G.gear, now - G.gearAt)) fault('blown', now);
    else {
      G.race.advanceTo(now - G.launchAt);
      if (G.race.finishT != null) finishRun(now);
    }
  } else if ((P === 'done' || P === 'fault') && now - G.endAt > C.resultSecs * 1000) {
    next(now);
  }
  // HUD
  if (G.phase === 'race') shell.set('time', s3(Math.max(0, now - G.greenAt)));
  else if (G.phase === 'tree' || G.phase === 'stage') shell.set('time', '0.000');
  if (G.phase === 'race' || G.phase === 'done') shell.set('mph', String(Math.round(playerV(now) * L.MPH)));
  // engine drone
  const live = ['stage', 'tree', 'race', 'done'].includes(G.phase) || (G.phase === 'fault' && G.fault !== 'blown');
  const rpm = needle(now);
  setDrone(rpm, live ? (G.phase === 'done' ? 0.03 : 0.045 + 0.05 * rpm) : 0);
  if (SHOT) shotStep(now);
  draw(now);
}
let frozen = false;
function frame(now) { if (!frozen) update(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

/* A hidden tab freezes the frame loop but not the clock. Restart the run
   with the same tree and bands rather than blowing the engine on return. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { setDrone(0, 0); return; }
  if (['stage', 'tree', 'race'].includes(G.phase)) {
    setupRun(performance.now(), true);
    shell.callout('Restaged', 'The run restarted while the tab was hidden.', '');
  }
});

/* Test hooks for local dev only. ?shot=race&at=1800 starts a run, launches
   on green, shifts in the band and freezes the frame that many ms after
   launch, for headless screenshots. shot=stage freezes on the ambers,
   shot=finish freezes after the finish line. */
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const QS = LOCAL && typeof URLSearchParams !== 'undefined' ? new URLSearchParams(location.search) : null;
const SHOT = QS && QS.get('shot') || '';
const SHOT_AT = QS ? +(QS.get('at') || 0) : 0;
function shotStep(now) {
  const P = G.phase;
  if (P === 'tree' && SHOT !== 'stage' && now >= G.greenAt + (+(QS.get('rt') || 140))) tap(now);
  else if (P === 'race' && G.gear < L.TOP && needle(now) >= L.band(G.params, G.gear).c) tap(now);
  if (SHOT === 'stage' && P === 'tree' && now - G.t0 >= C.tree.firstAmberMs + C.tree.amberGapMs + 120) frozen = true;
  if (SHOT === 'race' && P === 'race' && now - G.launchAt >= SHOT_AT) frozen = true;
  if (SHOT === 'finish' && P === 'done' && now - G.endAt >= SHOT_AT) frozen = true;
}
if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(() => { K.key = ''; });
if (SHOT) setTimeout(() => { const b = document.getElementById('play'); if (b) b.click(); }, 300);
if (LOCAL) window.__game = { G, L, C, tap, step: update };
