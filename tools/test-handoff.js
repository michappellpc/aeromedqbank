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
t('each task has its own instruction', ['review', 'harder', 'easier', 'match', 'explain', 'custom'].every(k => H.build('questions', qs, { task: k }).includes(H.TASKS.questions.find(x => x[0] === k)[2])));
t('performance lines are added when given', /HOW THEY HAVE BEEN PERFORMING/.test(H.build('questions', qs, { task: 'harder', stats: { 'q-1': 'q-1: 92% correct' } })) && /- q-1: 92% correct/.test(H.build('questions', qs, { task: 'harder', stats: { 'q-1': 'q-1: 92% correct' } })));
t('and left out when not', !/PERFORMING/.test(text));
t('a part says which part it is', /This is part 2 of 3\./.test(H.build('questions', qs, { task: 'review', part: [1, 3] })) && !/This is part/.test(H.build('questions', qs, { task: 'review', part: [0, 1] })));
t('the size choices include the default, and bigger ones', ['questions', 'lessons', 'cards', 'feedback'].every(k => H.SIZES[k].includes(H.CHUNK[k]) && Math.max(...H.SIZES[k]) > H.CHUNK[k]));
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

console.log('Verify facts, and check the lesson link');
let ft = H.build('questions', qs, { task: 'facts', today: '2026-10-05' });
t('the facts task says to check laws, policies and guidelines against current sources', /Verify and update the facts/.test(ft) && /OSHA, ADA and FMLA/.test(ft) && /most recent authoritative source/.test(ft));
t('it gives today\'s date', /Today's date is 2026-10-05/.test(ft));
t('it forbids guessing and asks what changed, the source and the confidence', /Do not guess/.test(ft) && /what changed, the source, and how confident you are/.test(ft) && /claims you could not verify/.test(ft));
t('and the questions still come as importable JSON', after(ft, 'THE QUESTIONS:\n').length === 3);
t('the same task is there for lessons and flashcards', /Verify and update the facts/.test(H.build('lessons', [lesson], { task: 'facts', today: '2026-10-05' })) && /Verify and update the facts/.test(H.build('cards', [card], { task: 'facts', today: '2026-10-05' })));
t('the facts task is offered for questions, lessons and flashcards', ['questions', 'lessons', 'cards'].every(k => H.TASKS[k].some(x => x[0] === 'facts')));
const cat = [{ id: 'les-a', subject: 'Altitude & Decompression', title: 'Hypoxia basics', summary: 'Types of hypoxia' }, { id: 'les-b', subject: 'Altitude & Decompression', title: 'Decompression sickness', summary: 'DCS' }];
const cur = { 'q-1': { id: 'les-a', title: 'Hypoxia basics', pinned: false }, 'q-2': { id: 'les-b', title: 'Decompression sickness', pinned: true }, 'q-3': null };
let lt = H.build('questions', qs, { task: 'lessons', catalog: cat, current: cur });
t('the lesson-link task asks for lessonId only where a different lesson is clearly better', /"lessonId" on that question/.test(lt) && /Leave "lessonId" out where the current lesson is already the best/.test(lt) && /exactly one of the ids in the lesson list/.test(lt));
t('it lists the lessons I have', /THE LESSONS I HAVE/.test(lt) && /- les-a \| Altitude & Decompression \| Hypoxia basics \| Types of hypoxia/.test(lt) && /- les-b \|/.test(lt));
t('and the lesson each question shows now, and whether it was chosen by hand', /- q-1: les-a \(Hypoxia basics\), picked automatically/.test(lt) && /- q-2: les-b \(Decompression sickness\), chosen by hand/.test(lt) && /- q-3: none/.test(lt));
t('it asks for new lesson titles where nothing fits', /title of a new lesson that would fit/.test(lt));
t('the question JSON is still the last thing and still parses', after(lt, 'THE QUESTIONS:\n').length === 3);
t('the lesson task is only offered for questions', H.TASKS.questions.some(x => x[0] === 'lessons') && !H.TASKS.lessons.some(x => x[0] === 'lessons') && !H.TASKS.cards.some(x => x[0] === 'lessons'));
t('lessonId is sent with each question so a pinned lesson can be seen and changed', after(H.build('questions', [{ ...mq(1), lessonId: 'les-a' }], { task: 'lessons' }), 'THE QUESTIONS:\n')[0].lessonId === 'les-a');
t('a lessonId in the reply is accepted by the importer', errs(QV.check(QV.normalize({ ...mq(1), lessonId: 'les-a' }).clean, { boards: BANK.boards, subjects: BANK.subjects, ids: new Set(), stems: new Map(), label: 'q-1', recordsReviewer: true, lessonIds: new Set(['les-a']) })).length === 0);

t('there is a task that matches difficulty to the category using the performance numbers', (() => { const x = H.build('questions', qs, { task: 'match', stats: { 'q-1': 'q-1: 92% correct on the first try (30 members); labeled Hard' } }); return /TASK: Make each question truly Easy, Medium or Hard/.test(x) && /Easy should be answered correctly[^]*80%/.test(x) && /There is no minimum number of answers/.test(x) && /light nudge/.test(x) && /leave it unchanged/.test(x) && /HOW THEY HAVE BEEN PERFORMING/.test(x) && /- q-1: 92% correct/.test(x); })());
t('it comes right after Make easier in the list', (() => { const k = H.TASKS.questions.map(x => x[0]); return k.indexOf('match') === k.indexOf('easier') + 1; })());
t('the outline task sends the outline for the boards in play and asks for board:code tags', (() => { const O = require('../js/objectives.js'); const outline = O.board('aem').items.slice(0, 3).map(i => ({ ref: 'aem:' + i.code, text: i.text })); const x = H.build('questions', qs, { task: 'outline', outline }); return /TASK: Decide which items of the ABPM content outline/.test(x) && /THE BOARD OUTLINE/.test(x) && x.includes('- ' + outline[0].ref + ' | ') && /board:code/.test(x); })());
t('every kind offers the outline task, and objectives are sent with each item', ['questions', 'lessons', 'cards'].every(k => H.TASKS[k].some(x => x[0] === 'outline')) && after(H.build('questions', [{ ...mq(1), objectives: ['aem:K1.E.1'] }], { task: 'outline' }), 'THE QUESTIONS:\n')[0].objectives[0] === 'aem:K1.E.1');
t('the difficulty task has Claude judge the wording itself first, whatever the number of answers', (() => { const x = H.build('questions', qs, { task: 'match' }); return /Step 1, read the question and every answer choice/.test(x) && /with none, your own reading from Step 1 decides/.test(x) && /numbers lead and your reading explains them/.test(x) && /even none/.test(x); })());
t('a question with no answers still gets a line saying so, with its label', (() => { const x = H.build('questions', qs, { task: 'match', stats: { 'q-1': 'q-1: 70% correct on the first try (30 members); labeled Hard' } }); return /- q-2: no answers yet; labeled Medium|- q-2: no answers yet; labeled Easy|- q-2: no answers yet; labeled Hard/.test(x) && /judge it from its wording alone/.test(x); })());
t('with no numbers at all it says to judge from the wording alone', /no numbers are available, so judge each question from its wording alone/.test(H.build('questions', qs, { task: 'match' })));
t('other tasks do not get the performance block by default', !/no numbers are available/.test(H.build('questions', qs, { task: 'review' })));
const convo = [{ id: 31, kind: 'support', message: 'How do I reset?', subject: 'Help', thread: [{ sender: 'member', message: 'How do I reset?', created_at: '2026-10-01T09:00:00Z' }, { sender: 'team', message: 'Use Forgot password.', created_at: '2026-10-02T09:00:00Z', author: 'admin@private.example' }, { sender: 'member', message: 'It did\nnot arrive.', created_at: '2026-10-03T09:00:00Z' }] }, { id: 32, kind: 'support', message: 'Just one message', thread: [{ sender: 'member', message: 'Just one message', created_at: '2026-10-01T09:00:00Z' }] }, { id: 33, kind: 'support', message: 'No thread loaded' }];
const ct = H.build('feedback', convo, { task: 'reply' });
t('a message with replies carries the conversation, oldest first, labelled Member and Team', /Conversation so far \(2 replies, oldest first\):\n  Team \(2026-10-02\): Use Forgot password\.\n  Member \(2026-10-03\): It did not arrive\./.test(ct));
t('the first message is not repeated inside the conversation', ct.split('How do I reset?').length === 2);
t('team members\' emails and names are never included', !/admin@private\.example/.test(ct));
t('a message with no replies, or no thread, has no conversation block', (ct.match(/Conversation so far/g) || []).length === 1);
t('the reply task tells Claude to read the whole conversation and write the next reply', /read all of it first and write the next reply/.test(ct) && /conversation under it too/.test(H.build('feedback', convo, { task: 'fix' })));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
