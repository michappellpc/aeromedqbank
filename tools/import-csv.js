#!/usr/bin/env node
// Turns a spreadsheet (saved as CSV) into a question file.
//   node tools/import-csv.js questions.csv [--out data/questions/<name>.json] [--prefix aem-hypoxia] [--data private] [--add]
// --add also lists the new file in data/manifest.json.  See docs/question-template.csv for the columns.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), valOf = f => args.includes(f) ? args[args.indexOf(f) + 1] : null;
const inFile = args.find(a => !a.startsWith('--') && a !== valOf('--out') && a !== valOf('--prefix') && a !== valOf('--data'));
if (!inFile) { console.error('Usage: import-csv.js file.csv [--out path.json] [--add]'); process.exit(2); }
const base = path.basename(inFile, path.extname(inFile)).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const outArg = valOf('--out'), prefix = (valOf('--prefix') || base).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const dataDir = valOf('--data') ? path.resolve(valOf('--data')) : path.join(__dirname, '..', 'data');
const outFile = path.resolve(outArg || path.join(dataDir, 'questions', base + '.json'));
const man = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));

function parseCSV(t) { // RFC 4180: quoted fields, doubled quotes, newlines inside quotes
  const rows = []; let row = [], f = '', q = false;
  t = t.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const boardByName = Object.fromEntries(man.boards.flatMap(b => [[b.id, b.id], [b.name.toLowerCase(), b.id]]));
const rows = parseCSV(fs.readFileSync(inFile, 'utf8'));
const head = rows.shift().map(h => h.trim().toLowerCase());
const col = (r, name) => { const i = head.indexOf(name.toLowerCase()); return i < 0 ? '' : (r[i] || '').trim(); };
const list = s => s.split('|').map(x => x.trim()).filter(Boolean);
const out = rows.map((r, i) => {
  const q = {
    id: col(r, 'id') || `${prefix}-${String(i + 1).padStart(3, '0')}`,
    status: col(r, 'status') || 'draft',
    boards: list(col(r, 'boards')).map(b => boardByName[b.toLowerCase()] || b),
    subject: col(r, 'subject'), topic: col(r, 'topic'),
    difficulty: +col(r, 'difficulty') || 2,
    stem: col(r, 'stem'),
    options: 'ABCDEF'.split('').filter(L => col(r, 'option' + L)).map(L => ({ id: L, text: col(r, 'option' + L) })),
    answer: col(r, 'answer').toUpperCase(),
    explanation: col(r, 'explanation')
  };
  const notes = {}; 'ABCDEF'.split('').forEach(L => { if (col(r, 'note' + L)) notes[L] = col(r, 'note' + L); });
  if (Object.keys(notes).length) q.optionNotes = notes;
  q.references = list(col(r, 'references'));
  if (col(r, 'image')) { q.image = col(r, 'image'); q.imageAlt = col(r, 'imagealt'); }
  if (col(r, 'reviewedby')) q.reviewedBy = col(r, 'reviewedby');
  return q;
});
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${out.length} question(s) to ${path.relative(process.cwd(), outFile)}`);
if (args.includes('--add')) {
  const rel = path.relative(dataDir, outFile).split(path.sep).join('/');
  if (!man.files.includes(rel)) { man.files.push(rel); fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(man, null, 2) + '\n'); console.log('Added to ' + path.relative(process.cwd(), path.join(dataDir, 'manifest.json'))); }
}
console.log('Next: node tools/validate.js');
