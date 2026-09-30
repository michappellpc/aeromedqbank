'use strict';
// Questions page for admins and reviewers: list, filter, import, edit, review, archive, delete, pictures, backup.
// Loaded before app.js; it uses app.js's helpers (esc, ask, toast, pageTitle, bank, profile, $app) when it runs.
const Admin = (() => {
  let cache = null;                       // { list, stats: Map(id -> {attempts, pct}) }
  const view = { q: '', board: '', subject: '', status: '', show: 'active', tier: '', check: '', page: 0, sel: new Set() };
  const PAGE = 50;
  const role = () => (profile && profile.role) || '';
  const isEditor = () => role() === 'admin' || role() === 'reviewer';
  const myEmail = () => Cloud.session.email.toLowerCase();
  const day = t => (t ? new Date(t).toLocaleDateString() : '-');
  const note = (msg, cls = '') => `<div class="card"><p class="${cls}">${msg}</p></div>`;
  const subjectsFor = boards => [...new Set((boards.length ? boards : Object.keys(bank.subjects)).flatMap(b => bank.subjects[b] || []))];
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  function tabs(active) {
    const items = role() === 'admin' ? [['overview', '#/admin', 'Overview'], ['questions', '#/admin/questions', 'Questions'], ['lessons', '#/admin/lessons', 'Lessons'], ['inbox', '#/admin/inbox', 'Inbox']] : [['questions', '#/admin/questions', 'Questions'], ['lessons', '#/admin/lessons', 'Lessons'], ['inbox', '#/admin/inbox', 'Inbox']];
    return `<div class="tabs" role="navigation" aria-label="Admin sections">${items.map(([k, h, t]) => `<a href="${h}"${k === active ? ' aria-current="page" class="on"' : ''}>${t}${k === 'inbox' && Admin.unread ? ` <span class="navbadge inline">${Admin.unread}</span>` : ''}</a>`).join('')}</div>`;
  }

  function askText(msg, expected, yes) {          // a confirmation that needs a word typed, for irreversible actions
    return new Promise(res => {
      const d = document.createElement('div'); d.className = 'modal';
      d.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="Confirm"><p>${esc(msg)}</p><label for="ck">Type <b>${esc(expected)}</b> to confirm</label>
        <input id="ck" type="text" autocomplete="off"><div class="row" style="margin-top:12px"><button class="danger" data-y disabled>${esc(yes)}</button><button data-n>Cancel</button></div></div>`;
      const inp = d.querySelector('#ck'), go = d.querySelector('[data-y]'), done = v => { d.remove(); res(v); };
      inp.oninput = () => { go.disabled = inp.value !== expected; };
      go.onclick = () => done(true); d.querySelector('[data-n]').onclick = () => done(false);
      d.onkeydown = e => { if (e.key === 'Escape') done(false); };
      document.body.appendChild(d); inp.focus();
    });
  }

  // Loads (or reuses) every question plus its statistics. Returns null after showing a message if this page cannot be used.
  async function ensure(force) {
    if (!isEditor()) { $app.innerHTML = note('This page is for administrators and reviewers.', 'muted'); return null; }
    if (force || !cache) {
      $app.innerHTML = '<div class="card"><p class="muted">Loading the questions...</p></div>';
      try {
        if (!(await Cloud.editorReady())) {
          $app.innerHTML = tabs('questions') + `<div class="card"><h2>One more setup step</h2><p>The database needs the updated blueprint before questions can be managed here. In Supabase, open <b>SQL Editor</b>, paste the latest <code>supabase/schema.sql</code> from GitHub, and click <b>Run</b>. It is safe to run again, and it keeps everything already there. Then reload this page.</p></div>`;
          return null;
        }
        const [list, stats] = await Promise.all([Cloud.editorQuestions(), Cloud.rpc('admin_question_stats').catch(() => [])]);
        cache = { list, stats: new Map((stats || []).map(s => [s.question_id, { attempts: s.attempts, pct: s.pct_correct }])) };
      } catch (e) { $app.innerHTML = note(`Could not load the questions: ${esc(e.offline ? 'you are offline' : e.message)}`, 'muted'); return null; }
    }
    return cache;
  }
  const refresh = () => { cache = null; Admin.changed = true; };

  // ------------------------------------------------------------------ list
  async function list() {
    pageTitle('Questions');
    const c = await ensure(); if (!c) return;
    const n = { all: c.list.length, rev: c.list.filter(q => q.status === 'reviewed' && !q.archived).length, arch: c.list.filter(q => q.archived).length };
    const boardOpts = bank.boards.map(b => `<option value="${esc(b.id)}"${view.board === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
    $app.innerHTML = `${tabs('questions')}
      <div class="card"><div class="row spread"><div><h2 style="margin:0">Questions</h2>
        <p class="muted" style="margin:4px 0 0">${n.rev} live for members &middot; ${n.all - n.arch - n.rev} draft (hidden) &middot; ${n.arch} archived</p></div>
        <div class="row"><a class="btn primary" href="#/admin/questions/new">Add a question</a><a class="btn" href="#/admin/questions/import">Import from a chat</a><button id="backup">Download backup</button></div></div></div>
      <div class="card"><form id="flt" class="filters" onsubmit="return false" aria-label="Filter questions">
        <div><label for="fq">Search</label><input id="fq" type="search" value="${esc(view.q)}" placeholder="id, topic, or words in the question"></div>
        <div><label for="fb">Board</label><select id="fb"><option value="">All</option>${boardOpts}</select></div>
        <div><label for="fs">Subject</label><select id="fs"></select></div>
        <div><label for="fst">Status</label><select id="fst"><option value="">All</option><option value="draft">Draft</option><option value="reviewed">Reviewed</option></select></div>
        <div><label for="fsh">Show</label><select id="fsh"><option value="active">Active</option><option value="archived">Archived</option><option value="all">Both</option></select></div>
        <div><label for="ft">Tier</label><select id="ft"><option value="">All</option><option value="free">Free</option><option value="pro">Pro</option></select></div>
        <div><label for="fl">Checks</label><select id="fl"><option value="">All questions</option><option value="long">Correct answer much longer</option></select></div></form></div>
      <div id="bulk"></div><div class="card" id="qres"></div>`;
    const set = (id, v) => { document.getElementById(id).value = v; };
    const fillSubjects = () => { const s = document.getElementById('fs'); s.innerHTML = '<option value="">All</option>' + subjectsFor(view.board ? [view.board] : []).map(x => `<option${x === view.subject ? ' selected' : ''}>${esc(x)}</option>`).join(''); };
    fillSubjects(); set('fst', view.status); set('fsh', view.show); set('ft', view.tier); set('fl', view.check || '');
    const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
    on('fq', 'input', e => { view.q = e.target.value; view.page = 0; paint(); });
    on('fb', 'change', e => { view.board = e.target.value; view.subject = ''; view.page = 0; fillSubjects(); paint(); });
    on('fs', 'change', e => { view.subject = e.target.value; view.page = 0; paint(); });
    on('fst', 'change', e => { view.status = e.target.value; view.page = 0; paint(); });
    on('fsh', 'change', e => { view.show = e.target.value; view.page = 0; paint(); });
    on('ft', 'change', e => { view.tier = e.target.value; view.page = 0; paint(); });
    on('fl', 'change', e => { view.check = e.target.value; view.page = 0; paint(); });
    on('backup', 'click', () => backup(c.list));
    paint();
  }

  const filtered = () => {
    const w = view.q.trim().toLowerCase();
    return cache.list.filter(q =>
      (view.show === 'all' || (view.show === 'archived') === q.archived) && (!view.board || q.boards.includes(view.board)) && (!view.subject || q.subject === view.subject) &&
      (!view.status || q.status === view.status) && (!view.tier || q.tier === view.tier) && (view.check !== 'long' || QValidate.lengthTell(q)) &&
      (!w || q.id.includes(w) || (q.topic || '').toLowerCase().includes(w) || q.stem.toLowerCase().includes(w)));
  };

  function paint() {
    const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / PAGE)); view.page = Math.min(view.page, pages - 1);
    const slice = rows.slice(view.page * PAGE, view.page * PAGE + PAGE), all = slice.length && slice.every(q => view.sel.has(q.id));
    const tag = q => q.archived ? '<span class="tag archived">Archived</span>' : q.status === 'reviewed' ? `<span class="tag reviewed">Reviewed</span>${q.reviewedBy ? ` <span class="muted">${esc(q.reviewedBy)}</span>` : ''}` : '<span class="tag draft">Draft</span>';
    document.getElementById('qres').innerHTML = rows.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Questions table"><table class="qtable"><caption class="sr">Questions, ${rows.length} shown</caption><thead><tr>
      <th scope="col"><input type="checkbox" id="selall" aria-label="Select all shown"${all ? ' checked' : ''}></th><th scope="col">ID</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Tier</th><th scope="col">Answered</th><th scope="col">Updated</th></tr></thead><tbody>${slice.map(q => {
      const s = cache.stats.get(q.id);
      return `<tr${q.archived ? ' class="dim"' : ''}><td><input type="checkbox" data-sel="${esc(q.id)}" aria-label="Select ${esc(q.id)}"${view.sel.has(q.id) ? ' checked' : ''}></td>
        <td><a href="#/admin/questions/edit/${esc(q.id)}">${esc(q.id)}</a><div class="muted small">${esc((q.stem || '').slice(0, 70))}${q.stem && q.stem.length > 70 ? '...' : ''}</div></td>
        <td>${esc(q.subject)}<div class="muted small">${esc(q.topic || '')}</div></td><td>${tag(q)}${QValidate.lengthTell(q) ? ' <span class="tag" title="The correct answer is much longer than the other choices">Long answer</span>' : ''}</td><td>${esc(q.tier)}</td>
        <td>${s && s.attempts ? `${s.attempts} &middot; ${Math.round(s.pct)}%` : '-'}</td><td>${day(q.updatedAt)}<div class="muted small">${esc(q.updatedBy)}</div></td></tr>`;
    }).join('')}</tbody></table></div>
      <div class="row spread" style="margin-top:10px"><span class="muted" aria-live="polite">${rows.length} question${rows.length === 1 ? '' : 's'}${pages > 1 ? `, page ${view.page + 1} of ${pages}` : ''}</span>
        ${pages > 1 ? `<span class="row"><button id="pv"${view.page ? '' : ' disabled'}>Previous</button><button id="nx"${view.page < pages - 1 ? '' : ' disabled'}>Next</button></span>` : ''}</div>`
      : '<p class="muted">No questions match. Add one, or import a batch from a chat.</p>';
    const el = id => document.getElementById(id);
    if (el('selall')) el('selall').onchange = e => { slice.forEach(q => e.target.checked ? view.sel.add(q.id) : view.sel.delete(q.id)); paint(); };
    document.querySelectorAll('[data-sel]').forEach(b => b.onchange = () => { b.checked ? view.sel.add(b.dataset.sel) : view.sel.delete(b.dataset.sel); bulkBar(); });
    if (el('pv')) el('pv').onclick = () => { view.page--; paint(); document.getElementById('qres').scrollIntoView(); };
    if (el('nx')) el('nx').onclick = () => { view.page++; paint(); document.getElementById('qres').scrollIntoView(); };
    bulkBar();
  }

  function bulkBar() {
    const ids = [...view.sel].filter(id => cache.list.some(q => q.id === id)), box = document.getElementById('bulk');
    if (!ids.length) { box.innerHTML = ''; return; }
    const chosen = cache.list.filter(q => ids.includes(q.id)), allArch = chosen.every(q => q.archived), anyArch = chosen.some(q => q.archived);
    box.innerHTML = `<div class="card bulkbar" role="region" aria-label="Actions for selected questions"><b>${ids.length} selected</b>
      <button data-b="review">Mark reviewed (publish)</button><button data-b="draft">Mark draft (hide)</button>${allArch ? '<button data-b="restore">Restore</button>' : '<button data-b="archive">Archive</button>'}
      <button data-b="free">Set tier: free</button><button data-b="pro">Set tier: pro</button>${allArch ? '<button data-b="delete" class="danger">Delete permanently</button>' : ''}<button data-b="clear" class="linkish">Clear</button></div>`;
    box.querySelectorAll('[data-b]').forEach(b => b.onclick = () => bulk(b.dataset.b, ids, anyArch));
  }

  async function bulk(kind, ids) {
    if (kind === 'clear') { view.sel.clear(); return paint(); }
    const n = ids.length, s = n === 1 ? 'question' : 'questions';
    try {
      if (kind === 'review' && !(await ask(`Mark ${n} ${s} as reviewed by you (${myEmail()})? This makes ${n === 1 ? 'it' : 'them'} visible to members, so only do it if you have read and checked ${n === 1 ? 'it' : 'them'}. Your name is recorded on ${n === 1 ? 'it' : 'each'}.`, 'Mark reviewed'))) return;
      if (kind === 'archive' && !(await ask(`Archive ${n} ${s}? ${n === 1 ? 'It disappears' : 'They disappear'} from members but everyone's history is kept, and you can restore ${n === 1 ? 'it' : 'them'} any time.`, 'Archive'))) return;
      if (kind === 'delete') {
        if (!(await askText(`Permanently delete ${n} ${s}? This also erases every member's answer history for ${n === 1 ? 'it' : 'them'} and cannot be undone. Download a backup first if you are unsure.`, 'DELETE', 'Delete permanently'))) return;
        await Cloud.deleteQuestions(ids);
      } else {
        const patch = { review: { status: 'reviewed' }, draft: { status: 'draft' }, archive: { archived: true }, restore: { archived: false }, free: { tier: 'free' }, pro: { tier: 'pro' } }[kind];
        await Cloud.patchQuestions(ids, patch);
      }
      view.sel.clear(); refresh(); toast(({ review: 'Marked reviewed.', draft: 'Marked draft.', archive: 'Archived.', restore: 'Restored.', free: 'Tier set to free.', pro: 'Tier set to pro.', delete: 'Deleted.' })[kind]);
      list();
    } catch (e) { toast(e.offline ? 'No connection. Nothing was changed.' : 'That did not work: ' + e.message); }
  }

  // ------------------------------------------------------------------ backup
  function backup(listAll) {
    const out = listAll.map(q => { const o = {}; QValidate.FIELDS.forEach(k => { if (q[k] !== undefined && q[k] !== '' && !(Array.isArray(q[k]) && !q[k].length && k === 'references')) o[k] = q[k]; }); if (!q.archived) delete o.archived; return o; });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' }));
    a.download = 'ramqbank-questions-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    toast(`Downloaded ${out.length} questions. Keep this file somewhere safe.`);
  }

  return { tabs, askText, ensure, refresh, list, view, subjectsFor, LETTERS, note, myEmail, isEditor, role, get cache() { return cache; },
    route(a, b, c) {
      if (!a) return role() === 'admin' ? adminPage() : (location.hash = '#/admin/questions');
      if (a === 'lessons' && typeof AdminLessons !== 'undefined') return AdminLessons.route(b, c);
      if (a === 'inbox' && typeof Inbox !== 'undefined') return Inbox.page();
      if (a !== 'questions') return list();
      if (!b) return list();
      if (b === 'import' && Admin.importPage) return Admin.importPage();
      if (b === 'new' && Admin.formPage) return Admin.formPage(null);
      if (b === 'edit' && c && Admin.formPage) return Admin.formPage(decodeURIComponent(c));
      return list();
    } };
})();

