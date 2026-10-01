'use strict';
// Flashcards for members: the deck list and the study session. The schedule logic is in cardsched.js.
const Cards = (() => {
  const RATINGS = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']];
  const NEW_PER_DAY = 10;
  const day = () => CardSched.today();
  const subjectCards = subject => (bank.cards || []).filter(c => !subject || c.subject === subject);
  const optsFor = () => ({ newPerDay: NEW_PER_DAY, newSeenToday: Store.newCardsSeen(day()) });
  const when = ymd => { const n = Math.round((Date.parse(ymd) - Date.parse(day())) / 86400000); return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`; };

  function lessonFor(c) {                                  // the card's own link, else the best-matching lesson
    const lessons = bank.lessons || [];
    if (c.lessonId) { const l = lessons.find(x => x.id === c.lessonId); if (l) return l; }
    const m = Related.match({ subject: c.subject, topic: c.topic, stem: c.front, explanation: c.back, options: [], answer: '' }, lessons);
    return m ? m.lesson : null;
  }

  // ------------------------------------------------------------------ deck list
  function indexPage() {
    pageTitle('Flashcards');
    const all = bank.cards || [], states = Store.cardStates(), t = day(), opts = optsFor();
    if (!all.length) {
      $app.innerHTML = `<div class="card"><h2>Flashcards</h2><p class="muted">${Cloud.enabled && bank.cardsMissing ? 'Flashcards are not switched on yet. Please check back soon.' : 'There are no flashcards yet. They will appear here as they are added.'}</p></div>`;
      return;
    }
    const k = CardSched.counts(all, states, t, opts), subjects = [...new Set(all.map(c => c.subject))].sort();
    const rows = subjects.map(s => { const cs = subjectCards(s), n = CardSched.counts(cs, states, t, opts);
      return `<tr><th scope="row">${esc(s)}</th><td>${n.due}</td><td>${n.new}</td><td>${n.total}</td><td><a class="btn${n.due + n.new ? ' primary' : ''}" href="#/cards/study/${encodeURIComponent(s)}" aria-label="Study ${esc(s)}">Study</a></td></tr>`; }).join('');
    $app.innerHTML = `<div class="pagehead"><div><h2 class="pagetitle">Flashcards</h2><p class="muted">Short cards to learn and revisit. Rate each one honestly and the app brings it back just before you would forget it.</p></div></div>
      <div class="grid"><div class="card stat"><b>${k.due}</b><span>Due today</span></div><div class="card stat"><b>${k.new}</b><span>New today</span></div><div class="card stat"><b>${k.learned}</b><span>Well learned</span></div><div class="card stat"><b>${k.total}</b><span>Cards in all</span></div></div>
      <div class="card"><div class="row spread"><div><h2 style="margin:0">Today</h2><p class="muted" style="margin:4px 0 0">${k.due + k.new ? `${k.due} to review and ${k.new} new` : 'Nothing is due. Come back tomorrow, or study a deck below to get ahead.'}</p></div>
        <a class="btn primary" href="#/cards/study"${k.due + k.new ? '' : ' aria-disabled="true"'}>${k.due + k.new ? `Study ${k.due + k.new} card${k.due + k.new === 1 ? '' : 's'}` : 'All done for today'}</a></div></div>
      <div class="card"><h2>Decks</h2><div class="scroll" role="region" tabindex="0" aria-label="Decks table"><table><caption class="sr">Flashcard decks by subject</caption><thead><tr><th scope="col">Subject</th><th scope="col">Due</th><th scope="col">New</th><th scope="col">Cards</th><th scope="col"><span class="sr">Study</span></th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted small">Up to ${NEW_PER_DAY} new cards a day, so reviews never pile up.</p></div>`;
  }

  // ------------------------------------------------------------------ study session
  function studyPage(subjectArg) {
    const subject = subjectArg ? decodeURIComponent(subjectArg) : '';
    pageTitle('Flashcards' + (subject ? ': ' + subject : ''));
    const all = subjectCards(subject), t = day();
    let queue = CardSched.queue(all, Store.cardStates(), t, optsFor()), idx = 0, shown = false;
    const total = queue.length, tally = { 1: 0, 2: 0, 3: 0, 4: 0 }; let reviewed = 0;
    const back = '<a href="#/cards">Back to flashcards</a>';

    function finish() {
      document.onkeydown = null;
      const nextDue = Object.values(Store.cardStates()).filter(s => all.some(c => Store.cardState(c.id) === s)).map(s => s.due).filter(d => d > t).sort()[0];
      $app.innerHTML = `<p class="crumb">${back}</p><div class="card"><h2>${total ? 'Session complete' : 'Nothing to study right now'}</h2>
        ${total ? `<p>You reviewed <b>${reviewed}</b> card${reviewed === 1 ? '' : 's'}: ${tally[4]} easy, ${tally[3]} good, ${tally[2]} hard, ${tally[1]} again.</p>` : '<p class="muted">Nothing is due and there are no new cards left for today.</p>'}
        <p class="muted">${nextDue ? `Your next review is ${when(nextDue)}.` : 'Rate cards as you go and the app will schedule them.'}</p>
        <div class="row"><a class="btn primary" href="#/cards">Back to decks</a></div></div>`;
      const h = $app.querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
    }

    function draw(focusTarget) {
      if (idx >= queue.length) return finish();
      const c = queue[idx], st = Store.cardState(c.id), lesson = shown ? lessonFor(c) : null;
      $app.innerHTML = `<p class="crumb">${back}</p>
        <div class="card flash" aria-label="Flashcard ${Math.min(idx + 1, queue.length)} of ${queue.length}">
          <div class="row spread"><span class="muted">${esc(c.subject)}${c.topic ? ' &middot; ' + esc(c.topic) : ''}</span><span class="muted" aria-live="polite">${idx + 1} of ${queue.length}</span></div>
          <div class="bar" aria-hidden="true"><i style="width:${Math.round(100 * idx / queue.length)}%"></i></div>
          <p class="flash-side"><span class="sr">Front: </span>${esc(c.front)}</p>
          ${shown ? `<div class="flash-back" id="flash-back" tabindex="-1"><span class="sr">Back: </span>${esc(c.back).replace(/\n/g, '<br>')}
            ${c.references && c.references.length ? `<p class="muted small">${c.references.map(esc).join('; ')}</p>` : ''}
            ${lesson ? `<p class="small"><a href="#/lesson/${encodeURIComponent(lesson.id)}" target="_blank" rel="noopener">Study the lesson: ${esc(lesson.title)}<span class="sr"> (opens in a new tab)</span></a></p>` : ''}</div>
            <div class="rate" role="group" aria-label="How well did you know it?">${RATINGS.map(([r, l]) => `<button class="rate-${r}" data-rate="${r}"><b>${l}</b><span class="small">${CardSched.preview(st, r, t)}</span><span class="sr"> (key ${r})</span></button>`).join('')}</div>`
            : `<div class="row" style="margin-top:14px"><button class="primary" id="reveal">Show answer <span class="sr">(Space)</span></button></div>`}
        </div>
        <p class="muted small">Keys: Space shows the answer, 1 to 4 rate it.${st ? '' : ' This is a new card.'}</p>`;
      const rv = document.getElementById('reveal'); if (rv) { rv.onclick = () => { shown = true; draw('back'); }; if (focusTarget !== 'none') rv.focus(); }
      $app.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => rate(+b.dataset.rate));
      if (focusTarget === 'back') { const fb = document.getElementById('flash-back'); if (fb) fb.focus(); }
    }

    function rate(r) {
      const c = queue[idx], prev = Store.cardState(c.id);
      if (!prev) Store.countNewCard(t);
      Store.rateCard(c.id, CardSched.rate(prev, r, t));
      tally[r]++; reviewed++; shown = false;
      if (r === 1) queue.splice(Math.min(queue.length, idx + 1 + 3), 0, c);       // a missed card comes back a few cards later
      idx++; draw();
    }

    document.onkeydown = e => {
      if (!location.hash.startsWith('#/cards/study') || document.querySelector('.modal') || /TEXTAREA|INPUT|SELECT/.test(e.target.tagName)) return;
      if (e.key === ' ' && !/^(BUTTON|A)$/.test(e.target.tagName) && !shown && idx < queue.length) { e.preventDefault(); shown = true; draw('back'); }
      else if (shown && /^[1-4]$/.test(e.key)) rate(+e.key);
    };
    if (!total) return finish();
    draw();
  }

  function page(a, b) { if (a === 'study') return studyPage(b); return indexPage(); }
  function dueCount() { try { return CardSched.counts(bank.cards || [], Store.cardStates(), day(), optsFor()); } catch { return { due: 0, new: 0 }; } }
  return { page, indexPage, studyPage, dueCount, lessonFor };
})();
