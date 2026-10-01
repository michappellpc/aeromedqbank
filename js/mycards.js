'use strict';
// A member's own flashcards, private to them. They are studied alongside the official cards (under the deck "My cards") and use the same
// spaced-repetition schedule. A card can be written by hand, or made from highlighted text or from a question.
// Cards live in Store.data.mine; their review schedule is in Store.data.cards under 'my:<id>', like any other card.
const MyCards = (() => {
  const DECK = 'My cards', FRONT = 600, BACK = 1500;
  const asCard = c => ({ id: 'my:' + c.id, mine: true, status: 'reviewed', boards: [], subject: DECK, topic: '', front: c.front, back: c.back, lessonId: c.sk === 'l' ? c.si : undefined, references: [], sk: c.sk, si: c.si });
  const list = () => Object.values(Store.mineMap()).sort((a, b) => (b.at || 0) - (a.at || 0)).map(asCard);
  let official = [];
  function install(bank) {   // bank.cards is the official cards plus your own, whichever way it is set
    Object.defineProperty(bank, 'cards', { get: () => official.concat(list()), set: v => { official = v || []; }, enumerable: true, configurable: true });
  }
  const trunc = (s, n) => { s = String(s).trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const sourceLink = c => c.sk === 'l' ? `<a href="#/lesson/${encodeURIComponent(c.si)}">From a lesson</a>` : c.sk === 'q' ? `<a href="#/question/${encodeURIComponent(c.si)}">From a question</a>` : '';

  function save(c) { Store.putMine({ at: Date.now(), ...c }); }
  function remove(id) { Store.delMine(id); }

  // ------------------------------------------------------------------ the form
  function dialog({ id, front = '', back = '', k, i, note = '', onSaved }) {
    const d = document.createElement('div'); d.className = 'modal';
    d.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="mc-h" style="max-width:560px;width:100%"><h2 id="mc-h" style="margin-top:0">${id ? 'Edit flashcard' : 'New flashcard'}</h2>
      ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
      <form id="mc-form" novalidate>
        <label for="mc-front">Front (the prompt)</label><textarea id="mc-front" rows="4" maxlength="${FRONT}">${esc(front)}</textarea><p class="hint"><span id="mc-fn">0</span> of ${FRONT}</p>
        <label for="mc-back">Back (the answer)</label><textarea id="mc-back" rows="5" maxlength="${BACK}">${esc(back)}</textarea><p class="hint"><span id="mc-bn">0</span> of ${BACK}</p>
        <p class="notice" id="mc-msg" hidden role="alert"></p>
        <div class="row" style="margin-top:8px"><button class="primary" type="submit">${id ? 'Save' : 'Add to My cards'}</button><button type="button" data-cancel>Cancel</button></div></form></div>`;
    const prev = document.activeElement;
    const close = () => { d.remove(); document.removeEventListener('keydown', onKey, true); if (prev && document.body.contains(prev)) prev.focus(); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    d.onclick = e => { if (e.target === d || e.target.hasAttribute('data-cancel')) close(); };
    const F = d.querySelector('#mc-front'), B = d.querySelector('#mc-back');
    const count = () => { d.querySelector('#mc-fn').textContent = F.value.length; d.querySelector('#mc-bn').textContent = B.value.length; };
    F.oninput = B.oninput = count; count();
    d.querySelector('#mc-form').onsubmit = e => {
      e.preventDefault(); const f = F.value.trim(), b = B.value.trim(), msg = d.querySelector('#mc-msg');
      const err = !f ? 'Write the front of the card.' : !b ? 'Write the back of the card.' : '';
      if (err) { msg.textContent = err; msg.hidden = false; (!f ? F : B).focus(); return; }
      const old = id ? Store.mineMap()[id] : null, nid = id || HlUI.newId();
      save({ id: nid, front: f, back: b, sk: old ? old.sk : k, si: old ? old.si : i, at: old ? old.at : Date.now() });
      close(); toast(id ? 'Flashcard saved.' : 'Added to My cards. Find it under Flashcards.');
      if (onSaved) onSaved(nid);
    };
    document.body.appendChild(d); F.focus();
  }
  // From text you highlighted: the front is the sentence with the highlighted words blanked out, the back is those words.
  const fromText = o => dialog({ ...o, note: 'Made from your highlight. Change either side as you like.' });
  // From a whole question: the question on the front, the right answer and the explanation on the back.
  function fromQuestion(q) {
    const right = (q.options.find(o => o.id === q.answer) || {}).text || '';
    dialog({ k: 'q', i: q.id, front: trunc(q.stem, FRONT), back: trunc(`${right}\n\n${q.explanation}`, BACK), note: 'Made from this question. Trim it down to the one fact you want to remember.' });
  }

  // ------------------------------------------------------------------ the list on the Flashcards page
  function section() {
    const mine = Object.values(Store.mineMap()).sort((a, b) => (b.at || 0) - (a.at || 0));
    return `<div class="card" id="mycards"><div class="row spread"><div><h2 style="margin:0">My cards</h2><p class="muted" style="margin:4px 0 0">${mine.length ? `${mine.length} card${mine.length === 1 ? '' : 's'} of your own. Only you can see them.` : 'Make your own cards, or select text in a question or lesson and choose Make flashcard.'}</p></div><button class="primary" id="mc-new" type="button">New card</button></div>
      ${mine.length ? `<ul class="mylist">${mine.map(c => `<li><div class="mybody"><b>${esc(trunc(c.front, 140))}</b><span class="muted">${esc(trunc(c.back, 140))}</span>${c.sk ? `<span class="small">${sourceLink(c)}</span>` : ''}</div><div class="row"><button type="button" data-mc-edit="${esc(c.id)}" aria-label="Edit this card">Edit</button><button type="button" data-mc-del="${esc(c.id)}" aria-label="Delete this card">Delete</button></div></li>`).join('')}</ul>` : ''}</div>`;
  }
  function bind(redraw) {
    const nb = document.getElementById('mc-new'); if (nb) nb.onclick = () => dialog({ onSaved: redraw });
    document.querySelectorAll('[data-mc-edit]').forEach(b => b.onclick = () => { const c = Store.mineMap()[b.dataset.mcEdit]; if (c) dialog({ id: c.id, front: c.front, back: c.back, onSaved: redraw }); });
    document.querySelectorAll('[data-mc-del]').forEach(b => b.onclick = async () => { if (await ask('Delete this flashcard? This cannot be undone.', 'Delete')) { remove(b.dataset.mcDel); toast('Card deleted.'); redraw(); } });
  }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-mkcard]'); if (b && bank.byId[b.dataset.mkcard]) fromQuestion(bank.byId[b.dataset.mkcard]); });
  return { install, list, dialog, fromText, fromQuestion, section, bind, remove, DECK };
})();
