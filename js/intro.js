'use strict';
// Opening animation on the sign-in page ("The Climb"): the aircraft from the logo climbs through clouds, faster and faster, breaks
// through into the night sky, and the name lands; then it fades into the sign-in form. Drawn on a canvas, so it adds nothing to download.
// It plays once per browser session for visitors who are not signed in, never for members (they go straight to their dashboard), holds
// still for anyone whose device asks for reduced motion, and can be skipped with the button or Escape. #/intro replays it.
const Intro = (() => {
  const SEEN = 'qbank.intro.seen', CLIMB = 4.6, TOTAL = 7.9;       // seconds: the climb, and the whole thing before the fade
  let running = false;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seen = () => { try { return sessionStorage.getItem(SEEN) === '1'; } catch { return false; } };
  const mark = () => { try { sessionStorage.setItem(SEEN, '1'); } catch { /* private mode: it just plays again */ } };
  const wanted = () => location.hash === '#/intro' || (!seen() && !reduced());

  // Plays if this visit should get it. onDone runs when the overlay is gone (also when skipped). Returns whether it started.
  function maybe(onDone) {
    if (running || !wanted() || typeof document.createElement('canvas').getContext !== 'function') return false;
    if (location.hash === '#/intro') history.replaceState(null, '', location.pathname + location.search);
    mark(); play(onDone); return true;
  }

  function play(onDone) {
    running = true;
    const app = document.getElementById('app'); if (app) app.inert = true;        // the form underneath waits its turn
    const box = document.createElement('div'); box.className = 'intro'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Opening animation');
    box.innerHTML = `<canvas class="intro-sky" aria-hidden="true"></canvas>
      <div class="intro-hud" aria-hidden="true"><b>0 ft</b><span>Altitude</span></div>
      <div class="intro-final" aria-hidden="true"><img class="intro-logo" src="icons/logo.svg" alt="" width="104" height="104"><div class="intro-name">${'AeroMedQBank'.split('').map((ch, i) => `<span style="--i:${i}"${i >= 7 ? ' class="q"' : ''}>${ch}</span>`).join('')}</div><p class="intro-tag">Board prep for aerospace, occupational and preventive medicine.</p></div>
      <button type="button" class="intro-skip">Skip intro</button>`;
    document.body.appendChild(box);
    const cv = box.querySelector('canvas'), x = cv.getContext('2d'), hud = box.querySelector('.intro-hud'), alt = hud.querySelector('b'), fin = box.querySelector('.intro-final'), skip = box.querySelector('.intro-skip');
    let W, H, raf = 0, t = 0, last = 0, burst = false, done = false;
    const DPR = Math.min(2, devicePixelRatio || 1);
    const size = () => { W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; x.setTransform(DPR, 0, 0, DPR, 0, 0); };
    size(); addEventListener('resize', size);
    let seed = 5; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const clouds = [], lines = [], stars = [], parts = [];
    for (let i = 0; i < 14; i++) clouds.push({ x: R(), y: R(), w: 160 + R() * 300, l: .5 + R() * 1.2 });
    for (let i = 0; i < 60; i++) lines.push({ x: R(), y: R(), l: 30 + R() * 90, a: .08 + R() * .35, s: .6 + R() * .9 });
    for (let i = 0; i < 120; i++) stars.push({ x: R(), y: R(), r: .5 + R() * 1.4, p: R() * 6.28, s: .6 + R() * .9 });
    const ridge = Array.from({ length: 14 }, (_, i) => ({ x: i / 13, h: .05 + R() * .16 }));
    const lerp = (a, b, k) => a + (b - a) * k, mix = (c1, c2, k) => `rgb(${[0, 1, 2].map(i => Math.round(lerp(c1[i], c2[i], k))).join(',')})`;
    const sky = a => { const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, mix([2, 6, 15], [10, 30, 70], 1 - a)); g.addColorStop(.5, mix([8, 24, 58], [40, 100, 160], 1 - a)); g.addColorStop(1, mix([20, 50, 100], [250, 214, 170], Math.max(0, 1 - a * 1.6))); x.fillStyle = g; x.fillRect(0, 0, W, H); };
    const plane = (cx, cy, s) => { x.save(); x.translate(cx, cy); x.scale(s, s); x.translate(-32, -30);
      x.fillStyle = '#fff'; x.beginPath(); x.moveTo(32, 9); x.lineTo(53, 51); x.lineTo(32, 42); x.lineTo(11, 51); x.closePath(); x.fill();
      x.fillStyle = '#cfe3f0'; x.beginPath(); x.moveTo(32, 9); x.lineTo(32, 42); x.lineTo(11, 51); x.closePath(); x.fill();
      x.fillStyle = '#14a3a6'; x.fillRect(29, 23, 6, 4); x.fillRect(25, 27, 14, 6); x.fillRect(29, 33, 6, 4); x.restore(); };

    function finish() {
      if (done) return; done = true; cancelAnimationFrame(raf); removeEventListener('resize', size); document.removeEventListener('keydown', onKey);
      box.classList.add('out');
      setTimeout(() => { box.remove(); if (app) app.inert = false; running = false; if (onDone) onDone(); }, 650);
    }
    const onKey = e => { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', onKey); skip.onclick = finish; skip.focus({ preventScroll: true });

    function frame(now) {
      if (done) return;
      const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now; t += dt;      // time only moves while the tab is showing
      if (t >= TOTAL) return finish();
      const p = Math.min(1, t / CLIMB), v = t < CLIMB ? Math.pow(p, 1.6) : Math.max(0, 1 - (t - CLIMB) / .9), a = Math.min(1, Math.pow(p, 2));
      const shake = t < CLIMB + .1 ? v * 7 : 0;
      x.save(); x.translate((R() - .5) * shake, (R() - .5) * shake); sky(t < CLIMB ? a : 1);
      // the ground falls away at the start
      if (a < .35) { const drop = Math.pow(a / .35, 1.4), gy = H * (.78 + drop * .6), sc = 1 + drop * 1.8; x.fillStyle = `rgba(14,26,44,${1 - drop})`; x.beginPath(); x.moveTo(-W, H * 2);
        ridge.forEach(r => x.lineTo(W / 2 + (r.x - .5) * W * sc, gy - r.h * H * sc)); x.lineTo(W * 2, H * 2); x.closePath(); x.fill(); }
      // stars, high up: twinkle, and streak with speed
      const starA = t >= CLIMB ? 1 : Math.max(0, (a - .45) * 1.8); x.fillStyle = '#fff';
      stars.forEach(s => { const tw = .55 + .45 * Math.sin(now / 500 * s.s + s.p); x.globalAlpha = starA * tw; if (t < CLIMB && v > .2) x.fillRect(s.x * W, s.y * H, s.r, s.r + v * 60 * s.s); else { x.beginPath(); x.arc(s.x * W, s.y * H, s.r, 0, 6.283); x.fill(); } }); x.globalAlpha = 1;
      // clouds rush down, stretched by speed
      const cf = Math.max(0, 1 - a * 1.25);
      if (cf > 0 && t < CLIMB + .4) clouds.forEach(c => { c.y = (c.y + v * dt * (.35 + c.l * .9) + .02 * dt) % 1.25; x.save(); x.translate(c.x * W, (c.y - .1) * H); x.scale(1, 1 + v * 3.2);
        const g = x.createRadialGradient(0, 0, 0, 0, 0, c.w / 2); g.addColorStop(0, `rgba(255,255,255,${.42 * cf})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, c.w / 2, c.w * .17, 0, 0, 6.283); x.fill(); x.restore(); });
      if (t < CLIMB + .2) lines.forEach(l => { l.y = (l.y + v * dt * 2.4 * l.s) % 1.1; x.strokeStyle = `rgba(255,255,255,${l.a * v})`; x.lineWidth = 1.4; x.beginPath(); x.moveTo(l.x * W, l.y * H); x.lineTo(l.x * W, l.y * H - l.l * (.3 + v * 2.2)); x.stroke(); });
      // the aircraft, its contrail and engine glow
      const px = W / 2, py = H * (.6 - .02 * Math.sin(t * 3) * v) - (t >= CLIMB ? Math.min(1, (t - CLIMB) / .5) * H * .9 : 0);
      if (t < CLIMB + .5) { const tl = 70 + v * H * .5, tg = x.createLinearGradient(0, py + 20, 0, py + 20 + tl); tg.addColorStop(0, 'rgba(255,255,255,.95)'); tg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = tg;
        x.fillRect(px - 3 - v * 3, py + 22, 6 + v * 6, tl); x.fillRect(px - 20, py + 16, 2, tl * .6); x.fillRect(px + 18, py + 16, 2, tl * .6);
        const gr = 26 + v * 60, gl = x.createRadialGradient(px, py + 28, 0, px, py + 28, gr + R() * 8); gl.addColorStop(0, 'rgba(255,214,140,.9)'); gl.addColorStop(1, 'rgba(255,140,40,0)'); x.fillStyle = gl; x.beginPath(); x.arc(px, py + 28, gr, 0, 6.283); x.fill();
        plane(px, py, 1 + v * .35); }
      // breaking through: flash, shockwave rings, sparks, then the name lands
      if (t >= CLIMB && !burst) { burst = true; for (let i = 0; i < 46; i++) { const an = R() * 6.283, sp = 200 + R() * 620; parts.push({ x: W / 2, y: H * .48, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, r: 1.5 + R() * 3, c: R() < .5 ? '#7fd1d3' : '#fff', l: 1 }); } setTimeout(() => fin.classList.add('go'), 120); }
      if (t >= CLIMB) { const ft = t - CLIMB; if (ft < .35) { x.fillStyle = `rgba(255,255,255,${.95 * (1 - ft / .35)})`; x.fillRect(0, 0, W, H); }
        [0, .18].forEach((d, i) => { const q = Math.max(0, ft - .05 - d) / .9; if (q > 0 && q < 1) { x.strokeStyle = `rgba(127,209,211,${.7 * (1 - q) / (1 + i)})`; x.lineWidth = 4 - q * 3; x.beginPath(); x.arc(W / 2, H * .48, q * Math.max(W, H) * .62, 0, 6.283); x.stroke(); } });
        parts.forEach(q => { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= .965; q.vy *= .965; q.l -= dt * .9; if (q.l > 0) { x.globalAlpha = q.l; x.fillStyle = q.c; x.beginPath(); x.arc(q.x, q.y, q.r, 0, 6.283); x.fill(); } }); x.globalAlpha = 1; }
      x.restore();
      alt.textContent = (Math.round(a * 420) * 100).toLocaleString() + ' ft'; hud.style.opacity = t < CLIMB ? 1 : 0;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }
  addEventListener('hashchange', () => { if (location.hash === '#/intro' && document.getElementById('si')) maybe(); });      // typed into the address bar while signed out
  return { maybe, play, wanted, get running() { return running; } };
})();
