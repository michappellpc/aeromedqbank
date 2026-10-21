'use strict';
// Clinical skills upkeep: a second question bank, kept completely apart from the board-prep bank. Its questions live in bank.skills (never bank.questions), its answers
// go to Store.recordSkill (never Store.record) and to their own table in the database, and its quiz is its own small screen, so nothing here can reach the dashboard,
// test history, performance tables, group averages or faculty views. Loaded after app.js; uses its globals (bank, Store, esc, $app, pageTitle, shuffle, pct, imgTag...).
const Skills = (() => {
  const live = () => (bank.skills || []).filter(q => !q.archived && (!isDraft(q) || showDrafts()));
  const stat = id => Store.skillStat(id);
  const sd = () => Store.skillData();
  const subjectsOf = list => [...new Set(list.map(q => q.subject || 'Other'))].sort((a, b) => a.localeCompare(b));
  const seenOf = q => { const s = stat(q.id); return !!(s && s.seen); };
  const FILTERS = [['unused', 'Not answered yet'], ['missed', 'Missed last time'], ['all', 'Everything']];
  const keep = { unused: q => !seenOf(q), missed: q => { const s = stat(q.id); return !!(s && s.last === 'w'); }, all: () => true };
  const done = () => { bindZoom(); hydrateImages(); };

  // The menu link: shown when the bank has questions for this person (editors always, so they can find the page while it is empty)
  function syncNav() {
    const a = document.getElementById('nav-skills'); if (!a) return;
    let editor = false; try { editor = !!(typeof Admin !== 'undefined' && Admin.isEditor && Admin.isEditor()); } catch { /* not signed in yet */ }
    a.hidden = !(live().length || editor);
  }

  function page(arg) {
    if (arg === 'quiz') return run();
    if (arg === 'done') return summary();
    return home();
  }

  function home() {
    pageTitle('Clinical skills');
    const L = live(), d = sd(), act = d.active && d.active.qids && d.active.idx < d.active.qids.length ? d.active : null;
    const answered = L.reduce((n, q) => n + ((stat(q.id) || {}).seen || 0), 0), right = L.reduce((n, q) => n + ((stat(q.id) || {}).correct || 0), 0), seen = L.filter(seenOf).length;
    const subs = subjectsOf(L);
    const rows = subs.map(s => { const qs = L.filter(q => (q.subject || 'Other') === s), n = qs.filter(seenOf).length, a = qs.reduce((x, q) => x + ((stat(q.id) || {}).seen || 0), 0), c = qs.reduce((x, q) => x + ((stat(q.id) || {}).correct || 0), 0);
      return `<tr><th scope="row">${esc(s)}</th><td>${n}/${qs.length}</td><td>${a ? pct(c, a) + '%' : '<span class="muted">-</span>'}</td></tr>`; }).join('');
    const last = d.last;
    $app.innerHTML = `<div class="pagehead"><div><h2 class="pagetitle">Clinical skills</h2><p class="muted">Short practice for keeping clinical skills sharp. This is a separate bank: nothing you do here appears on your dashboard, in your test history, in your scores or in group averages.</p></div></div>
      ${!L.length ? '<div class="card"><p class="muted">No clinical skills questions are available yet.</p></div>' : `
      ${last ? `<div class="card notice" role="status">Your last skills quiz: <b>${last.correct} of ${last.total}</b> correct. <a href="#/skills/done">See the answers</a></div>` : ''}
      ${act ? `<div class="card continue"><div class="contbody"><b>Continue your skills quiz</b><span class="muted">Question ${act.idx + 1} of ${act.qids.length}</span></div><a class="btn primary" href="#/skills/quiz">Continue</a></div>` : ''}
      <div class="grid"><div class="card stat"><b>${seen}/${L.length}</b><span class="muted">Questions answered at least once</span></div><div class="card stat"><b>${answered ? pct(right, answered) + '%' : '-'}</b><span class="muted">Correct (${answered} answer${answered === 1 ? '' : 's'}, repeats counted)</span></div></div>
      <form id="skf" class="card" aria-label="Start a clinical skills quiz">
        <fieldset class="plain"><legend>Topics</legend><div class="row" style="flex-wrap:wrap">${subs.map(s => `<label class="chk"><input type="checkbox" name="sub" value="${esc(s)}" checked> ${esc(s)} <span class="cnt" data-sc="${esc(s)}"></span></label>`).join('')}</div></fieldset>
        <div class="fgrid"><div><label for="sk-f">Which questions</label><select id="sk-f">${FILTERS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
          <div><label for="sk-n">How many</label><input id="sk-n" type="number" min="1" max="200" value="10"></div></div>
        <p class="muted small" id="sk-avail" aria-live="polite"></p>
        <button class="primary" id="sk-go">Start quiz</button></form>
      <div class="card"><h2>Your progress</h2><div class="scroll" role="region" tabindex="0" aria-label="Clinical skills progress table"><table><caption class="sr">Your clinical skills progress by topic</caption><thead><tr><th scope="col">Topic</th><th scope="col">Answered</th><th scope="col">Correct</th></tr></thead><tbody>${rows}</tbody></table></div></div>`}`;
    if (!L.length) return;
    const f = document.getElementById('skf'), picked = () => [...f.querySelectorAll('[name=sub]:checked')].map(e => e.value);
    const pool = () => { const subsel = picked(), k = keep[document.getElementById('sk-f').value]; return L.filter(q => subsel.includes(q.subject || 'Other') && k(q)); };
    const upd = () => {
      const p = pool(), k = keep[document.getElementById('sk-f').value];
      f.querySelectorAll('[data-sc]').forEach(sp => { const n = L.filter(q => (q.subject || 'Other') === sp.dataset.sc && k(q)).length; sp.textContent = `(${n})`; });
      document.getElementById('sk-avail').textContent = `${p.length} question${p.length === 1 ? '' : 's'} available`; document.getElementById('sk-go').disabled = !p.length;
    };
    f.addEventListener('change', upd); upd();
    f.onsubmit = e => {
      e.preventDefault();
      const p = pool(), n = Math.min(p.length, Math.max(1, +document.getElementById('sk-n').value || 1)); if (!p.length) return;
      if (act) toast('Your unfinished skills quiz was replaced.');
      d.active = { id: uid(), qids: shuffle(p).slice(0, n).map(q => q.id), idx: 0, answers: {}, revealed: {}, started: Date.now() }; Store.save(); location.hash = '#/skills/quiz';
    };
  }

  function run() {
    const d = sd(), t = d.active;
    if (!t || !t.qids || !t.qids.length) return (location.hash = '#/skills');
    if (t.idx >= t.qids.length) return finish();
    const q = bank.byId[t.qids[t.idx]];
    if (!q) { t.idx++; Store.save(); return run(); }                         // a question that has since been removed
    pageTitle(`Skills question ${t.idx + 1} of ${t.qids.length}`);
    const id = q.id, sel = t.answers[id] || '', shown = !!t.revealed[id], last = t.idx === t.qids.length - 1;
    const notes = q.optionNotes ? q.options.filter(o => q.optionNotes[o.id]) : [], right = sel === q.answer;
    $app.innerHTML = `<p class="crumb"><a href="#/skills">Clinical skills</a></p>
      <div class="card qcard skillq"><div class="row spread"><span class="tag">${esc(q.subject || 'Clinical skills')}</span><span class="muted">Question ${t.idx + 1} of ${t.qids.length}</span></div>
        <fieldset class="plain" id="skopts"><legend class="stem">${esc(q.stem)}</legend>
          ${imgTag(q)}
          ${q.options.map(o => { let c = 'opt'; if (shown) { if (o.id === q.answer) c += ' correct'; else if (sel === o.id) c += ' wrong'; } else if (sel === o.id) c += ' sel';
            return `<label class="${c}"><input type="radio" class="sr" name="skopt" value="${esc(o.id)}"${sel === o.id ? ' checked' : ''}${shown ? ' disabled' : ''}><span class="k" aria-hidden="true">${esc(o.id)}.</span><span class="txt">${esc(o.text)}${shown && o.id === q.answer ? '<span class="sr"> (correct answer)</span>' : ''}${shown && sel === o.id && o.id !== q.answer ? '<span class="sr"> (your answer, incorrect)</span>' : ''}</span></label>`; }).join('')}
        </fieldset>
        ${shown ? `<div class="expl" role="status"><div class="verdict ${right ? 'ok' : 'no'}"><span aria-hidden="true">${right ? '✔' : '✖'}</span> <b>${right ? 'Correct' : 'Incorrect'}.</b> Correct answer: ${esc(q.answer)}.</div>
          <h2 class="exph">Explanation</h2><p class="exptext">${esc(q.explanation)}</p>
          ${notes.length ? `<h2 class="exph">Answer choices</h2><ul class="optnotes">${notes.map(o => `<li class="${o.id === q.answer ? 'right' : ''}"><b>${esc(o.id)}.</b> ${esc(q.optionNotes[o.id])}</li>`).join('')}</ul>` : ''}
          ${q.references && q.references.length ? `<h2 class="exph">References</h2><ul>${q.references.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</div>` : ''}
        <div class="row actionbar">${shown ? `<button class="primary" id="sk-next">${last ? 'Finish' : 'Next question'}</button>` : `<button class="primary" id="sk-check"${sel ? '' : ' disabled'}>Check answer</button>`}<button id="sk-stop" type="button">End quiz</button></div></div>`;
    done();
    const radios = [...$app.querySelectorAll('[name=skopt]')], chk = document.getElementById('sk-check');
    radios.forEach(r => r.addEventListener('change', () => { t.answers[id] = r.value; Store.save(); radios.forEach(x => x.closest('label').classList.toggle('sel', x.checked)); if (chk) chk.disabled = false; }));
    if (chk) chk.onclick = () => { const pick = t.answers[id]; if (!pick) return; t.revealed[id] = true; Store.recordSkill(id, pick === q.answer, pick); run(); const n = document.getElementById('sk-next'); if (n) n.focus(); };
    const nx = document.getElementById('sk-next'); if (nx) nx.onclick = () => { t.idx++; Store.save(); run(); window.scrollTo(0, 0); };
    document.getElementById('sk-stop').onclick = () => finish();
  }

  // The end of a quiz: keep a small summary (the latest quiz only) and go back to the Clinical skills page
  function finish() {
    const d = sd(), t = d.active; if (!t) return (location.hash = '#/skills');
    const items = t.qids.filter(id => t.revealed[id]).map(id => ({ id, ok: t.answers[id] === (bank.byId[id] || {}).answer }));
    d.last = items.length ? { at: Date.now(), total: items.length, correct: items.filter(x => x.ok).length, items } : d.last;
    d.active = null; Store.save(); location.hash = items.length ? '#/skills/done' : '#/skills';
  }

  function summary() {
    pageTitle('Clinical skills quiz results');
    const l = sd().last;
    if (!l) return (location.hash = '#/skills');
    $app.innerHTML = `<p class="crumb"><a href="#/skills">Clinical skills</a></p>
      <div class="card"><h2>Quiz finished</h2><p><b>${l.correct} of ${l.total}</b> correct (${pct(l.correct, l.total)}%). This is kept apart from your main scores.</p>
        <ul class="skres">${l.items.map(x => { const q = bank.byId[x.id]; return `<li><span aria-hidden="true">${x.ok ? '✔' : '✖'}</span> <span class="sr">${x.ok ? 'Correct:' : 'Incorrect:'}</span> ${esc(q ? (q.stem.length > 140 ? q.stem.slice(0, 139) + '…' : q.stem) : x.id)}</li>`; }).join('')}</ul>
        <div class="row"><a class="btn primary" href="#/skills">Back to clinical skills</a></div></div>`;
  }

  return { page, syncNav, live };
})();
