/* Golf rules and ball physics. Pure functions, no DOM.
   shotResult  full swing: power + timing error + club + lie + wind -> where it ends up
   puttResult  rolls a putt across a sloped green
   plan        the caddie: picks a club and an aim line for any spot
   Wind: { mph, deg } where deg is the heading the wind blows toward. */
import C from './config.js';
import { D2R, clamp, dist, dirOf, rightOf, headingTo, add, inPoly, polyDist, segDist, project, pointAt } from './geo.js';

export const CLUBS = C.clubs;
export const PUTTER = C.clubs.find(c => c.putter);

export function lieAt(hole, p) {
  if (!inPoly(p, hole.bounds)) return 'ob';
  for (const w of hole.water) if (inPoly(p, w)) return 'water';
  for (const b of hole.bunkers) if (inPoly(p, b)) return 'bunker';
  if (inPoly(p, hole.green)) return 'green';
  if (inPoly(p, hole.fairway)) return 'fairway';
  return 'rough';
}

export const windVec = w => { const d = dirOf(w.deg * D2R); return { x: d.x * w.mph, y: d.y * w.mph }; };
export function windParts(wind, heading) {
  const w = windVec(wind), d = dirOf(heading), r = rightOf(heading);
  return { tail: w.x * d.x + w.y * d.y, cross: w.x * r.x + w.y * r.y };
}
/* Two draws per hole, always, so a seeded round stays in step. */
export function rollWind(rng, max = C.wind.max) {
  const a = rng(), b = rng();
  return { mph: Math.round(a * max), deg: Math.round(b * 360) % 360 };
}

export function strikeQuality(acc) {
  const a = Math.abs(acc);
  if (a <= C.swing.perfect) return 'perfect';
  if (a <= C.swing.good) return 'good';
  return acc > 0 ? 'hook' : 'slice';
}

/* Which clubs a lie allows, longest first. */
export function clubsFor(hole, ball, lie) {
  if (lie === 'green') return [PUTTER];
  const list = CLUBS.filter(c => !c.putter && (!c.teeOnly || lie === 'tee'));
  if (lie === 'fairway' && polyDist(ball, hole.green) <= C.putt.fringeYds) list.push(PUTTER);
  return list;
}

/* Forward distance (carry + roll) per unit of power for a clean strike. */
export function reachPerPower(club, lie, heading, wind, landLie = 'fairway') {
  const { tail } = windParts(wind, heading);
  const carry = club.carry * (C.lie[lie] ?? 1) * (1 + C.shot.perfectBonus) * (1 + tail * C.wind.carryPerMph);
  return carry * (1 + club.roll * (C.rollOn[landLie] ?? 1));
}

/* Full swing. power 0..1 from tap 2, acc from tap 3 (signed distance of the
   needle from the start line: positive is early, a hook to the left;
   negative is late, a slice to the right). */
