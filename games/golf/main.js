/* Sweet Spot Golf.
   Top-down view of Sweet Spot National. Classic three-click swing:
   tap to start, tap to set power, tap as the needle crosses the line.
   Putts use a single fill meter. Rules and physics live in golf.js and
   round.js; this file draws, animates and wires input. */
import { TOUCH, store } from '../../core/util.js';
import { dailyRng, mulberry32 } from '../../core/seed/seed.js';
import { createMeter } from '../../core/meter/meter.js';
import { nz, tn, coreSfx } from '../../core/audio/audio.js';
import { mountShell } from '../../core/ui/shell.js';
import C from './config.js';
import { HOLES } from './holes.js';
import { clamp, dist, dirOf, headingTo, inPoly, polyDist } from './geo.js';
import { clubsFor, reachPerPower, shotPowerFor, puttPowerFor, toPar } from './golf.js';
import { createRound } from './round.js';
import { createSwing } from './swing.js';

/* ---------- Sound ---------- */
const sfx = {
  ...coreSfx,
  swish() { nz({ dur: 0.26, type: 'bandpass', f: 380, f2: 2600, q: 1.4, g: 0.22, a: 0.12 }); },
  contact(perfect) {
    if (perfect) {
      tn({ f: 2300, dur: 0.07, type: 'triangle', g: 0.2, a: 0.001 });
      tn({ f: 3500, dur: 0.05, type: 'sine', g: 0.09, a: 0.001 });
      nz({ dur: 0.035, type: 'highpass', f: 3200, g: 0.22, a: 0.001 });
    } else {
      tn({ f: 1150, dur: 0.08, type: 'triangle', g: 0.16, a: 0.001 });
      nz({ dur: 0.07, type: 'bandpass', f: 1300, q: 0.8, g: 0.2, a: 0.001 });
    }
  },
  putt() { tn({ f: 820, dur: 0.06, type: 'triangle', g: 0.12, a: 0.001 }); nz({ dur: 0.03, type: 'bandpass', f: 2000, g: 0.08, a: 0.001 }); },
  land() { nz({ dur: 0.09, type: 'lowpass', f: 320, g: 0.22, a: 0.002 }); },
  sand() { nz({ dur: 0.22, type: 'lowpass', f: 520, f2: 200, g: 0.42, a: 0.003 }); nz({ dur: 0.3, type: 'bandpass', f: 1800, q: 0.6, g: 0.06, a: 0.01 }); },
  splash() { nz({ dur: 0.75, type: 'lowpass', f: 1900, f2: 260, g: 0.32, a: 0.008 }); nz({ dur: 0.45, type: 'bandpass', f: 3200, q: 0.7, g: 0.08, a: 0.02, delay: 0.06 }); },
  cup() {
    nz({ dur: 0.08, type: 'lowpass', f: 700, g: 0.3, a: 0.002 });
    [[560, 0.05], [760, 0.13], [640, 0.2]].forEach(([f, d]) => tn({ f, dur: 0.1, type: 'triangle', g: 0.1, a: 0.002, delay: d }));
  },
  cheer(big) { nz({ dur: big ? 2.6 : 1.5, f: 900, q: 0.6, g: big ? 0.22 : 0.12, a: 0.25 }); nz({ dur: big ? 2.2 : 1.3, f: 2400, q: 0.7, g: 0.05, a: 0.25 }); }
};

/* ---------- Shell ---------- */
const COURSE_LENGTHS = [3, 6, 9, 12, 18];
const parFor = n => HOLES.slice(0, n).reduce((s, h) => s + h.par, 0);
/* Course boards hold strokes to par (never above +72, since a hole is picked
   up at double par); arcade scores start at 100. One fmt covers both. */
const fmt = v => v >= 100 ? `${v.toLocaleString()} pts` : toPar(v);
if (store.get('ss.golf.mode', null) == null) store.set('ss.golf.mode', 'course-9');

const shell = mountShell({
  game: 'golf', name: 'Golf', titleHtml: 'Sweet Spot<br>Golf',
  lede: 'A three-click swing on Sweet Spot National, an original 18-hole course. Play 3 to 18 holes, or arcade until your hearts run out.',
  rules: [
    ['Swing', 'Tap to start, tap to set power, then tap as the needle crosses the line. Early hooks, late slices.'],
    ['Aim', 'The caddie picks a club and aims at the pin. Change either with the buttons or arrow keys. Wind bends every shot.'],
    ['Putt', 'Tap to start, tap to stop. Arrows on the green show which way it breaks.']
  ],
  modes: [
    { id: 'daily', label: 'Daily', board: 'course-9', daily: true, note: 'Holes 1 to 9 with the same wind for everyone today. Lowest score wins.' },
    ...COURSE_LENGTHS.map(n => ({ id: `course-${n}`, label: String(n), note: `${n} holes of stroke play, par ${parFor(n)}. Lowest score wins.` })),
    { id: 'arcade', label: 'Arcade', note: 'Play on until your hearts run out. Bogey or worse costs a heart, and the wind picks up every nine holes. 100 points a hole, bonus for birdies and eagles.' }
  ],
  hud: [
    { id: 'hole', label: 'Hole', init: '1' },
    { id: 'score', label: 'Score', amber: true, init: 'E' },
    { id: 'strokes', label: 'Strokes', init: '0' },
    { hearts: true, label: 'Hearts' },
    { id: 'pin', label: 'To pin', unit: 'yds', init: '0' }
  ],
  boards: [
    { id: 'today', label: 'Today', mode: 'course-9', period: 'daily', note: 'Holes 1 to 9, same wind for everyone. Resets at midnight UTC.', empty: 'No one has played today’s round yet.' },
    ...COURSE_LENGTHS.map(n => ({ id: `c${n}`, label: String(n), mode: `course-${n}`, period: 'all', note: `Best score over ${n} holes, par ${parFor(n)}.` })),
    { id: 'arcade', label: 'Arcade', mode: 'arcade', period: 'all', note: 'Most points in one arcade run.' }
  ],
  hearts: C.arcade.hearts, playLabel: 'Tee off', againLabel: 'Play again',
  fmt,
  share: (score, meta) => meta && meta.strokes != null
    ? `I shot ${toPar(score)} through ${meta.holes} on Sweet Spot Golf.`
    : `I played ${meta ? meta.holes : 0} holes for ${score.toLocaleString()} points in Sweet Spot Golf arcade.`,
  onStart: startRun,
  onAction: tap,
  onMenu() { G.phase = 'idle'; G.round = null; showControls(false); }
});

