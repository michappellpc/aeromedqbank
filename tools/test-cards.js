#!/usr/bin/env node
// Tests for the flashcard scheduler (js/cardsched.js) and checker (js/cvalidate.js):  node tools/test-cards.js
const S = require('../js/cardsched.js'), V = require('../js/cvalidate.js'), QV = require('../js/qvalidate.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const D0 = '2026-10-01';

console.log('Dates');
t('adding days crosses month and year ends', S.addDays('2026-10-30', 3) === '2026-11-02' && S.addDays('2026-12-31', 1) === '2027-01-01' && S.addDays('2028-02-28', 1) === '2028-02-29');
t('today is the device date in YYYY-MM-DD', /^\d{4}-\d\d-\d\d$/.test(S.today()) && S.today(new Date(2026, 0, 5)) === '2026-01-05');

console.log('Scheduling');
let s = S.rate(null, 3, D0);
t('a new card rated Good comes back tomorrow', s.i === 1 && s.due === '2026-10-02' && s.reps === 1, JSON.stringify(s));
s = S.rate(s, 3, '2026-10-02'); t('then in 3 days', s.i === 3 && s.due === '2026-10-05', JSON.stringify(s));
s = S.rate(s, 3, '2026-10-05'); t('then grows by the ease (3 x 2.5 is 8)', s.i === 8 && s.due === '2026-10-13', JSON.stringify(s));
t('Good leaves the ease alone', s.e === 2.5);
let a = S.rate(S.rate(S.rate(null, 3, D0), 3, D0), 1, D0);
t('Again sends it straight back, counts a lapse and lowers the ease', a.i === 0 && a.due === D0 && a.reps === 0 && a.lapses === 1 && a.e === 2.3, JSON.stringify(a));
t('Again on a brand-new card is not a lapse', S.rate(null, 1, D0).lapses === 0);
t('Easy on a new card waits 4 days and raises the ease', (() => { const n = S.rate(null, 4, D0); return n.i === 4 && n.e === 2.65; })());
t('Hard waits less than Good and lowers the ease', (() => { const base = S.rate(S.rate(null, 3, D0), 3, D0); const h = S.rate(base, 2, D0), g = S.rate(base, 3, D0); return h.i < g.i && h.e < base.e; })());
t('the ease never drops below 1.3', (() => { let x = null; for (let i = 0; i < 20; i++) x = S.rate(x, 1, D0); return x.e === 1.3; })());
t('the ease never rises above 3', (() => { let x = null; for (let i = 0; i < 20; i++) x = S.rate(x, 4, D0); return x.e === 3; })());
t('an interval never passes ten years', (() => { let x = null; for (let i = 0; i < 40; i++) x = S.rate(x, 4, D0); return x.i <= 3650; })());
t('rating does not change the state it was given', (() => { const o = S.rate(null, 3, D0), copy = JSON.stringify(o); S.rate(o, 4, D0); return JSON.stringify(o) === copy; })());
t('each later rating pushes the interval out more for Easy than Good', (() => { const base = S.rate(S.rate(null, 3, D0), 3, D0); return S.rate(base, 4, D0).i > S.rate(base, 3, D0).i; })());
t('button labels say when the card returns', S.preview(null, 1, D0) === 'today' && S.preview(null, 3, D0) === '1 day' && S.preview(null, 4, D0) === '4 days');

console.log('Today\'s session');
const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id }));
const st = { a: { e: 2.5, i: 3, due: '2026-09-29', reps: 2, lapses: 0 }, b: { e: 2.5, i: 3, due: '2026-10-01', reps: 2, lapses: 0 }, c: { e: 2.5, i: 8, due: '2026-10-09', reps: 3, lapses: 0 } };
t('due cards come first, oldest first, then new ones', S.queue(cards, st, D0).map(c => c.id).join('') === 'abdef');
t('a card due in the future is left alone', !S.queue(cards, st, D0).some(c => c.id === 'c'));
t('new cards are limited per day', S.queue(cards, st, D0, { newPerDay: 1 }).map(c => c.id).join('') === 'abd');
t('and what was already started today counts against the limit', S.queue(cards, st, D0, { newPerDay: 2, newSeenToday: 2 }).map(c => c.id).join('') === 'ab');
t('counts match the session', (() => { const k = S.counts(cards, st, D0, { newPerDay: 2 }); return k.due === 2 && k.new === 2 && k.newTotal === 3 && k.total === 6 && k.learned === 1; })());
t('an empty deck is safe', S.queue([], {}, D0).length === 0 && S.counts([], {}, D0).total === 0);

