#!/usr/bin/env node
// Unit tests for js/qvalidate.js:  node tools/test-qvalidate.js
const Q = require('../js/qvalidate.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const boards = [{ id: 'aem' }, { id: 'om' }, { id: 'pm' }], subjects = { aem: ['Altitude & Decompression'], om: ['Toxicology'], pm: ['Biostatistics'] };
const good = () => ({ id: 'aem-altitude-001', status: 'draft', boards: ['aem'], subject: 'Altitude & Decompression', topic: 'T', difficulty: 2, stem: 'Stem one?',
  options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }], answer: 'A', explanation: 'Because.', optionNotes: { A: 'y', B: 'n', C: 'n' }, references: ['Ref'] });
const run = (q, over = {}) => Q.check(q, { boards, subjects, ids: new Set(), stems: new Map(), ...over });
const errs = r => r.filter(x => x.level === 'error').map(x => x.msg), warns = r => r.filter(x => x.level === 'warn').map(x => x.msg);

console.log('Rules');
t('a good question has no errors or warnings', run(good()).length === 0, JSON.stringify(run(good())));
t('missing stem', errs(run({ ...good(), stem: ' ' })).includes('missing stem'));
t('answer must be one of the options', errs(run({ ...good(), answer: 'D' })).includes('answer does not match an option id'));
t('subject must belong to the board', errs(run({ ...good(), subject: 'Toxicology' })).some(m => /not listed for board/.test(m)));
t('a subject from ANY chosen board is enough', errs(run({ ...good(), boards: ['aem', 'om'], subject: 'Toxicology' })).length === 0);
t('bad id characters', errs(run({ ...good(), id: 'Bad_ID' })).some(m => /lowercase/.test(m)));
t('duplicate id inside a batch', (() => { const c = { ids: new Set(), stems: new Map() }; run(good(), c); return errs(run({ ...good(), stem: 'Other stem' }, c)).includes('duplicate id'); })());
t('duplicate stem is caught, but the same question is not a duplicate of itself', (() => { const c = { ids: new Set(), stems: new Map([[Q.norm('Stem one?'), 'aem-altitude-001']]) }; return errs(run({ ...good(), id: 'aem-altitude-002' }, c)).some(m => /stem duplicates aem-altitude-001/.test(m)) && errs(run(good(), { ...c, ids: new Set() })).length === 0; })());
t('needs 2 to 6 options', errs(run({ ...good(), options: [{ id: 'A', text: 'x' }] })).includes('need between 2 and 6 options'));
t('option letters must be A-F', errs(run({ ...good(), options: [{ id: 'A', text: 'a' }, { id: 'G', text: 'g' }] })).includes('option ids must be letters A-F'));
t('identical option text', errs(run({ ...good(), options: [{ id: 'A', text: 'same' }, { id: 'B', text: 'Same.' }] })).includes('two options have identical text'));
t('"none of the above" is a warning, not an error', warns(run({ ...good(), options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'None of the above' }] })).some(m => /none of the above/.test(m)));
t('missing notes for wrong options is a warning', warns(run({ ...good(), optionNotes: { A: 'y' } })).some(m => /missing for wrong answer/.test(m)));
t('reviewed with no reviewer is a warning', warns(run({ ...good(), status: 'reviewed' })).includes('reviewed but no reviewedBy'));
t('tier must be free or pro', errs(run({ ...good(), tier: 'gold' })).includes('tier must be "free" or "pro"') && errs(run({ ...good(), tier: 'free' })).length === 0);
t('an image needs a description', errs(run({ ...good(), image: 'private:ok.png' })).includes('image needs imageAlt (a text description)'));
t('private image names are checked', errs(run({ ...good(), image: 'private:Bad Name.png', imageAlt: 'x' })).some(m => /private image name/.test(m)));
t('the caller can add its own file checks', errs(run({ ...good(), image: 'private:ok.png', imageAlt: 'x' }, { imageFiles: () => [{ level: 'error', msg: 'file missing' }] })).includes('file missing'));

console.log('Cleaning');
const n = Q.normalize({ ...good(), extra: 1, note: 'x', stem: '  padded  ', references: [' a ', '', 'b'] });
t('unknown fields are dropped and reported', n.dropped.join() === 'extra,note' && !('extra' in n.clean));
t('text is trimmed and empty references removed', n.clean.stem === 'padded' && n.clean.references.join('|') === 'a|b');