/* HUD: course modes show strokes on the hole, arcade shows hearts. */
const cellOf = el => el && el.closest('.cell');
const strokesCell = cellOf(document.getElementById('h-strokes'));
const heartsCell = cellOf(document.getElementById('hearts'));
const sbEl = document.querySelector('#hud .sb');
const pinUnit = cellOf(document.getElementById('h-pin')).querySelector('.unit');
function hudFor(arcade) {
  if (strokesCell) strokesCell.hidden = arcade;
  if (heartsCell) heartsCell.hidden = !arcade;
  if (sbEl) { sbEl.style.gridTemplateColumns = 'repeat(4,1fr)'; sbEl.style.setProperty('--cols', '4'); }
}
hudFor(false);

/* ---------- On-screen club and aim controls (bottom left, away from the tap area) ---------- */
const CHEV = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const ctlEl = document.createElement('div');
ctlEl.id = 'gctl';
ctlEl.innerHTML = `
  <div class="grow" role="group" aria-label="Club">
    <button type="button" data-act="club" data-d="1" aria-label="Shorter club" title="Shorter club (Down)">${CHEV('M6 12h12')}</button>
    <div class="gval"><b id="gClub">Driver</b><span id="gClubYds"></span></div>
    <button type="button" data-act="club" data-d="-1" aria-label="Longer club" title="Longer club (Up)">${CHEV('M6 12h12M12 6v12')}</button>
  </div>
  <div class="grow" role="group" aria-label="Aim">
    <button type="button" data-act="aim" data-d="-1" aria-label="Aim left" title="Aim left (Left)">${CHEV('M15 5l-7 7 7 7')}</button>
    <div class="gval"><b>Aim</b><span id="gAim">At the pin</span></div>
    <button type="button" data-act="aim" data-d="1" aria-label="Aim right" title="Aim right (Right)">${CHEV('M9 5l7 7-7 7')}</button>
  </div>`;
document.getElementById('app').appendChild(ctlEl);
const ctlShown = { v: false };
function showControls(on) {
  if (ctlShown.v === on) return;
  ctlShown.v = on; ctlEl.classList.toggle('show', on);
}
ctlEl.querySelectorAll('button').forEach(b => {
  let hold = 0, rep = 0;
  const act = () => { if (b.dataset.act === 'aim') aimBy(+b.dataset.d); else clubBy(+b.dataset.d); };
  const stop = () => { clearTimeout(hold); clearInterval(rep); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); act();
    if (b.dataset.act === 'aim') hold = setTimeout(() => { rep = setInterval(act, 70); }, 300);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, stop));
  b.addEventListener('click', e => { if (e.detail === 0) act(); });   // keyboard activation
});
window.addEventListener('keydown', e => {
  if (!shell.playing || G.phase !== 'address') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); aimBy(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 5 : 1); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); clubBy(e.key === 'ArrowUp' ? -1 : 1); }
});

/* ---------- Canvas ---------- */
let reframe = () => {};          // re-fits the camera after a resize
const cvs = shell.canvas, ctx = cvs.getContext('2d');
let W = 0, H = 0, DPR = 1;
const L = { top: 80, barX: 0, barY: 0, barW: 300, barH: 16, mapBottom: 400 };
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cvs.clientWidth; H = cvs.clientHeight;
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  layout();
  reframe();
}
function layout() {
  const hud = document.getElementById('hud');
  L.top = hud ? hud.getBoundingClientRect().bottom + 6 : 80;
  const ctlTop = H - 16 - 96;
  L.barW = Math.min(440, W - 48); L.barX = (W - L.barW) / 2;
  L.barY = ctlTop - 30; L.barH = 16;
  L.mapBottom = L.barY - 44;
}
window.addEventListener('resize', resize); resize();

/* ---------- State ---------- */
const swing = createSwing(C.swing);
const putter = createMeter({ orientation: 'horizontal', mode: 'fill', speed: 1 / C.putt.fillSecs, zones: [] });
const G = {
  phase: 'idle',        // idle | intro | address | swing | putt | flight | settle | holed | over
  round: null, daily: false,
  club: null, heading: 0, marker: null, readyAt: 0,
  res: null, anim: null, shown: null, trail: [], t0: 0, last: 0
};
const cam = { x: 0, y: 200, s: 1 }, camT = { x: 0, y: 200, s: 1 };
let camSnap = true;

