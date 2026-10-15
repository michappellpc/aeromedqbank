#!/usr/bin/env node
// Tests for the board outline chart logic (js/outlinechart.js) and the exam weights in js/outlines-data.js.
//   node tools/test-outlinechart.js
const OC = require('../js/outlinechart.js'), D = require('../js/outlines-data.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };

console.log('Weights');
for (const b of Object.keys(D)) {
  const w = D[b].weights || {}, sum = Object.values(w).reduce((a, x) => a + x, 0), L = OC.layout(b);
  t(`${b}: the exam weights add up to 100`, sum === 100, String(sum));
  const keys = new Set(); L.domains.forEach(d => (d.parts.length ? d.parts.map(p => p.key) : [d.key]).forEach(k => keys.add(k)));
  t(`${b}: every weight belongs to a domain or part of the outline, and every domain has one`, [...keys].every(k => w[k] > 0) && Object.keys(w).every(k => keys.has(k)), [...keys].join() + ' vs ' + Object.keys(w).join());
  t(`${b}: a domain's weight is its own, or the sum of its parts`, L.domains.every(d => d.weight === (d.parts.length ? d.parts.reduce((a, p) => a + p.weight, 0) : w[d.key])));
}
const aem = OC.layout('aem'), pm = OC.layout('pm');
t('Aerospace Medicine has five domains with the published weights 20, 33, 15, 17, 15', aem.domains.map(d => d.weight).join() === '20,33,15,17,15', aem.domains.map(d => d.weight).join());
t('the Public Health outline splits Public and Population Health (35) and Epidemiology (20) into parts', pm.domains.find(d => d.key === 'II').weight === 35 && pm.domains.find(d => d.key === 'II').parts.length === 3 && pm.domains.find(d => d.key === 'III').weight === 20);
t('domain names are the board\'s own', aem.domains[0].name === 'The Human within the Flight Environment' && D.om.items.some(i => i.domainName === 'Clinical Occupational Medicine'));

console.log('Roll-up');
const qs = [
  { id: 'q1', boards: ['aem'], objectives: ['aem:K1.E.1'] },
  { id: 'q2', boards: ['aem'], objectives: ['aem:K1.E.1', 'aem:K1.E.2', 'aem:K2.A'] },       // two items in one section: counted once for the section and the domain
  { id: 'q3', boards: ['aem'], objectives: [] },
  { id: 'q4', boards: ['om'], objectives: ['om:K1.2'] },
  { id: 'q5', boards: ['aem'], objectives: ['om:K1.2', 'aem:K9.9'] },                        // another board's tag and a code that does not exist
  { id: 'q6', boards: ['pm'], objectives: ['pm:K2.20'] }];
const totals = [{ question_id: 'q1', attempts: 10, correct: 5 }, { question_id: 'q2', attempts: 20, correct: 15 }, { question_id: 'q3', attempts: 30, correct: 6 }, { question_id: 'q4', attempts: 99, correct: 99 }, { question_id: 'q5', attempts: 8, correct: 4 }, { question_id: 'nope', attempts: 50, correct: 50 }];
const R = OC.rollup('aem', qs, totals), d1 = R.domains.find(d => d.key === 'K1'), d2 = R.domains.find(d => d.key === 'K2'), row = c => d1.rows.find(r => r.code === c);
t('a domain totals the answers on questions tagged inside it', d1.attempts === 30 && d1.correct === 20 && d1.pct === 67, JSON.stringify([d1.attempts, d1.correct, d1.pct]));
t('a question tagged to two items of one domain counts once for that domain', d1.attempts === 30);
t('a question tagged in two domains counts for both', d2.attempts === 20 && d2.correct === 15 && d2.pct === 75);
t('a statement totals its own questions', row('K1.E.1').attempts === 30 && row('K1.E.2').attempts === 20 && row('K1.E.1').pct === 67);
t('a section totals the questions under it, once each', row('K1.E').attempts === 30 && row('K1.E').correct === 20);
t('a statement with no answers has no percent', row('K1.A').attempts === 0 && row('K1.A').pct === null);
t('a question for another board is left off this chart, and a tag that is another board\'s or not an outline item does not place a question', R.placed.attempts === 30 && R.unplaced.attempts === 38, JSON.stringify([R.placed, R.unplaced]));
t('untagged answers are counted apart (q3 and the question with no usable tag)', R.unplaced.attempts === 30 + 8, JSON.stringify(R.unplaced));
t('and the share placed on the outline is worked out', R.share === Math.round(100 * 30 / 68), String(R.share));
t('answers for a question the bank does not have are ignored', R.placed.attempts + R.unplaced.attempts === 68);
const Rom = OC.rollup('om', qs, totals);
t('each board has its own chart: the Occupational Medicine one gets only its own tag', Rom.domains.find(d => d.key === 'I').attempts === 99 && Rom.domains.filter(d => d.attempts).length === 1, JSON.stringify(Rom.domains.map(d => d.attempts)));
const Rpm2 = OC.rollup('pm', [{ id: 'z', boards: ['pm'], objectives: ['pm:K2.20'] }], [{ question_id: 'z', attempts: 12, correct: 9 }]);
const dd = Rpm2.domains.find(d => d.key === 'II');
t('a Public Health tag counts for its domain and for the part it sits in', dd.attempts === 12 && dd.parts.filter(p => p.attempts === 12).length === 1, JSON.stringify(dd.parts.map(p => [p.key, p.attempts])));
t('statements are listed in the board\'s order with their depth', d1.rows[0].code === 'K1.A' && row('K1.E.1').depth > row('K1.E').depth);
t('an unknown board gives nothing', OC.rollup('xx', qs, totals) === null && OC.layout('xx') === null);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
