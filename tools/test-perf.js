#!/usr/bin/env node
// Tests for the dashboard's performance table logic (js/perf.js):  node tools/test-perf.js
const P = require('../js/perf.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const DAY = 86400000, NOW = Date.UTC(2026, 9, 1);
const boards = [{ id: 'aem', name: 'Aerospace' }, { id: 'om', name: 'Occupational' }], subjects = { aem: ['Altitude', 'Vision'], om: ['Toxicology'] };
const mq = (id, boardIds, subject, topic) => ({ id, boards: boardIds, subject, topic, answer: 'A' });
const questions = [mq('a1', ['aem'], 'Altitude', 'Hypoxia'), mq('a2', ['aem'], 'Altitude', 'Hypoxia'), mq('a3', ['aem'], 'Altitude', 'DCS'), mq('v1', ['aem'], 'Vision', ''), mq('t1', ['om'], 'Toxicology', 'Lead'), mq('x1', ['aem', 'om'], 'Toxicology', 'Lead')];
const qstat = { a1: { seen: 2, correct: 1, wrong: 1 }, a2: { seen: 1, correct: 0, wrong: 1 }, a3: { seen: 1, correct: 1, wrong: 0 }, t1: { seen: 3, correct: 3, wrong: 0 } };
// newest first, as the app keeps them
const mt = (daysAgo, answers) => ({ id: 't' + daysAgo + Math.random(), date: NOW - daysAgo * DAY, qids: Object.keys(answers), answers });
const tests = [mt(1, { a1: 'A', a2: 'B', t1: 'A' }), mt(3, { a1: 'B', a3: 'A' }), mt(8, { a1: 'A', v1: 'A' }), mt(15, { a2: 'A' }), mt(40, { a1: 'B', a2: 'B', a3: 'B' }), mt(60, { t1: 'B' })];
const peer = { a1: { users: 10, pct: 60 }, a3: { users: 10, pct: 80 } };

console.log('Which tests are recent');
t('the last 5 tests', P.recentTests(tests, 't5', NOW).length === 5);
t('the last 10 tests (there are only 6)', P.recentTests(tests, 't10', NOW).length === 6);
t('the last 30 days', P.recentTests(tests, 'd30', NOW).length === 4);
t('an unknown mode falls back to the last 5', P.recentTests(tests, 'zzz', NOW).length === 5);
t('no tests is fine', P.recentTests([], 't5', NOW).length === 0 && P.recentTests(null, 'd30', NOW).length === 0);

console.log('By subject');
let r = P.aggregate({ group: 'subject', questions, boards, subjects, qstat, tests, peer, recent: 't5', now: NOW });
const sub = n => r.rows.find(x => x.subject === n && (x.boardId === 'aem' || n !== 'Toxicology'));
t('one row per subject under its board, in the manifest\'s order', r.rows.map(x => x.boardId + ':' + x.subject).join() === 'aem:Altitude,aem:Vision,aem:Toxicology,om:Toxicology', r.rows.map(x => x.boardId + ':' + x.subject).join());
t('questions in the bank, used, and overall score', sub('Altitude').total === 3 && sub('Altitude').seen === 3 && sub('Altitude').overall === 50 && sub('Altitude').on === 4, JSON.stringify(sub('Altitude')));
t('the board name is shown', sub('Altitude').board === 'Aerospace');
t('the recent score counts only answered questions in the chosen tests', sub('Altitude').rn === 9 && sub('Altitude').rc === 4 && sub('Altitude').recent === 44, JSON.stringify([sub('Altitude').rn, sub('Altitude').rc]));
t('and a recent window of 30 days leaves out the older test', P.aggregate({ group: 'subject', questions, boards, subjects, qstat, tests, recent: 'd30', now: NOW }).rows[0].rn === 6);
t('change is recent minus overall', sub('Altitude').change === -6);
t('a subject with nothing answered has no scores', sub('Vision').overall === null && sub('Vision').recent === 100 && sub('Vision').rn === 1);
t('the group score is the answer-weighted average', sub('Altitude').group === 70, String(sub('Altitude').group));
t('a question on two boards counts under both', r.rows.filter(x => x.subject === 'Toxicology').every(x => x.total >= 1) && r.rows.find(x => x.boardId === 'aem' && x.subject === 'Toxicology').total === 1 && r.rows.find(x => x.boardId === 'om' && x.subject === 'Toxicology').total === 2);
t('the overall recent score across everything in the window', r.recentAnswered === 11 && r.recentCorrect === 6 && r.recentScore === 55, JSON.stringify([r.recentAnswered, r.recentCorrect]));

console.log('By topic');
r = P.aggregate({ group: 'topic', questions, boards, subjects, qstat, tests, peer, recent: 't5', now: NOW });
t('one row per topic, a question counted once, in A to Z order of subject then topic', r.rows.map(x => x.label).join('|') === 'Altitude: DCS|Altitude: Hypoxia|Toxicology: Lead|Vision: No topic set', r.rows.map(x => x.label).join('|'));
const hyp = r.rows.find(x => x.topic === 'Hypoxia');
t('a topic\'s totals and scores', hyp.total === 2 && hyp.on === 3 && hyp.overall === 33 && hyp.rn === 7, JSON.stringify([hyp.total, hyp.on, hyp.overall, hyp.rn]));
t('a question with no topic is labelled', r.rows.some(x => x.label === 'Vision: No topic set'));
t('a topic spanning boards is not split', r.rows.filter(x => x.topic === 'Lead').length === 1 && r.rows.find(x => x.topic === 'Lead').total === 2);

console.log('Sorting');
r = P.aggregate({ group: 'topic', questions, boards, subjects, qstat, tests, peer, recent: 't5', now: NOW });
const ord = (sort, show) => P.sortRows(r.rows, sort, show).map(x => x.topic || 'none').join();
t('weakest first by overall, rows with no answers last', ord('weak', 'overall').split(',')[0] === 'Hypoxia' && ord('weak', 'overall').split(',').slice(-1)[0] === 'none', ord('weak', 'overall'));
t('strongest first by overall', ord('strong', 'overall').split(',')[0] === 'Lead' || ord('strong', 'overall').split(',')[0] === 'DCS', ord('strong', 'overall'));
t('weakest by recent uses the recent score', (() => { const o = P.sortRows(r.rows, 'weak', 'recent').filter(x => x.recent !== null); return o.every((x, i) => !i || o[i - 1].recent <= x.recent); })());
t('most answered and least answered', P.sortRows(r.rows, 'most', 'overall')[0].on >= P.sortRows(r.rows, 'most', 'overall')[1].on && P.sortRows(r.rows, 'least', 'overall')[0].on === 0);
t('biggest improvement puts the largest positive change first and rows without a change last', (() => { const o = P.sortRows(r.rows, 'up', 'both'); return o[0].change >= (o[1].change ?? -999) && o[o.length - 1].change === null; })());
t('biggest drop puts the most negative first', (() => { const o = P.sortRows(r.rows, 'down', 'both').filter(x => x.change !== null); return o.every((x, i) => !i || o[i - 1].change <= x.change); })());
t('A to Z', P.sortRows(r.rows, 'az', 'both').map(x => x.label).join() === r.rows.map(x => x.label).sort((a, b) => a.localeCompare(b)).join());
t('sorting leaves the original list alone', r.rows[0].label === P.aggregate({ group: 'topic', questions, boards, subjects, qstat, tests, peer, recent: 't5', now: NOW }).rows[0].label);

console.log('Settings');
t('defaults', JSON.stringify(P.clean()) === JSON.stringify(P.DEFAULTS) && P.DEFAULTS.show === 'both' && P.DEFAULTS.group === 'subject');
t('bad values are replaced by the defaults', JSON.stringify(P.clean({ group: 'x', show: 'y', recent: 'z', sort: 'q' })) === JSON.stringify(P.DEFAULTS));
t('good values are kept', P.clean({ group: 'topic', show: 'recent', recent: 'd30', sort: 'az' }).sort === 'az' && P.clean({ show: 'overall' }).show === 'overall');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
