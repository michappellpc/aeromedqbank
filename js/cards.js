'use strict';
// Flashcards for members: the deck list and the study session. The schedule logic is in cardsched.js.
const Cards = (() => {
  const RATINGS = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']];
  const day = () => CardSched.today();
  const subjectCards = subject => (bank.cards || []).filter(c => !subject || c.subject === subject);
  const prefs = () => CardSched.settings(Store.data.settings && Store.data.settings.cards);
  const optsFor = () => { const p = prefs(); return { newPerDay: p.newPerDay, maxReviews: p.maxReviews, newSeenToday: Store.newCardsSeen(day()) }; };
  const shuffled = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
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
        <p class="muted small">Up to ${prefs().newPerDay} new cards a day${prefs().maxReviews ? ` and ${prefs().maxReviews} reviews per session` : ''}, so reviews never pile up.</p></div>
      <details class="card flashset" id="flashset"><summary><b>Flashcard settings</b></summary>${settingsForm()}</details>`;
    bindSettings();
  }

  // ------------------------------------------------------------------ settings
  function settingsForm() {
    const p = prefs();
    return `<form id="cs-form" class="fgrid" style="margin-top:12px;max-width:640px" novalidate>
      <div><label for="cs-new">New cards per day (0 to 100)</label><input id="cs-new" type="number" min="0" max="100" step="1" value="${p.newPerDay}"></div>
      <div><label for="cs-max">Most reviews in one session</label><select id="cs-max">${CardSched.MAX_REVIEW_CHOICES.map(n => `<option value="${n}"${p.maxReviews === n ? ' selected' : ''}>${n ? n + ' cards' : 'No limit'}</option>`).join('')}</select></div>
      <div><label for="cs-order">Order of reviews</label><select id="cs-order"><option value="due"${p.order === 'due' ? ' selected' : ''}>Most overdue first</option><option value="shuffle"${p.order === 'shuffle' ? ' selected' : ''}>Shuffled</option></select></div>
      <fieldset style="grid-column:1/-1"><legend class="sr">More options</legend>
        <label class="chk"><input type="checkbox" id="cs-int"${p.intervals ? ' checked' : ''}> Show when each rating will bring the card back</label>
        <label class="chk"><input type="checkbox" id="cs-rev"${p.reverse ? ' checked' : ''}> Show the answer first and recall the prompt (reverse cards)</label></fieldset>
      <p class="notice" id="cs-msg" hidden role="alert" style="grid-column:1/-1"></p>
      <div class="row" style="grid-column:1/-1"><button class="primary" type="submit">Save settings</button><button type="button" id="cs-reset">Reset to defaults</button></div></form>`;
  }
  function bindSettings() {
    const f = document.getElementById('cs-form'); if (!f) return;
    const save = raw => { const v = CardSched.settings(raw); Store.data.settings.cards = v; Store.touchSettings(); toast('Flashcard settings saved.'); indexPage(); document.getElementById('flashset').open = true; };
    f.onsubmit = e => {
      e.preventDefault();
      const n = document.getElementById('cs-new').value.trim(), msg = document.getElementById('cs-msg');
      if (!/^\d+$/.test(n) || +n > 100) { msg.textContent = 'New cards per day must be a whole number from 0 to 100.'; msg.hidden = false; return; }
      save({ newPerDay: +n, maxReviews: +document.getElementById('cs-max').value, order: document.getElementById('cs-order').value, intervals: document.getElementById('cs-int').checked, reverse: document.getElementById('cs-rev').checked });
    };
    document.getElementById('cs-reset').onclick = () => save(CardSched.DEFAULTS);
  }

  // ------------------------------------------------------------------ study session
  function studyPage(subjectArg) {
    const subject = subjectArg ? decodeURIComponent(subjectArg) : '';
    pageTitle('Flashcards' + (subject ? ': ' + subject : ''));
    const all = subjectCards(subject), t = day();
    const pr = prefs();
    let queue = CardSched.queue(all, Store.cardStates(), t, optsFor()), idx = 0, shown = false;
    if (pr.order === 'shuffle') queue = shuffled(queue);
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
          <p class="flash-side"><span class="sr">${pr.reverse ? 'Answer' : 'Front'}: </span>${pr.reverse ? esc(c.back).replace(/\n/g, '<br>') : esc(c.front)}</p>
          ${shown ? `<div class="flash-back" id="flash-back" tabindex="-1"><span class="sr">${pr.reverse ? 'Prompt' : 'Back'}: </span>${pr.reverse ? esc(c.front) : esc(c.back).replace(/\n/g, '<br>')}
            ${c.references && c.references.length ? `<p class="muted small">${c.references.map(esc).join('; ')}</p>` : ''}
            ${lesson ? `<p class="small"><a href="#/lesson/${encodeURIComponent(lesson.id)}" target="_blank" rel="noopener">Study the lesson: ${esc(lesson.title)}<span class="sr"> (opens in a new tab)</span></a></p>` : ''}</div>
            <div class="rate" role="group" aria-label="How well did you know it?">${RATINGS.map(([r, l]) => `<button class="rate-${r}" data-rate="${r}"><b>${l}</b>${pr.intervals ? `<span class="small">${CardSched.preview(st, r, t)}</span>` : ''}<span class="sr"> (key ${r})</span></button>`).join('')}</div>`
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