export function shotResult(hole, ball, lie, club, heading, power, acc, wind) {
  const quality = strikeQuality(acc), a = Math.abs(acc);
  let carry = club.carry * (C.lie[lie] ?? 1) * clamp(power, 0, 1);
  carry *= quality === 'perfect' ? 1 + C.shot.perfectBonus : Math.max(0.5, 1 - (a - C.swing.perfect) * C.shot.mishitLoss);
  const { tail, cross } = windParts(wind, heading);
  carry = Math.max(0.5, carry * (1 + tail * C.wind.carryPerMph));
  const d = dirOf(heading), r = rightOf(heading);
  const curve = clamp(-acc * C.shot.curveDeg * club.curve, -40, 40) * D2R;
  const lat = carry * Math.tan(curve) + cross * C.wind.driftPerMph * carry / 100;
  const land = add(add(ball, d, carry), r, lat);
  const ctrl = add(add(ball, d, carry * 0.55), r, lat * 0.12);
  const apex = carry * club.apex;

  // Ground track of the flight, for water entry and drawing.
  const track = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    track.push({ x: u * u * ball.x + 2 * u * t * ctrl.x + t * t * land.x, y: u * u * ball.y + 2 * u * t * ctrl.y + t * t * land.y });
  }
  const res = { kind: 'shot', club: club.id, quality, power, acc, carry, from: { ...ball }, land, ctrl, apex, track, rollTo: land, rest: land, lie: null, event: 'ok', drop: null };

  if (dist(land, hole.pin) < C.chipInR) { res.event = 'holed'; res.rest = res.rollTo = { ...hole.pin }; res.lie = 'green'; return res; }
  const landLie = lieAt(hole, land);
  if (landLie === 'ob') { res.event = 'ob'; res.lie = 'ob'; return res; }
  if (landLie === 'water') { res.event = 'water'; res.lie = 'water'; res.drop = dropFromTrack(hole, track, ball); return res; }

  // Roll out along the final flight direction.
  const rd = norm({ x: land.x - ctrl.x, y: land.y - ctrl.y });
  let remaining = carry * club.roll * (C.rollOn[landLie] ?? 1);
  let pos = land, prevLie = landLie;
  while (remaining > 1e-6) {
    const step = Math.min(0.5, remaining);
    const next = add(pos, rd, step);
    const nl = lieAt(hole, next);
    if (remaining < 6 && segDist(hole.pin, pos, next) < C.chipInR) { res.event = 'holed'; res.rest = res.rollTo = { ...hole.pin }; res.lie = 'green'; return res; }
    if (nl === 'ob') { res.event = 'ob'; res.lie = 'ob'; res.rollTo = res.rest = next; return res; }
    if (nl === 'water') {
      res.event = 'water'; res.lie = 'water'; res.rollTo = res.rest = next;
      res.drop = safeDrop(hole, add(pos, rd, -2), ball);
      return res;
    }
    if (nl === 'bunker') { pos = next; break; }
    if (nl === 'rough' && prevLie !== 'rough') remaining *= 0.35;
    prevLie = nl; remaining -= step; pos = next;
  }
  res.rest = res.rollTo = pos;
  res.lie = lieAt(hole, pos);
  return res;
}

const norm = v => { const L = Math.hypot(v.x, v.y) || 1; return { x: v.x / L, y: v.y / L }; };

/* Ball landed in water: walk back along its ground track to the last dry spot. */
function dropFromTrack(hole, track, ball) {
  for (let i = track.length - 1; i > 0; i--) {
    if (lieAt(hole, track[i]) !== 'water') {
      const back = norm({ x: track[i - 1].x - track[i].x, y: track[i - 1].y - track[i].y });
      return safeDrop(hole, add(track[i], back, 2), ball);
    }
  }
  return null;
}
function safeDrop(hole, p, ball) {
  const l = lieAt(hole, p);
  if (l === 'water' || l === 'ob') return null;
  if (dist(p, ball) < 1) return null;
  return p;
}

/* Putt: roll the ball with friction and slope until it stops or drops.
   opts.noCup ignores the hole and opts.flat ignores the slope (both used
   to size the power marker, which reads the distance but not the green). */
export function puttResult(hole, ball, heading, power, opts = {}) {
  const P = C.putt;
  const D = P.maxYds * Math.pow(clamp(power, 0.01, 1), P.exp);
  const v0 = Math.sqrt(2 * P.decel * D);
  const d = dirOf(heading);
  let x = ball.x, y = ball.y, vx = d.x * v0, vy = d.y * v0, t = 0;
  const dt = 1 / 120, sl = { x: hole.slope.x * P.slopeAccel, y: hole.slope.y * P.slopeAccel };
  const path = [{ x, y, t: 0 }];
  const res = { kind: 'putt', club: 'P', power, from: { ...ball }, path, event: 'ok', rest: null, lie: null, dur: 0, drop: null };
  for (let i = 0; i < 6000; i++) {
    const onGreen = inPoly({ x, y }, hole.green);
    const s = Math.hypot(vx, vy), dec = onGreen ? P.decel : P.offGreenDecel;
    let ax = onGreen && !opts.flat ? sl.x : 0, ay = onGreen && !opts.flat ? sl.y : 0;
    if (s < 0.02) break;
    ax -= vx / s * dec; ay -= vy / s * dec;
    const nvx = vx + ax * dt, nvy = vy + ay * dt;
    if (nvx * vx + nvy * vy <= 0) break;            // friction has stopped it
    const nx = x + nvx * dt, ny = y + nvy * dt;
    t += dt;
    if (!opts.noCup && s < P.captureSpeed && segDist(hole.pin, { x, y }, { x: nx, y: ny }) < P.cupR) {
      path.push({ x: hole.pin.x, y: hole.pin.y, t });
      res.event = 'holed'; res.rest = { ...hole.pin }; res.lie = 'green'; res.dur = t;
      return res;
    }
    if (!onGreen) {
      const l = lieAt(hole, { x: nx, y: ny });
      if (l === 'water' || l === 'ob') {
        path.push({ x: nx, y: ny, t });
        res.event = l; res.lie = l; res.rest = { x: nx, y: ny }; res.dur = t;
        if (l === 'water') res.drop = safeDrop(hole, add({ x, y }, norm({ x: -vx, y: -vy }), 2), ball);
        return res;
      }
      if (l === 'bunker') { x = nx; y = ny; path.push({ x, y, t }); break; }
    }
    x = nx; y = ny; vx = nvx; vy = nvy;
    if (i % 4 === 0) path.push({ x, y, t });
  }
  path.push({ x, y, t });
  res.rest = { x, y }; res.lie = lieAt(hole, res.rest); res.dur = t;
  return res;
}

