/* Sweet Spot Drag Racing.
   Launch on green with the tach in the launch band, then tap once per gear
   with the needle in the shift band. Race the leader's ghost to the line.
   Race math lives in logic.js; this file handles input, sound and drawing. */
import { clamp, REDUCE } from '../../core/util.js';
import { dailyRng, mulberry32 } from '../../core/seed/seed.js';
import { A, nz, tn, coreSfx, onAudioReady } from '../../core/audio/audio.js';
import { mountShell } from '../../core/ui/shell.js';
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
  bog() { tn({ f: 70, f2: 48, dur: 0.4, type: 'sawtooth', g: 0.08 }); },
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
    ['Launch', 'Tap when the tree goes green, with the tach needle in the green band. Jump the light and it’s a red light.'],
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
  onMenu() { G.phase = 'idle'; setDrone(0, 0); }
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
  fx: [], parts: []
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
    gear: 0, reaction: 0, launchRes: null, shifts: [], race: null, fault: null, fx: [], parts: []
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

function launch(time, reaction) {
  const rpm = L.revNeedle(G.params, time - G.t0);
  const j = L.judgeLaunch(G.params, rpm);
  Object.assign(G, { phase: 'race', reaction, launchRes: j, launchAt: time, gearAt: time, gear: 0 });
  G.race = L.createRace();
  G.race.addLoss(j.loss);
  if (j.zone === 'spin') sfx.chirp();
  else if (j.zone === 'bog') sfx.bog();
  else if (j.zone === 'perfect') sfx.perfect();
  const word = { perfect: 'Perfect launch', good: 'Good launch', bog: 'Bogged', spin: 'Wheelspin' }[j.zone];
  feedback(word + (j.loss > 0 ? `  +${s3(j.loss)}` : ''), j.zone === 'perfect' ? '#ffb547' : j.zone === 'good' ? '#8fe0a0' : '#ff8a7a', time, `R/T ${s3(reaction)}`);
}

