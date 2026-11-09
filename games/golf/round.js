/* A round of golf: hole order, strokes, penalties, hearts, scorecard.
   Pure state, no DOM, so a whole round can be simulated in Node.

   const r = createRound({ mode: 'course-9' | 'arcade', rng });
   r.startHole()                       tee up the next hole, roll its wind
   r.plan()                            caddie's club and aim for the current ball
   r.hit({ club, heading, power, acc }) play a stroke; returns the shot result
                                        with .outcome { penalty, gimme, holed, pickedUp, done }
   r.endHole()                         score the finished hole; may end the round
   r.summary()                         { score, meta, stats } for the game-over card */
import C from './config.js';
import { HOLES } from './holes.js';
import { dist } from './geo.js';
import { lieAt, rollWind, shotResult, puttResult, plan, scoreName, arcadePoints } from './golf.js';

export function createRound({ mode, rng, holes = HOLES }) {
  const arcade = mode === 'arcade';
  const count = arcade ? Infinity : Math.min(holes.length, parseInt(String(mode).split('-')[1], 10) || 9);
  const R = {
    arcade, count, holes,
    idx: -1, holeNo: 0, hole: null, ball: null, lie: 'tee', strokes: 0, wind: { mph: 0, deg: 0 },
    holed: false, done: false, over: false,
    cards: [], hearts: C.arcade.hearts, birdies: 0, eagles: 0, shots: [],

    startHole() {
      R.idx++; R.holeNo++;
      R.hole = holes[R.idx % holes.length];
      R.ball = { ...R.hole.tee }; R.lie = 'tee';
      R.strokes = 0; R.holed = false; R.done = false; R.shots = [];
      R.wind = rollWind(rng, arcade
        ? Math.min(C.arcade.windCap, C.wind.max + C.arcade.windPer9 * Math.floor(R.idx / 9))
        : C.wind.max);
      return R.hole;
    },

    plan() { return plan(R.hole, R.ball, R.lie, R.wind); },

    hit({ club, heading, power, acc = 0 }) {
      if (R.done) return null;
      const hole = R.hole, from = { ...R.ball }, fromLie = R.lie;
      const res = club.putter
        ? puttResult(hole, from, heading, power)
        : shotResult(hole, from, fromLie, club, heading, power, acc, R.wind);
      R.strokes++;
      const out = { penalty: 0, gimme: false, holed: false, pickedUp: false, done: false, fromLie };
      if (res.event === 'holed') {
        out.holed = true; R.ball = { ...hole.pin }; R.lie = 'green';
      } else if (res.event === 'water') {
        out.penalty = 1;
        if (res.drop) { R.ball = res.drop; R.lie = lieAt(hole, res.drop); }
        else { R.ball = from; R.lie = fromLie; }
      } else if (res.event === 'ob') {
        out.penalty = 1; R.ball = from; R.lie = fromLie;
      } else {
        R.ball = res.rest; R.lie = res.lie;
        if (dist(res.rest, hole.pin) <= C.putt.gimmeYds) { out.gimme = true; out.holed = true; R.strokes++; R.ball = { ...hole.pin }; }
      }
      R.strokes += out.penalty;
      const cap = hole.par * C.maxScoreMult;
      if (!out.holed && R.strokes >= cap) out.pickedUp = true;
      if (out.holed || out.pickedUp) { R.strokes = Math.min(R.strokes, cap); out.done = true; R.done = true; R.holed = out.holed; }
      res.outcome = out;
      R.shots.push(res);
      return res;
    },

    endHole() {
      const hole = R.hole, diff = R.strokes - hole.par;
      R.cards.push({ n: hole.n, par: hole.par, strokes: R.strokes, pickedUp: !R.holed });
      if (diff === -1) R.birdies++;
      if (diff <= -2) R.eagles++;
      let heartLost = false;
      if (arcade) {
        if (diff >= 1) { R.hearts--; heartLost = true; }
        if (R.hearts <= 0) R.over = true;
      } else if (R.cards.length >= count) R.over = true;
      return { diff, name: R.holed ? scoreName(R.strokes, hole.par) : 'Picked up', heartLost, strokes: R.strokes, par: hole.par };
    },

    get totalStrokes() { return R.cards.reduce((s, c) => s + c.strokes, 0); },
    get totalPar() { return R.cards.reduce((s, c) => s + c.par, 0); },
    get toPar() { return R.totalStrokes - R.totalPar; },
    get points() { return arcadePoints({ holes: R.cards.length, birdies: R.birdies, eagles: R.eagles }); },

    summary() {
      const holes = R.cards.length;
      const pars = R.cards.filter(c => c.strokes === c.par).length;
      const over = R.cards.filter(c => c.strokes > c.par).length;
      if (arcade) {
        return {
          score: R.points,
          meta: { holes, birdies: R.birdies, eagles: R.eagles },
          stats: [['Holes', holes], ['Birdies', R.birdies], ['Eagles', R.eagles], ['Pars', pars]]
        };
      }
      return {
        score: R.toPar,
        meta: { strokes: R.totalStrokes, par: R.totalPar, holes, birdies: R.birdies, eagles: R.eagles },
        stats: [['Strokes', R.totalStrokes], ['Under par', R.birdies + R.eagles], ['Pars', pars], ['Over par', over]]
      };
    }
  };
  return R;
}
