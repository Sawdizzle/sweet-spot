/* Sweet Spot National: one original 18-hole course, par 72.
   Every hole is data. Yards are world units; the tee sits at (0, 0) and the
   hole plays up the screen (+y). Each spec lists:
     pts      centerline control points, tee first, green center last
     fw       fairway half-width; fwFrom: where the fairway starts (yards from the tee)
     ob       half-width of the in-bounds corridor around the centerline
     green    [rx, ry, rot] ellipse around the last point; pin: offset from green center
     bunkers  and water: [cx, cy, rx, ry, rot] ellipses
     slope    [deg, pct]: the green falls toward heading `deg` (0 = away from the tee)
   build() turns each spec into polygons: fairway, green, bunkers, water, bounds.
   Rough is everything in bounds that is not one of the others.

   Par slices: holes 1-3 play 4,3,5; 1-6 have two each of par 3, 4, 5;
   1-9 is par 36, 1-12 par 48, 1-18 par 72 (checked by test/golf.test.mjs). */
import { smoothPath, pathLen, ribbon, oval, pointAt } from './geo.js';

const SPECS = [
  { n: 1, name: 'First Light', par: 4, pts: [[0, 0], [0, 140], [18, 260], [40, 372]], fw: 21, fwFrom: 40,
    green: [14, 12, 0.2], pin: [3, 2], slope: [80, 1.5],
    bunkers: [[40, 248, 9, 6, 0.3], [24, 357, 7, 4, 0], [58, 380, 5, 7, 0.4]] },
  { n: 2, name: 'Lantern', par: 3, pts: [[0, 0], [-6, 85], [-8, 168]], fw: 13, par3: true,
    green: [15, 13, 0], pin: [-3, -2], slope: [200, 2],
    bunkers: [[-26, 164, 5, 8, 0.2], [10, 174, 5, 7, -0.2], [6, 151, 6, 4, 0]] },
  { n: 3, name: 'Long Shadow', par: 5, pts: [[0, 0], [-8, 235], [-38, 405], [-22, 540]], fw: 22, fwFrom: 45,
    green: [16, 13, -0.3], pin: [2, 4], slope: [30, 2],
    bunkers: [[-42, 255, 8, 12, 0], [-4, 526, 5, 8, 0.3], [-42, 550, 7, 5, 0]],
    water: [[-34, 444, 72, 6, -0.12]] },
  { n: 4, name: 'Turnstile', par: 4, pts: [[0, 0], [0, 200], [-40, 325], [-75, 402]], fw: 20, fwFrom: 40,
    green: [13, 14, 0.4], pin: [-3, -3], slope: [270, 1.8],
    bunkers: [[24, 272, 9, 10, 0], [-59, 402, 5, 8, 0.3]] },
  { n: 5, name: 'Heron Lake', par: 5, pts: [[0, 0], [15, 215], [2, 380], [-8, 500]], fw: 22, fwFrom: 40,
    green: [15, 13, 0], pin: [0, 4], slope: [120, 1.5],
    bunkers: [[12, 488, 5, 6, 0], [-26, 506, 6, 5, 0]],
    water: [[-30, 250, 11, 70, 0.05]] },
  { n: 6, name: 'Gatehouse Pond', par: 3, pts: [[0, 0], [3, 95], [6, 188]], fw: 13, par3: true,
    green: [16, 13, 0], pin: [2, 1], slope: [300, 2.2],
    bunkers: [[-16, 197, 6, 6, 0], [23, 181, 5, 6, 0]],
    water: [[2, 106, 32, 24, 0]] },
  { n: 7, name: 'Short Fuse', par: 4, pts: [[0, 0], [-14, 175], [8, 342]], fw: 19, fwFrom: 40,
    green: [13, 12, 0.2], pin: [3, 3], slope: [180, 2],
    bunkers: [[-33, 215, 7, 7, 0], [6, 238, 6, 6, 0], [-9, 326, 7, 4, 0], [25, 350, 5, 7, 0]] },
  { n: 8, name: 'Long Mile', par: 4, pts: [[0, 0], [8, 220], [0, 428]], fw: 22, fwFrom: 40,
    green: [14, 15, 0], pin: [-2, -4], slope: [90, 1.2],
    bunkers: [[-20, 240, 7, 10, 0], [36, 268, 8, 10, 0], [-19, 420, 5, 8, 0], [19, 436, 5, 8, 0]] },
  { n: 9, name: 'Porch Pond', par: 4, pts: [[0, 0], [0, 215], [38, 325], [58, 395]], fw: 20, fwFrom: 40,
    green: [13, 13, 0.4], pin: [-2, 2], slope: [225, 2],
    bunkers: [[73, 382, 5, 7, 0]],
    water: [[30, 368, 14, 9, 0.5]] },
  { n: 10, name: 'Turn Back', par: 4, pts: [[0, 0], [-20, 195], [-10, 388]], fw: 21, fwFrom: 40,
    green: [14, 12, 0], pin: [2, 2], slope: [60, 1.6],
    bunkers: [[-46, 235, 7, 9, 0], [5, 378, 5, 7, 0]] },
  { n: 11, name: 'Short Porch', par: 3, pts: [[0, 0], [6, 72], [10, 146]], fw: 12, par3: true,
    green: [14, 11, 0], pin: [-2, 2], slope: [180, 2.5],
    bunkers: [[-8, 140, 5, 6, 0], [28, 148, 5, 6, 0]],
    water: [[11, 172, 30, 6, 0]] },
  { n: 12, name: 'Two Bends', par: 5, pts: [[0, 0], [18, 230], [-18, 410], [0, 555]], fw: 22, fwFrom: 45,
    green: [15, 13, 0.2], pin: [-1, 3], slope: [250, 1.8],
    bunkers: [[32, 420, 8, 10, 0], [16, 542, 5, 7, 0], [-16, 567, 6, 4, 0]],
    water: [[-3, 334, 72, 6, 0.2]] },
  { n: 13, name: 'Ridge Line', par: 4, pts: [[0, 0], [24, 210], [30, 418]], fw: 21, fwFrom: 40,
    green: [14, 14, 0], pin: [3, -3], slope: [100, 2],
    bunkers: [[50, 232, 7, 9, 0], [-2, 272, 7, 9, 0], [14, 412, 4, 7, 0]] },
  { n: 14, name: 'Mill Race', par: 4, pts: [[0, 0], [-28, 185], [-34, 368]], fw: 19, fwFrom: 40,
    green: [13, 13, 0], pin: [-4, 0], slope: [80, 2.2],
    bunkers: [[-52, 218, 7, 8, 0], [-49, 372, 4, 6, 0]],
    water: [[-8, 364, 7, 22, 0]] },
  { n: 15, name: 'Night Owl', par: 3, pts: [[0, 0], [-8, 88], [-15, 175]], fw: 13, par3: true,
    green: [16, 13, 0], pin: [2, 3], slope: [160, 1.5],
    bunkers: [[-35, 174, 5, 9, 0], [5, 170, 5, 9, 0], [-17, 154, 8, 3, 0]] },
  { n: 16, name: 'Lake Shore', par: 4, pts: [[0, 0], [0, 240], [-30, 438]], fw: 21, fwFrom: 40,
    green: [14, 14, -0.2], pin: [-2, 2], slope: [300, 1.6],
    bunkers: [[28, 262, 7, 10, 0], [-13, 452, 6, 6, 0]],
    water: [[-36, 245, 11, 55, 0]] },
  { n: 17, name: 'Long Way Home', par: 5, pts: [[0, 0], [-20, 250], [20, 410], [30, 532]], fw: 22, fwFrom: 45,
    green: [15, 13, 0], pin: [2, 2], slope: [200, 2],
    bunkers: [[-46, 265, 8, 10, 0], [10, 300, 6, 6, 0], [48, 525, 5, 8, 0], [14, 544, 6, 4, 0]] },
  { n: 18, name: 'Last Call', par: 4, pts: [[0, 0], [10, 230], [-8, 422]], fw: 21, fwFrom: 40,
    green: [14, 14, 0], pin: [-3, 1], slope: [250, 2],
    bunkers: [[34, 252, 7, 10, 0], [10, 432, 5, 8, 0]],
    water: [[-35, 400, 9, 30, 0]] }
];