/* Power that rolls a putt about a foot past the hole on a flat green, by
   search. Reading the slope is left to the player. */
export function puttPowerFor(hole, ball, heading, target = hole.pin) {
  const want = dist(ball, target) + 0.3, d = dirOf(heading);
  let lo = 0.01, hi = 1;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2, r = puttResult(hole, ball, heading, mid, { noCup: true, flat: true }).rest;
    const got = (r.x - ball.x) * d.x + (r.y - ball.y) * d.y;
    if (got < want) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* Power a clean strike needs to cover `yards`, or 1 if out of reach. */
export function shotPowerFor(hole, lie, club, heading, wind, yards, landLie = 'green') {
  return clamp(yards / reachPerPower(club, lie, heading, wind, landLie), 0, 1);
}

/* The caddie. Returns { club, heading, target, layup }.
   Putter on the green. If a club reaches the pin, the shortest such club
   aims at it. Otherwise lay up on the centerline with the longest club whose
   clean full swing ends on the fairway or green. */
export function plan(hole, ball, lie, wind) {
  const clubs = clubsFor(hole, ball, lie);
  const pin = hole.pin, dPin = dist(ball, pin), hPin = headingTo(ball, pin);
  if (clubs.includes(PUTTER)) return { club: PUTTER, heading: hPin, target: pin, layup: false };
  const shortFirst = clubs.slice().reverse();
  for (const c of shortFirst) {
    if (reachPerPower(c, lie, hPin, wind, 'green') >= dPin) return { club: c, heading: hPin, target: pin, layup: false };
  }
  const s0 = project(hole.path, ball);
  let fallback = null;
  for (const c of clubs) {
    const R = reachPerPower(c, lie, hPin, wind, 'fairway');
    const tgt = alongFrom(hole.path, ball, s0, R);
    const h = headingTo(ball, tgt);
    const res = shotResult(hole, ball, lie, c, h, 1, 0, wind);
    if (res.event !== 'ok') continue;
    const gain = dPin - dist(res.rest, pin);
    if (gain < 5) continue;
    if (res.lie === 'fairway' || res.lie === 'green') return { club: c, heading: h, target: tgt, layup: true };
    if (!fallback && res.lie === 'rough') fallback = { club: c, heading: h, target: tgt, layup: true };
  }
  return fallback || { club: clubs[0], heading: hPin, target: pin, layup: false };
}

/* First centerline point past s0 that sits R yards from p (or the path end). */
function alongFrom(path, p, s0, R) {
  for (let s = s0; s < s0 + 700; s += 2) {
    const q = pointAt(path, s);
    if (dist(p, q) >= R) return { x: q.x, y: q.y };
  }
  const e = path[path.length - 1];
  return { x: e.x, y: e.y };
}

/* ---------- Scoring ---------- */
export const toPar = v => v === 0 ? 'E' : (v > 0 ? '+' + v : String(v));
export function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one';
  const d = strokes - par;
  return d <= -3 ? 'Albatross' : d === -2 ? 'Eagle' : d === -1 ? 'Birdie' : d === 0 ? 'Par'
    : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : d === 3 ? 'Triple bogey' : `+${d}`;
}
export const arcadePoints = ({ holes, birdies, eagles }) =>
  holes * C.arcade.perHole + birdies * C.arcade.birdie + eagles * C.arcade.eagle;
