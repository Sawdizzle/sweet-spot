/* Field Goal tuning. Every number here is a starting point; adjust freely. */
export default {
  hearts: 3,
  distance: { start: 20, step: 5, max: 60 },

  /* Aim needle. The bar spans this many yards left and right of the
     center of the uprights; posts sit at +/- postHalf. */
  aim: {
    spanYds: 12,
    postHalf: 3.08,          // 18 ft 6 in between uprights
    postThick: 0.22,         // a hit within this of a post is a doink
    perfectFrac: 0.3,        // perfect zone = this share of the opening
    offHashNarrow: 0.9,      // opening multiplier when kicking from a side hash
    speedAt20: 0.7,          // sweeps per second at 20 yards
    speedAt60: 1.35          // and at 60 yards
  },

  /* Power meter fills once from 0 to 1; tap before it tops out. */
  power: {
    fillSecs: 1.15,
    reqAt20: 0.34,           // minimum power that reaches the bar at 20 yards
    reqAt60: 0.78,
    goodBand: 0.2,           // window above the minimum that flies true
    perfectFrom: 0.07,       // perfect band starts this far above the minimum
    perfectTo: 0.13,
    headwindPerMph: 0.006,   // headwind adds to the minimum, tailwind subtracts
    overkickWobble: 0.09     // aim error (in bar units) when blasting past the band
  },

  wind: {
    maxAt20: 6,              // strongest wind rolled at 20 yards (mph)
    maxAt60: 20,
    driftPerMph: 0.11        // yards of drift at the posts per mph of crosswind per 40 yards
  },

  scoring: { perfectBonus: 0.5 }, // both meters perfect: +50% yards

  flightSecs: 1.5,
  resultSecs: 1.4
};
