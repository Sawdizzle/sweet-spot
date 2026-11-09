/* Drag Racing race math. No DOM: main.js draws, Node tests import this directly.

   How a run is timed:
   - The car follows a fixed speed curve that covers the quarter mile in
     race.baseEtMs. Every launch and shift adds a signed time loss
     (negative = a perfect-shift boost). The car pays a loss by running
     slower for a moment, so the time it costs shows on screen.
   - Elapsed time = reaction + baseEtMs + all losses. The step sim below
     reproduces that exactly, and ghosts replay through the same sim.
   - Each run draws a fixed number of random values (makeRunParams), so a
     daily stream gives everyone the same tree and shift bands for run N. */
import C from './config.js';

export const MPH = 2.23694;
export const DIST = C.race.distanceFt * 0.3048;           // meters
export const TOP = C.gears - 1;                           // index of the last gear
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Speed curve ----------
   v(t) = vmax (1 - e^(-t/T)). T and vmax are solved so the car reaches
   DIST at etMs with a trap speed of trapMph. */
export function makeProfile(etMs = C.race.baseEtMs, trapMph = C.race.baseTrapMph) {
  const E = etMs / 1000, vt = trapMph / MPH, target = DIST / vt;
  const f = T => E / (1 - Math.exp(-E / T)) - T - target;   // falls as T grows
  let lo = E * 0.01, hi = E * 50;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  const T = (lo + hi) / 2, vmax = vt / (1 - Math.exp(-E / T));
  return {
    T, vmax, tauFinish: etMs,
    v: ms => vmax * (1 - Math.exp(-(ms / 1000) / T)),
    x: ms => { const s = ms / 1000; return vmax * (s - T * (1 - Math.exp(-s / T))); }
  };
}
export const PROFILE = makeProfile();

/* ---------- Race sim ----------
   t is ms since launch, tau is "ideal race time" along the speed curve.
   debt > 0 means the car owes time, debt < 0 means it has a boost banked. */
export function createRace(profile = PROFILE) {
  const dt = C.race.stepMs;
  const s = { t: 0, tau: 0, debt: 0, rate: 1, finishT: null, loss: 0 };
  function step() {
    let adv = dt;
    if (s.debt > 0) { const pay = Math.min(s.debt, C.race.payRate * dt); adv -= pay; s.debt -= pay; }
    else if (s.debt < 0) { const gain = Math.min(-s.debt, C.race.boostRate * dt); adv += gain; s.debt += gain; }
    const tau0 = s.tau;
    s.tau += adv; s.rate = adv / dt;
    if (s.finishT == null && s.tau >= profile.tauFinish) s.finishT = s.t + dt * (profile.tauFinish - tau0) / (s.tau - tau0);
    s.t += dt;
  }
  return {
    state: s, profile,
    get t() { return s.t; },
    get finishT() { return s.finishT; },
    advanceTo(t) { while (s.t + dt <= t) step(); },
    addLoss(ms) { s.debt += ms; s.loss += ms; },
    x() { return profile.x(s.tau); },
    speed() { return profile.v(s.tau) * s.rate; }      // m/s
  };
}

/* Distance rolled after crossing a line at speed v (m/s), tPost ms later. */
export function coastX(v, tPost, decel = C.race.coastDecel) {
  const s = Math.max(0, tPost / 1000), stop = v / decel;
  const u = Math.min(s, stop);
  return v * u - 0.5 * decel * u * u;
}
export const coastV = (v, tPost, decel = C.race.coastDecel) => Math.max(0, v - decel * Math.max(0, tPost) / 1000);

export const trapMph = (finishT, profile = PROFILE) =>
  Math.round(C.race.baseTrapMph * Math.pow(profile.tauFinish / Math.max(1, finishT), C.race.trapExp) * 10) / 10;

/* ---------- Per-run randomness ----------
   Always exactly 5 + 3 * (gears - 1) draws. */
