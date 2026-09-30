'use strict';
// Finds the lesson most relevant to a question, by the words they share. Runs in the browser and in Node (for tests).
// Words that are rare across the lessons count more, words in a lesson's title count more than words in its body, and a lesson in the
// question's own subject gets a small head start. If nothing matches well, it returns null and the caller offers the subject's lessons.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Related = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STOP = new Set(('about above after again also among because been before being between both cannot could does doing during each from have having here '
    + 'into most much must only other over same should since some such than that their them then there these they this those through under until very were what when where which while '
    + 'will with would your patient patients following which best most likely next appropriate correct answer').split(/\s+/));
  const stem = w => w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
  const words = s => new Set(String(s || '').toLowerCase().replace(/\*\*/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem));
  const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };

  // lessons: [{ id, subject, title, summary, blocks }]; returns { lesson, score } or null
  function match(q, lessons, opts = {}) {
    const min = opts.min ?? 10;
    if (!q || !lessons || !lessons.length) return null;
    const docs = lessons.map(l => ({ l, title: words(l.title), sum: words(l.summary), body: words(strings(l.blocks).join(' ')) }));
    const df = new Map(); docs.forEach(d => new Set([...d.title, ...d.sum, ...d.body]).forEach(w => df.set(w, (df.get(w) || 0) + 1)));
    const idf = w => Math.log(1 + docs.length / (df.get(w) || 1));
    const right = (q.options || []).find(o => o.id === q.answer);
    const parts = [[words(q.topic), 4], [words(right && right.text), 2], [words(q.stem), 1], [words(q.explanation), 1]];
    let best = null;
    for (const d of docs) {
      let score = 0;
      for (const [ws, weight] of parts) for (const w of ws) {
        const f = d.title.has(w) ? 3 : d.sum.has(w) ? 2 : d.body.has(w) ? 1 : 0;
        if (f) score += weight * f * idf(w);
      }
      if (q.subject && d.l.subject === q.subject) score *= 1.25;
      if (!best || score > best.score) best = { lesson: d.l, score };
    }
    return best && best.score >= min ? best : null;
  }
  return { match, words };
});
