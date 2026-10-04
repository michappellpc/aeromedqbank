'use strict';
// Which ABPM content-outline items (the board's own tasks and knowledge statements, in outlines-data.js) a section or topic covers. Pure logic, no page
// code. Runs in the browser and in Node (for tests).
//
// Each section (subject) is tied to the outline items it covers in ANCHORS. That list is a judgment call made by reading the outlines, so it is easy to
// review and change. A code is a prefix: "K1.C" means K1.C and everything under it (K1.C.1 ... K1.C.15). A topic is then matched to the items in its
// section by its words (and the words of its questions); when nothing in the topic matches, the section's first items are used and marked "section".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require('./outlines-data.js') : root.OutlinesData); else root.Objectives = factory(root.OutlinesData);
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  const ANCHORS = {
    aem: {
      'Aviation Physiology': ['K1.A', 'K1.B', 'K1.C', 'K1.F', 'K1.G'],
      'Altitude & Decompression': ['K1.E', 'K1.C.14', 'K1.C.11', 'K1.H.1.i', 'K1.H.1.vii', 'K3.I'],
      'Acceleration & Spatial Disorientation': ['K1.D', 'K1.C.9', 'K1.C.11', 'K3.E', 'K3.I', 'K3.K.5'],
      'Aeromedical Standards & Waivers': ['K2.C', 'K2.A', 'K3.B', 'K4.C.4', 'K4.C.5', 'K4.C.6', 'K5.A', 'K5.B'],
      'Space Medicine': ['K1.D.2', 'K1.D.3', 'K1.F.3', 'K1.F.5', 'K1.C.10', 'K3.G', 'K2.E', 'K5.E'],
      'Aircraft Accident Investigation': ['K3.K', 'K3.J', 'K4.C.3', 'K4.A.4', 'K1.D.4', 'K1.G'],
      'Human Factors & Fatigue': ['K4.A', 'K4.B.2', 'K4.B.3', 'K4.D', 'K3.D', 'K2.D.5', 'K3.F', 'K1.H.1.ii']
    },
    om: {
      'Toxicology': ['K4.22', 'K4.3', 'K4.21', 'K1.5', 'K5.3', 'K5.11'],
      'Occupational Lung Disease': ['K1.2', 'K1.5', 'K1.11', 'K5.12', 'K4.3'],
      'Ergonomics & Musculoskeletal': ['K4.2', 'K3.3', 'K3.4', 'K2.4', 'K3.7'],
      "Workers' Compensation & Disability": ['K3.12', 'K7.5', 'K3.8', 'K3.9', 'K3.1', 'K3.7', 'K1.7', 'K1.18'],
      'Hearing Conservation & Noise': ['K4.7', 'K1.10', 'K5.2'],
      'Regulations (OSHA/ADA/FMLA)': ['K1.10', 'K3.8', 'K5.1', 'K5.2', 'K7.1', 'K7.2', 'K7.4'],
      'Medical Surveillance': ['K7.10', 'K1.10', 'K7.2', 'K3.5', 'K6.7'],
      'Industrial Hygiene': ['K4.1', 'K5.2', 'K4.3', 'K4.6', 'K4.7', 'K4.8', 'K3.5', 'K4.21']
    },
    pm: {
      'Biostatistics': ['K3.11', 'K3.12', 'K3.13', 'K3.14', 'K3.15', 'K3.16', 'K3.17', 'K3.18', 'K3.19', 'K3.10'],
      'Epidemiology': ['K3.1', 'K3.2', 'K3.3', 'K3.4', 'K3.5', 'K3.6', 'K3.7', 'K3.8', 'K3.9', 'K3.10', 'K2.3'],
      'Health Policy & Management': ['K5.1', 'K5.2', 'K5.3', 'K5.4', 'K5.5', 'K5.6', 'K5.7', 'K5.8', 'K5.10', 'K2.20', 'K2.21', 'K2.22', 'K2.23', 'K2.24', 'K2.25'],
      'Environmental Health': ['K4.2', 'K4.3', 'K4.4', 'K4.5', 'K4.6', 'K4.7', 'K4.8', 'K4.9', 'K4.10', 'K4.14', 'K4.1'],
      'Infectious Disease & Immunization': ['K1.8', 'K1.6', 'K2.8', 'K2.9', 'K2.7', 'K3.2', 'K2.36', 'K2.35'],
      'Screening & Prevention': ['K1.1', 'K1.9', 'K1.10', 'K1.7', 'K3.10', 'K1.11'],
      'Behavioral Health & Health Promotion': ['K1.5', 'K1.12', 'K1.13', 'K1.17', 'K1.16', 'K1.14', 'K1.15', 'K2.11', 'K2.12'],
      'Public Health Emergency Preparedness': ['K2.26', 'K4.12', 'K4.13', 'K2.9', 'K2.10', 'K2.17', 'K4.11']
    }
  };

  const STOP = new Set('the and for with from that this are was were has have not but can may its into than then also such per via any all one two out use used using more most less like how what when which who their they them our your you about over under between within without through during after before upon both each other some only same very basic basics principle principles concept concepts general overview introduction consideration considerations related relating including include methods method approach approaches applicable'.split(' '));
  const stem = w => w.replace(/(osis|oses)$/, 'os').replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, m => (w.length - m.length >= 4 ? '' : m));
  const tokens = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w)).map(stem);

  // Everyday words a topic may use for the outline's clinical terms
  const SYN = { vision: ['ophthalmologic'], visual: ['ophthalmologic'], eye: ['ophthalmologic'], night: ['ophthalmologic'], hear: ['otolaryngologic'], ear: ['otolaryngologic'], sinus: ['otolaryngologic'],
    hypoxia: ['hypobaric'], altitude: ['hypobaric'], decompression: ['hypobaric', 'hyperbaric'], oxygen: ['hypobaric', 'respiratory'], pulmonary: ['respiratory'], lung: ['respiratory'],
    heart: ['cardiovascular'], cardiac: ['cardiovascular'], kidney: ['renal'], sleep: ['circadian'], fatigue: ['circadian'], pregnancy: ['reproductive'], bone: ['musculoskeletal'], back: ['musculoskeletal'] };
  const expand = list => { const out = new Set(list); list.forEach(t => (SYN[t] || []).forEach(x => out.add(stem(x)))); return [...out]; };
  const cache = {};
  function board(id) {
    if (cache[id]) return cache[id];
    const raw = (DATA && DATA[id]) || { items: [] }, byCode = new Map(), items = raw.items.filter(i => i.kind === 'K').map(i => ({ ...i, board: id }));
    items.forEach(i => byCode.set(i.code, i));
    const parentOf = i => { const p = i.code.split('.'); while (p.length > 1) { p.pop(); const c = byCode.get(p.join('.')); if (c) return c; } return null; };
    items.forEach(i => { i.parent = parentOf(i); const own = tokens(i.text + ' ' + (i.detail || []).join(' ')), up = i.parent ? tokens(i.parent.text) : []; i.tok = new Set(own); i.ctx = new Set(up); });
    const df = new Map(); items.forEach(i => new Set([...i.tok, ...i.ctx]).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
    const idf = t => Math.log(1 + items.length / (df.get(t) || 0.5));
    return (cache[id] = { id, name: raw.name, source: raw.source, url: raw.url, retrieved: raw.retrieved, items, byCode, idf });
  }
  const boardOf = (subject, subjects) => Object.keys(subjects || {}).find(b => (subjects[b] || []).includes(subject)) || null;
  const matchesPrefix = (code, prefix) => code === prefix || code.startsWith(prefix + '.');
  // The items a section covers, in the order they are listed in ANCHORS
  function forSection(boardId, subject) {
    const b = board(boardId), list = (ANCHORS[boardId] || {})[subject] || [], seen = new Set(), out = [];
    list.forEach(prefix => b.items.filter(i => matchesPrefix(i.code, prefix)).forEach(i => { if (!seen.has(i.code)) { seen.add(i.code); out.push(i); } }));
    return out;
  }
  // The section's own headline items: the codes in ANCHORS exactly as listed (a code such as K1.C stands for its whole group)
  function headlines(boardId, subject, n = 3) {
    const b = board(boardId), list = (ANCHORS[boardId] || {})[subject] || [];
    return list.map(c => b.byCode.get(c)).filter(Boolean).slice(0, n);
  }
  // Best items for a topic: words of the topic count most, then the words of its questions. Falls back to the section's headline items.
  function forTopic(boardId, subject, topic, questions, n = 2) {
    const b = board(boardId), pool = forSection(boardId, subject); if (!pool.length) return [];
    const tt = expand(tokens(topic)), qt = tokens((questions || []).filter(q => q.subject === subject && (!topic || (q.topic || '') === topic)).slice(0, 12).map(q => q.stem + ' ' + (q.explanation || '')).join(' '));
    const order = new Map((ANCHORS[boardId][subject] || []).map((c, i) => [c, i]));
    const scored = pool.map(i => {
      let s = 0; const all = new Set([...i.tok, ...i.ctx]);
      new Set(tt).forEach(t => { if (i.tok.has(t)) s += 3 * b.idf(t); else if (i.ctx.has(t)) s += 1.2 * b.idf(t); });
      new Set(qt).forEach(t => { if (all.has(t)) s += 0.35 * b.idf(t); });
      return { item: i, score: s };
    }).filter(x => x.score >= 1.5).sort((a, c) => c.score - a.score || a.item.code.localeCompare(c.item.code, undefined, { numeric: true }));
    if (scored.length) return scored.filter((x, k) => k === 0 || x.score >= 0.6 * scored[0].score).slice(0, n).map(x => ({ item: x.item, via: 'topic', score: Math.round(x.score * 10) / 10 }));
    return headlines(boardId, subject, n).map(i => ({ item: i, via: 'section', score: 0 }));
  }
  // One line of text for an item, with what it sits under: "K1.E.1 Hypobaric exposures" (under "K1.E Pressure effects on human physiology")
  const tidy = s => String(s || '').replace(/[\s:]*(related to|including|focusing on the following|applicable to|as follows)?:?\s*$/i, '').replace(/:$/, '');
  const label = i => ({ code: i.code, text: i.text, under: i.parent ? { code: i.parent.code, text: tidy(i.parent.text) } : null });
  // ---- explicit tags: "board:code" strings kept on a question, lesson or flashcard ----
  const REF = /^(aem|om|pm):([TK][0-9]+(?:\.[A-Za-z0-9]+)*)$/;
  const allIdx = {};
  function index(id) {
    if (allIdx[id]) return allIdx[id];
    const raw = (DATA && DATA[id]) || { items: [] }, by = new Map(); raw.items.forEach(i => by.set(i.code, { ...i, board: id }));
    return (allIdx[id] = { raw, by });
  }
  // The outline item a tag points at (tasks and knowledge items alike), with the item it sits under; null when no such item
  function describe(ref) {
    const m = REF.exec(String(ref || '')); if (!m) return null;
    const i = index(m[1]).by.get(m[2]); if (!i) return null;
    const p = i.code.split('.'); let up = null; while (p.length > 1 && !up) { p.pop(); up = index(m[1]).by.get(p.join('.')) || null; }
    return { ref: m[1] + ':' + i.code, board: m[1], code: i.code, kind: i.kind, text: i.text, under: up ? { code: up.code, text: tidy(up.text) } : null };
  }
  // Items matching what the editor typed: a code ("K1.E" or "aem:K1.E.1") or words. Best matches first.
  function search(query, boardIds, n = 10) {
    const q = String(query || '').trim().toLowerCase(); if (!q) return [];
    const ids = (boardIds && boardIds.length ? boardIds : Object.keys(DATA || {})).filter(b => DATA && DATA[b]);
    const codeQ = q.replace(/^(aem|om|pm):/, ''), words = q.split(/\s+/).filter(w => w.length > 1), out = [];
    ids.forEach(b => index(b).raw.items.forEach(i => {
      const code = i.code.toLowerCase(), hay = (i.text + ' ' + (i.detail || []).join(' ') + ' ' + (i.domainName || '')).toLowerCase();
      let s = 0;
      if (code === codeQ) s = 100; else if (/^[tk][0-9]/.test(codeQ) && (code.startsWith(codeQ + '.') || code.startsWith(codeQ))) s = 50 - code.length / 10;
      else if (words.length && words.every(w => hay.includes(w))) s = 10 + words.filter(w => i.text.toLowerCase().includes(w)).length * 2 + (i.kind === 'K' ? 1 : 0);
      if (s) out.push({ s, i, b });
    }));
    return out.sort((x, y) => y.s - x.s || x.i.code.localeCompare(y.i.code, undefined, { numeric: true })).slice(0, n).map(x => describe(x.b + ':' + x.i.code));
  }
  // Suggested tags for an item from its subject, topic and wording. Only items the words really match; never the whole-section fallback.
  function suggest(subject, subjects, topic, text, n = 3) {
    const b = boardOf(subject, subjects); if (!b) return [];
    return forTopic(b, subject, topic || '', [{ subject, stem: text || '' }], n).filter(r => r.via === 'topic').map(r => b + ':' + r.item.code);
  }
  return { ANCHORS, board, boardOf, forSection, headlines, forTopic, label, tokens, REF, describe, search, suggest, boards: () => Object.keys(DATA || {}) };
});