const OB_HALF = 55, OB_BEHIND = 25, OB_BEYOND = 38;

export function build(spec) {
  const path = smoothPath(spec.pts);
  const len = pathLen(path);
  const end = path[path.length - 1];
  const [rx, ry, rot] = spec.green;
  const pin = { x: end.x + spec.pin[0], y: end.y + spec.pin[1] };
  const fairway = spec.par3
    ? ribbon(path, spec.fw, len - ry - 22, len - ry * 0.4)
    : ribbon(path, spec.fw, spec.fwFrom, len - ry * 0.5);
  const s = spec.slope;
  return {
    n: spec.n, name: spec.name, par: spec.par,
    tee: { x: path[0].x, y: path[0].y },
    pin, path, len,
    yards: Math.round(len + spec.pin[1]),
    fairway,
    green: oval(end.x, end.y, rx, ry, rot, 36),
    bunkers: (spec.bunkers || []).map(b => oval(...b)),
    water: (spec.water || []).map(w => oval(...w, 36)),
    bounds: ribbon(path, spec.ob || OB_HALF, -OB_BEHIND, len + OB_BEYOND, false, 6),
    teeBox: (() => { const p = pointAt(path, 0); return { x: p.x, y: p.y, h: p.h }; })(),
    slope: { x: Math.sin(s[0] * Math.PI / 180) * s[1], y: Math.cos(s[0] * Math.PI / 180) * s[1], pct: s[1], deg: s[0] }
  };
}

export const HOLES = SPECS.map(build);
export const SPEC_COUNT = SPECS.length;