const hole = () => G.round ? G.round.hole : HOLES[0];
const isPutt = () => !!(G.club && G.club.putter);

function startRun(mode) {
  G.daily = !!mode.daily;
  const rng = G.daily ? dailyRng('golf') : mulberry32((Math.random() * 2 ** 32) >>> 0);
  G.round = createRound({ mode: mode.board || mode.id, rng });
  hudFor(G.round.arcade);
  shell.hearts.set(G.round.hearts);
  layout();
  nextHole(performance.now());
}

function nextHole(now) {
  const r = G.round;
  r.startHole();
  G.trail = []; G.res = null; G.anim = null; G.shown = null; G.club = null;
  G.phase = 'intro'; G.t0 = now;
  const h = r.hole;
  shell.callout(`Hole ${h.n}`, `${h.name}. Par ${h.par}, ${h.yards} yds`, 'mini');
  frameHole(h); camSnap = true;
  hud();
}

function toAddress(now) {
  const r = G.round, p = r.plan();
  G.club = p.club; G.heading = p.heading;
  G.phase = 'address'; G.readyAt = now + 280; G.shown = null;
  swing.reset(); putter.reset();
  refreshAim();
  hud();
}

function tap(time) {
  const now = performance.now();
  switch (G.phase) {
    case 'intro': if (now - G.t0 > 350) toAddress(now); break;
    case 'address':
      if (now < G.readyAt) return;
      if (isPutt()) { putter.start(time); G.phase = 'putt'; }
      else { swing.start(time); G.phase = 'swing'; }
      sfx.tick();
      break;
    case 'swing': onSwing(swing.tap(time), time); break;
    case 'putt': strike(putter.stop(time).value, 0, now); break;
    case 'settle': if (now - G.t0 > 400) afterSettle(now); break;
    case 'holed': if (now - G.t0 > 900) afterHole(now); break;
  }
}

function onSwing(ev, time) {
  if (!ev) return;
  if (ev.stage === 'power') { sfx.tick(); sfx.swish(); return; }
  strike(ev.power, ev.acc, performance.now());
}

function strike(power, acc, now) {
  const r = G.round, from = { ...r.ball };
  const res = r.hit({ club: G.club, heading: G.heading, power, acc });
  G.res = res;
  if (res.kind === 'putt') {
    sfx.putt();
    const total = res.dur / C.anim.puttSpeed;
    G.anim = { kind: 'putt', t0: now, dur: Math.max(0.25, total) * 1000, path: res.path, realDur: res.dur };
  } else {
    sfx.contact(res.quality === 'perfect');
    if (res.quality === 'perfect') sfx.perfect();
    const fly = clamp(0.55 + res.carry / 210, 0.6, 1.9);
    const rollLen = dist(res.land, res.rollTo);
    const roll = rollLen > 0.3 ? clamp(0.25 + rollLen / 24, 0.3, 1.3) : 0;
    G.anim = { kind: 'shot', t0: now, fly: fly * 1000, roll: roll * 1000, landed: false };
  }
  frameShot(from, res);
  G.trail.push({ from, to: res.rollTo || res.rest, kind: res.kind });
  G.phase = 'flight';
  showControls(false);
}

