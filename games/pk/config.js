/* PK Shootout tuning. Every number here is a starting point; adjust freely.
   Goal space: x runs -1 (left post) to 1 (right post), y runs 0 (grass)
   to 1 (underside of the crossbar). */
export default {
  hearts: 3,

  goal: {
    halfWidthM: 3.66,        // real goal: 7.32 m wide
    heightM: 2.44,           // and 2.44 m tall
    post: 0.035,             // a shot within this of a post (x units) hits the woodwork
    bar: 0.045,              // same for the crossbar (y units)
    cornerX: 0.66,           // upper corner box starts this far out from center
    cornerY: 0.64            // and this high up
  },

  /* Horizontal aim needle. The bar covers this much goal space each side
     of center, so the far ends are wide of the posts. */
  aim: {
    span: 1.3,
    speed: 0.72,             // sweeps per second at the start
    speedPerGoal: 0.02,      // added per goal scored
    speedMax: 1.25
  },

  /* Vertical power meter fills once from 0 to 1. Power sets height:
     below `weak` the shot dribbles to the keeper, `bar` puts the ball
     right at the crossbar, more than that sails over. */
  power: {
    fillSecs: 1.1,
    weak: 0.14,
    bar: 0.84
  },

  /* The keeper stands still during the kick but moves before each one.
     He blocks a box `half` wide each side of his center and `reach` tall. */
  keeper: {
    shift: 0.52,             // center lands anywhere in -shift..shift
    half: 0.24,
    reach: 0.9,
    growEvery: 5,            // goals between growth steps
    growStep: 0.035,
    maxHalf: 0.42
  },

  scoring: { goal: 1, corner: 3 },
  woodworkCostsHeart: false, // off the post or bar: no points, no heart lost

  flightSecs: 0.5,
  weakSecs: 1.0,
  resultSecs: 1.5
};
