/* Multi-game leaderboard client (table: sweetspot_scores).

   submitScore({ game, mode, score, initials, meta, daily })
     -> { ok: true, id } | { ok: false, reason: 'local' | 'offline' | 'error', message }
   getTop({ game, mode, period: 'all' | 'daily', limit })
     -> rows [{ rank, player_id, initials, score, meta, created_at }] or null when offline

   Every run is also kept on this device (localBest / localRuns), so a game
   always has something to show when the cloud is unreachable. */
import { store } from '../util.js';
import { todayKey } from '../seed/seed.js';
import { getClient, identity } from './client.js';
import { cleanIni } from '../initials/initials.js';

/* Golf course modes (strokes vs par) and drag (elapsed ms) rank ascending. */
export const lowerIsBetter = (game, mode) => game === 'drag' || (game === 'golf' && /^course-/.test(mode));
export const better = (game, mode, a, b) => lowerIsBetter(game, mode) ? a < b : a > b;

/* Local dev never writes to the shared board unless the URL has ?cloud=1. */
export const cloudWrite = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
  || new URLSearchParams(location.search).has('cloud');

const localKey = (game, mode) => `ss.runs.${game}.${mode}`;
/* Keeps the best 20 runs per game and mode on this device. */
export function recordLocal({ game, mode, score, meta, daily }) {
  const runs = store.get(localKey(game, mode), []);
  runs.push({ score, meta: meta || {}, daily: daily ? todayKey() : null, at: Date.now() });
  runs.sort((a, b) => lowerIsBetter(game, mode) ? a.score - b.score : b.score - a.score);
  store.set(localKey(game, mode), runs.slice(0, 20));
}
export function localRuns(game, mode, period = 'all') {
  const runs = store.get(localKey(game, mode), []);
  return period === 'daily' ? runs.filter(r => r.daily === todayKey()) : runs;
}
export const localBest = (game, mode, period = 'all') => {
  const r = localRuns(game, mode, period)[0];
  return r ? r.score : null;
};

export async function submitScore({ game, mode = 'classic', score, initials, meta = {}, daily = false }) {
  if (!cloudWrite) return { ok: false, reason: 'local', message: 'Local test run. Not sent to the leaderboard (add ?cloud=1 to send).' };
  const sb = getClient();
  if (!sb) return { ok: false, reason: 'offline', message: 'Couldn’t reach the leaderboard. This run is saved on this device.' };
  const { id, sec } = identity();
  const { data, error } = await sb.rpc('sweetspot_submit', {
    p_id: id, p_secret: sec, p_initials: cleanIni(initials) || null,
    p_game: game, p_mode: mode, p_score: Math.round(score), p_daily: !!daily, p_meta: meta
  });
  if (error) return { ok: false, reason: 'error', message: 'Couldn’t reach the leaderboard just now. This run is saved on this device.' };
  return { ok: true, id: data };
}

export async function getTop({ game, mode = 'classic', period = 'all', limit = 10 }) {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('sweetspot_top', {
    p_game: game, p_mode: mode, p_daily: period === 'daily' ? todayKey() : null, p_limit: limit
  });
  if (error) return null;
  return data || [];
}
