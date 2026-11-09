/* Game shell: the HTML chrome every Sweet Spot game shares.
   Builds the scoreboard, start menu, game-over card with initials entry,
   leaderboard panel, mute/home/share buttons, and wires input.
   A game supplies its canvas drawing and rules through callbacks.

   const shell = mountShell({
     game: 'fieldgoal', name: 'Field Goal', titleHtml: 'Field<br>Goal',
     lede: 'One sentence about the game.',
     rules: [['Aim', 'Tap to lock the needle'], ...],
     modes: [{ id: 'classic', label: 'Classic', note: '...' },
             { id: 'daily', label: 'Daily', note: '...', daily: true, board: 'classic' }],
     hud: [{ id: 'score', label: 'Score' }, { hearts: true, label: 'Kicks left' },
           { id: 'wind', label: 'Wind', unit: 'mph', amber: true }],
     boards: [{ id: 'today', label: 'Today', mode: 'classic', period: 'daily', note: '...' },
              { id: 'all', label: 'All-time', mode: 'classic', period: 'all', note: '...' }],
     hearts: 3, playLabel: 'Kick off', againLabel: 'Kick again',
     fmt: v => v.toLocaleString(),           // how a score reads on the board
     share: (score, meta) => 'I made a 58-yarder on Sweet Spot',
     onStart(mode) {},                       // begin a run (mode object from `modes`)
     onAction(time, event) {},               // tap / space / click during play
     onMenu() {},                            // optional: back at the menu
     colors: { label: 'Jersey', default: 'crimson' },  // optional team color picker
     onTeam(team) {}                         // optional: { id, name, j, h } picked
   });

   shell.set(id, value, { pulse })   update a HUD cell
   shell.hearts.set(n)               lives display (core/hearts)
   shell.callout(big, sub, cls)      big centered text ('good' | 'bad' | 'gold')
   shell.gameOver({ score, head, line, stats: [[label, value]], meta })
   shell.playing                     true between onStart and gameOver
   shell.team                        current team colors { id, name, j, h } (core/ui/teams.js) */
import { $, TOUCH, store } from '../util.js';
import { ensureAudio, bindMuteButton, toggleMute } from '../audio/audio.js';
import { createHearts, HEART_PLAIN } from '../hearts/hearts.js';
import { createInitials, savedIni, cleanIni } from '../initials/initials.js';
import { identity } from '../leaderboard/client.js';
import { TEAMS, getTeam, setTeam } from './teams.js';
import { submitScore, getTop, recordLocal, localRuns, better, lowerIsBetter } from '../leaderboard/scores.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HOME_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>';
const BOARD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 20V10M12 20V4M17 20v-7"/></svg>';

