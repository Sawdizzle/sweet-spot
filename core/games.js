/* The game catalog: one entry per game, used by the landing page and shells. */
export const toPar = v => v === 0 ? 'E' : (v > 0 ? '+' + v : String(v));
export const secs = ms => (ms / 1000).toFixed(3) + ' s';

export const GAMES = [
  {
    id: 'baseball', name: 'Baseball', path: '/baseball', board: 'classic',
    blurb: 'Batting practice under the lights. Time the swing as the pitch crosses the plate.',
    window: 'the swing timing window', fmt: v => v.toLocaleString()
  },
  {
    id: 'fieldgoal', name: 'Field Goal', path: '/fieldgoal', board: 'classic',
    blurb: 'Lock the aim needle, then the power meter. Wind moves the target, and every make backs you up five yards.',
    window: 'aim needle and power meter', fmt: v => v.toLocaleString() + ' yds'
  },
  {
    id: 'pk', name: 'PK Shootout', path: '/pk', board: 'classic',
    blurb: 'Pick a spot the keeper can’t reach. Upper corners pay triple, but the window is tight.',
    window: 'aim and power against a set keeper', fmt: v => v.toLocaleString() + ' pts'
  },
  {
    id: 'hockey', name: 'Hockey Shootout', path: '/hockey', board: 'classic',
    blurb: 'Skate in and pick your spot. Top shelf pays triple and the five-hole pays double, if the goalie leaves it open.',
    window: 'aim and power against a set goalie', fmt: v => v.toLocaleString() + ' pts'
  },
  {
    id: 'golf', name: 'Golf', path: '/golf', board: 'course-9',
    blurb: 'Three-click swing on Sweet Spot National. Play 3 to 18 holes, or arcade until the hearts run out.',
    window: 'the three-click swing meter', fmt: toPar
  },
  {
    id: 'drag', name: 'Drag Racing', path: '/drag', board: 'classic',
    blurb: 'Launch on green, shift in the band, never touch redline. Race the leader’s ghost down the quarter mile.',
    window: 'launch and shift points on the tach', fmt: secs
  }
];