const LIE_WORD = { fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker', green: 'On the green', tee: 'Tee' };
const STRIKE_WORD = { perfect: 'Perfect strike', good: 'Solid', hook: 'Hooked it', slice: 'Sliced it' };

function landed(now) {
  const res = G.res, out = res.outcome;
  G.shown = res.rollTo || res.rest;
  if (res.event === 'water') {
    sfx.splash();
    shell.callout('Water', 'Penalty stroke. Drop and play on.', 'mini bad');
  } else if (res.event === 'ob') {
    sfx.land();
    shell.callout('Out of bounds', 'Penalty stroke. Play again from the same spot.', 'mini bad');
  } else if (out.holed && !out.gimme) {
    sfx.cup();
  } else if (out.gimme) {
    sfx.cup();
    shell.callout('Gimme', 'Tapped in', 'mini');
  } else if (res.kind === 'shot') {
    if (res.lie === 'bunker') sfx.sand(); else sfx.land();
    const yds = Math.round(res.carry);
    shell.callout(LIE_WORD[res.lie] || 'Rough', `${STRIKE_WORD[res.quality]}, ${yds} yds`, res.quality === 'perfect' ? 'mini gold' : 'mini');
  } else if (res.lie !== 'green') {
    if (res.lie === 'bunker') sfx.sand();
    shell.callout(LIE_WORD[res.lie] || 'Rough', 'Rolled off the green', 'mini bad');
  }
  if (out.pickedUp && !out.holed) shell.callout('Picked up', `Double par is the limit`, 'mini bad');
  G.phase = 'settle'; G.t0 = now;
  hud();
}

function afterSettle(now) {
  if (G.res && G.res.outcome.done) endHole(now);
  else toAddress(now);
}

function endHole(now) {
  const r = G.round, e = r.endHole();
  const diff = e.diff;
  let sub;
  if (r.arcade) {
    const pts = C.arcade.perHole + (diff === -1 ? C.arcade.birdie : diff <= -2 ? C.arcade.eagle : 0);
    sub = e.heartLost ? `${e.strokes} on a par ${e.par}. Heart lost<b>+${pts}</b>` : `${e.strokes} on a par ${e.par}<b>+${pts}</b>`;
    shell.hearts.set(r.hearts);
    if (e.heartLost) sfx.heartLost();
  } else {
    sub = `${e.strokes} on a par ${e.par}<b>${toPar(r.toPar)}</b>`;
  }
  if (diff < 0) { sfx.cheer(diff <= -2); sfx.perfect(); }
  shell.callout(e.name, sub, diff < 0 ? 'gold long' : diff === 0 ? 'good long' : 'bad long');
  G.phase = 'holed'; G.t0 = now;
  hud();
}

function afterHole(now) {
  if (G.round.over) finish(); else nextHole(now);
}

function finish() {
  G.phase = 'over';
  showControls(false);
  const r = G.round, s = r.summary();
  shell.gameOver({
    score: s.score,
    head: r.arcade ? 'Out of hearts' : 'Round complete',
    line: r.arcade
      ? `${s.meta.holes} hole${s.meta.holes === 1 ? '' : 's'} played`
      : `Shot ${s.meta.strokes} on a par ${s.meta.par}`,
    stats: s.stats,
    meta: s.meta
  });
}

/* ---------- Aim and club ---------- */
function clubList() { const r = G.round; return clubsFor(r.hole, r.ball, r.lie); }
function reachOf(club) {
  const r = G.round;
  return club.putter ? C.putt.maxYds : reachPerPower(club, r.lie, G.heading, r.wind, 'fairway');
}
function clubBy(d) {
  if (G.phase !== 'address') return;
  const list = clubList(), i = list.indexOf(G.club);
  const j = clamp(i + d, 0, list.length - 1);
  if (j === i) return;
  G.club = list[j];
  if (G.club.putter) G.heading = headingTo(G.round.ball, G.round.hole.pin);
  sfx.tick(); refreshAim();
}
function aimBy(d, mult = 1) {
  if (G.phase !== 'address') return;
  const r = G.round, dPin = dist(r.ball, r.hole.pin);
  const D = isPutt() ? Math.max(1, dPin) : Math.min(reachOf(G.club), Math.max(dPin, 20));
  const step = isPutt() ? Math.max(0.06, D * 0.012) : Math.max(0.6, D * 0.012);
  G.heading += d * mult * Math.atan(step / D);
  refreshAim();
}
function refreshAim() {
  const r = G.round; if (!r || !G.club) return;
  const dPin = dist(r.ball, r.hole.pin);
  if (G.club.putter) {
    G.marker = puttPowerFor(r.hole, r.ball, G.heading);
  } else {
    const p = shotPowerFor(r.hole, r.lie, G.club, G.heading, r.wind, dPin, 'green');
    G.marker = p < 0.995 ? p : null;
  }
  const list = clubList();
  document.getElementById('gClub').textContent = G.club.name;
  document.getElementById('gClubYds').textContent = G.club.putter ? `Up to ${C.putt.maxYds * 3} ft` : `${Math.round(reachOf(G.club))} yds`;
  ctlEl.querySelectorAll('[data-act="club"]').forEach(b => { b.disabled = list.length < 2; });
  let off = G.heading - headingTo(r.ball, r.hole.pin);
  off = Math.atan2(Math.sin(off), Math.cos(off));
  const lat = Math.tan(clamp(off, -1.4, 1.4)) * dPin;
  const unit = G.club.putter ? 'ft' : 'yds', k = G.club.putter ? 3 : 1;
  const v = Math.round(Math.abs(lat) * k);
  document.getElementById('gAim').textContent = v < 1 ? 'At the pin' : `${v} ${unit} ${lat < 0 ? 'left' : 'right'}`;
  frameAddress();
}

/* ---------- HUD ---------- */
function hud() {
  const r = G.round; if (!r) return;
  shell.set('hole', r.holeNo);
  shell.set('score', r.arcade ? r.points.toLocaleString() : toPar(r.toPar));
  shell.set('strokes', r.strokes);
  const d = dist(r.ball, r.hole.pin), onGreen = r.lie === 'green';
  shell.set('pin', r.done ? 0 : onGreen ? Math.round(d * 3) : Math.round(d));
  if (pinUnit) pinUnit.textContent = onGreen ? 'ft' : 'yds';
}

/* ---------- Camera ---------- */
function setCam(box, minSpan) {
  reframe = () => setCam(box, minSpan);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const w = Math.max(box.x1 - box.x0, minSpan), h = Math.max(box.y1 - box.y0, minSpan);
  const vw = W - 28, vh = Math.max(120, L.mapBottom - L.top - 36);
  camT.s = Math.min(vw / (w * 1.2), vh / (h * 1.2), 40);
  camT.x = cx; camT.y = cy;
}
const boxOf = pts => ({
  x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)),
  y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y))
});
function frameHole(h) {
  const pts = h.path.filter((_, i) => i % 4 === 0).concat([h.pin]);
  const b = boxOf(pts); b.x0 -= 25; b.x1 += 25; b.y0 -= 10; b.y1 += 18;
  setCam(b, 60);
}
function aimEnd() {
  const r = G.round, b = r.ball;
  const len = G.club.putter ? dist(b, r.hole.pin) + 1.2 : reachOf(G.club);
  const d = dirOf(G.heading);
  return { x: b.x + d.x * len, y: b.y + d.y * len };
}
function frameAddress() {
  const r = G.round, b = r.ball, pin = r.hole.pin;
  if (G.club.putter) { setCam(boxOf([b, pin]), 9); return; }
  const e = aimEnd(), pts = [b, e];
  if (dist(b, pin) < reachOf(G.club) * 1.25 || dist(e, pin) < 70) pts.push(pin);
  setCam(boxOf(pts), 40);
}
function frameShot(from, res) {
  const pts = [from, res.land || res.rest, res.rollTo || res.rest];
  if (res.kind === 'putt') { pts.push(G.round.hole.pin); setCam(boxOf(pts), 9); return; }
  if (dist(res.land, G.round.hole.pin) < 60) pts.push(G.round.hole.pin);
  setCam(boxOf(pts), 40);
}
function moveCam(dt) {
  if (camSnap) { Object.assign(cam, camT); camSnap = false; return; }
  const k = 1 - Math.exp(-dt * 3.2);
  cam.x += (camT.x - cam.x) * k; cam.y += (camT.y - cam.y) * k;
  cam.s = Math.exp(Math.log(cam.s) + (Math.log(camT.s) - Math.log(cam.s)) * k);
}
const midY = () => (L.top + L.mapBottom) / 2;
const SX = x => W / 2 + (x - cam.x) * cam.s;
const SY = y => midY() - (y - cam.y) * cam.s;

