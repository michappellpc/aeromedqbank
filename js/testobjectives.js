'use strict';
// "Board learning objectives" on the New test page: pick items of the ABPM content outline (with each domain's percent of the exam beside it) to practice
// only the questions tagged to them. Loaded before app.js; uses esc and OutlineChart (outlinechart.js).
const ObjTest = (() => {
  let root = null, onChange = () => {};
  const layouts = () => (bank.boards || []).map(b => OutlineChart.layout(b.id)).filter(Boolean);
  // Every outline code of a domain, "board:code", for counting a whole domain
  const domainRefs = (board, key) => { const L = OutlineChart.layout(board), d = L && L.domains.find(x => x.key === key); return d ? d.items.map(i => board + ':' + i.code) : []; };
  const depth = i => Math.max(0, i.code.split('.').length - 2);

  function html() {
    const boards = layouts(); if (!boards.length) return '';
    const stmt = (b, i) => `<li style="padding-left:${depth(i) * 16}px"><label class="chk objchk"><input type="checkbox" name="obj" value="${esc(b.id + ':' + i.code)}" data-code="${esc(i.code)}"> <span class="ocode">${esc(i.code)}</span> ${esc(i.text.length > 150 ? i.text.slice(0, 149).trimEnd() + '…' : i.text)} <span class="cnt" data-ocnt="${esc(b.id + ':' + i.code)}"></span></label></li>`;
    const dom = (b, d, n) => {
      const body = d.parts.length
        ? d.parts.map(p => `<p class="small objpart"><b>${esc(p.letter)}. ${esc(p.name)}</b> <span class="wpct">${p.weight}% of exam</span></p><ul class="objlist">${d.items.filter(i => i.sub && String(i.sub).trim().charAt(0) === p.letter).map(i => stmt(b, i)).join('')}</ul>`).join('')
        : `<ul class="objlist">${d.items.map(i => stmt(b, i)).join('')}</ul>`;
      return `<details class="objdom"><summary><span class="odname">${esc(/^[IVX]+$/.test(d.key) ? d.key + '. ' : d.key + ' ')}${esc(d.name)}</span> <span class="wpct">${d.weight}% of exam</span> <span class="cnt" data-ocnt="dom:${esc(b.id + ':' + d.key)}"></span></summary>
        <label class="chk objall"><input type="checkbox" data-domall="${esc(b.id + ':' + d.key)}"> All of ${esc(d.name)}</label>${body}</details>`;
    };
    return `<fieldset class="card" id="objcard"><legend>Board learning objectives</legend>
      <p class="muted small" style="margin:0 0 8px">Optional. Pick items of the board's content outline to practice only the questions tagged with them, together with the other choices on this page. The percent beside each domain is how much of the board exam it is worth.</p>
      <div class="row"><button type="button" id="objclear">Clear objectives</button><span class="muted small" id="objsum" aria-live="polite"></span></div>
      ${boards.map((b, n) => `<details class="objboard" data-board="${esc(b.id)}"><summary><span class="sgname">${esc(b.name)}</span></summary>${b.domains.map(d => dom(b, d, n)).join('')}</details>`).join('')}</fieldset>`;
  }

  const boxes = () => [...root.querySelectorAll('input[name=obj]')];
  const selected = () => new Set(root ? boxes().filter(c => c.checked).map(c => c.value) : []);
  // Keep the domain boxes and the summary in step with the statement boxes
  function sync() {
    root.querySelectorAll('[data-domall]').forEach(a => {
      const list = [...a.closest('details').querySelectorAll('input[name=obj]')], on = list.filter(c => c.checked).length;
      a.checked = list.length > 0 && on === list.length; a.indeterminate = on > 0 && on < list.length;
    });
    const n = selected().size; root.querySelector('#objsum').textContent = n ? `${n} item${n === 1 ? '' : 's'} selected` : 'None selected: all questions are included.';
  }
  function bind(rootEl, cb) {
    root = rootEl; onChange = cb || (() => {});
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('input[name=obj]')) {                                                // a statement also takes in the statements under it
        const li = t.closest('li'), b = t.value.split(':')[0], code = t.dataset.code;
        t.closest('details').querySelectorAll('input[name=obj]').forEach(c => { if (c.value.startsWith(b + ':' + code + '.')) c.checked = t.checked; });
      } else if (t.matches('[data-domall]')) { t.closest('details').querySelectorAll('input[name=obj]').forEach(c => { c.checked = t.checked; }); }
      else return;
      sync(); onChange();
    });
    root.querySelector('#objclear').onclick = () => { boxes().forEach(c => { c.checked = false; }); sync(); onChange(); };
    sync();
  }
  // Does a question cover any selected item? (a question tagged to K1.E.1 covers K1.E too, see OutlineChart.coverSet)
  const matches = (q, sel) => { if (!sel || !sel.size) return true; for (const r of OutlineChart.coverSet(q)) if (sel.has(r)) return true; return false; };
  // How many of these questions cover each item and each domain: { "aem:K1.E.1": 3, "dom:aem:K1": 9 }. One pass over the questions.
  let refDomain = null;
  const counts = list => {
    if (!refDomain) { refDomain = new Map(); layouts().forEach(L => L.domains.forEach(d => d.items.forEach(i => refDomain.set(L.id + ':' + i.code, L.id + ':' + d.key)))); }
    const out = {};
    list.forEach(q => { const doms = new Set(); OutlineChart.coverSet(q).forEach(r => { out[r] = (out[r] || 0) + 1; const d = refDomain.get(r); if (d) doms.add(d); }); doms.forEach(d => { out['dom:' + d] = (out['dom:' + d] || 0) + 1; }); });
    return out;
  };
  // Show only the boards ticked at the top of the page
  const showBoards = ids => { if (root) root.querySelectorAll('.objboard').forEach(d => { d.hidden = !ids.includes(d.dataset.board); }); };
  return { html, bind, selected, matches, counts, domainRefs, showBoards };
})();
