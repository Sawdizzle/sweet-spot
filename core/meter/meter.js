/* Oscillating needle + zone hit detection. The timing core of every game.

   const m = createMeter({
     orientation: 'horizontal',      // 'horizontal' | 'vertical' | 'radial' (for renderers)
     speed: 0.8,                     // sweeps per second (one sweep = 0 to 1 or 1 to 0)
     easing: 'sine',                 // 'linear' | 'sine' (sine slows near the ends)
     mode: 'pingpong',               // 'pingpong' sweeps back and forth, 'fill' runs 0 to 1 once
     zones: [                        // first match wins, so list narrow zones first
       { id: 'perfect', start: 0.47, end: 0.53 },
       { id: 'good',    start: 0.40, end: 0.60 }
     ],
     offset: 0                       // shifts every zone (wind)
   });
   m.start(performance.now());
   m.value(now)   -> 0..1 needle position
   m.stop(now)    -> { value, zoneId, accuracy }
   m.zones()      -> zones after offset, clamped to 0..1 (for drawing)

   Pure logic, no DOM: each game draws the meter its own way.
   Pass event timestamps (e.timeStamp or performance.now()) to stop()
   so input latency from the frame loop does not count against the player. */

export function createMeter(config) {
  let cfg = normalize(config);
  let t0 = 0, running = false, stopped = null;

  function rawPhase(now) {
    const sweeps = Math.max(0, (now - t0) / 1000) * cfg.speed;
    if (cfg.mode === 'fill') return Math.min(1, sweeps);
    const k = sweeps % 2;              // 0..2: up then down
    return k <= 1 ? k : 2 - k;
  }
  const shape = p => cfg.easing === 'sine' ? (1 - Math.cos(Math.PI * p)) / 2 : p;

  return {
    get running() { return running; },
    get config() { return cfg; },
    configure(next) { cfg = normalize({ ...cfg, ...next }); },
    start(now) { t0 = now; running = true; stopped = null; },
    value(now) { return stopped ? stopped.value : running ? shape(rawPhase(now)) : 0; },
    /* For 'fill' meters: true once the needle reaches the end without a tap. */
    expired(now) { return running && cfg.mode === 'fill' && rawPhase(now) >= 1; },
    stop(now) {
      const value = shape(rawPhase(now));
      running = false;
      stopped = judge(cfg, value);
      return stopped;
    },
    zones() { return shifted(cfg); },
    reset() { running = false; stopped = null; }
  };
}

/* Score a needle value against the zones (exported for tests and replays). */
export function judge(config, value) {
  const cfg = normalize(config);
  for (const z of shifted(cfg)) {
    if (value >= z.start && value <= z.end) {
      const half = (z.end - z.start) / 2 || 1e-9;
      const center = z.start + half;
      return { value, zoneId: z.id, accuracy: Math.max(0, 1 - Math.abs(value - center) / half) };
    }
  }
  return { value, zoneId: 'miss', accuracy: 0 };
}

function shifted(cfg) {
  const o = cfg.offset || 0;
  return cfg.zones.map(z => ({ id: z.id, start: clamp01(z.start + o), end: clamp01(z.end + o) }));
}
function normalize(c) {
  return {
    orientation: c.orientation || 'horizontal',
    speed: c.speed > 0 ? c.speed : 1,
    easing: c.easing === 'sine' ? 'sine' : 'linear',
    mode: c.mode === 'fill' ? 'fill' : 'pingpong',
    zones: Array.isArray(c.zones) ? c.zones : [],
    offset: +c.offset || 0
  };
}
const clamp01 = v => Math.max(0, Math.min(1, v));
