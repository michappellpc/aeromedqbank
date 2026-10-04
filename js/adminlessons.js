'use strict';
// Admin > Lessons: list, add, edit (with a live preview), import from a chat, publish, archive, delete, backup.
// Loaded after admin.js; uses its helpers plus app.js globals ($app, esc, ask, toast, pageTitle, bank, Cloud, Lessons, LValidate).
const AdminLessons = (() => {
  const { tabs, askText, note } = Admin;
  let cache = null;
  const view = { q: '', subject: '', status: '', show: 'active', sel: new Set() };
  const refresh = () => { cache = null; Admin.changed = true; };
  const slug = s => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'lesson';
  const day = t => (t ? new Date(t).toLocaleDateString() : '-');
  const ctxFor = extra => ({ boards: bank.boards, subjects: bank.subjects, knownObjective: r => !!Objectives.describe(r), ...extra });
  const subjectsFor = boards => [...new Set((boards.length ? boards : Object.keys(bank.subjects)).flatMap(b => bank.subjects[b] || []))];

  const TEMPLATES = {
    heading: { type: 'heading', text: 'Section heading' },
    text: { type: 'text', text: 'Write a paragraph here. Use **bold** for key terms.' },
    list: { type: 'list', style: 'bullets', items: ['First point', 'Second point'] },
    callout: { type: 'callout', kind: 'pearl', title: 'Clinical pearl', text: 'One thing worth remembering.' },
    table: { type: 'table', caption: 'Table title', columns: ['Item', 'Detail A', 'Detail B'], rows: [['Row 1', 'text', 'text'], ['Row 2', 'text', 'text']] },
    steps: { type: 'steps', title: 'Steps', steps: [{ title: 'First step', text: 'What to do' }, { title: 'Second step', text: 'What to do next' }] },
    compare: { type: 'compare', title: 'Compare', items: [{ title: 'Option A', tone: 'neutral', points: ['point'] }, { title: 'Option B', tone: 'neutral', points: ['point'] }] },
    stats: { type: 'stats', items: [{ value: '50%', label: 'what this number means' }] },
    'chart (bars)': { type: 'chart', kind: 'bar', title: 'Chart title', xLabel: 'Category', yLabel: 'Value', categories: ['A', 'B', 'C'], series: [{ name: 'Series', values: [3, 5, 2] }] },
    'chart (line)': { type: 'chart', kind: 'line', title: 'Chart title', xLabel: 'Category', yLabel: 'Value', categories: ['A', 'B', 'C'], series: [{ name: 'Series', values: [3, 5, 2] }] },
    image: { type: 'image', image: 'images/example.png', alt: 'Describe the picture', caption: 'Optional caption' }
  };

  async function ensure(force) {
    if (force) cache = null;
    if (!cache) {
      try {
        if (!(await Cloud.lessonsReady())) { $app.innerHTML = tabs('lessons') + '<div class="card"><h2>One more setup step</h2><p>The database needs the updated blueprint before lessons can be managed here. In Supabase, open <b>SQL Editor</b>, paste the latest <code>supabase/schema.sql</code> from GitHub, and click <b>Run</b>. It is safe to run again, and nothing is lost.</p></div>'; return null; }
        cache = { list: await Cloud.editorLessons() };
      } catch (e) { $app.innerHTML = note(`Could not load the lessons: ${esc(e.offline ? 'you are offline' : e.message)}`, 'muted'); return null; }
    }
    return cache;
  }

  // ------------------------------------------------------------------ list
  const filtered = () => {
    const w = view.q.trim().toLowerCase();
    return cache.list.filter(l => (view.show === 'all' || (view.show === 'archived') === l.archived) && (!view.subject || l.subject === view.subject) && (!view.status || l.status === view.status)
      && (!w || l.id.includes(w) || l.title.toLowerCase().includes(w)));
  };
  const tag = l => l.archived ? '<span class="tag archived">Archived</span>' : l.status === 'reviewed' ? `<span class="tag reviewed">Live</span>${l.reviewedBy ? ` <span class="muted">${esc(l.reviewedBy)}</span>` : ''}` : '<span class="tag draft">Draft (hidden)</span>';

  async function list() {
    pageTitle('Lessons');
    const c = await ensure(); if (!c) return;
    const n = { live: c.list.filter(l => l.status === 'reviewed' && !l.archived).length, draft: c.list.filter(l => l.status !== 'reviewed' && !l.archived).length, arch: c.list.filter(l => l.archived).length };
    const subjects = subjectsFor([]);
    $app.innerHTML = `${tabs('lessons')}
      <div class="card"><div class="row spread"><div><h2 style="margin:0">Lessons</h2><p class="muted" style="margin:4px 0 0">${n.live} live for members &middot; ${n.draft} draft (hidden) &middot; ${n.arch} archived</p></div>
        <div class="row"><a class="btn primary" href="#/admin/lessons/new">Add a lesson</a><a class="btn" href="#/admin/lessons/import">Import from a chat</a><button id="claude" type="button" aria-label="Copy these lessons to paste into a chat" title="Copy the lessons you are looking at, to paste into a chat">Copy</button><button id="backup">Download backup</button></div></div></div>
      <div class="card"><form id="flt" class="filters" onsubmit="return false" aria-label="Filter lessons">
        <div><label for="fq">Search</label><input id="fq" type="search" value="${esc(view.q)}" placeholder="title or id"></div>
        <div><label for="fs">Subject</label><select id="fs"><option value="">All</option>${subjects.map(s => `<option${s === view.subject ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div><label for="fst">Status</label><select id="fst"><option value="">All</option><option value="draft">Draft</option><option value="reviewed">Live</option></select></div>
        <div><label for="fsh">Show</label><select id="fsh"><option value="active">Active</option><option value="archived">Archived</option><option value="all">Both</option></select></div></form></div>
      <div id="bulk"></div><div class="card" id="lres"></div>`;
    document.getElementById('fst').value = view.status; document.getElementById('fsh').value = view.show;
    const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
    on('fq', 'input', e => { view.q = e.target.value; paint(); }); on('fs', 'change', e => { view.subject = e.target.value; paint(); });
    on('fst', 'change', e => { view.status = e.target.value; paint(); }); on('fsh', 'change', e => { view.show = e.target.value; paint(); });
    on('backup', 'click', () => backup(c.list));
    on('claude', 'click', () => Handoff.open({ kind: 'lessons', items: lastRows, selected: [...view.sel], importHash: '#/admin/lessons/import',
      describe: (() => { const p = []; if (view.q) p.push(`search "${view.q}"`); if (view.subject) p.push(view.subject); if (view.status) p.push(view.status === 'reviewed' ? 'live' : 'draft'); if (view.show !== 'active') p.push(view.show === 'all' ? 'including archived' : 'archived'); return p.length ? 'filters: ' + p.join(', ') : 'no filters'; })() }));
    paint();
  }
  let lastRows = [];
  function paint() {
    const rows = filtered(), box = document.getElementById('lres'); lastRows = rows;
    box.innerHTML = rows.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Lessons table"><table class="qtable"><caption class="sr">Lessons, ${rows.length} shown</caption><thead><tr><th scope="col"><input type="checkbox" id="selall" aria-label="Select all shown"></th><th scope="col">Lesson</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Who can see it</th><th scope="col">Updated</th></tr></thead>
      <tbody>${rows.map(l => `<tr${l.archived ? ' class="dim"' : ''}><td><input type="checkbox" data-sel="${esc(l.id)}" aria-label="Select ${esc(l.title)}"${view.sel.has(l.id) ? ' checked' : ''}></td>
        <td><a href="#/admin/lessons/edit/${esc(l.id)}">${esc(l.title)}</a><div class="muted small">${esc(l.id)}</div></td><td>${esc(l.subject)}</td><td>${tag(l)}</td><td>${l.tier === 'free' ? 'Free members too' : 'Pro members'}</td><td>${day(l.updatedAt)}<div class="muted small">${esc(l.updatedBy)}</div></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No lessons match. Add one, or import a batch from a chat.</p>';
    const all = document.getElementById('selall');
    if (all) all.onchange = e => { rows.forEach(l => e.target.checked ? view.sel.add(l.id) : view.sel.delete(l.id)); paint(); };
    box.querySelectorAll('[data-sel]').forEach(b => b.onchange = () => { b.checked ? view.sel.add(b.dataset.sel) : view.sel.delete(b.dataset.sel); bulkBar(); });
    bulkBar();
  }
  function bulkBar() {
    const ids = [...view.sel].filter(id => cache.list.some(l => l.id === id)), box = document.getElementById('bulk');
    if (!ids.length) { box.innerHTML = ''; return; }
    const chosen = cache.list.filter(l => ids.includes(l.id)), allArch = chosen.every(l => l.archived);
    box.innerHTML = `<div class="card bulkbar" role="region" aria-label="Actions for selected lessons"><b>${ids.length} selected</b>
      <button data-b="review">Publish (mark reviewed)</button><button data-b="draft">Hide (mark draft)</button>${allArch ? '<button data-b="restore">Restore</button>' : '<button data-b="archive">Archive</button>'}
      <button data-b="free">Set: free members too</button><button data-b="pro">Set: pro members only</button>${allArch ? '<button data-b="delete" class="danger">Delete permanently</button>' : ''}<button data-b="clear" class="linkish">Clear</button></div>`;
    box.querySelectorAll('[data-b]').forEach(b => b.onclick = () => bulk(b.dataset.b, ids));
  }
  async function bulk(kind, ids) {
    if (kind === 'clear') { view.sel.clear(); return paint(); }
    const n = ids.length, s = n === 1 ? 'lesson' : 'lessons';
    try {
      if (kind === 'review' && !(await ask(`Publish ${n} ${s}? ${n === 1 ? 'It becomes' : 'They become'} visible to members, and your name (${Cloud.session.email}) is recorded as the reviewer. Only do this if you have read and checked ${n === 1 ? 'it' : 'them'}.`, 'Publish'))) return;
      if (kind === 'archive' && !(await ask(`Archive ${n} ${s}? ${n === 1 ? 'It disappears' : 'They disappear'} from members. You can restore ${n === 1 ? 'it' : 'them'} later.`, 'Archive'))) return;
      if (kind === 'delete') { if (!(await askText(`Permanently delete ${n} ${s}? This cannot be undone.`, 'DELETE', 'Delete permanently'))) return; await Cloud.deleteLessons(ids); }
      else await Cloud.patchLessons(ids, { review: { status: 'reviewed' }, draft: { status: 'draft' }, archive: { archived: true }, restore: { archived: false }, free: { tier: 'free' }, pro: { tier: 'pro' } }[kind]);
      view.sel.clear(); refresh(); toast({ review: 'Published.', draft: 'Hidden from members.', archive: 'Archived.', restore: 'Restored.', free: 'Now visible to free members.', pro: 'Now for pro members only.', delete: 'Deleted.' }[kind]); list();
    } catch (e) { toast(e.offline ? 'No connection. Nothing was changed.' : 'That did not work: ' + e.message); }
  }
  function backup(all) {
    const out = all.map(l => { const o = {}; LValidate.FIELDS.forEach(k => { if (l[k] !== undefined && l[k] !== '' && !(Array.isArray(l[k]) && !l[k].length && (k === 'references' || k === 'objectives'))) o[k] = l[k]; }); if (!l.archived) delete o.archived; return o; });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' }));
    a.download = 'aeromedqbank-lessons-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); toast(`Downloaded ${out.length} lessons.`);
  }

  // ------------------------------------------------------------------ editor
  async function form(id) {
    pageTitle(id ? 'Edit lesson' : 'New lesson');
    const c = await ensure(); if (!c) return;
    const isNew = !id, orig = isNew ? null : c.list.find(l => l.id === id);
    if (!isNew && !orig) { $app.innerHTML = tabs('lessons') + note('That lesson was not found. <a href="#/admin/lessons">Back to the list</a>', 'muted'); return; }
    const l0 = isNew ? { id: '', status: 'draft', tier: 'pro', boards: ['aem'], subject: '', title: '', summary: '', order: 100, blocks: [TEMPLATES.text], references: [] } : JSON.parse(JSON.stringify(orig));
    let idTouched = !isNew;
    const boardBoxes = bank.boards.map(b => `<label class="chk"><input type="checkbox" name="board" value="${esc(b.id)}"${l0.boards.includes(b.id) ? ' checked' : ''}> ${esc(b.name)}</label>`).join('');
    $app.innerHTML = `${tabs('lessons')}
      <div class="card"><div class="row spread"><h2 style="margin:0">${isNew ? 'New lesson' : 'Edit ' + esc(l0.title)}</h2><a href="#/admin/lessons">Back to the list</a></div>
      ${!isNew ? `<p class="muted">${orig.archived ? '<b>Archived.</b> ' : ''}${orig.status === 'reviewed' ? 'Live for members' + (orig.reviewedBy ? ', reviewed by ' + esc(orig.reviewedBy) : '') : 'Draft, hidden from members'}. Last saved ${orig.updatedAt ? new Date(orig.updatedAt).toLocaleString() : ''} by ${esc(orig.updatedBy || 'unknown')}.</p>` : ''}
      <div id="errs" class="errbox" role="alert" tabindex="-1" hidden></div>
      <form id="lf" novalidate>
        <div class="fgrid">
          <div><label for="f-title">Title</label><input id="f-title" type="text" value="${esc(l0.title)}" maxlength="160" autocomplete="off"></div>
          <div><label for="f-id">Lesson id</label><input id="f-id" type="text" value="${esc(l0.id)}"${isNew ? '' : ' readonly'} autocomplete="off"><p class="hint">Lowercase letters, digits and hyphens.${isNew ? ' Suggested from the title.' : ''}</p></div>
          <div><label for="f-status">Status</label><select id="f-status"><option value="draft"${l0.status === 'draft' ? ' selected' : ''}>Draft (hidden from members)</option><option value="reviewed"${l0.status === 'reviewed' ? ' selected' : ''}>Reviewed (live for members)</option></select></div>
          <div><label for="f-tier">Who can see it</label><select id="f-tier"><option value="pro"${l0.tier === 'pro' ? ' selected' : ''}>Pro members</option><option value="free"${l0.tier === 'free' ? ' selected' : ''}>Free members too</option></select></div>
          <div><label for="f-order">Order in its subject</label><input id="f-order" type="number" min="0" value="${l0.order ?? 100}"></div>
        </div>
        <fieldset><legend>Board</legend><div class="row">${boardBoxes}</div></fieldset>
        <div class="fgrid"><div><label for="f-subject">Subject</label><select id="f-subject"></select></div><div><label for="f-summary">One-line summary (shown in the list)</label><input id="f-summary" type="text" maxlength="400" value="${esc(l0.summary || '')}" autocomplete="off"></div></div>
        <label for="f-refs">References (one per line)</label><textarea id="f-refs" rows="3">${esc((l0.references || []).join('\n'))}</textarea>
        <fieldset><legend>Board outline items (optional)</legend><p class="hint">The ABPM outline items this lesson covers. Members see them with the summary, and Program insights uses them instead of guessing. Changing them never sends a live lesson back to Draft.</p><div id="f-obj"></div></fieldset>
        <div class="row" style="margin:14px 0 6px;align-items:flex-end"><div><label for="f-add">Add a block</label><select id="f-add" style="width:auto"><option value="">Choose a block to insert...</option>${Object.keys(TEMPLATES).map(k => `<option>${esc(k)}</option>`).join('')}</select></div><button type="button" id="f-fmt">Tidy the JSON</button><div><label for="f-img">Upload a picture as a new block</label><input id="f-img" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></div></div>
        <div class="lessonedit"><div><label for="f-blocks">Content blocks (JSON)</label><textarea id="f-blocks" class="codearea" spellcheck="false">${esc(JSON.stringify(l0.blocks, null, 2))}</textarea>
          <p class="hint">Block types: heading, text, list, callout, table, steps, compare, stats, chart, image. Use the menu above to insert an example, or paste blocks written by Claude (see docs/LESSON-GUIDE.md).</p></div>
          <div><span class="lbl">Live preview</span><div id="lprev" class="lpreview lesson" aria-live="polite"></div></div></div>
        <div class="row" style="margin-top:16px"><button class="primary" type="submit" id="save">Save</button>
          ${!isNew ? (orig.archived ? '<button type="button" id="restore">Restore</button><button type="button" id="del" class="danger">Delete permanently</button>' : '<button type="button" id="archive">Archive</button>') : ''}</div>
      </form></div>`;
    const el = i => document.getElementById(i), boardsChecked = () => [...document.querySelectorAll('input[name=board]:checked')].map(e => e.value);
    const fillSubjects = keep => { el('f-subject').innerHTML = '<option value="">Choose a subject</option>' + subjectsFor(boardsChecked()).map(s => `<option${s === keep ? ' selected' : ''}>${esc(s)}</option>`).join(''); };
    fillSubjects(l0.subject);
    const objPick = ObjPicker.mount(el('f-obj'), { value: l0.objectives || [], boards: boardsChecked, subject: () => el('f-subject').value, topic: () => '', text: () => el('f-title').value + ' ' + el('f-summary').value + ' ' + (parse().blocks || []).map(b => [b.text, b.title, b.heading].filter(x => typeof x === 'string').join(' ')).join(' ') });
    const sugg = () => { if (isNew && !idTouched) el('f-id').value = slug(`${boardsChecked()[0] || 'l'}-${el('f-title').value || el('f-subject').value}`); };
    document.querySelectorAll('input[name=board]').forEach(b => b.onchange = () => { fillSubjects(el('f-subject').value); sugg(); });
    el('f-title').oninput = () => { sugg(); }; el('f-id').oninput = () => { idTouched = true; };
    if (isNew) sugg();

    const parse = () => { try { const v = JSON.parse(el('f-blocks').value); return Array.isArray(v) ? { blocks: v } : { error: 'The content must be a list of blocks, starting with [' }; } catch (e) { return { error: 'The JSON has a mistake: ' + e.message }; } };
    const read = blocks => ({ id: el('f-id').value.trim(), status: el('f-status').value, tier: el('f-tier').value, boards: boardsChecked(), subject: el('f-subject').value, title: el('f-title').value.trim(), summary: el('f-summary').value.trim(),
      order: parseInt(el('f-order').value, 10) || 0, blocks, references: el('f-refs').value.split('\n').map(x => x.trim()).filter(Boolean), ...(objPick.get().length || (l0.objectives || []).length ? { objectives: objPick.get() } : {}) });
    let timer = null;
    const preview = () => {
      const p = parse(), box = el('lprev');
      if (p.error) { box.innerHTML = `<div class="errbox">${esc(p.error)}</div>`; return; }
      box.innerHTML = p.blocks.map((b, i) => { const bad = LValidate.checkBlock(b, i); return bad.length ? `<div class="errbox"><b>Needs fixing:</b> ${bad.map(esc).join('; ')}</div>` : Lessons.render([b]); }).join('') || '<p class="muted">No blocks yet.</p>';
      Lessons.done();
    };
    el('f-blocks').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 300); }); preview();
    el('f-fmt').onclick = () => { const p = parse(); if (p.error) return toast(p.error); el('f-blocks').value = JSON.stringify(p.blocks, null, 2); preview(); };
    el('f-add').onchange = e => { const k = e.target.value; if (!k) return; const p = parse(); if (p.error) { e.target.value = ''; return toast('Fix the JSON first: ' + p.error); } p.blocks.push(JSON.parse(JSON.stringify(TEMPLATES[k]))); el('f-blocks').value = JSON.stringify(p.blocks, null, 2); e.target.value = ''; preview(); toast('Added at the end.'); };
    el('f-img').onchange = async e => {
      const f = e.target.files[0]; if (!f) return; const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[f.type];
      if (!ext) { e.target.value = ''; return toast('That file is not a PNG, JPEG, WebP or GIF picture.'); }
      if (f.size > 2 * 1024 * 1024) { e.target.value = ''; return toast('That picture is over 2 MB. Please shrink it first.'); }
      const p = parse(); if (p.error) { e.target.value = ''; return toast('Fix the JSON first: ' + p.error); }
      const name = `lesson-${slug(el('f-id').value || el('f-title').value)}-${Date.now().toString(36)}.${ext}`;
      try { await Cloud.uploadImage(name, f); p.blocks.push({ type: 'image', image: 'private:' + name, alt: 'Describe the picture for someone who cannot see it', caption: '' }); el('f-blocks').value = JSON.stringify(p.blocks, null, 2); e.target.value = ''; preview(); toast('Picture uploaded and added at the end. Edit its description.'); }
      catch (x) { toast(x.offline ? 'No connection.' : 'Upload failed: ' + x.message); }
    };
    const showErrors = (list, kind = 'errbox') => { const box = el('errs'); box.className = kind; box.hidden = !list.length; box.innerHTML = list.length ? `<b>${kind === 'errbox' ? 'Please fix these first:' : 'Saved. Worth a look:'}</b><ul>${list.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''; if (list.length) { box.focus(); box.scrollIntoView({ block: 'nearest' }); } };

    el('lf').onsubmit = async e => {
      e.preventDefault(); showErrors([]);
      const p = parse(); if (p.error) return showErrors([p.error]);
      const { clean } = LValidate.normalize(read(p.blocks));
      const res = LValidate.check(clean, ctxFor({ ids: new Set() }));
      const errors = res.filter(r => r.level === 'error').map(r => r.msg), warns = res.filter(r => r.level === 'warn').map(r => r.msg);
      if (isNew && clean.id && c.list.some(x => x.id === clean.id)) errors.unshift(`the id "${clean.id}" is already used by another lesson`);
      if (errors.length) return showErrors(errors.map(m => m.charAt(0).toUpperCase() + m.slice(1)));
      const btn = el('save'); btn.disabled = true;
      try {
        if (!isNew) { const now = await Cloud.lessonUpdatedAt(clean.id); if (now && orig.updatedAt && now !== orig.updatedAt && !(await ask('Someone else saved this lesson after you opened it. Saving now will replace their changes.', 'Replace their changes'))) { btn.disabled = false; return; } }
        await Cloud.saveLessons([clean]); refresh();
        const fresh = ((await ensure(true)) || { list: [] }).list.find(x => x.id === clean.id);
        let msg = isNew ? 'Saved as a draft.' : 'Saved.';
        if (fresh && orig && orig.status === 'reviewed' && clean.status === 'reviewed' && fresh.status === 'draft') msg = 'Saved. You changed a live lesson, so it went back to Draft and is hidden from members until it is reviewed again.';
        else if (fresh && fresh.status === 'reviewed') msg = `Saved. Live for members, reviewed by ${fresh.reviewedBy || 'you'}.`;
        toast(msg);
        if (isNew) location.hash = '#/admin/lessons/edit/' + clean.id; else form(clean.id).then(() => { if (warns.length) showErrors(warns, 'warnbox'); });
      } catch (x) { btn.disabled = false; showErrors([x.offline ? 'No connection. Nothing was saved.' : 'Could not save: ' + x.message]); }
    };
    const act = async (patch, msg, confirm) => { if (confirm && !(await ask(confirm.text, confirm.yes))) return; try { await Cloud.patchLessons([l0.id], patch); refresh(); toast(msg); location.hash = '#/admin/lessons'; } catch (x) { showErrors([x.message]); } };
    if (el('archive')) el('archive').onclick = () => act({ archived: true }, 'Archived.', { text: 'Archive this lesson? It disappears from members. You can restore it any time.', yes: 'Archive' });
    if (el('restore')) el('restore').onclick = () => act({ archived: false }, 'Restored.');
    if (el('del')) el('del').onclick = async () => { if (!(await askText('Permanently delete this lesson? This cannot be undone.', l0.id, 'Delete permanently'))) return; try { await Cloud.deleteLessons([l0.id]); refresh(); toast('Deleted.'); location.hash = '#/admin/lessons'; } catch (x) { showErrors([x.message]); } };
  }

  // ------------------------------------------------------------------ import
  async function importPage() {
    pageTitle('Import lessons');
    const c = await ensure(); if (!c) return;
    $app.innerHTML = `${tabs('lessons')}<div class="card"><div class="row spread"><h2 style="margin:0">Import lessons</h2><a href="#/admin/lessons">Back to the list</a></div>
      <p>Paste the whole reply you got from Claude, or choose the file. Lessons are checked first, and nothing is saved until you press Save. Everything is saved as a <b>draft</b>, hidden from members until you publish it.</p>
      <label for="paste">Pasted lessons</label><textarea id="paste" rows="10" spellcheck="false" class="codearea" style="min-height:220px" placeholder="Paste here"></textarea>
      <label for="pfile">Or choose a JSON file</label><input id="pfile" type="file" accept=".json,application/json,text/plain"></div><div id="res" aria-live="polite"></div>`;
    const el = id => document.getElementById(id); let timer = null; const existing = new Map(c.list.map(l => [l.id, l]));
    function analyse() {
      const text = el('paste').value, out = el('res'); if (!text.trim()) { out.innerHTML = ''; return; }
      const parsed = QValidate.parsePaste(text, 'lesson');
      if (parsed.error) { out.innerHTML = `<div class="card"><div class="errbox" role="alert"><b>${esc(parsed.error)}</b></div></div>`; return; }
      const ids = new Set();
      const items = parsed.list.map((raw, i) => {
        const { clean, dropped } = LValidate.normalize(raw); clean.status = 'draft'; delete clean.reviewedBy; delete clean.archived;
        const res = LValidate.check(clean, ctxFor({ ids }));
        return { clean, dropped, i, errors: res.filter(r => r.level === 'error').map(r => r.msg), warns: res.filter(r => r.level === 'warn').map(r => r.msg), replaces: clean.id ? existing.get(clean.id) : null };
      });
      const good = items.filter(x => !x.errors.length), bad = items.length - good.length, repl = good.filter(x => x.replaces), live = repl.filter(x => x.replaces.status === 'reviewed');
      out.innerHTML = `<div class="card"><h3 style="margin-top:0">Check results</h3><p><b>${good.length}</b> ready to save (${good.length - repl.length} new, ${repl.length} replacing existing)${bad ? `, <b>${bad}</b> need fixes and will be skipped` : ''}.</p>
        <div class="scroll" role="region" tabindex="0" aria-label="Import check results"><table><caption class="sr">Result for each lesson</caption><thead><tr><th scope="col">Lesson</th><th scope="col">Result</th><th scope="col">Details</th></tr></thead><tbody>${items.map(x => `<tr><td>${esc(x.clean.title || '(no title)')}<div class="muted small">${esc(x.clean.id || '(no id)')} &middot; ${esc(x.clean.subject || '')}</div></td>
          <td>${x.errors.length ? '<span class="tag archived">Needs fixes</span>' : x.replaces ? '<span class="tag draft">Replaces existing</span>' : '<span class="tag reviewed">New</span>'}</td>
          <td>${x.errors.map(m => `<div class="bad">Fix: ${esc(m)}</div>`).join('')}${x.warns.map(m => `<div class="muted">Note: ${esc(m)}</div>`).join('')}${x.dropped.length ? `<div class="muted">Ignored: ${esc(x.dropped.join(', '))}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="row" style="margin-top:12px"><button class="primary" id="go"${good.length ? '' : ' disabled'}>Save ${good.length} lesson${good.length === 1 ? '' : 's'}</button></div></div>`;
      el('go').onclick = async () => {
        if (live.length && !(await ask(`${live.length} live lesson${live.length === 1 ? '' : 's'} will be replaced and hidden from members until reviewed again. Continue?`, 'Replace and continue'))) return;
        el('go').disabled = true;
        try { await Cloud.saveLessons(good.map(x => x.clean)); refresh(); out.innerHTML = `<div class="card"><p><b>Saved ${good.length} lesson${good.length === 1 ? '' : 's'}</b> as drafts.${bad ? ` ${bad} were skipped because they needed fixes.` : ''}</p><a class="btn primary" href="#/admin/lessons">Go to the list</a></div>`; el('paste').value = ''; toast(`Saved ${good.length}.`); }
        catch (e) { el('go').disabled = false; toast(e.offline ? 'No connection. Nothing was saved.' : 'Could not save: ' + e.message); }
      };
    }
    el('paste').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(analyse, 350); });
    el('pfile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { el('res').innerHTML = '<div class="card"><div class="errbox" role="alert">That file is too large.</div></div>'; return; } el('paste').value = await f.text(); analyse(); });
  }

  return { route(b, c) { if (b === 'new') return form(null); if (b === 'edit' && c) return form(decodeURIComponent(c)); if (b === 'import') return importPage(); return list(); }, refresh };
})();