/* ---------- Hole art (cached per hole) ---------- */
function art(h) {
  if (h._art) return h._art;
  const toPath = poly => { const p = new Path2D(); poly.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); p.closePath(); return p; };
  // tree line just outside the corridor, placed the same way every time
  const rnd = mulberry32(h.n * 977 + 13), trees = [];
  const xs = h.bounds.map(p => p[0]), ys = h.bounds.map(p => p[1]);
  const x0 = Math.min(...xs) - 50, x1 = Math.max(...xs) + 50, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 50;
  for (let i = 0; i < 1400 && trees.length < 260; i++) {
    const p = { x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) }, r = 4 + rnd() * 5;
    if (inPoly(p, h.bounds)) { rnd(); continue; }
    const d = polyDist(p, h.bounds);
    if (d < r * 0.6 || d > 46) { rnd(); continue; }
    if (h.water.some(w => inPoly(p, w))) { rnd(); continue; }
    trees.push({ ...p, r, shade: rnd() });
  }
  const stakes = h.bounds.filter((_, i) => i % 2 === 0);
  const greenC = h.path[h.path.length - 1];
  const chevrons = [];
  for (let gx = -16; gx <= 16; gx += 4.5) for (let gy = -16; gy <= 16; gy += 4.5) {
    const p = { x: greenC.x + gx, y: greenC.y + gy };
    if (inPoly(p, h.green) && polyDist(p, h.green) === 0 && dist(p, h.pin) > 1.6) chevrons.push(p);
  }
  h._art = {
    bounds: toPath(h.bounds), fairway: toPath(h.fairway), green: toPath(h.green),
    bunkers: h.bunkers.map(toPath), water: h.water.map(toPath), trees, stakes, chevrons
  };
  return h._art;
}

/* ---------- Drawing ---------- */
function drawWorld(now) {
  const h = hole(), A = art(h), s = cam.s;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#07120d'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(DPR * s, 0, 0, -DPR * s, DPR * (W / 2 - cam.x * s), DPR * (midY() + cam.y * s));
  // corridor (rough)
  ctx.fillStyle = '#163b28'; ctx.fill(A.bounds);
  ctx.strokeStyle = 'rgba(8,20,14,.9)'; ctx.lineWidth = 3; ctx.stroke(A.bounds);
  // water
  for (const w of A.water) {
    ctx.fillStyle = '#17405f'; ctx.fill(w);
    ctx.strokeStyle = '#2f6c96'; ctx.lineWidth = 1.2; ctx.stroke(w);
  }
  // fairway with mowing stripes
  ctx.save(); ctx.clip(A.fairway);
  ctx.fillStyle = '#21603c'; ctx.fill(A.fairway);
  ctx.fillStyle = 'rgba(255,255,255,.035)';
  for (let y = -20; y < h.len + 40; y += 16) ctx.fillRect(-200, y, 400, 8);
  ctx.restore();
  // green
  ctx.strokeStyle = '#2a7a49'; ctx.lineWidth = 2.6; ctx.stroke(A.green);
  ctx.fillStyle = '#379a5c'; ctx.fill(A.green);
  // bunkers
  for (const b of A.bunkers) {
    ctx.fillStyle = '#cdb985'; ctx.fill(b);
    ctx.strokeStyle = '#9d8a5a'; ctx.lineWidth = 0.8; ctx.stroke(b);
  }
  // tee box
  const t = h.teeBox;
  ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(-t.h);
  ctx.fillStyle = '#226a42'; ctx.fillRect(-5, -3, 10, 7);
  ctx.fillStyle = '#f1ece0'; ctx.beginPath(); ctx.arc(-3.5, 2.5, 0.6, 0, 7); ctx.arc(3.5, 2.5, 0.6, 0, 7); ctx.fill();
  ctx.restore();
  // trees
  for (const tr of A.trees) {
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(tr.x + tr.r * 0.25, tr.y - tr.r * 0.3, tr.r, 0, 7); ctx.fill();
    ctx.fillStyle = tr.shade > 0.5 ? '#0f2c1d' : '#12331f'; ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(143,224,160,.07)'; ctx.beginPath(); ctx.arc(tr.x - tr.r * 0.3, tr.y + tr.r * 0.3, tr.r * 0.55, 0, 7); ctx.fill();
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // white stakes along the out-of-bounds line
  if (s > 0.9) {
    ctx.fillStyle = 'rgba(241,236,224,.55)';
    const r = clamp(s * 0.5, 1, 2.2);
    for (const [x, y] of A.stakes) { const px = SX(x), py = SY(y); if (px > -5 && px < W + 5 && py > -5 && py < H + 5) ctx.fillRect(px - r / 2, py - r, r, r * 2); }
  }
  // water shimmer
  ctx.strokeStyle = 'rgba(160,210,255,.12)'; ctx.lineWidth = 1;
  for (const w of h.water) {
    const c = w.reduce((a, p) => ({ x: a.x + p[0] / w.length, y: a.y + p[1] / w.length }), { x: 0, y: 0 });
    for (let k = -1; k <= 1; k++) {
      const sh = Math.sin(now / 900 + k * 2) * 3;
      const px = SX(c.x + sh + k * 4), py = SY(c.y + k * 5);
      ctx.beginPath(); ctx.moveTo(px - 6, py); ctx.lineTo(px + 6, py); ctx.stroke();
    }
  }
  drawSlope(h, A);
}

/* Break arrows on the green, shown when the ball is near it. */
function drawSlope(h, A) {
  const r = G.round;
  const near = r && r.ball && dist(r.ball, h.pin) < 60;
  if (!near || cam.s < 2) return;
  const d = h.slope.deg * Math.PI / 180, ux = Math.sin(d), uy = -Math.cos(d);
  const len = clamp(cam.s * 1.2, 4, 12) * (0.6 + h.slope.pct * 0.25);
  ctx.strokeStyle = 'rgba(241,236,224,.32)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  for (const p of A.chevrons) {
    const x = SX(p.x), y = SY(p.y);
    const tx = x + ux * len / 2, ty = y + uy * len / 2;
    ctx.beginPath();
    ctx.moveTo(tx - ux * len + uy * len * 0.55, ty - uy * len - ux * len * 0.55);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - ux * len - uy * len * 0.55, ty - uy * len + ux * len * 0.55);
    ctx.stroke();
  }
}

