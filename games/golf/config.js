/* Golf tuning. Distances are yards, speeds are yards per second.
   Every number here is a starting point; adjust freely. */
export default {
  /* carry: full-power carry from a clean lie. roll: share of carry the ball
     runs out on fairway. curve: how much a mistimed strike bends this club.
     apex: peak height as a share of carry (drawing only). */
  clubs: [
    { id: 'D', name: 'Driver', carry: 260, roll: 0.09, curve: 1, apex: 0.11, teeOnly: true },
    { id: '3W', name: '3 Wood', carry: 230, roll: 0.07, curve: 0.95, apex: 0.12 },
    { id: '5i', name: '5 Iron', carry: 190, roll: 0.05, curve: 0.9, apex: 0.14 },
    { id: '7i', name: '7 Iron', carry: 160, roll: 0.04, curve: 0.85, apex: 0.16 },
    { id: '9i', name: '9 Iron', carry: 130, roll: 0.03, curve: 0.8, apex: 0.19 },
    { id: 'PW', name: 'Wedge', carry: 110, roll: 0.02, curve: 0.75, apex: 0.22 },
    { id: 'SW', name: 'Sand Wedge', carry: 80, roll: 0.01, curve: 0.7, apex: 0.26 },
    { id: 'P', name: 'Putter', putter: true }
  ],

  /* Max-carry multiplier for the lie the ball sits in. */
  lie: { tee: 1, fairway: 1, green: 1, rough: 0.85, bunker: 0.7 },
  /* Roll multiplier for the surface the ball lands on. */
  rollOn: { fairway: 1, green: 0.6, rough: 0.25, bunker: 0 },

  /* Three-click meter. The needle climbs 0 to 1 in upSecs, then falls back
     through the start line (0) at downPerSec. Tap 3 at the line.
     perfect/good are half-widths of the sweet spot around the line. */
  swing: { upSecs: 1.0, downPerSec: 1.3, bottom: -0.22, perfect: 0.028, good: 0.075, missAcc: -0.3 },

  shot: {
    curveDeg: 80,          // degrees of bend per unit of timing error (times club.curve)
    mishitLoss: 0.9,       // carry lost per unit of timing error outside perfect
    perfectBonus: 0.02     // a perfect strike flies 2% farther
  },

  wind: {
    max: 14,               // strongest wind rolled for a hole (mph)
    carryPerMph: 0.009,    // tailwind adds this share of carry per mph
    driftPerMph: 0.4       // crosswind drift: yards per mph per 100 yards of carry
  },

  putt: {
    maxYds: 28,            // a full putt on a flat green
    exp: 1.6,              // power curve: finer control on short putts
    fillSecs: 1.4,
    decel: 2.2,            // rolling friction on the green
    offGreenDecel: 6,      // and on the fringe or rough
    slopeAccel: 0.12,      // yd/s^2 per percent of slope
    cupR: 0.085,
    captureSpeed: 1.4,     // faster than this and the ball lips out
    gimmeYds: 0.67,        // about two feet
    fringeYds: 4           // putter is offered from the fairway this close to the green
  },

  chipInR: 0.14,           // a full shot rolling this close to the cup drops
  maxScoreMult: 2,         // pick up at double par

  /* Arcade: the strongest possible wind climbs every 9 holes, up to windCap. */
  arcade: { hearts: 3, perHole: 100, birdie: 50, eagle: 150, windPer9: 4, windCap: 30 },

  anim: {
    introSecs: 1.8,
    settleSecs: 1.1,
    holedSecs: 2.2,
    puttSpeed: 1.7         // putt playback runs this much faster than real time
  }
};
