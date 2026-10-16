'use strict';
// The "bank map": every question reduced to its categorization and tagging (no choices, answer or explanation), plus a summary of how the bank covers the
// board outline against the exam weights, so the whole bank can be seen at a glance or handed to a chat. Pure logic, no page code. Runs in the browser and in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require('./outlines-data.js') : root.OutlinesData); else root.BankMap = factory(root.OutlinesData);
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  const REF = /^(aem|om|pm):([TK][0-9]+(?:\.[A-Za-z0-9]+)*)$/;
  const partKey = i => (i.sub ? i.domain + '.' + String(i.sub).trim().charAt(0) : i.domain);
  const round1 = x => Math.round(x * 10) / 10;
  const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; };
  const ABOUT = 'One entry per question with only its categorization and tagging (no answer choices, answer key or explanation). "objectives" are the board outline items the question is tagged with ("board:code"); "domains" are the outline domains those tags fall in. "coverage" compares, for each board, the percent of the exam each domain is worth with the share of this bank\'s tagged questions that touch it (a question tagged in two domains counts in both). "statements_without_questions" are the board\'s knowledge statements that no question is tagged to, at or below them. Archived questions are listed but left out of the coverage figures.';

  function build(questions, opts = {}) {
    const list = (questions || []).filter(Boolean), live = list.filter(q => !q.archived);
    const stats = opts.stats || null;                       // optional { id: { attempts, pct } } from the measured numbers
    // what each question's tags point at, per board
    const place = q => {
      const out = { boards: new Set(), domains: new Set(), parts: new Set(), nodes: new Map(), bad: [] };       // nodes: board -> Set of item codes (the tagged item and every item above it)
      (q.objectives || []).forEach(r => {
        const m = REF.exec(String(r)); if (!m) { out.bad.push(r); return; }
        const raw = DATA[m[1]], byCode = raw && new Map(raw.items.map(i => [i.code, i])), item = byCode && byCode.get(m[2]); if (!item) { out.bad.push(r); return; }
        out.boards.add(m[1]); out.domains.add(m[1] + ':' + item.domain); if (item.sub) out.parts.add(m[1] + ':' + partKey(item));
        const set = out.nodes.get(m[1]) || out.nodes.set(m[1], new Set()).get(m[1]), parts = item.code.split('.');
        while (parts.length > 1) { const code = parts.join('.'); if (byCode.has(code)) set.add(code); parts.pop(); }
      });
      return out;
    };
    const placed = new Map(list.map(q => [q.id, place(q)]));
    const rows = list.map(q => {
      const p = placed.get(q.id), st = stats && stats[q.id];
      const o = { id: q.id, boards: q.boards || [], subject: q.subject || '', topic: q.topic || '', difficulty: q.difficulty || null, status: q.status || '', tier: q.tier || '', archived: !!q.archived,
        high_yield: !!q.highYield, lesson_id: q.lessonId || null, objectives: (q.objectives || []).slice(), objective_count: (q.objectives || []).length, domains: [...p.domains].sort(),
        stem_start: short(q.stem, opts.stemChars || 120), updated: q.updatedAt ? String(q.updatedAt).slice(0, 10) : null };
      if (p.bad.length) o.unrecognized_tags = p.bad;
      if (st) { o.answers = st.attempts; o.percent_correct = st.pct; }
      return o;
    });
    // coverage over the live (not archived) questions, per board that has an outline
    const coverage = {};
    Object.keys(DATA).forEach(b => {
      const raw = DATA[b], weights = raw.weights || {}, byCode = new Map(raw.items.map(i => [i.code, i]));
      const tagged = live.filter(q => placed.get(q.id).boards.has(b));
      const domains = [], seen = new Map();
      raw.items.forEach(i => { if (!seen.has(i.domain)) { const d = { key: i.domain, name: i.domainName, weight_percent: 0, parts: [], questions: 0 }; seen.set(i.domain, d); domains.push(d); } });
      raw.items.forEach(i => { if (i.sub) { const d = seen.get(i.domain), k = partKey(i); if (!d.parts.some(p => p.key === k)) d.parts.push({ key: k, name: String(i.sub).replace(/^[A-Z]\.\s*/, ''), weight_percent: weights[k] || 0, questions: 0 }); } });
      domains.forEach(d => { d.weight_percent = d.parts.length ? d.parts.reduce((a, p) => a + p.weight_percent, 0) : (weights[d.key] || 0); });
      tagged.forEach(q => { const p = placed.get(q.id); domains.forEach(d => { if (p.domains.has(b + ':' + d.key)) d.questions++; d.parts.forEach(pt => { if (p.parts.has(b + ':' + pt.key)) pt.questions++; }); }); });
      const total = tagged.length, share = n => (total ? round1(100 * n / total) : null);
      domains.forEach(d => { d.share_of_tagged_percent = share(d.questions); d.difference_points = total ? round1(d.share_of_tagged_percent - d.weight_percent) : null; d.parts.forEach(pt => { pt.share_of_tagged_percent = share(pt.questions); pt.difference_points = total ? round1(pt.share_of_tagged_percent - pt.weight_percent) : null; }); });
      const count = new Map(); tagged.forEach(q => placed.get(q.id).nodes.get(b).forEach(c => count.set(c, (count.get(c) || 0) + 1)));
      const ks = raw.items.filter(i => i.kind === 'K'), hasChild = new Set(); ks.forEach(i => { const p = i.code.split('.'); p.pop(); while (p.length > 1) { const c = p.join('.'); if (byCode.has(c)) { hasChild.add(c); break; } p.pop(); } });
      const statements = ks.map(i => ({ code: i.code, domain: i.domain, text: short(i.text, 110), questions: count.get(i.code) || 0, leaf: !hasChild.has(i.code) }));
      coverage[b] = { name: raw.name, tagged_questions: total, weights_note: raw.weightsNote || '', domains,
        statements_without_questions: statements.filter(s => s.leaf && !s.questions).map(s => ({ code: s.code, text: s.text })),
        statement_counts: statements.map(s => ({ code: s.code, questions: s.questions, text: s.text })) };
    });
    const byStatus = {}; list.forEach(q => { byStatus[q.status || 'unknown'] = (byStatus[q.status || 'unknown'] || 0) + 1; });
    const untagged = live.filter(q => !placed.get(q.id).domains.size);
    return { about: ABOUT, generated: opts.now || new Date().toISOString(),
      counts: { questions: list.length, not_archived: live.length, archived: list.length - live.length, by_status: byStatus, tagged: live.length - untagged.length, untagged: untagged.length, high_yield: live.filter(q => q.highYield).length },
      coverage, untagged_question_ids: untagged.map(q => q.id), questions: rows };
  }

  const cell = v => { const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  function questionsCsv(map) {
    const stats = map.questions.some(q => q.answers !== undefined);
    const head = ['id', 'boards', 'subject', 'topic', 'difficulty', 'status', 'tier', 'archived', 'high_yield', 'lesson_id', 'objective_count', 'objectives', 'domains', 'stem_start', 'updated'].concat(stats ? ['answers', 'percent_correct'] : []);
    return csv(head, map.questions.map(q => [q.id, q.boards, q.subject, q.topic, q.difficulty, q.status, q.tier, q.archived ? 'yes' : '', q.high_yield ? 'yes' : '', q.lesson_id, q.objective_count, q.objectives, q.domains, q.stem_start, q.updated].concat(stats ? [q.answers, q.percent_correct] : [])));
  }
  function coverageCsv(map) {
    const rows = [];
    Object.entries(map.coverage).forEach(([b, c]) => {
      c.domains.forEach(d => {
        rows.push([b, 'domain', d.key, d.name, d.weight_percent, d.questions, d.share_of_tagged_percent, d.difference_points]);
        d.parts.forEach(p => rows.push([b, 'part', p.key, p.name, p.weight_percent, p.questions, p.share_of_tagged_percent, p.difference_points]));
      });
      c.statement_counts.forEach(s => rows.push([b, 'statement', s.code, s.text, '', s.questions, '', '']));
    });
    return csv(['board', 'level', 'code', 'name_or_text', 'exam_weight_percent', 'questions', 'share_of_tagged_percent', 'difference_points'], rows);
  }
  return { build, questionsCsv, coverageCsv };
});
