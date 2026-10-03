// Mascot "Pulse", a flat vector ram, plus the dashboard cover artwork. Poses: idle, blink, happy, cheer, sad.
const Mascot = (() => {
  const INK = '#221a12', BROWN = '#a3774a', BROWND = '#7d5632', TAN = '#c9a273', WHITE = '#f7f3ea', GOLD = '#d9ac2e';
  // Horn: three stroked segments that thin toward the tip, with fine ridges. The right horn is the mirror image.
  const SEG = [['M58 58 C40 22 6 32 9 74', 19], ['M9 74 C11 104 42 112 57 94', 15], ['M57 94 C64 86 58 76 49 80', 10]];
  const horn = `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${SEG.map(([d, w]) => `<path d="${d}" stroke="${INK}" stroke-width="${w + 5}"/>`).join('')}
    ${SEG.map(([d, w]) => `<path d="${d}" stroke="url(#mh)" stroke-width="${w}"/>`).join('')}
    <path d="M55 47 C39 20 17 26 17 62" stroke="#dcc39a" stroke-width="2.4" opacity=".7"/>
    <g stroke="#5a3d20" stroke-width="2" opacity=".65"><path d="M50 48 L44 58"/><path d="M42 36 L35 47"/><path d="M32 30 L26 42"/><path d="M22 32 L17 45"/><path d="M14 46 L21 51"/><path d="M11 62 L19 63"/><path d="M11 78 L20 74"/><path d="M15 92 L23 86"/><path d="M26 102 L32 94"/><path d="M40 106 L43 97"/><path d="M53 102 L52 93"/></g></g>`;
  const lens = (x, m) => { const g = d => `M${x + m * (-26 * 0 + d[0])} ${d[1]}`; return ''; };
  function glasses() {
    const L = 'M50 71 Q50 66 56 66 L74 66 Q80 66 80 72 Q80 92 66 94 Q50 90 50 71 Z';
    const R = 'M110 71 Q110 66 104 66 L86 66 Q80 66 80 72 Q80 92 94 94 Q110 90 110 71 Z';
    return `<path d="M52 68 L44 64M108 68 L116 64" stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="${L}" fill="url(#ml)" stroke="${GOLD}" stroke-width="3" stroke-linejoin="round"/><path d="${R}" fill="url(#ml)" stroke="${GOLD}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M78 71 Q80 68 82 71" fill="none" stroke="${GOLD}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M56 72 Q58 69 64 69" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".75" fill="none"/><path d="M96 72 Q98 69 104 69" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".75" fill="none"/>`;
  }
  function brows(p) {
    const b = (a, c) => `<path d="${a}" stroke="${INK}" stroke-width="4.2" stroke-linecap="round"/><path d="${c}" stroke="${INK}" stroke-width="4.2" stroke-linecap="round"/>`;
    if (p === 'happy' || p === 'cheer') return b('M52 60 Q62 55 74 59', 'M108 60 Q98 55 86 59');
    if (p === 'sad') return b('M52 62 L74 56', 'M108 62 L86 56');
    if (p === 'blink') return b('M52 63 L74 63', 'M108 63 L86 63');
    return b('M52 62 L74 60', 'M108 62 L86 60');
  }
  function mouth(p) {
    if (p === 'cheer') return `<path d="M68 120 Q80 136 92 120 Z" fill="#7a2f2f" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M73 130 Q80 134 87 130" fill="#d97a7a" stroke="none"/>`;
    if (p === 'happy') return `<path d="M68 119 Q80 130 92 119" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    if (p === 'sad') return `<path d="M70 126 Q80 117 90 126" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    return `<path d="M69 121 Q79 127 91 118" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  }
  function sprite(p = 'idle', scale = 4) {
    const w = Math.round(30 * scale * 0.95), h = Math.round(w * 170 / 160); const tilt = '';
    const spark = p === 'cheer' ? `<g fill="${GOLD}"><path d="M146 18 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z"/><path d="M14 16 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4z"/></g>` : '';
    return `<svg class="sprite" viewBox="0 0 160 170" width="${w}" height="${h}" role="img" aria-label="Pulse, the AeroMedQBank ram in aviator sunglasses">
      <defs><linearGradient id="mh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d1a86f"/><stop offset=".55" stop-color="#a97b47"/><stop offset="1" stop-color="#7a5430"/></linearGradient>
        <linearGradient id="mf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6238"/><stop offset=".3" stop-color="#b2854f"/><stop offset=".7" stop-color="#b2854f"/><stop offset="1" stop-color="#8a6238"/></linearGradient>
        <linearGradient id="ml" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0f5f8"/><stop offset=".3" stop-color="#a9c0cf"/><stop offset=".52" stop-color="#3b5566"/><stop offset=".56" stop-color="#0d141a"/><stop offset="1" stop-color="#05080b"/></linearGradient>
        <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a7b3a"/><stop offset="1" stop-color="#48592a"/></linearGradient></defs>
      <g${tilt}>
      ${horn}<g transform="translate(160 0) scale(-1 1)">${horn}</g>
      <path d="M22 170 Q24 140 52 132 L80 142 L108 132 Q136 140 138 170Z" fill="url(#mg)" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M62 126 Q80 152 98 126 L92 142 Q80 156 68 142Z" fill="#c9a273" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M64 130 L80 150 L96 130 L92 126 L80 138 L68 126Z" fill="#efe6d2" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M54 130 L70 148 L62 170M106 130 L90 148 L98 170" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M38 138 L46 170M122 138 L114 170" stroke="#2b3419" stroke-width="9" stroke-linecap="butt"/><path d="M38 138 L46 170M122 138 L114 170" stroke="${INK}" stroke-width="9" stroke-linecap="butt" opacity=".0"/>
      <rect x="37" y="150" width="14" height="9" rx="1.5" fill="#b9bdb5" stroke="${INK}" stroke-width="1.6" transform="rotate(-8 44 154)"/><rect x="109" y="150" width="14" height="9" rx="1.5" fill="#b9bdb5" stroke="${INK}" stroke-width="1.6" transform="rotate(8 116 154)"/>
      <path d="M69 152 C60 148 52 152 50 160 C58 158 66 158 71 161Z M91 152 C100 148 108 152 110 160 C102 158 94 158 89 161Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M78 150h4v3.5h3.5v4H82v3.5h-4v-3.5h-3.5v-4H78z" fill="${GOLD}" stroke="${INK}" stroke-width="1.4"/>
      <ellipse cx="41" cy="88" rx="15" ry="7.5" transform="rotate(-24 41 88)" fill="${BROWN}" stroke="${INK}" stroke-width="2.6"/><ellipse cx="41" cy="88" rx="9" ry="4" transform="rotate(-24 41 88)" fill="#e9c7a4" opacity=".85"/>
      <ellipse cx="119" cy="88" rx="15" ry="7.5" transform="rotate(24 119 88)" fill="${BROWN}" stroke="${INK}" stroke-width="2.6"/><ellipse cx="119" cy="88" rx="9" ry="4" transform="rotate(24 119 88)" fill="#e9c7a4" opacity=".85"/>
      <path d="M62 112 Q60 132 66 140 L94 140 Q100 132 98 112Z" fill="${BROWND}" stroke="${INK}" stroke-width="2.4"/>
      <path d="M55 58 Q80 48 105 58 L108 86 Q106 106 98 118 Q92 134 80 136 Q68 134 62 118 Q54 106 52 86 Z" fill="url(#mf)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M73 52 Q80 50 87 52 L86 70 Q80 73 74 70Z" fill="${TAN}" opacity=".8"/>
      <path d="M66 96 Q80 88 94 96 Q99 114 93 126 Q87 137 80 138 Q73 137 67 126 Q61 114 66 96 Z" fill="${WHITE}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M71 100 Q80 95 89 100 Q88 109 80 112 Q72 109 71 100Z" fill="#2d2b2c"/><circle cx="76.5" cy="103" r="1.3" fill="#6b6668"/><circle cx="83.5" cy="103" r="1.3" fill="#6b6668"/><path d="M80 112 V117" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
      ${glasses()}${brows(p)}${mouth(p)}
      </g>${spark}</svg>`;
  }

  // Dashboard cover: dawn sky, layered ridgelines, a jet and its contrail. Everything is vector, so it stays sharp at any size.
  // Halloween season (October, and November 1): a harvest moon, a plane with its contrail, bats and a bare tree. Outside the season the usual dawn scene returns by itself.
  const halloween = (d = new Date()) => d.getMonth() === 9 || (d.getMonth() === 10 && d.getDate() === 1);
  const BAT = (x, y, k, r) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${k})" fill="#05101b"><path d="M0 0 C-4 -6,-10 -8,-18 -6 C-14 -3,-14 0,-11 3 C-8 1,-5 2,-3 6 C-2 3,-1 2,0 2 C1 2,2 3,3 6 C5 2,8 1,11 3 C14 0,14 -3,18 -6 C10 -8,4 -6,0 0Z"/></g>`;
  const HALLOWEEN_ART = `<svg class="cover-art" viewBox="0 0 1200 240" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
      <defs><linearGradient id="hw-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1626"/><stop offset=".55" stop-color="#16304f"/><stop offset="1" stop-color="#3b3a52"/></linearGradient>
        <radialGradient id="hw-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb35c" stop-opacity=".6"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>
        <linearGradient id="hw-trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".9"/></linearGradient></defs>
      <rect width="1200" height="240" fill="url(#hw-sky)"/>
      <g fill="#fff"><circle cx="520" cy="30" r="1.3" opacity=".7"/><circle cx="640" cy="60" r="1" opacity=".5"/><circle cx="1130" cy="30" r="1.4" opacity=".8"/><circle cx="780" cy="22" r="1" opacity=".6"/></g>
      <circle cx="990" cy="108" r="190" fill="url(#hw-glow)"/><circle cx="990" cy="108" r="64" fill="#ffb961"/><circle cx="970" cy="92" r="10" fill="#f0a04a" opacity=".6"/><circle cx="1015" cy="128" r="13" fill="#f0a04a" opacity=".5"/><circle cx="1003" cy="78" r="6" fill="#f0a04a" opacity=".5"/>
      <path d="M470 124 C 640 124, 800 104, 940 80" stroke="url(#hw-trail)" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M470 132 C 640 132, 800 112, 940 88" stroke="url(#hw-trail)" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".55"/>
      <g transform="translate(946 79) rotate(-12) scale(1.45)" fill="#fff"><path d="M0 0 L-6 -3 L-18 -3 L-22 -12 L-25 -12 L-22 -3 L-34 -2 L-37 -6 L-39 -6 L-38 0 L-39 6 L-37 6 L-34 2 L-22 3 L-25 12 L-22 12 L-18 3 L-6 3 Z"/></g>
      ${BAT(1090, 44, 1.2, 8)}${BAT(1150, 92, .9, -6)}${BAT(800, 40, .8, 4)}
      <path d="M0 205 C 150 175, 300 215, 470 195 S 800 170, 960 200 S 1120 205, 1200 192 V240 H0Z" fill="#050e18"/>
      <g stroke="#050e18" stroke-width="5" stroke-linecap="round" fill="none"><path d="M640 200 V140 M640 168 L615 138 M640 156 L668 126 M640 140 L630 112 M615 138 L600 130 M668 126 L684 122"/></g></svg>`;
  function scene(coverImage, forceHalloween) {
    const spooky = !coverImage && (forceHalloween === undefined ? halloween() : forceHalloween);
    const art = spooky ? HALLOWEEN_ART : coverImage
      ? `<img class="cover-photo" src="${coverImage}" alt="">`
      : `<svg class="cover-art" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs><linearGradient id="cv-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2a3a"/><stop offset=".55" stop-color="#3d5566"/><stop offset="1" stop-color="#d9b877"/></linearGradient>
        <linearGradient id="cv-trail" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <radialGradient id="cv-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe9b0" stop-opacity=".95"/><stop offset="1" stop-color="#ffe9b0" stop-opacity="0"/></radialGradient></defs>
      <rect width="1200" height="240" fill="url(#cv-sky)"/><circle cx="930" cy="190" r="150" fill="url(#cv-sun)"/>
      <g stroke="#fff" stroke-opacity=".08"><path d="M0 60H1200M0 110H1200M0 160H1200"/></g>
      <path d="M560 82 L880 60" stroke="url(#cv-trail)" stroke-width="3" stroke-linecap="round"/><path d="M560 88 L880 66" stroke="url(#cv-trail)" stroke-width="1.5" stroke-linecap="round" opacity=".7"/>
      <g transform="translate(880 44) rotate(-4)" fill="#f4f6f4"><path d="M0 14 L64 8 Q86 9 100 15 Q86 21 64 22 L10 22Z"/><path d="M10 14 L-2 -4 L10 -4 L28 12Z"/><path d="M46 16 L72 38 L82 38 L68 16Z" opacity=".92"/></g>
      <g transform="translate(640 112) rotate(3)" fill="#e6eae6"><path d="M-6 -22 H62" stroke="#e6eae6" stroke-width="2.5" stroke-linecap="round"/><path d="M-30 -20 H86" stroke="#e6eae6" stroke-opacity=".28" stroke-width="5" stroke-linecap="round"/><rect x="22" y="-24" width="4" height="8"/>
        <path d="M0 0 Q0 -16 22 -16 Q46 -16 50 -3 Q50 12 26 12 H10 Q0 12 0 0Z"/><path d="M46 -6 L98 -10 L98 -3 L48 6Z"/><path d="M92 -22 L102 -22 L102 4 L94 4Z" opacity=".9"/><path d="M6 -4 Q8 -12 20 -12 L20 -2 H6Z" fill="#3d5566"/><path d="M6 18 H44 M14 12 V18 M36 12 V18" stroke="#e6eae6" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>
      <path d="M0 190 C120 150 230 176 350 156 C470 136 560 170 690 150 C820 130 930 168 1050 146 C1120 134 1170 142 1200 148 V240 H0Z" class="hill1" fill="#5d6f3b"/>
      <path d="M0 214 C140 186 260 206 400 190 C540 174 640 206 780 188 C900 174 1040 202 1200 182 V240 H0Z" class="hill2" fill="#3f4f25"/>
      <path d="M0 232 C180 214 360 230 560 220 C760 210 980 232 1200 218 V240 H0Z" class="hill3" fill="#2b3719"/></svg>`;
    return `<div class="cover${spooky ? ' halloween' : ''}">${art}<div class="cover-shade"></div><div class="cover-body"><div class="cover-text" id="cover-text"></div><div class="scene-slot" id="scene-slot"></div></div></div>`;
  }

  const timers = [];
  const stop = () => { while (timers.length) clearInterval(timers.pop()); };
  const hash = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  const pick = (arr, seed) => arr[hash(seed) % arr.length];

  function mount(el, { pose: p = 'idle', msg = '', scale = 4 } = {}) {
    el.innerHTML = `<div class="mascot">${sprite(p, scale)}${msg ? `<div class="bubble">${msg}</div>` : ''}</div>`;
    if (p === 'idle') {
      const svg = () => el.querySelector('.sprite');
      timers.push(setInterval(() => {
        const s = svg(); if (!s) return;
        s.outerHTML = sprite('blink', scale);
        setTimeout(() => { const t = svg(); if (t) t.outerHTML = sprite('idle', scale); }, 170);
      }, 3600));
    }
  }

  const lines = {
    correct: ['Correct. Well reasoned.', 'On target.', 'Nice work, Doc.', 'That is the one.', 'Solid.', 'Cleared for the next one.'],
    wrong: ['Not quite. Read the explanation, then regroup.', 'Review it and move on. The next one is yours.', 'Every miss is useful before the boards.', 'Better to learn it here than on exam day.'],
    tips: ['Rule out what you can first.', 'Trust your first read.', 'Read the last line of the stem twice.', 'Slow is smooth, smooth is fast.']
  };
  return { sprite, scene, halloween, mount, stop, pick, lines };
})();
