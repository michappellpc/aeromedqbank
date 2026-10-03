'use strict';
// The one set of question rules, shared by the admin Questions page (in the browser) and tools/validate.js (in Node),
// so what the editor accepts is exactly what the upload tool accepts.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.QValidate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS = ['draft', 'reviewed'], TIERS = ['free', 'pro'];
  // The only fields a question may have; anything else is dropped on save.
  const FIELDS = ['id', 'status', 'reviewedBy', 'boards', 'subject', 'topic', 'difficulty', 'stem', 'image', 'imageAlt', 'options', 'answer', 'explanation', 'optionNotes', 'references', 'tier', 'lessonId', 'archived'];
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // The "length tell": the correct answer is the longest choice and clearly longer than the rest, which gives it away.
  // Returns null, or { ratio } (how many times longer than the average of the other choices).
  function lengthTell(q) {
    if (!Array.isArray(q.options) || q.options.length < 3 || !q.options.some(o => o && o.id === q.answer)) return null;
    const len = o => String((o && o.text) || '').trim().length, right = q.options.find(o => o.id === q.answer), others = q.options.filter(o => o !== right);
    const mean = others.reduce((a, o) => a + len(o), 0) / others.length, L = len(right);
    if (!mean || L <= Math.max(...others.map(len)) || L - mean < 15 || L / mean < 1.4) return null;
    return { ratio: Math.round(10 * L / mean) / 10 };
  }

  // Reworded copies: two stems that share most of their words are probably the same question written twice, even when the ids differ.
  const wcache = new WeakMap();   // each question's words, worked out once (kept off the question itself so it never ends up in a backup)
  const stemWords = s => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3));
  const similarity = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n); };
  // nearDuplicate(stem, list, { min }) -> { id, score } for the closest question in list (each { id, stem }) at or above min, else null
  function nearDuplicate(stem, list, opts = {}) {
    const min = opts.min ?? 0.6, a = stemWords(stem); let best = null;
    for (const q of list || []) {
      let w = wcache.get(q); if (!w) wcache.set(q, w = stemWords(q.stem));
      const s = similarity(a, w);
      if (s >= min && (!best || s > best.score)) best = { id: q.id, score: Math.round(s * 100) / 100 };
    }
    return best;
  }

  // check(q, ctx) -> [{ level: 'error' | 'warn', msg }]
  //   ctx.boards   [{id}]           known boards
  //   ctx.subjects { boardId: [] }  subjects per board
  //   ctx.ids      Set              ids already seen in this run (updated here)
  //   ctx.stems    Map              normalized stem -> id of the question that has it (updated here)
  //   ctx.lessonIds Set (optional)  the ids of the lessons that exist, to warn about a lessonId that matches none
  //   ctx.label    string           what to call this question in messages (defaults to its id)
  //   ctx.recordsReviewer bool          the database records who reviewed, so a missing reviewedBy is fine (editor screens)
  //   ctx.imageFiles(image) -> [{level,msg}]   optional: file checks the caller can do (Node: does the file exist?)
  function check(q, ctx) {
    const out = [], err = m => out.push({ level: 'error', msg: m }), warn = m => out.push({ level: 'warn', msg: m });
    const boardIds = new Set(ctx.boards.map(b => b.id)), label = ctx.label || q.id;
    if (!q.id) err('missing id'); else if (!/^[a-z0-9][a-z0-9-]*$/.test(q.id)) err('id must be lowercase letters, digits and hyphens'); else if (ctx.ids.has(q.id)) err('duplicate id'); else ctx.ids.add(q.id);
    if (!STATUS.includes(q.status)) err('status must be "draft" or "reviewed"');
    if (q.status === 'reviewed' && !q.reviewedBy && !ctx.recordsReviewer) warn('reviewed but no reviewedBy');
    if (!Array.isArray(q.boards) || !q.boards.length || q.boards.some(b => !boardIds.has(b))) err('invalid boards (use aem, om, pm)');
    else if (!q.subject) err('missing subject')
    else if (!q.boards.some(b => (ctx.subjects[b] || []).includes(q.subject))) err(`subject "${q.subject}" is not listed for board(s) ${q.boards.join(', ')} in the manifest`);
    if (q.difficulty != null && ![1, 2, 3].includes(q.difficulty)) err('difficulty must be 1, 2 or 3');
    if (q.tier != null && !TIERS.includes(q.tier)) err('tier must be "free" or "pro"');
    if (q.archived != null && typeof q.archived !== 'boolean') err('archived must be true or false');
    if (q.lessonId != null && q.lessonId !== '' && (typeof q.lessonId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(q.lessonId))) err('lessonId must be a lesson id');
    else if (q.lessonId && ctx.lessonIds && !ctx.lessonIds.has(q.lessonId)) warn(`lessonId "${q.lessonId}" does not match any lesson`);
    if (!q.stem || !String(q.stem).trim()) err('missing stem'); else {
      const k = norm(q.stem), other = ctx.stems.get(k);
      if (other !== undefined && other !== label) err(`stem duplicates ${other}`); else ctx.stems.set(k, label);
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) err('need between 2 and 6 options');
    else {
      const oi = q.options.map(o => o.id);
      if (new Set(oi).size !== oi.length) err('option ids must be unique');
      if (oi.some(x => !/^[A-F]$/.test(x))) err('option ids must be letters A-F');
      if (q.options.some(o => !o.text || !String(o.text).trim())) err('every option needs text');
      if (new Set(q.options.map(o => norm(o.text))).size !== q.options.length) err('two options have identical text');
      if (!oi.includes(q.answer)) err('answer does not match an option id');
      const lt = lengthTell(q); if (lt) warn(`the correct answer is ${lt.ratio} times longer than the other choices, which can give it away; make the choices similar in length`);
      if (q.options.some(o => /all of the above|none of the above/i.test(o.text))) warn('uses "all/none of the above"; consider rewriting');
      if (q.optionNotes) {
        for (const k of Object.keys(q.optionNotes)) if (!oi.includes(k)) err(`optionNotes has key "${k}" that is not an option id`);
        const missing = oi.filter(x => x !== q.answer && !q.optionNotes[x]);
        if (missing.length) warn(`optionNotes missing for wrong answer(s) ${missing.join(', ')}`);
      } else warn('no optionNotes (why each wrong answer is wrong)');
    }
    if (!q.explanation || !String(q.explanation).trim()) err('missing explanation');
    if (!Array.isArray(q.references) || !q.references.length) warn('no references');
    if (q.image) {
      let files = true;
      if (String(q.image).startsWith('private:')) {   // private picture, kept in the private image store
        const name = q.image.slice(8);
        if (!/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp|gif)$/.test(name)) { err(`private image name "${name}" must be lower-case letters, digits, . _ - and end in .png .jpg .webp or .gif`); files = false; }
      }
      if (files && ctx.imageFiles) ctx.imageFiles(q.image).forEach(i => out.push(i));
      if (!q.imageAlt) err('image needs imageAlt (a text description)');
    }
    return out;
  }

  // Keeps only known fields, trims text, and reports what was dropped.
  function normalize(q) {
    const clean = {}, dropped = [];
    for (const k of Object.keys(q)) FIELDS.includes(k) ? (clean[k] = q[k]) : dropped.push(k);
    for (const k of ['id', 'topic', 'stem', 'explanation', 'imageAlt', 'reviewedBy', 'lessonId']) if (typeof clean[k] === 'string') clean[k] = clean[k].trim();
    if (Array.isArray(clean.options)) clean.options = clean.options.map(o => ({ id: o && o.id, text: typeof (o && o.text) === 'string' ? o.text.trim() : o && o.text }));
    if (Array.isArray(clean.references)) clean.references = clean.references.map(r => String(r).trim()).filter(Boolean);
    return { clean, dropped };
  }

  // Where a bracket that opens at s[start] closes, ignoring brackets inside quoted strings; -1 if it never closes.
  function matchEnd(s, start) {
    let depth = 0, inStr = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }
  const isQuestionList = v => Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === 'object' && !Array.isArray(x));
  const attempt = t => { try { return { value: JSON.parse(t) }; } catch (e) { return { err: e }; } };
  function explain(err, full, start, part) {  // "near line X, column Y", counted in the text the person pasted
    const m = String(err.message), lc = m.match(/line (\d+) column (\d+)/), pos = m.match(/position (\d+)/), offset = full.slice(0, start).split('\n').length - 1;
    let loc = '';
    if (lc) loc = ` (near line ${+lc[1] + offset}, column ${lc[2]})`;
    else if (pos) { const before = part.slice(0, +pos[1]); loc = ` (near line ${before.split('\n').length + offset}, column ${before.length - before.lastIndexOf('\n')})`; }
    return `This is not valid JSON${loc}. Usual causes: a missing comma or quote, text mixed into the list, or a reply that got cut off. Copy only the code block.`;
  }

  // Turns whatever was pasted into a list of questions. Forgiving: it finds the JSON inside a chat reply
  // (code fences, prose before and after, a table after the list), and tells a person where a mistake is.
  function parsePaste(text, noun = 'question') {
    let s = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!s) return { error: 'Nothing pasted yet.' };
    const fence = s.match(/```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/);
    if (fence && /^\s*[\[{]/.test(fence[1])) s = fence[1].trim();
    let v = null, firstFail = null;
    const whole = attempt(s);
    if (!whole.err) v = whole.value;
    else {
      for (let i = s.indexOf('['); i >= 0 && v === null; i = s.indexOf('[', i + 1)) {
        const end = matchEnd(s, i);
        if (end < 0) { if (!firstFail) firstFail = { start: i, part: s.slice(i) }; break; }   // opened but never closed: cut off
        const part = s.slice(i, end + 1), r = attempt(part);
        if (!r.err && isQuestionList(r.value)) v = r.value;
        else { if (!firstFail) firstFail = { start: i, part, err: r.err }; i = end; }      // skip past this one; do not try arrays nested inside it
      }
      if (v === null) {
        const f = firstFail || { start: 0, part: s };
        const e = f.err || attempt(f.part).err || whole.err;
        return { error: explain(e, s, f.start, f.part) };
      }
    }
    if (v && !Array.isArray(v) && Array.isArray(v.questions)) v = v.questions;
    if (v && !Array.isArray(v) && Array.isArray(v.lessons)) v = v.lessons;
    if (v && !Array.isArray(v) && Array.isArray(v.cards)) v = v.cards;
    if (v && !Array.isArray(v) && typeof v === 'object') v = [v];
    if (!Array.isArray(v)) return { error: `Expected a list of ${noun}s.` };
    if (!v.length) return { error: 'The list is empty.' };
    const bad = v.findIndex(x => !x || typeof x !== 'object' || Array.isArray(x));
    if (bad >= 0) return { error: `Item ${bad + 1} in the list is not a ${noun}.` };
    return { list: v };
  }

  return { check, normalize, parsePaste, lengthTell, nearDuplicate, FIELDS, STATUS, TIERS, norm };
});
