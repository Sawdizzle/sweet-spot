/* Animated card scenes for the landing page. Each returns an SVG string
   (viewBox 400x225) that loops one "moment" of its game with SMIL, so the
   whole timeline stays in sync and can be paused with svg.pauseAnimations().
   All art is original and drawn here. */

const crowd = (id, y, h, cols = ['#ffb547', '#f1ece0', '#d23a2e', '#7fc6ff', '#8fe0a0']) =>
  `<pattern id="${id}-crowd" width="9" height="8" patternUnits="userSpaceOnUse">
     <rect width="9" height="8" fill="#0c1712"/>
     <circle cx="2.5" cy="3" r="1.6" fill="${cols[0]}" opacity=".55"/>
     <circle cx="7" cy="5.5" r="1.6" fill="${cols[2]}" opacity=".5"/>
     <circle cx="4.5" cy="7" r="1.2" fill="${cols[1]}" opacity=".35"/>
   </pattern>
   <rect x="0" y="${y}" width="400" height="${h}" fill="url(#${id}-crowd)"/>`;

const flashes = (pts, D) => pts.map(([x, y, t]) =>
  `<circle cx="${x}" cy="${y}" r="2.2" fill="#fff" opacity="0">
     <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${t};${t + 0.01};${t + 0.06};1" dur="${D}s" repeatCount="indefinite"/>
   </circle>`).join('');

const tower = (x, y) =>
  `<g><rect x="${x - 1.5}" y="${y}" width="3" height="60" fill="#0a120e"/>
   <rect x="${x - 14}" y="${y - 6}" width="28" height="10" rx="2" fill="#fff8e0"/>
   <circle cx="${x}" cy="${y}" r="38" fill="url(#lightGlow)" opacity=".55">
     <animate attributeName="opacity" values=".5;.65;.5" dur="3.7s" repeatCount="indefinite"/>
   </circle></g>`;

const sharedDefs = `<radialGradient id="lightGlow"><stop offset="0" stop-color="#fff3cf" stop-opacity=".9"/><stop offset="1" stop-color="#fff3cf" stop-opacity="0"/></radialGradient>`;

