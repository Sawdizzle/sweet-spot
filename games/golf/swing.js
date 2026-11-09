/* Classic three-click swing meter. Pure timing logic, no DOM.

   Tap 1 start(): the needle climbs from the start line (0) toward full power (1).
   Tap 2 tap():   locks power; the needle turns and falls back toward the line.
   Tap 3 tap():   locks accuracy = needle position when tapped.
                  Above the line (early) is positive: a hook.
                  Below the line (late) is negative: a slice.
   update(now) handles the misses: reaching full power without tap 2 locks
   power at 1, and falling past `bottom` without tap 3 is a big slice. */
export function createSwing(cfg) {
  let phase = 'idle', t0 = 0, tDown = 0, power = 0, acc = 0;
  const upMs = cfg.upSecs * 1000;
  const up = now => Math.min(1, Math.max(0, (now - t0) / upMs));
  const down = now => Math.max(cfg.bottom, power - Math.max(0, now - tDown) / 1000 * cfg.downPerSec);
  return {
    get phase() { return phase; },
    get power() { return power; },
    get acc() { return acc; },
    start(now) { phase = 'up'; t0 = now; power = 0; acc = 0; },
    value(now) {
      if (phase === 'up') return up(now);
      if (phase === 'down') return down(now);
      if (phase === 'done') return acc;
      return 0;
    },
    tap(now) {
      if (phase === 'up') { power = up(now); phase = 'down'; tDown = now; return { stage: 'power', power }; }
      if (phase === 'down') { acc = down(now); phase = 'done'; return { stage: 'impact', power, acc, missed: false }; }
      return null;
    },
    update(now) {
      if (phase === 'up' && now - t0 >= upMs) { power = 1; phase = 'down'; tDown = t0 + upMs; return { stage: 'power', power, auto: true }; }
      if (phase === 'down' && down(now) <= cfg.bottom) { acc = cfg.missAcc; phase = 'done'; return { stage: 'impact', power, acc, missed: true }; }
      return null;
    },
    reset() { phase = 'idle'; }
  };
}