export const DRAWS_PER_RUN = 5 + 3 * TOP;
export function makeRunParams(rng) {
  const T = C.tree, R = C.rev, Lc = C.launch, S = C.shift;
  const p = {
    greenDelay: Math.round(lerp(T.greenMinMs, T.greenMaxMs, rng())),
    revSpeed: lerp(R.speedMin, R.speedMax, rng()),
    revPhase: rng() * 2,
    launch: { w: lerp(Lc.widthMin, Lc.widthMax, rng()), c: Lc.center + (rng() - 0.5) * Lc.centerJitter },
    gears: []
  };
  for (let g = 0; g < TOP; g++) {
    p.gears.push({
      rise: Math.round(S.riseMs[g] * (1 + (rng() * 2 - 1) * S.riseJitter)),
      w: lerp(S.widthMin, S.widthMax, rng()) * S.bandScale[g],
      ph: S.perfectHalf * S.bandScale[g],
      c: S.center + (rng() - 0.5) * S.centerJitter
    });
  }
  return p;
}

/* ---------- Tree ---------- */
export const greenAtMs = p => C.tree.firstAmberMs + 2 * C.tree.amberGapMs + p.greenDelay;
export function treeAt(p, ms) {
  const T = C.tree, green = ms >= greenAtMs(p);
  return {
    pre: ms >= 0, stage: ms >= T.stageMs, green,
    amber: green || ms < T.firstAmberMs ? 0 : Math.min(3, 1 + Math.floor((ms - T.firstAmberMs) / T.amberGapMs))
  };
}
/* A tap ms after staging: ignored while staging, red light before green,
   otherwise a launch with the reaction time. */
export function startTap(p, ms) {
  if (ms < C.tree.firstAmberMs) return { kind: 'ignore' };
  const g = greenAtMs(p);
  if (ms < g) return { kind: 'redlight', early: g - ms };
  return { kind: 'launch', reaction: Math.round(ms - g) };
}

/* ---------- Tach ---------- */
export function revNeedle(p, ms) {
  const k = (p.revPhase + Math.max(0, ms) / 1000 * p.revSpeed) % 2;
  const tri = k <= 1 ? k : 2 - k;
  return lerp(C.rev.lo, C.rev.hi, (1 - Math.cos(Math.PI * tri)) / 2);
}
const ease = u => 1 - Math.pow(1 - clamp(u, 0, 1), C.shift.easePow);
const invEase = y => 1 - Math.pow(1 - clamp(y, 0, 1), 1 / C.shift.easePow);

/* Needle in gear g, ms after the gear started. Pins at 1 on the limiter. */
export function gearRpm(p, g, ms) {
  const lo = C.shift.rpmIn[g];
  if (g >= TOP) return lo + (C.shift.topCap - lo) * ease(ms / C.shift.topRiseMs);
  return lo + (1 - lo) * ease(ms / p.gears[g].rise);
}
/* ms into gear g at which the needle reaches rpm (rpm below redline). */
export function timeForRpm(p, g, rpm) {
  const lo = C.shift.rpmIn[g];
  return invEase((rpm - lo) / (1 - lo)) * p.gears[g].rise;
}
export function band(p, g) {
  const b = g < 0 ? p.launch : p.gears[g];
  const ph = g < 0 ? C.launch.perfectHalf : b.ph;
  return { lo: b.c - b.w / 2, hi: b.c + b.w / 2, c: b.c, plo: b.c - ph, phi: b.c + ph };
}
export const blowAtMs = (p, g) => g >= TOP ? Infinity : p.gears[g].rise + C.shift.blowMs;
export const isBlown = (p, g, ms) => ms >= blowAtMs(p, g) + C.shift.blowGraceMs;

/* Launch: rpm is the needle at the tap. */
export function judgeLaunch(p, rpm) {
  const Lc = C.launch, b = band(p, -1);
  const off = Math.abs(rpm - b.c);
  if (off <= Lc.perfectHalf) return { zone: 'perfect', loss: -Lc.perfectBoostMs, rpm };
  if (rpm >= b.lo && rpm <= b.hi) return { zone: 'good', loss: Math.round(Lc.goodMaxMs * (off - Lc.perfectHalf) / (b.c - b.lo - Lc.perfectHalf)), rpm };
  if (rpm < b.lo) return { zone: 'bog', loss: Math.round(Math.min(Lc.maxMs, Lc.bogBaseMs + Lc.bogPerRpm * (b.lo - rpm))), rpm };
  return { zone: 'spin', loss: Math.round(Math.min(Lc.maxMs, Lc.spinBaseMs + Lc.spinPerRpm * (rpm - b.hi))), rpm };
}

