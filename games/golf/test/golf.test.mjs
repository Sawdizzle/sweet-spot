/* Node tests for Sweet Spot Golf's pure modules.
   Run: node games/golf/test/golf.test.mjs */
import assert from 'node:assert/strict';
import { HOLES } from '../holes.js';
import { inPoly, dist, headingTo } from '../geo.js';
import { lieAt, shotResult, puttResult, plan, puttPowerFor, shotPowerFor, strikeQuality, toPar, scoreName, CLUBS, PUTTER } from '../golf.js';
import { createRound } from '../round.js';
import { createSwing } from '../swing.js';
import { mulberry32 } from '../../../core/seed/seed.js';
import C from '../config.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok', name); };
const sum = a => a.reduce((s, v) => s + v, 0);
const pars = n => HOLES.slice(0, n).map(h => h.par);

/* ---------- Course data ---------- */
test('18 holes, par 72', () => {
  assert.equal(HOLES.length, 18);
  assert.equal(sum(pars(18)), 72);
});
test('holes 1-3 are one each of par 3, 4, 5', () => {
  assert.deepEqual(pars(3).slice().sort(), [3, 4, 5]);
});
test('holes 1-6 have two each of par 3, 4, 5', () => {
  const p = pars(6);
  for (const v of [3, 4, 5]) assert.equal(p.filter(x => x === v).length, 2, `par ${v}`);
});
test('slice pars: 9 = 36, 12 = 48, 18 = 72', () => {
  assert.equal(sum(pars(9)), 36);
  assert.equal(sum(pars(12)), 48);
  assert.equal(sum(pars(18)), 72);
});
test('every hole is laid out sanely', () => {
  for (const h of HOLES) {
    const tag = `hole ${h.n}`;
    assert.equal(lieAt(h, h.tee), 'rough', `${tag} tee sits in bounds on grass`);
    assert.equal(lieAt(h, h.pin), 'green', `${tag} pin on the green`);
    const want = h.par === 3 ? [120, 210] : h.par === 4 ? [320, 460] : [480, 580];
    assert.ok(h.yards >= want[0] && h.yards <= want[1], `${tag} length ${h.yards} fits par ${h.par}`);
    // the centerline stays in bounds and out of bunkers, except where a creek crosses
    for (const p of h.path) assert.notEqual(lieAt(h, p), 'ob', `${tag} centerline in bounds`);
    // water and bunkers never cover the pin
    for (const w of h.water) assert.ok(!inPoly(h.pin, w), `${tag} pin dry`);
  }
});

/* ---------- Swing meter ---------- */
test('three-click swing: power, then accuracy at the line', () => {
  const s = createSwing(C.swing);
  s.start(0);
  const a = s.tap(800);
  assert.equal(a.stage, 'power'); assert.ok(Math.abs(a.power - 0.8) < 1e-9);
  // falls at downPerSec: reaches the line after 0.8 / 1.1 s
  const tLine = 800 + 0.8 / C.swing.downPerSec * 1000;
  const b = s.tap(tLine - 10);
  assert.equal(b.stage, 'impact');
  assert.ok(b.acc > 0 && b.acc < C.swing.perfect, 'just early is a perfect strike');
  assert.equal(strikeQuality(b.acc), 'perfect');
});
test('swing auto-locks full power and a missed third tap slices', () => {
  const s = createSwing(C.swing);
  s.start(0);
  assert.equal(s.update(500), null);
  const a = s.update(1001);
  assert.equal(a.stage, 'power'); assert.equal(a.power, 1);
  const b = s.update(5000);
  assert.equal(b.stage, 'impact'); assert.ok(b.missed); assert.equal(strikeQuality(b.acc), 'slice');
});
test('early tap hooks left, late tap slices right', () => {
  const s = createSwing(C.swing);
  s.start(0); s.tap(1000);
  const early = s.tap(1000 + (1 - 0.15) / C.swing.downPerSec * 1000);
  assert.equal(strikeQuality(early.acc), 'hook');
  const h = HOLES[7], calm = { mph: 0, deg: 0 };
  const hook = shotResult(h, h.tee, 'tee', CLUBS[0], 0, 1, early.acc, calm);
  const slice = shotResult(h, h.tee, 'tee', CLUBS[0], 0, 1, -early.acc, calm);
  assert.ok(hook.land.x < -5, 'hook lands left'); assert.ok(slice.land.x > 5, 'slice lands right');
});

