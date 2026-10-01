'use strict';
// Highlights: the pure logic. A highlight is one range [a, b) of one field's text, plus the words it covered (t) so it can be found again
// if the wording is edited. Runs in the browser and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Hl = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Where a stored highlight sits in the current text: the same place if the words still match, else wherever they now are, else null.
  function anchor(text, h) {
    if (h.a >= 0 && h.b <= text.length && text.slice(h.a, h.b) === h.t) return [h.a, h.b];
    const i = h.t ? text.indexOf(h.t) : -1;
    return i >= 0 ? [i, i + h.t.length] : null;
  }
  // Anchored, sorted ranges for one field: [{ id, a, b }]
  function ranges(text, list) {
    return (list || []).map(h => { const r = anchor(text, h); return r ? { id: h.id, a: r[0], b: r[1] } : null; }).filter(Boolean).sort((x, y) => x.a - y.a || x.b - y.b);
  }
  // The text cut into stretches: [{ a, b, ids }], ids being the highlights covering that stretch (none for plain text).
  function segments(text, list) {
    const rs = ranges(text, list), cuts = new Set([0, text.length]); rs.forEach(r => { cuts.add(r.a); cuts.add(r.b); });
    const pts = [...cuts].sort((x, y) => x - y), out = [];
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (b > a) out.push({ a, b, ids: rs.filter(r => r.a <= a && r.b >= b).map(r => r.id) }); }
    return out;
  }
  // Text with highlighted stretches wrapped in <mark class="hl" data-hl="ids">. esc turns plain text into safe HTML.
  function render(text, list, esc) {
    if (!ranges(text, list).length) return esc(text);
    return segments(text, list).map(s => { const seg = esc(text.slice(s.a, s.b)); return s.ids.length ? `<mark class="hl" data-hl="${s.ids.join(' ')}">${seg}</mark>` : seg; }).join('');
  }
  // Trim spaces from the ends of a selection (so a highlight never starts or ends on a space).
  function trim(text, a, b) {
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    return a < b ? [a, b] : null;
  }
  // Is every character of [a, b) already highlighted?
  function covered(text, list, a, b) {
    const rs = ranges(text, list); let pos = a;
    for (const r of rs) { if (r.b <= pos) continue; if (r.a > pos) break; pos = r.b; if (pos >= b) return true; }
    return pos >= b;
  }
  // Add [a, b): joins any highlight it overlaps or touches into one. Returns { remove: [ids], put: { a, b, t } }.
  function add(text, list, a, b) {
    const r = trim(text, a, b); if (!r) return null;
    let lo = r[0], hi = r[1]; const remove = [];
    const gap = (p, q) => p <= q && !text.slice(p, q).trim();   // nothing but spaces between
    ranges(text, list).forEach(x => { if ((x.a <= hi && x.b >= lo) || gap(x.b, lo) || gap(hi, x.a)) { remove.push(x.id); lo = Math.min(lo, x.a); hi = Math.max(hi, x.b); } });
    return { remove, put: { a: lo, b: hi, t: text.slice(lo, hi) } };
  }
  // Remove [a, b): highlights it overlaps are cut back or split. Returns { remove: [ids], put: [{ a, b, t }] }.
  function sub(text, list, a, b) {
    const remove = [], put = [];
    ranges(text, list).forEach(x => {
      if (x.b <= a || x.a >= b) return;
      remove.push(x.id);
      [[x.a, Math.min(x.b, a)], [Math.max(x.a, b), x.b]].forEach(([p, q]) => { const t = p < q ? trim(text, p, q) : null; if (t) put.push({ a: t[0], b: t[1], t: text.slice(t[0], t[1]) }); });
    });
    return { remove, put };
  }
  // The sentence around [a, b), for turning a highlight into a fill-in-the-blank card.
  function sentence(text, a, b) {
    const isEnd = i => /[.!?]/.test(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]));
    let s = a; while (s > 0 && !(isEnd(s - 1) || text[s - 1] === '\n')) s--;
    let e = b; while (e < text.length && !(isEnd(e - 1) || text[e] === '\n')) e++;
    while (s < e && /\s/.test(text[s])) s++;
    return [s, e];
  }
  // Front of a fill-in-the-blank card: the sentence with the highlighted words replaced by [ ... ]. Back is the highlighted words.
  function blank(text, a, b) {
    const [s, e] = sentence(text, a, b);
    return (text.slice(s, a) + '[ ... ]' + text.slice(b, e)).replace(/\s+/g, ' ').trim();
  }
  return { anchor, ranges, segments, render, trim, covered, add, sub, sentence, blank };
});
