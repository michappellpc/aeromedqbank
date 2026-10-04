#!/usr/bin/env node
// Tests for the program-insights logic (js/insights.js) and the multi-lesson matcher (js/related.js):  node tools/test-insights.js
const I = require('../js/insights.js'), R = require('../js/related.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const row = (subject, topic, attempts, correct, residents, low, ga, gc) => ({ subject, topic, attempts, correct, residents, low_residents: low, group_attempts: ga, group_correct: gc });

console.log('Ranking weaknesses');
let w = I.weak([row('Tox', 'Lead', 40, 12, 5, 4, 400, 260), row('Tox', 'Noise', 40, 28, 5, 1, 400, 280), row('Epi', 'Bias', 40, 20, 5, 3, 400, 240), row('Epi', 'Rates', 40, 36, 5, 0, 400, 300)]);
t('a topic at or above the target is not a weakness', !w.some(x => x.topic === 'Rates') && !w.some(x => x.topic === 'Noise'), w.map(x => x.topic).join());
t('the worst topic comes first', w[0].topic === 'Lead' && w[1].topic === 'Bias', w.map(x => x.topic).join());
t('percent, the group figure and the gap are worked out', w[0].pct === 30 && w[0].group === 65 && w[0].behind === 35, JSON.stringify(w[0]));
t('the label names subject and topic', w[0].label === 'Tox: Lead');
t('a subject-only topic is labeled by the subject', I.weak([row('Epi', '', 40, 10, 4, 3, 100, 70)])[0].label === 'Epi');
const few = I.weak([row('A', 'Small', 10, 2, 3, 2, 100, 70), row('A', 'Big', 120, 24, 3, 2, 100, 70)]);
t('a few answers count for less than many at the same percent', few[0].topic === 'Big', few.map(x => x.topic).join());
const wide = I.weak([row('A', 'Narrow', 40, 16, 6, 1, 100, 60), row('A', 'Wide', 40, 16, 6, 5, 100, 60)]);
t('more residents struggling ranks higher', wide[0].topic === 'Wide');
const behind = I.weak([row('A', 'Same', 40, 20, 4, 2, 100, 50), row('A', 'Behind', 40, 20, 4, 2, 100, 80)]);
t('being behind all members ranks higher', behind[0].topic === 'Behind');
t('no group data still ranks', I.weak([row('A', 'X', 40, 10, 4, 2, 0, 0)]).length === 1 && I.weak([row('A', 'X', 40, 10, 4, 2, 0, 0)])[0].group === null);
t('empty input is fine', I.weak([]).length === 0 && I.weak(null).length === 0);

console.log('Lessons that would help');
const lessons = [
  { id: 'l1', subject: 'Tox', title: 'Lead poisoning and chelation', summary: 'Sources of lead exposure and treatment', blocks: [{ type: 'text', text: 'Lead lowers hemoglobin synthesis. Chelation with succimer is used for high blood lead levels.' }] },
  { id: 'l2', subject: 'Tox', title: 'Noise and hearing conservation', summary: 'Audiometry and hearing protection', blocks: [{ type: 'text', text: 'Noise exposure over 85 dBA needs a hearing program.' }] },
  { id: 'l3', subject: 'Epi', title: 'Bias and confounding', summary: 'Selection bias, recall bias and confounding', blocks: [{ type: 'text', text: 'Bias is a systematic error. Confounding distorts the exposure outcome association.' }] },
  { id: 'l4', subject: 'Epi', title: 'Study designs', summary: 'Cohort and case control', blocks: [{ type: 'text', text: 'A cohort study follows people forward. Selection bias can occur.' }] }
];
const qs = [{ subject: 'Tox', topic: 'Lead', stem: 'A worker has an elevated blood lead level and anemia. What treatment is best?', explanation: 'Chelation lowers the lead burden.' }];
let rec = I.lessonsFor(w[0], lessons, qs);
t('the best lesson for a topic is first', rec.length >= 1 && rec[0].lesson.id === 'l1', JSON.stringify(rec.map(r => r.lesson.id)));
t('a title match is said so', rec[0].reason === 'Its title matches the topic', rec[0].reason);
rec = I.lessonsFor({ subject: 'Epi', topic: 'Bias', label: 'Epi: Bias' }, lessons, []);
t('a topic matches the lesson with that title, and weakly related lessons are not padded in', rec[0].lesson.id === 'l3' && rec.length === 1, JSON.stringify(rec.map(r => r.lesson.id)));
const other = lessons.concat([{ id: 'l9', subject: 'Space', title: 'Basics of lead shielding', summary: 'Lead shielding for spacecraft', blocks: [{ type: 'text', text: 'Lead shielding reduces radiation dose.' }] }]);
t('a lesson in another subject is not suggested on a weak match', !I.lessonsFor({ subject: 'Epi', topic: 'Bias basics', label: 'x' }, other, []).some(r => r.lesson.id === 'l9'));
t('a topic nothing covers gets no lesson', I.lessonsFor({ subject: 'Space', topic: 'Radiation shielding', label: 'x' }, lessons, []).length === 0);
t('at most the number asked for', I.lessonsFor({ subject: 'Epi', topic: 'Bias', label: 'x' }, lessons, [], 1).length === 1);
t('no lessons at all is fine', I.lessonsFor(w[0], [], qs).length === 0);
t('Related.rank returns a sorted list and match returns its first', (() => { const r = R.rank({ subject: 'Tox', topic: 'Lead' }, lessons, { n: 3 }); return r.length >= 1 && r.every((x, i) => !i || r[i - 1].score >= x.score) && R.match({ subject: 'Tox', topic: 'Lead' }, lessons).lesson.id === r[0].lesson.id; })());

console.log('Residents who may need a check-in');
const now = '2026-10-01', day = n => new Date(Date.parse(now + 'T12:00:00Z') - n * 86400000).toISOString();
const roster = [
  { user_id: 'a', status: 'approved', attempts: 120, correct: 90, last_active: day(1), joined: day(90) },
  { user_id: 'b', status: 'approved', attempts: 80, correct: 60, last_active: day(20), joined: day(90) },
  { user_id: 'c', status: 'approved', attempts: 50, correct: 15, last_active: day(2), joined: day(90) },
  { user_id: 'd', status: 'approved', attempts: 0, correct: 0, last_active: null, joined: day(30) },
  { user_id: 'e', status: 'approved', attempts: 0, correct: 0, last_active: null, joined: day(2) },
  { user_id: 'f', status: 'pending', attempts: null, correct: null, last_active: null, joined: day(30) },
  { user_id: 'g', status: 'approved', attempts: 10, correct: 2, last_active: day(1), joined: day(30) }];
const att = I.attention(roster, now), by = id => att.find(x => x.user_id === id);
t('a resident doing well and active is fine', !by('a'));
t('two quiet weeks is flagged', by('b') && /20 days/.test(by('b').reasons[0]));
t('many answers with under half right is flagged', by('c') && /30% correct over 50/.test(by('c').reasons[0]));
t('someone who never started, after a week, is flagged', by('d') && /not answered/.test(by('d').reasons[0]));
t('a new resident who has not started yet is not', !by('e'));
t('a pending resident is never listed', !by('f'));
t('a low score on only a few answers is not flagged', !by('g'));

console.log('Missed questions and the trend');
const m = I.missed([{ question_id: 'q1', subject: 'S', topic: 'T', stem: 'Stem', attempts: 20, correct: 5, residents: 4, group_attempts: 200, group_correct: 120, top_wrong: 'C', top_wrong_n: 9, wrong_total: 15 }, { question_id: 'q2', subject: 'S', topic: '', stem: 'Stem 2', attempts: 6, correct: 3, residents: 3, group_attempts: 0, group_correct: 0, top_wrong: null, top_wrong_n: null, wrong_total: 3 }]);
t('a missed question shows the group and all-member percent', m[0].pct === 25 && m[0].group === 60 && m[0].id === 'q1');
t('the common wrong answer and its share', m[0].wrong === 'C' && m[0].wrongShare === 60);
t('no common wrong answer or group figure is simply empty', m[1].wrong === null && m[1].wrongShare === null && m[1].group === null);
const wk = I.weeks([{ week_start: '2026-09-14', attempts: 30, correct: 15, active_residents: 4 }, { week_start: '2026-09-21', attempts: 0, correct: 0, active_residents: 0 }, { week_start: '2026-09-28', attempts: 50, correct: 40, active_residents: 5 }]);
t('weeks with no answers are left out and numbers are real numbers', wk.length === 2 && wk[1].correct === 40 && wk[1].total === 50);
console.log('Strongest topics and sections');
const rows = [
  { subject: 'A', topic: 'T1', attempts: 60, correct: 54, residents: 5, low_residents: 0, group_attempts: 600, group_correct: 450 },    // 90%, 15 ahead of all members
  { subject: 'A', topic: 'T2', attempts: 40, correct: 30, residents: 5, low_residents: 1, group_attempts: 400, group_correct: 300 },    // 75%, level
  { subject: 'B', topic: 'T3', attempts: 12, correct: 11, residents: 3, low_residents: 0, group_attempts: 0, group_correct: 0 },        // 92% on few answers, no group figure
  { subject: 'B', topic: 'T4', attempts: 50, correct: 30, residents: 4, low_residents: 3, group_attempts: 500, group_correct: 350 }];  // 60%, under target
const st = I.strong(rows);
t('only topics at or above the target are listed', st.length === 3 && st.every(x => x.pct >= I.TARGET) && !st.some(x => x.topic === 'T4'));
t('a topic well ahead of all members on plenty of answers comes first', st[0].topic === 'T1' && st[0].ahead === 15);
t('a high score on few answers ranks below a well-backed one', st.findIndex(x => x.topic === 'T3') > st.findIndex(x => x.topic === 'T1'));
t('no group figure is simply empty', st.find(x => x.topic === 'T3').group === null && st.find(x => x.topic === 'T3').ahead === null);
t('nothing at the target gives an empty list', I.strong([rows[3]]).length === 0 && I.strong([]).length === 0 && I.strong().length === 0);
t('a different target can be given', I.strong(rows, { target: 80 }).map(x => x.topic).join() === 'T1,T3');
const sec = I.sections(rows);
t('every subject is ranked best to worst', sec.map(x => x.subject).join() === 'A,B' && sec[0].pct === 84 && sec[1].pct === 66);
t('a section adds up its topics (answers, group figure, topic count)', sec[0].attempts === 100 && sec[0].group === 75 && sec[0].topics === 2);
t('sections handle no rows', I.sections([]).length === 0 && I.sections().length === 0);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
