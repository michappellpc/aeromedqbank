'use strict';
// Highlighting on the page: paints a member's saved highlights into text "zones", and handles selecting text to highlight it
// (or make a flashcard from it). A zone is any element with data-hk (q or l), data-hi (question or lesson id) and data-hf (which part).
// Highlights are saved per member, so they come back in every test and on every device. The logic is in hl.js.
const HlUI = (() => {
  let pop = null, popTimer = null, last = null;
  const newId = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const zoneOf = n => { const e = n && (n.nodeType === 1 ? n : n.parentElement); return e ? e.closest('[data-hf]') : null; };
  const textNodes = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = []; let n, pos = 0; while ((n = w.nextNode())) { out.push({ n, s: pos, e: pos + n.data.length }); pos += n.data.length; } return out; };
  const listFor = z => Store.hlIn(z.dataset.hk, z.dataset.hi, z.dataset.hf);

  function paint(z) {
    z.querySelectorAll('mark.hl').forEach(m => m.replaceWith(...m.childNodes)); z.normalize();
    const list = listFor(z); if (!list.length) return;
    const segs = Hl.segments(z.textContent, list).filter(s => s.ids.length);
    for (let x = segs.length - 1; x >= 0; x--) {
      const { a, b, ids } = segs[x];
      for (const t of textNodes(z).reverse()) {
        if (t.e <= a || t.s >= b) continue;
        let node = t.n; const from = Math.max(a, t.s) - t.s, to = Math.min(b, t.e) - t.s;
        if (to < node.data.length) node.splitText(to);
        if (from > 0) node = node.splitText(from);
        const m = document.createElement('mark'); m.className = 'hl'; m.dataset.hl = ids.join(' '); node.replaceWith(m); m.appendChild(node);
      }
    }
  }
  // If a highlight's words have moved (the text was edited), find them in another part of the same question or lesson and re-save them there.
  // complete: every part of the item is on the page (a lesson), so a highlight whose own part is gone can be found too.
  function heal(root, complete) {
    const zones = [...root.querySelectorAll('[data-hf]')], items = new Set(zones.map(z => z.dataset.hk + '|' + z.dataset.hi));
    items.forEach(key => {
      const [k, i] = key.split('|'), mine = zones.filter(z => z.dataset.hk === k && z.dataset.hi === i);
      Store.hlIn(k, i).forEach(h => {
        const own = mine.find(z => z.dataset.hf === h.f);
        if (own ? Hl.anchor(own.textContent, h) : !complete) return;
        for (const z of mine) { const r = Hl.anchor(z.textContent, { ...h, a: -1 }); if (r) { Store.putHl({ ...h, f: z.dataset.hf, a: r[0], b: r[1] }); return; } }
      });
    });
  }
  const paintAll = (root, complete) => { root = root || document; heal(root, complete); root.querySelectorAll('[data-hf]').forEach(paint); };
  // Lessons are many blocks of rich text: each paragraph, list item, heading, caption and table cell becomes a zone, numbered in page order.
  function tagLesson(article, id) {
    const sel = 'p, li, h3, h4, td, th, figcaption', all = [...article.querySelectorAll(sel)];
    all.filter(el => !el.querySelector(sel) && el.textContent.trim()).forEach((el, n) => { el.dataset.hk = 'l'; el.dataset.hi = id; el.dataset.hf = 'n' + n; });
  }
  const attrs = (k, i, f) => `data-hk="${k}" data-hi="${esc(i)}" data-hf="${esc(f)}"`;

  // The selection as { z, a, b }: offsets into the zone's text. A selection running past the end of a zone is cut at the end.
  function selection() {
    const sel = getSelection(); if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0), z = zoneOf(r.startContainer); if (!z) return null;
    const pre = document.createRange(); pre.selectNodeContents(z); pre.setEnd(r.startContainer, r.startOffset);
    const a = pre.toString().length, len = z.textContent.length;
    const b = zoneOf(r.endContainer) === z ? a + r.toString().length : len;
    return b > a ? { z, a, b, rect: r.getBoundingClientRect() } : null;
  }

  function apply(z, a, b) {                       // highlight [a, b), or take the highlight off if it is already all highlighted
    const text = z.textContent, list = listFor(z), k = z.dataset.hk, i = z.dataset.hi, f = z.dataset.hf;
    const res = Hl.covered(text, list, a, b) ? Hl.sub(text, list, a, b) : Hl.add(text, list, a, b); if (!res) return false;
    res.remove.forEach(id => Store.delHl(id));
    [].concat(res.put || []).forEach(p => Store.putHl({ id: newId(), k, i, f, a: p.a, b: p.b, t: p.t, at: Date.now() }));
    paint(z); changed(); return true;
  }
  function removeIds(z, ids) { ids.forEach(id => Store.delHl(id)); paint(z); changed(); }
  function changed() {                            // the little marker on questions that have highlights
    document.querySelectorAll('[data-hlq]').forEach(el => el.classList.toggle('hl', Store.hlIn('q', el.dataset.hlq).length > 0));
    document.querySelectorAll('.hltag[data-hlq]').forEach(el => { el.hidden = !Store.hlIn('q', el.dataset.hlq).length; });
    document.querySelectorAll('.hltag[data-hll]').forEach(el => { el.hidden = !Store.hlIn('l', el.dataset.hll).length; });
  }

  // ------------------------------------------------------------------ the little toolbar
  function hide() { if (pop) { pop.remove(); pop = null; } }
  function show(rect, buttons) {
    hide(); pop = document.createElement('div'); pop.className = 'hlpop'; pop.setAttribute('role', 'toolbar'); pop.setAttribute('aria-label', 'Highlight');
    pop.innerHTML = buttons.map(([id, label]) => `<button type="button" data-act="${id}">${esc(label)}</button>`).join('');
    document.body.appendChild(pop);
    const w = pop.offsetWidth, h = pop.offsetHeight, coarse = matchMedia('(pointer: coarse)').matches;
    let x = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)), y = coarse ? rect.bottom + 12 : rect.top - h - 8;
    if (y < 8) y = rect.bottom + 8; if (y + h > innerHeight - 8) y = Math.max(8, rect.top - h - 8);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    pop.onmousedown = e => e.preventDefault();      // keep the selection while a button is pressed
    return pop;
  }
  function onSelection() {
    clearTimeout(popTimer);
    popTimer = setTimeout(() => {
      const s = selection();
      if (!s) { if (!(pop && pop.dataset.mark)) hide(); return; }
      last = { z: s.z, a: s.a, b: s.b };
      const on = Hl.covered(s.z.textContent, listFor(s.z), s.a, s.b), p = show(s.rect, [['hl', on ? 'Remove highlight' : 'Highlight'], ['card', 'Make flashcard']]);
      p.onclick = e => {
        const act = e.target.closest('button') && e.target.closest('button').dataset.act; if (!act) return;
        if (act === 'hl') { apply(s.z, s.a, s.b); getSelection().removeAllRanges(); hide(); }
        else if (act === 'card') { const t = s.z.textContent, sel = Hl.trim(t, s.a, s.b); if (sel) { getSelection().removeAllRanges(); hide(); cardFrom(s.z.dataset.hk, s.z.dataset.hi, t, sel[0], sel[1]); } }
      };
    }, 180);
  }
  function onClick(e) {
    const m = e.target.closest && e.target.closest('mark.hl');
    if (pop && !e.target.closest('.hlpop') && !m) hide();
    if (!m || e.target.closest('.opt') || e.target.closest('.hlpop')) return;       // a click on highlighted text inside an answer choice still just picks the choice
    if (getSelection() && !getSelection().isCollapsed) return;
    const z = zoneOf(m), ids = m.dataset.hl.split(' '), p = show(m.getBoundingClientRect(), [['rm', 'Remove highlight'], ['card', 'Make flashcard']]); p.dataset.mark = '1';
    p.onclick = ev => {
      const act = ev.target.closest('button') && ev.target.closest('button').dataset.act; if (!act) return;
      if (act === 'rm') { removeIds(z, ids); hide(); }
      else { const h = Store.hls()[ids[0]], t = z.textContent, r = h && Hl.anchor(t, h); hide(); if (r) cardFrom(z.dataset.hk, z.dataset.hi, t, r[0], r[1]); }
    };
  }
  const cardFrom = (k, i, text, a, b) => MyCards.fromText({ k, i, front: Hl.blank(text, a, b), back: text.slice(a, b) });

  // The Highlight button in the tools row works on whatever was last selected
  function highlightSelected() {
    const s = selection() || last; if (!s || !s.z.isConnected) { toast('Select some text first, then press Highlight.'); return false; }
    const ok = apply(s.z, s.a, s.b); getSelection().removeAllRanges(); hide(); last = null; return ok;
  }
  function clearIn(root, k, i) {                  // take every highlight off the question text and choices shown in root
    root.querySelectorAll(`[data-hk="${k}"][data-hi="${CSS.escape(i)}"]`).forEach(z => { listFor(z).forEach(h => Store.delHl(h.id)); paint(z); }); changed();
  }
  document.addEventListener('selectionchange', onSelection);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) hide(); });
  window.addEventListener('hashchange', hide);
  return { paint, paintAll, tagLesson, attrs, apply, selection, highlightSelected, clearIn, changed, hide, newId, listFor };
})();
