#!/usr/bin/env node
// Browser test for the opening animation on the sign-in page (js/intro.js). Start the helpers first:
//   node tools/browser/mock-supabase.js &  node tools/browser/serve.js &   then  node tools/browser/test-intro.js
// (needs playwright and axe-core). It points data/config.json at the stand-in while it runs and restores it.
const fs = require('fs'), { chromium } = require('playwright'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..'), CFG = REPO + '/data/config.json', BASE = 'http://localhost:8132/qbank/';
const orig = fs.readFileSync(CFG, 'utf8'), cfg = JSON.parse(orig); cfg.supabase = { url: 'http://localhost:9998', anonKey: 'anon-test-key' };
const restore = () => { try { fs.writeFileSync(CFG, orig); } catch { /* done */ } };
process.on('exit', restore); process.on('SIGINT', () => process.exit(1));
let pass = 0, fail = 0; const ok = (d, c, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'pass' : 'FAIL'}  ${d}${c ? '' : '   ' + String(x).slice(0, 400)}`); };
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
(async () => {
  fs.writeFileSync(CFG, JSON.stringify(cfg));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }), errs = [];
  const open = async (opts = {}) => { const c = await b.newContext({ viewport: { width: 1280, height: 800 }, ...opts }), p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.message)); return [c, p]; };
  const intro = p => p.locator('.intro');
  const axe = async (p, label) => { for (const s of ['light', 'dark']) { await p.emulateMedia({ colorScheme: s }); await p.waitForTimeout(200); await p.evaluate(AXE); const v = await p.evaluate(async () => (await axe.run(document)).violations.map(x => x.id + ' ' + x.nodes.map(n => n.target.join(' ')).join(' | '))); ok(`${label}: no accessibility problems (${s})`, !v.length, v.join('; ')); } await p.emulateMedia({ colorScheme: 'light' }); };
  const drawing = async p => { const a = await p.evaluate(() => document.querySelector('.intro-sky').toDataURL().length); await p.waitForTimeout(400); const b2 = await p.evaluate(() => document.querySelector('.intro-sky').toDataURL().length); return a !== b2; };
  try {
    console.log('A visitor who is not signed in');
    let [c, p] = await open(); await p.goto(BASE); await p.waitForSelector('.intro'); await p.waitForTimeout(600);
    ok('the opening animation covers the sign-in page', await intro(p).isVisible() && await p.locator('#si').count() === 1);
    ok('the form underneath is inert while it plays', await p.evaluate(() => document.getElementById('app').inert === true));
    ok('the sky is being drawn (the picture changes between frames)', await drawing(p));
    const alt1 = await p.innerText('.intro-hud b'); await p.waitForTimeout(900); const alt2 = await p.innerText('.intro-hud b');
    ok('the altitude counter climbs', alt1 !== alt2 && /ft$/.test(alt2), `${alt1} -> ${alt2}`);
    ok('the Skip button has focus, so a keyboard user can press it at once', await p.evaluate(() => document.activeElement && document.activeElement.className === 'intro-skip'));
    await axe(p, 'While it plays');
    await p.waitForTimeout(3200);                                           // past the breakthrough
    ok('the name lands after the breakthrough', await p.locator('.intro-final.go').count() === 1);
    await axe(p, 'The name on screen');
    await p.waitForSelector('.intro', { state: 'detached', timeout: 7000 });
    ok('it ends on its own and the form is usable again', await p.evaluate(() => document.getElementById('app').inert === false) && await p.locator('#si-email').isEditable());
    await p.reload(); await p.waitForSelector('#si'); await p.waitForTimeout(700);
    ok('it does not play again in the same browser session', await intro(p).count() === 0);
    await p.goto(BASE + '#/intro'); await p.waitForSelector('.intro'); await p.waitForTimeout(300);
    ok('#/intro replays it, and the address is tidied', await intro(p).isVisible() && await p.evaluate(() => location.hash) === '', await p.evaluate(() => location.hash));
    await p.click('.intro-skip'); await p.waitForSelector('.intro', { state: 'detached', timeout: 3000 });
    ok('Skip removes it quickly', true);
    await p.goto(BASE + '#/intro'); await p.waitForSelector('.intro'); await p.keyboard.press('Escape'); await p.waitForSelector('.intro', { state: 'detached', timeout: 3000 });
    ok('Escape skips it too', true);
    await p.fill('#si-email', 'm@x'); await p.fill('#si-pw', 'pw-m-1'); await p.click('#si-go'); await p.waitForSelector('.cover'); await p.waitForTimeout(500);
    ok('signing in afterwards works, and a member never sees it', await intro(p).count() === 0);
    await p.evaluate(() => { location.hash = '#/settings'; }); await p.waitForTimeout(600);
    const out = p.locator('button:text("Sign out"), #signout, [data-signout]'); if (await out.count()) { await out.first().click(); await p.waitForSelector('#si'); await p.waitForTimeout(600); ok('signing out does not replay it', await intro(p).count() === 0); }
    await c.close();

    console.log('Reduced motion');
    [c, p] = await open({ reducedMotion: 'reduce' }); await p.goto(BASE); await p.waitForSelector('#si'); await p.waitForTimeout(700);
    ok('someone whose device asks for reduced motion goes straight to the form', await intro(p).count() === 0 && await p.evaluate(() => document.getElementById('app').inert !== true));
    await c.close();

    console.log('Phone');
    [c, p] = await open({ viewport: { width: 390, height: 780 } }); await p.goto(BASE); await p.waitForSelector('.intro'); await p.waitForTimeout(6200);
    ok('on a phone the name fits on one line', await p.evaluate(() => { const n = document.querySelector('.intro-name'); return n && n.scrollWidth <= n.clientWidth + 2 && n.getBoundingClientRect().width < innerWidth - 40; }));
    await axe(p, 'Phone');
    await c.close();
    ok('no page errors', errs.length === 0, errs.join('; '));
  } finally { await b.close(); }
  console.log(`\n${pass} passed, ${fail} failed`); restore(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); restore(); process.exit(1); });