export function mountShell(cfg) {
  const app = document.getElementById('app') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'app' }));
  const modes = cfg.modes;
  const optKey = `ss.${cfg.game}.mode`;
  let mode = modes.find(m => m.id === store.get(optKey, modes[0].id)) || modes[0];
  const boardFor = m => m.board || m.id;

  app.innerHTML = `
  <canvas id="field" aria-label="${esc(cfg.name)} game area. Press space or tap to play."></canvas>
  <header id="hud" aria-label="Scoreboard"><div class="sb" style="grid-template-columns:repeat(${cfg.hud.length},1fr)">
    ${cfg.hud.map(c => c.hearts
      ? `<div class="cell"><span class="lab">${esc(c.label)}</span><div class="hearts" id="hearts"></div></div>`
      : `<div class="cell"><span class="lab">${esc(c.label)}</span><span class="num${c.amber ? ' amber' : ''}" id="h-${c.id}">${c.init ?? 0}</span>${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ''}</div>`).join('')}
  </div></header>
  <div id="callout" aria-live="polite"><div class="big"></div><div class="sub"></div></div>
  <div class="ctl">
    <a class="btn" href="/" aria-label="All games" title="All games">${HOME_SVG}<span class="t">Games</span></a>
    <button id="mute" aria-label="Mute sound" title="Sound (M)"></button>
    <button id="panelToggle" aria-controls="panel" title="Leaderboard (L)">${BOARD_SVG}<span class="t">Leaderboard</span></button>
  </div>
  <aside id="panel" aria-label="Leaderboard">
    <div class="phead"><h2>Leaderboard</h2><button id="closePanel" aria-label="Close leaderboard">×</button></div>
    <div class="tabs" role="tablist">${cfg.boards.map((b, i) => `<button role="tab" data-tab="${b.id}" aria-selected="${i === 0}">${esc(b.label)}</button>`).join('')}</div>
    <ol id="board"></ol>
    <p class="note" id="boardNote">Loading the board…</p>
  </aside>
  <section id="menu" class="overlay show" aria-label="Start"><div class="card">
    <p class="brand"><a href="/"><img src="/assets/logo-mark.svg" alt="" width="26" height="26">Sweet Spot</a></p>
    <h1 class="title">${cfg.titleHtml}</h1>
    <svg class="seam" viewBox="0 0 360 30" aria-hidden="true"><path d="M2 22 C 90 2, 270 2, 358 22" fill="none" stroke="rgba(241,236,224,.35)" stroke-width="2"/><path d="M2 22 C 90 2, 270 2, 358 22" fill="none" stroke="#d23a2e" stroke-width="7" stroke-dasharray="2 9" stroke-linecap="round" transform="translate(0,-1)"/></svg>
    <p class="lede">${esc(cfg.lede)}</p>
    <dl class="rules">${cfg.rules.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
    <div class="opts">
      <div class="opt"><span class="ol">Mode</span><div class="seg" id="optMode">${modes.map(m => `<button data-v="${m.id}">${esc(m.label)}</button>`).join('')}</div></div>
      <p class="optnote" id="modeNote"></p>
      ${cfg.colors ? `<div class="opt"><span class="ol">${esc(cfg.colors.label || 'Colors')}</span><div class="sws" id="optTeam"></div></div>` : ''}
      ${cfg.extraOptsHtml || ''}
    </div>
    <span class="plate-wrap"><button class="plate" id="play">${esc(cfg.playLabel || 'Play')}</button></span>
    <p class="hint" id="menuBest"></p>
    <p class="hint"><a class="back" href="/">← All games</a></p>
  </div></section>
  <section id="over" class="overlay" aria-label="Run summary"><div class="card">
    <h2 class="oh" id="oHead">Game over</h2>
    <div class="oscore" id="oScore">0</div>
    <p class="oline" id="oLine"></p>
    <div class="stats" id="oStats"></div>
    <div id="ini" hidden>
      <p class="ini-h" id="iniHead">New high score</p>
      <div class="dmd" id="slots"></div>
      <p class="ini-hint" id="iniHint"></p>
      <div class="kb" id="kb" aria-label="Initials keypad"></div>
      <span class="plate-wrap ini-go"><button class="plate" id="iniGo">Register</button></span>
    </div>
    <div class="orow" id="oActions">
      <span class="plate-wrap"><button class="plate" id="again">${esc(cfg.againLabel || 'Play again')}</button></span>
      <button class="ghost-btn" id="share">Share</button>
      <button class="ghost-btn" id="toMenu">${esc(cfg.name)} menu</button>
      <a class="ghost-btn" href="/">All games</a>
      <button class="ghost-btn" id="seeBoard">Leaderboard</button>
    </div>
    <p class="note" id="oNote"></p>
  </div></section>`;

  const canvas = $('#field');
  const hearts = createHearts($('#hearts') || document.createElement('div'), { count: cfg.hearts ?? 3, svg: cfg.heartSvg || HEART_PLAIN });
  hearts.build();
  bindMuteButton($('#mute'));

  const state = { playing: false, lastRun: null, boardTab: cfg.boards[0].id, tok: 0 };
  const startHint = TOUCH ? 'Tap anywhere to play.' : 'Press <kbd>Space</kbd> to start.';

  /* ---------- Team colors ---------- */
  let team = getTeam(cfg.game, cfg.colors && cfg.colors.default);
  if (cfg.colors) {
    const tw = $('#optTeam');
    for (const t of TEAMS) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.v = t.id; b.setAttribute('aria-label', t.name); b.title = t.name;
      b.style.setProperty('--j', t.j); b.style.setProperty('--h', t.h);
      b.addEventListener('click', () => {
        team = setTeam(cfg.game, t.id);
        tw.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === team.id)));
        if (cfg.onTeam) cfg.onTeam(team);
      });
      tw.appendChild(b);
    }
    tw.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === team.id)));
  }

  /* ---------- Menu ---------- */
  function renderOpts() {
    document.querySelectorAll('#optMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === mode.id)));
    $('#modeNote').textContent = mode.note || '';
    const best = localRuns(cfg.game, boardFor(mode), mode.daily ? 'daily' : 'all')[0];
    $('#menuBest').innerHTML = best ? `Your best${mode.daily ? ' today' : ''}: <strong>${esc(cfg.fmt(best.score))}</strong>. ${startHint}` : startHint;
  }
  document.querySelectorAll('#optMode button').forEach(b => b.addEventListener('click', () => {
    mode = modes.find(m => m.id === b.dataset.v) || modes[0];
    store.set(optKey, mode.id); renderOpts();
    const bt = cfg.boards.find(x => x.mode === boardFor(mode) && x.period === (mode.daily ? 'daily' : 'all'));
    if (bt) setBoardTab(bt.id);
  }));
  renderOpts();

  function start() {
    if (ini.active) return;
    ensureAudio();
    $('#menu').classList.remove('show'); $('#over').classList.remove('show');
    $('#oNote').textContent = '';
    if (!app.classList.contains('wide')) togglePanel(false);
    hearts.build(); hearts.set(hearts.count);
    state.playing = true;
    cfg.onStart(mode);
  }
  function toMenu() {
    if (ini.active) return;
    state.playing = false;
    $('#over').classList.remove('show'); $('#menu').classList.add('show');
    renderOpts();
    if (cfg.onMenu) cfg.onMenu();
    setTimeout(() => $('#play').focus({ preventScroll: true }), 50);
  }
  $('#play').addEventListener('click', start);
  $('#again').addEventListener('click', start);
  $('#toMenu').addEventListener('click', toMenu);
  $('#seeBoard').addEventListener('click', () => togglePanel(true));

  /* ---------- Panel / board ---------- */
  function togglePanel(force) {
    const open = force != null ? force : !app.classList.contains('panel-open');
    app.classList.toggle('panel-open', open);
    $('#panelToggle').setAttribute('aria-expanded', String(open));
    if (open) renderBoard();
  }
  $('#panelToggle').addEventListener('click', () => togglePanel());
  $('#closePanel').addEventListener('click', () => togglePanel(false));
  function setBoardTab(id) {
    state.boardTab = id;
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === id)));
    renderBoard();
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setBoardTab(b.dataset.tab)));

  async function renderBoard() {
    const tok = ++state.tok;
    const b = cfg.boards.find(x => x.id === state.boardTab) || cfg.boards[0];
    const ol = $('#board'), note = $('#boardNote');
    const rows = await getTop({ game: cfg.game, mode: b.mode, period: b.period, limit: 10 });
    if (tok !== state.tok) return;
    ol.innerHTML = '';
    const me = identity().id;
    if (!rows) {
      const runs = localRuns(cfg.game, b.mode, b.period).slice(0, 5);
      runs.forEach((r, i) => ol.appendChild(row(i + 1, savedIni() || '···', 'This device', cfg.fmt(r.score), true)));
      note.textContent = 'Can’t reach the shared leaderboard right now. Your bests on this device are shown instead.';
      return;
    }
    if (!rows.length) { note.textContent = b.empty || 'No scores yet. Finish a run to claim the top spot.'; return; }
    rows.forEach(r => ol.appendChild(row(r.rank, cleanIni(r.initials) || '···', r.player_id === me ? 'You' : '', cfg.fmt(r.score), r.player_id === me)));
    note.textContent = b.note || '';
  }
  function row(rank, ini, name, val, me) {
    const li = document.createElement('li'); if (me) li.className = 'me';
    li.innerHTML = '<span class="rk"></span><span class="ini"></span><span class="nm"></span><span class="vl"></span>';
    li.querySelector('.rk').textContent = rank; li.querySelector('.ini').textContent = ini;
    li.querySelector('.nm').textContent = name; li.querySelector('.vl').textContent = val;
    return li;
  }

  /* ---------- Initials + game over ---------- */
  const ini = createInitials({
    onOpen() { $('#oActions').hidden = true; app.classList.toggle('entering', TOUCH); },
    onClose() { $('#oActions').hidden = false; app.classList.remove('entering'); },
    onDone() { setTimeout(() => $('#again').focus({ preventScroll: true }), 50); }
  });

  async function gameOver({ score, head = 'Game over', line = '', stats = [], meta = {}, submit = true }) {
    state.playing = false;
    const boardMode = boardFor(mode), daily = !!mode.daily, period = daily ? 'daily' : 'all';
    const prev = localRuns(cfg.game, boardMode, period)[0];
    const isPB = submit && (!prev || better(cfg.game, boardMode, score, prev.score));
    if (submit) recordLocal({ game: cfg.game, mode: boardMode, score, meta, daily });   // runs with no valid score stay off the device board too
    state.lastRun = { score, meta };

    $('#oHead').textContent = head;
    $('#oScore').textContent = cfg.fmt(score);
    $('#oLine').textContent = line || (isPB && prev ? 'New personal best' : '');
    $('#oStats').innerHTML = stats.map(([l, v]) => `<div><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('');
    $('#oNote').textContent = '';
    $('#share').hidden = !cfg.share;
    $('#over').classList.add('show');

    if (!submit) { $('#oActions').hidden = false; return; }
    /* Earns initials if it beats this device's best or makes the shared top 10. */
    let qualifies = isPB;
    if (!qualifies) {
      const top = await getTop({ game: cfg.game, mode: boardMode, period, limit: 10 });
      qualifies = !!top && (top.length < 10 || better(cfg.game, boardMode, score, top[top.length - 1].score));
    }
    const send = async initials => {
      const res = await submitScore({ game: cfg.game, mode: boardMode, score, initials, meta, daily });
      if (!res.ok) { $('#oNote').textContent = res.message; renderBoard(); return; }
      const top = await getTop({ game: cfg.game, mode: boardMode, period, limit: 100 });
      const me = identity().id, mine = top && top.find(r => r.player_id === me);
      if (mine && mine.score === score) $('#oNote').textContent = mine.rank === 1 ? (daily ? 'You lead today’s challenge.' : 'That puts you at the top of the board.') : `That puts you at #${mine.rank} on the ${daily ? 'daily' : 'all-time'} board.`;
      renderBoard();
    };
    if (qualifies && (score !== 0 || lowerIsBetter(cfg.game, boardMode))) {
      $('#iniHead').textContent = isPB ? 'New high score' : 'You made the board';
      ini.open(v => send(v));
    } else {
      ini.close();
      setTimeout(() => $('#again').focus({ preventScroll: true }), 50);
      send(savedIni());
    }
  }

  $('#share').addEventListener('click', async () => {
    if (!state.lastRun || !cfg.share) return;
    const text = cfg.share(state.lastRun.score, state.lastRun.meta);
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) { await navigator.share({ title: `Sweet Spot ${cfg.name}`, text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      $('#oNote').textContent = 'Copied to your clipboard.';
    } catch (e) {}
  });

  /* ---------- HUD ---------- */
  function set(id, v, { pulse = false } = {}) {
    const el = document.getElementById('h-' + id); if (!el) return;
    if (el.textContent !== String(v)) el.textContent = v;
    if (pulse) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
  }
  let calloutTimer = 0;
  function callout(big, sub = '', cls = '') {
    const el = $('#callout');
    el.className = ''; void el.offsetWidth;
    el.querySelector('.big').textContent = big;
    el.querySelector('.sub').innerHTML = sub;
    el.className = 'show ' + cls;
    clearTimeout(calloutTimer); calloutTimer = setTimeout(() => { el.className = ''; }, 2500);
  }

  /* ---------- Input ---------- */
  const evTime = e => { const t = e.timeStamp, n = performance.now(); return (t > 0 && Math.abs(t - n) < 500) ? t : n; };
  const overlayUp = () => $('#menu').classList.contains('show') || $('#over').classList.contains('show');
  window.addEventListener('keydown', e => {
    if (ini.active) { ini.key(e); return; }
    if (e.code === 'Space' || e.key === ' ' || (e.key === 'Enter' && overlayUp() && !(e.target && e.target.tagName === 'BUTTON'))) {
      if (e.target && e.target.closest && e.target.closest('#panel') && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      if (e.repeat) return;
      if (overlayUp()) { start(); return; }
      if (state.playing) cfg.onAction(evTime(e), e);
    } else if (e.key === 'l' || e.key === 'L') togglePanel();
    else if (e.key === 'm' || e.key === 'M') toggleMute();
    else if (e.key === 'Escape' && app.classList.contains('panel-open')) togglePanel(false);
    else if (e.key === 'Escape' && $('#over').classList.contains('show')) toMenu();
  });
  canvas.addEventListener('pointerdown', e => {
    if (overlayUp() || !state.playing) return;
    e.preventDefault();
    ensureAudio();
    cfg.onAction(evTime(e), e);
  });
  /* Tapping the dimmed field area of the start menu also starts (one-handed play). */
  $('#menu').addEventListener('click', e => { if (TOUCH && e.target === $('#menu')) start(); });

  renderBoard();
  setTimeout(() => $('#play').focus({ preventScroll: true }), 80);

  return {
    canvas, hearts, set, callout, gameOver, toMenu, renderBoard,
    get playing() { return state.playing; },
    get mode() { return mode; },
    get team() { return team; }
  };
}
