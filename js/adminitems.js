'use strict';
// How each question really performs, for the Questions page in Admin: first-try difficulty, how well a question separates strong from weak
// members, which choices are picked, a table of sections by difficulty with the percent correct.
// The numbers come from the database (admin_item_analysis); the judging is in itemstats.js. admin.js draws the page and calls into this.
const AdminItems = (() => {
  const L = ItemStats.LABELS;
  const prefs = { target: 65, easyMin: 80, medMin: 55, minN: ItemStats.MIN_N, since: false, staff: false };      // fixed: there is no settings panel any more
  const bands = () => ({ 1: [prefs.easyMin, 100], 2: [prefs.medMin, prefs.easyMin - 1], 3: [0, prefs.medMin - 1] });
  let rows = null, items = [], index = new Map(), loadedFor = '', missing = false;
  const flagChip = f => `<span class="flagchip f-${f}" title="${esc(ItemStats.FLAG_TEXT[f][1])}">${esc(ItemStats.FLAG_TEXT[f][0])}</span>`;
  const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const day = t => (t ? new Date(t).toLocaleDateString() : '');
  const FLAGS = Object.keys(ItemStats.FLAG_TEXT).filter(f => f !== 'fewdata');

  function analyze() {
    const byId = new Map(Admin.cache.list.map(q => [q.id, q]));
    items = (rows || []).filter(r => byId.has(r.question_id)).map(r => ItemStats.analyze(r, byId.get(r.question_id), { minN: prefs.minN, bands: bands(), lengthTell: QValidate.lengthTell }));
    index = new Map(items.map(i => [i.id, i]));
  }
  // Fetch the analysis. If the database has not been upgraded yet the Questions page still works, just without these extras.
  async function load(force) {
    const key = `${prefs.since}|${prefs.staff}`;
    if (!force && rows && loadedFor === key) { analyze(); return true; }
    try { rows = await Cloud.rpc('admin_item_analysis', { since_edit: !!prefs.since, include_staff: !!prefs.staff }); loadedFor = key; missing = false; analyze(); return true; }
    catch { rows = null; items = []; index = new Map(); missing = true; return false; }
  }
  const reset = () => { rows = null; };

  // ------------------------------------------------------------------ sections by difficulty, with the percent correct
  // One row per section (grouped under its board): how many Easy, Medium and Hard questions are live, how many drafts, and the share of first
  // tries that were right. Click a section or a count to filter the list below.
  function sectionTable(list) {
    const live = list.filter(q => !q.archived), by = {};
    const cell = (s, lab) => { const o = (by[s] ||= { 1: { n: 0, fn: 0, fc: 0 }, 2: { n: 0, fn: 0, fc: 0 }, 3: { n: 0, fn: 0, fc: 0 }, draft: 0, fn: 0, fc: 0 }); return lab ? o[lab] : o; };
    live.forEach(q => {
      const o = cell(q.subject), lab = q.difficulty || 2, it = index.get(q.id);
      if (q.status !== 'reviewed') { o.draft++; return; }
      o[lab].n++; if (it) { o[lab].fn += it.n; o[lab].fc += it.correct; o.fn += it.n; o.fc += it.correct; }
    });
    const seen = new Set(), groups = [];
    bank.boards.forEach(b => { const subs = (bank.subjects[b.id] || []).filter(s => by[s] && !seen.has(s)); subs.forEach(s => seen.add(s)); if (subs.length) groups.push({ name: b.name, subs }); });
    const other = Object.keys(by).filter(s => !seen.has(s)).sort(); if (other.length) groups.push({ name: 'Other', subs: other });
    const bd = bands(), MIN = 5;
    const pctOf = (c, n) => (n >= MIN ? Math.round(100 * c / n) : null);
    const heat = (p, lab) => { if (p === null) return 'none'; const [lo, hi] = lab ? bd[lab] : [0, 100]; return !lab ? (p >= 70 ? 'hi' : p >= 50 ? 'mid' : 'lo') : (p >= lo && p <= hi ? 'hi' : (p < lo ? lo - p : p - hi) <= 10 ? 'mid' : 'lo'); };
    const td = (s, lab, c) => {
      const p = pctOf(c.fc, c.fn);
      return `<td class="heat ${heat(p, lab)}">${c.n ? `<button type="button" class="cellbtn" data-sec="${esc(s)}" data-lab="${lab}" aria-label="Show the ${c.n} ${L[lab]} ${esc(s)} questions"><b>${c.n}</b></button>` : '<span class="muted">0</span>'}<span class="small"> ${p === null ? (c.n ? '(few answers)' : '') : p + '% correct'}</span></td>`;
    };
    const tot = { 1: { n: 0, fn: 0, fc: 0 }, 2: { n: 0, fn: 0, fc: 0 }, 3: { n: 0, fn: 0, fc: 0 }, draft: 0, fn: 0, fc: 0 };
    Object.values(by).forEach(o => { [1, 2, 3].forEach(l => { tot[l].n += o[l].n; tot[l].fn += o[l].fn; tot[l].fc += o[l].fc; }); tot.draft += o.draft; tot.fn += o.fn; tot.fc += o.fc; });
    const liveN = o => o[1].n + o[2].n + o[3].n;
    const body = groups.map(g => `<tr class="grouprow"><th scope="colgroup" colspan="7">${esc(g.name)}</th></tr>` + g.subs.map(s => { const o = by[s], p = pctOf(o.fc, o.fn);
      return `<tr><th scope="row"><button type="button" class="cellbtn" data-sec="${esc(s)}" data-lab="" aria-label="Show all ${esc(s)} questions">${esc(s)}</button></th>${td(s, 1, o[1])}${td(s, 2, o[2])}${td(s, 3, o[3])}<td>${liveN(o)}</td><td>${o.draft || '<span class="muted">0</span>'}</td><td class="heat ${heat(p, 0)}"><b>${p === null ? '-' : p + '%'}</b></td></tr>`; }).join('')).join('');
    const tp = pctOf(tot.fc, tot.fn);
    return `<div class="scroll" role="region" tabindex="0" aria-label="Sections by difficulty table"><table class="heatmap sectable"><caption class="sr">Questions in each section by difficulty, with the percent of first tries answered correctly</caption>
      <thead><tr><th scope="col">Section</th><th scope="col">Easy</th><th scope="col">Medium</th><th scope="col">Hard</th><th scope="col">Live</th><th scope="col">Draft</th><th scope="col">% correct</th></tr></thead><tbody>${body}
      <tr class="avgrow"><th scope="row">All sections</th><td>${tot[1].n}${pctOf(tot[1].fc, tot[1].fn) === null ? '' : ` <span class="small">${pctOf(tot[1].fc, tot[1].fn)}%</span>`}</td><td>${tot[2].n}${pctOf(tot[2].fc, tot[2].fn) === null ? '' : ` <span class="small">${pctOf(tot[2].fc, tot[2].fn)}%</span>`}</td><td>${tot[3].n}${pctOf(tot[3].fc, tot[3].fn) === null ? '' : ` <span class="small">${pctOf(tot[3].fc, tot[3].fn)}%</span>`}</td><td>${tot[1].n + tot[2].n + tot[3].n}</td><td>${tot.draft}</td><td><b>${tp === null ? '-' : tp + '%'}</b></td></tr></tbody></table></div>
      <p class="muted small">Counts are live questions; the percent is the share of members' <b>first tries</b> that were right (shown once there are ${MIN} or more). Green means inside the range its label stands for (Easy ${bd[1][0]}%+, Medium ${bd[2][0]}% to ${bd[2][1]}%, Hard under ${bd[3][1] + 1}%), amber within 10 points of it, red further off. Click a section or a count to list those questions.</p>`;
  }

  // The one line shown beside the title, so a minimized table still says something
  function summaryLine(list) {
    const live = list.filter(q => !q.archived && q.status === 'reviewed'), c = [0, 0, 0, 0]; let fn = 0, fc = 0;
    live.forEach(q => { c[q.difficulty || 2]++; const i = index.get(q.id); if (i) { fn += i.n; fc += i.correct; } });
    return `${c[1]} easy, ${c[2]} medium, ${c[3]} hard${fn >= 5 ? ` \u00b7 ${Math.round(100 * fc / fn)}% correct` : ''}`;
  }

  // ------------------------------------------------------------------ pieces of a row
  const get = id => index.get(id) || null;
  function detail(i) {                      // what is behind one question's numbers
    if (!i) return '<p class="muted">No data for this question yet.</p>';
    const opts = i.options.length ? `<ul class="optdist">${i.options.map(o => `<li class="${o.correct ? 'right' : ''}"><span class="k">${esc(o.id)}.</span><span class="optt">${esc(trunc(o.text, 90))}${o.correct ? ' <span class="tag reviewed">Correct</span>' : ''}${i.dead.includes(o.id) ? ' <span class="flagchip f-deadopt">Rarely picked</span>' : ''}</span><div class="bar" aria-hidden="true"><i style="width:${o.share}%;background:${o.correct ? 'var(--good)' : 'var(--gold)'}"></i></div><span class="pickn"><b>${o.share}%</b> <span class="muted small">(${o.n})</span></span></li>`).join('')}</ul>` : '<p class="muted">No choices.</p>';
    return `<div class="detail"><div><h3 class="small" style="margin:0 0 4px">Which choices members picked (first tries)</h3>${i.n ? opts : '<p class="muted">No answers yet.</p>'}</div>
      <div><h3 class="small" style="margin:0 0 4px">What the numbers say</h3><ul class="reclist small">${i.flags.length ? i.flags.map(f => `<li>${flagChip(f)} <span class="muted">${esc(ItemStats.FLAG_TEXT[f][1])}</span></li>`).join('') : '<li class="muted">Nothing stands out.</li>'}
        <li class="muted">${i.attempts} answers in all from ${i.users} members${i.lastAt ? `, last on ${esc(day(i.lastAt))}` : ''}.</li></ul>
        <h3 class="small" style="margin:10px 0 4px">Rewrite history</h3><div id="rev-${esc(i.id)}" class="small muted">Loading...</div>
        <div class="row" style="margin-top:8px"><a class="btn" href="#/admin/questions/edit/${esc(i.id)}">Edit this question</a></div></div></div>`;
  }
  async function loadRevisions(i) {
    const box = document.getElementById('rev-' + i.id); if (!box) return;
    try {
      const list = await Cloud.questionRevisions(i.id);
      const cur = i.revisedAt ? `<li>Current wording since ${esc(day(i.revisedAt))}: ${i.pct === null ? 'no first tries yet' : `<b>${i.pct}%</b> (${i.n} first tries, all time)`}.</li>` : '';
      box.innerHTML = list.length ? `<ul class="reclist">${cur}${list.map(r => `<li>${esc(day(r.revised_at))} by ${esc(r.revised_by || 'unknown')}: the previous wording had ${r.first_n ? `<b>${Math.round(100 * r.first_correct / r.first_n)}%</b> correct (${r.first_n} first tries)` : 'no answers'}.</li>`).join('')}</ul>` : 'Never rewritten since tracking began.';
      box.classList.remove('muted');
    } catch { box.textContent = 'Not available yet (the database needs the latest schema).'; }
  }
  const download = (text, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
  // Actions the Questions page adds to its selection bar. Returns true when the page should reload.
  async function act(kind, ids) {
    const sel = items.filter(i => ids.includes(i.id));
    if (kind === 'csv') { download(ItemStats.csv(sel.length ? sel : []), 'question-difficulty-selected.csv', 'text/csv'); return false; }
    if (kind === 'relabel') {
      const rel = sel.filter(i => i.suggested && i.suggested !== i.label);
      if (!rel.length) return false;
      if (!(await ask(`Change the difficulty label of ${rel.length} ${rel.length === 1 ? 'question' : 'questions'} to match how members find ${rel.length === 1 ? 'it' : 'them'}? Live questions stay live.`, 'Change labels'))) return false;
      for (const lab of [1, 2, 3]) { const g = rel.filter(i => i.suggested === lab).map(i => i.id); if (g.length) await Cloud.patchQuestions(g, { difficulty: lab }); }
      toast('Labels updated.'); return true;
    }
    return false;
  }
  // Sorting and filtering by the measured numbers
  const SORTS = [['attention', 'Measured: needs attention first'], ['mhard', 'Measured: hardest first'], ['measy', 'Measured: easiest first'], ['gap-easy', 'Furthest too easy for its label'], ['gap-hard', 'Furthest too hard for its label'],
    ['disc-low', 'Weakest separation'], ['disc-high', 'Best separation'], ['many', 'Most answers'], ['few', 'Fewest answers'], ['rewritten', 'Recently rewritten']];
  const sorter = k => ({ attention: (a, b) => b.attention - a.attention, mhard: (a, b) => (a.pct ?? 101) - (b.pct ?? 101), measy: (a, b) => (b.pct ?? -1) - (a.pct ?? -1), 'gap-easy': (a, b) => (b.gap ?? -99) - (a.gap ?? -99), 'gap-hard': (a, b) => (a.gap ?? 99) - (b.gap ?? 99),
    'disc-low': (a, b) => (a.disc ?? 9) - (b.disc ?? 9), 'disc-high': (a, b) => (b.disc ?? -9) - (a.disc ?? -9), many: (a, b) => b.n - a.n, few: (a, b) => a.n - b.n, rewritten: (a, b) => String(b.revisedAt || '').localeCompare(String(a.revisedAt || '')) })[k] || null;
  const ready = () => !missing && !!rows;
  return { load, reset, get, ready, summaryLine, get missing() { return missing; }, get prefs() { return prefs; }, sectionTable, detail, loadRevisions, act, SORTS, sorter, FLAGS, flagChip, download };
})();
