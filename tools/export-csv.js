#!/usr/bin/env node
// Exports questions to a spreadsheet for physician review.
//   node tools/export-csv.js [--data private] [file.json ...] > review.csv     (no files = every file in the manifest)
// Reviewers edit in Excel/Sheets (set status to "reviewed" and fill reviewedBy), save as CSV, then run import-csv.js with --out on the same JSON file.
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2), di = argv.indexOf('--data');
const dataDir = di >= 0 ? path.resolve(argv[di + 1]) : path.join(__dirname, '..', 'data');
const man = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));
const given = argv.filter((a, k) => !a.startsWith('--') && k !== di + 1);
const files = given.length ? given : man.files.map(f => path.join(dataDir, f));
const L = 'ABCDEF'.split('');
const head = ['id', 'status', 'boards', 'subject', 'topic', 'difficulty', 'stem', ...L.map(x => 'option' + x), 'answer', 'explanation', ...L.map(x => 'note' + x), 'references', 'image', 'imageAlt', 'reviewedBy'];
const cell = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const rows = [head];
for (const f of files) for (const q of JSON.parse(fs.readFileSync(f, 'utf8'))) {
  const opt = id => (q.options.find(o => o.id === id) || {}).text || '';
  rows.push([q.id, q.status, (q.boards || []).join('|'), q.subject, q.topic, q.difficulty, q.stem, ...L.map(opt), q.answer, q.explanation,
    ...L.map(x => (q.optionNotes || {})[x] || ''), (q.references || []).join('|'), q.image, q.imageAlt, q.reviewedBy]);
}
process.stdout.write('﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n');
