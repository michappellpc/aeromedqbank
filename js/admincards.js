'use strict';
// Admin > Flashcards: list, add, edit (with a live preview), import from a chat, publish, archive, delete, backup.
// Loaded after admin.js; uses its helpers plus app.js globals ($app, esc, ask, toast, pageTitle, bank, Cloud, CardValidate, QValidate).
const AdminCards = (() => {
  const { tabs, askText, note } = Admin;
  let cache = null;
  const view = { q: '', subject: '', status: '', show: 'active', sel: new Set(), page: 0 };
  const PAGE = 50;
  const refresh = () => { cache = null; };
  const slug = s => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'card';
  const day = t => (t ? new Date(t).toLocaleDateString() : '-');
  const ctxFor = extra => ({ boards: bank.boards, subjects: bank.subjects, lessonIds: new Set((bank.lessons || []).map(l => l.id)), recordsReviewer: true, knownObjective: r => !!Objectives.describe(r), ...extra });
  const subjectsFor = boards => [...new Set((boards.length ? boards : Object.keys(bank.subjects)).flatMap(b => bank.subjects[b] || []))];
  const fronts = except => new Map(cache.list.filter(c => c.id !== except).map(c => [CardValidate.norm(c.front), c.id]));

  async function ensure(force) {
    if (!Admin.isEditor()) { $app.innerHTML = note('This page is for administrators and reviewers.', 'muted'); return null; }
    if (force) cache = null;
    if (!cache) {
      $app.innerHTML = '<div class="card"><p class="muted">Loading the flashcards...</p></div>';
      try {
        if (!(await Cloud.cardsReady())) { $app.innerHTML = tabs('cards') + '<div class="card"><h2>One more setup step</h2><p>The database needs the updated blueprint before flashcards can be managed here. In Supabase, open <b>SQL Editor</b>, paste the latest <code>supabase/schema.sql</code> from GitHub and press <b>Run</b>. Nothing is lost.</p></div>'; return null; }
        cache = { list: await Cloud.editorCards() };
      } catch (e) { $app.innerHTML = note(`Could not load the flashcards: ${esc(e.offline ? 'you are offline' : e.message)}`, 'muted'); return null; }
    }
    return cache;
  }

  // ------------------------------------------------------------------ list
  const filtered = () => {
    const w = view.q.trim().toLowerCase();
    return cache.list.filter(c => (view.show === 'all' || (view.show === 'archived') === c.archived) && (!view.subject || c.subject === view.subject) && (!view.status || c.status === view.status)
      && (!w || c.id.includes(w) || c.front.toLowerCase().includes(w) || c.back.toLowerCase().includes(w) || (c.topic || '').toLowerCase().includes(w)));
  };
  const tag = c => c.archived ? '<span class="tag archived">Archived</span>' : c.status === 'reviewed' ? `<span class="tag reviewed">Live</span>${c.reviewedBy ? ` <span class="muted">${esc(c.reviewedBy)}</span>` : ''}` : '<span class="tag draft">Draft (hidden)</span>';

  async function list() {
    pageTitle('Flashcards');
    const c = await ensure(); if (!c) return;
    const n = { live: c.list.filter(x => x.status === 'reviewed' && !x.archived).length, draft: c.list.filter(x => x.status !== 'reviewed' && !x.archived).length, arch: c.list.filter(x => x.archived).length };
    const subjects = [...new Set(c.list.map(x => x.subject))].sort();
    $app.innerHTML = `${tabs('cards')}
      <div class="card"><div class="row spread"><div><h2 style="margin:0">Flashcards</h2>
        <p class="muted" style="margin:4px 0 0">${n.live} live for everyone &middot; ${n.draft} draft (hidden) &middot; ${n.arch} archived</p></div>
        <div class="row"><a class="btn primary" href="#/admin/cards/new">Add a card</a><a class="btn" href="#/admin/cards/import">Import from a chat</a><button id="claude" type="button" aria-label="Copy these flashcards to paste into a chat" title="Copy the flashcards you are looking at, to paste into a chat">Copy</button><button id="backup">Download backup</button></div></div></div>
      <div class="card"><form id="flt" class="filters" onsubmit="return false" aria-label="Filter flashcards">
        <div><label for="fq">Search</label><input id="fq" type="search" value="${esc(view.q)}" placeholder="id, topic, or words on the card"></div>
        <div><label for="fs">Subject</label><select id="fs"><option value="">All</option>${subjects.map(s => `<option${s === view.subject ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div><label for="fst">Status</label><select id="fst"><option value="">All</option><option value="draft">Draft</option><option value="reviewed">Reviewed</option></select></div>
        <div><label for="fsh">Show</label><select id="fsh"><option value="active">Active</option><option value="archived">Archived</option><option value="all">Both</option></select></div></form></div>
      <div id="bulk"></div><div class="card" id="cres"></div>`;
    const el = id => document.getElementById(id);
    el('fst').value = view.status; el('fsh').value = view.show;
    el('fq').oninput = e => { view.q = e.target.value; view.page = 0; paint(); };
    el('fs').onchange = e => { view.subject = e.target.value; view.page = 0; paint(); };
    el('fst').onchange = e => { view.status = e.target.value; view.page = 0; paint(); };
    el('fsh').onchange = e => { view.show = e.target.value; view.page = 0; paint(); };
    el('claude').onclick = () => Handoff.open({ kind: 'cards', items: lastRows, selected: [...view.sel], importHash: '#/admin/cards/import',
      describe: (() => { const p = []; if (view.q) p.push(`search "${view.q}"`); if (view.subject) p.push(view.subject); if (view.status) p.push(view.status === 'reviewed' ? 'live' : 'draft'); if (view.show !== 'active') p.push(view.show === 'all' ? 'including archived' : 'archived'); return p.length ? 'filters: ' + p.join(', ') : 'no filters'; })() });
    el('backup').onclick = () => {
      const out = cache.list.map(x => ({ id: x.id, status: x.status, boards: x.boards, subject: x.subject, topic: x.topic || undefined, front: x.front, back: x.back, lessonId: x.lessonId, objectives: x.objectives, references: x.references, archived: x.archived }));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
      a.download = 'aeromedqbank-flashcards-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); toast(`Downloaded ${out.length} flashcards.`);
    };
    paint();
  }

  let lastRows = [];
  function paint() {
    const rows = filtered(); lastRows = rows; const pages = Math.max(1, Math.ceil(rows.length / PAGE)); view.page = Math.min(view.page, pages - 1);
    const slice = rows.slice(view.page * PAGE, view.page * PAGE + PAGE), all = slice.length && slice.every(c => view.sel.has(c.id));
    document.getElementById('cres').innerHTML = rows.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Flashcards table"><table class="qtable"><caption class="sr">Flashcards, ${rows.length} shown</caption><thead><tr>
      <th scope="col"><input type="checkbox" id="selall" aria-label="Select all shown"${all ? ' checked' : ''}></th><th scope="col">Card</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead><tbody>${slice.map(c => `<tr${c.archived ? ' class="dim"' : ''}>
        <td><input type="checkbox" data-sel="${esc(c.id)}" aria-label="Select ${esc(c.id)}"${view.sel.has(c.id) ? ' checked' : ''}></td>
        <td><a href="#/admin/cards/edit/${esc(c.id)}">${esc(c.id)}</a><div class="small">${esc(c.front.slice(0, 90))}${c.front.length > 90 ? '...' : ''}</div><div class="muted small">${esc(c.back.slice(0, 90))}${c.back.length > 90 ? '...' : ''}</div></td>
        <td>${esc(c.subject)}<div class="muted small">${esc(c.topic || '')}</div></td><td>${tag(c)}</td><td>${day(c.updatedAt)}<div class="muted small">${esc(c.updatedBy)}</div></td></tr>`).join('')}</tbody></table></div>
      <div class="row spread" style="margin-top:10px"><span class="muted" aria-live="polite">${rows.length} card${rows.length === 1 ? '' : 's'}${pages > 1 ? `, page ${view.page + 1} of ${pages}` : ''}</span>
        ${pages > 1 ? `<span class="row"><button id="pv"${view.page ? '' : ' disabled'}>Previous</button><button id="nx"${view.page < pages - 1 ? '' : ' disabled'}>Next</button></span>` : ''}</div>`
      : '<p class="muted">No flashcards match. Add one, or import a batch from a chat.</p>';
    const el = id => document.getElementById(id);
    if (el('selall')) el('selall').onchange = e => { slice.forEach(c => e.target.checked ? view.sel.add(c.id) : view.sel.delete(c.id)); paint(); };
    document.querySelectorAll('[data-sel]').forEach(b => b.onchange = () => { b.checked ? view.sel.add(b.dataset.sel) : view.sel.delete(b.dataset.sel); bulkBar(); });
    if (el('pv')) el('pv').onclick = () => { view.page--; paint(); }; if (el('nx')) el('nx').onclick = () => { view.page++; paint(); };
    bulkBar();
  }

  function bulkBar() {
    const box = document.getElementById('bulk'), ids = [...view.sel].filter(id => cache.list.some(c => c.id === id));
    if (!ids.length) { box.innerHTML = ''; return; }
    const chosen = cache.list.filter(c => ids.includes(c.id)), allArch = chosen.every(c => c.archived), n = ids.length, s = n === 1 ? 'card' : 'cards';
    box.innerHTML = `<div class="card bulkbar" role="region" aria-label="Actions for selected cards"><b>${n} selected</b>
      <button data-b="review">Mark reviewed (publish)</button><button data-b="draft">Mark draft (hide)</button>${allArch ? '<button data-b="restore">Restore</button>' : '<button data-b="archive">Archive</button>'}${allArch ? '<button data-b="delete" class="danger">Delete permanently</button>' : ''}<button data-b="clear" class="linkish">Clear</button></div>`;
    box.querySelectorAll('[data-b]').forEach(b => b.onclick = async () => {
      const kind = b.dataset.b;
      if (kind === 'clear') { view.sel.clear(); return paint(); }
      if (kind === 'review' && !(await ask(`Mark ${n} ${s} as reviewed by you (${Admin.myEmail()})? Everyone will see them, so only do it if you have read and checked ${n === 1 ? 'it' : 'them'}.`, 'Mark reviewed'))) return;
      if (kind === 'archive' && !(await ask(`Archive ${n} ${s}? ${n === 1 ? 'It disappears' : 'They disappear'} for members but everyone's schedule is kept, and you can restore ${n === 1 ? 'it' : 'them'} any time.`, 'Archive'))) return;
      if (kind === 'delete' && !(await askText(`Permanently delete ${n} ${s}? This also erases every member's schedule for ${n === 1 ? 'it' : 'them'} and cannot be undone. Download a backup first if you are unsure.`, 'DELETE', 'Delete permanently'))) return;
      try {
        if (kind === 'delete') await Cloud.deleteCards(ids);
        else await Cloud.patchCards(ids, kind === 'review' ? { status: 'reviewed' } : kind === 'draft' ? { status: 'draft' } : { archived: kind === 'archive' });
        view.sel.clear(); await ensure(true); toast('Done.'); list();
      } catch (e) { toast(e.offline ? 'No connection. Nothing was changed.' : 'That did not work: ' + e.message); }
    });
  }

  // ------------------------------------------------------------------ add / edit
  async function form(id) {
    pageTitle(id ? 'Edit flashcard' : 'New flashcard');
    const c = await ensure(); if (!c) return;
    const c0 = id ? c.list.find(x => x.id === id) : null;
    if (id && !c0) { $app.innerHTML = tabs('cards') + note('That card was not found. <a href="#/admin/cards">Back to the list</a>', ''); return; }
    const q0 = c0 || { id: '', status: 'draft', boards: ['aem'], subject: '', topic: '', front: '', back: '', references: [] };
    const lessons = (bank.lessons || []).slice().sort((a, b) => a.title.localeCompare(b.title));
    $app.innerHTML = `${tabs('cards')}<div class="card"><div class="row spread"><h2 style="margin:0">${id ? 'Edit ' + esc(id) : 'New flashcard'}</h2><a href="#/admin/cards">Back to the list</a></div>
      ${c0 && c0.status === 'reviewed' && !c0.archived ? '<p class="notice">This card is live. Changing its wording sends it back to Draft until someone marks it reviewed again.</p>' : ''}
      <form id="cf" novalidate class="fgrid" style="margin-top:12px">
        <div><label for="f-id">ID</label><input id="f-id" type="text" value="${esc(q0.id)}" ${id ? 'readonly' : ''} placeholder="e.g. aem-altitude-card-001" autocomplete="off"></div>
        <fieldset><legend>Boards</legend>${bank.boards.map(b => `<label class="chk"><input type="checkbox" name="board" value="${esc(b.id)}"${q0.boards.includes(b.id) ? ' checked' : ''}> ${esc(b.name)}</label>`).join('')}</fieldset>
        <div><label for="f-subject">Subject</label><select id="f-subject"></select></div>
        <div><label for="f-topic">Topic (optional)</label><input id="f-topic" type="text" value="${esc(q0.topic || '')}" autocomplete="off"></div>
        <div style="grid-column:1/-1"><label for="f-front">Front (the prompt, up to 600 characters)</label><textarea id="f-front" rows="3" maxlength="600">${esc(q0.front)}</textarea></div>
        <div style="grid-column:1/-1"><label for="f-back">Back (the answer, up to 1500 characters)</label><textarea id="f-back" rows="5" maxlength="1500">${esc(q0.back)}</textarea></div>
        <div><label for="f-lesson">Linked lesson (optional)</label><select id="f-lesson"><option value="">Choose automatically</option>${lessons.map(l => `<option value="${esc(l.id)}"${l.id === q0.lessonId ? ' selected' : ''}>${esc(l.title)}</option>`).join('')}</select></div>
        <div><label for="f-refs">References (one per line)</label><textarea id="f-refs" rows="2">${esc((q0.references || []).join('\n'))}</textarea></div>
        <div style="grid-column:1/-1"><fieldset><legend>Board outline items (optional)</legend><p class="hint">The ABPM outline items this card covers. Members see them with the back, and Program insights uses them instead of guessing. Changing them never sends a live card back to Draft.</p><div id="f-obj"></div></fieldset></div>
        <div><label for="f-status">Status</label><select id="f-status"><option value="draft"${q0.status !== 'reviewed' ? ' selected' : ''}>Draft (hidden)</option><option value="reviewed"${q0.status === 'reviewed' ? ' selected' : ''}>Reviewed (live)</option></select></div>
      </form>
      <div id="errs" class="errbox" role="alert" hidden></div><div id="warns" class="notice" hidden></div>
      <div class="row" style="margin-top:12px"><button class="primary" id="save">Save</button><a class="btn" href="#/admin/cards">Cancel</a></div></div>
      <div class="card" id="prev"></div>`;
    const el = i => document.getElementById(i);
    const boards = () => [...document.querySelectorAll('[name=board]:checked')].map(b => b.value);
    const fillSubjects = () => { const keep = el('f-subject').value || q0.subject; el('f-subject').innerHTML = '<option value="">Choose...</option>' + subjectsFor(boards()).map(s => `<option${s === keep ? ' selected' : ''}>${esc(s)}</option>`).join(''); };
    fillSubjects();
    const objPick = ObjPicker.mount(el('f-obj'), { value: q0.objectives || [], boards, subject: () => el('f-subject').value, topic: () => el('f-topic').value.trim(), text: () => el('f-front').value + ' ' + el('f-back').value });
    const read = () => CardValidate.normalize({ id: el('f-id').value, status: el('f-status').value, boards: boards(), subject: el('f-subject').value, topic: el('f-topic').value || undefined, front: el('f-front').value, back: el('f-back').value,
      lessonId: el('f-lesson').value || undefined, ...(objPick.get().length || (q0.objectives || []).length ? { objectives: objPick.get() } : {}), references: el('f-refs').value.split('\n').map(x => x.trim()).filter(Boolean), ...(c0 ? { archived: !!c0.archived } : {}) }).clean;
    const preview = () => { const x = read(); el('prev').innerHTML = `<h3>Preview, as a member sees it</h3><div class="card flash"><p class="flash-side">${esc(x.front || '(front)')}</p><div class="flash-back">${esc(x.back || '(back)').replace(/\n/g, '<br>')}</div></div>`; };
    preview(); el('cf').addEventListener('input', preview); el('cf').addEventListener('change', e => { if (e.target.name === 'board') fillSubjects(); preview(); });
    if (!id) el('f-subject').addEventListener('change', () => { if (!el('f-id').value) { const n = cache.list.filter(x => x.id.startsWith(slug(el('f-subject').value) + '-card-')).length + 1; el('f-id').value = `${slug(el('f-subject').value)}-card-${String(n).padStart(3, '0')}`; } });
    el('save').onclick = async () => {
      const clean = read(), res = CardValidate.check(clean, ctxFor({ ids: new Set(c.list.filter(x => x.id !== id).map(x => x.id)), fronts: fronts(id) }));
      const errors = res.filter(r => r.level === 'error').map(r => r.msg), warns = res.filter(r => r.level === 'warn').map(r => r.msg);
      if (!errors.length && clean.front) { const near = QValidate.nearDuplicate(clean.front, c.list.filter(x => x.id !== clean.id).map(x => ({ id: x.id, stem: x.front }))); if (near) warns.push(`reads like a reworded copy of ${near.id} (${Math.round(near.score * 100)}% the same wording)`); }
      el('errs').hidden = !errors.length; el('errs').innerHTML = errors.length ? `<b>Please fix:</b><ul>${errors.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : '';
      el('warns').hidden = !warns.length; el('warns').innerHTML = warns.length ? `<b>Notes:</b><ul>${warns.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : '';
      if (errors.length) return el('errs').scrollIntoView({ block: 'nearest' });
      el('save').disabled = true;
      try { await Cloud.saveCards([clean]); refresh(); toast('Saved.'); location.hash = '#/admin/cards'; }
      catch (e) { el('save').disabled = false; toast(e.offline ? 'No connection. Nothing was saved.' : 'Could not save: ' + e.message); }
    };
  }

  // ------------------------------------------------------------------ import
  async function importPage() {
    pageTitle('Import flashcards');
    const c = await ensure(); if (!c) return;
    $app.innerHTML = `${tabs('cards')}<div class="card"><div class="row spread"><h2 style="margin:0">Import flashcards</h2><a href="#/admin/cards">Back to the list</a></div>
      <p>Paste the whole reply you got from Claude, or choose the file. The cards are checked first, and nothing is saved until you press Save. Everything comes in as Draft, hidden until you mark it reviewed.</p>
      <label for="paste">Pasted cards</label><textarea id="paste" rows="10" spellcheck="false" placeholder="Paste here"></textarea>
      <label for="pfile">Or choose a JSON file</label><input id="pfile" type="file" accept=".json,application/json,text/plain"></div><div id="res" aria-live="polite"></div>`;
    const el = id => document.getElementById(id); let timer = null;
    const existing = new Map(c.list.map(x => [x.id, x]));
    function analyse() {
      const text = el('paste').value, out = el('res'); if (!text.trim()) { out.innerHTML = ''; return; }
      const parsed = QValidate.parsePaste(text, 'card');
      if (parsed.error) { out.innerHTML = `<div class="card"><div class="errbox" role="alert"><b>${esc(parsed.error)}</b></div></div>`; return; }
      if (parsed.list.length > 500) { out.innerHTML = '<div class="card"><div class="errbox" role="alert">That is more than 500 cards. Please import in smaller batches.</div></div>'; return; }
      const ids = new Set(), fr = fronts(null), earlier = [];
      const items = parsed.list.map((raw, i) => {
        const { clean, dropped } = CardValidate.normalize(raw); clean.status = 'draft'; delete clean.reviewedBy; delete clean.archived;
        const replaces = clean.id ? existing.get(clean.id) : null;
        if (replaces) fr.delete(CardValidate.norm(replaces.front));
        const res = CardValidate.check(clean, ctxFor({ ids, fronts: fr, label: clean.id || `item ${i + 1}` }));
        const warns = res.filter(r => r.level === 'warn').map(r => r.msg), errs = res.filter(r => r.level === 'error').map(r => r.msg);
        if (!errs.length && clean.front) {
          const near = QValidate.nearDuplicate(clean.front, c.list.filter(x => x.id !== clean.id).map(x => ({ id: x.id, stem: x.front }))) || QValidate.nearDuplicate(clean.front, earlier);
          if (near) warns.push(`reads like a reworded copy of ${near.id} (${Math.round(near.score * 100)}% the same wording)`);
          earlier.push({ id: clean.id || `item ${i + 1}`, stem: clean.front });
        }
        return { clean, dropped, errors: errs, warns, replaces };
      });
      const good = items.filter(x => !x.errors.length), bad = items.length - good.length, repl = good.filter(x => x.replaces), liveRepl = repl.filter(x => x.replaces.status === 'reviewed');
      out.innerHTML = `<div class="card"><h3 style="margin-top:0">Check results</h3>
        <p><b>${good.length}</b> ready to save (${good.length - repl.length} new, ${repl.length} replacing existing)${bad ? `, <b>${bad}</b> need fixes and will be skipped` : ''}. Everything is saved as Draft.</p>
        <div class="scroll" role="region" tabindex="0" aria-label="Import check results"><table><caption class="sr">Result for each card</caption><thead><tr><th scope="col">Card</th><th scope="col">Result</th><th scope="col">Details</th></tr></thead><tbody>${items.map(x => `<tr>
          <td>${esc(x.clean.id || '(no id)')}<div class="muted small">${esc((x.clean.front || '').slice(0, 80))}</div></td>
          <td>${x.errors.length ? '<span class="tag archived">Needs fixes</span>' : x.replaces ? `<span class="tag draft">Replaces existing</span>${x.replaces.status === 'reviewed' ? '<div class="muted small">It was live and will return to Draft</div>' : ''}` : '<span class="tag reviewed">New</span>'}</td>
          <td>${x.errors.map(m => `<div class="bad">Fix: ${esc(m)}</div>`).join('')}${x.warns.map(m => `<div class="muted">Note: ${esc(m)}</div>`).join('')}${x.dropped.length ? `<div class="muted">Ignored: ${esc(x.dropped.join(', '))}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="row" style="margin-top:12px"><button class="primary" id="go"${good.length ? '' : ' disabled'}>Save ${good.length} card${good.length === 1 ? '' : 's'}</button></div></div>`;
      el('go').onclick = async () => {
        if (liveRepl.length && !(await ask(`${liveRepl.length} live card${liveRepl.length === 1 ? '' : 's'} will be replaced and return to Draft, so ${liveRepl.length === 1 ? 'it needs' : 'they need'} review again. Continue?`, 'Replace and continue'))) return;
        el('go').disabled = true;
        try {
          await Cloud.saveCards(good.map(x => x.clean)); refresh();
          out.innerHTML = `<div class="card"><p><b>Saved ${good.length} card${good.length === 1 ? '' : 's'}.</b>${bad ? ` ${bad} were skipped because they needed fixes.` : ''}</p><div class="row"><a class="btn primary" href="#/admin/cards">Go to the list</a><button id="again">Import more</button></div></div>`;
          el('paste').value = ''; el('pfile').value = ''; toast(`Saved ${good.length} card${good.length === 1 ? '' : 's'}.`);
          Cloud.editorCards().then(l => { c.list = l; cache = c; existing.clear(); l.forEach(x => existing.set(x.id, x)); });
          el('again').onclick = () => { out.innerHTML = ''; el('paste').focus(); };
        } catch (e) { el('go').disabled = false; toast(e.offline ? 'No connection. Nothing was saved.' : 'Could not save: ' + e.message); }
      };
    }
    el('paste').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(analyse, 350); });
    el('pfile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { el('res').innerHTML = '<div class="card"><div class="errbox" role="alert">That file is too large.</div></div>'; return; } el('paste').value = await f.text(); analyse(); });
  }

  return { route(b, c) { if (!b) return list(); if (b === 'import') return importPage(); if (b === 'new') return form(null); if (b === 'edit' && c) return form(decodeURIComponent(c)); return list(); } };
})();
