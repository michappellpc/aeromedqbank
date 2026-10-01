'use strict';
// "My highlights": everything the member has highlighted, grouped by question or lesson, with Make flashcard and Remove. Also the
// single-question view that a highlighted question links to.
const Notebook = (() => {
  const FIELD = f => f === 'stem' ? 'Question' : f === 'expl' ? 'Explanation' : /^opt-/.test(f) ? 'Choice ' + f.slice(4) : /^note-/.test(f) ? 'Note on choice ' + f.slice(5) : 'Lesson';
  const FIELD_ORDER = f => f === 'stem' ? 0 : /^opt-/.test(f) ? 1 : f === 'expl' ? 2 : /^note-/.test(f) ? 3 : 4;
  const trunc = (s, n) => { s = String(s).trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  let view = { kind: 'all', q: '' };

  // The text of one part of a question or lesson as it is shown, to build a card's front from.
  function fieldText(h) {
    if (h.k === 'q') {
      const q = bank.byId[h.i]; if (!q) return '';
      if (h.f === 'stem') return q.stem; if (h.f === 'expl') return q.explanation;
      if (/^opt-/.test(h.f)) return (q.options.find(o => o.id === h.f.slice(4)) || {}).text || '';
      if (/^note-/.test(h.f)) return (q.optionNotes || {})[h.f.slice(5)] || '';
      return '';
    }
    const l = (bank.lessons || []).find(x => x.id === h.i); if (!l) return '';
    const box = document.createElement('div'); box.innerHTML = Lessons.render(l.blocks); HlUI.tagLesson(box, l.id);
    const z = box.querySelector(`[data-hf="${CSS.escape(h.f)}"]`); return z ? z.textContent : '';
  }
  function makeCard(h) {
    const text = fieldText(h), r = text && Hl.anchor(text, h);
    MyCards.fromText({ k: h.k, i: h.i, front: r ? Hl.blank(text, r[0], r[1]) : '', back: h.t });
  }

  function page() {
    pageTitle('My highlights');
    const all = Object.values(Store.hls()), groups = new Map();
    all.forEach(h => { const key = h.k + '|' + h.i; (groups.get(key) || groups.set(key, []).get(key)).push(h); });
    const w = view.q.trim().toLowerCase();
    const items = [...groups.entries()].map(([key, hs]) => {
      const [k, i] = key.split('|'), q = k === 'q' ? bank.byId[i] : null, l = k === 'l' ? (bank.lessons || []).find(x => x.id === i) : null;
      hs.sort((a, b) => FIELD_ORDER(a.f) - FIELD_ORDER(b.f) || (a.a - b.a));
      return { k, i, q, l, hs, at: Math.max(...hs.map(h => h.at || 0)) };
    }).filter(g => (view.kind === 'all' || view.kind === g.k) && (!w || g.hs.some(h => h.t.toLowerCase().includes(w)) || (g.q && g.q.stem.toLowerCase().includes(w)) || (g.l && g.l.title.toLowerCase().includes(w))))
      .sort((a, b) => b.at - a.at);
    const nq = all.filter(h => h.k === 'q').length, nl = all.filter(h => h.k === 'l').length;
    $app.innerHTML = `<div class="pagehead"><div><h2 class="pagetitle">My highlights</h2><p class="muted">${all.length ? `${all.length} highlight${all.length === 1 ? '' : 's'} from ${groups.size} question${groups.size === 1 ? '' : 's'} and lessons. Only you can see them.` : 'Nothing highlighted yet. Select text in a question, an explanation or a lesson, then choose Highlight.'}</p></div>
      ${all.length ? `<div class="lsearch"><label class="sr" for="hq">Search your highlights</label><input id="hq" type="search" placeholder="Search your highlights" autocomplete="off" value="${esc(view.q)}"></div>` : ''}</div>
      ${all.length ? `<div class="row" role="group" aria-label="Show">${[['all', `All (${all.length})`], ['q', `Questions (${nq})`], ['l', `Lessons (${nl})`]].map(([k, t]) => `<button type="button" data-kind="${k}" aria-pressed="${view.kind === k}">${t}</button>`).join('')}</div>` : ''}
      <div id="hl-list">${items.map(g => `<section class="card hlgroup" data-g="${esc(g.k + '|' + g.i)}">
        <div class="row spread"><div><b>${g.q ? esc(trunc(g.q.stem, 120)) : g.l ? esc(g.l.title) : 'This ' + (g.k === 'q' ? 'question' : 'lesson') + ' is no longer available'}</b><div class="muted small">${g.q ? esc(g.q.subject) : g.l ? esc(g.l.subject) : ''}</div></div>
          ${g.q ? `<a class="btn" href="#/question/${encodeURIComponent(g.i)}">Open question</a>` : g.l ? `<a class="btn" href="#/lesson/${encodeURIComponent(g.i)}">Open lesson</a>` : ''}</div>
        <ul class="hllist">${g.hs.map(h => `<li><div class="hlquote"><mark class="hl">${esc(trunc(h.t, 300))}</mark><span class="muted small">${FIELD(h.f)}</span></div><div class="row"><button type="button" data-mk="${esc(h.id)}">Make flashcard</button><button type="button" data-rm="${esc(h.id)}" aria-label="Remove this highlight">Remove</button></div></li>`).join('')}</ul></section>`).join('') || (all.length ? '<p class="muted">No highlights match.</p>' : '')}</div>`;
    const hqi = document.getElementById('hq'); if (hqi) hqi.oninput = e => { view.q = e.target.value; const pos = e.target.selectionStart; page(); const n = document.getElementById('hq'); n.focus(); n.setSelectionRange(pos, pos); };
    $app.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { view.kind = b.dataset.kind; page(); });
    $app.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => { const h = Store.hls()[b.dataset.mk]; if (h) makeCard(h); });
    $app.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { Store.delHl(b.dataset.rm); toast('Highlight removed.'); page(); });
  }

  // One question on its own: the question, the right answer and the explanation, with highlighting.
  function question(id) {
    id = decodeURIComponent(id || ''); const q = bank.byId[id];
    if (!q) { pageTitle('Question'); $app.innerHTML = '<p class="crumb"><a href="#/highlights">My highlights</a></p><div class="card"><h2>Question not available</h2><p class="muted">It may have been removed.</p></div>'; return; }
    pageTitle('Question');
    $app.innerHTML = `<p class="crumb"><a href="#/highlights">My highlights</a></p><div class="card">
      <div class="muted">${esc(q.subject)}${q.topic ? ' &middot; ' + esc(q.topic) : ''} <span class="tag hltag" data-hlq="${esc(id)}"${Store.hlIn('q', id).length ? '' : ' hidden'}>&#9998; Highlighted</span></div>
      <p class="stem" ${HlUI.attrs('q', id, 'stem')}>${esc(q.stem)}</p>
      ${q.options.map(o => `<div class="opt ${o.id === q.answer ? 'correct' : ''}"><span class="k">${esc(o.id)}.</span><span class="txt"><span ${HlUI.attrs('q', id, 'opt-' + o.id)}>${esc(o.text)}</span>${o.id === q.answer ? '<span class="sr"> (correct answer)</span>' : ''}</span></div>`).join('')}
      ${imgTag(q)}${explanationHtml(q, q.answer, false)}</div>`;
    bindZoom(); hydrateImages(); HlUI.paintAll($app);
  }
  return { page, question, makeCard, fieldText };
})();
