import { GAMES } from '../core/games.js';
import { getTop } from '../core/leaderboard/scores.js';
import { cleanIni } from '../core/initials/initials.js';
import { ART } from './art.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const grid = document.getElementById('tiles');
for (const g of GAMES) {
  const a = document.createElement('a');
  a.className = 'tile'; a.href = g.path;
  a.innerHTML = `<svg class="art" viewBox="0 0 320 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${ART[g.id]}</svg>
    <div class="body"><h2 class="name">${esc(g.name)}</h2><p class="blurb">${esc(g.blurb)}</p>
    <div class="foot"><div class="leader" id="lead-${g.id}">Today's leader<b>…</b></div><span class="play">Play</span></div></div>`;
  grid.appendChild(a);
}

/* Today's leader per game, falling back to the all-time leader. */
for (const g of GAMES) {
  (async () => {
    const el = document.getElementById('lead-' + g.id);
    const today = await getTop({ game: g.id, mode: g.board, period: 'daily', limit: 1 });
    let row = today && today[0], label = 'Today’s leader';
    if (!row && today) {
      const all = await getTop({ game: g.id, mode: g.board, period: 'all', limit: 1 });
      row = all && all[0]; label = 'All-time leader';
    }
    if (!today) { el.innerHTML = 'Leaderboard<b>Offline</b>'; return; }
    el.innerHTML = row
      ? `${label}<b><span class="ini">${esc(cleanIni(row.initials) || '···')}</span>${esc(g.fmt(row.score))}</b>`
      : 'Today’s leader<b>Open. Take it.</b>';
  })();
}

/* Daily reset countdown (UTC midnight, matching the server). */
const reset = document.getElementById('reset');
function tick() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const m = Math.max(0, Math.floor((next - now) / 60000));
  reset.textContent = `New challenge in ${Math.floor(m / 60)}h ${m % 60}m`;
}
tick(); setInterval(tick, 30000);
