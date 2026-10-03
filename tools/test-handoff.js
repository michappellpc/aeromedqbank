#!/usr/bin/env node
// Tests for "Copy" (js/handoff.js): the message it builds, and that what it sends is exactly what Import from a chat accepts.
//   node tools/test-handoff.js
const H = require('../js/handoff.js'), QV = require('../js/qvalidate.js'), LV = require('../js/lvalidate.js'), CV = require('../js/cvalidate.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const mq = i => ({ id: 'q-' + i, status: 'reviewed', reviewedBy: 'someone@x', archived: false, updatedAt: '2026-01-01', updatedBy: 'x', boards: ['aem'], subject: 'Altitude & Decompression', topic: 'Hypoxia', difficulty: 2, tier: 'pro',
  stem: 'A 30-year-old pilot at 18,000 ft develops tingling and confusion. What is the best first action?', options: [{ id: 'A', text: 'Descend' }, { id: 'B', text: 'Give fluids' }, { id: 'C', text: 'Climb' }, { id: 'D', text: 'Wait' }], answer: 'A',
  explanation: 'Hypoxia is treated by 100% oxygen and descent.', optionNotes: { B: 'Not the problem.', C: 'Worse.', D: 'Dangerous.' }, references: ['Ref'] });
const after = (text, marker) => JSON.parse(text.slice(text.indexOf(marker) + marker.length));
const errs = r => r.filter(x => x.level === 'error').map(x => x.msg);
const BANK = { boards: [{ id: 'aem', name: 'AM' }], subjects: { aem: ['Altitude & Decompression'] } };

console.log('Questions');
const qs = [1, 2, 3].map(mq);
let text = H.build('questions', qs, { task: 'harder', note: 'Keep my explanations short.' });
t('it says what to do, with my note, and how many', /TASK: Rewrite each question to be harder/.test(text) && /MY NOTE: Keep my explanations short\./.test(text) && /Below are 3 questions/.test(text));
t('it explains how to answer so the reply can be imported', /ONE JSON array/.test(text) && /"status": "draft"/.test(text) && /same format/.test(text));
let data = after(text, 'THE QUESTIONS:\n');
t('the data is a JSON array of the questions', Array.isArray(data) && data.length === 3 && data.map(x => x.id).join() === 'q-1,q-2,q-3');
t('every item is marked draft', data.every(x => x.status === 'draft'));
t('internal fields (who reviewed, update times, archived) are not sent', data.every(x => !('reviewedBy' in x) && !('updatedAt' in x) && !('archived' in x) && !('updatedBy' in x)));
t('what is sent is exactly what Import from a chat accepts', data.every(x => { const r = QV.check(QV.normalize(x).clean, { boards: BANK.boards, subjects: BANK.subjects, ids: new Set(), stems: new Map(), label: x.id, recordsReviewer: true }); return errs(r).length === 0; }), JSON.stringify(data.map(x => errs(QV.check(QV.normalize(x).clean, { boards: BANK.boards, subjects: BANK.subjects, ids: new Set(), stems: new Map(), label: x.id, recordsReviewer: true })))));
t('an empty note leaves no note line', !/MY NOTE/.test(H.build('questions', qs, { task: 'review', note: '   ' })));
t('each task has its own instruction', ['review', 'harder', 'easier', 'explain', 'custom'].every(k => H.build('questions', qs, { task: k }).includes(H.TASKS.questions.find(x => x[0] === k)[2])));
t('performance lines are added when given', /HOW THEY HAVE BEEN PERFORMING/.test(H.build('questions', qs, { task: 'harder', stats: { 'q-1': 'q-1: 92% correct' } })) && /- q-1: 92% correct/.test(H.build('questions', qs, { task: 'harder', stats: { 'q-1': 'q-1: 92% correct' } })));
t('and left out when not', !/PERFORMING/.test(text));
t('a part says which part it is', /This is part 2 of 3\./.test(H.build('questions', qs, { task: 'review', part: [1, 3] })) && !/This is part/.test(H.build('questions', qs, { task: 'review', part: [0, 1] })));
t('a long list is split into parts of a sensible size', H.chunk(Array.from({ length: 45 }, (_, i) => i), H.CHUNK.questions).map(p => p.length).join() === '20,20,5');

console.log('Lessons and flashcards');
const lesson = { id: 'l-1', status: 'reviewed', reviewedBy: 'x', archived: false, boards: ['aem'], subject: 'Altitude & Decompression', title: 'Hypoxia', summary: 'About hypoxia', order: 1, tier: 'pro', blocks: [{ type: 'heading', text: 'Types' }, { type: 'text', text: 'Hypoxic **hypoxia** is low oxygen.' }], references: ['Ref'] };
text = H.build('lessons', [lesson], { task: 'clearer' }); data = after(text, 'THE LESSONS:\n');
t('lessons go as the same JSON the importer takes', data.length === 1 && data[0].status === 'draft' && !('reviewedBy' in data[0]) && errs(LV.check(LV.normalize(data[0]).clean, { boards: BANK.boards, subjects: BANK.subjects, ids: new Set(), label: 'l-1', recordsReviewer: true })).length === 0, JSON.stringify(errs(LV.check(LV.normalize(data[0]).clean, { boards: BANK.boards, subjects: BANK.subjects, ids: new Set(), label: 'l-1', recordsReviewer: true }))));
t('and the message names the block types to keep', /heading, text, list, callout, table, steps, compare, stats, chart or image/.test(text) && /Below are 1 lesson/.test(text) || /Below are 1 lessons|1 lesson/.test(text));
const card = { id: 'c-1', status: 'reviewed', reviewedBy: 'x', boards: ['aem'], subject: 'Altitude & Decompression', topic: 'Hypoxia', front: 'First sign of hypoxia?', back: 'Euphoria and impaired judgement.', references: [] };
text = H.build('cards', [card], { task: 'tighter' }); data = after(text, 'THE FLASHCARDS:\n');
t('flashcards go as the importer takes them', data.length === 1 && data[0].status === 'draft' && !('reviewedBy' in data[0]) && data[0].front === card.front);

console.log('Feedback');
const msgs = [{ id: 7, kind: 'feedback', category: 'wrong-answer', message: 'I think B is also correct.', question_id: 'q-1', question: mq(1) }, { id: 8, kind: 'feedback', category: 'typo', message: 'Typo in the stem.', question_id: 'q-gone', question: null }, { id: 9, kind: 'support', message: 'How do I change my plan?', subject: 'Upgrading my plan' }];
text = H.build('feedback', msgs, { task: 'fix', note: 'Be conservative.' });
t('every message is in, with its id and kind', /message 7 \(question feedback, wrong-answer\)/.test(text) && /I think B is also correct\./.test(text) && /message 9 \(support\)/.test(text));
t('the question each is about is included as importable JSON', (() => { const m = text.match(/About question q-1:\n(\{[\s\S]*?\n\})\n/); if (!m) return false; const q = JSON.parse(m[1]); return q.id === 'q-1' && q.status === 'draft' && !('reviewedBy' in q); })());
t('a missing question is said so', /About question q-gone:\n\(the question no longer exists\)/.test(text));
t('the fix task asks for verdicts, then corrected questions as JSON', /valid, not valid, or needs more information/.test(text) && /ONE JSON array containing only the corrected questions/.test(text));
t('the reply task asks for plain text instead', !/ONE JSON array/.test(H.build('feedback', msgs, { task: 'reply' })) && /Draft a short, kind, plain reply/.test(H.build('feedback', msgs, { task: 'reply' })));
t('support messages have no question block', !/About question undefined/.test(text));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
