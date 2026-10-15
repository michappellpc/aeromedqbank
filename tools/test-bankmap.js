#!/usr/bin/env node
// Tests for the bank map (js/bankmap.js): every question reduced to its categorization and tags, plus coverage against the exam weights.
//   node tools/test-bankmap.js
const BM = require('../js/bankmap.js'), D = require('../js/outlines-data.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const q = (id, o = {}) => ({ id, boards: ['aem'], subject: 'Altitude & Decompression', topic: 'Hypoxia', difficulty: 2, status: 'reviewed', tier: 'free', stem: 'A pilot at 18,000 feet becomes confused and has tingling.', options: [{ id: 'A', text: 'secret' }], answer: 'A', explanation: 'secret explanation', objectives: [], updatedAt: '2026-10-01T10:00:00Z', ...o });
const bank = [q('a1', { objectives: ['aem:K1.E.1'] }), q('a2', { objectives: ['aem:K1.E.1', 'aem:K2.A.5'], highYield: true }), q('a3', { objectives: [] }), q('a4', { archived: true, objectives: ['aem:K3.B'] }),
  q('o1', { boards: ['om'], objectives: ['om:K1.2'] }), q('a5', { objectives: ['aem:K9.9', 'junk'] }), q('p1', { boards: ['pm'], objectives: ['pm:K2.20'] }), q('a6', { status: 'draft', objectives: ['aem:K1.E.2'] })];
const M = BM.build(bank, { now: '2026-10-16T00:00:00Z' }), row = id => M.questions.find(x => x.id === id);

console.log('Questions');
t('every question is in the map, archived ones too', M.questions.length === bank.length && row('a4').archived === true);
t('only categorization and tagging are kept: no choices, answer or explanation', M.questions.every(x => !('options' in x) && !('answer' in x) && !('explanation' in x) && !JSON.stringify(x).includes('secret')));
t('each has board, subject, topic, difficulty, status, tier, high yield, lesson, tags and domains', ['boards', 'subject', 'topic', 'difficulty', 'status', 'tier', 'high_yield', 'lesson_id', 'objectives', 'domains', 'objective_count'].every(k => k in row('a2')) && row('a2').objective_count === 2 && row('a2').high_yield === true);
t('the domains come from the tags', row('a2').domains.join() === 'aem:K1,aem:K2' && row('o1').domains.join() === 'om:I' && row('p1').domains.join() === 'pm:II');
t('a tag that is not an outline item is reported, not hidden', row('a5').unrecognized_tags.join() === 'aem:K9.9,junk' && !row('a1').unrecognized_tags);
t('a short start of the question is there to recognize it by', row('a1').stem_start.startsWith('A pilot at 18,000') && row('a1').stem_start.length <= 120);
t('the date is the day it was last changed', row('a1').updated === '2026-10-01');

console.log('Counts and coverage');
t('counts: total, archived, by status, tagged and untagged, high yield', M.counts.questions === 8 && M.counts.archived === 1 && M.counts.by_status.reviewed === 7 && M.counts.by_status.draft === 1 && M.counts.high_yield === 1, JSON.stringify(M.counts));
t('untagged means no usable tag, among questions that are not archived', M.untagged_question_ids.join() === 'a3,a5', M.untagged_question_ids.join());
const A = M.coverage.aem, d = k => A.domains.find(x => x.key === k);
t('the exam weights are carried next to each domain', A.domains.map(x => x.weight_percent).join() === '20,33,15,17,15');
t('domain counts: a question tagged twice in one domain counts once; archived questions are left out', d('K1').questions === 3 && d('K2').questions === 1 && d('K3').questions === 0, A.domains.map(x => x.questions).join());
t('the share of tagged questions and the gap to the weight are worked out', A.tagged_questions === 3 && d('K1').share_of_tagged_percent === 100 && d('K1').difference_points === 80 && d('K2').share_of_tagged_percent === 33.3 && d('K2').difference_points === 0.3, JSON.stringify([d('K1'), d('K2')].map(x => [x.share_of_tagged_percent, x.difference_points])));
const sc = c => A.statement_counts.find(s => s.code === c).questions;
t('a statement counts questions tagged to it or anywhere below it', sc('K1.E.1') === 2 && sc('K1.E') === 3 && sc('K1.E.2') === 1 && sc('K1.A') === 0, [sc('K1.E.1'), sc('K1.E'), sc('K1.E.2')].join());
t('statements without questions lists only the lowest-level ones nobody is tagged to', A.statements_without_questions.some(s => s.code === 'K1.A') && !A.statements_without_questions.some(s => s.code === 'K1.E.1') && !A.statements_without_questions.some(s => s.code === 'K1.E'));
const P = M.coverage.pm, pd = P.domains.find(x => x.key === 'II');
t('the Public Health outline reports its lettered parts with their own weights', pd.weight_percent === 35 && pd.parts.map(p => p.weight_percent).join() === '20,10,5' && pd.parts.reduce((a, p) => a + p.questions, 0) === 1);
t('every board is covered, with no division by zero when nothing is tagged', M.coverage.om.tagged_questions === 1 && BM.build([q('z')]).coverage.aem.domains.every(x => x.share_of_tagged_percent === null));

console.log('Files');
const qc = BM.questionsCsv(M).split('\r\n'), cc = BM.coverageCsv(M).split('\r\n');
t('the questions file opens in Excel: a header row, one row per question, UTF-8 marker', qc[0].startsWith('﻿id,boards,subject') && qc.filter(Boolean).length === 1 + bank.length);
t('lists are joined with semicolons and text with commas is quoted', /aem:K1\.E\.1; aem:K2\.A\.5/.test(qc[2]) && /"Altitude & Decompression"|Altitude & Decompression/.test(qc[2]));
t('the coverage file has domain, part and statement rows', cc[0].includes('exam_weight_percent') && cc.some(r => r.startsWith('aem,domain,K1,')) && cc.some(r => r.startsWith('pm,part,II.A,')) && cc.some(r => r.startsWith('aem,statement,K1.E.1,')));
t('the JSON is plain data that survives a round trip', JSON.stringify(JSON.parse(JSON.stringify(M))) === JSON.stringify(M));
const withStats = BM.build([q('a1', { objectives: ['aem:K1.E.1'] })], { stats: { a1: { attempts: 40, pct: 62 } } });
t('measured numbers are included when they are available', withStats.questions[0].answers === 40 && withStats.questions[0].percent_correct === 62 && /answers,percent_correct/.test(BM.questionsCsv(withStats)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
