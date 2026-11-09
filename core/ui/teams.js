/* Team colors shared by every game. j = main color (jersey, car body),
   h = trim (numbers, stripes, helmet). Same list baseball uses, so a pick
   made in baseball carries over to the other games the first time. */
import { store } from '../util.js';

export const TEAMS = [
  { id: 'steel', name: 'Steel blue', j: '#3d6f9f', h: '#1d2f4a' },
  { id: 'crimson', name: 'Crimson', j: '#b0352c', h: '#2b1515' },
  { id: 'royal', name: 'Royal', j: '#2f55c9', h: '#f1ece0' },
  { id: 'gold', name: 'Black and gold', j: '#26262b', h: '#d4a72c' },
  { id: 'orange', name: 'Orange', j: '#e2742b', h: '#1b1b1f' },
  { id: 'purple', name: 'Purple', j: '#6b41a8', h: '#e9c84a' },
  { id: 'white', name: 'Home whites', j: '#efeae0', h: '#14213d' },
  { id: 'teal', name: 'Teal', j: '#1f8a8a', h: '#0d2b2b' },
  { id: 'kelly', name: 'Kelly green', j: '#2e8b3e', h: '#f1ece0' }
];

/* Each game keeps its own pick (ss.<game>.team). With no pick yet it starts
   from baseball's choice, then from the game's own default. */
export function getTeam(game, fallback = 'crimson') {
  const own = store.get(`ss.${game}.team`, null);
  const base = (store.get('ss.opts', {}) || {}).team;
  return TEAMS.find(t => t.id === own) || TEAMS.find(t => t.id === base) || TEAMS.find(t => t.id === fallback) || TEAMS[0];
}
export function setTeam(game, id) {
  store.set(`ss.${game}.team`, id);
  return getTeam(game);
}

/* Small color helpers for shading a team color. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
/* True for light colors, so text or trim on top can switch to dark. */
export const isLight = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170; };