console.log('Reading pasted text');
const arr = JSON.stringify([good()], null, 2);
const p = s => Q.parsePaste(s);
t('a plain JSON list', p(arr).list && p(arr).list.length === 1);
t('a chat reply with a code fence, text before, and a table after', p(`Here are your questions:\n\n\`\`\`json\n${arr}\n\`\`\`\n\n| id | fact |\n|---|---|\n| a | b |`).list.length === 1);
t('a fence with no language name', p('```\n' + arr + '\n```').list.length === 1);
t('JSON with explanation text around it and no fence', p(`Sure!\n${arr}\nHope that helps [really].`).list.length === 1);
t('prose with brackets before the list is skipped', p(`[Note] here you go:\n${arr}`).list.length === 1);
t('brackets inside quoted text do not confuse it', (() => { const q = { ...good(), stem: 'Which of [these] is right? \\"]\\" trick' }; return p(`Here:\n${JSON.stringify([q])}\ndone [x]`).list[0].stem === q.stem; })());
t('a single question object becomes a list of one', p(JSON.stringify(good())).list.length === 1);
t('an object with a "questions" list', p(JSON.stringify({ questions: [good(), { ...good(), id: 'aem-altitude-002' }] })).list.length === 2);
t('a byte-order mark is ignored', p('﻿' + arr).list.length === 1);
t('empty input asks for input', /Nothing pasted/.test(p('   ').error));
t('an empty list is refused', /empty/.test(p('[]').error));
t('a reply that got cut off says where and why', (() => { const r = p(arr.slice(0, arr.length - 30)); return /not valid JSON/.test(r.error) && /line \d+/.test(r.error); })(), JSON.stringify(p(arr.slice(0, arr.length - 30))));
t('a missing comma says where', (() => { const r = p(arr.replace('"draft",', '"draft"')); return /not valid JSON/.test(r.error) && /line \d+/.test(r.error); })(), JSON.stringify(p(arr.replace('"draft",', '"draft"'))));
t('plain words are refused, not crashed on', /not valid JSON/.test(p('hello there').error));
t('a list containing something that is not a question', /Item 2/.test(p('[{"id":"a"}, 5]').error));


console.log('Length tell');
const withOpts = (texts, answer = 'A') => ({ ...good(), options: texts.map((t, i) => ({ id: 'ABCDEF'[i], text: t })), answer, optionNotes: undefined });
const longRight = withOpts(['Start supplemental oxygen and descend to a lower altitude immediately', 'Observe', 'Give fluids', 'Wait']);
t('a much longer correct answer is flagged', !!Q.lengthTell(longRight) && warns(run(longRight)).some(m => /times longer/.test(m)), JSON.stringify(Q.lengthTell(longRight)));
t('it is only a warning', errs(run(longRight)).length === 0);
t('evenly sized choices are not flagged', !Q.lengthTell(withOpts(['Give oxygen at once', 'Observe for an hour', 'Start IV fluids now', 'Wait and recheck'])));
t('a longer WRONG answer is not flagged', !Q.lengthTell(withOpts(['Observe', 'Start supplemental oxygen and descend to a lower altitude immediately', 'Give fluids', 'Wait'])));
t('short choices are never flagged, even when one is far longer in proportion', !Q.lengthTell(withOpts(['33%', '5%', '1%', '2%'])));
t('a slightly longer correct answer is fine', !Q.lengthTell(withOpts(['Give oxygen and recheck saturation', 'Observe and reassure the patient', 'Start fluids and monitor closely', 'Wait and recheck later today'])));
t('ties for longest are not flagged', !Q.lengthTell(withOpts(['Give oxygen'.padEnd(45, '.'), 'Observe it'.padEnd(45, '.'), 'Wait', 'Watch'])));
t('needs at least three choices', !Q.lengthTell(withOpts(['Start supplemental oxygen and descend to a lower altitude immediately', 'No'])));
t('the flagged answer can be any letter', !!Q.lengthTell(withOpts(['Observe', 'Give fluids', 'Start supplemental oxygen and descend to a lower altitude immediately', 'Wait'], 'C')));

console.log('Reworded copies');
const base = 'A 34-year-old fighter pilot reports tingling in both hands and light-headedness at 25,000 feet during an altitude chamber flight. Which type of hypoxia is the most likely cause of these symptoms?';
const bank = [{ id: 'aem-001', stem: base }, { id: 'aem-002', stem: 'A flight surgeon reviews a screening test with 90% sensitivity and 80% specificity in a population with 10% prevalence. What is the positive predictive value?' }];
t('a lightly reworded question is flagged', (() => { const n = Q.nearDuplicate('A 34-year-old fighter pilot reports tingling in both hands and light-headedness at 25,000 feet during an altitude chamber flight. Which kind of hypoxia is the most probable cause of the symptoms?', bank); return n && n.id === 'aem-001' && n.score >= 0.6; })());
t('the identical stem scores 1', Q.nearDuplicate(base, bank).score === 1);
t('a different question on a nearby topic is not flagged', Q.nearDuplicate('A 41-year-old helicopter pilot develops ear pain and vertigo during rapid descent from altitude. Which structure is most likely affected by the pressure change?', bank) === null);
t('an unrelated question is not flagged', Q.nearDuplicate('Which regulation sets the permissible exposure limit for noise in general industry workplaces?', bank) === null);
t('it picks the closest match', Q.nearDuplicate(base + ' Assume normal oxygen saturation.', bank).id === 'aem-001');
t('an empty list or stem is safe', Q.nearDuplicate(base, []) === null && Q.nearDuplicate('', bank) === null);

