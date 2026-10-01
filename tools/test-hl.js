#!/usr/bin/env node
// Tests for the highlight logic (js/hl.js):  node tools/test-hl.js
const H = require('../js/hl.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const T = 'Hypoxia causes confusion. Treat with 100% oxygen at once.';
const hl = (id, a, b) => ({ id, a, b, t: T.slice(a, b) });

console.log('Finding a highlight again');
t('the same place when the words still match', JSON.stringify(H.anchor(T, hl('1', 0, 7))) === '[0,7]');
t('it follows the words when text is added before them', JSON.stringify(H.anchor('New. ' + T, hl('1', 0, 7))) === '[5,12]');
t('it is dropped when the words are gone', H.anchor('Totally different text.', hl('1', 0, 7)) === null);
t('a range past the end of shorter text is not trusted', H.anchor('Hyp', hl('1', 0, 7)) === null);

console.log('Showing highlights');
t('plain text when there are none', H.render('a < b', [], esc) === 'a &lt; b');
t('a highlight is wrapped and escaped', H.render('a < b', [{ id: 'x', a: 2, b: 3, t: '<' }], esc) === 'a <mark class="hl" data-hl="x">&lt;</mark> b');
t('overlapping highlights list both ids', /data-hl="1 2"/.test(H.render(T, [hl('1', 0, 10), hl('2', 5, 15)], esc)));
t('the shown text equals the original text', H.render(T, [hl('1', 0, 10), hl('2', 5, 15)], esc).replace(/<[^>]+>/g, '') === T);
t('a highlight that cannot be found is not shown', H.render('Other text', [hl('1', 0, 7)], esc) === 'Other text');

t('segments cover the whole text in order', (() => { const g = H.segments(T, [hl('1', 3, 9)]); return g[0].a === 0 && g[g.length - 1].b === T.length && g.every((x, i) => !i || x.a === g[i - 1].b) && g.filter(x => x.ids.length).length === 1; })());

console.log('Adding');
let r = H.add(T, [], 0, 7); t('a first highlight', r.remove.length === 0 && r.put.a === 0 && r.put.b === 7 && r.put.t === 'Hypoxia');
r = H.add(T, [hl('1', 0, 7)], 5, 14); t('overlapping joins into one', JSON.stringify(r.remove) === '["1"]' && r.put.a === 0 && r.put.b === 14);
r = H.add(T, [hl('1', 0, 7)], 7, 14); t('touching, or only a space apart, joins into one', r.remove.length === 1 && r.put.a === 0 && H.add(T, [hl('1', 0, 7)], 8, 14).remove.length === 1);
r = H.add(T, [hl('1', 0, 7)], 20, 30); t('separate ones stay separate', r.remove.length === 0 && r.put.a === 20);
r = H.add(T, [hl('1', 0, 7), hl('2', 16, 24)], 3, 20); t('it can join several', r.remove.length === 2 && r.put.a === 0 && r.put.b === 24);
r = H.add(T, [], 7, 8); t('a selection of only spaces adds nothing', r === null);
r = H.add(T, [], -3, 7); t('spaces at the ends are trimmed', H.add(T, [], 7, 18).put.t === 'causes con', H.add(T, [], 7, 18).put.t);

console.log('Removing');
t('is a range already highlighted', H.covered(T, [hl('1', 0, 10)], 2, 8) && !H.covered(T, [hl('1', 0, 10)], 2, 12) && H.covered(T, [hl('1', 0, 5), hl('2', 5, 12)], 2, 10));
r = H.sub(T, [hl('1', 0, 24)], 8, 15); t('removing the middle splits it in two', r.remove.length === 1 && r.put.length === 2 && r.put[0].t === 'Hypoxia' && r.put[1].b === 24, JSON.stringify(r));
r = H.sub(T, [hl('1', 0, 24)], 0, 24); t('removing all of it leaves nothing', r.remove.length === 1 && r.put.length === 0);
r = H.sub(T, [hl('1', 0, 10)], 5, 30); t('removing past the end trims it', r.put.length === 1 && r.put[0].b === 5 || r.put[0].t === 'Hypo');
r = H.sub(T, [hl('1', 0, 7)], 30, 40); t('removing elsewhere changes nothing', r.remove.length === 0 && r.put.length === 0);

console.log('Flashcards from a highlight');
const a = T.indexOf('confusion'), b = a + 'confusion'.length;
t('the sentence around a highlight', T.slice(...H.sentence(T, a, b)) === 'Hypoxia causes confusion.');
t('the second sentence', T.slice(...H.sentence(T, T.indexOf('100%'), T.indexOf('100%') + 4)) === 'Treat with 100% oxygen at once.');
t('the front hides the highlighted words', H.blank(T, a, b) === 'Hypoxia causes [ ... ].');
t('the decimal point in 5.5 is not a sentence end', H.blank('Give 5.5 mg of drug now.', 5, 8) === 'Give [ ... ] mg of drug now.', H.blank('Give 5.5 mg of drug now.', 5, 8));
t('text with no full stop is one sentence', H.blank('no stop here', 3, 7) === 'no [ ... ] here' || H.blank('no stop here', 3, 7) === 'no[ ... ]here', H.blank('no stop here', 3, 7));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
