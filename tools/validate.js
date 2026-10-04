#!/usr/bin/env node
// Validates data.  Usage: node tools/validate.js [--strict] [--summary]
//   --data <dir> validates another folder with the same layout (e.g. private).
//   errors fail the run; warnings only print (with --strict they fail too).
const fs = require('fs'), path = require('path');
const QValidate = require('../js/qvalidate.js'), CardValidate = require('../js/cvalidate.js'), OutlinesData = require('../js/outlines-data.js');
const outlineCodes = new Set(); for (const [b, d] of Object.entries(OutlinesData)) for (const i of d.items) outlineCodes.add(b + ':' + i.code);
const knownObjective = ref => outlineCodes.has(ref);       // a tag that matches no ABPM outline item is a warning
const argv = process.argv.slice(2), di = argv.indexOf('--data');
const dir = di >= 0 ? path.resolve(argv[di + 1]) : path.join(__dirname, '..', 'data'), root = path.resolve(dir, '..');
const strict = process.argv.includes('--strict'), summary = process.argv.includes('--summary');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
let errors = 0, warns = 0, n = 0;
const err = (id, m) => { errors++; console.error(`ERROR [${id}] ${m}`); };
const warn = (id, m) => { warns++; console.warn(`warn  [${id}] ${m}`); };
let lengthTells = 0; const allQs = []; const ids = new Set(), stems = new Map(), tally = { status: {}, board: {}, subject: {}, answers: {} };
const bump = (o, k) => o[k] = (o[k] || 0) + 1;

// data files on disk that the manifest does not list would silently never load
const qdir = path.join(dir, 'questions');
if (fs.existsSync(qdir)) for (const f of fs.readdirSync(qdir)) if (f.endsWith('.json') && !man.files.includes('questions/' + f)) warn(f, 'file is not listed in data/manifest.json, so it will not load');

for (const f of man.files) {
  const fp = path.join(dir, f);
  if (!fs.existsSync(fp)) { err(f, 'listed in manifest but the file does not exist'); continue; }
  let qs; try { qs = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { err(f, 'invalid JSON: ' + e.message); continue; }
  if (!Array.isArray(qs)) { err(f, 'top level must be an array of questions'); continue; }
  for (const q of qs) {
    n++; const id = q.id || `${f}#${n}`;
    const imageFiles = image => {                       // the part only Node can do: look at the files on disk
      const out = [];
      if (image.startsWith('private:')) {
        const name = image.slice(8), file = path.join(dir, 'images', name);
        if (!fs.existsSync(file)) out.push({ level: 'error', msg: `private image not found: ${path.relative(process.cwd(), file)}` });
        else { const kb = fs.statSync(file).size / 1024; if (kb > 2048) out.push({ level: 'error', msg: `image ${name} is ${Math.round(kb)} KB; keep pictures under 2 MB` }); else if (kb > 600) out.push({ level: 'warn', msg: `image ${name} is ${Math.round(kb)} KB; smaller loads faster on phones` }); }
      } else if (!fs.existsSync(path.join(root, image))) out.push({ level: 'error', msg: `image file not found: ${image}` });
      return out;
    };
    for (const r of QValidate.check(q, { boards: man.boards, subjects: man.subjects, ids, stems, label: id, imageFiles, knownObjective })) (r.level === 'error' ? err : warn)(id, r.msg);
    if (QValidate.lengthTell(q)) lengthTells++;
    allQs.push(q);
    if (Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6 && q.options.some(o => o.id === q.answer)) bump(tally.answers, q.answer);
    bump(tally.status, q.status || '?'); (q.boards || []).forEach(b => bump(tally.board, b)); bump(tally.subject, q.subject);
  }
}
// flashcards (data/cards/*.json, listed under "cards" in the manifest)
const cdir = path.join(dir, 'cards');
if (fs.existsSync(cdir)) for (const f of fs.readdirSync(cdir)) if (f.endsWith('.json') && !(man.cards || []).includes('cards/' + f)) warn(f, 'file is not listed under "cards" in data/manifest.json, so it will not load');
const lessonIds = new Set(); for (const f of man.lessons || []) { try { JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).forEach(l => lessonIds.add(l.id)); } catch {} }
const cids = new Set(), cfronts = new Map(); let ncards = 0;
for (const f of man.cards || []) {
  const fp = path.join(dir, f);
  if (!fs.existsSync(fp)) { err(f, 'listed in manifest but the file does not exist'); continue; }
  let list; try { list = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { err(f, 'invalid JSON: ' + e.message); continue; }
  if (!Array.isArray(list)) { err(f, 'top level must be an array of cards'); continue; }
  for (const c of list) { ncards++; const id = c.id || `${f}#${ncards}`;
    for (const r of CardValidate.check(c, { boards: man.boards, subjects: man.subjects, ids: cids, fronts: cfronts, label: id, lessonIds, knownObjective })) (r.level === 'error' ? err : warn)(id, r.msg); }
}
if (summary && ncards) tally.cards = ncards;
const tot = Object.values(tally.answers).reduce((a, b) => a + b, 0);
if (tot >= 20) for (const [k, v] of Object.entries(tally.answers)) if (v / tot > .4) warn('bank', `answer "${k}" is correct for ${Math.round(100 * v / tot)}% of questions; shuffle the key`);
for (let i = 0; i < allQs.length; i++) {      // near-copies inside the bank
  const near = QValidate.nearDuplicate(allQs[i].stem, allQs.slice(0, i));
  if (near) warn(allQs[i].id || '?', `reads like a reworded copy of ${near.id} (${Math.round(near.score * 100)}% the same wording)`);
}
if (summary) tally.longAnswer = lengthTells;
if (summary) console.log('\n' + JSON.stringify(tally, null, 2));
console.log(`${n} questions checked: ${errors} error(s), ${warns} warning(s).`);
process.exit(errors || (strict && warns) ? 1 : 0);