function shift(time) {
  const g = G.gear, j = L.judgeShift(G.params, g, time - G.gearAt);
  if (j.zone === 'blown') { fault('blown', time); return; }
  const t = Math.max(G.race.t, Math.round(time - G.launchAt));
  G.race.advanceTo(t);
  G.race.addLoss(j.loss);
  G.shifts.push([t, j.loss]);
  G.gear = g + 1; G.gearAt = time;
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
    sfx.bang();
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
function ghostX(now) {
  if (!G.ghostRun || G.phase === 'idle' || G.phase === 'over') return 0;
  return G.ghostRun.xAt(now - G.greenAt);
}
function needle(now) {
  const P = G.phase;
  if (P === 'stage' || P === 'tree') return L.revNeedle(G.params, now - G.t0);
  if (P === 'race') {
    const v = L.gearRpm(G.params, G.gear, now - G.gearAt);
    return v >= 1 ? 1 - Math.random() * 0.025 : v;
  }
  if (P === 'done') return Math.max(0.12, G.endRpm - (now - G.endAt) / 1800);
  if (P === 'fault') return Math.max(G.fault === 'blown' ? 0 : 0.12, G.endRpm - (now - G.endAt) / 700);
  return 0.12 + Math.sin(now / 140) * 0.006;
}

/* ---------- Layout ----------
   Strip under the HUD, then the tree and tach side by side, all above
   the bottom button row (bottom 72 px) so thumbs and buttons never cover them. */
function layout() {
  const hud = document.getElementById('hud');
  const hb = hud ? hud.getBoundingClientRect().bottom - cvs.getBoundingClientRect().top : 90;
  const top = Math.max(56, hb + 10), bottom = H - 72;
  const avail = Math.max(170, bottom - top);
  const stripH = clamp(avail * 0.36, 96, 250);
  const pTop = top + stripH + 14, ph = Math.max(90, bottom - pTop);
  const R = Math.max(40, Math.min(ph * 0.42, W * 0.3, 150));
  const tw = R * 0.42, gap = R * 0.3, gx = (W - (tw + gap + 2 * R)) / 2;
  const cy = pTop + ph * 0.52;
  return { top, stripH, tree: { x: gx, y: cy - R * 0.95, w: tw, h: R * 1.9 }, tach: { x: gx + tw + gap + R, y: cy, r: R } };
}

/* ---------- Drawing ---------- */
function draw(now) {
  const lay = layout();
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#050b08'); bg.addColorStop(0.5, '#0b1611'); bg.addColorStop(1, '#0e1d16');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  drawStrip(now, lay);
  drawTree(now, lay.tree);
  drawTach(now, lay.tach);
  drawFeedback(now, lay.tach);
}

function drawStrip(now, lay) {
  const y0 = lay.top, h = lay.stripH, y1 = y0 + h;
  const sh = Math.round(h * 0.17), lh = (h - 2 * sh) / 2;
  const gy = y0 + sh + lh / 2, py = y0 + sh + lh * 1.5;
  const carL = Math.min(lh * 1.3, W * 0.2), carW = Math.min(lh * 0.62, carL * 0.44);
  const ppm = carL / 5;
  const px = playerX(now), gx = ghostX(now);
  const camX = px - (W * 0.32) / ppm;
  const S = m => (m - camX) * ppm;
  const m0 = camX, m1 = camX + W / ppm;

  // shoulders and walls
  ctx.fillStyle = '#101a15'; ctx.fillRect(0, y0, W, h);
  ctx.fillStyle = '#26302b'; ctx.fillRect(0, y0 + sh - 4, W, 4); ctx.fillRect(0, y1 - sh, W, 4);
  // grandstand lights in the top shoulder, slower for a little depth
  ctx.fillStyle = 'rgba(255,240,200,.5)';
  const par = camX * 0.5, sp = 7;
  for (let m = Math.floor(par / sp) * sp; m < par + W / ppm + sp; m += sp) {
    const x = (m - par) * ppm, k = Math.abs(Math.sin(m * 12.9898)) ;
    ctx.globalAlpha = 0.25 + 0.5 * k;
    ctx.fillRect(x, y0 + 4 + k * (sh - 14), 2, 2);
  }
  ctx.globalAlpha = 1;
  // lanes
  ctx.fillStyle = '#1a201d'; ctx.fillRect(0, y0 + sh, W, h - 2 * sh);
  // launch rubber
  const rub = ctx.createLinearGradient(S(-4), 0, S(70), 0);
  rub.addColorStop(0, 'rgba(0,0,0,.55)'); rub.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rub;
  for (const cy of [gy, py]) for (const o of [-0.28, 0.28]) ctx.fillRect(S(-4), cy + o * lh - lh * 0.1, (74) * ppm, lh * 0.2);
  // lane lines
  ctx.strokeStyle = 'rgba(241,236,224,.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, y0 + sh); ctx.lineTo(W, y0 + sh); ctx.moveTo(0, y1 - sh); ctx.lineTo(W, y1 - sh); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,181,71,.6)'; ctx.setLineDash([ppm * 3, ppm * 3]); ctx.lineDashOffset = camX * ppm;
  ctx.beginPath(); ctx.moveTo(0, y0 + sh + lh); ctx.lineTo(W, y0 + sh + lh); ctx.stroke(); ctx.setLineDash([]);
  // shoulder ticks for a sense of speed
  ctx.fillStyle = 'rgba(241,236,224,.18)';
  for (let m = Math.floor(m0 / 5) * 5; m < m1 + 5; m += 5) { ctx.fillRect(S(m), y0 + sh - 10, 2, 5); ctx.fillRect(S(m), y1 - sh + 6, 2, 5); }
  // distance markers
  const marks = [[0, 'Start'], [60 * 0.3048, '60 ft'], [330 * 0.3048, '330 ft'], [660 * 0.3048, '1/8 mile'], [1000 * 0.3048, '1000 ft']];
  ctx.font = '600 11px Barlow, sans-serif'; ctx.textAlign = 'center';
  for (const [m, t] of marks) {
    if (m < m0 - 5 || m > m1 + 5) continue;
    const x = S(m);
    ctx.fillStyle = m === 0 ? 'rgba(241,236,224,.85)' : 'rgba(241,236,224,.35)';
    ctx.fillRect(x - 1, y0 + sh, m === 0 ? 3 : 2, h - 2 * sh);
    ctx.fillStyle = 'rgba(241,236,224,.6)'; ctx.fillText(t, x, y1 - 5);
  }
  // finish line: checkered band
  if (L.DIST > m0 - 5 && L.DIST < m1 + 5) {
    const x = S(L.DIST), cw = Math.max(5, ppm * 0.9), rows = Math.ceil((h - 2 * sh) / cw);
    for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#f1ece0' : '#111';
      ctx.fillRect(x + c * cw, y0 + sh + r * cw, cw, Math.min(cw, y1 - sh - (y0 + sh + r * cw)));
    }
    ctx.fillStyle = '#d23a2e'; ctx.fillRect(x - 3, y0 + 2, 6, sh - 6);
    ctx.fillStyle = 'rgba(241,236,224,.85)'; ctx.fillText('Finish', x + cw, y1 - 5);
  }
  // smoke and flame particles (world space)
  drawParts(now, S, ppm, py, carL, px);
  // cars
  const gsx = S(gx);
  if (G.ghost) {
    if (gsx > W + 4) edgeArrow(W - 8, gy, 1, `+${Math.round(gx - px)} m`);
    else if (gsx - carL < -4) edgeArrow(8, gy, -1, `-${Math.round(px - gx)} m`);
    else drawCar(gsx, gy, carL, carW, true);
  }
  drawCar(S(px), py, carL, carW, false, now);
  // header: ghost name and run count
  ctx.font = '700 12px Barlow, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffb547';
  const gname = !G.ghost ? '' : G.ghost.leader ? `Ghost: ${G.ghost.name}, ${G.ghost.daily ? 'today’s' : 'all-time'} leader, ${s3(G.ghost.e)} s` : `Ghost: house car, ${s3(G.ghost.e)} s`;
  ctx.fillText(gname, 12, y0 + Math.min(sh - 8, 16));
  if (G.phase !== 'idle' && G.phase !== 'over') {
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(241,236,224,.7)';
    ctx.fillText(`Run ${G.runs + (G.phase === 'done' || G.phase === 'fault' ? 0 : 1)}`, W - 12, y0 + Math.min(sh - 8, 16));
  }
  // progress bar under the strip
  const bx = 12, bw = W - 24, by = y1 + 6;
  ctx.fillStyle = 'rgba(241,236,224,.14)'; ctx.fillRect(bx, by, bw, 3);
  const pf = clamp(px / L.DIST, 0, 1), gf = clamp(gx / L.DIST, 0, 1);
  if (G.ghost) { ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx + gf * bw, by + 1.5, 4, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#f1ece0'; ctx.beginPath(); ctx.arc(bx + pf * bw, by + 1.5, 4, 0, Math.PI * 2); ctx.fill();
}

function edgeArrow(x, y, dir, text) {
  ctx.fillStyle = 'rgba(255,181,71,.85)';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dir * 10, y - 8); ctx.lineTo(x - dir * 10, y + 8); ctx.closePath(); ctx.fill();
  ctx.font = '700 12px Barlow, sans-serif'; ctx.textAlign = dir > 0 ? 'right' : 'left';
  ctx.fillText(text, x - dir * 14, y + 4);
}