export const SCENES = {
  /* Pitch comes in, swing, ball carries over the wall, fireworks. */
  baseball() {
    const D = 3.4;
    return `<defs>${sharedDefs}
      <linearGradient id="bb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050b08"/><stop offset="1" stop-color="#14301f"/></linearGradient>
      <radialGradient id="bb-grass" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#2f7a49"/><stop offset="1" stop-color="#173f28"/></radialGradient>
    </defs>
    <rect width="400" height="225" fill="url(#bb-sky)"/>
    ${tower(48, 18)}${tower(352, 18)}
    ${crowd('bb', 58, 34)}
    ${flashes([[60, 70, .78], [140, 64, .8], [250, 80, .83], [330, 66, .86], [190, 72, .9]], D)}
    <path d="M0 96 Q200 70 400 96 V225 H0 Z" fill="url(#bb-grass)"/>
    <path d="M0 96 Q200 70 400 96" stroke="#ffb547" stroke-width="3" fill="none"/>
    <path d="M40 140 Q200 100 360 140 M10 175 Q200 125 390 175" stroke="#fff" stroke-opacity=".05" stroke-width="16" fill="none"/>
    <path d="M200 112 L282 176 L200 236 L118 176 Z" fill="#b9653b"/>
    <path d="M200 130 L258 176 L200 220 L142 176 Z" fill="#2c7144"/>
    <path d="M200 236 L40 96 M200 236 L360 96" stroke="#f1ece0" stroke-opacity=".7" stroke-width="2"/>
    <ellipse cx="200" cy="150" rx="13" ry="6" fill="#c17447"/>
    <g fill="#e6e1d6"><rect x="196" y="133" width="8" height="13" rx="3"/><circle cx="200" cy="130" r="3.5"/></g>
    <path d="M194 207 h12 v5 l-6 4 l-6 -4 z" fill="#f1ece0"/>
    <g>
      <rect x="160" y="186" width="13" height="24" rx="4" fill="#3d6f9f"/>
      <circle cx="166" cy="182" r="6" fill="#1d2f4a"/>
      <g>
        <rect x="170" y="186" width="34" height="4" rx="2" fill="#d9b98a"/>
        <animateTransform attributeName="transform" type="rotate" values="-70 172 188;-70 172 188;25 172 188;25 172 188;-70 172 188" keyTimes="0;.36;.44;.9;1" dur="${D}s" repeatCount="indefinite"/>
      </g>
    </g>
    <path d="M200 205 Q250 90 300 52" stroke="#ffb547" stroke-width="2" stroke-dasharray="4 6" fill="none" opacity="0">
      <animate attributeName="opacity" values="0;0;.9;.9;0" keyTimes="0;.42;.45;.85;1" dur="${D}s" repeatCount="indefinite"/>
    </path>
    <circle r="4" fill="#fff">
      <animateMotion dur="${D}s" repeatCount="indefinite" path="M200 140 L200 202 Q250 90 300 52" keyPoints="0;0;.26;1;1" keyTimes="0;.28;.42;.82;1" calcMode="linear"/>
      <animate attributeName="r" values="3;3;4.5;1.6;1.6" keyTimes="0;.28;.42;.82;1" dur="${D}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;1;1;0;0" keyTimes="0;.28;.42;.81;.83;1" dur="${D}s" repeatCount="indefinite"/>
    </circle>
    <g transform="translate(300 52)">
      ${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<line x1="0" y1="0" x2="${(Math.cos(a * Math.PI / 180) * 22).toFixed(1)}" y2="${(Math.sin(a * Math.PI / 180) * 22).toFixed(1)}" stroke="${a % 90 ? '#ffb547' : '#ff7a59'}" stroke-width="2.5" stroke-linecap="round" opacity="0" stroke-dasharray="22" stroke-dashoffset="22">
        <animate attributeName="opacity" values="0;0;1;0" keyTimes="0;.82;.86;1" dur="${D}s" repeatCount="indefinite"/>
        <animate attributeName="stroke-dashoffset" values="22;22;0;0" keyTimes="0;.82;.9;1" dur="${D}s" repeatCount="indefinite"/>
      </line>`).join('')}
    </g>`;
  },

  /* Ball tumbles end over end through the uprights; flashes and confetti. */
  fieldgoal() {
    const D = 3.2;
    const lines = [0, 1, 2, 3, 4, 5].map(i => {
      const y = 132 + i * i * 3.4 + i * 7;
      return `<path d="M0 ${y} H400" stroke="#f1ece0" stroke-opacity="${(.18 + i * .07).toFixed(2)}" stroke-width="${1 + i * .4}"/>`;
    }).join('');
    const confetti = Array.from({ length: 16 }, (_, i) => {
      const x = 120 + (i * 37) % 170, c = ['#ffd34d', '#d23a2e', '#f1ece0', '#7fc6ff'][i % 4], d = (i % 5) * .02;
      return `<rect x="${x}" y="40" width="4" height="7" fill="${c}" opacity="0">
        <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;${.62 + d};${.64 + d};.95;1" dur="${D}s" repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${(i % 2 ? 1 : -1) * 12} 90" keyTimes="0;${.62 + d};1" dur="${D}s" repeatCount="indefinite"/>
      </rect>`;
    }).join('');
    return `<defs>${sharedDefs}
      <linearGradient id="fg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04080b"/><stop offset="1" stop-color="#16243a"/></linearGradient>
      <linearGradient id="fg-turf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c4a30"/><stop offset="1" stop-color="#2f7a49"/></linearGradient>
      <linearGradient id="fg-post" x1="0" x2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#d6a91f"/></linearGradient>
    </defs>
    <rect width="400" height="225" fill="url(#fg-sky)"/>
    ${tower(40, 16)}${tower(360, 16)}
    <path d="M0 60 Q200 30 400 60 V122 H0 Z" fill="#0c1712"/>
    <clipPath id="fg-bowl"><path d="M0 62 Q200 34 400 62 V120 H0 Z"/></clipPath>
    <g clip-path="url(#fg-bowl)">${crowd('fg', 30, 92, ['#ffd34d', '#f1ece0', '#b0352c'])}</g>
    <rect x="0" y="112" width="400" height="9" fill="#b0352c"/>
    <text x="200" y="119.5" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-weight="900" font-size="8" fill="#f1ece0" letter-spacing="3">SWEET SPOT · FIELD GOAL · SWEET SPOT · FIELD GOAL</text>
    ${flashes([[50, 80, .55], [110, 66, .6], [170, 90, .66], [240, 70, .7], [300, 84, .74], [360, 72, .78]], D)}
    <rect x="0" y="121" width="400" height="104" fill="url(#fg-turf)"/>
    ${lines}
    <path d="M140 225 L190 121 M260 225 L210 121" stroke="#f1ece0" stroke-opacity=".12" stroke-width="2"/>
    <rect x="160" y="34" width="80" height="70" fill="none" stroke="#f1ece0" stroke-opacity=".18"/>
    <path d="M200 124 V108 Q200 100 200 98" stroke="url(#fg-post)" stroke-width="5" fill="none"/>
    <rect x="196" y="112" width="8" height="12" rx="2" fill="#b0352c"/>
    <path d="M168 98 H232 M168 98 V30 M232 98 V30" stroke="url(#fg-post)" stroke-width="4.5" stroke-linecap="round" fill="none"/>
    ${[168, 232].map(x => `<path d="M${x} 30 q8 2 14 8" stroke="#d23a2e" stroke-width="3" fill="none" stroke-linecap="round"><animateTransform attributeName="transform" type="skewX" values="0;8;-4;0" dur="1.6s" repeatCount="indefinite"/></path>`).join('')}
    <g>
      <ellipse cx="0" cy="0" rx="7" ry="11" fill="#8a4a24"/>
      <path d="M0 -6 V6 M-2.5 -3 H2.5 M-2.5 0 H2.5 M-2.5 3 H2.5" stroke="#fff" stroke-width="1" />
      <animateMotion dur="${D}s" repeatCount="indefinite" path="M200 214 Q196 40 200 66" keyPoints="0;0;1;1" keyTimes="0;.12;.6;1" calcMode="linear"/>
      <animateTransform attributeName="transform" type="scale" values="1.4;1.4;.5;.45;.45" keyTimes="0;.12;.6;.62;1" dur="${D}s" repeatCount="indefinite" additive="sum"/>
      <animateTransform attributeName="transform" type="rotate" values="0;0;1080;1080" keyTimes="0;.12;.6;1" dur="${D}s" repeatCount="indefinite" additive="sum"/>
    </g>
    ${confetti}
    <text x="200" y="168" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-weight="900" font-size="26" fill="#ffd34d" opacity="0">IT'S GOOD
      <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.6;.64;.9;1" dur="${D}s" repeatCount="indefinite"/>
    </text>`;
  },

  /* Keeper dives the wrong way, ball into the top corner, net ripples. */
  pk() {
    const D = 3.2;
    return `<defs>${sharedDefs}
      <linearGradient id="pk-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050a10"/><stop offset="1" stop-color="#132a22"/></linearGradient>
      <pattern id="pk-net" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0 L8 8 M8 0 L0 8" stroke="#f1ece0" stroke-opacity=".28" stroke-width=".7"/></pattern>
    </defs>
    <rect width="400" height="225" fill="url(#pk-sky)"/>
    ${tower(30, 14)}${tower(370, 14)}
    ${crowd('pk', 34, 52)}
    ${flashes([[70, 50, .5], [150, 44, .56], [270, 60, .6], [330, 46, .66]], D)}
    <rect x="0" y="86" width="400" height="139" fill="#22603b"/>
    ${[0, 1, 2, 3].map(i => `<rect x="0" y="${100 + i * 34}" width="400" height="17" fill="#2a6d44"/>`).join('')}
    <path d="M60 225 L120 160 H280 L340 225" stroke="#f1ece0" stroke-opacity=".5" stroke-width="2" fill="none"/>
    <rect x="96" y="58" width="208" height="88" fill="url(#pk-net)"/>
    <rect x="96" y="58" width="208" height="88" fill="none" stroke="#f1ece0" stroke-width="5"/>
    <circle cx="282" cy="74" r="0" fill="none" stroke="#f1ece0" stroke-width="2" opacity="0">
      <animate attributeName="r" values="0;0;26" keyTimes="0;.56;.8" dur="${D}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0;.8;0;0" keyTimes="0;.56;.58;.8;1" dur="${D}s" repeatCount="indefinite"/>
    </circle>
    <g>
      <g>
        <rect x="-9" y="-22" width="18" height="26" rx="5" fill="#ffb547"/>
        <circle cx="0" cy="-28" r="6" fill="#e9c08f"/>
        <rect x="-22" y="-20" width="13" height="5" rx="2.5" fill="#ffb547"/>
        <rect x="9" y="-20" width="13" height="5" rx="2.5" fill="#ffb547"/>
        <rect x="-8" y="4" width="6" height="16" rx="3" fill="#1b1b1f"/><rect x="2" y="4" width="6" height="16" rx="3" fill="#1b1b1f"/>
      </g>
      <animateTransform attributeName="transform" type="translate" values="200 124;200 124;150 124;150 124;200 124" keyTimes="0;.3;.5;.92;1" dur="${D}s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="rotate" values="0;0;-70;-70;0" keyTimes="0;.3;.5;.92;1" dur="${D}s" repeatCount="indefinite" additive="sum"/>
    </g>
    <g>
      <circle r="8" fill="#f1ece0"/>
      <path d="M-3 -2 l3 -3 l3 3 l-1 4 h-4 z" fill="#1b1b1f"/>
      <animateMotion dur="${D}s" repeatCount="indefinite" path="M200 206 Q250 120 282 74" keyPoints="0;0;1;1" keyTimes="0;.28;.56;1" calcMode="linear"/>
      <animateTransform attributeName="transform" type="scale" values="1.3;1.3;.65;.65" keyTimes="0;.28;.56;1" dur="${D}s" repeatCount="indefinite" additive="sum"/>
    </g>
    <g>
      <rect x="150" y="186" width="16" height="30" rx="5" fill="#b0352c"/>
      <circle cx="158" cy="180" r="7" fill="#7a4a2c"/>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;14 -4;14 -4;0 0" keyTimes="0;.18;.28;.9;1" dur="${D}s" repeatCount="indefinite"/>
    </g>
    <text x="200" y="40" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-weight="900" font-size="20" fill="#8fe0a0" opacity="0">TOP CORNER +3
      <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.56;.6;.9;1" dur="${D}s" repeatCount="indefinite"/>
    </text>`;
  },

  /* Snipe top shelf over a butterfly goalie; goal light and horn glow. */
  hockey() {
    const D = 3.2;
    return `<defs>${sharedDefs}
      <linearGradient id="hk-ice" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe2ea"/><stop offset="1" stop-color="#f2f8fb"/></linearGradient>
      <linearGradient id="hk-glass" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <pattern id="hk-net" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 0 L7 7 M7 0 L0 7" stroke="#9aa7ad" stroke-opacity=".7" stroke-width=".7"/></pattern>
    </defs>
    <rect width="400" height="225" fill="#0b1420"/>
    ${crowd('hk', 0, 70, ['#d23a2e', '#f1ece0', '#2f55c9'])}
    <rect x="0" y="0" width="400" height="70" fill="url(#hk-glass)">
      <animate attributeName="x" values="-300;400" dur="4.5s" repeatCount="indefinite"/>
    </rect>
    <rect x="0" y="70" width="400" height="22" fill="#f4f6f7"/>
    <rect x="0" y="88" width="400" height="5" fill="#ffb547"/>
    <rect x="0" y="93" width="400" height="132" fill="url(#hk-ice)"/>
    <path d="M30 190 Q120 175 210 196 M250 214 Q330 200 390 210" stroke="#a9c3cf" stroke-opacity=".6" fill="none"/>
    <path d="M0 160 H400" stroke="#d23a2e" stroke-width="3" opacity=".85"/>
    <path d="M140 160 A60 22 0 0 1 260 160 Z" fill="#6fa8dc" opacity=".55"/>
    <rect x="148" y="104" width="104" height="56" fill="url(#hk-net)"/>
    <path d="M148 160 V104 H252 V160" fill="none" stroke="#d23a2e" stroke-width="5"/>
    <circle cx="200" cy="96" r="5" fill="#5a1410">
      <animate attributeName="fill" values="#5a1410;#5a1410;#ff3b30;#5a1410;#ff3b30;#5a1410" keyTimes="0;.55;.6;.7;.8;1" dur="${D}s" repeatCount="indefinite"/>
    </circle>
    <circle cx="200" cy="96" r="30" fill="#ff3b30" opacity="0">
      <animate attributeName="opacity" values="0;0;.35;0;.3;0" keyTimes="0;.55;.6;.7;.8;1" dur="${D}s" repeatCount="indefinite"/>
    </circle>
    <g>
      <path d="M-34 0 L-8 -14 L-4 2 Z" fill="#f1ece0" stroke="#2b4a8f" stroke-width="2"/>
      <path d="M34 0 L8 -14 L4 2 Z" fill="#f1ece0" stroke="#2b4a8f" stroke-width="2"/>
      <rect x="-12" y="-38" width="24" height="26" rx="7" fill="#2b4a8f"/>
      <circle cx="0" cy="-44" r="8" fill="#f1ece0"/><path d="M-4 -46 h8 M-4 -43 h8 M-4 -40 h8" stroke="#555" stroke-width=".9"/>
      <rect x="-24" y="-34" width="11" height="13" rx="3" fill="#f1ece0"/>
      <circle cx="19" cy="-30" r="7" fill="#f1ece0"/>
      <animateTransform attributeName="transform" type="translate" values="200 158;200 158;188 158;188 158;200 158" keyTimes="0;.3;.45;.9;1" dur="${D}s" repeatCount="indefinite"/>
    </g>
    <ellipse rx="6" ry="2.6" fill="#111">
      <animateMotion dur="${D}s" repeatCount="indefinite" path="M120 214 Q170 200 210 196 Q236 150 240 112" keyPoints="0;0;.5;1;1" keyTimes="0;.1;.42;.56;1" calcMode="linear"/>
    </ellipse>
    ${[0, 1, 2, 3, 4].map(i => `<circle cx="${206 + i * 3}" cy="${198 - i}" r="1.6" fill="#fff" opacity="0">
      <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;.42;.44;.56;1" dur="${D}s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${-6 + i * 3} -10" keyTimes="0;.42;.56" dur="${D}s" repeatCount="indefinite"/>
    </circle>`).join('')}
    <g>
      <rect x="96" y="160" width="20" height="34" rx="6" fill="#b0352c"/>
      <rect x="96" y="172" width="20" height="4" fill="#f1ece0"/>
      <circle cx="106" cy="154" r="8" fill="#1d2f4a"/>
      <path d="M112 186 L150 216 h10" stroke="#3a2a1a" stroke-width="3" fill="none" stroke-linecap="round"/>
      <animateTransform attributeName="transform" type="translate" values="0 0;40 8;54 10;54 10;0 0" keyTimes="0;.3;.42;.9;1" dur="${D}s" repeatCount="indefinite"/>
    </g>
    <text x="200" y="40" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-weight="900" font-size="22" fill="#ff5a4f" opacity="0">TOP SHELF +3
      <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.56;.6;.9;1" dur="${D}s" repeatCount="indefinite"/>
    </text>`;
  },

  /* Approach shot lands on the green, checks up and drops in the cup. */
  golf() {
    const D = 4;
    return `<defs>${sharedDefs}
      <linearGradient id="gf-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1430"/><stop offset=".6" stop-color="#b05a3a"/><stop offset="1" stop-color="#e9a25a"/></linearGradient>
      <radialGradient id="gf-green" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#5fb36f"/><stop offset="1" stop-color="#3f8a57"/></radialGradient>
      <linearGradient id="gf-water" x1="0" x2="1"><stop offset="0" stop-color="#2a5e86"/><stop offset=".5" stop-color="#4f8fbf"/><stop offset="1" stop-color="#2a5e86"/></linearGradient>
    </defs>
    <rect width="400" height="225" fill="url(#gf-sky)"/>
    <circle cx="320" cy="62" r="20" fill="#ffd38a" opacity=".85"/>
    <path d="M0 78 Q60 62 120 74 T240 70 T400 76 V225 H0 Z" fill="#163a26"/>
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="${i * 30 + 8}" cy="${74 - (i % 3) * 4}" r="${9 + (i % 4) * 2}" fill="#0f2a1b"/>`).join('')}
    <path d="M0 225 C40 170 120 150 180 140 S330 110 400 118 V225 Z" fill="#2c6b45"/>
    <path d="M30 225 C80 180 150 160 210 150 S330 128 400 132" stroke="#3a8556" stroke-width="34" fill="none" opacity=".75"/>
    <path d="M60 170 Q90 150 130 160 Q120 178 80 182 Z" fill="url(#gf-water)">
      <animate attributeName="d" values="M60 170 Q90 150 130 160 Q120 178 80 182 Z;M60 171 Q92 151 130 161 Q118 178 80 181 Z;M60 170 Q90 150 130 160 Q120 178 80 182 Z" dur="3s" repeatCount="indefinite"/>
    </path>
    <ellipse cx="300" cy="118" rx="58" ry="20" fill="url(#gf-green)"/>
    <ellipse cx="248" cy="132" rx="16" ry="6" fill="#d9c68f"/>
    <ellipse cx="350" cy="108" rx="12" ry="5" fill="#d9c68f"/>
    <ellipse cx="312" cy="118" rx="3.2" ry="1.6" fill="#0d1b12"/>
    <line x1="312" y1="118" x2="312" y2="80" stroke="#f1ece0" stroke-width="1.6"/>
    <path d="M312 80 l16 4 l-16 5 z" fill="#d23a2e"><animateTransform attributeName="transform" type="skewY" values="0;6;-3;0" dur="1.4s" repeatCount="indefinite"/></path>
    <path d="M70 214 Q180 0 288 116" stroke="#ffb547" stroke-width="1.8" stroke-dasharray="3 5" fill="none" opacity="0">
      <animate attributeName="opacity" values="0;0;.8;.8;0" keyTimes="0;.1;.14;.75;1" dur="${D}s" repeatCount="indefinite"/>
    </path>
    <ellipse rx="3" ry="1.2" fill="#000" opacity=".35">
      <animateMotion dur="${D}s" repeatCount="indefinite" path="M70 214 L288 118 L312 118" keyPoints="0;0;.9;1;1" keyTimes="0;.12;.55;.72;1" calcMode="linear"/>
    </ellipse>
    <circle r="3" fill="#fff">
      <animateMotion dur="${D}s" repeatCount="indefinite" path="M70 212 Q180 0 288 116 L312 117" keyPoints="0;0;.9;1;1" keyTimes="0;.12;.55;.72;1" calcMode="linear"/>
      <animate attributeName="r" values="2.5;2.5;5;3;2;0;0" keyTimes="0;.12;.33;.55;.71;.74;1" dur="${D}s" repeatCount="indefinite"/>
    </circle>
    <g fill="#e6e1d6">
      <rect x="54" y="190" width="10" height="22" rx="4" fill="#3d6f9f"/>
      <circle cx="59" cy="186" r="5"/>
      <path d="M62 196 L74 212" stroke="#c9c0ae" stroke-width="2"><animateTransform attributeName="transform" type="rotate" values="-80 62 196;-80 62 196;40 62 196;40 62 196" keyTimes="0;.08;.13;1" dur="${D}s" repeatCount="indefinite"/></path>
    </g>
    <text x="312" y="160" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-weight="900" font-size="20" fill="#f1ece0" opacity="0">BIRDIE
      <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.72;.76;.94;1" dur="${D}s" repeatCount="indefinite"/>
    </text>`;
  },

  /* Tree drops, both cars launch with smoke and flames, you take the win light. */
  drag() {
    const D = 3.6;
    const bulb = (y, c, t0, t1) => `<circle cx="0" cy="${y}" r="4.2" fill="#2a2a2a">
      <animate attributeName="fill" values="#2a2a2a;#2a2a2a;${c};${c};#2a2a2a" keyTimes="0;${t0};${t0 + .01};${t1};1" dur="${D}s" repeatCount="indefinite"/></circle>`;
    const car = (y, body, ghost, endX, t) => `<g opacity="${ghost ? .55 : 1}">
      <g>
        <path d="M0 0 h18 l10 -9 h26 l8 9 h20 l4 8 h-86 z" fill="${body}"/>
        <path d="M30 -8 h20 l5 7 h-30 z" fill="#9fd4ff" opacity=".7"/>
        <path d="M-4 -12 h10 v4 h-10 z M0 -8 v8" stroke="#111" stroke-width="2" fill="#111"/>
        <circle cx="12" cy="9" r="7" fill="#111"/><circle cx="12" cy="9" r="3" fill="#888"/>
        <circle cx="70" cy="10" r="5" fill="#111"/><circle cx="70" cy="10" r="2" fill="#888"/>
        <circle cx="84" cy="3" r="2.5" fill="#fff6c8"/>
        <path d="M-4 3 l-14 -3 l14 -3 z" fill="#ffb547" opacity="0">
          <animate attributeName="opacity" values="0;0;1;0;1;0;0" keyTimes="0;${t};${t + .02};${t + .08};${t + .2};${t + .24};1" dur="${D}s" repeatCount="indefinite"/>
        </path>
      </g>
      <animateTransform attributeName="transform" type="translate" values="40 ${y};40 ${y};${endX} ${y};${endX} ${y};40 ${y}" keyTimes="0;${t};.88;.95;1" dur="${D}s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;.6 0 .9 .6;0 0 1 1;0 0 1 1"/>
    </g>
    <ellipse cx="44" cy="${y + 8}" rx="10" ry="6" fill="#d9d9d9" opacity="0">
      <animate attributeName="opacity" values="0;0;.7;0;0" keyTimes="0;${t};${t + .03};${t + .35};1" dur="${D}s" repeatCount="indefinite"/>
      <animate attributeName="rx" values="10;10;10;60" keyTimes="0;${t};${t + .03};${t + .35}" dur="${D}s" repeatCount="indefinite"/>
      <animate attributeName="cx" values="44;44;44;10" keyTimes="0;${t};${t + .03};${t + .35}" dur="${D}s" repeatCount="indefinite"/>
    </ellipse>`;
    return `<defs>${sharedDefs}
      <linearGradient id="dr-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070c"/><stop offset="1" stop-color="#1a1f2e"/></linearGradient>
      <linearGradient id="dr-asph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2d30"/><stop offset="1" stop-color="#1a1c1e"/></linearGradient>
    </defs>
    <rect width="400" height="225" fill="url(#dr-sky)"/>
    ${Array.from({ length: 24 }, (_, i) => `<circle cx="${(i * 71) % 400}" cy="${(i * 37) % 40 + 4}" r=".9" fill="#fff" opacity=".6"/>`).join('')}
    ${tower(90, 22)}${tower(310, 22)}
    ${crowd('dr', 52, 36, ['#ffb547', '#f1ece0', '#d23a2e'])}
    ${flashes([[60, 62, .4], [180, 70, .45], [260, 60, .5], [350, 74, .55]], D)}
    <rect x="0" y="88" width="400" height="12" fill="#9a9a96"/>
    ${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 50}" y="88" width="1.5" height="12" fill="#6e6e6a"/>`).join('')}
    <rect x="0" y="100" width="400" height="125" fill="url(#dr-asph)"/>
    <rect x="0" y="118" width="400" height="6" fill="#000" opacity=".35"/>
    <rect x="0" y="176" width="400" height="6" fill="#000" opacity=".35"/>
    <path d="M0 150 H400" stroke="#ffd34d" stroke-width="2" stroke-dasharray="16 12"/>
    <path d="M128 100 V225" stroke="#f1ece0" stroke-width="2.5"/>
    ${car(132, '#d4a72c', true, 352, .3)}
    ${car(192, '#d23a2e', false, 372, .3)}
    <g transform="translate(18 104)">
      <rect x="-9" y="-6" width="18" height="74" rx="3" fill="#0b0d0f"/>
      ${bulb(2, '#fff6c8', 0, .95)}${bulb(14, '#ffb547', .08, .14)}${bulb(26, '#ffb547', .16, .22)}${bulb(38, '#ffb547', .24, .3)}${bulb(52, '#4dff88', .3, .95)}
    </g>
    <text x="300" y="214" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-weight="900" font-size="18" fill="#4dff88" opacity="0">WIN 9.842
      <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.86;.88;.96;1" dur="${D}s" repeatCount="indefinite"/>
    </text>`;
  }
};
