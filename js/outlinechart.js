'use strict';
// The board outline chart on the faculty dashboard: for each domain of the ABPM content outline, how much of the exam it is worth (the board's own
// percentages, in outlines-data.js) and how the program's residents are doing on the questions tagged to it. Pure logic, no page code. Runs in the
// browser and in Node (for tests).
//
// A question is tagged to outline items ("aem:K1.E.1"). Its program totals count once toward each item it is tagged with, once toward every item that
// item sits under (K1.E.1 counts toward K1.E), and once toward the domain (and, for the Public Health outline, the part of the domain) it belongs to.
// Questions with no tag for the board are counted separately, so the chart can say how much practice it cannot place.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require('./outlines-data.js') : root.OutlinesData); else root.OutlineChart = factory(root.OutlinesData);
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  const pct = (c, n) => (n ? Math.round(100 * c / n) : null);
  const partKey = i => (i.sub ? i.domain + '.' + String(i.sub).trim().charAt(0) : i.domain);   // "II.A" for the Public Health outline's lettered parts, else the domain
  const REF = /^(aem|om|pm):([TK][0-9]+(?:\.[A-Za-z0-9]+)*)$/;

  // The shape of a board's outline: domains in the board's order, each with its weight, its parts (if the board splits the domain) and its statements
  function layout(boardId) {
    const raw = DATA && DATA[boardId]; if (!raw) return null;
    const weights = raw.weights || {}, domains = [], byKey = new Map();
    raw.items.forEach(i => {
      let d = byKey.get(i.domain);
      if (!d) { d = { key: i.domain, name: i.domainName, weight: 0, parts: [], items: [] }; byKey.set(i.domain, d); domains.push(d); }
      if (i.sub) { const k = partKey(i); if (!d.parts.some(p => p.key === k)) d.parts.push({ key: k, name: String(i.sub).replace(/^[A-Z]\.\s*/, ''), letter: String(i.sub).trim().charAt(0), weight: weights[k] || 0 }); }
      if (i.kind === 'K') d.items.push(i);
    });
    domains.forEach(d => { d.weight = d.parts.length ? d.parts.reduce((a, p) => a + p.weight, 0) : (weights[d.key] || 0); });
    return { id: boardId, name: raw.name, source: raw.source, url: raw.url, note: raw.weightsNote || '', domains };
  }

  // totals: [{ question_id, attempts, correct }] from the database; questions: the bank's questions (id, boards, objectives).
  // Returns the layout with performance on every domain, part and statement, plus how much of the practice could not be placed.
  function rollup(boardId, questions, totals) {
    const L = layout(boardId); if (!L) return null;
    const byQ = new Map((questions || []).map(q => [q.id, q])), raw = DATA[boardId], byCode = new Map(raw.items.map(i => [i.code, i]));
    const acc = new Map(), add = (k, a, c) => { const o = acc.get(k) || { a: 0, c: 0 }; o.a += a; o.c += c; acc.set(k, o); };
    let placed = { a: 0, c: 0 }, unplaced = { a: 0, c: 0 };
    (totals || []).forEach(t => {
      const q = byQ.get(t.question_id); if (!q) return;
      if (q.boards && q.boards.length && !q.boards.includes(boardId)) return;      // a question for another board does not belong on this chart
      const a = Number(t.attempts), c = Number(t.correct), nodes = new Set();
      (q.objectives || []).forEach(r => {
        const m = REF.exec(String(r)); if (!m || m[1] !== boardId) return;
        const item = byCode.get(m[2]); if (!item) return;
        nodes.add('d:' + item.domain); if (item.sub) nodes.add('p:' + partKey(item));
        const parts = item.code.split('.'); while (parts.length > 1) { const code = parts.join('.'); if (byCode.has(code)) nodes.add('i:' + code); parts.pop(); }
      });
      if (!nodes.size) { unplaced.a += a; unplaced.c += c; return; }
      placed.a += a; placed.c += c; nodes.forEach(k => add(k, a, c));
    });
    const stat = k => { const o = acc.get(k) || { a: 0, c: 0 }; return { attempts: o.a, correct: o.c, pct: pct(o.c, o.a) }; };
    L.domains.forEach(d => {
      Object.assign(d, stat('d:' + d.key));
      d.parts.forEach(p => Object.assign(p, stat('p:' + p.key)));
      d.rows = d.items.map(i => ({ code: i.code, text: i.text, part: i.sub ? partKey(i) : null, depth: Math.max(0, i.code.split('.').length - 2), ...stat('i:' + i.code) }));
    });
    L.placed = { attempts: placed.a, correct: placed.c, pct: pct(placed.c, placed.a) };
    L.unplaced = { attempts: unplaced.a };
    L.share = placed.a + unplaced.a ? Math.round(100 * placed.a / (placed.a + unplaced.a)) : null;      // what percent of the program's counted answers could be placed on the outline
    return L;
  }

  // For picking questions by outline item: the set of "board:code" a question covers, i.e. every item it is tagged with and every item above them,
  // so a question tagged K1.E.1 is found under K1.E as well.
  const byCodeCache = {};
  const codes = b => byCodeCache[b] || (byCodeCache[b] = new Set(((DATA && DATA[b] && DATA[b].items) || []).map(i => i.code)));
  const memo = new WeakMap();
  function coverSet(q) {
    const key = q && q.objectives ? q.objectives.join('|') : '', hit = q && typeof q === 'object' ? memo.get(q) : null; if (hit && hit.key === key) return hit.set;
    const out = new Set();
    ((q && q.objectives) || []).forEach(r => {
      const m = REF.exec(String(r)); if (!m || !codes(m[1]).has(m[2])) return;
      const parts = m[2].split('.'); while (parts.length > 1) { const c = parts.join('.'); if (codes(m[1]).has(c)) out.add(m[1] + ':' + c); parts.pop(); }
    });
    if (q && typeof q === 'object') memo.set(q, { key, set: out });
    return out;
  }
  return { layout, rollup, partKey, REF, coverSet };
});
