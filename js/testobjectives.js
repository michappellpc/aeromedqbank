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
    // one row: a checkbox for the domain (or part) with its percent of the exam and question count, and a button that opens its details
    const row = (b, id, title, weight, cnt, items, extra = '', cls = '') => `<div class="objrow ${cls}"><div class="objhead"><label class="chk"><input type="checkbox" data-grp> <span class="odname">${title}</span> <span class="wpct">${weight}% of exam</span> <span class="cnt" data-ocnt="${esc(cnt)}"></span></label>${items.length ? `<button type="button" class="objtog" data-ost="ost-${esc(id)}" aria-expanded="false" aria-controls="ost-${esc(id)}">Show details</button>` : ''}</div>
      ${items.length ? `<ul class="objstm" id="ost-${esc(id)}" hidden>${items.map(i => stmt(b, i)).join('')}</ul>` : ''}${extra}</div>`;
    const dom = (b, d) => {
      const title = esc(/^[IVX]+$/.test(d.key) ? d.key + '. ' : d.key + ' ') + esc(d.name), did = (b.id + '-' + d.key).replace(/[^A-Za-z0-9-]/g, '_');
      if (!d.parts.length) return row(b, did, title, d.weight, 'dom:' + b.id + ':' + d.key, d.items);
      const parts = d.parts.map(p => row(b, did + '-' + p.letter, esc(p.letter) + '. ' + esc(p.name), p.weight, '', d.items.filter(i => i.sub && String(i.sub).trim().charAt(0) === p.letter), '', 'objpartrow')).join('');
      return row(b, did, title, d.weight, 'dom:' + b.id + ':' + d.key, [], `<div class="objparts">${parts}</div>`);
    };
    return `<fieldset class="card" id="objcard"><legend>Board learning objectives</legend>
      <div class="row"><button type="button" id="objclear">Clear</button><span class="muted small" id="objsum" aria-live="polite"></span></div>
      <p class="muted small" style="margin:6px 0 0">Optional. Pick parts of the board's content outline to practice only the questions tagged to them, together with the other choices on this page. The percent beside each domain is how much of the board exam it is worth. With nothing picked, all questions are included.</p>
      ${boards.map(b => `<details class="objgroup objboard" open data-board="${esc(b.id)}"><summary><span class="sgname">${esc(b.name)}</span> <span class="muted sgsel" data-osel="${esc(b.id)}"></span></summary><div class="objrows">${b.domains.map(d => dom(b, d)).join('')}</div></details>`).join('')}</fieldset>`;
  }

  const boxes = () => [...root.querySelectorAll('input[name=obj]')];
  const selected = () => new Set(root ? boxes().filter(c => c.checked).map(c => c.value) : []);
  // Keep the domain and part boxes and the summaries in step with the statement boxes
  function sync() {
    root.querySelectorAll('[data-grp]').forEach(a => {
      const list = [...a.closest('.objrow').querySelectorAll('input[name=obj]')], on = list.filter(c => c.checked).length;
      a.checked = list.length > 0 && on === list.length; a.indeterminate = on > 0 && on < list.length;
    });
    root.querySelectorAll('[data-osel]').forEach(sp => { const n = [...sp.closest('.objboard').querySelectorAll('input[name=obj]:checked')].length; sp.textContent = n ? `${n} selected` : ''; });
    const n = selected().size; root.querySelector('#objsum').textContent = n ? `${n} item${n === 1 ? '' : 's'} selected` : '';
  }
  function bind(rootEl, cb) {
    root = rootEl; onChange = cb || (() => {});
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('input[name=obj]')) {                                                // a statement also takes in the statements under it
        const b = t.value.split(':')[0], code = t.dataset.code;
        t.closest('.objrow').querySelectorAll('input[name=obj]').forEach(c => { if (c.value.startsWith(b + ':' + code + '.')) c.checked = t.checked; });
      } else if (t.matches('[data-grp]')) { t.closest('.objrow').querySelectorAll('input[name=obj]').forEach(c => { c.checked = t.checked; }); }
      else return;
      sync();                                                                            // the change bubbles on to the form, which recounts the test
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('.objtog'); if (!b) return;
      const list = document.getElementById(b.dataset.ost), open = list.hidden; list.hidden = !open; b.setAttribute('aria-expanded', String(open)); b.textContent = open ? 'Hide details' : 'Show details';
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
