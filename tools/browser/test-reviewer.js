#!/usr/bin/env node
// Browser test for the reviewer flow: a reviewer edits and writes, nothing reaches the bank, and an admin accepts, edits first or declines.
// Start the helpers first:  node tools/browser/mock-supabase.js &  node tools/browser/serve.js &   then  node tools/browser/test-reviewer.js
// (needs playwright and axe-core; set CHROMIUM to a browser path if needed). It points data/config.json at the stand-in while it runs and restores it.
const fs = require('fs'), { chromium } = require('playwright'), path = require('path'), http = require('http');
const REPO = path.resolve(__dirname, '..', '..'), CFG = REPO + '/data/config.json', BASE = 'http://localhost:8132/qbank/';
const orig = fs.readFileSync(CFG, 'utf8'), cfg = JSON.parse(orig); cfg.supabase = { url: 'http://localhost:9998', anonKey: 'anon-test-key' };
const restore = () => { try { fs.writeFileSync(CFG, orig); } catch { /* done */ } };
process.on('exit', restore); process.on('SIGINT', () => process.exit(1));
let pass = 0, fail = 0; const ok = (d, c, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'pass' : 'FAIL'}  ${d}${c ? '' : '   ' + String(x).slice(0, 400)}`); };
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const getLog = () => new Promise(r => http.get('http://localhost:9998/__log', res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d))); }));
(async () => {
  fs.writeFileSync(CFG, JSON.stringify(cfg));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }), errs = [];
  const open = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }), p = await c.newPage(); p.setDefaultTimeout(8000); p.on('pageerror', e => errs.push(e.message)); return [c, p]; };
  const login = async (p, e, w) => { await p.goto(BASE); await p.waitForSelector('#si'); await p.fill('#si-email', e); await p.fill('#si-pw', w); await p.click('#si-go'); await p.waitForSelector('.cover, h2'); await p.waitForTimeout(700); };
  const go = async (p, h) => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(700); };
  const hash = p => p.evaluate(() => location.hash);
  const axe = async (p, label) => { for (const s of ['light', 'dark']) { await p.emulateMedia({ colorScheme: s }); await p.waitForTimeout(250); await p.evaluate(AXE); const v = await p.evaluate(async () => (await axe.run(document)).violations.map(x => x.id + ' ' + x.nodes.map(n => n.target.join(' ')).join(' | '))); ok(`${label}: no accessibility problems (${s})`, !v.length, v.join('; ')); } await p.emulateMedia({ colorScheme: 'light' }); };
  const yes = async p => { await p.click('.modal [data-y]'); await p.waitForTimeout(500); };
  const IMPORT = JSON.stringify([{ id: 'aem-rev-001', boards: ['aem'], subject: 'Altitude & Decompression', stem: 'Which gas law explains why trapped gas expands as a pilot climbs?', options: [{ id: 'A', text: "Boyle's law" }, { id: 'B', text: "Dalton's law" }, { id: 'C', text: "Henry's law" }, { id: 'D', text: "Graham's law" }], answer: 'A', explanation: "Boyle's law: at constant temperature, gas volume is inversely related to pressure, so trapped gas expands as ambient pressure falls." }]);
  try {
    console.log('Reviewer');
    let [c, p] = await open(); await login(p, 'rev@x', 'pw-rev-1');
    await go(p, '#/admin/questions');
    const tabs = (await p.locator('.tabs a').allInnerTexts()).map(x => x.trim());
    ok('the reviewer tabs are Questions, Lessons, Flashcards, Performance, My changes (no Inbox, no Overview)', JSON.stringify(tabs) === JSON.stringify(['Questions', 'Lessons', 'Flashcards', 'Performance', 'My changes']), tabs.join(','));
    await go(p, '#/admin/inbox');
    ok('the inbox is not open to a reviewer: it goes back to Questions', /#\/admin\/questions/.test(await hash(p)), await hash(p));
    ok('no "Apply high yield list" or "Apply topic list" for a reviewer', await p.locator('#hyapply, #tpapply').count() === 0);
    ok('the list has no Tier filter for a reviewer', !(await p.locator('#ft').isVisible()));
    await p.check('[data-sel="q-1"]'); await p.waitForTimeout(200);
    const bulk = (await p.locator('#bulk button').allInnerTexts()).map(x => x.trim());
    ok('selecting a question offers only Copy and Clear (no publish, archive, delete)', bulk.every(x => /Copy|Clear|CSV/i.test(x)) && bulk.length >= 2, bulk.join(','));
    await go(p, '#/admin/questions/edit/q-1');
    ok('the editor says changes go to an admin first', await p.locator('#chg-banner').isVisible());
    ok('the status box is locked', await p.locator('#f-status').isDisabled());
    ok('there is no free or pro choice for a reviewer', !(await p.locator('#f-tier').isVisible()));
    ok('there is no Archive or Delete button', await p.locator('#archive, #restore, #del').count() === 0);
    ok('the save button says Submit for approval', /Submit for approval/.test(await p.innerText('#save')));
    await axe(p, 'The reviewer editor');
    await p.fill('#f-stem', 'Question 1 with a clearer wording?'); await p.fill('#f-note', 'Clearer wording');
    await p.click('#save'); await p.waitForTimeout(900);
    ok('after saving a reviewer lands on My changes', /#\/admin\/changes/.test(await hash(p)), await hash(p));
    let log = await getLog();
    ok('nothing was written to the question bank directly', !log.some(x => /questions/.test(x)), log.join(','));
    ok('My changes lists the waiting change', /q-1/.test(await p.innerText('#ch-list')) && /Waiting/i.test(await p.innerText('#ch-list')));
    await axe(p, 'My changes');
    // a reviewer's import is a batch of proposals
    await go(p, '#/admin/questions/import'); await p.fill('#paste', IMPORT); await p.waitForTimeout(900);
    ok('the import button says Send for approval', /Send for approval/i.test(await p.innerText('#go')), await p.innerText('#go'));
    await p.click('#go'); await p.waitForTimeout(900);
    ok('the import reports it was sent for approval', /for approval/i.test(await p.innerText('#res')));
    // an edit to another question, to be declined
    await go(p, '#/admin/questions/edit/q-3'); await p.fill('#f-stem', 'Question 3 reworded?'); await p.click('#save'); await p.waitForTimeout(800);
    // and one the admin will edit first
    await go(p, '#/admin/questions/edit/q-2'); await p.fill('#f-stem', 'Question 2 reworded by the reviewer?'); await p.click('#save'); await p.waitForTimeout(800);
    await go(p, '#/admin/performance');
    ok('Performance shows totals with no member names', /Totals only/.test(await p.innerText('#app')) && /By subject/.test(await p.innerText('#app')) && !/@x/.test(await p.innerText('#app')));
    await axe(p, 'Performance');
    await c.close();

    console.log('Admin');
    [c, p] = await open(); await login(p, 'admin@x', 'pw-admin-1');
    ok('the menu badge counts the waiting changes', /4/.test(await p.innerText('#inbox-badge')), await p.innerText('#inbox-badge'));
    await go(p, '#/admin/changes');
    const at = (await p.locator('.tabs a').allInnerTexts()).map(x => x.trim().replace(/\s+/g, ' '));
    ok('the admin tabs include Changes with the count, and Inbox', at.some(x => /^Changes 4/.test(x)) && at.includes('Inbox'), at.join(','));
    ok('the list shows who sent each change', /rev@x/.test(await p.innerText('#ch-list')) && (await p.locator('#ch-list tbody tr').count()) === 4);
    await axe(p, 'Changes to review');
    await p.click('#ch-list a[href$="/1"]'); await p.waitForTimeout(700);
    ok('the detail shows the word changes', await p.locator('.chg.changed ins').count() > 0 && await p.locator('.chg.changed del').count() > 0);
    ok('it shows the reviewer\'s note', /Clearer wording/.test(await p.innerText('#app')));
    await axe(p, 'A change in detail');
    await p.click('#ch-ok'); await p.waitForTimeout(800);
    log = await getLog();
    ok('accepting an edit to a live question keeps it live', log.includes('accepted q-1 as reviewed'), log.join(','));
    ok('back on the list with the rest still waiting', /#\/admin\/changes/.test(await hash(p)) && (await p.locator('#ch-list tbody tr').count()) === 3);
    // the new question: land as draft by default; publish asks first
    await p.click('#ch-list a[href*="/changes/"]:text("aem-rev-001")'); await p.waitForTimeout(700);
    ok('a new question defaults to "Save as a draft"', await p.locator('input[name=land][value=draft]').isChecked());
    await p.check('input[name=land][value=reviewed]'); await p.click('#ch-ok'); await p.waitForSelector('.modal [data-y]'); await yes(p);
    log = await getLog();
    ok('publishing a new question makes it live', log.includes('accepted aem-rev-001 as reviewed'), log.join(','));
    // decline one with a reason
    await p.click('#ch-list a[href*="/changes/"]:text("q-3")'); await p.waitForTimeout(700);
    await p.fill('#ch-note', 'The original wording was clearer.'); await p.click('#ch-no'); await p.waitForTimeout(800);
    ok('declining removes it from the waiting list', (await p.locator('#ch-list tbody tr').count()) === 1);
    // edit first, then accept
    await p.click('#ch-list a[href*="/changes/"]:text("q-2")'); await p.waitForTimeout(700);
    await p.click('a:text("Edit first, then accept")'); await p.waitForSelector('#chg-banner');
    ok('the editor opens with the reviewer\'s wording and a banner', (await p.inputValue('#f-stem')) === 'Question 2 reworded by the reviewer?' && /Finishing a reviewer/.test(await p.innerText('#chg-banner')));
    ok('its save button says Accept with my changes', /Accept with my changes/.test(await p.innerText('#save')));
    await p.fill('#f-stem', 'Question 2, as the admin finished it?'); await p.click('#save'); await p.waitForTimeout(900);
    log = await getLog();
    ok('the admin\'s edited version is accepted', log.includes('accepted q-2 as reviewed') && /#\/admin\/changes/.test(await hash(p)), log.join(',') + ' ' + await hash(p));
    ok('nothing is left waiting', /Nothing is waiting/.test(await p.innerText('#ch-list')));
    await go(p, '#/admin/inbox'); ok('the admin can still open the inbox', /#\/admin\/inbox/.test(await hash(p)));
    await c.close();

    console.log('Reviewer sees the decisions');
    [c, p] = await open(); await login(p, 'rev@x', 'pw-rev-1'); await go(p, '#/admin/changes');
    await p.selectOption('#ch-show', 'rejected'); await p.waitForTimeout(300);
    ok('the reviewer can read why a change was not accepted', /Not accepted/.test(await p.innerText('#ch-list')) && /original wording was clearer/.test(await p.innerText('#ch-list')));
    await p.selectOption('#ch-show', 'accepted'); await p.waitForTimeout(300);
    ok('and sees what was accepted', (await p.locator('#ch-list tbody tr').count()) === 3);
    await c.close();

    console.log('View as a reviewer (admin)');
    [c, p] = await open(); await login(p, 'admin@x', 'pw-admin-1');
    await p.click('#viewsw-btn'); await p.click('#viewsw-menu [data-v=reviewer]'); await p.waitForSelector('.tabs'); await p.waitForTimeout(500);
    const vt = (await p.locator('.tabs a').allInnerTexts()).map(x => x.trim());
    ok('the admin looking as a reviewer sees the reviewer tabs', JSON.stringify(vt) === JSON.stringify(['Questions', 'Lessons', 'Flashcards', 'Performance', 'My changes']), vt.join(','));
    await c.close();
    ok('no page errors', errs.length === 0, errs.join('; '));
  } finally { await b.close(); }
  console.log(`\n${pass} passed, ${fail} failed`); restore(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); restore(); process.exit(1); });
