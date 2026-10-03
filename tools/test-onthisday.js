'use strict';
const D = require('../js/onthisday-data.js'), O = require('../js/onthisday.js');
let pass = 0, fail = 0; const t = (n, ok, x) => { if (ok) { pass++; console.log('  pass  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? ' ' + x : '')); } };
const days = []; for (let m = 1; m <= 12; m++) for (let d = 1; d <= new Date(2024, m, 0).getDate(); d++) days.push([m, d]);

console.log('Coverage');
t('there are 366 days to cover', days.length === 366);
const empty = days.filter(([m, d]) => !O.forDate(m, d).length).map(([m, d]) => O.key(m, d));
t('every day of the year, including Feb 29, has at least one event', empty.length === 0, empty.join());
t('no keys for days that do not exist', Object.keys(D).every(k => days.some(([m, d]) => O.key(m, d) === k)), Object.keys(D).filter(k => !days.some(([m, d]) => O.key(m, d) === k)).join());

console.log('Entries');
const all = Object.entries(D).flatMap(([k, l]) => l.map(e => ({ k, ...e })));
t('every entry is well formed', Object.values(D).every(l => l.every(e => Number.isInteger(e.y) && e.y >= 1783 && e.y <= 2025 && O.KINDS.includes(e.k) && typeof e.t === 'string' && e.t.length >= 20 && e.t.length <= 260)));
t('no day lists more than 3 events unless a fourth is deliberate (at most 5)', Object.values(D).every(l => l.length <= 5), Object.entries(D).filter(([, l]) => l.length > 5).map(([k]) => k).join());
t('the year is not repeated at the start of the sentence', all.every(e => !new RegExp('^' + e.y + '\\b').test(e.t)));
t('no entry is listed twice', new Set(all.map(e => e.t.toLowerCase())).size === all.length);
t('no sentence has markup or line breaks', all.every(e => !/[<>\n]/.test(e.t)));
const med = all.filter(e => e.k === 'm').length;
t('there are aerospace medicine entries to show (' + med + ')', med >= 60);

console.log('Ordering');
t('medicine events come first on a day', days.every(([m, d]) => { const l = O.forDate(m, d), i = l.findIndex(e => e.k !== 'm'); return i === -1 || l.slice(i).every(e => e.k !== 'm'); }));
t('forDate on a made-up data set', O.forDate(1, 2, { '01-02': [{ y: 1900, t: 'An aviation event for a test.', k: 'a' }, { y: 1950, t: 'A medicine event for a test.', k: 'm' }, { y: 3, t: '', k: 'a' }, { y: 1, t: 'bad kind here for a test', k: 'x' }] }).map(e => e.k).join() === 'm,a');
t('an unknown day gives an empty list', O.forDate(13, 40).length === 0);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
