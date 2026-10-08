'use strict';
// How questions, lessons and flashcards link to each other through the board outline items (objectives) they are tagged with.
// Pure logic, no page code. Runs in the browser and in Node (for tests).
//
// A tag is "board:code", e.g. "aem:K1.E.1". Two items are related when they share tags: the more specific the shared code, the stronger
// the link (K1.E.1 counts more than K1), and a tag on a parent code (K1.E) counts for half as much against a tag on one of its
// children (K1.E.1). An item needs at least MIN to count as related, so a single broad tag (K1) alone is not enough.
// A link set by hand (a "lessonId" pin) always wins over a computed one.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Links = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN = 2;
  const TAG = /^(aem|om|pm):[tk][0-9]+(\.[a-z0-9]+)*$/;
  const depth = t => t.slice(t.indexOf(':') + 1).split('.').length;
  const tagsOf = item => { const out = [], seen = new Set(); for (const o of (item && item.objectives) || []) { const t = String(o).trim().toLowerCase(); if (TAG.test(t) && !seen.has(t)) { seen.add(t); out.push(t); } } return out; };
  const weight = (a, b) => a === b ? depth(a) : a.startsWith(b + '.') ? 0.5 * depth(b) : b.startsWith(a + '.') ? 0.5 * depth(a) : 0;
  function score(A, B) {                                    // two lists of tags; symmetrical, so a long list does not count against an item
    if (!A.length || !B.length) return 0;
    let sa = 0, sb = 0;
    for (const x of A) { let m = 0; for (const y of B) { const w = weight(x, y); if (w > m) m = w; } sa += m; }
    for (const y of B) { let m = 0; for (const x of A) { const w = weight(x, y); if (w > m) m = w; } sb += m; }
    return (sa + sb) / 2;
  }
  const shared = (A, B) => A.filter(x => B.includes(x));

  // An index over a list of items, so a long list can be searched without comparing every pair
  const ancestors = t => { const out = [], i = t.indexOf(':'); let rest = t.slice(i + 1); while (rest.includes('.')) { rest = rest.slice(0, rest.lastIndexOf('.')); out.push(t.slice(0, i + 1) + rest); } return out; };
  function index(list) {
    const tags = list.map(tagsOf), byTag = new Map(), byAnc = new Map();
    const add = (m, k, i) => { let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(i); };
    tags.forEach((ts, i) => ts.forEach(t => { add(byTag, t, i); ancestors(t).forEach(a => add(byAnc, a, i)); }));
    return { list, tags, byTag, byAnc };
  }
  function candidates(ix, A) {                              // positions in the index's list that share or nest with any of the tags
    const out = new Set(), pull = s => s && s.forEach(i => out.add(i));
    for (const x of A) { pull(ix.byTag.get(x)); pull(ix.byAnc.get(x)); ancestors(x).forEach(a => pull(ix.byTag.get(a))); }
    return out;
  }

  // The items in list most related to item, best first: [{ item, score, shared }]
  function rank(item, list, opts = {}) {
    const A = tagsOf(item), min = opts.min ?? MIN, ix = opts.index || null;
    if (!A.length || !list || !list.length) return [];
    const out = [];
    const take = (c, B) => { if (c === item || (opts.skip && opts.skip(c))) return; const s = score(A, B); if (s >= min) out.push({ item: c, score: s, shared: shared(A, B) }); };
    if (ix) candidates(ix, A).forEach(i => take(ix.list[i], ix.tags[i])); else list.forEach(c => take(c, tagsOf(c)));
    out.sort((a, b) => b.score - a.score || (b.item.subject === item.subject) - (a.item.subject === item.subject) || String(a.item.id).localeCompare(String(b.item.id)));
    return opts.n ? out.slice(0, opts.n) : out;
  }

  // The lesson an item (a question or a flashcard) links to: { lesson, pinned, by: 'pin' | 'outline' | 'words', shared, also: [lessons] } or null.
  // opts.words(item, lessons) is the old word-matching fallback, used only when the tags find nothing.
  function lesson(item, lessons, opts = {}) {
    if (!lessons || !lessons.length) return null;
    if (item.lessonId) { const l = lessons.find(x => x.id === item.lessonId); if (l) return { lesson: l, pinned: true, by: 'pin', shared: [], also: [] }; }
    const hits = rank(item, lessons, { n: 3 });
    if (hits.length) return { lesson: hits[0].item, pinned: false, by: 'outline', shared: hits[0].shared, also: hits.slice(1).filter(h => h.score >= hits[0].score / 2).map(h => h.item) };
    const w = opts.words ? opts.words(item, lessons) : null;
    return w ? { lesson: w, pinned: false, by: 'words', shared: [], also: [] } : null;
  }

  // What belongs with a question or a lesson. A link set by hand elsewhere keeps an item out; a link set by hand here brings it in.
  const cardsForQuestion = (q, cards) => (cards || []).filter(c => c.sk === 'q' && c.si === q.id).concat(rank(q, cards, { skip: c => c.sk === 'q' && c.si === q.id }).map(h => h.item));
  const cardsForLesson = (l, cards) => (cards || []).filter(c => c.lessonId === l.id).concat(rank(l, cards, { skip: c => !!c.lessonId }).map(h => h.item));
  const questionsForLesson = (l, questions) => (questions || []).filter(q => q.lessonId === l.id).concat(rank(l, questions, { skip: q => !!q.lessonId }).map(h => h.item));
  const questionsForCard = (c, questions, n = 3) => rank(c, questions, { n }).map(h => h.item);

  // For the admin lists. Which of these items have a lesson (by pin or by tags)? Which lessons have at least one question or card?
  function withLesson(items, lessons) {
    const ids = new Set((lessons || []).map(l => l.id)), ix = index(lessons || []), out = new Set();
    for (const it of items) if ((it.lessonId && ids.has(it.lessonId)) || rank(it, lessons, { index: ix, n: 1 }).length) out.add(it.id);
    return out;
  }
  function lessonsInUse(lessons, items) {
    const ix = index(lessons || []), out = new Set();
    for (const it of items) { if (it.lessonId) out.add(it.lessonId); rank(it, lessons, { index: ix }).forEach(h => out.add(h.item.id)); }
    return out;
  }
  return { MIN, tagsOf, score, rank, index, lesson, cardsForQuestion, cardsForLesson, questionsForLesson, questionsForCard, withLesson, lessonsInUse };
});
