'use strict';
// Board outline picker for the admin forms: shows the ABPM items already chosen for a question, lesson or flashcard as removable chips, lets the editor
// search the outline by code or words, and can suggest items from the item's subject, topic and wording. Uses Objectives (objectives.js) for the data.
// ObjPicker.mount(host, { value, boards: () => ['aem'], subject: () => '', topic: () => '', text: () => '' }) -> { get() }
const ObjPicker = (function () {
  let seq = 0;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  function mount(host, opts) {
    const id = 'op' + (++seq), list = [...(opts.value || [])];
    host.classList.add('objpick');
    host.innerHTML = `<div id="${id}-chips" class="objchips" aria-live="polite"></div>
      <div class="objfind"><label class="sr" for="${id}-q">Search the board outline</label><input id="${id}-q" type="search" placeholder="Search the outline by code or words, e.g. K1.E or hypobaric" autocomplete="off">
      <button type="button" id="${id}-sug">Suggest from the wording</button></div><div id="${id}-res" class="objres" aria-live="polite"></div>`;
    const $ = s => host.querySelector('#' + id + '-' + s), q = $('q'), res = $('res');
    const tag = r => {
      const d = Objectives.describe(r);
      return `<span class="objchip${d ? '' : ' bad'}"><span class="ocode">${esc(r)}</span> ${d ? esc(cut(d.text, 80)) : '<i>not on the outline</i>'}<button type="button" data-orm="${esc(r)}" aria-label="Remove ${esc(r)}">&times;</button></span>`;
    };
    const paint = () => { $('chips').innerHTML = list.length ? list.map(tag).join('') : '<span class="muted small">None chosen.</span>'; if (opts.onChange) opts.onChange(list.slice()); };
    const add = r => { if (r && !list.includes(r) && list.length < 12) { list.push(r); paint(); } };
    const rows = (items, none) => { res.innerHTML = items.length ? items.map(d => `<button type="button" class="objrow" data-oadd="${esc(d.ref)}"${list.includes(d.ref) ? ' disabled' : ''}><span class="ocode">${esc(d.ref)}</span> ${esc(cut(d.text, 130))}${d.under ? ` <span class="muted">under ${esc(d.under.code)} ${esc(cut(d.under.text, 60))}</span>` : ''}</button>`).join('') : `<p class="muted small">${none}</p>`; };
    const find = () => { const v = q.value.trim(); if (!v) { res.innerHTML = ''; return []; } const r = Objectives.search(v, opts.boards ? opts.boards() : [], 8); rows(r, 'Nothing on the outline matches that.'); return r; };
    q.addEventListener('input', e => { e.stopPropagation(); find(); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const r = find(); if (r.length && !list.includes(r[0].ref)) { add(r[0].ref); q.value = ''; res.innerHTML = ''; } } });
    $('sug').onclick = () => {
      const subj = opts.subject ? opts.subject() : '';
      if (!subj) { res.innerHTML = '<p class="muted small">Choose a subject first.</p>'; return; }
      const refs = Objectives.suggest(subj, bank.subjects, opts.topic ? opts.topic() : '', opts.text ? opts.text() : '', 4).map(Objectives.describe).filter(Boolean);
      rows(refs, 'Nothing on the outline clearly matches. Try searching above.');
    };
    host.addEventListener('click', e => {
      const rm = e.target.closest('[data-orm]'), ad = e.target.closest('[data-oadd]');
      if (rm) { const i = list.indexOf(rm.dataset.orm); if (i >= 0) { list.splice(i, 1); paint(); } }
      if (ad) { add(ad.dataset.oadd); ad.disabled = true; }
    });
    paint();
    return { get: () => list.slice() };
  }
  // What a member sees under an item: the ABPM outline items the editors tagged it with
  const BOARD = { aem: 'Aerospace', om: 'Occupational', pm: 'Preventive' };
  function show(list) {
    const rows = (list || []).map(r => Objectives.describe(r)).filter(Boolean);
    return rows.length ? `<div class="small objshow"><b>Board outline (ABPM):</b><ul class="reclist objlist">${rows.map(d => `<li><span class="ocode">${esc(d.code)}</span> ${esc(cut(d.text, 140))} <span class="muted">${BOARD[d.board]}${d.under ? ', under ' + esc(d.under.code) + ' ' + esc(cut(d.under.text, 60)) : ''}</span></li>`).join('')}</ul></div>` : '';
  }
  return { mount, show };
})();