console.log('Card rules');
const boards = [{ id: 'aem' }, { id: 'om' }], subjects = { aem: ['Altitude & Decompression'], om: ['Toxicology'] };
const good = () => ({ id: 'aem-card-001', status: 'draft', boards: ['aem'], subject: 'Altitude & Decompression', topic: 'Hypoxia', front: 'Which type of hypoxia can a pulse oximeter miss?', back: 'Hypemic (for example carbon monoxide): SpO2 can read falsely normal.', references: ['Ref'] });
const run = (c, over = {}) => V.check(c, { boards, subjects, ids: new Set(), fronts: new Map(), ...over });
const errs = r => r.filter(x => x.level === 'error').map(x => x.msg), warns = r => r.filter(x => x.level === 'warn').map(x => x.msg);
t('a good card has no errors or warnings', run(good()).length === 0, JSON.stringify(run(good())));
t('a front is required', errs(run({ ...good(), front: '  ' })).includes('missing front'));
t('a back is required', errs(run({ ...good(), back: '' })).includes('missing back'));
t('too-long text is an error, long text a warning', errs(run({ ...good(), front: 'x'.repeat(601) })).includes('front is longer than 600 characters') && warns(run({ ...good(), front: 'x'.repeat(350) })).some(m => /front is long/.test(m)) && errs(run({ ...good(), back: 'x'.repeat(1501) })).length === 1);
t('front and back must differ', errs(run({ ...good(), back: 'Which type of hypoxia can a pulse oximeter miss' })).includes('front and back are the same'));
t('duplicate ids and fronts are caught', (() => { const c = { ids: new Set(), fronts: new Map() }; run(good(), c); return errs(run(good(), c)).includes('duplicate id') && errs(run({ ...good(), id: 'aem-card-002', front: 'Which TYPE of hypoxia can a pulse oximeter miss?!' }, c)).some(m => /front duplicates/.test(m)); })());
t('the subject must belong to the board', errs(run({ ...good(), subject: 'Toxicology' })).some(m => /not listed for board/.test(m)));
t('bad ids and statuses are errors', errs(run({ ...good(), id: 'Bad_ID' })).some(m => /lowercase/.test(m)) && errs(run({ ...good(), status: 'live' })).length === 1);
t('a lesson link must look like a lesson id, and an unknown one is only a warning', errs(run({ ...good(), lessonId: 'Not Valid' })).length === 1 && warns(run({ ...good(), lessonId: 'nope-lesson' }, { lessonIds: new Set(['x']) })).some(m => /does not match any lesson/.test(m)) && errs(run({ ...good(), lessonId: 'x' }, { lessonIds: new Set(['x']) })).length === 0);
t('missing references is a warning', warns(run({ ...good(), references: [] })).includes('no references'));
t('normalize drops unknown fields and trims', (() => { const n = V.normalize({ id: ' a-1 ', front: ' F ', back: 'B', junk: 1, status: undefined }); return n.clean.id === 'a-1' && n.clean.front === 'F' && n.dropped.includes('junk') && n.clean.status === 'draft'; })());
t('a pasted { cards: [...] } reply is understood', (() => { const p = QV.parsePaste('```json\n{"cards":[{"id":"x"}]}\n```', 'card'); return p.list && p.list.length === 1; })());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
