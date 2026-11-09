/* Lives display. The page styles '.lost' (see the #hearts rules in CSS);
   this module only builds the icons and toggles that class. */
export const HEART_SVG = `<svg viewBox="0 0 32 30" aria-hidden="true"><path d="M16 28.5C6 20.5 1 14.6 1 9.2 1 5 4.4 1.6 8.5 1.6c3 0 5.6 1.7 7.5 4.4 1.9-2.7 4.5-4.4 7.5-4.4 4.1 0 7.5 3.4 7.5 7.6 0 5.4-5 11.3-15 19.3z" fill="#f4efe4" stroke="#c9c0ae" stroke-width="1"/><path d="M7 5.5q5 6.5 2 13.5M25 5.5q-5 6.5-2 13.5" fill="none" stroke="#d23a2e" stroke-width="1.7" stroke-dasharray="1.6 2.1" stroke-linecap="round"/></svg>`;

/* Plain heart for games that are not baseball. */
export const HEART_PLAIN = `<svg viewBox="0 0 32 30" aria-hidden="true"><path d="M16 28.5C6 20.5 1 14.6 1 9.2 1 5 4.4 1.6 8.5 1.6c3 0 5.6 1.7 7.5 4.4 1.9-2.7 4.5-4.4 7.5-4.4 4.1 0 7.5 3.4 7.5 7.6 0 5.4-5 11.3-15 19.3z" fill="#ff6a5c" stroke="#b8322a" stroke-width="1.2"/><path d="M8 6.5q-3 1.5-3 5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/></svg>`;

/* createHearts(el, { count, svg })
   .build()          draw `count` full hearts
   .set(remaining)   mark hearts past `remaining` as lost */
export function createHearts(el, { count = 3, svg = HEART_SVG } = {}) {
  return {
    count,
    build() { el.innerHTML = svg.repeat(count); },
    set(remaining) {
      [...el.children].forEach((h, i) => h.classList.toggle('lost', i >= remaining));
    }
  };
}
