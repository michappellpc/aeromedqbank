'use strict';
// Program insights: turns the group totals a program's faculty can see into a ranked list of weaknesses, the lessons that would help most,
// and the residents who may need a check-in. Pure logic, no page code. Runs in the browser and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require('./related.js') : root.Related); else root.Insights = factory(root.Related);
})(typeof self !== 'undefined' ? self : this, function (Related) {
  const TARGET = 70;                                         // the percent correct a program should be reaching
  const pct = (c, n) => (n ? Math.round(100 * c / n) : 0);
  const label = t => (t.topic ? `${t.subject}: ${t.topic}` : t.subject);

  // Topic rows from the database -> weaknesses, worst first. A topic ranks higher the further it is under the target, the further it is under
  // all members, the more residents are struggling with it, and the more answers back it up (a few answers count for less).
  function weak(rows, opts = {}) {
    const target = opts.target ?? TARGET;
    return (rows || []).map(r => {
      const attempts = Number(r.attempts), correct = Number(r.correct), residents = Number(r.residents), low = Number(r.low_residents);
      const p = pct(correct, attempts), gA = Number(r.group_attempts || 0), g = gA ? pct(Number(r.group_correct), gA) : null;
      const shortfall = Math.max(0, target - p), behind = g === null ? 0 : Math.max(0, g - p), breadth = residents ? low / residents : 0;
      const conf = Math.min(1, Math.sqrt(attempts / 30));
      return { subject: r.subject, topic: r.topic || '', label: label(r), attempts, correct, pct: p, residents, low, group: g, behind: g === null ? null : g - p,
        breadth, score: (shortfall + 0.5 * behind) * (0.6 + 0.4 * breadth) * conf };
    }).filter(w => w.score > 0).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  }

  // The lessons that would help most with a topic: matched on the topic's name and on the wording of the questions that were missed.
  // questions: the bank's questions; used for the words of the questions in that topic. Returns [{ lesson, reason }].
  function lessonsFor(w, lessons, questions, n = 3) {
    const qs = (questions || []).filter(q => q.subject === w.subject && (w.topic ? (q.topic || '') === w.topic : true)).slice(0, 12);
    const probe = { subject: w.subject, topic: w.topic, stem: qs.map(q => q.stem).join(' '), explanation: qs.map(q => q.explanation).join(' '), options: [], answer: '' };
    // a lesson from another subject has to match much more strongly, so a shared everyday word is never enough
    return Related.rank(probe, lessons, { n: n + 4, min: 10 }).filter(h => h.lesson.subject === w.subject || h.score >= 25).slice(0, n).map(h => ({ lesson: h.lesson, reason: h.titleHit ? 'Its title matches the topic' : h.lesson.subject === w.subject ? 'Same subject, covers the same terms' : 'Covers the same terms' }));
  }

  // Residents worth a conversation: quiet for two weeks, or answering a lot and getting under half right. today: 'YYYY-MM-DD'.
  function attention(roster, today, opts = {}) {
    const quiet = opts.quietDays ?? 14, minAnswers = opts.minAnswers ?? 20, low = opts.low ?? 50, now = Date.parse(today + 'T12:00:00Z');
    const out = [];
    (roster || []).filter(r => r.status === 'approved').forEach(r => {
      const n = Number(r.attempts || 0), c = Number(r.correct || 0), reasons = [];
      const last = r.last_active ? Date.parse(r.last_active) : null;
      const days = last ? Math.floor((now - last) / 86400000) : null;
      if (n === 0) { if (r.joined && Math.floor((now - Date.parse(r.joined)) / 86400000) >= 7) reasons.push('Has not answered any questions yet'); }
      else if (days !== null && days >= quiet) reasons.push(`No activity for ${days} days`);
      if (n >= minAnswers && pct(c, n) < low) reasons.push(`${pct(c, n)}% correct over ${n} answers`);
      if (reasons.length) out.push({ user_id: r.user_id, reasons, n, pct: n ? pct(c, n) : null });
    });
    return out;
  }

  // Questions the group missed most -> rows with the group's and all members' percent
  function missed(rows) {
    return (rows || []).map(r => {
      const n = Number(r.attempts), c = Number(r.correct), gn = Number(r.group_attempts || 0);
      return { id: r.question_id, subject: r.subject, topic: r.topic || '', stem: r.stem, attempts: n, pct: pct(c, n), residents: Number(r.residents), group: gn ? pct(Number(r.group_correct), gn) : null,
        wrong: r.top_wrong || null, wrongShare: r.top_wrong && Number(r.wrong_total) ? pct(Number(r.top_wrong_n), Number(r.wrong_total)) : null,
        // the whole question, for the report: its text, choices and correct answer, and the choice residents picked most overall (named only when at least two chose it)
        fullStem: r.full_stem || r.stem, options: Array.isArray(r.options) ? r.options : [], answer: r.answer || null, hasImage: !!r.has_image,
        topPick: r.top_pick || null, topPickN: r.top_pick ? Number(r.top_pick_n) : null, pickTotal: Number(r.pick_total || 0) };
    });
  }

  // Weekly rows -> [{ correct, total }] oldest first, ready for a trend chart; weeks with no answers are skipped
  const weeks = rows => (rows || []).map(r => ({ week: r.week_start, correct: Number(r.correct), total: Number(r.attempts), active: Number(r.active_residents) })).filter(w => w.total > 0);

  // The other side of the picture: topics where the program is doing best (at or above the target), best first, and every subject ranked best to worst.
  function strong(rows, opts = {}) {
    const target = opts.target ?? TARGET;
    return (rows || []).map(r => {
      const attempts = Number(r.attempts), correct = Number(r.correct), residents = Number(r.residents), low = Number(r.low_residents);
      const p = pct(correct, attempts), gA = Number(r.group_attempts || 0), g = gA ? pct(Number(r.group_correct), gA) : null;
      const conf = Math.min(1, Math.sqrt(attempts / 30)), ahead = g === null ? 0 : Math.max(0, p - g);
      return { subject: r.subject, topic: r.topic || '', label: label(r), attempts, correct, pct: p, residents, low, group: g, ahead: g === null ? null : p - g, score: (p - target + 0.5 * ahead) * conf };
    }).filter(w => w.pct >= target).sort((a, b) => b.score - a.score || b.pct - a.pct || a.label.localeCompare(b.label));
  }
  function sections(rows) {
    const by = new Map();
    (rows || []).forEach(r => {
      const o = by.get(r.subject) || { subject: r.subject, attempts: 0, correct: 0, gA: 0, gC: 0, topics: 0 };
      o.attempts += Number(r.attempts); o.correct += Number(r.correct); o.gA += Number(r.group_attempts || 0); o.gC += Number(r.group_correct || 0); o.topics++; by.set(r.subject, o);
    });
    return [...by.values()].map(o => ({ subject: o.subject, attempts: o.attempts, pct: pct(o.correct, o.attempts), group: o.gA ? pct(o.gC, o.gA) : null, topics: o.topics }))
      .sort((a, b) => b.pct - a.pct || b.attempts - a.attempts || a.subject.localeCompare(b.subject));
  }

  return { TARGET, weak, strong, sections, lessonsFor, attention, missed, weeks, label, pct };
});
