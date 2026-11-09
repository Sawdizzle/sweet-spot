/* Hockey Shootout tuning. Every number here is a starting point; adjust freely.
   Goal space: x runs -1 (left post) to 1 (right post), y runs 0 (the ice)
   to 1 (underside of the crossbar). A hockey net is 6 ft wide and 4 ft tall,
   so one x unit is 3 ft and one y unit is 4 ft. */
export default {
  hearts: 3,

  goal: {
    halfWidthM: 0.915,       // 1.83 m wide
    heightM: 1.22,           // 1.22 m tall
    lineZ: 9,                // meters from the release point to the goal line
    post: 0.04,              // a shot within this of a post (x units) rings the iron
    bar: 0.045,              // same for the crossbar (y units)
    cornerX: 0.64,           // top shelf box starts this far out from center
    cornerY: 0.72            // and this high up
  },

  /* Horizontal aim needle. The bar covers this much goal space each side
     of center, so the far ends are wide of the posts. */
  aim: {
    span: 1.3,
    speed: 0.74,             // sweeps per second at the start
    speedPerGoal: 0.02,      // added per goal scored
    speedMax: 1.25
  },

  /* Vertical power meter fills once from 0 to 1. Power sets height:
     below `ice` the puck stays flat on the ice, `bar` puts it right at the
     crossbar, more than that goes over the net and off the glass. */
  power: {
    fillSecs: 1.1,
    ice: 0.12,
    bar: 0.82
  },

  /* The goalie drops into a butterfly before each shot and holds it.
     Coverage is a stack of bands measured from his center x:
       pads   y 0..padTop        wide, flat on the ice
       body   padTop..bodyTop    chest, blocker and glove
       head   bodyTop..headTop   shoulders and mask
     Above headTop nothing is covered. When the five-hole is open, a gap
     fiveHalf wide and fiveTop tall opens between the pads. Widths grow by
     growStep (as a scale) every growEvery goals, up to maxScale. */
  goalie: {
    shift: 0.42,             // center lands anywhere in -shift..shift
    padHalf: 0.55, padTop: 0.32,
    bodyHalf: 0.34, bodyTop: 0.70,
    headHalf: 0.16, headTop: 0.86,
    fiveHalf: 0.085, fiveTop: 0.2,
    fiveOpenChance: 0.5,
    growEvery: 5,
    growStep: 0.07,
    maxScale: 1.42
  },

  scoring: { goal: 1, fiveHole: 2, topShelf: 3 },
  ironCostsHeart: false,     // off the post or bar: no points, no heart lost

  flightSecs: 0.36,
  resultSecs: 1.5
};