console.log('Lesson link');
const base2 = { id: 'x-1', status: 'draft', boards: ['aem'], subject: 'Altitude & Decompression', stem: 'A stem that is long enough to be a question stem here?', options: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }, { id: 'C', text: 'Three' }, { id: 'D', text: 'Four' }], answer: 'A', explanation: 'Because.', tier: 'pro' };
const lc = (q, extra = {}) => Q.check(q, { boards: [{ id: 'aem' }], subjects: { aem: ['Altitude & Decompression'] }, ids: new Set(), stems: new Map(), label: q.id, recordsReviewer: true, ...extra });
t('lessonId is a known field and is kept', Q.FIELDS.includes('lessonId') && Q.normalize({ ...base2, lessonId: ' les-one ' }).clean.lessonId === 'les-one');
t('a good lessonId passes', !lc({ ...base2, lessonId: 'les-one' }).some(r => r.level === 'error'));
t('a malformed lessonId is an error', lc({ ...base2, lessonId: 'Not A Lesson!' }).some(r => r.level === 'error' && /lessonId/.test(r.msg)));
t('an unknown lesson is a warning, not an error', (() => { const r = lc({ ...base2, lessonId: 'les-x' }, { lessonIds: new Set(['les-one']) }); return r.some(x => x.level === 'warn' && /does not match any lesson/.test(x.msg)) && !r.some(x => x.level === 'error'); })());
t('a known lesson raises nothing', !lc({ ...base2, lessonId: 'les-one' }, { lessonIds: new Set(['les-one']) }).some(r => /lessonId/.test(r.msg)));
t('no lessonId at all is fine', !lc(base2).some(r => /lessonId/.test(r.msg)));

console.log('Board outline tags');
const oc = (o, extra = {}) => lc({ ...base2, objectives: o }, extra);
t('objectives is a known field', Q.FIELDS.includes('objectives'));
t('good tags pass', !oc(['aem:K1.E.1', 'om:K1.10']).some(r => /objectives/.test(r.msg) && r.level === 'error'));
t('tags are tidied: trimmed, board lower-cased, letter upper-cased, duplicates dropped', JSON.stringify(Q.normalize({ ...base2, objectives: [' AEM:k1.E.1 ', 'aem:K1.E.1', ''] }).clean.objectives) === '["aem:K1.E.1"]');
t('a malformed tag is an error', oc(['K1.E.1']).some(r => r.level === 'error' && /objectives/.test(r.msg)) && oc(['aem:K1.E.1; drop']).some(r => r.level === 'error'));
t('more than twelve is an error', oc(Array.from({ length: 13 }, (_, i) => 'aem:K1.' + (i + 1))).some(r => r.level === 'error' && /at most 12/.test(r.msg)));
t('not a list is an error', oc('aem:K1.1').some(r => r.level === 'error'));
t('a tag the outline does not have is only a warning', (() => { const r = oc(['aem:K1.E.1'], { knownObjective: () => false }); return r.some(x => x.level === 'warn' && /outline/.test(x.msg)) && !r.some(x => x.level === 'error' && /objectives/.test(x.msg)); })());
t('a tag for a board the question is not on is a warning', oc(['om:K1.10']).some(r => r.level === 'warn' && /board/.test(r.msg)));
t('no tags at all is fine', !lc(base2).some(r => /objectives/.test(r.msg)));
t('tags are read leniently: a string, objects, "AEM K1.E.1", trailing text, a bare code on a one-board question', JSON.stringify(Q.normalize({ ...base2, boards: ['aem'], objectives: 'K1.E.1, aem:K1.E.2 - Hypobaric exposures' }).clean.objectives) === '["aem:K1.E.1","aem:K1.E.2"]' && JSON.stringify(Q.normalize({ ...base2, objectives: ['AEM K1.E.1', { ref: 'aem:K2.C' }, 'om-K1.10'] }).clean.objectives) === '["aem:K1.E.1","aem:K2.C","om:K1.10"]');
t('a bare code is left alone when the item is on several boards (it could mean either)', JSON.stringify(Q.normalize({ ...base2, boards: ['aem', 'om'], objectives: ['K1.10'] }).clean.objectives) === '["K1.10"]');
t('the error says which values were not understood', oc(['nonsense']).some(r => r.level === 'error' && /not understood: "nonsense"/.test(r.msg)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