/* Generic top-down dragster: nose at (nx, cy), facing right. No real makes or badges. */
function drawCar(nx, cy, cl, cw, ghost, now = 0) {
  ctx.save(); ctx.translate(nx - cl, cy);
  const tire = (x, y, w, hh) => { ctx.fillRect(x, y - hh / 2, w, hh); };
  if (!ghost) { ctx.fillStyle = 'rgba(0,0,0,.35)'; roundRect(cl * 0.02, -cw * 0.55 + 3, cl, cw * 1.1, cw * 0.2); ctx.fill(); }
  ctx.globalAlpha = ghost ? 0.55 : 1;
  ctx.fillStyle = ghost ? 'rgba(20,20,20,.6)' : '#0c0c0c';
  tire(cl * 0.05, -cw * 0.4, cl * 0.22, cw * 0.28); tire(cl * 0.05, cw * 0.4, cl * 0.22, cw * 0.28);
  tire(cl * 0.76, -cw * 0.34, cl * 0.12, cw * 0.14); tire(cl * 0.76, cw * 0.34, cl * 0.12, cw * 0.14);
  // body
  ctx.beginPath();
  ctx.moveTo(cl * 0.04, -cw * 0.24); ctx.lineTo(cl * 0.6, -cw * 0.24);
  ctx.quadraticCurveTo(cl * 0.92, -cw * 0.2, cl, -cw * 0.06); ctx.lineTo(cl, cw * 0.06);
  ctx.quadraticCurveTo(cl * 0.92, cw * 0.2, cl * 0.6, cw * 0.24); ctx.lineTo(cl * 0.04, cw * 0.24); ctx.closePath();
  if (ghost) { ctx.fillStyle = 'rgba(255,181,71,.22)'; ctx.fill(); ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.5; ctx.stroke(); }
  else { ctx.fillStyle = '#d23a2e'; ctx.fill(); }
  // rear wing and cockpit
  ctx.fillStyle = ghost ? 'rgba(255,181,71,.55)' : '#8e2219';
  ctx.fillRect(0, -cw * 0.5, cl * 0.07, cw);
  ctx.fillStyle = ghost ? 'rgba(10,10,10,.5)' : '#141414';
  roundRect(cl * 0.4, -cw * 0.13, cl * 0.2, cw * 0.26, cw * 0.1); ctx.fill();
  if (!ghost) {
    ctx.fillStyle = '#f1ece0'; ctx.fillRect(cl * 0.62, -cw * 0.03, cl * 0.32, cw * 0.06);
    // exhaust glow on hard acceleration
    if (G.phase === 'race') { ctx.fillStyle = `rgba(255,181,71,${0.3 + 0.3 * Math.sin(now / 30)})`; ctx.fillRect(cl * 0.3, -cw * 0.3, cl * 0.05, cw * 0.06); ctx.fillRect(cl * 0.3, cw * 0.24, cl * 0.05, cw * 0.06); }
  }
  ctx.restore();
}

