import { GAMES } from '../core/games.js';
import { getTop } from '../core/leaderboard/scores.js';
import { cleanIni } from '../core/initials/initials.js';
import { store } from '../core/util.js';
import { SCENES } from './scenes.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ACCENT = { baseball: '#ff7a59', fieldgoal: '#ffd34d', pk: '#8fe0a0', hockey: '#7fc6ff', golf: '#b7e36b', drag: '#ff4f5e' };
const ARROW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

/* ---------- Game cards with animated scenes ---------- */
const grid = document.getElementById('tiles');
GAMES.forEach((g, i) => {
  const a = document.createElement('a');
  a.className = 'card'; a.href = g.path;
  a.style.setProperty('--acc', ACCENT[g.id] || '#ffb547');
  a.style.setProperty('--i', i);
  a.setAttribute('aria-label', `Play ${g.name}`);
  a.innerHTML = `<div class="art"><span class="num">0${i + 1}</span>
      <svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${SCENES[g.id]()}</svg></div>
    <div class="body"><h2>${esc(g.name)}</h2><p class="blurb">${esc(g.blurb)}</p>
      <div class="window">Sweet spot: ${esc(g.window)}</div>
      <div class="foot"><div class="leader loading" id="lead-${g.id}">Today's leader<b>&nbsp;</b></div><span class="play">Play${ARROW}</span></div></div>`;
  grid.appendChild(a);
});

/* Scenes only animate while on screen. With reduced motion they hold a
   frame from the middle of the moment instead. */
const svgs = [...grid.querySelectorAll('.art svg')];
if (REDUCE) {
  svgs.forEach(s => { try { s.pauseAnimations(); s.setCurrentTime(2.1); } catch (e) {} });
} else if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => es.forEach(e => {
    try { e.isIntersecting ? e.target.unpauseAnimations() : e.target.pauseAnimations(); } catch (err) {}
  }), { threshold: 0.15 });
  svgs.forEach(s => io.observe(s));
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
    el.classList.remove('loading');
    if (!today) { el.innerHTML = 'Leaderboard<b>Offline</b>'; return; }
    el.innerHTML = row
      ? `${label}<b><span class="ini">${esc(cleanIni(row.initials) || '···')}</span>${esc(g.fmt(row.score))}</b>`
      : 'Today’s leader<b>Open. Take it.</b>';
  })();
}

/* ---------- Daily reset clock (UTC midnight, matching the server) ---------- */
const reset = document.getElementById('reset');
const pad = n => String(n).padStart(2, '0');
function tick() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  reset.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
tick(); setInterval(tick, 1000);

/* ---------- Try-it meter: a one-tap taste of every game ---------- */
const box = document.getElementById('tryit'), needle = document.getElementById('needle');
const msg = document.getElementById('tryMsg'), streakEl = document.getElementById('tryStreak'), bestEl = document.getElementById('tryBest');
const T = { t0: performance.now(), stopped: false, speed: 0.75, streak: 0, best: store.get('ss.landing.best', 0) };
if (T.best) bestEl.textContent = `Best streak: ${T.best}`;
const pos = now => { const k = ((now - T.t0) / 1000 * T.speed) % 2; return k <= 1 ? k : 2 - k; };
let ctx = null;
function beep(f, d = 0.08) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(0.04, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + d + 0.02);
  } catch (e) {}
}
function frame(now) {
  if (!T.stopped) needle.style.left = (pos(now) * 100).toFixed(2) + '%';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
function stop(e) {
  if (e) e.preventDefault();
  if (T.stopped) return;
  const v = pos(performance.now()), off = Math.abs(v - 0.5);
  T.stopped = true;
  let word, cls;
  if (off <= 0.03) { word = 'Perfect'; cls = 'perfect'; T.streak++; beep(990); setTimeout(() => beep(1320), 70); }
  else if (off <= 0.07) { word = v < 0.5 ? 'Close, a hair early' : 'Close, a hair late'; cls = 'good'; T.streak++; beep(660); }
  else { word = v < 0.5 ? 'Early' : 'Late'; cls = 'miss'; T.streak = 0; beep(180, 0.16); }
  if (T.streak > T.best) { T.best = T.streak; store.set('ss.landing.best', T.best); bestEl.textContent = `Best streak: ${T.best}`; }
  msg.className = cls; msg.textContent = word; void msg.offsetWidth; msg.classList.add('pop');
  streakEl.textContent = T.streak ? `Streak ${T.streak}` : '';
  setTimeout(() => {
    T.speed = Math.min(1.8, 0.75 + T.streak * 0.08);
    T.t0 = performance.now() - (Math.random() * 400);
    T.stopped = false;
  }, 750);
}
box.addEventListener('pointerdown', stop);
box.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') stop(e); });