function drawPin(now) {
  const h = hole(), x = SX(h.pin.x), y = SY(h.pin.y);
  ctx.fillStyle = '#050a07';
  ctx.beginPath(); ctx.ellipse(x, y, Math.max(2.2, cam.s * 0.12), Math.max(1.8, cam.s * 0.1), 0, 0, 7); ctx.fill();
  const pole = clamp(cam.s * 3, 22, 46);
  ctx.strokeStyle = '#f1ece0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - pole); ctx.stroke();
  const w = G.round ? G.round.wind : { mph: 6, deg: 90 };
  const side = Math.sin(w.deg * Math.PI / 180) >= 0 ? 1 : -1;
  const wave = Math.sin(now / 180) * 2 * (0.4 + w.mph / 14);
  const fw = 14 + w.mph * 0.4;
  ctx.fillStyle = '#d23a2e';
  ctx.beginPath(); ctx.moveTo(x, y - pole); ctx.quadraticCurveTo(x + side * fw * 0.5, y - pole + 2 + wave, x + side * fw, y - pole + 5); ctx.lineTo(x, y - pole + 10); ctx.closePath(); ctx.fill();
}

function drawTrail() {
  ctx.setLineDash([2, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(241,236,224,.35)';
  const n = G.phase === 'flight' ? G.trail.length - 1 : G.trail.length;
  for (let i = 0; i < n; i++) {
    const t = G.trail[i];
    ctx.beginPath(); ctx.moveTo(SX(t.from.x), SY(t.from.y)); ctx.lineTo(SX(t.to.x), SY(t.to.y)); ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawAim(now) {
  if (!['address', 'swing', 'putt'].includes(G.phase)) return;
  const r = G.round, b = r.ball, e = aimEnd();
  const bx = SX(b.x), by = SY(b.y), ex = SX(e.x), ey = SY(e.y);
  ctx.strokeStyle = 'rgba(255,181,71,.85)'; ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]); ctx.lineDashOffset = -now / 40;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  if (!G.club.putter) {
    const rr = Math.max(6, cam.s * 4);
    ctx.beginPath(); ctx.arc(ex, ey, rr, 0, 7); ctx.stroke();
    ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, 7); ctx.fill();
  } else {
    const a = Math.atan2(ey - by, ex - bx);
    ctx.fillStyle = '#ffb547';
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a - 0.4) * 10, ey - Math.sin(a - 0.4) * 10); ctx.lineTo(ex - Math.cos(a + 0.4) * 10, ey - Math.sin(a + 0.4) * 10); ctx.fill();
  }
}