/* Shift out of gear g, ms after the gear started. */
export function judgeShift(p, g, ms) {
  const S = C.shift;
  if (g >= TOP) return { zone: 'none', loss: 0 };
  if (isBlown(p, g, ms)) return { zone: 'blown', loss: 0 };
  const rpm = gearRpm(p, g, ms), b = band(p, g), off = Math.abs(rpm - b.c), ph = b.phi - b.c;
  if (rpm < b.lo) return { zone: 'early', loss: Math.round(Math.min(S.earlyMaxMs, S.earlyBaseMs + S.earlyPerRpm * (b.lo - rpm))), rpm };
  if (off <= ph) return { zone: 'perfect', loss: -S.perfectBoostMs, rpm };
  if (rpm <= b.hi) return { zone: 'good', loss: Math.round(S.goodMaxMs * (off - ph) / (b.c - b.lo - ph)), rpm };
  const past = ms - timeForRpm(p, g, b.hi);
  return { zone: 'late', loss: Math.round(Math.min(S.lateMaxMs, S.lateBaseMs + S.latePerMs * Math.max(0, past))), rpm };
}

/* ---------- Ghost ----------
   { r: reaction ms, l: launch loss ms, s: [[ms after launch, loss ms], ...], e: elapsed ms } */
const int = v => Math.round(Number(v));
export function encodeGhost({ r, l, s, e }) {
  return { r: int(r), l: int(l), s: s.slice(0, TOP).map(([t, x]) => [int(t), int(x)]), e: int(e) };
}
/* Validates a ghost read from the board. Returns a clean copy or null. */
export function decodeGhost(g) {
  if (!g || typeof g !== 'object') return null;
  const ok = (v, a, b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
  if (!ok(g.r, 0, C.tree.timeoutMs) || !ok(g.l, -1000, 2000) || !ok(g.e, 2500, 120000) || !Array.isArray(g.s) || g.s.length > 8) return null;
  const s = [];
  let last = -1;
  for (const it of g.s) {
    if (!Array.isArray(it) || it.length !== 2 || !ok(it[0], 0, 60000) || !ok(it[1], -1000, 2000) || it[0] < last) return null;
    last = it[0]; s.push([int(it[0]), int(it[1])]);
  }
  return { r: int(g.r), l: int(g.l), s, e: int(g.e) };
}

/* Run a launch/shift record through the sim. Returns elapsed ms (reaction included). */
export function simulate(rec, profile = PROFILE) {
  const race = createRace(profile);
  race.addLoss(rec.l);
  for (const [t, x] of rec.s) { race.advanceTo(t); race.addLoss(x); }
  while (race.finishT == null) race.advanceTo(race.t + 1000);
  return rec.r + race.finishT;
}

/* A replayable ghost. xAt(ms since green) -> meters from the start line.
   Times stretch so the ghost crosses at its recorded e even if tuning changed. */
export function ghostPlayer(g, profile = PROFILE) {
  const eSim = simulate(g, profile);
  const k = Math.abs(eSim - g.e) > 20 ? (g.e - g.r) / (eSim - g.r) : 1;
  let race, i;
  const reset = () => { race = createRace(profile); race.addLoss(g.l); i = 0; };
  reset();
  const vFinish = profile.v(profile.tauFinish);
  return {
    e: g.e, eSim, k,
    xAt(ms) {
      if (ms <= g.r) return 0;
      const t = (ms - g.r) / k;
      if (t < race.t) reset();
      while (i < g.s.length && g.s[i][0] <= t) { race.advanceTo(g.s[i][0]); race.addLoss(g.s[i][1]); i++; }
      race.advanceTo(t);
      if (race.finishT != null) return DIST + coastX(vFinish, t - race.finishT);
      return race.x();
    },
    speedAt(ms) {
      if (ms <= g.r) return 0;
      this.xAt(ms);
      const t = (ms - g.r) / k;
      return race.finishT != null ? coastV(vFinish, t - race.finishT) : race.speed();
    }
  };
}
export const houseGhost = () => {
  const h = C.house, rec = { r: h.r, l: h.l, s: h.s };
  return { ...rec, e: Math.round(simulate(rec)) };
};
