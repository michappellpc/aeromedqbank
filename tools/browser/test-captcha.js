#!/usr/bin/env node
// Browser test for the "I am human" check (js/captcha.js) on sign in, forgot password, create account and change password.
// The real hCaptcha cannot run here, so its script is replaced by a stand-in with one button that "solves" it.
// Start the helpers first:  node tools/browser/mock-supabase.js &  node tools/browser/serve.js &   then  node tools/browser/test-captcha.js
const fs = require('fs'), { chromium } = require('playwright'), path = require('path'), http = require('http');
const REPO = path.resolve(__dirname, '..', '..'), CFG = REPO + '/data/config.json', BASE = 'http://localhost:8132/qbank/';
const orig = fs.readFileSync(CFG, 'utf8'), cfg = JSON.parse(orig); cfg.supabase = { url: 'http://localhost:9998', anonKey: 'anon-test-key' }; cfg.captchaSiteKey = '00000000-0000-0000-0000-000000000001';
const restore = () => { try { fs.writeFileSync(CFG, orig); } catch { /* done */ } };
process.on('exit', restore); process.on('SIGINT', () => process.exit(1));
let pass = 0, fail = 0; const ok = (d, c, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'pass' : 'FAIL'}  ${d}${c ? '' : '   ' + String(x).slice(0, 400)}`); };
const caps = () => new Promise(r => http.get('http://localhost:9998/__caps', res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d))); }));
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
// a stand-in for hCaptcha's script: render() draws one button; pressing it hands the page a token (the next one is 'bad' when window.__badNext is set)
const STUB = `(function(){var n=0,w={};window.hcaptcha={render:function(el,o){var id=++n;w[id]={o:o,el:el};el.innerHTML='<button type="button" class="hc-stub">I am human</button>';el.querySelector('button').onclick=function(){o.callback(window.__badNext?(window.__badNext=false,'bad'):'tok-'+id+'-'+Date.now());el.querySelector('button').textContent='Done';};return id;},reset:function(id){if(w[id])w[id].el.querySelector('button').textContent='I am human';}};var cb=new URL(document.currentScript.src).searchParams.get('onload');if(cb&&window[cb])window[cb]();})();`;
(async () => {
  fs.writeFileSync(CFG, JSON.stringify(cfg));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }), errs = [];
  const open = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }), p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.message));
    await c.route('https://js.hcaptcha.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB })); return [c, p]; };
  const solve = (p, box) => p.click(`${box} .hc-stub`);
  const last = async () => (await caps()).slice(-1)[0];
  try {
    console.log('Sign in');
    let [c, p] = await open(); await p.goto(BASE); await p.waitForSelector('#si-cap .hc-stub');
    ok('the sign-in form shows the "I am human" check', await p.locator('#si-cap .hc-stub').isVisible());
    await p.fill('#si-email', 'm@x'); await p.fill('#si-pw', 'pw-m-1'); await p.click('#si-go'); await p.waitForTimeout(300);
    ok('signing in without ticking it is stopped with a clear message, and nothing is sent', /tick the "I am human" box/i.test(await p.innerText('#si-err')) && !(await caps()).some(x => /^token/.test(x)));
    await p.fill('#si-email', 'nobody@x'); await solve(p, '#si-cap'); await p.click('#si-go'); await p.waitForTimeout(500);
    ok('a wrong password still says so, and the answer was sent to Supabase', /incorrect/i.test(await p.innerText('#si-err')) && /^token:tok-/.test(await last()), await last());
    ok('the check is reset after every try, so a used answer is not sent twice', /I am human/.test(await p.innerText('#si-cap')));
    await p.evaluate(() => { window.__badNext = true; }); await p.fill('#si-email', 'm@x'); await solve(p, '#si-cap'); await p.click('#si-go'); await p.waitForTimeout(500);
    ok('an answer Supabase rejects asks to tick the box again', /did not go through/i.test(await p.innerText('#si-err')), await p.innerText('#si-err'));
    await p.evaluate(AXE); const v = await p.evaluate(async () => (await axe.run(document)).violations.map(x => x.id)); ok('the sign-in form with the check has no accessibility problems', !v.length, v.join(','));
    console.log('Forgot password');
    await p.fill('#si-email', 'm@x'); await p.click('#si-forgot'); await p.waitForTimeout(300);
    ok('forgot password also needs the check', /tick the "I am human" box/i.test(await p.innerText('#si-err')));
    await solve(p, '#si-cap'); await p.click('#si-forgot'); await p.waitForTimeout(500);
    ok('with it, the reset email is requested and carries the answer', /reset link is on its way/i.test(await p.innerText('#si-err')) && /^recover:tok-/.test(await last()), await last());
    console.log('Signing in for real');
    await solve(p, '#si-cap'); await p.fill('#si-pw', 'pw-m-1'); await p.click('#si-go'); await p.waitForSelector('.cover');
    ok('with the box ticked and the right password, the member is in', await p.locator('.cover').isVisible() && /^token:tok-/.test(await last()));
    console.log('Change password');
    await p.evaluate(() => { location.hash = '#/settings'; }); await p.waitForSelector('#pw'); await p.waitForTimeout(300);
    ok('the change-password form shows the check too', await p.locator('#pw .hc-stub, #pw ~ * .hc-stub').count() >= 1 || await p.locator('.hc-stub').count() >= 1);
    await p.fill('#pw-cur', 'pw-m-1'); await p.fill('#pw-new', 'new-pass-123'); await p.fill('#pw-new2', 'new-pass-123'); await p.click('#pw-go'); await p.waitForTimeout(300);
    ok('changing the password without it is stopped', /tick the "I am human" box/i.test(await p.innerText('#pw-msg')));
    await solve(p, '#app'); await p.click('#pw-go'); await p.waitForTimeout(600);
    ok('with it, the current password is checked with the answer attached', /^token:tok-/.test(await last()), await last());
    await c.close();
    console.log('Create an account');
    [c, p] = await open(); await p.goto(BASE); await p.waitForSelector('#si'); await p.evaluate(() => { const b2 = document.getElementById('si-new'); if (b2) b2.click(); else renderSignUp(); }); await p.waitForSelector('#su-cap .hc-stub');
    await p.fill('#su-email', 'new@x'); await p.fill('#su-pw', 'long-pass-1'); await p.fill('#su-pw2', 'long-pass-1'); await p.click('#su-go'); await p.waitForTimeout(300);
    ok('creating an account without the check is stopped', /tick the "I am human" box/i.test(await p.innerText('#su-err')));
    await solve(p, '#su-cap'); await p.click('#su-go'); await p.waitForTimeout(600);
    ok('with it, the sign-up carries the answer', /^signup:tok-/.test(await last()), await last());
    await c.close();
    console.log('If hCaptcha cannot load');
    [c, p] = await open(); await c.unroute('https://js.hcaptcha.com/**'); await c.route('https://js.hcaptcha.com/**', r => r.abort()); await p.goto(BASE); await p.waitForTimeout(1200);
    ok('the form says so instead of failing silently', /could not load/i.test(await p.innerText('#si-cap')));
    await c.close();
    console.log('Without a site key in the config');
    cfg.captchaSiteKey = ''; fs.writeFileSync(CFG, JSON.stringify(cfg)); [c, p] = await open(); await p.goto(BASE); await p.waitForSelector('#si'); await p.waitForTimeout(400);
    ok('there is no check and sign-in works as before', await p.locator('.hc-stub').count() === 0);
    await p.fill('#si-email', 'm@x'); await p.fill('#si-pw', 'pw-m-1'); await p.click('#si-go'); await p.waitForSelector('.cover'); ok('signed in, with no answer sent', (await last()) === 'token:-', await last());
    await c.close();
    ok('no page errors', errs.length === 0, errs.join('; '));
  } finally { await b.close(); }
  console.log(`\n${pass} passed, ${fail} failed`); restore(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); restore(); process.exit(1); });
