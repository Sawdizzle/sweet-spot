/* Synthesized audio: one shared AudioContext, a noise buffer, and two voice
   builders (nz = filtered noise, tn = tone). Games build their own sounds
   from nz/tn and can add a background bed with onAudioReady. */
import { store } from '../util.js';

export const A = { ctx: null, master: null, nb: null };
let muted = store.get('ss.muted', false);
const readyCbs = [];

export const isMuted = () => muted;
export function onAudioReady(fn) { readyCbs.push(fn); if (A.ctx) fn(A); }

export function ensureAudio() {
  try {
    if (!A.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      A.ctx = new AC();
      A.master = A.ctx.createGain(); A.master.gain.value = muted ? 0 : 0.8; A.master.connect(A.ctx.destination);
      const len = A.ctx.sampleRate * 2, b = A.ctx.createBuffer(1, len, A.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      A.nb = b;
      readyCbs.forEach(f => f(A));
    }
    if (A.ctx.state === 'suspended') A.ctx.resume();
  } catch (e) {}
}

export function nz({ dur = 0.2, type = 'bandpass', f = 1000, q = 1, g = 0.4, a = 0.003, f2 = null, delay = 0 }) {
  const c = A.ctx; if (!c || muted) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource(); src.buffer = A.nb;
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
  const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl).connect(gn).connect(A.master); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
export function tn({ f = 440, dur = 0.2, type = 'sine', g = 0.3, a = 0.005, f2 = null, delay = 0 }) {
  const c = A.ctx; if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(A.master); o.start(t); o.stop(t + dur + 0.05);
}

/* Sounds every game shares: UI ticks for initials, a heart lost, a perfect hit. */
export const coreSfx = {
  tick() { tn({ f: 1180, dur: 0.035, type: 'square', g: 0.03 }); },
  lock() { tn({ f: 660, dur: 0.06, type: 'square', g: 0.04 }); tn({ f: 990, dur: 0.08, type: 'square', g: 0.035, delay: 0.05 }); },
  register() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tn({ f, dur: i === 3 ? 0.35 : 0.09, type: 'square', g: 0.04, delay: i * 0.08 })); },
  heartLost() { tn({ f: 233, f2: 140, dur: 0.38, type: 'sawtooth', g: 0.07 }); tn({ f: 175, f2: 110, dur: 0.42, type: 'sawtooth', g: 0.05, delay: 0.04 }); },
  perfect() { tn({ f: 660, dur: 0.08, g: 0.07 }); tn({ f: 990, dur: 0.14, g: 0.06, delay: 0.07 }); }
};

/* Mute button wiring. */
const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
let muteBtn = null;
function setMuteIcon() {
  if (!muteBtn) return;
  muteBtn.innerHTML = muted ? ICON_OFF : ICON_ON;
  muteBtn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
}
export function toggleMute() {
  muted = !muted; store.set('ss.muted', muted); setMuteIcon();
  if (A.master) A.master.gain.setTargetAtTime(muted ? 0 : 0.8, A.ctx.currentTime, 0.05);
  if (!muted) ensureAudio();
}
export function bindMuteButton(btn) {
  muteBtn = btn; setMuteIcon();
  btn.addEventListener('click', toggleMute);
}
