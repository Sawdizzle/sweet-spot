/* Deterministic randomness for daily challenges.
   The day key is the UTC date, matching the server's daily_date in the
   sweet_spot_submit RPC. Change both together if the reset time ever moves. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const todayKey = () => new Date().toISOString().slice(0, 10);

/* A PRNG for any string key. */
export const seededRng = key => mulberry32(hashStr(key));

/* Today's PRNG for a game, e.g. dailyRng('fieldgoal').
   Baseball keeps its original key ('sweet-spot-' + date) so existing
   daily sequences and ghosts stay valid. */
export const dailyRng = (game, date = todayKey()) =>
  seededRng(game === 'baseball' ? `sweet-spot-${date}` : `sweet-spot-${game}-${date}`);
