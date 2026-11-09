/* Plane geometry for the golf course. World units are yards.
   x runs right, y runs from the tee toward the green.
   A heading is measured clockwise from +y, so heading 0 points up the hole.
   Polygons are arrays of [x, y]; ball positions are { x, y }.
   No DOM here, so Node tests can import it. */

export const D2R = Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dirOf = h => ({ x: Math.sin(h), y: Math.cos(h) });
export const rightOf = h => ({ x: Math.cos(h), y: -Math.sin(h) });
export const headingTo = (a, b) => Math.atan2(b.x - a.x, b.y - a.y);
export const add = (p, d, k = 1) => ({ x: p.x + d.x * k, y: p.y + d.y * k });

/* Even-odd point in polygon. */
export function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Distance from p to segment ab (points as {x,y}). */
export function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/* Distance from p to a polygon's edge (0 inside). */
export function polyDist(p, poly) {
  if (inPoly(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, segDist(p, { x: poly[j][0], y: poly[j][1] }, { x: poly[i][0], y: poly[i][1] }));
  }
  return best;
}

/* Catmull-Rom curve through control points, sampled about every `step` yards. */
export function smoothPath(pts, step = 4) {
  const P = pts.map(([x, y]) => ({ x, y }));
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...P[P.length - 1] });
  return out;
}

export function pathLen(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += dist(path[i - 1], path[i]);
  return L;
}

/* Point and heading at distance d along a path. Extrapolates past either end. */
export function pointAt(path, d) {
  if (d <= 0) {
    const h = headingTo(path[0], path[1]);
    return { ...add(path[0], dirOf(h), d), h };
  }
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (acc + seg >= d) {
      const t = (d - acc) / seg, a = path[i - 1], b = path[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: headingTo(a, b) };
    }
    acc += seg;
  }
  const n = path.length, h = headingTo(path[n - 2], path[n - 1]);
  return { ...add(path[n - 1], dirOf(h), d - acc), h };
}

/* Distance along the path of the point nearest p. */
export function project(path, p) {
  let best = Infinity, at = 0, acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], seg = dist(a, b);
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = seg ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (seg * seg), 0, 1) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best) { best = d; at = acc + seg * t; }
    acc += seg;
  }
  return at;
}

/* A band of half-width `half` along the path from distance `from` to `to`,
   with round caps when `caps` is set. Returns a polygon. */
export function ribbon(path, half, from, to, caps = true, step = 5) {
  const L = [], R = [];
  const n = Math.max(2, Math.ceil((to - from) / step));
  for (let k = 0; k <= n; k++) {
    const p = pointAt(path, from + (to - from) * k / n), r = rightOf(p.h);
    R.push([p.x + r.x * half, p.y + r.y * half]);
    L.push([p.x - r.x * half, p.y - r.y * half]);
  }
  const cap = (p, h0) => {
    const pts = [];
    if (!caps) return pts;
    for (let k = 1; k < 8; k++) {
      const a = h0 + Math.PI / 2 - Math.PI * k / 8;
      pts.push([p.x + Math.sin(a) * half, p.y + Math.cos(a) * half]);
    }
    return pts;
  };
  const e = pointAt(path, to), s = pointAt(path, from);
  return [...R, ...cap(e, e.h), ...L.reverse(), ...cap(s, s.h + Math.PI)];
}

/* Ellipse polygon. */
export function oval(cx, cy, rx, ry, rot = 0, n = 28) {
  const out = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}
