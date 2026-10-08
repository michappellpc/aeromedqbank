'use strict';
// Flashcards for members: the deck list and the study session. The schedule logic is in cardsched.js.
const Cards = (() => {
  const RATINGS = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']];
  const day = () => CardSched.today();
  const subjectCards = subject => (bank.cards || []).filter(c => !subject || c.subject === subject);
  const prefs = () => CardSched.settings(Store.data.settings && Store.data.settings.cards);
  const optsFor = () => { const p = prefs(); return { newPerDay: p.newPerDay, maxReviews: p.maxReviews, newSeenToday: Store.newCardsSeen(day()), suspended: Store.suspended() }; };
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
      $app.innerHTML = `<div class="card"><h2>Flashcards</h2><p class="muted">${Cloud.enabled && bank.cardsMissing ? 'Flashcards are not switched on yet. Please check back soon.' : 'There are no flashcards yet. They will appear here as they are added.'}</p></div>${MyCards.section()}`;
      MyCards.bind(indexPage);
      return;
    }
    const k = CardSched.counts(all, states, t, opts), subjects = [...new Set(all.map(c => c.subject))].sort();
    const rows = subjects.map(s => { const cs = subjectCards(s), n = CardSched.counts(cs, states, t, opts);
      return `<tr><th scope="row">${esc(s)}</th><td>${n.due}</td><td>${n.new}</td><td>${n.total}</td><td><a class="btn${n.due + n.new ? ' primary' : ''}" href="#/cards/study/${encodeURIComponent(s)}" aria-label="Study ${esc(s)}">Study</a> <a class="btn" href="#/cards/browse/${encodeURIComponent(s)}" aria-label="Browse ${esc(s)}">Browse</a></td></tr>`; }).join('');
    $app.innerHTML = `<div class="pagehead"><div><h2 class="pagetitle">Flashcards</h2><p class="muted">Short cards to learn and revisit. Rate each one honestly and the app brings it back just before you would forget it.</p></div></div>
      <div class="grid"><div class="card stat"><b>${k.due}</b><span>Due today</span></div><div class="card stat"><b>${k.new}</b><span>New today</span></div><div class="card stat"><b>${k.learned}</b><span>Well learned</span></div><div class="card stat"><b>${k.total}</b><span>Cards in all</span></div></div>
      <div class="card"><div class="row spread"><div><h2 style="margin:0">Today</h2><p class="muted" style="margin:4px 0 0">${k.due + k.new ? `${k.due} to review and ${k.new} new` : 'Nothing is due. Come back tomorrow, or study a deck below to get ahead.'}</p></div>
        <div class="row"><a class="btn primary" href="#/cards/study"${k.due + k.new ? '' : ' aria-disabled="true"'}>${k.due + k.new ? `Study ${k.due + k.new} card${k.due + k.new === 1 ? '' : 's'}` : 'All done for today'}</a><a class="btn" href="#/cards/browse">Browse all cards</a></div></div></div>
      <div class="card"><h2>Decks</h2><div class="scroll" role="region" tabindex="0" aria-label="Decks table"><table><caption class="sr">Flashcard decks by subject</caption><thead><tr><th scope="col">Subject</th><th scope="col">Due</th><th scope="col">New</th><th scope="col">Cards</th><th scope="col"><span class="sr">Study</span></th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted small">Up to ${prefs().newPerDay} new cards a day${prefs().maxReviews ? ` and ${prefs().maxReviews} reviews per session` : ''}, so reviews never pile up.${k.suspended ? ` ${k.suspended} card${k.suspended === 1 ? ' is' : 's are'} suspended. <a href="#/cards/browse/~suspended">See suspended cards</a>.` : ''}</p></div>
      ${MyCards.section()}
      <details class="card flashset" id="flashset"><summary><b>Flashcard settings</b></summary>${settingsForm()}</details>`;
    bindSettings(); MyCards.bind(indexPage);
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
            ${c.references && c.references.length ? `<p class="muted small">${c.references.map(esc).join('; ')}</p>` : ''}${ObjPicker.show(c.objectives)}
            ${lesson ? `<p class="small"><a href="#/lesson/${encodeURIComponent(lesson.id)}" target="_blank" rel="noopener">Study the lesson: ${esc(lesson.title)}<span class="sr"> (opens in a new tab)</span></a></p>` : ''}</div>
            <div class="rate" role="group" aria-label="How well did you know it?">${RATINGS.map(([r, l]) => `<button class="rate-${r}" data-rate="${r}"><b>${l}</b>${pr.intervals ? `<span class="small">${CardSched.preview(st, r, t)}</span>` : ''}<span class="sr"> (key ${r})</span></button>`).join('')}</div>`
            : `<div class="row" style="margin-top:14px"><button class="primary" id="reveal">Show answer <span class="sr">(Space)</span></button></div>`}
          <div class="row" style="margin-top:12px"><button type="button" id="suspend" class="small" title="Stop this card from coming up until you turn it back on in Browse">Suspend this card</button></div>
        </div>
        <p class="muted small">Keys: Space shows the answer, 1 to 4 rate it.${st ? '' : ' This is a new card.'}</p>`;
      const rv = document.getElementById('reveal'); if (rv) { rv.onclick = () => { shown = true; draw('back'); }; if (focusTarget !== 'none') rv.focus(); }
      $app.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => rate(+b.dataset.rate));
      document.getElementById('suspend').onclick = () => suspend();
      if (focusTarget === 'back') { const fb = document.getElementById('flash-back'); if (fb) fb.focus(); }
    }

    function suspend() {                                       // takes the card out of this session and every later one, without rating it
      const c = queue[idx]; Store.setSuspended(c.id, true);
      for (let j = queue.length - 1; j > idx; j--) if (queue[j].id === c.id) queue.splice(j, 1);
      queue.splice(idx, 1); shown = false; toast('Card suspended. Turn it back on from Browse.'); draw();
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

  // ------------------------------------------------------------------ browse (read through the cards; nothing is scheduled or rated)
  function browsePage(subjectArg) {
    pageTitle('Browse flashcards');
    const all = bank.cards || [], states = Store.cardStates(), t = day();
    if (!all.length) return indexPage();
    const subjects = [...new Set(all.map(c => c.subject))].sort(), STEP = 40;
    const susOnly = subjectArg === '~suspended';
    const v = { q: '', subject: subjectArg && !susOnly ? decodeURIComponent(subjectArg) : '', all: false, sus: susOnly, shown: STEP, open: new Set() };
    const isSus = c => Store.suspended().includes(c.id);
    const status = c => { const st = states[c.id]; return isSus(c) ? 'Suspended' : !st ? 'New' : st.due <= t ? 'Due today' : `Next review ${when(st.due)}`; };
    $app.innerHTML = `<p class="crumb"><a href="#/cards">Back to flashcards</a></p><div class="card"><h2 style="margin:0">Browse flashcards</h2>
      <p class="muted">Read through the cards at your own pace. Nothing here is rated or scheduled, so it does not change your reviews.</p>
      <form class="filters" onsubmit="return false" aria-label="Filter flashcards" style="margin-top:12px">
        <div><label for="bq">Search</label><input id="bq" type="search" placeholder="words on the card or topic" autocomplete="off"></div>
        <div><label for="bs">Subject</label><select id="bs"><option value="">All subjects</option>${subjects.map(s => `<option${s === v.subject ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div style="align-self:end"><label class="chk"><input type="checkbox" id="ball"> Show all answers</label></div>
        <div style="align-self:end"><label class="chk"><input type="checkbox" id="bsus"${susOnly ? ' checked' : ''}> Suspended cards only</label></div></form></div>
      <div id="blist"></div>`;
    const el = i => document.getElementById(i);
    const filtered = () => { const w = v.q.trim().toLowerCase(); return all.filter(c => (!v.sus || isSus(c)) && (!v.subject || c.subject === v.subject) && (!w || c.front.toLowerCase().includes(w) || c.back.toLowerCase().includes(w) || (c.topic || '').toLowerCase().includes(w))); };
    function paint() {
      const rows = filtered(), slice = rows.slice(0, v.shown);
      el('blist').innerHTML = rows.length ? `<p class="muted" aria-live="polite">${rows.length} card${rows.length === 1 ? '' : 's'}</p>${slice.map(c => {
        const open = v.all || v.open.has(c.id), lesson = open ? lessonFor(c) : null;
        return `<article class="card browsecard"><div class="row spread"><span class="muted small">${esc(c.subject)}${c.topic ? ' &middot; ' + esc(c.topic) : ''}</span><span class="tag">${esc(status(c))}</span></div>
          <p class="flash-side" style="margin:8px 0">${esc(c.front)}</p>
          <div id="bk-${esc(c.id)}"${open ? '' : ' hidden'} class="flash-back">${esc(c.back).replace(/\n/g, '<br>')}${c.references && c.references.length ? `<p class="muted small">${c.references.map(esc).join('; ')}</p>` : ''}${ObjPicker.show(c.objectives)}
            ${lesson ? `<p class="small"><a href="#/lesson/${encodeURIComponent(lesson.id)}" target="_blank" rel="noopener">Study the lesson: ${esc(lesson.title)}<span class="sr"> (opens in a new tab)</span></a></p>` : ''}</div>
          <div class="row" style="margin-top:8px"><button type="button" data-sus="${esc(c.id)}" aria-pressed="${isSus(c)}">${isSus(c) ? 'Turn back on' : 'Suspend'}<span class="sr"> card: ${esc(c.front.slice(0, 40))}</span></button></div>
          ${v.all ? '' : `<div class="row" style="margin-top:8px"><button data-flip="${esc(c.id)}" aria-expanded="${open}" aria-controls="bk-${esc(c.id)}">${open ? 'Hide answer' : 'Show answer'}<span class="sr"> for ${esc(c.front.slice(0, 40))}</span></button></div>`}</article>`; }).join('')}
        ${rows.length > v.shown ? `<div class="row" style="justify-content:center"><button id="bmore">Show ${Math.min(STEP, rows.length - v.shown)} more</button></div>` : ''}`
        : '<div class="card"><p class="muted">No cards match.</p></div>';
      el('blist').querySelectorAll('[data-flip]').forEach(b => b.onclick = () => { const id = b.dataset.flip; v.open.has(id) ? v.open.delete(id) : v.open.add(id); const keep = id; paint(); const again = el('blist').querySelector(`[data-flip="${keep}"]`); if (again) again.focus(); });
      el('blist').querySelectorAll('[data-sus]').forEach(b => b.onclick = () => { const id = b.dataset.sus; Store.setSuspended(id, !isSus({ id })); toast(isSus({ id }) ? 'Card suspended.' : 'Card turned back on.'); paint(); const again = el('blist').querySelector(`[data-sus="${id}"]`); if (again) again.focus(); });
      if (el('bmore')) el('bmore').onclick = () => { v.shown += STEP; paint(); };
    }
    el('bq').oninput = e => { v.q = e.target.value; v.shown = STEP; paint(); };
    el('bs').onchange = e => { v.subject = e.target.value; v.shown = STEP; paint(); };
    el('bsus').onchange = e => { v.sus = e.target.checked; v.shown = STEP; paint(); };
    el('ball').onchange = e => { v.all = e.target.checked; paint(); };
    paint();
  }

  function page(a, b) { if (a === 'study') return studyPage(b); if (a === 'browse') return browsePage(b); return indexPage(); }
  function dueCount() { try { return CardSched.counts(bank.cards || [], Store.cardStates(), day(), optsFor()); } catch { return { due: 0, new: 0 }; } }
  return { page, indexPage, studyPage, dueCount, lessonFor };
})();
