/* Small helpers shared by every game. */
export const $ = s => document.querySelector(s);
export const TAU = Math.PI * 2, D2R = Math.PI / 180;
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = t => t * t * (3 - 2 * t);
export const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const TOUCH = matchMedia('(pointer: coarse)').matches;

/* localStorage with JSON and silent failure (private mode, blocked storage).
   Keys use the shared 'ss.' prefix so identity and initials carry across games. */
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
