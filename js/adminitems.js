'use strict';
// Admin > Difficulty: how each question is really performing (first-try difficulty, how well it separates strong from weak members, which
// choices are picked), filters and sorts to find what to fix, a plan for reaching a target average, and bulk actions to relabel,
// hide or send questions off for a rewrite. The numbers come from the database (admin_item_analysis); the judging is in itemstats.js.
const AdminItems = (() => {
  const L = ItemStats.LABELS;
  const PREF = 'qbank.items';
  const defaults = { target: 65, easyMin: 80, medMin: 55, minN: ItemStats.MIN_N, since: false, staff: false };
  let prefs = { ...defaults };
  try { prefs = { ...defaults, ...(JSON.parse(localStorage.getItem(PREF)) || {}) }; } catch {}
  const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch {} };
  const bands = () => ({ 1: [prefs.easyMin, 100], 2: [prefs.medMin, prefs.easyMin - 1], 3: [0, prefs.medMin - 1] });
  const view = { q: '', subject: '', label: '', flag: '', status: 'active', data: '', min: '', max: '', sort: 'attention', page: 0, sel: new Set(), open: new Set() };
  const PAGE = 40;
  let rows = null, items = [], loadedFor = '';
  const flagChip = f => `<span class="flagchip f-${f}" title="${esc(ItemStats.FLAG_TEXT[f][1])}">${esc(ItemStats.FLAG_TEXT[f][0])}</span>`;
  const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const day = t => (t ? new Date(t).toLocaleDateString() : '');

  function analyze() {
    const byId = new Map(Admin.cache.list.map(q => [q.id, q]));
    items = rows.filter(r => byId.has(r.question_id)).map(r => ItemStats.analyze(r, byId.get(r.question_id), { minN: prefs.minN, bands: bands(), lengthTell: QValidate.lengthTell }));
  }
  async function load(force) {
    const c = await Admin.ensure(force); if (!c) return false;
    const key = `${prefs.since}|${prefs.staff}`;
    if (force || !rows || loadedFor !== key) {
      try { rows = await Cloud.rpc('admin_item_analysis', { since_edit: !!prefs.since, include_staff: !!prefs.staff }); loadedFor = key; }
      catch (e) {
        $app.innerHTML = Admin.tabs('difficulty') + Admin.note(`Could not load the analysis: ${esc(e.offline ? 'you are offline' : /schema cache|does not exist|Could not find/i.test(e.message || '') ? 'the database needs the latest schema. In Supabase open SQL Editor, paste the latest supabase/schema.sql from GitHub and click Run.' : e.message)}`, 'muted');
        return false;
      }
    }
    analyze(); return true;
  }

  // ------------------------------------------------------------------ the page
  async function page() {
    pageTitle('Difficulty');
    if (!(await load(false))) return;
    $app.innerHTML = `${Admin.tabs('difficulty')}
      <div class="card"><div class="row spread"><div><h2 style="margin:0">Difficulty</h2><p class="muted" style="margin:4px 0 0">How each question really performs, so you can tune the average. Difficulty is the share of members who get a question right on their <b>first try</b>.</p></div>
        <div class="row"><button type="button" id="ia-csv">Download CSV</button><button type="button" id="ia-reload">Refresh</button></div></div>
        <form id="ia-set" class="fgrid" style="margin-top:12px" onsubmit="return false" aria-label="Analysis settings">
          <div><label for="ia-since">Count</label><select id="ia-since"><option value="all"${prefs.since ? '' : ' selected'}>All answers to each question</option><option value="since"${prefs.since ? ' selected' : ''}>Only answers since it was last rewritten</option></select></div>
          <div><label for="ia-minn">Fewest first tries to judge a question</label><input id="ia-minn" type="number" min="5" max="200" value="${prefs.minN}"></div>
          <div><label for="ia-target">Target average (% correct)</label><input id="ia-target" type="number" min="30" max="95" value="${prefs.target}"></div>
          <div><label class="chk" style="margin-top:26px"><input type="checkbox" id="ia-staff"${prefs.staff ? ' checked' : ''}> Include admin, reviewer and faculty answers</label></div>
          <details style="grid-column:1/-1"><summary>What counts as Easy, Medium and Hard</summary><div class="fgrid" style="margin-top:8px">
            <div><label for="ia-easy">Easy is this % correct or more</label><input id="ia-easy" type="number" min="50" max="99" value="${prefs.easyMin}"></div>
            <div><label for="ia-med">Medium is this % correct or more</label><input id="ia-med" type="number" min="10" max="98" value="${prefs.medMin}"></div>
            <p class="muted small" style="grid-column:1/-1">Below the Medium line is Hard. A question is "off its label" when members find it a different difficulty than the label says.</p></div></details></form></div>
      <div id="ia-top"></div>
      <div class="card"><form id="ia-flt" class="filters" onsubmit="return false" aria-label="Filter questions">
        <div><label for="if-q">Search</label><input id="if-q" type="search" placeholder="id, topic or words" value="${esc(view.q)}"></div>
        <div><label for="if-sub">Subject</label><select id="if-sub"></select></div>
        <div><label for="if-lab">Label</label><select id="if-lab"><option value="">All</option>${[1, 2, 3].map(n => `<option value="${n}">${L[n]}</option>`).join('')}</select></div>
        <div><label for="if-flag">Flag</label><select id="if-flag"><option value="">Any</option><option value="any">Has any flag</option>${Object.keys(ItemStats.FLAG_TEXT).filter(f => f !== 'fewdata').map(f => `<option value="${f}">${esc(ItemStats.FLAG_TEXT[f][0])}${f === 'miskey' || f === 'negdisc' ? '' : ''}</option>`).join('')}</select></div>
        <div><label for="if-st">Show</label><select id="if-st"><option value="active">Live and draft</option><option value="reviewed">Live only</option><option value="draft">Draft only</option><option value="archived">Archived</option></select></div>
        <div><label for="if-data">Data</label><select id="if-data"><option value="">All</option><option value="judged">Enough answers</option><option value="few">Too few answers</option></select></div>
        <div><label for="if-min">% correct from</label><input id="if-min" type="number" min="0" max="100" value="${esc(view.min)}"></div>
        <div><label for="if-max">to</label><input id="if-max" type="number" min="0" max="100" value="${esc(view.max)}"></div>
        <div><label for="if-sort">Sort by</label><select id="if-sort">${[['attention', 'Needs attention first'], ['easy', 'Easiest first'], ['hard', 'Hardest first'], ['gap-easy', 'Furthest too easy for its label'], ['gap-hard', 'Furthest too hard for its label'], ['disc-low', 'Weakest separation'], ['disc-high', 'Best separation'], ['many', 'Most answers'], ['few', 'Fewest answers'], ['rewritten', 'Recently rewritten'], ['id', 'ID']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div></form></div>
      <div id="ia-bulk"></div><div class="card" id="ia-list"></div>`;
    const el = id => document.getElementById(id), set = (id, v) => { el(id).value = v; };
    el('if-sub').innerHTML = '<option value="">All</option>' + [...new Set(items.map(i => i.subject))].sort().map(s => `<option${view.subject === s ? ' selected' : ''}>${esc(s)}</option>`).join('');
    set('if-lab', view.label); set('if-flag', view.flag); set('if-st', view.status); set('if-data', view.data); set('if-sort', view.sort);
    const on = (id, ev, fn) => el(id).addEventListener(ev, fn), repaint = () => { view.page = 0; paintList(); };
    on('if-q', 'input', e => { view.q = e.target.value; repaint(); }); on('if-sub', 'change', e => { view.subject = e.target.value; repaint(); }); on('if-lab', 'change', e => { view.label = e.target.value; repaint(); });
    on('if-flag', 'change', e => { view.flag = e.target.value; repaint(); }); on('if-st', 'change', e => { view.status = e.target.value; repaint(); }); on('if-data', 'change', e => { view.data = e.target.value; repaint(); });
    on('if-min', 'input', e => { view.min = e.target.value; repaint(); }); on('if-max', 'input', e => { view.max = e.target.value; repaint(); }); on('if-sort', 'change', e => { view.sort = e.target.value; repaint(); });
    const num = (id, key, lo, hi) => on(id, 'change', e => { const v = Math.max(lo, Math.min(hi, Math.round(+e.target.value) || defaults[key])); e.target.value = v; prefs[key] = v; if (prefs.easyMin <= prefs.medMin) { prefs.medMin = Math.max(10, prefs.easyMin - 10); set('ia-med', prefs.medMin); } savePrefs(); analyze(); paintTop(); paintList(); });
    num('ia-minn', 'minN', 5, 200); num('ia-target', 'target', 30, 95); num('ia-easy', 'easyMin', 50, 99); num('ia-med', 'medMin', 10, 98);
    on('ia-since', 'change', async e => { prefs.since = e.target.value === 'since'; savePrefs(); if (await load(false)) { paintTop(); paintList(); } });
    on('ia-staff', 'change', async e => { prefs.staff = e.target.checked; savePrefs(); if (await load(false)) { paintTop(); paintList(); } });
    on('ia-reload', 'click', async () => { Admin.refresh(); rows = null; await page(); toast('Refreshed.'); });
    on('ia-csv', 'click', () => download(ItemStats.csv(filtered()), 'question-difficulty-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv'));
    paintTop(); paintList();
  }

  function download(text, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }

  // ------------------------------------------------------------------ headline numbers, charts, plan
  function paintTop() {
    const live = items.filter(i => !i.archived && i.status === 'reviewed'), sm = ItemStats.summarize(live, { bands: bands() }), plan = ItemStats.shiftPlan(live, prefs.target);
    const maxH = Math.max(1, ...sm.hist.map(h => h.count)), W = 520, H = 150, bw = 44;
    const tx = 20 + 5 * 0 + (prefs.target / 100) * (10 * bw);
    const hist = `<svg class="itemhist" viewBox="0 0 ${W + 20} ${H + 36}" role="img" aria-label="How many live questions fall in each first-try percent range: ${sm.hist.map(h => `${h.from} to ${h.to} percent, ${h.count}`).join('; ')}. Target ${prefs.target} percent.">
      ${sm.hist.map((h, i) => { const hh = Math.round((h.count / maxH) * (H - 20)), x = 10 + i * bw; return `<rect x="${x + 3}" y="${H - hh}" width="${bw - 6}" height="${hh}" rx="3" fill="${ItemStats.bandOf(h.from + 5, bands()) === 1 ? 'var(--good)' : ItemStats.bandOf(h.from + 5, bands()) === 2 ? 'var(--gold)' : 'var(--bad)'}"/><text x="${x + bw / 2}" y="${H - hh - 4}" text-anchor="middle" class="axis">${h.count || ''}</text><text x="${x + bw / 2}" y="${H + 14}" text-anchor="middle" class="axis">${h.from}</text>`; }).join('')}
      <line x1="${10 + (prefs.target / 100) * (10 * bw)}" x2="${10 + (prefs.target / 100) * (10 * bw)}" y1="4" y2="${H}" stroke="var(--fg)" stroke-width="2" stroke-dasharray="5 4"/><text x="${10 + (prefs.target / 100) * (10 * bw)}" y="${H + 30}" text-anchor="middle" class="axis lastv">target ${prefs.target}%</text></svg>`;
    document.getElementById('ia-top').innerHTML = `
      <div class="grid"><div class="card stat"><b>${sm.mean === null ? '-' : sm.mean + '%'}</b><span>Average correct, first try${sm.mean === null ? '' : prefs.target ? ` (target ${prefs.target}%)` : ''}</span></div><div class="card stat"><b>${sm.judged}</b><span>Live questions judged (of ${live.length})</span></div>
        <div class="card stat"><b>${sm.tooEasy} / ${sm.tooHard}</b><span>Too easy / too hard</span></div><div class="card stat"><b>${sm.check}</b><span>Check the answer key</span></div></div>
      ${sm.judged ? `<div class="card"><h2>Where the questions sit</h2><p class="muted">Live questions by first-try percent correct. Green is Easy, amber Medium, red Hard by your bands.</p>${hist}
        <div class="scroll" role="region" tabindex="0" aria-label="Difficulty by label table"><table><caption class="sr">Average first-try percent by difficulty label</caption><thead><tr><th scope="col">Label</th><th scope="col">Questions</th><th scope="col">Intended</th><th scope="col">Actual average</th><th scope="col">Inside its band</th></tr></thead>
        <tbody>${sm.byLabel.map(b => `<tr><th scope="row">${b.name}</th><td>${b.count}</td><td>${b.band[0]}% to ${b.band[1]}%</td><td>${b.avg === null ? '-' : b.avg + '%'}</td><td>${b.count ? `${b.inBand} of ${b.count}` : '-'}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><h2>Reaching your target</h2>${planHtml(plan, sm)}</div>
        <div class="card"><h2>By subject</h2><p class="muted">Average first-try percent, lowest first.</p><ul class="subjbars">${sm.bySubject.map(s => `<li><div class="sbtop"><span>${esc(s.subject)}</span><span class="muted">${s.count} questions &middot; <b>${s.avg}%</b></span></div><div class="bar sbar" aria-hidden="true"><i style="width:${s.avg}%;background:${scoreColor(s.avg)}"></i></div></li>`).join('')}</ul></div>`
        : `<div class="card"><h2>Not enough answers yet</h2><p class="muted">A question is judged once ${prefs.minN} members have answered it. Come back as more answers arrive, or lower the number above.</p></div>`}`;
    const sb = document.getElementById('ia-plan-sel'); if (sb) sb.onclick = () => { plan.ids.forEach(id => view.sel.add(id)); view.status = 'active'; view.sort = plan.direction === 'harder' ? 'easy' : 'hard'; document.getElementById('if-sort').value = view.sort; paintList(); document.getElementById('ia-list').scrollIntoView(); toast(`Selected ${plan.k} questions.`); };
  }
  function planHtml(plan, sm) {
    if (!plan) return '<p class="muted">Not enough judged questions yet.</p>';
    if (plan.direction === 'none') return `<p>The average is ${plan.from}%, right on your ${prefs.target}% target.</p>`;
    const dir = plan.direction, other = dir === 'harder' ? 'easiest' : 'hardest';
    return `<p>The average is <b>${plan.from}%</b> and your target is <b>${prefs.target}%</b>. ${plan.reached ? `Rewriting the <b>${plan.k}</b> ${other} question${plan.k === 1 ? '' : 's'} to be ${dir} (to about ${prefs.target}% correct each) would bring it to about <b>${plan.to}%</b>.` : `Even rewriting every judged question would not reach it; try a target nearer ${Math.round(plan.to)}%.`}</p>
      ${plan.k ? `<div class="row"><button type="button" id="ia-plan-sel" class="primary">Select these ${plan.k} questions</button></div><p class="muted small">Then use <b>Copy rewrite request</b> under the table to hand them to an AI, and bring the rewrites back with <b>Import from a chat</b>. Once members answer the new versions, switch Count to "Only answers since it was last rewritten" to see whether it worked.</p>` : ''}`;
  }

  // ------------------------------------------------------------------ the list
  function filtered() {
    const w = view.q.trim().toLowerCase(), lo = view.min === '' ? null : +view.min, hi = view.max === '' ? null : +view.max;
    let r = items.filter(i =>
      (view.status === 'archived' ? i.archived : !i.archived && (view.status === 'active' || i.status === view.status)) && (!view.subject || i.subject === view.subject) && (!view.label || i.label === +view.label)
      && (!view.flag || (view.flag === 'any' ? i.flags.some(f => f !== 'fewdata') : i.flags.includes(view.flag))) && (!view.data || (view.data === 'judged') === i.enough)
      && (lo === null || (i.pct !== null && i.pct >= lo)) && (hi === null || (i.pct !== null && i.pct <= hi)) && (!w || i.id.includes(w) || i.topic.toLowerCase().includes(w) || (i.q.stem || '').toLowerCase().includes(w)));
    const by = { attention: (a, b) => b.attention - a.attention, easy: (a, b) => (b.pct ?? -1) - (a.pct ?? -1), hard: (a, b) => (a.pct ?? 101) - (b.pct ?? 101), 'gap-easy': (a, b) => (b.gap ?? -99) - (a.gap ?? -99), 'gap-hard': (a, b) => (a.gap ?? 99) - (b.gap ?? 99),
      'disc-low': (a, b) => (a.disc ?? 9) - (b.disc ?? 9), 'disc-high': (a, b) => (b.disc ?? -9) - (a.disc ?? -9), many: (a, b) => b.n - a.n, few: (a, b) => a.n - b.n, rewritten: (a, b) => String(b.revisedAt || '').localeCompare(String(a.revisedAt || '')), id: () => 0 }[view.sort] || (() => 0);
    return r.sort((a, b) => by(a, b) || a.id.localeCompare(b.id));
  }

  function paintList() {
    const rs = filtered(), pages = Math.max(1, Math.ceil(rs.length / PAGE)); view.page = Math.min(view.page, pages - 1);
    const slice = rs.slice(view.page * PAGE, view.page * PAGE + PAGE), all = slice.length && slice.every(i => view.sel.has(i.id));
    const pctCell = i => i.pct === null ? `<span class="muted">-</span><br><span class="muted small">0 first tries (too few)</span>` : `<div class="pctcell"><b>${i.pct}%</b><div class="bar" aria-hidden="true"><i style="width:${i.pct}%;background:${scoreColor(i.pct)}"></i></div></div><span class="muted small">${i.n} first ${i.n === 1 ? 'try' : 'tries'}${i.enough ? '' : ' (too few)'}</span>`;
    const labelCell = i => `${L[i.label]}${i.suggested && i.suggested !== i.label ? `<div class="small"><span class="muted">acts like</span> <b>${L[i.suggested]}</b></div>` : ''}`;
    document.getElementById('ia-list').innerHTML = rs.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Questions table"><table class="qtable itemtable"><caption class="sr">Questions with their measured difficulty, ${rs.length} shown</caption><thead><tr>
      <th scope="col"><input type="checkbox" id="ia-all" aria-label="Select all shown"${all ? ' checked' : ''}></th><th scope="col">Question</th><th scope="col">Label</th><th scope="col">First try</th><th scope="col" title="How well it separates strong from weak members: 1 is perfect, 0 is none, below 0 is backwards">Separation</th><th scope="col">Wrong choice picked most</th><th scope="col">Flags</th><th scope="col"><span class="sr">Details</span></th></tr></thead><tbody>
      ${slice.map(i => { const open = view.open.has(i.id); return `<tr${i.archived ? ' class="dim"' : ''}><td><input type="checkbox" data-sel="${esc(i.id)}" aria-label="Select ${esc(i.id)}"${view.sel.has(i.id) ? ' checked' : ''}></td>
        <td><a href="#/admin/questions/edit/${esc(i.id)}">${esc(i.id)}</a>${i.status !== 'reviewed' ? ' <span class="tag draft">Draft</span>' : ''}<div class="muted small">${esc(trunc(i.q.stem, 90))}</div><div class="muted small">${esc(i.subject)}${i.topic ? ' &middot; ' + esc(i.topic) : ''}${i.revisedAt ? ` &middot; rewritten ${esc(day(i.revisedAt))}` : ''}</div></td>
        <td>${labelCell(i)}</td><td>${pctCell(i)}</td><td>${i.disc === null ? '<span class="muted">-</span>' : i.disc.toFixed(2)}</td>
        <td>${i.topWrong ? `<b>${esc(i.topWrong.id)}</b> <span class="muted">${i.topWrong.share}%</span>` : '<span class="muted">-</span>'}</td><td>${i.flags.filter(f => f !== 'fewdata').map(flagChip).join(' ') || '<span class="muted">-</span>'}</td>
        <td><button type="button" data-open="${esc(i.id)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} details for ${esc(i.id)}">${open ? 'Hide' : 'Details'}</button></td></tr>${open ? `<tr class="detailrow"><td></td><td colspan="7" id="det-${esc(i.id)}">${detail(i)}</td></tr>` : ''}`; }).join('')}</tbody></table></div>
      <div class="row spread" style="margin-top:10px"><span class="muted" aria-live="polite">${rs.length} question${rs.length === 1 ? '' : 's'}${pages > 1 ? `, page ${view.page + 1} of ${pages}` : ''}</span>${pages > 1 ? `<span class="row"><button id="ia-pv"${view.page ? '' : ' disabled'}>Previous</button><button id="ia-nx"${view.page < pages - 1 ? '' : ' disabled'}>Next</button></span>` : ''}</div>`
      : '<p class="muted">No questions match.</p>';
    const el = id => document.getElementById(id);
    if (el('ia-all')) el('ia-all').onchange = e => { slice.forEach(i => e.target.checked ? view.sel.add(i.id) : view.sel.delete(i.id)); paintList(); };
    document.querySelectorAll('[data-sel]').forEach(b => b.onchange = () => { b.checked ? view.sel.add(b.dataset.sel) : view.sel.delete(b.dataset.sel); bulkBar(); });
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const id = b.dataset.open; view.open.has(id) ? view.open.delete(id) : view.open.add(id); paintList(); const t = document.querySelector(`[data-open="${CSS.escape(id)}"]`); if (t) t.focus(); });
    if (el('ia-pv')) el('ia-pv').onclick = () => { view.page--; paintList(); el('ia-list').scrollIntoView(); };
    if (el('ia-nx')) el('ia-nx').onclick = () => { view.page++; paintList(); el('ia-list').scrollIntoView(); };
    slice.filter(i => view.open.has(i.id)).forEach(loadRevisions);
    bulkBar();
  }

  // what is behind one question's numbers: how members spread over the choices, what the flags mean, and how rewrites changed things
  function detail(i) {
    const opts = i.options.length ? `<ul class="optdist">${i.options.map(o => `<li class="${o.correct ? 'right' : ''}"><span class="k">${esc(o.id)}.</span><span class="optt">${esc(trunc(o.text, 90))}${o.correct ? ' <span class="tag reviewed">Correct</span>' : ''}${i.dead.includes(o.id) ? ' <span class="flagchip f-deadopt">Rarely picked</span>' : ''}</span><div class="bar" aria-hidden="true"><i style="width:${o.share}%;background:${o.correct ? 'var(--good)' : 'var(--gold)'}"></i></div><span class="pickn"><b>${o.share}%</b> <span class="muted small">(${o.n})</span></span></li>`).join('')}</ul>` : '<p class="muted">No choices.</p>';
    return `<div class="detail"><div><h3 class="small" style="margin:0 0 4px">Which choices members picked (first tries)</h3>${i.n ? opts : '<p class="muted">No answers yet.</p>'}</div>
      <div><h3 class="small" style="margin:0 0 4px">What the numbers say</h3><ul class="reclist small">${i.flags.length ? i.flags.map(f => `<li>${flagChip(f)} <span class="muted">${esc(ItemStats.FLAG_TEXT[f][1])}</span></li>`).join('') : '<li class="muted">Nothing stands out.</li>'}
        <li class="muted">${i.attempts} answers in all from ${i.users} members${i.lastAt ? `, last on ${esc(day(i.lastAt))}` : ''}.</li></ul>
        <h3 class="small" style="margin:10px 0 4px">Rewrite history</h3><div id="rev-${esc(i.id)}" class="small muted">Loading...</div>
        <div class="row" style="margin-top:8px"><a class="btn" href="#/admin/questions/edit/${esc(i.id)}">Edit this question</a><button type="button" data-ask="harder" data-id="${esc(i.id)}">Copy request: make harder</button><button type="button" data-ask="easier" data-id="${esc(i.id)}">Copy request: make easier</button></div></div></div>`;
  }
  async function loadRevisions(i) {
    const box = document.getElementById('rev-' + i.id); if (!box) return;
    try {
      const list = await Cloud.questionRevisions(i.id);
      const cur = i.revisedAt ? `<li>Current wording since ${esc(day(i.revisedAt))}: ${prefs.since ? (i.pct === null ? 'no first tries yet' : `<b>${i.pct}%</b> (${i.n} first tries)`) : 'switch Count to "Only answers since it was last rewritten" to see it on its own'}.</li>` : '';
      box.innerHTML = list.length ? `<ul class="reclist">${cur}${list.map(r => `<li>${esc(day(r.revised_at))} by ${esc(r.revised_by || 'unknown')}: the previous wording had ${r.first_n ? `<b>${Math.round(100 * r.first_correct / r.first_n)}%</b> correct (${r.first_n} first tries)` : 'no answers'}.</li>`).join('')}</ul>` : 'Never rewritten since tracking began.';
      box.classList.remove('muted');
    } catch { box.textContent = 'Not available yet (the database needs the latest schema).'; }
    box.parentElement.querySelectorAll('[data-ask]').forEach(b => b.onclick = () => copyRequest([i.id], b.dataset.ask));
  }

  // ------------------------------------------------------------------ actions on the selection
  function chosen() { return items.filter(i => view.sel.has(i.id)); }
  async function copyRequest(ids, dir) {
    const picked = items.filter(i => ids.includes(i.id)); if (!picked.length) return;
    const text = ItemStats.rewritePrompt(picked, dir, { target: prefs.target });
    try { await navigator.clipboard.writeText(text); toast(`Copied a request to make ${picked.length === 1 ? 'this question' : picked.length + ' questions'} ${dir}. Paste it into your chat, then use Import from a chat.`); }
    catch { download(text, 'rewrite-request.txt', 'text/plain'); toast('Could not copy, so it was downloaded as a file instead.'); }
  }
  function bulkBar() {
    const box = document.getElementById('ia-bulk'), sel = chosen();
    if (!sel.length) { box.innerHTML = ''; return; }
    const relabel = sel.filter(i => i.suggested && i.suggested !== i.label);
    box.innerHTML = `<div class="card bulkbar" role="region" aria-label="Actions for selected questions"><b>${sel.length} selected</b>
      <button data-b="harder">Copy rewrite request: harder</button><button data-b="easier">Copy rewrite request: easier</button><button data-b="relabel"${relabel.length ? '' : ' disabled'} title="Change each label to the difficulty members actually find">Set label from data${relabel.length ? ` (${relabel.length})` : ''}</button>
      <button data-b="draft">Mark draft (hide)</button><button data-b="archive">Archive</button><button data-b="ids">Copy IDs</button><button data-b="csv">CSV of selected</button><button data-b="clear" class="linkish">Clear</button></div>`;
    box.querySelectorAll('[data-b]').forEach(b => b.onclick = () => act(b.dataset.b, sel));
  }
  async function act(kind, sel) {
    const ids = sel.map(i => i.id), n = ids.length, s = n === 1 ? 'question' : 'questions';
    try {
      if (kind === 'clear') { view.sel.clear(); return paintList(); }
      if (kind === 'harder' || kind === 'easier') return copyRequest(ids, kind);
      if (kind === 'ids') { await navigator.clipboard.writeText(ids.join('\n')).catch(() => {}); return toast(`Copied ${n} ${n === 1 ? 'ID' : 'IDs'}.`); }
      if (kind === 'csv') return download(ItemStats.csv(sel), 'question-difficulty-selected.csv', 'text/csv');
      if (kind === 'relabel') {
        const rel = sel.filter(i => i.suggested && i.suggested !== i.label);
        if (!(await ask(`Change the difficulty label of ${rel.length} ${rel.length === 1 ? 'question' : 'questions'} to match how members find ${rel.length === 1 ? 'it' : 'them'}? Live questions stay live.`, 'Change labels'))) return;
        for (const lab of [1, 2, 3]) { const g = rel.filter(i => i.suggested === lab).map(i => i.id); if (g.length) await Cloud.patchQuestions(g, { difficulty: lab }); }
        toast('Labels updated.');
      } else if (kind === 'draft') {
        if (!(await ask(`Hide ${n} ${s} from members until you mark ${n === 1 ? 'it' : 'them'} reviewed again?`, 'Mark draft'))) return;
        await Cloud.patchQuestions(ids, { status: 'draft' }); toast('Marked draft.');
      } else if (kind === 'archive') {
        if (!(await ask(`Archive ${n} ${s}? ${n === 1 ? 'It disappears' : 'They disappear'} from members but everyone's history is kept, and you can restore ${n === 1 ? 'it' : 'them'} any time.`, 'Archive'))) return;
        await Cloud.patchQuestions(ids, { archived: true }); toast('Archived.');
      }
      view.sel.clear(); Admin.refresh(); rows = null; await page();
    } catch (e) { toast(e.offline ? 'No connection. Nothing was changed.' : 'That did not work: ' + e.message); }
  }
  return { page };
})();