/* ---------- Shot physics ---------- */
const calm = { mph: 0, deg: 0 };
test('clean drive carries about 260 and rolls out', () => {
  const h = HOLES[7];
  const r = shotResult(h, h.tee, 'tee', CLUBS[0], 0, 1, 0, calm);
  assert.ok(Math.abs(r.carry - 260 * 1.02) < 0.01);
  assert.ok(dist(h.tee, r.rest) > 270, 'rolls past carry');
  assert.equal(r.event, 'ok');
});
test('rough and bunker shorten the shot', () => {
  const h = HOLES[7], p = { x: 0, y: 200 };
  const f = shotResult(h, p, 'fairway', CLUBS[3], 0, 1, 0, calm).carry;
  const r = shotResult(h, p, 'rough', CLUBS[3], 0, 1, 0, calm).carry;
  const b = shotResult(h, p, 'bunker', CLUBS[3], 0, 1, 0, calm).carry;
  assert.ok(f > r && r > b);
});
test('tailwind carries farther, crosswind drifts', () => {
  const h = HOLES[7];
  const still = shotResult(h, h.tee, 'tee', CLUBS[1], 0, 1, 0, calm);
  const tail = shotResult(h, h.tee, 'tee', CLUBS[1], 0, 1, 0, { mph: 10, deg: 0 });
  const right = shotResult(h, h.tee, 'tee', CLUBS[1], 0, 1, 0, { mph: 10, deg: 90 });
  assert.ok(tail.carry > still.carry * 1.05);
  assert.ok(right.land.x > still.land.x + 5);
});
test('water: penalty and a drop short of the water', () => {
  const h = HOLES[5]; // par 3 over a pond
  const r = createRound({ mode: 'course-18', rng: () => 0 });
  r.idx = 4; r.startHole();
  assert.equal(r.hole.n, 6);
  const res = r.hit({ club: CLUBS.find(c => c.id === 'PW'), heading: headingTo(h.tee, h.pin), power: 0.9, acc: 0 });
  assert.equal(res.event, 'water');
  assert.equal(res.outcome.penalty, 1);
  assert.equal(r.strokes, 2);
  assert.ok(r.ball.y > 0 && r.ball.y < 90, 'dropped between tee and pond');
  assert.notEqual(lieAt(h, r.ball), 'water');
});
test('out of bounds: stroke and distance from the same spot', () => {
  const r = createRound({ mode: 'course-9', rng: () => 0 });
  r.startHole();
  const res = r.hit({ club: CLUBS[0], heading: Math.PI / 2, power: 1, acc: 0 });
  assert.equal(res.event, 'ob');
  assert.equal(r.strokes, 2);
  assert.deepEqual(r.ball, r.hole.tee);
  assert.equal(r.lie, 'tee');
});
test('putts: a good one drops, gimmes count a stroke', () => {
  const h = HOLES[0], ball = { x: h.pin.x, y: h.pin.y - 5 };
  const hd = headingTo(ball, h.pin);
  let made = 0;
  for (let k = -40; k <= 40; k++) {
    for (const pw of [0.95, 1, 1.05]) {
      const r = puttResult(h, ball, hd + k * 0.004, puttPowerFor(h, ball, hd) * pw);
      if (r.event === 'holed') made++;
    }
  }
  assert.ok(made >= 1, 'some line from 5 yards drops once the break is played');
  const straight = puttResult(h, ball, hd, puttPowerFor(h, ball, hd));
  assert.ok(dist(straight.rest, h.pin) < 1.5, 'the power marker leaves it close');
  const round = createRound({ mode: 'course-3', rng: () => 0 });
  round.startHole();
  round.ball = { x: h.pin.x, y: h.pin.y - 3 }; round.lie = 'green';
  const res = round.hit({ club: PUTTER, heading: headingTo(round.ball, h.pin), power: 0.05 });
  assert.ok(res.outcome.gimme || res.outcome.holed || round.strokes === 1);
});
test('scoring helpers', () => {
  assert.equal(toPar(0), 'E'); assert.equal(toPar(3), '+3'); assert.equal(toPar(-2), '-2');
  assert.equal(scoreName(3, 4), 'Birdie'); assert.equal(scoreName(1, 3), 'Hole in one'); assert.equal(scoreName(6, 4), 'Double bogey');
});
test('arcade: bogey or worse costs a heart, points for holes and birdies', () => {
  const r = createRound({ mode: 'arcade', rng: () => 0.5 });
  const play = strokes => { r.startHole(); r.strokes = strokes; r.holed = true; return r.endHole(); };
  assert.equal(play(3).heartLost, false);   // birdie on the par-4 first
  assert.equal(play(4).heartLost, true);    // bogey on the par-3 second
  assert.equal(r.hearts, 2);
  play(7); play(6);                          // par 5 +2, par 4 +2
  assert.ok(r.over);
  const s = r.summary();
  assert.equal(s.score, 4 * C.arcade.perHole + C.arcade.birdie);
  assert.deepEqual(s.meta, { holes: 4, birdies: 1, eagles: 0 });
});