// ---------------------------------------------------------------------- editor form
(function () {
  const { tabs, ensure, refresh, LETTERS, subjectsFor, note, askText } = Admin;
  const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  const blank = () => ({ id: '', status: 'draft', boards: ['aem'], subject: '', topic: '', difficulty: 2, tier: 'pro', stem: '', options: LETTERS.slice(0, 4).map(id => ({ id, text: '' })), answer: 'A', explanation: '', optionNotes: {}, references: [], image: null, imageAlt: '' });
  const slug = s => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0] || 'q';

  function suggestId(list, boards, subject) {
    const prefix = `${boards[0] || 'q'}-${slug(subject)}-`;
    const used = list.filter(q => q.id.startsWith(prefix)).map(q => parseInt(q.id.slice(prefix.length), 10)).filter(n => !isNaN(n));
    return prefix + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
  }

  function previewHtml(q, reveal) {
    const notes = q.optionNotes && Object.keys(q.optionNotes).length ? '\n\nAnswer choices:\n' + q.options.filter(o => q.optionNotes[o.id]).map(o => `${o.id}. ${q.optionNotes[o.id]}`).join('\n') : '';
    return `<p class="stem">${esc(q.stem || '(no question yet)')}</p>${q.image ? '<p class="muted">[picture shown here]</p>' : ''}` +
      q.options.map(o => `<div class="optrow"><div class="opt${reveal && o.id === q.answer ? ' correct' : ''}"><span class="k">${esc(o.id)}.</span><span class="txt">${esc(o.text || '(empty)')}</span></div></div>`).join('') +
      (reveal ? `<div class="expl"><b>Correct answer: ${esc(q.answer)}.</b>\n\n${esc(q.explanation)}${esc(notes)}${q.references && q.references.length ? `\n\n<span class="muted">References: ${q.references.map(esc).join('; ')}</span>` : ''}</div>` : '');
  }

  Admin.formPage = async function (id) {
    pageTitle(id ? 'Edit question' : 'New question');
    const c = await ensure(); if (!c) return;
    const isNew = !id, orig = isNew ? null : c.list.find(q => q.id === id);
    if (!isNew && !orig) { $app.innerHTML = tabs('questions') + note('That question was not found. It may have been deleted. <a href="#/admin/questions">Back to the list</a>', 'muted'); return; }
    const q0 = isNew ? blank() : JSON.parse(JSON.stringify(orig));
    let pendingFile = null, removeImage = false, idTouched = !isNew, previewOn = false, revealOn = false;

    const optRows = (opts, ans) => opts.map((o, i) => `<div class="orow" data-i="${i}">
      <input type="radio" name="ans" value="${i}" id="ans${i}" aria-label="Choice ${LETTERS[i]} is the correct answer"${i === ans ? ' checked' : ''}>
      <span class="k" aria-hidden="true">${LETTERS[i]}</span>
      <div class="ofields"><label class="sr" for="ot${i}">Choice ${LETTERS[i]} text</label><input id="ot${i}" type="text" value="${esc(o.text)}">
        <label class="sr" for="on${i}">Why choice ${LETTERS[i]} is right or wrong</label><input id="on${i}" type="text" placeholder="Why this choice is right or wrong" value="${esc(o.note || '')}"></div>
      <button type="button" data-rm="${i}" aria-label="Remove choice ${LETTERS[i]}"${opts.length <= 2 ? ' disabled' : ''}>Remove</button></div>`).join('');

    const opts0 = q0.options.map(o => ({ text: o.text, note: (q0.optionNotes || {})[o.id] || '' }));
    const ans0 = Math.max(0, q0.options.findIndex(o => o.id === q0.answer));
    const boardBoxes = bank.boards.map(b => `<label class="chk"><input type="checkbox" name="board" value="${esc(b.id)}"${q0.boards.includes(b.id) ? ' checked' : ''}> ${esc(b.name)}</label>`).join('');
    const imgShown = () => !removeImage && (pendingFile || q0.image);

    $app.innerHTML = `${tabs('questions')}
      <div class="card"><div class="row spread"><h2 style="margin:0">${isNew ? 'New question' : 'Edit ' + esc(q0.id)}</h2><a href="#/admin/questions">Back to the list</a></div>
      ${!isNew ? `<p class="muted">${orig.archived ? '<b>Archived</b> (hidden from members). ' : ''}${orig.status === 'reviewed' ? `Reviewed${orig.reviewedBy ? ' by ' + esc(orig.reviewedBy) : ''}. ` : 'Draft. '}Last saved ${orig.updatedAt ? new Date(orig.updatedAt).toLocaleString() : ''}${orig.updatedBy ? ' by ' + esc(orig.updatedBy) : ''}.</p>` : ''}
      <div id="errs" class="errbox" role="alert" tabindex="-1" hidden></div>
      <form id="qf" novalidate>
        <div class="fgrid">
          <div><label for="f-id">Question id</label><input id="f-id" type="text" value="${esc(q0.id)}"${isNew ? '' : ' readonly'} autocomplete="off"><p class="hint">Lowercase letters, digits and hyphens, like aem-altitude-014.${isNew ? ' Suggested automatically.' : ' It cannot be changed.'}</p></div>
          <div><label for="f-status">Status</label><select id="f-status"><option value="draft"${q0.status === 'draft' ? ' selected' : ''}>Draft (hidden from members)</option><option value="reviewed"${q0.status === 'reviewed' ? ' selected' : ''}>Reviewed (live for members)</option></select>
            <p class="hint"><b>Draft</b> questions are visible only to admins and reviewers. <b>Reviewed</b> questions are live for members, and choosing it records you as the reviewer. Changing the wording of a reviewed question hides it again until it is reviewed.</p></div>
          <div><label for="f-tier">Who can see it</label><select id="f-tier"><option value="pro"${q0.tier === 'pro' ? ' selected' : ''}>Pro members</option><option value="free"${q0.tier === 'free' ? ' selected' : ''}>Free members too</option></select></div>
          <div><label for="f-diff">Difficulty</label><select id="f-diff">${[1, 2, 3].map(n => `<option value="${n}"${(q0.difficulty || 2) === n ? ' selected' : ''}>${['', 'Easy', 'Medium', 'Hard'][n]}</option>`).join('')}</select></div>
        </div>
        <fieldset><legend>Board</legend><div class="row">${boardBoxes}</div></fieldset>
        <div class="fgrid"><div><label for="f-subject">Subject</label><select id="f-subject"></select></div><div><label for="f-topic">Topic (optional)</label><input id="f-topic" type="text" value="${esc(q0.topic || '')}" autocomplete="off"></div></div>
        <label for="f-stem">Question</label><textarea id="f-stem" rows="6">${esc(q0.stem)}</textarea>
        <fieldset id="optset"><legend>Answer choices</legend><p class="hint">Choose the correct one with the round button. Write a short note for every choice.</p><div id="optrows">${optRows(opts0, ans0)}</div>
          <button type="button" id="addopt"${opts0.length >= 6 ? ' disabled' : ''}>Add a choice</button></fieldset>
        <label for="f-expl">Explanation (why the answer is right, and the teaching point)</label><textarea id="f-expl" rows="5">${esc(q0.explanation)}</textarea>
        <label for="f-refs">References (one per line)</label><textarea id="f-refs" rows="3">${esc((q0.references || []).join('\n'))}</textarea>
        <fieldset><legend>Picture (optional)</legend><div id="imgprev" class="imgprev"></div>
          <label for="f-img">Add or replace the picture (PNG, JPEG, WebP or GIF, under 2 MB)</label><input id="f-img" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
          <label for="f-alt">Describe the picture for someone who cannot see it</label><input id="f-alt" type="text" value="${esc(q0.imageAlt || '')}" autocomplete="off"><div style="margin-top:8px"><button type="button" id="rmimg">Remove the picture</button></div></fieldset>
        <div class="row" style="margin-top:16px"><button class="primary" type="submit" id="save">Save</button><button type="button" id="prevbtn" aria-expanded="false" aria-controls="prev">Preview</button>
          ${!isNew ? (orig.archived ? '<button type="button" id="restore">Restore</button>' : '<button type="button" id="archive">Archive</button>') : ''}
          ${!isNew && orig.archived ? '<button type="button" id="del" class="danger">Delete permanently</button>' : ''}</div>
      </form><div id="prev" class="card" hidden></div></div>`;

    const $ = s => document.querySelector(s), el = id => document.getElementById(id);
    const fillSubjects = keep => {
      const boards = [...document.querySelectorAll('input[name=board]:checked')].map(e => e.value), subs = subjectsFor(boards);
      el('f-subject').innerHTML = '<option value="">Choose a subject</option>' + subs.map(s => `<option${s === keep ? ' selected' : ''}>${esc(s)}</option>`).join('');
    };
    fillSubjects(q0.subject);
    const readOpts = () => [...document.querySelectorAll('.orow')].map(r => { const t = r.querySelectorAll('input[type=text]'); return { text: t[0].value, note: t[1].value }; });
    const readAns = () => +((document.querySelector('input[name=ans]:checked') || { value: 0 }).value);
    const paintOpts = (opts, ans) => { el('optrows').innerHTML = optRows(opts, ans); el('addopt').disabled = opts.length >= 6; bindOpts(); };
    const bindOpts = () => {
      document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const o = readOpts(), a = readAns(), i = +b.dataset.rm; o.splice(i, 1); paintOpts(o, a === i ? 0 : a > i ? a - 1 : a); });
    };
    bindOpts();
    el('addopt').onclick = () => { const o = readOpts(); if (o.length < 6) { o.push({ text: '', note: '' }); paintOpts(o, readAns()); document.getElementById('ot' + (o.length - 1)).focus(); } };
    const sugg = () => { if (isNew && !idTouched) el('f-id').value = suggestId(c.list, [...document.querySelectorAll('input[name=board]:checked')].map(e => e.value), el('f-subject').value); };
    document.querySelectorAll('input[name=board]').forEach(b => b.onchange = () => { fillSubjects(el('f-subject').value); sugg(); });
    el('f-subject').onchange = sugg; el('f-id').oninput = () => { idTouched = true; };
    if (isNew) sugg();

    const paintImg = async () => {
      const box = el('imgprev'); el('rmimg').hidden = !imgShown();
      if (!imgShown()) { box.innerHTML = '<p class="muted">No picture.</p>'; return; }
      box.innerHTML = '<p class="muted">Loading the picture...</p>';
      try {
        const url = pendingFile ? URL.createObjectURL(pendingFile) : String(q0.image).startsWith('private:') ? await Cloud.image(q0.image.slice(8)) : q0.image;
        box.innerHTML = `<img class="qimg" alt="${esc(el('f-alt').value || 'Picture for this question')}">`; box.querySelector('img').src = url;
      } catch { box.innerHTML = '<p class="muted">The current picture could not be loaded.</p>'; }
    };
    paintImg();
    el('f-img').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (!IMG_TYPES[f.type]) { e.target.value = ''; return showErrors(['That file is not a PNG, JPEG, WebP or GIF picture.']); }
      if (f.size > 2 * 1024 * 1024) { e.target.value = ''; return showErrors(['That picture is over 2 MB. Please shrink it first.']); }
      pendingFile = f; removeImage = false; paintImg();
    };
    el('rmimg').onclick = () => { pendingFile = null; removeImage = true; el('f-img').value = ''; el('f-alt').value = ''; paintImg(); };

    function read() {
      const o = readOpts(), a = readAns(), boards = [...document.querySelectorAll('input[name=board]:checked')].map(e => e.value);
      const notes = {}; o.forEach((x, i) => { if (x.note.trim()) notes[LETTERS[i]] = x.note.trim(); });
      const keepImg = !removeImage && (pendingFile || q0.image);
      return { id: el('f-id').value.trim(), status: el('f-status').value, boards, subject: el('f-subject').value, topic: el('f-topic').value.trim(), difficulty: +el('f-diff').value, tier: el('f-tier').value,
        stem: el('f-stem').value, options: o.map((x, i) => ({ id: LETTERS[i], text: x.text })), answer: LETTERS[a], explanation: el('f-expl').value, optionNotes: Object.keys(notes).length ? notes : undefined,
        references: el('f-refs').value.split('\n'), image: keepImg ? (pendingFile ? 'private:pending.png' : q0.image) : null, imageAlt: keepImg ? el('f-alt').value.trim() : '' };
    }
    function showErrors(list, kind = 'errbox') {
      const box = el('errs'); box.className = kind; box.hidden = !list.length;
      box.innerHTML = list.length ? `<b>${kind === 'errbox' ? 'Please fix these first:' : 'Saved. Worth a look:'}</b><ul>${list.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : '';
      if (list.length) { box.focus(); box.scrollIntoView({ block: 'nearest' }); }
    }

    el('prevbtn').onclick = () => {
      previewOn = !previewOn; el('prevbtn').setAttribute('aria-expanded', String(previewOn)); el('prev').hidden = !previewOn; if (!previewOn) return;
      revealOn = false; const draw = () => { const q = read(); el('prev').innerHTML = `<h3>Preview, as a member sees it</h3>${previewHtml(q, revealOn)}<div class="row" style="margin-top:10px"><button type="button" id="rev">${revealOn ? 'Hide the answer' : 'Show the answer and explanation'}</button></div>`; el('rev').onclick = () => { revealOn = !revealOn; draw(); }; }; draw();
    };

    el('qf').onsubmit = async e => {
      e.preventDefault(); showErrors([]);
      const raw = read(), { clean } = QValidate.normalize(raw), stems = new Map(c.list.filter(x => x.id !== clean.id).map(x => [QValidate.norm(x.stem), x.id]));
      const res = QValidate.check(clean, { boards: bank.boards, subjects: bank.subjects, ids: new Set(), stems, label: clean.id, recordsReviewer: true });
      const errors = res.filter(r => r.level === 'error').map(r => r.msg), warns = res.filter(r => r.level === 'warn').map(r => r.msg);
      if (isNew && clean.id && c.list.some(x => x.id === clean.id)) errors.unshift(`the id "${clean.id}" is already used by another question`);
      if (errors.length) return showErrors(errors.map(m => m.charAt(0).toUpperCase() + m.slice(1)));
      const btn = el('save'); btn.disabled = true;
      try {
        if (!isNew) {   // someone else may have saved while this page was open
          const now = await Cloud.questionUpdatedAt(clean.id);
          if (now && orig.updatedAt && now !== orig.updatedAt && !(await ask('Someone else saved this question after you opened it. Saving now will replace their changes.', 'Replace their changes'))) { btn.disabled = false; return; }
        }
        if (pendingFile) { const name = `${clean.id}-${Date.now().toString(36)}.${IMG_TYPES[pendingFile.type]}`; await Cloud.uploadImage(name, pendingFile); clean.image = 'private:' + name; }
        await Cloud.saveQuestions([clean]); refresh();
        const fresh = ((await ensure(true)) || { list: [] }).list.find(x => x.id === clean.id);
        let msg = isNew ? 'Saved as a draft.' : 'Saved.';
        if (fresh && orig && orig.status === 'reviewed' && clean.status === 'reviewed' && fresh.status === 'draft') msg = 'Saved. You changed a reviewed question, so it went back to Draft and is hidden from members until it is reviewed again.';
        else if (fresh && fresh.status === 'reviewed') msg = `Saved. Marked reviewed by ${fresh.reviewedBy || 'you'}.`;
        toast(msg);
        if (isNew) location.hash = '#/admin/questions/edit/' + clean.id; else Admin.formPage(clean.id).then(() => { if (warns.length) showErrors(warns, 'warnbox'); });
      } catch (x) { btn.disabled = false; showErrors([x.offline ? 'No connection. Nothing was saved.' : 'Could not save: ' + x.message]); }
    };

    const act = async (patch, msg, confirm) => { if (confirm && !(await ask(confirm.text, confirm.yes))) return; try { await Cloud.patchQuestions([q0.id], patch); refresh(); toast(msg); location.hash = '#/admin/questions'; } catch (x) { showErrors([x.message]); } };
    if (el('archive')) el('archive').onclick = () => act({ archived: true }, 'Archived. You can restore it from the Archived list.', { text: 'Archive this question? It disappears from members, and everyone\'s history is kept. You can restore it any time.', yes: 'Archive' });
    if (el('restore')) el('restore').onclick = () => act({ archived: false }, 'Restored.');
    if (el('del')) el('del').onclick = async () => {
      if (!(await askText('Permanently delete this question? This also erases every member\'s answer history for it and cannot be undone. Download a backup first if you are unsure.', q0.id, 'Delete permanently'))) return;
      try { await Cloud.deleteQuestions([q0.id]); refresh(); toast('Deleted.'); location.hash = '#/admin/questions'; } catch (x) { showErrors([x.message]); }
    };
  };
})();

// ---------------------------------------------------------------------- import from a chat reply
(function () {
  const { tabs, ensure, refresh, note } = Admin;
  Admin.importPage = async function () {
    pageTitle('Import questions');
    const c = await ensure(); if (!c) return;
    $app.innerHTML = `${tabs('questions')}<div class="card"><div class="row spread"><h2 style="margin:0">Import questions</h2><a href="#/admin/questions">Back to the list</a></div>
      <p>Paste the whole reply you got from Claude, or choose the file. The questions are checked first, and nothing is saved until you press Save.</p>
      <label for="paste">Pasted questions</label><textarea id="paste" rows="10" spellcheck="false" placeholder="Paste here"></textarea>
      <label for="pfile">Or choose a JSON file</label><input id="pfile" type="file" accept=".json,application/json,text/plain">
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="keep"> Keep review status and archived flags from the file (only for restoring a backup)</label></div>
      <div id="res" aria-live="polite"></div>`;
    const el = id => document.getElementById(id);
    let timer = null;
    const existing = new Map(c.list.map(q => [q.id, q]));

    function analyse() {
      const text = el('paste').value, out = el('res');
      if (!text.trim()) { out.innerHTML = ''; return; }
      const parsed = QValidate.parsePaste(text);
      if (parsed.error) { out.innerHTML = `<div class="card"><div class="errbox" role="alert"><b>${esc(parsed.error)}</b></div></div>`; return; }
      if (parsed.list.length > 500) { out.innerHTML = '<div class="card"><div class="errbox" role="alert">That is more than 500 questions. Please import in smaller batches.</div></div>'; return; }
      const keep = el('keep').checked, ids = new Set(), stems = new Map(c.list.map(q => [QValidate.norm(q.stem), q.id]));
      const items = parsed.list.map((raw, i) => {
        const { clean, dropped } = QValidate.normalize(raw);
        if (!keep) { clean.status = 'draft'; delete clean.reviewedBy; delete clean.archived; } else if (!clean.status) clean.status = 'draft';
        delete clean.reviewedBy;                                  // the database records reviewers itself
        const res = QValidate.check(clean, { boards: bank.boards, subjects: bank.subjects, ids, stems, label: clean.id || `item ${i + 1}`, recordsReviewer: true,
          imageFiles: img => (String(img).startsWith('private:') ? [{ level: 'warn', msg: 'has a picture; attach it on the question\'s edit page after saving' }] : []) });
        return { i, clean, dropped, errors: res.filter(r => r.level === 'error').map(r => r.msg), warns: res.filter(r => r.level === 'warn').map(r => r.msg), replaces: clean.id ? existing.get(clean.id) : null };
      });
      const good = items.filter(x => !x.errors.length), bad = items.length - good.length, repl = good.filter(x => x.replaces), reviewedRepl = repl.filter(x => x.replaces.status === 'reviewed' && !keep);
      const mix = QValidate.difficultyMix(good.map(x => x.clean));
      const letters = {}; good.forEach(x => { letters[x.clean.answer] = (letters[x.clean.answer] || 0) + 1; });
      const top = Object.entries(letters).sort((a, b) => b[1] - a[1])[0], skew = good.length >= 8 && top && top[1] / good.length > 0.6;
      out.innerHTML = `<div class="card"><h3 style="margin-top:0">Check results</h3>
        <p><b>${good.length}</b> ready to save (${good.length - repl.length} new, ${repl.length} replacing existing)${bad ? `, <b>${bad}</b> need fixes and will be skipped` : ''}.${keep ? '' : ' Everything is saved as Draft, hidden from members until a reviewer marks it Reviewed.'}</p>
        ${good.length ? `<p class="muted">Difficulty: ${mix[1]} easy, ${mix[2]} medium, ${mix[3]} hard.</p>` : ''}
        ${mix.lowHard ? `<p class="notice">Only ${mix[3]} of ${good.length} are hard (level 3). Board exams lean harder than this, so ask Claude for more hard questions: more steps of reasoning, closer answer choices and less obvious vignettes.</p>` : ''}
        ${skew ? `<p class="notice">The correct answer is ${esc(top[0])} for ${top[1]} of ${good.length} questions. Ask Claude to vary the answer key.</p>` : ''}
        <div class="scroll" role="region" tabindex="0" aria-label="Import check results"><table><caption class="sr">Result for each question</caption><thead><tr><th scope="col">Question</th><th scope="col">Result</th><th scope="col">Details</th></tr></thead><tbody>${items.map(x => `<tr>
          <td>${esc(x.clean.id || '(no id)')}<div class="muted small">${esc(x.clean.subject || '')}${x.clean.topic ? ' &middot; ' + esc(x.clean.topic) : ''}</div></td>
          <td>${x.errors.length ? '<span class="tag archived">Needs fixes</span>' : x.replaces ? `<span class="tag draft">Replaces existing</span>${x.replaces.status === 'reviewed' && !keep ? '<div class="muted small">It was reviewed and will return to Draft</div>' : ''}` : '<span class="tag reviewed">New</span>'}</td>
          <td>${x.errors.map(m => `<div class="bad">Fix: ${esc(m)}</div>`).join('')}${x.warns.map(m => `<div class="muted">Note: ${esc(m)}</div>`).join('')}${x.dropped.length ? `<div class="muted">Ignored: ${esc(x.dropped.join(', '))}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="row" style="margin-top:12px"><button class="primary" id="go"${good.length ? '' : ' disabled'}>Save ${good.length} question${good.length === 1 ? '' : 's'}</button></div></div>`;
      el('go').onclick = async () => {
        if (reviewedRepl.length && !(await ask(`${reviewedRepl.length} reviewed question${reviewedRepl.length === 1 ? '' : 's'} will be replaced and return to Draft, so they need review again. Continue?`, 'Replace and continue'))) return;
        el('go').disabled = true;
        try {
          await Cloud.saveQuestions(good.map(x => x.clean)); refresh();
          out.innerHTML = `<div class="card"><p><b>Saved ${good.length} question${good.length === 1 ? '' : 's'}.</b>${bad ? ` ${bad} were skipped because they needed fixes.` : ''}</p><div class="row"><a class="btn primary" href="#/admin/questions">Go to the list</a><button id="again">Import more</button></div></div>`;
          el('paste').value = ''; el('pfile').value = ''; el('again').onclick = () => { out.innerHTML = ''; el('paste').focus(); }; toast(`Saved ${good.length} question${good.length === 1 ? '' : 's'}.`);
        } catch (e) { el('go').disabled = false; toast(e.offline ? 'No connection. Nothing was saved.' : 'Could not save: ' + e.message); }
      };
    }
    el('paste').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(analyse, 350); });
    el('keep').addEventListener('change', analyse);
    el('pfile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { el('res').innerHTML = '<div class="card"><div class="errbox" role="alert">That file is too large.</div></div>'; return; } el('paste').value = await f.text(); analyse(); });
  };
})();
