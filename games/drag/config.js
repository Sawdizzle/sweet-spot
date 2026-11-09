/* Drag Racing tuning. Every number here is a starting point; adjust freely.
   RPM values are fractions of the tach scale: 0 = stopped, 1 = redline. */
export default {
  hearts: 3,
  gears: 5,                    // 4 shifts; the last gear runs to the finish

  /* Christmas tree. Times are ms from the moment the car stages. */
  tree: {
    stageMs: 450,              // stage bulb lights
    firstAmberMs: 1100,        // taps before this are ignored, taps after it and before green are red lights
    amberGapMs: 500,           // amber, amber, amber
    greenMinMs: 350,           // green comes this long after the third amber (seeded per run)
    greenMaxMs: 1300,
    timeoutMs: 4000            // no launch this long after green counts as a fault
  },

  /* Revving on the line: the needle sweeps up and down until launch. */
  rev: { lo: 0.18, hi: 0.96, speedMin: 0.6, speedMax: 0.9 },   // sweeps per second

  launch: {
    center: 0.62, centerJitter: 0.08,      // launch band center, +/- half the jitter per run
    widthMin: 0.12, widthMax: 0.17,
    perfectHalf: 0.022,
    perfectBoostMs: 15,
    goodMaxMs: 40,             // in the band but off center costs up to this
    bogBaseMs: 110, bogPerRpm: 1100,       // too low
    spinBaseMs: 140, spinPerRpm: 1300,     // too high: wheelspin
    maxMs: 650,
    spinShowMs: 700            // how long the tires smoke on a wheelspin launch
  },

  shift: {
    rpmIn: [0.38, 0.55, 0.6, 0.64, 0.68],  // needle drops to this when each gear starts
    riseMs: [1300, 2000, 2700, 3400],       // time to climb to redline in gears 1 to 4
    bandScale: [1, 0.8, 0.65, 0.55],        // higher gears climb slower, so their bands are narrower
    riseJitter: 0.18,          // each gear's climb varies by up to this share per run
    easePow: 1.35,             // climb slows a little near the top
    center: 0.86, centerJitter: 0.05,
    widthMin: 0.07, widthMax: 0.11,
    perfectHalf: 0.016,      // scaled by bandScale too
    perfectBoostMs: 30,
    goodMaxMs: 45,
    earlyBaseMs: 70, earlyPerRpm: 1600, earlyMaxMs: 500,
    lateBaseMs: 50, latePerMs: 0.5, lateMaxMs: 450,
    blowMs: 420,               // time on the limiter before the engine lets go
    blowGraceMs: 30,           // extra slack so a tap in the same frame still counts
    lockoutMs: 160,            // ignore taps this soon after a shift (double tap guard)
    topRiseMs: 3600, topCap: 0.9
  },

  race: {
    distanceFt: 1320,
    baseEtMs: 9000,            // a run with no losses and no boosts, launch to finish
    baseTrapMph: 148,
    stepMs: 2,                 // fixed sim step, shared by live runs and ghost replays
    payRate: 0.45,             // while losing time the car runs at (1 - payRate) speed
    boostRate: 0.3,            // while boosted it runs at (1 + boostRate) speed
    trapExp: 1.2,
    coastDecel: 9              // m/s^2 after the finish line
  },

  /* Built-in ghost when there is no leader or the board is offline.
     r: reaction ms, l: launch loss ms, s: [ms after launch, loss ms] per shift. */
  house: { name: 'House car', r: 320, l: 120, s: [[900, 90], [2100, 110], [3600, 130], [5350, 100]] },

  resultSecs: 2.6,
  tapAfterResultMs: 800        // a tap can skip the result screen after this long
};
