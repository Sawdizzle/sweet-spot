/* PK Shootout rules with no DOM, so Node can test them.
   Goal space: x from -1 (left post) to 1 (right post), y from 0 (grass)
   to 1 (crossbar). Aim needle value v (0..1) maps to x; power p (0..1)
   maps to y. */
import DEFAULT from './config.js';

export const aimToX = (v, C = DEFAULT) => (2 * v - 1) * C.aim.span;
export const xToAim = (x, C = DEFAULT) => (x / C.aim.span + 1) / 2;
export const powerToY = (p, C = DEFAULT) => (p - C.power.weak) / (C.power.bar - C.power.weak);
export const yToPower = (y, C = DEFAULT) => C.power.weak + y * (C.power.bar - C.power.weak);

/* Keeper box half width after a number of goals. */
export function keeperHalf(goals, C = DEFAULT) {
  const k = C.keeper;
  return Math.min(k.maxHalf, k.half + k.growStep * Math.floor(goals / k.growEvery));
}

/* Place the keeper for the next kick. Always takes exactly two draws so a
   daily run stays in step for everyone, whatever happened on earlier kicks.
   Position does not depend on goals; only the box width does. */
export function rollKeeper(rng, goals, C = DEFAULT) {
  const a = rng(), b = rng();
  return {
    x: Math.round((2 * a - 1) * C.keeper.shift * 1000) / 1000,
    half: keeperHalf(goals, C),
    reach: C.keeper.reach,
    lean: b < 0.5 ? -1 : 1      // which way he flinches on a save (looks only)
  };
}

export const inKeeperColumn = (x, keeper) => Math.abs(x - keeper.x) <= keeper.half;

/* Where does a shot at goal-space x with power p end up?
   result: goal | saved | weak | wide | over | post | bar */
export function resolveShot(x, p, keeper, C = DEFAULT) {
  const g = C.goal;
  if (p < C.power.weak) return { result: 'weak', x, y: 0, points: 0, corner: false };
  const y = powerToY(p, C), ax = Math.abs(x);
  const out = (result, extra = {}) => ({ result, x, y, points: 0, corner: false, ...extra });
  if (ax > 1 + g.post) return out('wide');
  if (y > 1 + g.bar) return out('over');
  if (ax >= 1 - g.post) return out('post');
  if (y >= 1 - g.bar) return out('bar');
  if (inKeeperColumn(x, keeper) && y <= keeper.reach) return out('saved');
  const corner = ax >= g.cornerX && y >= g.cornerY;
  return { result: 'goal', x, y, corner, points: corner ? C.scoring.corner : C.scoring.goal };
}

export const isMiss = (result, C = DEFAULT) =>
  result === 'saved' || result === 'weak' || result === 'wide' || result === 'over' ||
  (C.woodworkCostsHeart && (result === 'post' || result === 'bar'));

/* What a column of the goal offers, for painting the aim bar:
   wide | post | keeper | corner | open. A keeper column can still be beaten
   over his head, but the aim bar shows it as covered. */
export function columnKind(x, keeper, C = DEFAULT) {
  const g = C.goal, ax = Math.abs(x);
  if (ax > 1 + g.post) return 'wide';
  if (ax >= 1 - g.post) return 'post';
  if (inKeeperColumn(x, keeper)) return 'keeper';
  if (ax >= g.cornerX) return 'corner';
  return 'open';
}

/* Merge samples into [{ kind, start, end }] runs over 0..1. */
function runs(n, kindAt) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const v0 = i / n, v1 = (i + 1) / n, k = kindAt((v0 + v1) / 2);
    const last = out[out.length - 1];
    if (last && last.kind === k) last.end = v1; else out.push({ kind: k, start: v0, end: v1 });
  }
  return out;
}

/* Aim bar segments (in needle units 0..1). */
export const aimSegments = (keeper, C = DEFAULT, n = 520) =>
  runs(n, v => columnKind(aimToX(v, C), keeper, C));

/* Power bar segments (in power units 0..1) for a locked aim x.
   kind: weak | saved | open | corner | post | bar | over | wide */
export const powerSegments = (x, keeper, C = DEFAULT, n = 400) =>
  runs(n, p => {
    const r = resolveShot(x, p, keeper, C);
    return r.result === 'goal' ? (r.corner ? 'corner' : 'open') : r.result;
  });

/* Share line for the game-over card. */
export function shareText(score, meta) {
  const pts = `${score} pt${score === 1 ? '' : 's'}`;
  const c = meta && meta.corners;
  return c
    ? `I scored ${c} top corner${c === 1 ? '' : 's'} on Sweet Spot PK Shootout (${pts}).`
    : `I scored ${pts} on Sweet Spot PK Shootout.`;
}