/* Ball position and height for the current animation. */
function ballNow(now) {
  const r = G.round;
  if (!r) return null;
  const a = G.anim, res = G.res;
  if (G.phase === 'flight' && a) {
    const t = now - a.t0;
    if (a.kind === 'putt') {
      const tr = Math.min(t / a.dur, 1) * a.realDur, p = a.path;
      let i = 1; while (i < p.length - 1 && p[i].t < tr) i++;
      const p0 = p[i - 1], p1 = p[i], k = p1.t > p0.t ? clamp((tr - p0.t) / (p1.t - p0.t), 0, 1) : 1;
      if (t >= a.dur) { landed(now); }
      return { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k, h: 0 };
    }
    if (t < a.fly) {
      const u = t / a.fly, v = 1 - u;
      return {
        x: v * v * res.from.x + 2 * v * u * res.ctrl.x + u * u * res.land.x,
        y: v * v * res.from.y + 2 * v * u * res.ctrl.y + u * u * res.land.y,
        h: 4 * res.apex * u * v
      };
    }
    if (!a.landed) { a.landed = true; if (res.event === 'ok' && res.lie !== 'bunker') sfx.land(); }
    const k = a.roll ? clamp((t - a.fly) / a.roll, 0, 1) : 1, e = 1 - (1 - k) * (1 - k);
    if (k >= 1) landed(now);
    return { x: res.land.x + (res.rollTo.x - res.land.x) * e, y: res.land.y + (res.rollTo.y - res.land.y) * e, h: 0 };
  }
  if (G.phase === 'settle' && G.shown) {
    if (G.res.event === 'water' || (G.res.outcome.holed && !G.res.outcome.gimme)) return null;
    return { ...G.shown, h: 0, fade: G.res.event === 'ob' ? 1 - (now - G.t0) / (C.anim.settleSecs * 1000) : 1 };
  }
  if (G.phase === 'holed' || r.done) return null;
  return { ...r.ball, h: 0 };
}

