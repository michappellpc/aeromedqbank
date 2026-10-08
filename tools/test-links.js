'use strict';
// Tests for linking by board outline tags (js/links.js):  node tools/test-links.js
const L = require('../js/links.js');
let pass = 0, fail = 0;
const t = (name, ok) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}`); };
const tag = (...o) => ({ objectives: o });

console.log('Scoring');
t('tags are read tolerantly and bad ones ignored', JSON.stringify(L.tagsOf({ objectives: ['AEM:K1.E.1', ' aem:k1.e.1 ', 'junk', 5, 'om:K4.22'] })) === JSON.stringify(['aem:k1.e.1', 'om:k4.22']));
t('an item with no tags scores nothing', L.score(L.tagsOf({}), L.tagsOf(tag('aem:K1.E'))) === 0);
t('a more specific shared code counts more', L.score(['aem:k1.e.1'], ['aem:k1.e.1']) > L.score(['aem:k1.e'], ['aem:k1.e']) && L.score(['aem:k1.e'], ['aem:k1.e']) > L.score(['aem:k1'], ['aem:k1']));
t('a parent tag against a child tag counts for half', L.score(['aem:k1.e'], ['aem:k1.e.1']) === 1 && L.score(['aem:k1.e.1'], ['aem:k1.e']) === 1);
t('the same code on another board is not a match', L.score(['aem:k1.e'], ['om:k1.e']) === 0);
t('a code that only starts the same is not a parent (K1.1 vs K1.10)', L.score(['om:k1.1'], ['om:k1.10']) === 0);
t('a long tag list on one side does not lower the score', L.score(['aem:k1.e.1'], ['aem:k1.e.1', 'aem:k2.a', 'aem:k3.b', 'aem:k4.c']) === L.score(['aem:k1.e.1'], ['aem:k1.e.1']));
t('score is symmetrical', L.score(['aem:k1.e', 'aem:k2.a.1'], ['aem:k1.e.1']) === L.score(['aem:k1.e.1'], ['aem:k1.e', 'aem:k2.a.1']));

console.log('Ranking');
const lessons = [
  { id: 'l-broad', subject: 'Altitude', title: 'Broad', objectives: ['aem:K1.E'] },
  { id: 'l-exact', subject: 'Altitude', title: 'Exact', objectives: ['aem:K1.E.1', 'aem:K1.E.2'] },
  { id: 'l-other', subject: 'Physiology', title: 'Other', objectives: ['aem:K1.A.1'] },
  { id: 'l-none', subject: 'Altitude', title: 'None' }
];
const q = { id: 'q1', subject: 'Altitude', objectives: ['aem:K1.E.1'] };
t('the lesson with the exact code comes first', L.rank(q, lessons).map(h => h.item.id)[0] === 'l-exact');
t('a parent tag alone is below the bar, but counts alongside a second match', L.rank(q, lessons).map(h => h.item.id).join() === 'l-exact' && L.rank({ objectives: ['aem:K1.E.1', 'aem:K1.A.1'] }, lessons).map(h => h.item.id).join() === 'l-exact,l-other');
t('a single broad tag is below the bar', L.rank({ objectives: ['aem:K1'] }, [{ id: 'x', objectives: ['aem:K1'] }]).length === 0);
t('an unrelated lesson is left out', !L.rank(q, lessons).some(h => h.item.id === 'l-other'));
t('the shared codes are reported', JSON.stringify(L.rank(q, lessons)[0].shared) === JSON.stringify(['aem:k1.e.1']));
t('an item does not match itself', L.rank(q, [q]).length === 0);
t('the same-subject lesson wins a tie', L.rank({ subject: 'Physiology', objectives: ['aem:K1.E.1'] }, [{ id: 'a', subject: 'Altitude', objectives: ['aem:K1.E.1'] }, { id: 'b', subject: 'Physiology', objectives: ['aem:K1.E.1'] }])[0].item.id === 'b');
t('the index gives the same answer as comparing every pair', (() => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 'i' + i, objectives: [`aem:K${1 + i % 5}.${'ABC'[i % 3]}.${1 + i % 7}`, `aem:K${1 + (i + 2) % 5}.${'ABC'[(i + 1) % 3]}`] }));
  const ix = L.index(many);
  return many.every(it => JSON.stringify(L.rank(it, many).map(h => h.item.id)) === JSON.stringify(L.rank(it, many, { index: ix }).map(h => h.item.id)));
})());

console.log('The lesson for an item');
const words = () => lessons[3];
t('a pin wins over the tags', L.lesson({ ...q, lessonId: 'l-other' }, lessons).lesson.id === 'l-other' && L.lesson({ ...q, lessonId: 'l-other' }, lessons).by === 'pin');
t('a pin to a lesson that does not exist is ignored', L.lesson({ ...q, lessonId: 'gone' }, lessons).lesson.id === 'l-exact');
t('the tags pick the lesson when there is no pin', L.lesson(q, lessons).by === 'outline' && L.lesson(q, lessons).lesson.id === 'l-exact');
t('other close lessons are listed as also', (() => { const r = L.lesson({ id: 'q9', objectives: ['aem:K1.E.1', 'aem:K1.E.2'] }, [...lessons, { id: 'l-two', objectives: ['aem:K1.E.1'] }]); return r.lesson.id === 'l-exact' && r.also.map(l => l.id).join() === 'l-two'; })());
t('with no tag match it falls back to the word matcher', (() => { const r = L.lesson({ id: 'q2', objectives: [] }, lessons, { words }); return r.by === 'words' && r.lesson.id === 'l-none'; })());
t('with nothing at all there is no lesson', L.lesson({ id: 'q3' }, lessons) === null && L.lesson(q, []) === null);

console.log('What goes with a question, card or lesson');
const cards = [{ id: 'c1', objectives: ['aem:K1.E.1'] }, { id: 'c2', objectives: ['aem:K1.A.1'] }, { id: 'c3', lessonId: 'l-exact' }, { id: 'c4', lessonId: 'l-other', objectives: ['aem:K1.E.1', 'aem:K1.E.2'] }, { id: 'my:z', sk: 'q', si: 'q1', objectives: undefined }];
t('cards for a question: by tags, plus cards made from it', L.cardsForQuestion(q, cards).map(c => c.id).sort().join() === 'c1,c4,my:z');
t('cards for a lesson: its own pins, plus tagged cards not pinned elsewhere', L.cardsForLesson(lessons[1], cards).map(c => c.id).join() === 'c3,c1');
t('questions for a lesson: pinned here, plus tagged ones not pinned elsewhere', (() => { const qs = [{ id: 'a', lessonId: 'l-exact' }, { id: 'b', objectives: ['aem:K1.E.2'] }, { id: 'c', lessonId: 'l-other', objectives: ['aem:K1.E.1'] }, { id: 'd', objectives: ['aem:K9.Z'] }]; return L.questionsForLesson(lessons[1], qs).map(x => x.id).join() === 'a,b'; })());
t('questions for a card: best few by tags', L.questionsForCard(cards[0], [{ id: 'a', objectives: ['aem:K1.E.1'] }, { id: 'b', objectives: ['aem:K1.A.1'] }, { id: 'c', objectives: ['aem:K1.E.1', 'aem:K1.E.2'] }]).map(x => x.id).join() === 'a,c' && L.questionsForCard(cards[0], [{ id: 'a', objectives: ['aem:K1.E.1'] }, { id: 'b', objectives: ['aem:K1.E.1'] }, { id: 'c', objectives: ['aem:K1.E.1'] }], 2).length === 2);

console.log('Admin lists');
t('items with a lesson: by pin or by tags', (() => { const s = L.withLesson([q, { id: 'p', lessonId: 'l-none' }, { id: 'gone', lessonId: 'zzz' }, { id: 'n', objectives: ['aem:K9.Z'] }, { id: 'u' }], lessons); return [...s].sort().join() === 'p,q1'; })());
t('lessons in use: by a pin or by a tag match', (() => { const s = L.lessonsInUse(lessons, [q, { id: 'p', lessonId: 'l-none' }]); return [...s].sort().join() === 'l-exact,l-none'; })());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
