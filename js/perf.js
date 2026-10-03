'use strict';
// A member's performance by subject or by topic, for their last few tests ("recent"), over everything ("overall"), or both. Pure logic, no page
// code. Runs in the browser and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Perf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RECENT = { t5: 'Your last 5 tests', t10: 'Your last 10 tests', d30: 'The last 30 days' };
  const SORTS = { weak: 'Weakest first', strong: 'Strongest first', most: 'Most answered', least: 'Least answered', up: 'Biggest improvement', down: 'Biggest drop', az: 'A to Z' };
  const DEFAULTS = { group: 'subject', show: 'both', recent: 't5', sort: 'weak', trend: 'overall', compare: true };
  const pct = (c, n) => (n ? Math.round(100 * c / n) : null);
  const clean = d => { const o = { ...DEFAULTS, ...(d || {}) }; if (!['subject', 'topic'].includes(o.group)) o.group = DEFAULTS.group; if (!['recent', 'overall', 'both'].includes(o.show)) o.show = DEFAULTS.show; if (!RECENT[o.recent]) o.recent = DEFAULTS.recent; if (!SORTS[o.sort]) o.sort = DEFAULTS.sort; if (!['overall', 'recent', 'both', 'off'].includes(o.trend)) o.trend = DEFAULTS.trend; o.compare = o.compare !== false; return o; };

  // Answers a test actually holds (a test that ended early lists its unanswered questions in total but they were never answered)
  const answered = t => (t.answers && t.qids ? t.qids.filter(id => t.answers[id]).length : t.total);
  // Answers that are counted in the per-question totals but are in no finished test: tests that were never finished, or answers given before tests were saved.
  // They are put before the first test, so the overall line ends at exactly the "Overall correct" number.
  function residual(qstat, tests) {
    let c = 0, w = 0; Object.values(qstat || {}).forEach(s => { c += s.correct || 0; w += s.wrong || 0; });
    let tc = 0, tw = 0; (tests || []).forEach(t => { tc += t.correct; tw += Math.max(0, answered(t) - t.correct); });
    const rc = Math.max(0, c - tc), rw = Math.max(0, w - tw);
    return { correct: rc, total: rc + rw };
  }
  // Chart points, oldest first: each test's own score (recent) and the running score over every answer up to and including it (overall)
  function trend(tests, n = 12, base) {
    let c = (base && base.correct) || 0, t = (base && base.total) || 0;
    return (tests || []).slice().reverse().map(x => { c += x.correct; t += answered(x); return { recent: pct(x.correct, x.total), overall: pct(c, t) }; }).slice(-n);
  }

  // What everyone else scored on the same questions, to set beside a member's own chart lines: the first-try average of all members (peer) on each test's answered
  // questions, and the same average running across every test so far. null where no question had enough members to show an average.
  function trendGroup(tests, peer, n = 12) {
    let sum = 0, cnt = 0;
    return (tests || []).slice().reverse().map(t => {
      const ps = (t.qids || []).filter(id => (!t.answers || t.answers[id]) && peer && peer[id]).map(id => peer[id].pct), tot = ps.reduce((a, b) => a + b, 0);
      sum += tot; cnt += ps.length;
      return { recent: ps.length ? Math.round(tot / ps.length) : null, overall: cnt ? Math.round(sum / cnt) : null };
    }).slice(-n);
  }

  // tests: newest first, as the app keeps them
  function recentTests(tests, mode, now = Date.now()) {
    const list = tests || [];
    if (mode === 't10') return list.slice(0, 10);
    if (mode === 'd30') return list.filter(t => t.date >= now - 30 * 86400000);
    return list.slice(0, 5);
  }

  // One line per subject (under its board) or per topic. Overall comes from the running totals (qstat), recent from the answers in the chosen tests.
  // input: { group, questions, boards, subjects, qstat, tests, peer, recent, now }
  function aggregate(o) {
    const group = o.group === 'topic' ? 'topic' : 'subject', byId = new Map(o.questions.map(q => [q.id, q])), rows = new Map(), order = [];
    const keysOf = q => group === 'topic' ? [`${q.subject}|${q.topic || ''}`] : q.boards.map(b => `${b}|${q.subject}`);
    const row = (key, q, b) => {
      if (!rows.has(key)) { rows.set(key, { key, board: group === 'subject' ? ((o.boards.find(x => x.id === b) || {}).name || b) : '', boardId: b || '', subject: q.subject, topic: group === 'topic' ? (q.topic || '') : '', total: 0, seen: 0, oc: 0, ow: 0, rc: 0, rn: 0, gu: 0, gc: 0 }); order.push(key); }
      return rows.get(key);
    };
    o.questions.forEach(q => keysOf(q).forEach((key, i) => {
      const r = row(key, q, group === 'subject' ? q.boards[i] : null), s = (o.qstat || {})[q.id];
      r.total++; if (s) { r.oc += s.correct; r.ow += s.wrong; if (s.seen) r.seen++; }
      const g = (o.peer || {})[q.id]; if (g) { r.gu += g.users; r.gc += g.users * g.pct; }
    }));
    const win = recentTests(o.tests, o.recent, o.now);
    let allC = 0, allN = 0;
    win.forEach(t => (t.qids || []).forEach(id => {
      const q = byId.get(id), a = t.answers && t.answers[id]; if (!q || !a) return;     // only questions that were answered count
      const ok = a === q.answer; allN++; if (ok) allC++;
      keysOf(q).forEach(key => { const r = rows.get(key); if (r) { r.rn++; if (ok) r.rc++; } });
    }));
    // in subject view keep the manifest's order of boards and subjects
    let list = order.map(k => rows.get(k));
    if (group === 'subject') { const bi = id => o.boards.findIndex(b => b.id === id), si = r => ((o.subjects || {})[r.boardId] || []).indexOf(r.subject); list = list.sort((a, b) => bi(a.boardId) - bi(b.boardId) || (si(a) < 0 ? 99 : si(a)) - (si(b) < 0 ? 99 : si(b))); }
    else list = list.sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
    list.forEach(r => { r.overall = pct(r.oc, r.oc + r.ow); r.on = r.oc + r.ow; r.recent = pct(r.rc, r.rn); r.change = r.overall !== null && r.recent !== null ? r.recent - r.overall : null; r.group = r.gu ? Math.round(r.gc / r.gu) : null; r.label = group === 'topic' ? `${r.subject}: ${r.topic || 'No topic set'}` : r.subject; });
    return { rows: list, recentCorrect: allC, recentAnswered: allN, recentScore: pct(allC, allN), testsInWindow: win.length };
  }

  // Order the rows. Rows with nothing to show go last (for the score sorts).
  function sortRows(rows, sort, show) {
    const main = r => (show === 'recent' ? r.recent : r.overall), cnt = r => (show === 'recent' ? r.rn : r.on);
    const nul = (f, dir) => (a, b) => { const x = f(a), y = f(b); return (x === null ? 1 : 0) - (y === null ? 1 : 0) || (x === null ? 0 : dir * (x - y)); };
    const cmp = { weak: nul(main, 1), strong: nul(main, -1), most: (a, b) => cnt(b) - cnt(a), least: (a, b) => cnt(a) - cnt(b), up: nul(r => r.change, -1), down: nul(r => r.change, 1), az: () => 0 }[sort] || (() => 0);
    return rows.map((r, i) => [r, i]).sort((a, b) => cmp(a[0], b[0]) || (sort === 'az' ? a[0].label.localeCompare(b[0].label) : 0) || a[1] - b[1]).map(x => x[0]);
  }
  return { RECENT, SORTS, DEFAULTS, clean, trend, trendGroup, residual, recentTests, aggregate, sortRows };
});