function drawBall(b) {
  if (!b) return;
  const x = SX(b.x), y = SY(b.y), base = clamp(cam.s * 0.4, 2.6, 6);
  const lift = b.h * cam.s * 0.55, r = base * (1 + b.h / 45);
  ctx.globalAlpha = clamp(b.fade ?? 1, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.beginPath(); ctx.ellipse(x + lift * 0.25, y + 1, base * 1.1, base * 0.7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#fbfaf5'; ctx.shadowColor = 'rgba(255,255,255,.7)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(x, y - lift, r, 0, 7); ctx.fill();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}

function drawVignette() {
  const g = ctx.createRadialGradient(W / 2, midY(), Math.min(W, H) * 0.3, W / 2, midY(), Math.max(W, H) * 0.78);
  g.addColorStop(0, 'rgba(4,10,7,0)'); g.addColorStop(1, 'rgba(4,10,7,.6)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

function drawCard() {
  if (!G.round || G.phase === 'idle' || G.phase === 'over') return;
  const r = G.round, h = r.hole, x = 14, y = L.top + 8;
  ctx.save();
  ctx.fillStyle = 'rgba(9,22,16,.78)'; roundRect(x, y, 150, 58, 8); ctx.fill();
  ctx.fillStyle = '#f1ece0'; ctx.font = '800 22px "Big Shoulders Display", sans-serif'; ctx.textBaseline = 'top';
  ctx.fillText(`Hole ${h.n}`, x + 10, y + 7);
  ctx.font = '600 12px Barlow, sans-serif'; ctx.fillStyle = 'rgba(241,236,224,.7)';
  ctx.fillText(`Par ${h.par}, ${h.yards} yds`, x + 10, y + 32);
  const lieTxt = r.done ? '' : r.lie === 'tee' ? 'On the tee' : (LIE_WORD[r.lie] || '');
  ctx.fillStyle = r.lie === 'bunker' ? '#d9c68f' : r.lie === 'rough' ? '#ffb547' : '#8fe0a0';
  if (G.phase !== 'flight') ctx.fillText(lieTxt, x + 10, y + 45);
  // wind
  const w = r.wind, cx = W - 44, cy = y + 30;
  ctx.fillStyle = 'rgba(9,22,16,.78)'; ctx.beginPath(); ctx.arc(cx, cy, 30, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(241,236,224,.2)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.textAlign = 'center';
  if (w.mph > 0) {
    const a = w.deg * Math.PI / 180, ux = Math.sin(a), uy = -Math.cos(a);
    ctx.strokeStyle = '#ffb547'; ctx.fillStyle = '#ffb547'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - ux * 14, cy - 4 - uy * 14); ctx.lineTo(cx + ux * 12, cy - 4 + uy * 12); ctx.stroke();
    const tx = cx + ux * 16, ty = cy - 4 + uy * 16;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - ux * 8 + uy * 5, ty - uy * 8 - ux * 5); ctx.lineTo(tx - ux * 8 - uy * 5, ty - uy * 8 + ux * 5); ctx.fill();
  }
  ctx.fillStyle = '#f1ece0'; ctx.font = '700 11px Barlow, sans-serif';
  ctx.fillText(w.mph ? `${w.mph} mph` : 'Calm', cx, cy + 14);
  ctx.restore();
}

/* Three-click meter: the start line sits near the left end, with the sweet
   spot drawn around it; power runs right to 100%. */
function drawMeter(now) {
  if (!['address', 'swing', 'putt'].includes(G.phase)) return;
  const { barX: x, barY: y, barW: w, barH: h } = L;
  ctx.save();
  ctx.fillStyle = 'rgba(9,22,16,.84)'; roundRect(x - 12, y - 30, w + 24, h + 44, 10); ctx.fill();
  ctx.font = '800 17px "Big Shoulders Display", sans-serif'; ctx.textBaseline = 'alphabetic';
  if (isPutt()) drawPuttBar(now, x, y, w, h); else drawSwingBar(now, x, y, w, h);
  ctx.restore();
}
function drawSwingBar(now, x, y, w, h) {
  const S = C.swing, B = S.bottom, ux = u => x + (u - B) / (1 - B) * w;
  ctx.fillStyle = 'rgba(241,236,224,.1)'; roundRect(x, y, w, h, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,138,122,.4)'; ctx.fillRect(x, y, ux(-S.good) - x, h);
  ctx.fillStyle = 'rgba(143,224,160,.42)'; ctx.fillRect(ux(-S.good), y, ux(S.good) - ux(-S.good), h);
  ctx.fillStyle = '#8fe0a0'; ctx.fillRect(ux(-S.perfect), y, ux(S.perfect) - ux(-S.perfect), h);
  ctx.fillStyle = 'rgba(241,236,224,.35)';
  for (const q of [0.25, 0.5, 0.75]) ctx.fillRect(ux(q) - 0.5, y + h - 5, 1, 5);
  const v = swing.phase === 'idle' ? 0 : swing.value(now);
  const pw = swing.phase === 'down' || swing.phase === 'done' ? swing.power : null;
  if (swing.phase === 'up') {
    const g = ctx.createLinearGradient(ux(0), 0, ux(1), 0);
    g.addColorStop(0, 'rgba(255,181,71,.35)'); g.addColorStop(1, 'rgba(255,181,71,.95)');
    ctx.fillStyle = g; ctx.fillRect(ux(0), y + 3, ux(v) - ux(0), h - 6);
  }
  if (pw != null) {
    ctx.fillStyle = 'rgba(255,181,71,.3)'; ctx.fillRect(ux(0), y + 3, ux(pw) - ux(0), h - 6);
    ctx.fillStyle = '#ffb547'; ctx.fillRect(ux(pw) - 1.5, y - 4, 3, h + 8);
  }
  if (G.marker != null) {
    const mx = ux(G.marker);
    ctx.fillStyle = '#f1ece0';
    ctx.beginPath(); ctx.moveTo(mx, y - 2); ctx.lineTo(mx - 5, y - 9); ctx.lineTo(mx + 5, y - 9); ctx.fill();
  }
  ctx.fillStyle = '#fff'; ctx.fillRect(ux(0) - 1, y - 6, 2, h + 12);
  ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
  ctx.fillStyle = '#fff'; ctx.fillRect(ux(v) - 2, y - 8, 4, h + 16);
  ctx.shadowBlur = 0;
  const msg = G.phase === 'address' ? (TOUCH ? 'Tap to swing' : 'Space to swing')
    : swing.phase === 'up' ? 'Tap to set power' : 'Tap on the line';
  ctx.fillStyle = '#f1ece0'; ctx.textAlign = 'left'; ctx.fillText(msg, x, y - 12);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(241,236,224,.7)';
  const shown = pw != null ? pw : swing.phase === 'up' ? v : null;
  ctx.fillText(shown != null ? `${Math.round(shown * 100)}%` : (G.marker != null ? `Pin ${Math.round(G.marker * 100)}%` : 'Full swing'), x + w, y - 12);
}
function drawPuttBar(now, x, y, w, h) {
  ctx.fillStyle = 'rgba(241,236,224,.1)'; roundRect(x, y, w, h, 5); ctx.fill();
  const v = G.phase === 'putt' ? putter.value(now) : 0;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(143,224,160,.4)'); g.addColorStop(1, 'rgba(255,181,71,.95)');
  ctx.fillStyle = g; ctx.fillRect(x, y + 3, v * w, h - 6);
  if (G.marker != null) {
    const mx = x + G.marker * w;
    ctx.fillStyle = '#f1ece0';
    ctx.beginPath(); ctx.moveTo(mx, y - 2); ctx.lineTo(mx - 5, y - 9); ctx.lineTo(mx + 5, y - 9); ctx.fill();
    ctx.fillRect(mx - 0.5, y, 1, h);
  }
  ctx.shadowColor = '#fff'; ctx.shadowBlur = 10; ctx.fillStyle = '#fff'; ctx.fillRect(x + v * w - 2, y - 8, 4, h + 16); ctx.shadowBlur = 0;
  ctx.fillStyle = '#f1ece0'; ctx.textAlign = 'left';
  ctx.fillText(G.phase === 'address' ? (TOUCH ? 'Tap to putt' : 'Space to putt') : 'Tap to stop', x, y - 12);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(241,236,224,.7)';
  ctx.fillText(`${Math.round(dist(G.round.ball, G.round.hole.pin) * 3)} ft`, x + w, y - 12);
  if (G.phase === 'putt' && putter.expired(now)) strike(1, 0, now);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ---------- Loop ---------- */
function update(now) {
  const dt = G.last ? Math.min(0.1, (now - G.last) / 1000) : 0.016;
  G.last = now;
  if (G.phase === 'idle') { frameHole(HOLES[0]); }
  if (G.phase === 'swing') onSwing(swing.update(now), now);
  if (G.phase === 'intro' && now - G.t0 > C.anim.introSecs * 1000) toAddress(now);
  if (G.phase === 'settle' && now - G.t0 > C.anim.settleSecs * 1000) afterSettle(now);
  if (G.phase === 'holed' && now - G.t0 > C.anim.holedSecs * 1000) afterHole(now);
  showControls(shell.playing && G.phase === 'address');
  moveCam(dt);
  drawWorld(now);
  drawTrail();
  drawPin(now);
  drawAim(now);
  const b = ballNow(now);
  drawBall(b);
  drawVignette();
  drawCard();
  drawMeter(now);
}
function frame(now) { update(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
setTimeout(layout, 300);

/* Test hook for local dev only. */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__game = { G, swing, putter, tap, step: update, get round() { return G.round; } };
