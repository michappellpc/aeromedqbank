#!/usr/bin/env node
// Tests for js/related.js:  node tools/test-related.js
const fs = require('fs'), path = require('path'), R = require('../js/related.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const lessons = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'lessons', 'sample.json'), 'utf8'));
const qs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'questions', 'sample.json'), 'utf8'));
const pick = id => R.match(qs.find(q => q.id === id), lessons);
const id = r => r && r.lesson.id;

console.log('Related lessons');
t('a hypoxia question finds the hypoxia lesson', id(pick('sample-001')) === 'aem-hypoxia-types', JSON.stringify(pick('sample-001') && pick('sample-001').score));
t('a screening test question finds the sensitivity and specificity lesson', id(pick('sample-003')) === 'pm-screening-test-performance');
t('questions no lesson covers get no link', pick('sample-002') === null && pick('sample-004') === null, id(pick('sample-002')) + ' / ' + id(pick('sample-004')));
const hyp = { subject: 'Aviation Physiology', topic: 'Hypoxia', stem: 'A pilot at 18,000 ft develops hypoxia. Which type applies?', options: [{ id: 'A', text: 'Hypoxic hypoxia' }], answer: 'A', explanation: 'Low alveolar oxygen.' };
t('a lesson in a different subject can still be the best match', id(R.match(hyp, lessons)) === 'aem-hypoxia-types');
t('no lessons, no match', R.match(hyp, []) === null && R.match(hyp, null) === null);
t('a blank question is not matched to anything', R.match({ subject: 'x', stem: 'Which of the following is true?', options: [], answer: 'A' }, lessons) === null);
t('words ignore plurals and filler', R.words('Thresholds were those patients').has('threshold') && !R.words('Which of these patients').has('patient'));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
