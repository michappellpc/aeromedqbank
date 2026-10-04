#!/usr/bin/env node
// Unit tests for the lesson rules (js/lvalidate.js) and a check that the bundled sample lessons pass them.
const fs = require('fs'), path = require('path'), LV = require('../js/lvalidate.js'), QV = require('../js/qvalidate.js');
const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'manifest.json'), 'utf8'));
const ctx = extra => ({ boards: man.boards, subjects: man.subjects, ids: new Set(), ...extra });
const base = () => ({ id: 'aem-test', status: 'draft', tier: 'free', boards: ['aem'], subject: 'Altitude & Decompression', title: 'T', summary: 's', blocks: [{ type: 'text', text: 'hello' }], references: ['r'] });
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`wanted ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const errs = (l, c) => LV.check(l, ctx(c)).filter(r => r.level === 'error').map(r => r.msg);
const withBlock = b => ({ ...base(), blocks: [{ type: 'text', text: 'intro' }, b] });

t('a plain lesson passes', () => eq(errs(base()), []));
t('missing id', () => { const l = base(); delete l.id; if (!errs(l).some(m => /missing id/.test(m))) throw new Error('no error'); });
t('bad id', () => { if (!errs({ ...base(), id: 'Bad Id' }).some(m => /lowercase/.test(m))) throw new Error('no error'); });
t('duplicate id', () => { const c = { ids: new Set(['aem-test']) }; if (!errs(base(), c).some(m => /duplicate/.test(m))) throw new Error('no error'); });
t('subject must belong to the board', () => { if (!errs({ ...base(), subject: 'Toxicology' }).some(m => /not listed/.test(m))) throw new Error('no error'); });
t('title required', () => { if (!errs({ ...base(), title: '' }).some(m => /title/.test(m))) throw new Error('no error'); });
t('needs a block', () => { if (!errs({ ...base(), blocks: [] }).some(m => /at least one block/.test(m))) throw new Error('no error'); });
t('too many blocks', () => { if (!errs({ ...base(), blocks: Array(81).fill({ type: 'text', text: 'x' }) }).some(m => /too many/.test(m))) throw new Error('no error'); });
t('unknown block type', () => { if (!errs(withBlock({ type: 'video' })).some(m => /unknown block type/.test(m))) throw new Error('no error'); });
t('table row width must match', () => { if (!errs(withBlock({ type: 'table', columns: ['a', 'b'], rows: [['1']] })).some(m => /exactly 2 cells/.test(m))) throw new Error('no error'); });
t('table allows an empty first header', () => eq(errs(withBlock({ type: 'table', columns: ['', 'b'], rows: [['1', '2']] })), []));
t('steps need two', () => { if (!errs(withBlock({ type: 'steps', steps: [{ title: 'a' }] })).some(m => /2 to 12 steps/.test(m))) throw new Error('no error'); });
t('chart needs numbers', () => { if (!errs(withBlock({ type: 'chart', kind: 'bar', title: 'c', categories: ['a', 'b'], series: [{ name: 's', values: [1, 'x'] }] })).some(m => /numbers/.test(m))) throw new Error('no error'); });
t('chart values must match categories', () => { if (!errs(withBlock({ type: 'chart', kind: 'line', title: 'c', categories: ['a', 'b'], series: [{ name: 's', values: [1] }] })).some(m => /exactly 2 numbers/.test(m))) throw new Error('no error'); });
t('log chart rejects zero', () => { if (!errs(withBlock({ type: 'chart', kind: 'bar', yScale: 'log', title: 'c', categories: ['a', 'b'], series: [{ name: 's', values: [0, 2] }] })).some(m => /log scale/.test(m))) throw new Error('no error'); });
t('a good chart passes', () => eq(errs(withBlock({ type: 'chart', kind: 'bar', title: 'c', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] })), []));
t('image needs a description', () => { if (!errs(withBlock({ type: 'image', image: 'private:x.png' })).some(m => /alt/.test(m))) throw new Error('no error'); });
t('image existence can be checked by the caller', () => { if (!errs(withBlock({ type: 'image', image: 'x.png', alt: 'a' }), { imageOk: () => false }).some(m => /not found/.test(m))) throw new Error('no error'); });
t('callout kind is checked', () => { if (!errs(withBlock({ type: 'callout', kind: 'loud', text: 'x' })).some(m => /kind must be/.test(m))) throw new Error('no error'); });
t('normalize drops unknown fields and defaults to a hidden draft', () => { const { clean, dropped } = LV.normalize({ id: ' x ', title: 'T', junk: 1 }); eq(dropped, ['junk']); eq([clean.id, clean.status, clean.tier], ['x', 'draft', 'pro']); });
t('paste parser understands a list of lessons in a chat reply', () => { const r = QV.parsePaste('Sure!\n```json\n' + JSON.stringify([base()]) + '\n```\nDone [really]', 'lesson'); eq(r.list.length, 1); });
t('paste parser names lessons in its errors', () => { const r = QV.parsePaste('42', 'lesson'); if (!/lesson/.test(r.error)) throw new Error(r.error); });
t('the bundled sample lessons all pass', () => {
  const ids = new Set();
  for (const f of man.lessons || []) for (const l of JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8'))) eq(errs(l, { ids }), []);
});
t('objectives: good tags pass, tidied, bad ones are errors', () => {
  eq(errs({ ...base(), objectives: ['aem:K1.E.1'] }), []);
  eq(LV.normalize({ ...base(), objectives: [' AEM:k1.E.1 ', 'aem:K1.E.1'] }).clean.objectives, ['aem:K1.E.1']);
  if (!errs({ ...base(), objectives: ['nope'] }).some(m => /objectives/.test(m))) throw new Error('bad tag accepted');
  if (!LV.FIELDS.includes('objectives')) throw new Error('not a field');
});
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