function drawParts(now, S, ppm, py, carL, px) {
  // emit: wheelspin smoke right after a spin launch, fire and smoke from a blown engine
  const spin = G.phase === 'race' && G.launchRes && G.launchRes.zone === 'spin' && now - G.launchAt < C.launch.spinShowMs;
  const blown = G.phase === 'fault' && G.fault === 'blown' && now - G.endAt < 1600;
  const n = REDUCE ? 1 : 2;
  if (spin) for (let i = 0; i < n; i++) G.parts.push({ x: px - 5 + Math.random() * 0.6, y: (Math.random() < 0.5 ? -1 : 1) * 0.3, vy: (Math.random() - 0.5) * 0.4, t0: now, life: 900, kind: 'smoke' });
  if (blown) for (let i = 0; i < n; i++) {
    G.parts.push({ x: px - 3 + Math.random() * 1.5, y: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.6, t0: now, life: 1200, kind: 'smoke' });
    if (now - G.endAt < 900) G.parts.push({ x: px - 2.8 + Math.random(), y: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.3, t0: now, life: 380, kind: 'fire' });
  }
  if (G.parts.length > 260) G.parts.splice(0, G.parts.length - 260);
  G.parts = G.parts.filter(p => now - p.t0 < p.life);
  const lh = carL / 1.3;
  for (const p of G.parts) {
    const k = (now - p.t0) / p.life, x = S(p.x), y = py + (p.y + p.vy * k) * lh;
    if (p.kind === 'fire') {
      ctx.fillStyle = `rgba(255,${Math.round(180 - 120 * k)},60,${0.9 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(x, y, ppm * (0.3 + 0.4 * k), 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = `rgba(200,200,195,${0.35 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(x - k * ppm * 1.5, y, ppm * (0.4 + 1.6 * k), 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* Christmas tree: prestage, stage, three ambers, green, red. */
function drawTree(now, t) {
  const P = G.phase;
  let st = { pre: false, stage: false, amber: 0, green: false }, red = false;
  if (P === 'stage' || P === 'tree') st = L.treeAt(G.params, now - G.t0);
  else if (P === 'race' || P === 'done') st = { pre: true, stage: true, amber: 0, green: true };
  else if (P === 'fault') { st = { pre: true, stage: true, amber: 0, green: false }; red = G.fault === 'redlight'; }
  const x = t.x, w = t.w, y = t.y, h = t.h, cx = x + w / 2;
  ctx.fillStyle = '#1f2a25'; ctx.fillRect(cx - w * 0.08, y + h * 0.5, w * 0.16, h * 0.55);
  ctx.fillStyle = '#0a110d'; roundRect(x, y, w, h, w * 0.18); ctx.fill();
  ctx.strokeStyle = 'rgba(241,236,224,.18)'; ctx.lineWidth = 1; ctx.stroke();
  const rows = [
    ['small', st.pre, '#ffe9b0'], ['small', st.stage, '#ffe9b0'],
    ['big', st.amber >= 1, '#ffb547'], ['big', st.amber >= 2, '#ffb547'], ['big', st.amber >= 3, '#ffb547'],
    ['big', st.green, '#8fe0a0'], ['big', red, '#d23a2e']
  ];
  const unit = h / 13.2;
  let yy = y + unit * 0.9;
  for (const [size, on, col] of rows) {
    const r = size === 'small' ? unit * 0.38 : Math.min(unit * 0.78, w * 0.36);
    const pts = size === 'small' ? [cx - w * 0.2, cx + w * 0.2] : [cx];
    yy += size === 'small' ? unit * 0.5 : unit * 1.0;
    for (const bx of pts) {
      ctx.beginPath(); ctx.arc(bx, yy, r, 0, Math.PI * 2);
      if (on) { ctx.shadowColor = col; ctx.shadowBlur = r * 2.2; ctx.fillStyle = col; }
      else { ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(241,236,224,.08)'; }
      ctx.fill(); ctx.shadowBlur = 0;
    }
    yy += size === 'small' ? unit * 0.5 : unit * 0.95;
  }
}

/* Tach: 270 degree sweep, 0 to 9 (x1000 rpm). Green arc is the band to hit. */
function drawTach(now, t) {
  const { x: cx, y: cy, r: R } = t;
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5, ang = v => a0 + clamp(v, 0, 1.02) * sweep;
  ctx.fillStyle = 'rgba(9,22,16,.92)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2b5b48'; ctx.lineWidth = Math.max(2, R * 0.04); ctx.stroke();
  const arc = (v0, v1, color, wd, rr = R * 0.86) => { ctx.strokeStyle = color; ctx.lineWidth = wd; ctx.beginPath(); ctx.arc(cx, cy, rr, ang(v0), ang(v1)); ctx.stroke(); };
  arc(0, 1, 'rgba(241,236,224,.12)', R * 0.09);
  arc(0.95, 1, '#d23a2e', R * 0.09);
  // band to hit
  const P = G.phase;
  const gBand = P === 'stage' || P === 'tree' ? -1 : P === 'race' && G.gear < L.TOP ? G.gear : null;
  if (gBand != null) {
    const b = L.band(G.params, gBand);
    arc(b.lo, b.hi, 'rgba(143,224,160,.55)', R * 0.13);
    arc(b.plo, b.phi, '#8fe0a0', R * 0.17);
  }
  // ticks and numbers
  ctx.strokeStyle = 'rgba(241,236,224,.7)'; ctx.fillStyle = 'rgba(241,236,224,.8)';
  ctx.font = `700 ${Math.round(R * 0.15)}px "Big Shoulders Display", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 18; i++) {
    const v = i / 18, a = ang(v), major = i % 2 === 0;
    const r0 = R * (major ? 0.7 : 0.75), r1 = R * 0.8;
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    if (major) ctx.fillText(String(i / 2), cx + Math.cos(a) * R * 0.57, cy + Math.sin(a) * R * 0.57);
  }
  // gear readout
  ctx.fillStyle = 'rgba(241,236,224,.55)'; ctx.font = `600 ${Math.round(R * 0.1)}px Barlow, sans-serif`;
  ctx.fillText('x1000 rpm', cx, cy - R * 0.28);
  const gear = P === 'race' || P === 'done' || (P === 'fault' && G.fault === 'blown') ? String(G.gear + 1) : 'N';
  ctx.fillStyle = P === 'fault' && G.fault === 'blown' ? '#ff8a7a' : '#ffb547';
  ctx.font = `900 ${Math.round(R * 0.36)}px "Big Shoulders Display", sans-serif`;
  ctx.fillText(gear, cx, cy + R * 0.48);
  // needle
  const v = needle(now), a = ang(v);
  ctx.strokeStyle = v >= 0.95 ? '#ff8a7a' : '#f1ece0'; ctx.lineWidth = Math.max(2, R * 0.03); ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,255,255,.5)'; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * R * 0.12, cy - Math.sin(a) * R * 0.12); ctx.lineTo(cx + Math.cos(a) * R * 0.84, cy + Math.sin(a) * R * 0.84); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#26302b'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2); ctx.fill();
  // instruction under the tach
  const msg = {
    stage: 'Staged. Wait for the tree.',
    tree: 'Launch on green, needle in the green',
    race: G.gear < L.TOP ? 'Shift with the needle in the green' : 'Top gear. Hold it to the line.',
    idle: ''
  }[P] || '';
  if (msg) {
    ctx.fillStyle = '#f1ece0'; ctx.font = `800 ${Math.round(clamp(R * 0.15, 14, 20))}px "Big Shoulders Display", sans-serif`;
    ctx.fillText(msg, clamp(cx, 120, W - 120), cy + R * 0.92);
  }
  ctx.textBaseline = 'alphabetic';
}

function drawFeedback(now, t) {
  ctx.textAlign = 'center';
  const y = t.y - t.r - 18;
  G.fx = G.fx.filter(f => now - f.t0 < 1100);
  G.fx.forEach((f, i) => {
    const k = (now - f.t0) / 1100, last = i === G.fx.length - 1;
    if (!last) return;
    ctx.globalAlpha = 1 - k * k;
    ctx.fillStyle = f.color; ctx.font = `900 ${Math.round(clamp(t.r * 0.22, 18, 30))}px "Big Shoulders Display", sans-serif`;
    ctx.fillText(f.text, clamp(t.x, 110, W - 110), y - k * 10);
    if (f.sub) { ctx.fillStyle = 'rgba(241,236,224,.8)'; ctx.font = '700 13px Barlow, sans-serif'; ctx.fillText(f.sub, clamp(t.x, 110, W - 110), y + 16 - k * 10); }
  });
  ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
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
  draw(now);
}
function frame(now) { update(now); requestAnimationFrame(frame); }
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

/* Test hook for local dev only. */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__game = { G, L, C, tap, step: update };
