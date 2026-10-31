'use strict';
// Reviewer > Performance: how every question is doing, as totals only. It uses the same per-question figures the Questions page shows
// (answers and % correct, with faculty, staff and each member's identity left out). It never shows who answered anything.
const ReviewPerf = (() => {
  const MIN = 10;                                     // answers needed before a question's % correct means anything
  const pct = (c, n) => (n ? Math.round((1000 * c) / n) / 10 : null);
  const fmt = v => (v === null || v === undefined ? '-' : v + '%');

  async function page() {
    pageTitle('Performance');
    $app.innerHTML = Admin.tabs('performance') + '<div class="card"><p class="muted">Loading the numbers...</p></div>';
    let stats, qs;
    try { [stats, qs] = await Promise.all([Cloud.rpc('admin_question_stats'), Cloud.editorQuestions()]); }
    catch (e) { $app.innerHTML = Admin.tabs('performance') + `<div class="card"><p class="muted">Could not load the numbers: ${esc(e.offline ? 'you are offline' : e.message)}</p></div>`; return; }
    const byId = new Map((qs || []).map(q => [q.id, q]));
    const rows = (stats || []).filter(s => !s.archived && s.bank !== 'skills' && byId.has(s.question_id)).map(s => ({ id: s.question_id, subject: s.subject || '(none)', live: s.status === 'reviewed', n: +s.attempts || 0, c: +s.correct || 0, stem: (byId.get(s.question_id).stem || '').replace(/\s+/g, ' ') }));
    const live = rows.filter(r => r.live), N = live.reduce((a, r) => a + r.n, 0), C = live.reduce((a, r) => a + r.c, 0);
    const subj = new Map(); live.forEach(r => { const o = subj.get(r.subject) || { subject: r.subject, q: 0, n: 0, c: 0, unseen: 0 }; o.q++; o.n += r.n; o.c += r.c; if (!r.n) o.unseen++; subj.set(r.subject, o); });
    const judged = live.filter(r => r.n >= MIN).map(r => ({ ...r, p: pct(r.c, r.n) })).sort((a, b) => a.p - b.p || b.n - a.n);
    const link = r => `<a href="#/admin/questions/edit/${esc(r.id)}">${esc(r.id)}</a><div class="muted small">${esc(r.stem.slice(0, 90))}${r.stem.length > 90 ? '...' : ''}</div>`;
    const table = (list, cap) => list.length ? `<div class="scroll" role="region" tabindex="0" aria-label="${esc(cap)}"><table><caption class="sr">${esc(cap)}</caption><thead><tr><th scope="col">Question</th><th scope="col">Subject</th><th scope="col">Answers</th><th scope="col">% correct</th></tr></thead><tbody>${list.map(r => `<tr><td>${link(r)}</td><td>${esc(r.subject)}</td><td>${r.n}</td><td>${fmt(r.p)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">Not enough answers yet (a question needs at least ${MIN}).</p>`;
    $app.innerHTML = `${Admin.tabs('performance')}
      <div class="card"><h2 style="margin:0">Performance</h2><p class="muted">How the live questions are doing across all members. Totals only: no names, no emails, no one's individual scores.</p>
        <div class="grid"><div class="card stat"><b>${live.length}</b><span>Live questions</span></div><div class="card stat"><b>${N}</b><span>Answers given</span></div><div class="card stat"><b>${fmt(pct(C, N))}</b><span>Correct overall</span></div><div class="card stat"><b>${live.filter(r => !r.n).length}</b><span>Never answered yet</span></div></div></div>
      <div class="card"><h3 style="margin-top:0">By subject</h3><div class="scroll" role="region" tabindex="0" aria-label="Performance by subject"><table><caption class="sr">Performance by subject</caption><thead><tr><th scope="col">Subject</th><th scope="col">Live questions</th><th scope="col">Answers</th><th scope="col">% correct</th><th scope="col">Never answered</th></tr></thead><tbody>${[...subj.values()].sort((a, b) => (pct(a.c, a.n) ?? 101) - (pct(b.c, b.n) ?? 101)).map(o => `<tr><td>${esc(o.subject)}</td><td>${o.q}</td><td>${o.n}</td><td>${fmt(pct(o.c, o.n))}</td><td>${o.unseen}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No live questions yet.</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3 style="margin-top:0">Hardest questions</h3><p class="muted small">The lowest % correct, among questions with at least ${MIN} answers. Open one to check the wording, the answer and the explanation.</p>${table(judged.slice(0, 15), 'Hardest questions')}</div>
      <div class="card"><h3 style="margin-top:0">Easiest questions</h3><p class="muted small">The highest % correct. Very easy ones may be too obvious.</p>${table(judged.slice(-15).reverse(), 'Easiest questions')}</div>
      <p class="muted small">The Questions tab shows the same numbers for each question, plus how often each wrong answer is picked.</p>`;
  }
  return { page };
})();
