/* Pinball-style three-letter initials entry.
   Expects this markup on the page (see index.html):
     #ini (container, hidden) > #slots, #kb, #iniHint, #iniGo
   Saved initials live in localStorage 'ss.ini' and are shared by every game. */
import { $, clamp, store, TOUCH } from '../util.js';
import { coreSfx as sfx } from '../audio/audio.js';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/* Accepts 1 to 3 characters to match the existing sweet_spot_submit RPC. */
export const cleanIni = v => (typeof v === 'string' && /^[A-Z0-9]{1,3}$/.test(v)) ? v : '';
export const savedIni = () => cleanIni(store.get('ss.ini', ''));

/* createInitials({ onOpen, onClose, onDone })
   onOpen/onClose let the game hide its own buttons; onDone(v) runs after save. */
export function createInitials({ onOpen = () => {}, onClose = () => {}, onDone = () => {} } = {}) {
  const INI = { active: false, pos: 0, ch: [0, 0, 0], done: null };

  const box = $('#slots');
  for (let i = 0; i < 3; i++) {
    const sl = document.createElement('div'); sl.className = 'slot';
    sl.innerHTML = `<button class="up" aria-label="Next letter, slot ${i + 1}">▲</button><span class="ch" aria-live="polite">A</span><button class="dn" aria-label="Previous letter, slot ${i + 1}">▼</button>`;
    sl.querySelector('.up').addEventListener('click', () => { INI.pos = i; step(1); });
    sl.querySelector('.dn').addEventListener('click', () => { INI.pos = i; step(-1); });
    sl.querySelector('.ch').addEventListener('click', () => { INI.pos = i; render(); });
    box.appendChild(sl);
  }

  const kb = $('#kb');
  ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', '<ZXCVBNM'].forEach((keys, r) => {
    const row = document.createElement('div'); row.className = 'kr' + (r === 2 ? ' in' : '');
    for (const c of keys) {
      const b = document.createElement('button'); b.type = 'button';
      if (c === '<') {
        b.className = 'bk'; b.setAttribute('aria-label', 'Back one letter');
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h11v14H9l-6-7z"/><path d="M13 9.5l4 5M17 9.5l-4 5"/></svg>';
        b.addEventListener('click', () => move(-1));
      } else { b.textContent = c; b.addEventListener('click', () => type(c)); }
      row.appendChild(b);
    }
    kb.appendChild(row);
  });
  const go = document.createElement('button'); go.type = 'button'; go.className = 'go'; go.textContent = 'Register';
  go.addEventListener('click', () => done());
  kb.appendChild(go);
  $('#iniGo').addEventListener('click', () => done());

  function render() {
    [...box.children].forEach((el, i) => {
      el.querySelector('.ch').textContent = CHARS[INI.ch[i]];
      el.classList.toggle('active', i === INI.pos);
      el.classList.toggle('locked', i < INI.pos);
    });
  }
  function step(d) { INI.pos = Math.min(INI.pos, 2); INI.ch[INI.pos] = (INI.ch[INI.pos] + d + CHARS.length) % CHARS.length; sfx.tick(); render(); }
  function move(d) { INI.pos = clamp(INI.pos + d, 0, 2); sfx.tick(); render(); }
  function type(c) { if (INI.pos > 2) return; INI.ch[INI.pos++] = CHARS.indexOf(c.toUpperCase()); sfx.tick(); render(); } // pos 3 = all typed
  function lock() { if (INI.pos < 2) { INI.pos++; sfx.lock(); render(); } else done(); }
  function close() { INI.active = false; INI.done = null; $('#ini').hidden = true; onClose(); }
  function done() {
    if (!INI.active) return;
    const v = INI.ch.map(i => CHARS[i]).join('');
    store.set('ss.ini', v);
    const cb = INI.done;
    close(); sfx.register();
    if (cb) cb(v);
    onDone(v);
  }

  return {
    get active() { return INI.active; },
    close,
    open(cb) {
      const saved = savedIni() || 'AAA';
      INI.ch = [0, 1, 2].map(i => Math.max(0, CHARS.indexOf(saved[i] || 'A')));
      INI.pos = 0; INI.active = true; INI.done = cb;
      $('#ini').hidden = false;
      $('#ini').classList.toggle('touch', TOUCH);
      $('#iniHint').textContent = TOUCH ? 'Type three initials. Tap a slot to change it.' : 'Up and down pick a letter, Enter locks it in. You can also just type.';
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      onOpen();
      render();
    },
    /* Route keydown here while active. */
    key(e) {
      const k = e.key;
      if (k === 'ArrowUp') step(1);
      else if (k === 'ArrowDown') step(-1);
      else if (k === 'ArrowLeft' || k === 'Backspace') move(-1);
      else if (k === 'ArrowRight') move(1);
      else if (k === 'Enter' || k === ' ' || e.code === 'Space') { if (!e.repeat) lock(); }
      else if (/^[a-z0-9]$/i.test(k)) type(k);
      else return;
      e.preventDefault();
    }
  };
}