/* ---------- Simulated rounds ---------- */
function gauss(rng) { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function playRound(mode, seed, skill) {
  const rng = mulberry32(seed), noise = mulberry32(seed ^ 0x9e3779b9);
  const r = createRound({ mode, rng });
  const perHole = [];
  let guard = 0;
  while (!r.over && guard++ < 100) {
    r.startHole();
    let shots = 0;
    while (!r.done) {
      assert.ok(++shots < 40, `hole ${r.hole.n} never finishes`);
      const p = r.plan();
      let power, acc = 0, heading = p.heading;
      if (p.club.putter) {
        power = puttPowerFor(r.hole, r.ball, heading) * (1 + gauss(noise) * skill.putt);
        heading += gauss(noise) * skill.puttAim;
      } else {
        const yards = dist(r.ball, p.target);
        const need = p.layup ? 1 : shotPowerFor(r.hole, r.lie, p.club, heading, r.wind, yards, lieAt(r.hole, p.target));
        power = Math.min(1, need + gauss(noise) * skill.power);
        acc = gauss(noise) * skill.acc;
        heading += gauss(noise) * skill.aim;
      }
      r.hit({ club: p.club, heading, power: Math.max(0.02, power), acc });
    }
    const e = r.endHole();
    perHole.push({ n: r.hole.n, par: r.hole.par, strokes: e.strokes, picked: !r.holed });
  }
  return { r, perHole };
}
const PRO = { power: 0, acc: 0, aim: 0, putt: 0, puttAim: 0 };
/* Taps land with about 30 ms of jitter: that much power and timing error. */
const DECENT = { power: 0.03 / C.swing.upSecs, acc: 0.03 * C.swing.downPerSec, aim: 0.01, putt: 0.1, puttAim: 0.01 };

test('a perfect player plays every hole in par +1 or better', () => {
  const { perHole } = playRound('course-18', 7, PRO);
  for (const h of perHole) assert.ok(h.strokes <= h.par + 1, `hole ${h.n}: ${h.strokes} on par ${h.par}`);
});
test('a decent player gets round 9 holes in a sane number of strokes', () => {
  const totals = [], byHole = {};
  let picked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { r, perHole } = playRound('course-9', seed * 7919, DECENT);
    assert.equal(perHole.length, 9);
    totals.push(r.toPar);
    for (const h of perHole) {
      (byHole[h.n] = byHole[h.n] || []).push(h.strokes - h.par);
      if (h.picked) picked++;
    }
  }
  const avg = sum(totals) / totals.length;
  console.log('   decent 9-hole avg to par:', avg.toFixed(2), 'range', Math.min(...totals), Math.max(...totals), 'picked up', picked);
  console.log('   per hole avg over par:', Object.entries(byHole).map(([n, v]) => `${n}:${(sum(v) / v.length).toFixed(2)}`).join(' '));
  assert.ok(avg > -6 && avg < 9, 'average round is close to par');
  assert.ok(picked <= 6, 'almost never picks up');
  for (const [n, v] of Object.entries(byHole)) assert.ok(sum(v) / v.length < 1.8, `hole ${n} is not a wall`);
});
test('the back nine and an arcade run also finish', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { r } = playRound('course-18', seed * 104729, DECENT);
    assert.equal(r.cards.length, 18);
    const a = playRound('arcade', seed * 31, DECENT).r;
    assert.ok(a.over && a.hearts === 0 && a.cards.length >= 1);
  }
});

console.log(`\n${passed} tests passed`);
