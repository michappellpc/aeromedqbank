'use strict';
// Item analysis for the admin Difficulty tab: turns the database's per-question numbers into difficulty, flags, summaries and a plan for
// reaching a target average. Pure logic, no page code. Runs in the browser and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.ItemStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LABELS = ['', 'Easy', 'Medium', 'Hard'];
  // The percent of members who get a question right on their first try that each label is meant to mean (adjustable by the admin)
  const BANDS = { 1: [80, 100], 2: [55, 79], 3: [0, 54] };
  const MIN_N = 20;                                  // fewest first tries before a question is judged
  const bandOf = (p, bands = BANDS) => (p >= bands[1][0] ? 1 : p >= bands[2][0] ? 2 : 3);
  const FLAG_TEXT = {
    tooeasy: ['Too easy', 'Almost everyone gets it right on the first try'], toohard: ['Too hard', 'Almost no one gets it right on the first try'],
    mislabeled: ['Label does not match', 'Members find it a different difficulty than its label says'], lowdisc: ['Weak separator', 'Strong and weak members do about equally well, so it tells you little'],
    negdisc: ['Check the answer', 'Weaker members do better than stronger ones: the key may be wrong or the wording misleading'], miskey: ['Check the answer', 'A wrong choice is picked more than the correct one'],
    deadopt: ['Unused choice', 'A wrong choice is almost never picked, so it is not working as a distractor'], longans: ['Long answer', 'The correct answer is much longer than the others'], fewdata: ['Few answers', 'Not enough first tries to judge yet']
  };
  const WEIGHT = { miskey: 4, negdisc: 4, tooeasy: 2, toohard: 2, mislabeled: 2, lowdisc: 1, deadopt: 1, longans: 0, fewdata: 0 };

  // row: one line of admin_item_analysis(); q: the question; opts: { minN, bands, lengthTell }
  function analyze(row, q, opts = {}) {
    const minN = opts.minN ?? MIN_N, bands = opts.bands || BANDS;
    const n = Number(row.first_n || 0), c = Number(row.first_correct || 0), enough = n >= minN, p = n ? Math.round(100 * c / n) : null;
    const label = (q && q.difficulty) || 2, band = enough ? bandOf(p, bands) : null, [lo, hi] = bands[label];
    const picks = row.picks || {}, total = Object.values(picks).reduce((a, v) => a + Number(v), 0);
    const options = ((q && q.options) || []).map(o => ({ id: o.id, text: o.text, n: Number(picks[o.id] || 0), share: total ? Math.round(100 * Number(picks[o.id] || 0) / total) : 0, correct: !!q && o.id === q.answer }));
    const correctShare = (options.find(o => o.correct) || { share: 0 }).share, wrong = options.filter(o => !o.correct).sort((a, b) => b.share - a.share || a.id.localeCompare(b.id));
    const disc = row.disc === null || row.disc === undefined ? null : Number(row.disc);
    const flags = [];
    if (!enough) flags.push('fewdata');
    else {
      if (p >= 90) flags.push('tooeasy'); if (p <= 30) flags.push('toohard');
      if (band !== label) flags.push('mislabeled');
    }
    if (n >= 30 && disc !== null) { if (disc < 0) flags.push('negdisc'); else if (disc < 0.1) flags.push('lowdisc'); }
    if (n >= 30 && wrong[0] && wrong[0].share >= 35 && wrong[0].share > correctShare) flags.push('miskey');
    const dead = n >= 40 && options.length >= 3 ? wrong.filter(o => o.share < 5).map(o => o.id) : [];
    if (dead.length) flags.push('deadopt');
    if (opts.lengthTell && q && opts.lengthTell(q)) flags.push('longans');
    return { id: row.question_id, q, subject: q && q.subject, topic: (q && q.topic) || '', label, status: q && q.status, archived: !!(q && q.archived),
      attempts: Number(row.attempts || 0), users: Number(row.users || 0), n, correct: c, pct: p, enough, band, suggested: enough ? band : null,
      gap: enough ? (p > hi ? p - hi : p < lo ? p - lo : 0) : null, disc, options, topWrong: wrong[0] && wrong[0].share > 0 ? wrong[0] : null, dead,
      flags, attention: flags.reduce((a, f) => a + (WEIGHT[f] || 0), 0), lastAt: row.last_at || null, revisedAt: row.revised_at || null };
  }

  // The headline numbers over the questions that have enough first tries
  function summarize(items, opts = {}) {
    const bands = opts.bands || BANDS, ok = items.filter(i => i.enough);
    const sumN = ok.reduce((a, i) => a + i.n, 0), sumC = ok.reduce((a, i) => a + i.correct, 0);
    const mean = ok.length ? ok.reduce((a, i) => a + i.pct, 0) / ok.length : null;
    const byLabel = [1, 2, 3].map(l => { const g = ok.filter(i => i.label === l); return { label: l, name: LABELS[l], count: g.length, avg: g.length ? Math.round(g.reduce((a, i) => a + i.pct, 0) / g.length) : null, band: bands[l], inBand: g.filter(i => i.band === l).length }; });
    const hist = Array.from({ length: 10 }, (_, b) => ({ from: b * 10, to: b === 9 ? 100 : b * 10 + 9, count: ok.filter(i => Math.min(9, Math.floor(i.pct / 10)) === b).length }));
    const subj = {}; ok.forEach(i => { const o = subj[i.subject] ||= { subject: i.subject, count: 0, sum: 0 }; o.count++; o.sum += i.pct; });
    const bySubject = Object.values(subj).map(o => ({ subject: o.subject, count: o.count, avg: Math.round(o.sum / o.count) })).sort((a, b) => a.avg - b.avg);
    return { judged: ok.length, total: items.length, few: items.length - ok.length, mean: mean === null ? null : Math.round(mean * 10) / 10, weighted: sumN ? Math.round(1000 * sumC / sumN) / 10 : null, byLabel, hist, bySubject,
      tooEasy: ok.filter(i => i.flags.includes('tooeasy')).length, tooHard: ok.filter(i => i.flags.includes('toohard')).length, mislabeled: ok.filter(i => i.flags.includes('mislabeled')).length,
      check: items.filter(i => i.flags.includes('miskey') || i.flags.includes('negdisc')).length };
  }

  // How many questions to rewrite, and which, to bring the average first-try percent to a target. Each rewritten question is assumed to land
  // near the target. Easiest first when the average is too high, hardest first when it is too low.
  function shiftPlan(items, target) {
    const ok = items.filter(i => i.enough && !i.archived);
    if (!ok.length) return null;
    const mean = ok.reduce((a, i) => a + i.pct, 0) / ok.length;
    if (Math.abs(mean - target) < 0.5) return { direction: 'none', from: Math.round(mean * 10) / 10, to: Math.round(mean * 10) / 10, ids: [], k: 0 };
    const harder = mean > target, order = ok.slice().sort((a, b) => (harder ? b.pct - a.pct : a.pct - b.pct) || a.id.localeCompare(b.id));
    let sum = ok.reduce((a, i) => a + i.pct, 0), k = 0;
    for (const i of order) { if (harder ? sum / ok.length <= target + 0.5 : sum / ok.length >= target - 0.5) break; sum += target - i.pct; k++; }
    const reached = (harder ? sum / ok.length <= target + 0.5 : sum / ok.length >= target - 0.5);
    return { direction: harder ? 'harder' : 'easier', from: Math.round(mean * 10) / 10, to: Math.round(10 * sum / ok.length) / 10, ids: order.slice(0, k).map(i => i.id), k, reached };
  }

  // A message to paste into a chat with an AI so it rewrites the chosen questions. direction: 'harder' | 'easier'. Returns text.
  function rewritePrompt(items, direction, opts = {}) {
    const target = opts.target, fields = opts.fields || ['id', 'status', 'boards', 'subject', 'topic', 'difficulty', 'stem', 'options', 'answer', 'explanation', 'optionNotes', 'references', 'tier'];
    const how = direction === 'harder'
      ? ['Make the wrong choices more tempting: plausible, from the same category as the right answer, and each reflecting a real misconception.', 'Add a clinically relevant detail or a second step of reasoning, so recalling a fact is not enough.', 'Do not make it harder by being obscure, tricky in wording, or by adding trivia.']
      : ['Make the question stem clearer and more direct, and keep one concept per question.', 'Make the wrong choices easier to rule out, but still plausible.', 'Do not give the answer away in the wording.'];
    const lines = items.map(i => `- ${i.id}: ${i.pct === null ? 'not enough answers yet' : i.pct + '% correct on the first try (' + i.n + ' members)'}; labelled ${LABELS[i.label]}${i.disc === null ? '' : '; separates strong from weak members at ' + i.disc.toFixed(2)}${i.topWrong ? `; wrong choice picked most: ${i.topWrong.id} (${i.topWrong.share}%)` : ''}${i.dead.length ? `; almost never picked: ${i.dead.join(', ')}` : ''}${i.flags.includes('longans') ? '; the correct answer is much longer than the others' : ''}`);
    const qs = items.map(i => { const o = {}; fields.forEach(k => { if (i.q && i.q[k] !== undefined && i.q[k] !== '' && !(Array.isArray(i.q[k]) && !i.q[k].length)) o[k] = i.q[k]; }); o.status = 'draft'; return o; });
    return [`Please rewrite the ${items.length} board-prep question${items.length === 1 ? '' : 's'} below to be ${direction.toUpperCase()}${target ? `, aiming for about ${target}% of residents answering correctly on the first try` : ''}.`, '',
      'Rules:', '- Keep each question\'s id, subject, topic and the concept it tests. Do not change the correct answer unless it is wrong.', ...how.map(h => '- ' + h),
      '- Keep all answer choices a similar length, and keep the correct answer from always being the longest.', '- Keep every patient invented. No real patient information.', '- Keep explanations accurate, with an explanation for each wrong choice in optionNotes.',
      '- Return the questions as one JSON array in exactly the same format as the input, with status "draft".', '', 'How each question has been performing:', ...lines, '', 'The questions:', JSON.stringify(qs, null, 2)].join('\n');
  }

  const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function csv(items) {
    const head = ['id', 'subject', 'topic', 'label', 'first_try_percent', 'first_tries', 'all_attempts', 'discrimination', 'top_wrong_choice', 'top_wrong_share', 'suggested_label', 'flags', 'rewritten_at'];
    const rows = items.map(i => [i.id, i.subject, i.topic, LABELS[i.label], i.pct === null ? '' : i.pct, i.n, i.attempts, i.disc === null ? '' : i.disc, i.topWrong ? i.topWrong.id : '', i.topWrong ? i.topWrong.share : '', i.suggested ? LABELS[i.suggested] : '', i.flags.filter(f => f !== 'fewdata').map(f => FLAG_TEXT[f][0]).join('; '), i.revisedAt ? String(i.revisedAt).slice(0, 10) : '']);
    return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  }
  return { LABELS, BANDS, MIN_N, FLAG_TEXT, bandOf, analyze, summarize, shiftPlan, rewritePrompt, csv };
});
