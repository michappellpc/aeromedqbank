#!/usr/bin/env node
// Browser test for the View as switch. Start the two helpers first:  node tools/browser/mock-supabase.js &  node tools/browser/serve.js &
// then run  node tools/browser/test-viewas.js  (needs playwright and axe-core installed; set CHROMIUM to a browser path if needed).
// It points data/config.json at the stand-in server while it runs and puts the real file back when it finishes.
const fs = require('fs'), cp = require('child_process'), { chromium } = require('playwright');
const path = require('path'), REPO = path.resolve(__dirname, '..', '..'), CFG = REPO + '/data/config.json', BASE = 'http://localhost:8132/qbank/';
const orig = fs.readFileSync(CFG, 'utf8'), cfg = JSON.parse(orig); cfg.supabase = { url: 'http://localhost:9998', anonKey: 'anon-test-key' };
const restore = () => { try { fs.writeFileSync(CFG, orig); } catch { /* done */ } };
process.on('exit', restore); process.on('SIGINT', () => process.exit(1));
let pass = 0, fail = 0; const ok = (d, c, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'pass' : 'FAIL'}  ${d}${c ? '' : '   ' + String(x).slice(0, 300)}`); };
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
(async () => {
  fs.writeFileSync(CFG, JSON.stringify(cfg));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }), errs = [];
  const open = async (vp = { width: 1200, height: 800 }) => { const c = await b.newContext({ viewport: vp }), p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/Content Security Policy/i.test(m.text())) errs.push(m.text().slice(0, 120)); }); return [c, p]; };
  const login = async (p, e, w) => { await p.goto(BASE); await p.waitForSelector('#si'); await p.fill('#si-email', e); await p.fill('#si-pw', w); await p.click('#si-go'); await p.waitForSelector('.cover, h2'); await p.waitForTimeout(700); };
  const axe = async (p, label) => { for (const s of ['light', 'dark']) { await p.emulateMedia({ colorScheme: s }); await p.waitForTimeout(300); await p.evaluate(AXE); const v = await p.evaluate(async () => (await axe.run(document)).violations.map(x => x.id + ':' + x.nodes.length)); ok(`${label} accessible (${s})`, v.length === 0, v.join(',')); } };
  const items = p => p.locator('#viewsw-menu [data-v]').allInnerTexts();
  const hash = p => p.evaluate(() => location.hash);
  try {
    console.log('Admin');
    let [c, p] = await open(); await login(p, 'admin@x', 'pw-admin-1');
    ok('the View as switch is in the header and says Admin', await p.locator('#viewsw').isVisible() && /Admin/.test(await p.innerText('#viewsw-cur')));
    ok('the old arrow beside Dashboard is gone', await p.locator('#nav-progs').count() === 0);
    ok('the menu has an Admin link', /Admin/.test(await p.innerText('#nav-admin')) && await p.getAttribute('#nav-admin', 'href') === '#/admin');
    await p.click('#viewsw-btn'); await p.waitForSelector('#viewsw-menu:not([hidden])');
    const it = (await items(p)).map(x => x.replace(/\s+/g, ' ').trim());
    ok('the menu lists Admin, Reviewer and each active program (the retired one is left out)', it.length === 4 && /^Admin/.test(it[0]) && /^Reviewer/.test(it[1]) && it[2] === 'Program One' && it[3] === 'Program Two', it.join(' | '));
    ok('Admin is the one marked as current', await p.getAttribute('#viewsw-menu [data-v=admin]', 'aria-checked') === 'true' && await p.getAttribute('#viewsw-menu [data-v=reviewer]', 'aria-checked') === 'false');
    await axe(p, 'The View as menu (open)');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok('Escape closes the menu and returns focus to the button', await p.locator('#viewsw-menu').isHidden() && await p.evaluate(() => document.activeElement.id) === 'viewsw-btn');
    console.log('Reviewer view');
    await p.click('#viewsw-btn'); await p.click('#viewsw-menu [data-v=reviewer]'); await p.waitForSelector('.tabs'); await p.waitForTimeout(500);
    ok('choosing Reviewer opens the Questions page', /#\/admin\/questions/.test(await hash(p)));
    ok('the switch now says Reviewer', /Reviewer/.test(await p.innerText('#viewsw-cur')));
    ok('the menu link reads Questions, like a real reviewer sees', /^Questions/.test((await p.innerText('#nav-admin')).trim()) && await p.getAttribute('#nav-admin', 'href') === '#/admin/questions');
    const tabs = (await p.locator('.tabs a').allInnerTexts()).map(x => x.trim());
    ok('the Admin tabs are a reviewer\'s: no Overview', !tabs.includes('Overview') && tabs.includes('Questions') && tabs.includes('Lessons') && tabs.includes('Flashcards') && !tabs.includes('Inbox') && tabs.includes('Performance'), tabs.join(','));
    await p.evaluate(() => { location.hash = '#/admin'; }); await p.waitForTimeout(500);
    ok('the Overview page is not reachable in the reviewer view (it goes back to Questions)', /#\/admin\/questions/.test(await hash(p)));
    await p.reload(); await p.waitForSelector('.tabs'); await p.waitForTimeout(700);
    ok('the choice is remembered after a reload', /Reviewer/.test(await p.innerText('#viewsw-cur')) && !(await p.locator('.tabs a').allInnerTexts()).map(x => x.trim()).includes('Overview'));
    console.log('Faculty view');
    await p.click('#viewsw-btn'); await p.click('#viewsw-menu [data-v="faculty:prog-one"]'); await p.waitForTimeout(900);
    ok('choosing a program opens that program\'s dashboard', /#\/program\/prog-one\/dashboard/.test(await hash(p)), await hash(p));
    ok('the switch says Faculty and the program name', /Faculty: Program One/.test(await p.innerText('#viewsw-cur')));
    ok('the Admin link is hidden, as it is for faculty', await p.locator('#nav-admin').isHidden());
    ok('the page says it is a preview of what that program\'s faculty see', /Preview/.test(await p.innerText('main')) && /Program One/.test(await p.innerText('main')), (await p.innerText('main')).slice(0, 200));
    await p.evaluate(() => { location.hash = '#/admin'; }); await p.waitForTimeout(600);
    ok('Admin pages are not reachable in the faculty view (it goes to the Dashboard)', !/#\/admin/.test(await hash(p)));
    await p.click('nav a[href="#/"]'); await p.waitForTimeout(900);
    ok('the Dashboard link shows that program\'s dashboard', /Program One/.test(await p.innerText('main')) && /Preview/.test(await p.innerText('main')));
    await p.click('#viewsw-btn'); await p.click('#viewsw-menu [data-v="faculty:prog-two"]'); await p.waitForTimeout(900);
    ok('switching straight to another program works', /Program Two/.test(await p.innerText('#viewsw-cur')) && /prog-two/.test(await hash(p)));
    console.log('Back to Admin');
    await p.click('#viewsw-btn'); await p.click('#viewsw-menu [data-v=admin]'); await p.waitForSelector('.tabs'); await p.waitForTimeout(600);
    ok('Admin shows the full Admin tabs again, with Overview', (await p.locator('.tabs a').allInnerTexts()).map(x => x.trim()).includes('Overview') && /#\/admin$/.test(await hash(p)));
    ok('and the menu link reads Admin', /^Admin/.test((await p.innerText('#nav-admin')).trim()));
    await axe(p, 'Admin Overview with the switch');
    await c.close();
    console.log('Phone');
    [c, p] = await open({ width: 390, height: 800 }); await login(p, 'admin@x', 'pw-admin-1');
    ok('the switch is in the header on a phone', await p.locator('#viewsw-btn').isVisible());
    await p.click('#viewsw-btn'); await p.waitForSelector('#viewsw-menu:not([hidden])');
    const box = await p.locator('#viewsw-menu').boundingBox();
    ok('the open menu fits on the screen', box && box.x >= 0 && box.x + box.width <= 390 + 1 && box.y >= 0, JSON.stringify(box));
    ok('the page does not scroll sideways', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await axe(p, 'The View as menu on a phone');
    await c.close();
    console.log('Other accounts do not get the switch');
    for (const [e, w, label, adminLink] of [['rev@x', 'pw-rev-1', 'a real reviewer', 'Questions'], ['fac@x', 'pw-fac-1', 'real faculty', null], ['m@x', 'pw-m-1', 'a member', null]]) {
      [c, p] = await open(); await login(p, e, w);
      ok(`${label} has no View as switch`, await p.locator('#viewsw').isHidden());
      ok(`${label} sees ${adminLink ? 'a Questions link' : 'no Admin link'}`, adminLink ? /^Questions/.test((await p.innerText('#nav-admin')).trim()) : await p.locator('#nav-admin').isHidden());
      await c.close();
    }
    ok('no page errors or blocked loads', errs.length === 0, errs.join(' | '));
  } catch (e) { fail++; console.log('CRASH', e.message.split('\n').slice(0, 3).join(' ')); } finally { await b.close(); restore(); }
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
