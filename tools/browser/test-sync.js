#!/usr/bin/env node
// Browser test for opening from the device's saved copy and refreshing only what changed (js/syncmerge.js, Cloud.syncList, startSession).
// Start the helpers first:  node tools/browser/mock-supabase.js &  node tools/browser/serve.js &   then  node tools/browser/test-sync.js
// The stand-in must be freshly started (it keeps its question list in memory and this test edits it).
const fs = require('fs'), { chromium } = require('playwright'), path = require('path'), http = require('http');
const REPO = path.resolve(__dirname, '..', '..'), CFG = REPO + '/data/config.json', BASE = 'http://localhost:8132/qbank/';
const orig = fs.readFileSync(CFG, 'utf8'), cfg = JSON.parse(orig); cfg.supabase = { url: 'http://localhost:9998', anonKey: 'anon-test-key' };
const restore = () => { try { fs.writeFileSync(CFG, orig); } catch { /* done */ } };
process.on('exit', restore); process.on('SIGINT', () => process.exit(1));
let pass = 0, fail = 0; const ok = (d, c, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'pass' : 'FAIL'}  ${d}${c ? '' : '   ' + String(x).slice(0, 400)}`); };
const mock = p => new Promise(r => http.get('http://localhost:9998' + p, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d))); }));
(async () => {
  fs.writeFileSync(CFG, JSON.stringify(cfg));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }), errs = [];
  const c = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }), p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.message));
  const gets = async since => (await mock('/__gets')).slice(since);
  const qGets = list => list.filter(x => x.startsWith('questions?'));
  try {
    console.log('First sign-in on a device');
    let n0 = (await mock('/__gets')).length;
    await p.goto(BASE); await p.waitForSelector('#si'); await p.fill('#si-email', 'm@x'); await p.fill('#si-pw', 'pw-m-1'); await p.click('#si-go'); await p.waitForSelector('.cover'); await p.waitForTimeout(1200);
    let g = await gets(n0);
    ok('the whole bank is downloaded once (questions, lessons, flashcards in full)', qGets(g).some(x => /select=\*/.test(x)) && g.some(x => /^lessons\?select=\*/.test(x)) && g.some(x => /^flashcards\?select=\*/.test(x)), g.join(' | '));
    ok('the dashboard shows the bank', await p.evaluate(() => bank.questions.length) === 3);
    console.log('Opening the app again');
    n0 = (await mock('/__gets')).length;
    await p.reload(); await p.waitForSelector('.cover'); await p.waitForTimeout(1200);
    g = await gets(n0);
    ok('only ids and stamps are fetched, not the whole bank', qGets(g).length >= 1 && qGets(g).every(x => /select=id,updated_at/.test(x)) && !g.some(x => /select=\*/.test(x)), g.join(' | '));
    ok('the bank is there at once, from the saved copy', await p.evaluate(() => bank.questions.length) === 3);
    console.log('After a question is edited');
    await mock('/__touch?id=q-1'); n0 = (await mock('/__gets')).length;
    await p.reload(); await p.waitForSelector('.cover'); await p.waitForTimeout(1500);
    g = await gets(n0);
    ok('just the changed question is fetched in full', g.some(x => /^questions\?select=\*&id=in\.%28%22q-1%22%29$/.test(x) || /^questions\?select=\*&id=in\./.test(x)) && !g.some(x => /^questions\?select=\*&archived/.test(x)), g.join(' | '));
    ok('and the app shows the new wording', /\(updated\)/.test(await p.evaluate(() => bank.byId['q-1'].stem)), await p.evaluate(() => bank.byId['q-1'].stem));
    ok('the other questions kept their saved copy', await p.evaluate(() => bank.questions.length) === 3 && !/\(updated\)/.test(await p.evaluate(() => bank.byId['q-2'].stem)));
    console.log('Signing out and in again');
    await p.evaluate(() => { location.hash = '#/settings'; }); await p.waitForTimeout(600);
    const out = p.locator('button:text("Sign out"), #signout, [data-signout]');
    if (await out.count()) { await out.first().click(); await p.waitForSelector('#si'); n0 = (await mock('/__gets')).length; await p.fill('#si-email', 'm@x'); await p.fill('#si-pw', 'pw-m-1'); await p.click('#si-go'); await p.waitForSelector('.cover'); await p.waitForTimeout(1200); g = await gets(n0);
      ok('signing out wipes the saved copy (a shared computer keeps nothing), so the next sign-in downloads the bank again', g.some(x => /^questions\?select=\*&archived/.test(x)) && await p.evaluate(() => bank.questions.length) === 3, g.join(' | ')); }
    ok('no page errors', errs.length === 0, errs.join('; '));
  } finally { await b.close(); }
  console.log(`\n${pass} passed, ${fail} failed`); restore(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); restore(); process.exit(1); });
