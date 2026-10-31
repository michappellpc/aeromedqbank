'use strict';
// Reviewer changes. A reviewer's edits and new items are not saved to the bank: they are sent to an admin as a proposal.
// Reviewers see their own proposals under "My changes"; admins see everything waiting under "Changes" and can accept it as written,
// edit it first, or decline it with a reason. Only an accepted change reaches the live bank. (The database enforces this: see change_requests.)
// Loaded after admin.js; uses app.js's helpers (esc, ask, toast, pageTitle, $app) when it runs.
const Changes = (() => {
  const KIND = { question: { noun: 'question', one: 'Question', list: '#/admin/questions' }, lesson: { noun: 'lesson', one: 'Lesson', list: '#/admin/lessons' }, card: { noun: 'flashcard', one: 'Flashcard', list: '#/admin/cards' } };
  const view = { show: 'pending' };
  let staged = null;                                   // the proposal an editor form is about to open: { change, item }
  const when = t => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const isReviewer = () => typeof Admin !== 'undefined' && Admin.role() === 'reviewer';
  const isAdmin = () => typeof Admin !== 'undefined' && Admin.role() === 'admin';
  const titleOf = (kind, it) => String((kind === 'lesson' ? it.title : kind === 'card' ? it.front : it.stem) || '').replace(/\s+/g, ' ').slice(0, 90);
  const tagFor = st => st === 'pending' ? '<span class="tag draft">Waiting</span>' : st === 'accepted' ? '<span class="tag reviewed">Accepted</span>' : '<span class="tag archived">Not accepted</span>';
  const errText = e => (e.offline ? 'No connection. Nothing was changed.' : /schema cache|function|does not exist|relation/i.test(e.message || '') || e.status === 404 ? 'The database needs the latest blueprint first (see the README, "Reviewer changes").' : e.message);

  // ---- what a reviewer's Save does ----------------------------------------------------------------------------------------
  // The editor forms call these. Nothing here runs for an admin using the normal forms.
  function stage(change) { staged = { change, item: Cloud.changeItem(change.kind, change.payload) }; }
  function consume(kind) { const s = staged && staged.change.kind === kind ? staged : null; staged = null; return s; }
  // Called by an editor form when Save is pressed (after the picture, if any, was uploaded). Returns true when it took over the save.
  async function send(kind, clean, ed, opts = {}) {
    if (ed && isAdmin()) {                             // an admin finishing a proposal: accept it with their edits
      await Cloud.acceptChange(ed.change.id, kind, clean, opts.status || null, opts.note || '');
      return refreshAll(), toast('Accepted. It is in the bank now.'), (location.hash = '#/admin/changes'), true;
    }
    if (!isReviewer()) return false;
    await Cloud.submitChange(kind, clean, opts.isNew ? 'new' : 'edit', opts.note || '');
    refreshAll(); toast('Sent to an admin for approval. Nothing changes for members until it is accepted.'); location.hash = '#/admin/changes';
    return true;
  }
  function refreshAll() { try { Admin.refresh(); if (typeof AdminLessons !== 'undefined') AdminLessons.refresh(); if (typeof AdminCards !== 'undefined') AdminCards.refresh(); } catch { /* the lists reload themselves */ } if (typeof refreshInboxBadge === 'function') refreshInboxBadge(); }
  // Shapes an open editor form for a reviewer (or an admin finishing a proposal): no publishing controls, a note box, and a clear Save.
  function shapeForm(root, kind, ed) {
    const q = s => root.querySelector(s);
    const rv = isReviewer(), fin = ed && isAdmin();
    if (!rv && !fin) return;
    ['archive', 'restore', 'del'].forEach(id => { const b = q('#' + id); if (b) b.remove(); });
    const st = q('#f-status');
    if (rv && st) { st.disabled = true; const h = st.parentElement.querySelector('.hint'); if (h) h.innerHTML = 'An admin decides what goes live. A new item arrives as a draft, and an edit to a live item keeps its current status until an admin accepts it.'; }
    const tier = q('#f-tier'); if (rv && tier && tier.parentElement) tier.parentElement.hidden = true;      // free or pro is an admin's choice; the value stays as it was
    if (ed) { const id = q('#f-id'); if (id) id.readOnly = true; }
    const save = q('#save'); if (save) save.textContent = fin ? 'Accept with my changes' : 'Submit for approval';
    const row = save && save.closest('.row');
    if (row && !q('#f-note')) row.insertAdjacentHTML('beforebegin', `<label for="f-note">${fin ? 'Note back to the reviewer (optional)' : 'Note for the admin (optional)'}</label><textarea id="f-note" rows="2" maxlength="2000" placeholder="${fin ? 'Shown to the reviewer with the decision' : 'What you changed and why'}">${rv && ed ? esc(ed.change.note || '') : ''}</textarea>`);
    const top = root.querySelector('form') && root.querySelector('form').parentElement;
    if (top && !q('#chg-banner')) top.insertAdjacentHTML('afterbegin', `<div class="notice" id="chg-banner" role="note">${fin ? `<b>Finishing a reviewer's proposal${ed.change.author_email ? ' from ' + esc(ed.change.author_email) : ''}.</b> Your edits are saved into the bank when you accept it.` : '<b>Your changes go to an admin first.</b> Members keep seeing the current version until an admin accepts yours.'}</div>`);
  }
  const noteValue = root => { const n = (root || document).querySelector('#f-note'); return n ? n.value.trim() : ''; };

  // ---- reading a proposal -------------------------------------------------------------------------------------------------
  const list = a => (a || []).join(', ');
  const blockText = b => Object.entries(b || {}).filter(([k]) => k !== 'type').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  function fields(kind, it) {
    if (!it) return [];
    if (kind === 'question') {
      const opts = (it.options || []).map(o => `${o.id}. ${o.text}${(it.optionNotes || {})[o.id] ? '\n     why: ' + it.optionNotes[o.id] : ''}`).join('\n');
      return [['Question', it.stem], ['Answer choices', opts], ['Correct answer', it.answer], ['Explanation', it.explanation], ['References', (it.references || []).join('\n')], ['Subject', it.subject], ['Topic', it.topic],
        ['Boards', list(it.boards)], ['Who can see it', it.tier === 'free' ? 'Free members too' : 'Pro members'], ['Difficulty', it.difficulty ? ['', 'Easy', 'Medium', 'Hard'][it.difficulty] : ''], ['High yield', it.highYield ? 'Yes' : ''],
        ['Outline items', list(it.objectives)], ['Lesson link', it.lessonId], ['Picture', it.image ? `${it.image}${it.imageAlt ? ' (' + it.imageAlt + ')' : ''}` : ''], ['Bank', it.bank === 'skills' ? 'Clinical skills' : '']];
    }
    if (kind === 'lesson') return [['Title', it.title], ['Summary', it.summary], ['Content', (it.blocks || []).map(blockText).join('\n\n')], ['References', (it.references || []).join('\n')], ['Subject', it.subject], ['Boards', list(it.boards)],
      ['Who can see it', it.tier === 'free' ? 'Free members too' : 'Pro members'], ['High yield', it.highYield ? 'Yes' : ''], ['Outline items', list(it.objectives)], ['Order', it.order === undefined ? '' : String(it.order)], ['Bank', it.bank === 'skills' ? 'Clinical skills' : '']];
    return [['Front', it.front], ['Back', it.back], ['References', (it.references || []).join('\n')], ['Subject', it.subject], ['Topic', it.topic], ['Boards', list(it.boards)], ['High yield', it.highYield ? 'Yes' : ''], ['Outline items', list(it.objectives)], ['Lesson link', it.lessonId]];
  }
  // A word-by-word comparison: what was removed is struck through in "now", what was added is marked in "proposed". Very long texts are shown plainly.
  function wordDiff(a, b) {
    const x = a.split(/(\s+)/).filter(Boolean), y = b.split(/(\s+)/).filter(Boolean), n = x.length, m = y.length;
    if (n * m > 4e6) return null;
    const w = m + 1, dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0, l = '', r = '';
    while (i < n && j < m) {
      if (x[i] === y[j]) { l += esc(x[i]); r += esc(y[j]); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { l += /^\s+$/.test(x[i]) ? esc(x[i]) : `<del>${esc(x[i])}</del>`; i++; }
      else { r += /^\s+$/.test(y[j]) ? esc(y[j]) : `<ins>${esc(y[j])}</ins>`; j++; }
    }
    for (; i < n; i++) l += /^\s+$/.test(x[i]) ? esc(x[i]) : `<del>${esc(x[i])}</del>`;
    for (; j < m; j++) r += /^\s+$/.test(y[j]) ? esc(y[j]) : `<ins>${esc(y[j])}</ins>`;
    return [l, r];
  }
  function compare(kind, before, after) {
    const A = fields(kind, before), B = fields(kind, after), rows = [], same = [];
    B.forEach(([label, nv], k) => {
      const ov = A[k] ? A[k][1] : '', o = String(ov || ''), n = String(nv || '');
      if (!before) { if (n) rows.push(`<div class="chg"><h3>${esc(label)}</h3><div class="chgtxt">${esc(n)}</div></div>`); return; }
      if (o === n) { if (n) same.push(label); return; }
      const d = wordDiff(o, n) || [esc(o), esc(n)];
      rows.push(`<div class="chg changed"><h3>${esc(label)}</h3><div class="chgcols"><div><b class="muted small">Now</b><div class="chgtxt">${d[0] || '<span class="muted">(empty)</span>'}</div></div><div><b class="muted small">Proposed</b><div class="chgtxt">${d[1] || '<span class="muted">(empty)</span>'}</div></div></div></div>`);
    });
    return { html: rows.join(''), changed: rows.length, same };
  }

  // ---- the list --------------------------------------------------------------------------------------------------------------
  async function loadAll() { return (await Cloud.changeList()) || []; }
  async function page() {
    pageTitle(isAdmin() ? 'Changes to review' : 'My changes');
    $app.innerHTML = Admin.tabs('changes') + '<div class="card"><p class="muted">Loading...</p></div>';
    let rows;
    try { rows = await loadAll(); } catch (e) { $app.innerHTML = Admin.tabs('changes') + `<div class="card"><p class="muted">Could not load the changes: ${esc(errText(e))}</p></div>`; return; }
    const admin = isAdmin(), cnt = s => rows.filter(r => r.status === s).length;
    const shown = () => rows.filter(r => view.show === 'all' || r.status === view.show);
    $app.innerHTML = `${Admin.tabs('changes')}<div class="card"><div class="row spread"><div><h2 style="margin:0">${admin ? 'Changes to review' : 'My changes'}</h2>
        <p class="muted" style="margin:4px 0 0">${admin ? `${cnt('pending')} waiting for you` : `${cnt('pending')} waiting for an admin`} &middot; ${cnt('accepted')} accepted &middot; ${cnt('rejected')} not accepted</p></div>
        <div><label for="ch-show" class="sr">Show</label><select id="ch-show" style="width:auto"><option value="pending">Waiting</option><option value="accepted">Accepted</option><option value="rejected">Not accepted</option><option value="all">All</option></select></div></div>
      ${admin ? '' : '<p class="muted">Anything you edit or write is sent here first. Members keep seeing the current version until an admin accepts your change.</p>'}</div><div id="ch-list"></div>`;
    const sel = document.getElementById('ch-show'); sel.value = view.show;
    const paint = () => {
      const l = shown(), box = document.getElementById('ch-list');
      box.innerHTML = l.length ? `<div class="card"><div class="scroll" role="region" tabindex="0" aria-label="Changes"><table><thead><tr><th scope="col">Item</th><th scope="col">What</th>${admin ? '<th scope="col">From</th>' : ''}<th scope="col">Sent</th><th scope="col">Status</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${l.map(r => {
        const it = Cloud.changeItem(r.kind, r.payload), k = KIND[r.kind];
        return `<tr><td><a href="#/admin/changes/${r.id}">${esc(r.item_id)}</a><div class="muted small">${esc(titleOf(r.kind, it))}</div>${r.note ? `<div class="small">Note: ${esc(r.note)}</div>` : ''}</td>
          <td>${k.one}, ${r.action === 'new' ? 'new' : 'edit'}</td>${admin ? `<td>${esc(r.author_email || '')}</td>` : ''}<td>${esc(when(r.created_at))}</td>
          <td>${tagFor(r.status)}${r.status === 'rejected' && r.decision_note ? `<div class="small">${esc(r.decision_note)}</div>` : ''}${r.status === 'accepted' && r.decision_note ? `<div class="small">${esc(r.decision_note)}</div>` : ''}</td>
          <td><a href="#/admin/changes/${r.id}">${admin && r.status === 'pending' ? 'Review' : 'Open'}</a>${!admin && r.status === 'pending' ? ` <button type="button" data-w="${r.id}">Take back</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`
        : `<div class="card"><p class="muted">${view.show === 'pending' ? (admin ? 'Nothing is waiting for you.' : 'Nothing is waiting. Edit a question, lesson or flashcard, or add a new one, and it will show up here.') : 'Nothing here.'}</p></div>`;
      box.querySelectorAll('[data-w]').forEach(b => { b.onclick = async () => {
        if (!(await ask('Take back this change? Nothing is lost from the bank. The proposal is simply removed.', 'Take it back'))) return;
        try { await Cloud.withdrawChange(+b.dataset.w); rows = await loadAll(); refreshAll(); toast('Taken back.'); paint(); } catch (e) { toast(errText(e)); }
      }; });
    };
    sel.onchange = () => { view.show = sel.value; paint(); }; paint();
  }

  // ---- one proposal -----------------------------------------------------------------------------------------------------------
  async function detail(id) {
    pageTitle('Change');
    $app.innerHTML = Admin.tabs('changes') + '<div class="card"><p class="muted">Loading...</p></div>';
    let r, live = null;
    try {
      r = ((await Cloud.changeList()) || []).find(x => String(x.id) === String(id));
      if (!r) { $app.innerHTML = Admin.tabs('changes') + '<div class="card"><p class="muted">That change was not found. <a href="#/admin/changes">Back to the changes</a></p></div>'; return; }
      if (r.action === 'edit') { const all = await ({ question: Cloud.editorQuestions, lesson: Cloud.editorLessons, card: Cloud.editorCards })[r.kind].call(Cloud); live = all.find(x => x.id === r.item_id) || null; }
    } catch (e) { $app.innerHTML = Admin.tabs('changes') + `<div class="card"><p class="muted">Could not load it: ${esc(errText(e))}</p></div>`; return; }
    const admin = isAdmin(), k = KIND[r.kind], item = Cloud.changeItem(r.kind, r.payload), cmp = compare(r.kind, r.action === 'edit' ? live : null, item);
    const stale = r.status === 'pending' && r.action === 'edit' && live && r.base_updated_at && live.updatedAt && new Date(live.updatedAt).getTime() !== new Date(r.base_updated_at).getTime();
    const gone = r.action === 'edit' && !live;
    const open = r.status === 'pending';
    $app.innerHTML = `${Admin.tabs('changes')}<div class="card"><div class="row spread"><h2 style="margin:0">${r.action === 'new' ? 'New' : 'Edit to'} ${k.noun}: ${esc(r.item_id)}</h2><a href="#/admin/changes">Back to the changes</a></div>
      <p class="muted">${tagFor(r.status)} Sent ${esc(when(r.created_at))}${admin && r.author_email ? ' by ' + esc(r.author_email) : ''}.${r.decided_at ? ` ${r.status === 'accepted' ? 'Accepted' : 'Not accepted'} ${esc(when(r.decided_at))}${admin && r.decided_by ? ' by ' + esc(r.decided_by) : ''}.` : ''}</p>
      ${r.note ? `<p><b>Note from the reviewer:</b> ${esc(r.note)}</p>` : ''}${r.decision_note ? `<p><b>${admin ? 'Your reply' : 'Reply from the admin'}:</b> ${esc(r.decision_note)}</p>` : ''}
      ${stale ? `<div class="notice" role="note"><b>This ${k.noun} was saved again after the reviewer started.</b> Accepting replaces the current version with the proposed one. Check the "Now" column first.</div>` : ''}
      ${gone ? `<div class="notice" role="alert">This ${k.noun} no longer exists, so this change cannot be accepted.</div>` : ''}
      ${r.action === 'edit' ? `<p class="muted small">${cmp.changed ? `${cmp.changed} thing${cmp.changed === 1 ? '' : 's'} changed.` : 'Nothing visible changed.'}${cmp.same.length ? ` Unchanged: ${esc(cmp.same.join(', '))}.` : ''}</p>` : ''}
      <div class="chgs">${cmp.html || '<p class="muted">No changes to show.</p>'}</div></div>
      ${open && admin && !gone ? `<div class="card"><h3 style="margin-top:0">Your decision</h3>
        ${r.action === 'new' ? `<fieldset><legend>Where should it land?</legend><label class="chk"><input type="radio" name="land" value="draft" checked> Save as a draft (hidden from members, you publish it later)</label><label class="chk"><input type="radio" name="land" value="reviewed"> Publish now (live for members, with you as the reviewer)</label></fieldset>`
          : '<p class="muted small">Accepting changes the live item right away. It keeps its current status (live stays live).</p>'}
        <label for="ch-note">Note back to the reviewer (optional)</label><textarea id="ch-note" rows="2" maxlength="2000"></textarea>
        <div class="row" style="margin-top:12px"><button class="primary" id="ch-ok" type="button">Accept as written</button><a class="btn" href="#/admin/changes/${r.id}/edit">Edit first, then accept</a><button id="ch-no" type="button" class="danger">Do not accept</button></div></div>` : ''}
      ${open && !admin ? `<div class="card"><div class="row"><a class="btn" href="#/admin/changes/${r.id}/edit">Keep editing</a><button id="ch-w" type="button">Take it back</button></div></div>` : ''}`;
    const note = () => (document.getElementById('ch-note') || {}).value || '';
    if (document.getElementById('ch-ok')) document.getElementById('ch-ok').onclick = async () => {
      const land = (document.querySelector('input[name="land"]:checked') || {}).value || null;
      if (land === 'reviewed' && !(await ask(`Publish this ${k.noun}? It becomes visible to members, and your name (${Admin.myEmail()}) is recorded as the reviewer.`, 'Publish'))) return;
      if (stale && !(await ask('The current version was saved after the reviewer started. Replace it with the proposed one?', 'Replace it'))) return;
      try { await Cloud.acceptChange(r.id, r.kind, null, land, note().trim()); refreshAll(); toast('Accepted. It is in the bank now.'); location.hash = '#/admin/changes'; } catch (e) { toast(errText(e)); }
    };
    if (document.getElementById('ch-no')) document.getElementById('ch-no').onclick = async () => {
      if (!note().trim() && !(await ask('Decline without a note? The reviewer will not be told why.', 'Decline'))) return;
      try { await Cloud.rejectChange(r.id, note().trim()); refreshAll(); toast('Not accepted. The reviewer can see your note.'); location.hash = '#/admin/changes'; } catch (e) { toast(errText(e)); }
    };
    if (document.getElementById('ch-w')) document.getElementById('ch-w').onclick = async () => {
      if (!(await ask('Take back this change?', 'Take it back'))) return;
      try { await Cloud.withdrawChange(r.id); refreshAll(); toast('Taken back.'); location.hash = '#/admin/changes'; } catch (e) { toast(errText(e)); }
    };
  }

  // Opens the normal editor with the proposal filled in (admin: finish and accept it; reviewer: keep editing it)
  async function editor(id) {
    let r;
    try { r = ((await Cloud.changeList('pending')) || []).find(x => String(x.id) === String(id)); } catch (e) { toast(errText(e)); return (location.hash = '#/admin/changes'); }
    if (!r) { toast('That change is no longer waiting.'); return (location.hash = '#/admin/changes'); }
    stage(r);
    const route = { question: Admin.formPage, lesson: typeof AdminLessons !== 'undefined' && AdminLessons.formFor, card: typeof AdminCards !== 'undefined' && AdminCards.formFor }[r.kind];
    if (!route) { staged = null; toast('That editor is not available.'); return (location.hash = '#/admin/changes'); }
    return route(r.action === 'edit' ? r.item_id : null);
  }

  // the number on the menu
  async function count() { return isAdmin() || isReviewer() ? Cloud.pendingChanges() : 0; }

  return { page, detail, editor, consume, send, shapeForm, noteValue, count, isReviewer, isAdmin, refreshAll,
    route(b, c) { if (!b) return page(); if (c === 'edit') return editor(b); return detail(b); } };
})();
