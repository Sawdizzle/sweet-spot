/* Hockey Shootout rules with no DOM, so Node can test them.
   Goal space: x from -1 (left post) to 1 (right post), y from 0 (the ice)
   to 1 (crossbar). Aim needle value v (0..1) maps to x; power p (0..1)
   maps to y. */
import DEFAULT from './config.js';

export const aimToX = (v, C = DEFAULT) => (2 * v - 1) * C.aim.span;
export const xToAim = (x, C = DEFAULT) => (x / C.aim.span + 1) / 2;
/* Power at or below `ice` keeps the puck flat (y = 0). */
export const powerToY = (p, C = DEFAULT) => Math.max(0, (p - C.power.ice) / (C.power.bar - C.power.ice));
export const yToPower = (y, C = DEFAULT) => C.power.ice + y * (C.power.bar - C.power.ice);

/* Goalie width scale after a number of goals. */
export function goalieScale(goals, C = DEFAULT) {
  const g = C.goalie;
  return Math.min(g.maxScale, 1 + g.growStep * Math.floor(goals / g.growEvery));
}

/* Place the goalie for the next shot. Always takes exactly three draws so a
   daily run stays in step for everyone, whatever happened on earlier shots.
   Position and the five-hole do not depend on goals; only the size does. */
export function rollGoalie(rng, goals, C = DEFAULT) {
  const a = rng(), b = rng(), c = rng();
  return {
    x: Math.round((2 * a - 1) * C.goalie.shift * 1000) / 1000,
    scale: goalieScale(goals, C),
    fiveOpen: b < C.goalie.fiveOpenChance,
    lean: c < 0.5 ? -1 : 1      // which way he reaches on a save (looks only)
  };
}

/* Half width the goalie covers at height y (-1 above his head: nothing). */
export function coverHalf(y, goalie, C = DEFAULT) {
  const g = C.goalie, s = goalie.scale;
  if (y <= g.padTop) return g.padHalf * s;
  if (y <= g.bodyTop) return g.bodyHalf * s;
  if (y <= g.headTop) return g.headHalf * s;
  return -1;
}
export const inFiveHole = (x, y, goalie, C = DEFAULT) =>
  goalie.fiveOpen && Math.abs(x - goalie.x) <= C.goalie.fiveHalf && y <= C.goalie.fiveTop;
export function covered(x, y, goalie, C = DEFAULT) {
  if (inFiveHole(x, y, goalie, C)) return false;
  return Math.abs(x - goalie.x) <= coverHalf(y, goalie, C);
}

/* Where does a shot at goal-space x with power p end up?
   result: goal | saved | wide | over | post | bar
   zone (goals only): topShelf | fiveHole | open */
export function resolveShot(x, p, goalie, C = DEFAULT) {
  const g = C.goal, y = powerToY(p, C), ax = Math.abs(x);
  const out = (result, extra = {}) => ({ result, x, y, points: 0, zone: null, ...extra });
  if (ax > 1 + g.post) return out('wide');
  if (y > 1 + g.bar) return out('over');
  if (ax >= 1 - g.post) return out('post');
  if (y >= 1 - g.bar) return out('bar');
  if (covered(x, y, goalie, C)) return out('saved');
  const zone = ax >= g.cornerX && y >= g.cornerY ? 'topShelf' : inFiveHole(x, y, goalie, C) ? 'fiveHole' : 'open';
  return out('goal', { zone, points: C.scoring[zone === 'open' ? 'goal' : zone] });
}

export const isMiss = (result, C = DEFAULT) =>
  result === 'saved' || result === 'wide' || result === 'over' ||
  (C.ironCostsHeart && (result === 'post' || result === 'bar'));

/* What a column of the net offers, for painting the aim bar:
   wide | post | corner | fiveHole | goalie | open. Corner columns always
   have some top shelf above his shoulders. `goalie` columns sit behind his
   chest; they can still score over his head, and the power bar shows
   exactly where. */
export function columnKind(x, goalie, C = DEFAULT) {
  const g = C.goal, ax = Math.abs(x);
  if (ax > 1 + g.post) return 'wide';
  if (ax >= 1 - g.post) return 'post';
  if (ax >= g.cornerX) return 'corner';
  if (goalie.fiveOpen && Math.abs(x - goalie.x) <= C.goalie.fiveHalf) return 'fiveHole';
  if (Math.abs(x - goalie.x) <= C.goalie.bodyHalf * goalie.scale) return 'goalie';
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
export const aimSegments = (goalie, C = DEFAULT, n = 520) =>
  runs(n, v => columnKind(aimToX(v, C), goalie, C));

/* Power bar segments (in power units 0..1) for a locked aim x.
   kind: saved | open | fiveHole | topShelf | post | bar | over | wide */
export const shotKind = r => r.result === 'goal' ? r.zone : r.result;
export const powerSegments = (x, goalie, C = DEFAULT, n = 400) =>
  runs(n, p => shotKind(resolveShot(x, p, goalie, C)));

/* Share line for the game-over card. */
export function shareText(score, meta) {
  const pts = `${score} pt${score === 1 ? '' : 's'}`;
  const t = meta && meta.topShelf;
  return t
    ? `I went top shelf ${t === 1 ? 'once' : t + ' times'} on Sweet Spot Hockey Shootout (${pts}).`
    : `I scored ${pts} on Sweet Spot Hockey Shootout.`;
}
