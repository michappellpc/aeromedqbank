'use strict';
const $app = document.getElementById('app'), $timer = document.getElementById('timer');
let bank = { boards: [], subjects: {}, questions: [], byId: {}, config: {}, lessons: [], lessonFiles: [], cards: [], cardFiles: [], cardsMissing: false, peer: {}, choices: {}, program: null };
MyCards.install(bank);
const APP_VERSION = '1.3';
let tick = null, ready = false, profile = null, refocus = null;

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const boardName = id => (bank.boards.find(b => b.id === id) || {}).name || id;
const isDraft = q => q.status !== 'reviewed';
const peerLine = id => { const p = bank.peer && bank.peer[id]; return p ? `<span class="peer"><b>${p.pct}%</b> of members answered this correctly on their first try (${p.users} members)</span>` : ''; };
// The share of members who picked an option, shown after answering once enough members have a recorded first pick.
const pickBadge = (qid, optId) => {
  const c = bank.choices && bank.choices[qid]; if (!c || !c.total) return '';
  const n = Math.round(100 * (c.counts[optId] || 0) / c.total);
  return `<span class="pick"><span class="sr">${n}% of members chose this answer</span><span aria-hidden="true">${n}%</span></span><i class="pickbar" aria-hidden="true" style="width:${n}%"></i>`;
};
let peerAt = 0;
function refreshPeer() { if (!Cloud.enabled || Date.now() - peerAt < 300000) return; peerAt = Date.now(); Cloud.peerStats().then(m => { bank.peer = m; }); Cloud.peerChoices().then(m => { bank.choices = m; }); }
const mascotOn = () => Store.data.settings.mascot !== false;
const quizMascotOn = () => mascotOn() && Store.data.settings.quizMascot !== false;   // the ram while taking a test can be turned off on its own
const showDrafts = () => Store.data.settings.showDrafts !== false;
// A link under an explanation to the most relevant lesson, or to the subject's lessons if none fits well.
const relatedCache = new Map();
// The lesson a question links to: the one chosen by hand if there is one, else the best match. Returns { lesson, pinned } or null.
function lessonLinkFor(q) {
  const lessons = bank.lessons || [];
  if (q.lessonId) { const l = lessons.find(x => x.id === q.lessonId); if (l) return { lesson: l, pinned: true }; }
  const m = lessons.length ? Related.match(q, lessons) : null;
  return m ? { lesson: m.lesson, pinned: false } : null;
}
function relatedLesson(q) {
  const lessons = bank.lessons || [], key = q.id + '|' + lessons.length + '|' + (q.lessonId || '');
  if (!relatedCache.has(key)) relatedCache.set(key, lessons.length ? lessonLinkFor(q) : null);
  const m = relatedCache.get(key);
  const tab = '<span class="sr"> (opens in a new tab)</span>';
  if (m) return `<p class="relatedcard"><span class="relatedlesson">Study this: <a href="#/lesson/${encodeURIComponent(m.lesson.id)}" target="_blank" rel="noopener">${esc(m.lesson.title)}${tab}</a></span></p>`;
  if (lessons.some(l => l.subject === q.subject)) return `<p class="relatedcard"><span class="relatedlesson">More to read: <a href="#/lessons/${encodeURIComponent(q.subject)}" target="_blank" rel="noopener">Lessons on ${esc(q.subject)}${tab}</a></span></p>`;
  return '';
}
// The explanation shown under a question: the verdict, how other members did, the reasoning, why each choice is right or wrong, a lesson link and references.
function explanationHtml(q, sel, verdict) {
  const notes = q.optionNotes ? q.options.filter(o => q.optionNotes[o.id]) : [], right = sel === q.answer;
  return `<div class="expl">
    ${verdict ? `<div class="verdict ${right ? 'ok' : 'no'}"><span aria-hidden="true">${right ? '✔' : '✖'}</span> <b>${right ? 'Correct' : 'Incorrect'}.</b> Correct answer: ${esc(q.answer)}.</div>` : ''}
    ${peerLine(q.id) ? `<p class="peerrow">${peerLine(q.id)}</p>` : ''}
    <h2 class="exph">Explanation</h2><p class="exptext" ${HlUI.attrs('q', q.id, 'expl')}>${esc(q.explanation)}</p>
    ${notes.length ? `<h2 class="exph">Answer choices</h2><ul class="optnotes">${notes.map(o => `<li class="${o.id === q.answer ? 'right' : ''}"><b>${esc(o.id)}.</b> <span ${HlUI.attrs('q', q.id, 'note-' + o.id)}>${esc(q.optionNotes[o.id])}</span></li>`).join('')}</ul>` : ''}
    ${relatedLesson(q)}
    <p class="mkrow"><button type="button" data-mkcard="${esc(q.id)}" title="Turn this question into a flashcard of your own">&#9998; Make flashcard</button></p>
    ${q.references && q.references.length ? `<p class="muted small refs">References: ${q.references.map(esc).join('; ')}</p>` : ''}</div>`;
}
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const privImg = q => (q.image && q.image.startsWith('private:') ? q.image.slice(8) : null);
const imgTag = q => !q.image ? '' : privImg(q)
  ? `<img class="qimg" data-zoom data-private="${esc(privImg(q))}" alt="${esc(q.imageAlt || '')}" title="Tap to enlarge" hidden><p class="muted" data-imgnote>Loading image...</p>`
  : `<img class="qimg" data-zoom src="${esc(q.image)}" alt="${esc(q.imageAlt || '')}" title="Tap to enlarge">`;
async function hydrateImages() {
  for (const im of $app.querySelectorAll('img[data-private]')) {
    const note = im.nextElementSibling && im.nextElementSibling.hasAttribute('data-imgnote') ? im.nextElementSibling : null;
    try {
      if (!Cloud.enabled) throw new Error('demo');
      im.src = await Cloud.image(im.dataset.private); im.hidden = false; if (note) note.remove();
    } catch { if (note) note.textContent = 'Image unavailable' + (im.alt ? ': ' + im.alt : '') + (navigator.onLine === false ? ' (you are offline and this device has not saved it yet)' : ''); }
  }
}
function labelScrolls() { $app.querySelectorAll('.scroll').forEach(b => { const h = b.closest('.card') && b.closest('.card').querySelector('h2,h3'); b.setAttribute('aria-label', (h ? h.textContent : 'Data') + ' table'); }); }
function pageTitle(t) { const h = document.getElementById('page-title'); if (h) h.textContent = t; document.title = t + ' | AeroMedQBank'; }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function applyTheme() {
  const pal = Store.data.settings.palette;
  if (pal === 'navy') document.documentElement.setAttribute('data-palette', 'navy'); else document.documentElement.removeAttribute('data-palette');
  const t = Store.data.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

// Boards and subjects are not sensitive, so they always come from the static manifest. Questions come from the
// private database in cloud mode, or from the static files (the pilot/demo mode) when accounts are not configured.
async function loadMeta() {
  if (window.__QBANK_DATA) { const m = window.__QBANK_DATA; bank.config = m.config || {}; bank.boards = m.boards; bank.subjects = m.subjects; bank.lessons = m.lessons || []; bank.cards = m.cards || []; return m.questions; }
  const base = 'data/';
  const m = await (await fetch(base + 'manifest.json')).json();
  bank.config = await fetch(base + 'config.json').then(r => r.json()).catch(() => ({}));
  bank.boards = m.boards; bank.subjects = m.subjects; bank.lessonFiles = m.lessons || []; bank.cardFiles = m.cards || [];
  return m.files;
}
async function loadStatic(files) {
  const lists = Array.isArray(files) && typeof files[0] === 'object' ? [files] : await Promise.all(files.map(f => fetch('data/' + f).then(r => r.json())));
  setQuestions(lists.flat());
  if (bank.cardFiles.length) bank.cards = (await Promise.all(bank.cardFiles.map(f => fetch('data/' + f).then(r => r.json()).catch(() => [])))).flat().filter(c => c.status === 'reviewed' && !c.archived);
  if (bank.lessonFiles.length) bank.lessons = (await Promise.all(bank.lessonFiles.map(f => fetch('data/' + f).then(r => r.json()).catch(() => [])))).flat();
}
function setQuestions(list) { bank.questions = list; bank.byId = Object.fromEntries(list.map(q => [q.id, q])); }

function zoomImage(src, alt) {
  const d = document.createElement('div'); d.className = 'modal zoom';
  d.innerHTML = `<div class="card"><img src="${esc(src)}" alt="${esc(alt)}"><div class="row spread"><span class="muted">${esc(alt)}</span><button class="primary">Close</button></div></div>`;
  d.onclick = e => { if (e.target === d || e.target.tagName === 'BUTTON') d.remove(); };
  document.body.appendChild(d);
}
const bindZoom = () => $app.querySelectorAll('[data-zoom]').forEach(im => im.onclick = () => zoomImage(im.src, im.alt));

// in-page dialog (native confirm/alert are blocked in some embedded viewers)
function ask(msg, yes = 'OK', no = 'Cancel') {
  return new Promise(res => {
    const d = document.createElement('div'); d.className = 'modal';
    d.innerHTML = `<div class="card" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="row"><button class="primary" data-y>${esc(yes)}</button>${no ? `<button data-n>${esc(no)}</button>` : ''}</div></div>`;
    const done = v => { d.remove(); res(v); };
    d.querySelector('[data-y]').onclick = () => done(true);
    const n = d.querySelector('[data-n]'); if (n) n.onclick = () => done(false);
    document.body.appendChild(d); d.querySelector('[data-y]').focus();
  });
}

// ---------- question feedback ----------
// The Feedback button opens the team's Google Form (data/config.json -> feedbackUrl) in a new tab.
const formUrl = () => { const u = String(bank.config.feedbackUrl || ''); return /^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/.test(u) ? u : ''; };
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}
// Accounts are on: the message goes to the team's Admin > Inbox (queued offline, sent when there is a connection).
function feedbackInApp(q) {
  const ref = `${q.id} (${q.subject}${q.topic ? ' / ' + q.topic : ''})`;
  const d = document.createElement('div'); d.className = 'modal';
  d.innerHTML = `<div class="card fb" role="dialog" aria-modal="true" aria-labelledby="fb-h"><h2 id="fb-h">Message the team about this question</h2>
    <p class="muted">${esc(ref)}</p>
    <form id="fb-form" novalidate><label for="fb-cat">What is it about?</label><select id="fb-cat">${FB_CATEGORIES.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
      <label for="fb-msg">Your message</label><textarea id="fb-msg" rows="5" required minlength="10" maxlength="1500" placeholder="What should be fixed or improved? If you think the answer is wrong, say what you think is right and why."></textarea>
      <p class="muted small">Sent to the site's editors. Only administrators can see your email. Please do not include patient information.</p>
      <p class="notice" id="fb-err" hidden role="alert"></p>
      <div class="row"><button class="primary" type="submit">Send</button><button type="button" data-cancel>Cancel</button></div></form></div>`;
  const close = () => { d.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey, true);
  d.onclick = e => { if (e.target === d || e.target.hasAttribute('data-cancel')) close(); };
  d.querySelector('#fb-form').onsubmit = e => {
    e.preventDefault(); const msg = d.querySelector('#fb-msg').value.trim(), err = d.querySelector('#fb-err');
    if (msg.length < 10) { err.textContent = 'Please write a little more so the team can act on it (at least 10 characters).'; err.hidden = false; return; }
    Cloud.queueFeedback({ question_id: q.id, category: d.querySelector('#fb-cat').value, message: msg, context: ref.slice(0, 300) });
    Cloud.sync().catch(() => {});
    close(); toast(navigator.onLine === false ? 'Saved. It will send when you are back online.' : 'Thanks. Your message was sent to the team.');
  };
  document.body.appendChild(d); d.querySelector('#fb-cat').focus();
}

const FB_CATEGORIES = [['wrong-answer', 'The answer or explanation looks wrong'], ['unclear', 'The question is unclear'], ['typo', 'Typo or wording'], ['picture', 'Picture problem'], ['other', 'Something else']];
function feedbackDialog(q) {
  if (Cloud.enabled) return feedbackInApp(q);
  const url = formUrl(), ref = `${q.id} (${q.subject}${q.topic ? ' / ' + q.topic : ''})`;
  const d = document.createElement('div'); d.className = 'modal';
  d.innerHTML = `<div class="card fb" role="dialog" aria-label="Question feedback">
    <h2>Question feedback</h2>
    ${url ? `<p>Found a mistake or have a suggestion? Tell the team using a short form. It opens in a new tab.</p>
    <p class="muted">1. Copy this question's reference and paste it into the form:</p>
    <div class="row" style="flex-wrap:nowrap"><input id="fb-ref" type="text" readonly value="${esc(ref)}" aria-label="Question reference"><button id="fb-copy" type="button">Copy</button></div>
    <p class="muted">2. Open the form:</p>
    <div class="row"><a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open feedback form &#8599;</a><button type="button" data-cancel>Close</button></div>
    <p class="muted">Do not include patient information.</p>`
    : `<p class="muted">The feedback form has not been set up yet.</p><button type="button" data-cancel>Close</button>`}</div>`;
  const close = () => { d.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey, true);
  d.onclick = e => { if (e.target === d || e.target.hasAttribute('data-cancel')) close(); };
  const copy = d.querySelector('#fb-copy');
  if (copy) copy.onclick = async () => {
    const i = d.querySelector('#fb-ref');
    try { await navigator.clipboard.writeText(i.value); toast('Copied.'); } catch { i.focus(); i.select(); toast('Select the text and copy it.'); }
  };
  document.body.appendChild(d); (d.querySelector('a.btn') || d.querySelector('button')).focus();
}

async function loadCards() {
  bank.cards = await Cloud.cards().catch(() => bank.cards || []);
  bank.cardsMissing = !bank.cards.length && !(await Cloud.cardsReady().catch(() => true));
}

// ---------- router ----------
async function route() {
  clearInterval(tick); $timer.hidden = true; Mascot.stop();
  if (Cloud.enabled && !ready) return;
  const [p, arg, arg2, arg3] = location.hash.replace(/^#\/?/, '').split('/');
  if (Cloud.enabled && p !== 'admin' && Admin.changed) {      // questions were edited on the Admin pages; load the new set before practicing
    Admin.changed = false;
    try { setQuestions(await Cloud.questions()); bank.lessons = await Cloud.lessons(); await loadCards(); } catch {}
    if (location.hash.replace(/^#\/?/, '').split('/')[0] !== p) return;   // the person moved on while it loaded
  }
  document.querySelectorAll('nav a').forEach(l => l.classList.toggle('on', l.getAttribute('href').split('/').slice(0, 2).join('/') === '#/' + (p === 'test' ? 'create' : p === 'lesson' ? 'lessons' : p === 'results' || p === 'review' ? 'history' : p === 'question' ? 'highlights' : p)));
  document.getElementById('nav-more').classList.toggle('on', !!document.querySelector('#secgroup a.on'));
  if (p === '' || p === 'results') refreshPeer();
  const t = Store.data.active;
  if (p === 'test' && t) return renderTest();
  ({ '': dashboard, create: () => create(arg, arg2), flagged: flaggedPage, program: () => (arg === 'insights' ? Program.insightsPage('') : arg2 === 'insights' ? Program.insightsPage(arg) : Program.facultyPage(arg)), cards: () => Cards.page(arg, arg2), support: () => Support.page(arg), lessons: () => (arg ? Lessons.subjectPage(arg) : Lessons.indexPage()), lesson: () => Lessons.lessonPage(arg), history: historyPage, settings, admin: () => Admin.route(arg, arg2, arg3), results: () => results(arg), review: () => review(arg), highlights: Notebook.page, question: () => Notebook.question(arg) }[p] || dashboard)();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
matchMedia('(min-width: 861px)').addEventListener('change', () => { if (location.hash === '#/test' && Store.data.active && !Store.data.active.paused) renderTest(); });
{ // On phones the less-used links live behind a More button
  const nav = document.querySelector('nav'), more = document.getElementById('nav-more'), grp = document.getElementById('secgroup');
  const close = (focusBack) => { nav.classList.remove('open'); more.setAttribute('aria-expanded', 'false'); if (focusBack) more.focus(); };
  more.onclick = () => { const o = nav.classList.toggle('open'); more.setAttribute('aria-expanded', String(o)); };
  grp.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  document.addEventListener('click', e => { if (nav.classList.contains('open') && !nav.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) close(true); });
  window.addEventListener('hashchange', () => close());
}

// ---------- dashboard ----------
// "Focus areas": the member's weakest subjects (lowest percent correct, at least MIN answers), with the lessons for each and
// a one-click practice of the questions they missed in it.
const FOCUS_MIN = 5, FOCUS_BELOW = 80, FOCUS_SHOW = 3;
// ---------- exam countdown ----------
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && CardSched.addDays(s, 0) === s;
function examCard(unused) {
  const ex = Store.data.settings.exam;
  if (!ex || !validDate(ex.date)) return `<div class="card examcard"><div class="examinfo"><h2>Exam countdown</h2><p class="muted">Add your exam date to see how many days you have left.</p></div><button id="exam-edit" class="primary">Set exam date</button></div>`;
  const days = CardSched.daysBetween(CardSched.today(), ex.date), when = new Date(ex.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const title = esc(ex.label || 'Exam');
  if (days < 0) return `<div class="card examcard"><div class="examinfo"><h2>${title}</h2><p class="muted">The date you set (${esc(when)}) has passed. Update it to keep a countdown.</p></div><button id="exam-edit">Change date</button></div>`;
  const pace = days === 0 ? 'Today is the day. Good luck.' : unused > 0 ? `About ${Math.ceil(unused / days)} new question${Math.ceil(unused / days) === 1 ? '' : 's'} a day would cover the ${unused} you have not seen yet.` : 'You have seen every question. Keep reviewing the ones you missed.';
  return `<div class="card examcard"><div class="examnum" role="img" aria-label="${days} day${days === 1 ? '' : 's'} until the exam"><b>${days}</b><span>${days === 1 ? 'day' : 'days'}</span></div>
    <div class="examinfo"><h2>${title}</h2><p>${esc(when)}</p><p class="muted">${esc(pace)}</p></div><button id="exam-edit">Edit</button></div>`;
}
function examDialog() {
  const ex = Store.data.settings.exam || {}, d = document.createElement('div'); d.className = 'modal';
  d.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="ex-h" style="max-width:440px"><h2 id="ex-h" style="margin-top:0">Exam date</h2>
    <form id="ex-form" novalidate><label for="ex-date">Date of your exam</label><input id="ex-date" type="date" value="${esc(ex.date || '')}">
      <label for="ex-label">Name (optional)</label><input id="ex-label" type="text" maxlength="60" autocomplete="off" placeholder="e.g. ABPM Aerospace Medicine boards" value="${esc(ex.label || '')}">
      <p class="notice" id="ex-msg" hidden role="alert"></p>
      <div class="row" style="margin-top:12px"><button class="primary" type="submit">Save</button>${ex.date ? '<button type="button" id="ex-clear">Remove</button>' : ''}<button type="button" data-cancel>Cancel</button></div></form></div>`;
  const close = () => { d.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey, true);
  d.onclick = e => { if (e.target === d || e.target.hasAttribute('data-cancel')) close(); };
  const done = msg => { close(); Store.touchSettings(); toast(msg); route(); };
  d.querySelector('#ex-form').onsubmit = e => {
    e.preventDefault(); const date = d.querySelector('#ex-date').value, msg = d.querySelector('#ex-msg');
    const err = !validDate(date) ? 'Please choose a date.' : CardSched.daysBetween(CardSched.today(), date) > 1826 ? 'That is more than five years away. Please check the date.' : '';
    if (err) { msg.textContent = err; msg.hidden = false; return; }
    Store.data.settings.exam = { date, label: d.querySelector('#ex-label').value.trim().slice(0, 60) }; done('Exam date saved.');
  };
  const clr = d.querySelector('#ex-clear'); if (clr) clr.onclick = () => { delete Store.data.settings.exam; done('Exam date removed.'); };
  document.body.appendChild(d); d.querySelector('#ex-date').focus();
}
function cardsNotice() {
  if (!(bank.cards || []).length) return '';
  const k = Cards.dueCount(), n = k.due + k.new;
  return n ? `<div class="card notice">You have <b>${n}</b> flashcard${n === 1 ? '' : 's'} to study today${k.due ? ` (${k.due} due for review)` : ''}. <a href="#/cards/study">Study now</a></div>` : '';
}
function focusAreas() {
  const st = Store.data.q, by = {};
  bank.questions.forEach(q => {
    const s = st[q.id]; if (!s || !(s.correct + s.wrong)) return;
    const o = by[q.subject] ||= { subject: q.subject, right: 0, wrong: 0, topics: {} };
    o.right += s.correct; o.wrong += s.wrong;
    if (s.wrong && q.topic) o.topics[q.topic] = (o.topics[q.topic] || 0) + s.wrong;
  });
  const weak = Object.values(by).filter(o => o.right + o.wrong >= FOCUS_MIN && pct(o.right, o.right + o.wrong) < FOCUS_BELOW)
    .sort((a, b) => pct(a.right, a.right + a.wrong) - pct(b.right, b.right + b.wrong) || b.wrong - a.wrong).slice(0, FOCUS_SHOW);
  const answered = Object.values(by).reduce((a, o) => a + o.right + o.wrong, 0);
  let body;
  if (weak.length) {
    body = `<p class="muted">Your lowest-scoring subjects so far. Review the lesson, then practice the questions you missed.</p><div class="focusgrid">${weak.map(o => {
      const n = o.right + o.wrong, lessons = Lessons.sorted((bank.lessons || []).filter(l => l.subject === o.subject));
      const topics = Object.entries(o.topics).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => esc(t));
      return `<section class="focus"><h3>${esc(o.subject)}</h3><p class="focus-pct"><b>${pct(o.right, n)}%</b> correct <span class="muted">(${o.right} of ${n})</span></p>
        ${topics.length ? `<p class="muted small">Most missed: ${topics.join(', ')}</p>` : ''}
        ${lessons.length ? `<ul class="focus-lessons">${lessons.slice(0, 3).map(l => `<li><a href="#/lesson/${encodeURIComponent(l.id)}">${esc(l.title)}</a></li>`).join('')}</ul>${lessons.length > 3 ? `<p class="small"><a href="#/lessons/${encodeURIComponent(o.subject)}">All ${lessons.length} lessons in this subject</a></p>` : ''}` : '<p class="muted small">No lesson for this subject yet.</p>'}
        <a class="btn" href="#/create/${encodeURIComponent(o.subject)}/incorrect">Practice the ones you missed</a></section>`;
    }).join('')}</div>`;
  } else if (Object.values(by).some(o => o.right + o.wrong >= FOCUS_MIN)) body = '<p class="muted">No weak spots right now: every subject you have practiced is at 80% or better. Keep going.</p>';
  else {                                                     // not enough answers yet: show the feature and how close they are
    const most = Math.max(0, ...Object.values(by).map(o => o.right + o.wrong)), need = FOCUS_MIN - most;
    body = `<p><b>Need ${need} more question${need === 1 ? '' : 's'}</b> in one subject until your focus areas appear.</p>
      <div class="bar" role="progressbar" aria-label="Progress toward focus areas" aria-valuemin="0" aria-valuemax="${FOCUS_MIN}" aria-valuenow="${most}"><i style="width:${pct(most, FOCUS_MIN)}%"></i></div>
      <p class="muted small" style="margin-top:8px">Once you have answered ${FOCUS_MIN} questions in a subject, this section shows your weakest subjects, the topics you miss most, and the lessons to review, with a button to practice the questions you missed.</p>`;
  }
  return `<div class="card" id="focus"><h2>Focus areas</h2>${body}</div>`;
}

// ---------- charts (plain SVG, no library) ----------
const scoreColor = p => p >= 80 ? 'var(--good)' : p >= 60 ? 'var(--gold)' : 'var(--bad)';
function ring(p, size = 132) {                       // score ring: the number is always printed in the middle, so color is never the only signal
  const r = 52, C = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="Score ${p} percent"><circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--line)" stroke-width="12"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${scoreColor(p)}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(C * p / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="68" text-anchor="middle" class="ringtxt">${p}%</text></svg>`;
}
function trendChart(tests, what = 'test scores') {                          // last scores, oldest to newest
  const list = tests.slice(0, 12).reverse().map(t => pct(t.correct, t.total));
  if (list.length < 2) return '';
  const W = 640, H = 150, L = 52, R = 12, T = 16, B = 16, x = i => L + (W - L - R) * i / (list.length - 1), y = v => T + (H - T - B) * (1 - v / 100);
  const pts = list.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Last ${list.length} ${what}, oldest to newest: ${list.join('%, ')}%">
    ${[0, 50, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid0"/><text x="${L - 5}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join('')}
    <polyline points="${pts}" fill="none" stroke="var(--link)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${list.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === list.length - 1 ? 4.5 : 3}" fill="var(--card)" stroke="var(--link)" stroke-width="2"/>`).join('')}
    <text x="${x(list.length - 1).toFixed(1)}" y="${(y(list[list.length - 1]) - 9).toFixed(1)}" text-anchor="end" class="axis lastv">${list[list.length - 1]}%</text></svg>`;
}

function dashboard() {
  pageTitle('Dashboard');
  const st = Store.data.q, all = Object.values(st);
  const used = all.filter(s => s.seen).length, c = all.reduce((a, s) => a + s.correct, 0), w = all.reduce((a, s) => a + s.wrong, 0);
  const rows = [];
  for (const b of bank.boards) for (const subj of bank.subjects[b.id] || []) {
    const qs = bank.questions.filter(q => q.boards.includes(b.id) && q.subject === subj);
    if (!qs.length) continue;
    let cc = 0, ww = 0, seen = 0;
    qs.forEach(q => { const s = st[q.id]; if (s) { cc += s.correct; ww += s.wrong; if (s.seen) seen++; } });
    let pu = 0, pc = 0; qs.forEach(q => { const g = bank.peer[q.id]; if (g) { pu += g.users; pc += g.users * g.pct; } });
    rows.push(`<tr><td>${esc(b.name)}</td><td>${esc(subj)}</td><td>${seen}/${qs.length}</td><td>${cc + ww ? pct(cc, cc + ww) + '%' : '—'}</td><td>${pu ? Math.round(pc / pu) + '%' : '—'}</td>
      <td style="width:22%"><div class="bar"><i style="width:${pct(cc, cc + ww)}%"></i></div></td></tr>`);
  }
  const active = Store.data.active;
  const acc = c + w ? pct(c, c + w) : null, missed = all.filter(s => s.last === 'w').length;
  const hello = acc === null ? 'Welcome, Doc. Ready for your first set of questions?'
    : (acc >= 80 ? 'Strong average. Keep the pressure on.' : acc >= 60 ? 'Solid progress. Let\'s tighten up the weak spots.' : 'Every question is practice that counts.')
    + (missed ? ` You have ${missed} missed question${missed > 1 ? 's' : ''} to revisit.` : '');
  const headline = acc === null ? 'Start a test to build your performance profile.' : `${pct(c, c + w)}% correct across ${c + w} answers.` + (missed ? ` ${missed} missed question${missed > 1 ? 's' : ''} to revisit.` : '');
  $app.innerHTML = `
  ${Mascot.scene(bank.config.coverImage)}
  ${bank.unreadReplies ? `<div class="card notice">You have <b>${bank.unreadReplies} new repl${bank.unreadReplies === 1 ? 'y' : 'ies'}</b> from the team. <a href="#/support">Open Support</a></div>` : ''}
  ${bank.program && bank.program.status === 'pending' ? `<div class="card notice">Waiting for faculty at <b>${esc(bank.program.name)}</b> to approve you. Until they do, they cannot see any of your progress. <a href="#/settings">Settings</a></div>` : ''}
  ${active ? `<div class="card continue"><div class="contbody"><b>Continue where you left off</b><span class="muted">${active.paused ? 'Paused. ' : ''}${esc(active.mode === 'timed' ? 'Timed' : 'Tutor')} test, question ${Math.min(active.idx + 1, active.qids.length)} of ${active.qids.length} (${Object.keys(active.answers).length} answered)</span><div class="bar" aria-hidden="true"><i style="width:${pct(Object.keys(active.answers).length, active.qids.length)}%"></i></div></div><a class="btn primary" href="#/test">Resume</a></div>` : ''}
  ${examCard(bank.questions.length - used)}
  <div class="grid">
    <div class="card stat"><b>${bank.questions.length}</b><span class="muted">Questions in bank</span></div>
    <div class="card stat"><b>${used}</b><span class="muted">Used (${pct(used, bank.questions.length)}%)</span></div>
    <div class="card stat"><b>${c + w ? pct(c, c + w) + '%' : '—'}</b><span class="muted">Overall correct</span></div>
    ${all.some(s => s.flagged) ? `<a class="card stat statlink" href="#/flagged"><b>${all.filter(s => s.flagged).length}</b><span class="muted">Flagged &rsaquo; review</span></a>` : `<div class="card stat"><b>0</b><span class="muted">Flagged</span></div>`}
  </div>
  ${Store.data.tests.length >= 2 ? `<div class="card"><h2>Recent scores</h2>${trendChart(Store.data.tests)}</div>` : ''}
  ${cardsNotice()}
  ${focusAreas()}
  <div class="card"><h2>Performance by subject</h2>
    ${rows.length ? `<div class="scroll" role="region" tabindex="0"><table><thead><tr><th>Board</th><th>Subject</th><th>Used</th><th>Correct</th><th title="Average of all members, first tries">Group</th><th><span class="sr">Progress</span></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="muted">No questions loaded.</p>'}
  </div>
  `;
  document.getElementById('cover-text').innerHTML = `<h2 class="pagetitle">Dashboard</h2><p>${esc(headline)}</p><a class="btn primary" href="#/create">Create a new test</a>`;
  const exb = document.getElementById('exam-edit'); if (exb) exb.onclick = examDialog;
  if (mascotOn()) Mascot.mount(document.getElementById('scene-slot'), { pose: acc !== null && acc >= 80 ? 'cheer' : 'idle', msg: esc(hello), scale: 6 });
}

// ---------- flagged questions ----------
function flaggedPage() {
  pageTitle('Flagged questions');
  const items = bank.questions.filter(q => { const s = Store.qstat(q.id); return s && s.flagged && (!isDraft(q) || showDrafts()); });
  $app.innerHTML = `<div class="pagehead"><div><h2 class="pagetitle">Flagged questions</h2><p class="muted">${items.length ? `${items.length} question${items.length === 1 ? '' : 's'} you marked to come back to.` : 'Nothing flagged yet. Use the Flag button on any question.'}</p></div>
    ${items.length ? '<button class="btn primary" id="fgo">Practice these questions</button>' : ''}</div>
    ${items.length ? `<div class="card"><table><thead><tr><th scope="col">Question</th><th scope="col">Subject</th><th scope="col">Your note</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${items.map(q => { const s = Store.qstat(q.id); return `<tr><td>${esc(q.stem.slice(0, 110))}${q.stem.length > 110 ? '...' : ''}</td><td>${esc(q.subject)}</td><td>${esc(s.note || '')}</td><td><button data-unflag="${esc(q.id)}" aria-label="Remove the flag from this question">Unflag</button></td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
  const go = document.getElementById('fgo');
  if (go) go.onclick = () => {
    Store.data.active = { id: uid(), mode: 'tutor', qids: shuffle(items).map(q => q.id), answers: {}, struck: {}, revealed: {}, idx: 0, started: Date.now(), elapsed: 0, limit: 0 };
    Store.save(); location.hash = '#/test';
  };
  $app.querySelectorAll('[data-unflag]').forEach(b => b.onclick = () => { Store.toggleFlag(b.dataset.unflag); flaggedPage(); });
}

// ---------- create test ----------
function create(preSubject, preStatus) {
  pageTitle('New test');
  const boardBoxes = bank.boards.map(b => `<label class="chk"><input type="checkbox" name="board" value="${b.id}" checked> ${esc(b.name)} <span class="cnt" data-cnt="board:${b.id}"></span></label>`).join('');
  const subjects = [...new Set(Object.values(bank.subjects).flat())];
  const subjGroups = bank.boards.map(b => {
    const list = (bank.subjects[b.id] || []).filter(x => subjects.includes(x));
    return list.length ? `<details class="subjgroup" open><summary><span class="sgname">${esc(b.name)}</span> <span class="muted sgsel" data-sg="${list.map(esc).join('|')}"></span></summary><div class="subjgrid">${list.map(x => `<label class="chk"><input type="checkbox" name="subj" value="${esc(x)}" checked> ${esc(x)} <span class="cnt" data-cnt="subj:${esc(x)}"></span></label>`).join('')}</div></details>` : '';
  }).join('');
  const choice = (name, v, title, hint, on) => `<label class="choice"><input type="radio" name="${name}" value="${v}"${on ? ' checked' : ''}><span class="choicebody"><b>${title}</b><span class="muted small">${hint}</span></span></label>`;
  $app.innerHTML = `<div class="pagehead"><div><h2 class="pagetitle">New test</h2><p class="muted">Choose what to practice. The summary on the right updates as you go.</p></div></div>
  <form id="f" class="newlayout"><div class="newmain">
    <fieldset class="card"><legend>Mode</legend><div class="choices">
      ${choice('mode', 'tutor', 'Tutor', 'Feedback after each question', true)}${choice('mode', 'timed', 'Timed', 'Feedback at the end, about 90 s per question', false)}</div></fieldset>
    <fieldset class="card"><legend>Board</legend><div class="chips">${boardBoxes}</div></fieldset>
    <fieldset class="card"><legend>Subjects</legend><div class="row"><button type="button" id="all">Select all</button><button type="button" id="none">Clear</button><span class="muted small" id="subjsum" aria-live="polite"></span></div>${subjGroups}</fieldset>
    <fieldset class="card"><legend>Question status</legend><div class="chips">
      ${[['unused', 'Unused'], ['incorrect', 'Previously incorrect'], ['flagged', 'Flagged'], ['all', 'All']].map(([v, l], i) => `<label class="chk"><input type="checkbox" name="status" value="${v}" ${i == 0 ? 'checked' : ''}> ${l} <span class="cnt" data-cnt="status:${v}"></span></label>`).join('')}</div></fieldset>
    <fieldset class="card"><legend>Difficulty</legend><div class="chips">
      ${[['1', 'Easy'], ['2', 'Medium'], ['3', 'Hard']].map(([v, l]) => `<label class="chk"><input type="checkbox" name="diff" value="${v}" checked> ${l} <span class="cnt" data-cnt="diff:${v}"></span></label>`).join('')}</div></fieldset>
    </div>
    <aside class="card newsum" aria-label="Test summary"><h2 class="navh">Your test</h2>
      <p class="bigcount"><span id="availn">0</span> <span class="muted">questions available</span></p>
      <p><label for="n">Number of questions</label><input type="number" id="n" min="1" value="20"></p>
      <div class="quick" role="group" aria-label="Quick pick the number of questions">${[10, 20, 40].map(k => `<button type="button" data-q="${k}">${k}</button>`).join('')}<button type="button" data-q="all">All</button></div>
      <p><label for="order">Order of questions</label><select id="order"><option value="random">Random</option><option value="easy">Easiest first</option><option value="hard">Hardest first</option></select></p>
      <p class="muted small" id="avail" aria-live="polite"></p>
      <button class="primary wide" id="go">Start test</button></aside></form>`;
  const f = document.getElementById('f');
  if (preSubject) {                                  // arrived from a lesson: practice just that subject
    const want = decodeURIComponent(preSubject);
    f.querySelectorAll('[name=subj]').forEach(e => { e.checked = e.value === want; });
  }
  if (preStatus === 'incorrect') f.querySelectorAll('[name=status]').forEach(e => { e.checked = e.value === 'incorrect'; });   // arrived from Focus areas: just the missed questions
  const vals = n => [...f.querySelectorAll(`[name=${n}]:checked`)].map(e => e.value);
  // Does a question fit the current choices? Anything passed as null is left out of the check, so each checkbox
  // can show how many questions would apply to it given everything else that is selected.
  const fits = (q, bs, ss, stt, ds) => {
    if (isDraft(q) && !showDrafts()) return false;
    if (ds && !ds.includes(String(q.difficulty || 2))) return false;
    if (bs && !q.boards.some(b => bs.includes(b))) return false;
    if (ss && !ss.includes(q.subject)) return false;
    if (stt) {
      if (stt.includes('all')) return true;
      const s = Store.qstat(q.id);
      return (stt.includes('unused') && (!s || !s.seen)) || (stt.includes('incorrect') && s && s.last === 'w') || (stt.includes('flagged') && s && s.flagged);
    }
    return true;
  };
  const pool = () => { const bs = vals('board'), ss = vals('subj'), stt = vals('status'), ds = vals('diff'); return bank.questions.filter(q => fits(q, bs, ss, stt, ds)); };
  const upd = () => {
    const p = pool().length, bs = vals('board'), ss = vals('subj'), stt = vals('status'), ds = vals('diff');
    document.getElementById('avail').textContent = `${p} available`; document.getElementById('availn').textContent = p; document.getElementById('go').disabled = !p;
    document.getElementById('subjsum').textContent = `${ss.length} of ${subjects.length} selected`;
    f.querySelectorAll('[data-sg]').forEach(e => { const l = e.dataset.sg.split('|'); e.textContent = `${l.filter(x => ss.includes(x)).length} of ${l.length}`; });
    f.querySelectorAll('[data-cnt]').forEach(span => {
      const [kind, key] = span.dataset.cnt.split(/:(.*)/s);
      const n = bank.questions.filter(q => kind === 'board' ? q.boards.includes(key) && fits(q, null, ss, stt, ds)
        : kind === 'subj' ? q.subject === key && fits(q, bs, null, stt, ds)
        : kind === 'diff' ? String(q.difficulty || 2) === key && fits(q, bs, ss, stt, null)
        : fits(q, bs, ss, [key], ds)).length;
      span.textContent = `(${n})`; span.closest('label').classList.toggle('zero', n === 0);
    });
  };
  f.addEventListener('change', upd); upd();
  f.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const p = pool().length; document.getElementById('n').value = b.dataset.q === 'all' ? Math.max(1, p) : Math.min(+b.dataset.q, Math.max(1, p)); });
  document.getElementById('all').onclick = () => { f.querySelectorAll('[name=subj]').forEach(e => e.checked = true); upd(); };
  document.getElementById('none').onclick = () => { f.querySelectorAll('[name=subj]').forEach(e => e.checked = false); upd(); };
  f.onsubmit = e => {
    e.preventDefault();
    const p = pool(); const n = Math.min(p.length, Math.max(1, +document.getElementById('n').value || 1));
    const order = document.getElementById('order').value, picked = shuffle(p).slice(0, n);
    if (order !== 'random') picked.sort((a, b) => (order === 'hard' ? -1 : 1) * ((a.difficulty || 2) - (b.difficulty || 2)));   // sort is stable, so ties stay random
    const qids = picked.map(q => q.id), mode = f.mode.value;
    Store.data.active = { id: uid(), mode, qids, answers: {}, struck: {}, marks: {}, revealed: {}, idx: 0, started: Date.now(), elapsed: 0, limit: mode === 'timed' ? n * 90 : 0 };
    Store.save(); location.hash = '#/test';
  };
}

// ---------- test taking ----------
function renderTest() {
  const t = Store.data.active;
  if (!t) return (location.hash = '#/');
  const q = bank.byId[t.qids[t.idx]], id = q.id;
  pageTitle(`Question ${t.idx + 1} of ${t.qids.length}`);
  const tutor = t.mode === 'tutor', shown = tutor && t.revealed[id], sel = t.answers[id], st = Store.qstat(id), locked0 = !!shown;
  const struck = t.struck[id] || [];
  const txt = Math.min(3, Math.max(0, +Store.data.settings.quizText || 0));
  clearInterval(tick);   // every redraw starts a new clock; without this the old ones keep running and fight over the display
  if (t.paused) return pausedScreen(t);
  if (t.limit) startTimer(t);
  else { $timer.hidden = false; tick = setInterval(() => $timer.textContent = fmt(elapsed(t)), 500); $timer.textContent = fmt(elapsed(t)); }
  const nav = t.qids.map((qid, i) => {
    let c = i === t.idx ? 'cur ' : '';
    if (t.answers[qid]) c += 'ans ';
    if (tutor && t.revealed[qid]) c += t.answers[qid] === bank.byId[qid].answer ? 'ok ' : 'no ';
    const s = Store.qstat(qid); if (s && s.flagged) c += 'flag ';
    if (Store.hlIn('q', qid).length) c += 'hl ';
    return `<button class="${c}" data-go="${i}" data-hlq="${esc(qid)}">${i + 1}</button>`;
  }).join('');
  // The tools (Highlight, Strike out, Clear marks, Calculator, text size) sit in the sticky sidebar on wide screens so they stay in reach while you scroll;
  // on narrow screens the sidebar is below the question, so the same row stays pinned to the top of the question instead.
  const wide = matchMedia('(min-width: 861px)').matches, toolsHtml = `<div class="marktools" role="group" aria-label="Mark up the question"><button type="button" id="mk-h" title="Highlight the selected text">Highlight</button><button type="button" id="mk-s" title="Strike out the selected text">Strike out</button><button type="button" id="mk-c" title="Remove your highlights and strikes from this question">Clear marks</button><button type="button" id="calc" aria-haspopup="dialog" aria-expanded="${CalcUI.isOpen()}" title="Open the calculator">Calculator</button><span class="sr">Select text in the question, then choose a tool. Marks last for this test.</span><span style="flex:1"></span><span class="textsize" role="group" aria-label="Text size"><button type="button" id="tx-minus" aria-label="Smaller text" title="Smaller text"${txt <= 0 ? ' disabled' : ''}>A&minus;</button><button type="button" id="tx-plus" aria-label="Larger text" title="Larger text"${txt >= 3 ? ' disabled' : ''}>A+</button></span></div>`;
  $app.innerHTML = `<div class="testlayout"><div class="testmain">
  <div class="card qcard" data-size="${txt}">
    <div class="row spread"><div>${q.boards.map(b => `<span class="tag">${esc(boardName(b))}</span>`).join('')}${isDraft(q) ? '<span class="tag draft" title="Not yet reviewed by a physician">Draft</span>' : ''}<span class="tag hltag" data-hlq="${esc(id)}" title="You have highlighted text in this question"${Store.hlIn('q', id).length ? '' : ' hidden'}>&#9998; Highlighted</span><span class="muted">${esc(q.subject)}${q.topic && shown ? ' · ' + esc(q.topic) : ''}</span></div>
      <div class="muted">Question ${t.idx + 1} of ${t.qids.length}</div></div>
    ${wide ? '' : toolsHtml}

    <p class="stem" id="stem" ${HlUI.attrs('q', id, 'stem')}>${markup(q.stem, t.marks && t.marks[id])}</p>
    ${imgTag(q)}
    <div id="opts" role="radiogroup" aria-label="Answer choices">${q.options.map(o => {
      let c = 'opt'; if (sel === o.id) c += ' sel'; if (struck.includes(o.id)) c += ' struck';
      if (shown) { if (o.id === q.answer) c += ' correct'; else if (sel === o.id) c += ' wrong'; }
      const tab = locked0 ? -1 : (sel ? (sel === o.id ? 0 : -1) : (o === q.options[0] ? 0 : -1));
      return `<div class="optrow"><div class="${c}" data-opt="${esc(o.id)}" role="radio" aria-checked="${sel === o.id}" ${locked0 ? 'aria-disabled="true"' : ''} tabindex="${tab}"><span class="k">${esc(o.id)}.</span><span class="txt"><span ${HlUI.attrs('q', id, 'opt-' + o.id)}>${esc(o.text)}</span>${struck.includes(o.id) ? '<span class="sr"> (crossed out)</span>' : ''}${shown && o.id === q.answer ? '<span class="sr"> (correct answer)</span>' : ''}</span>${shown ? pickBadge(id, o.id) : ''}</div>
        ${shown ? '' : `<button class="x" data-strike="${esc(o.id)}" aria-pressed="${struck.includes(o.id)}" aria-label="Cross out choice ${esc(o.id)}" title="Cross out">✕</button>`}</div>`;
    }).join('')}</div>
    ${shown ? explanationHtml(q, sel, true) : ''}
    <div class="row actionbar">
      ${tutor && !shown ? `<button class="primary" id="submit" ${sel ? '' : 'disabled'}>Submit</button>` : ''}
      <button id="prev" ${t.idx ? '' : 'disabled'}>← Prev</button>
      <button id="next" ${t.idx < t.qids.length - 1 ? '' : 'disabled'}>Next →</button>
      <button class="flagbtn ${st && st.flagged ? 'on' : ''}" id="flag">⚑ Flag</button>
      <button id="fbk" title="Report a problem or suggest a change to this question">✎ Feedback</button>
      <span style="flex:1"></span><button id="pause" type="button" title="Stop the clock and hide the question until you are ready">&#10074;&#10074; Pause</button><button class="danger" id="end">End test</button>
    ${mascotOn() ? `<div id="coach" class="coach"><div id="coachm"></div><button id="ram" type="button" class="ramtog" aria-pressed="${!quizMascotOn()}" title="${quizMascotOn() ? 'Hide the ram while you take tests' : 'Show the ram again'}">${quizMascotOn() ? 'Hide ram' : 'Show ram'}</button></div>` : ''}
    </div>
    <details style="margin-top:12px"><summary>Notes</summary><textarea id="note" rows="3" placeholder="Your notes on this question">${esc(st ? st.note : '')}</textarea></details>
  </div></div>
  <aside class="card navcard" aria-label="Question navigator"><h2 class="navh">Questions</h2><div class="nav">${nav}</div>
    <p class="muted small legend">${t.qids.filter(x => t.answers[x]).length} of ${t.qids.length} answered</p><div class="bar" aria-hidden="true"><i style="width:${Math.round(100 * t.qids.filter(x => t.answers[x]).length / t.qids.length)}%"></i></div>${wide ? toolsHtml.replace('class="marktools"', 'class="marktools sidetools"') : ''}</aside></div>
  <div style="height:24px"></div>`;
  let streak = 0;
  if (shown && sel === q.answer) for (let i = t.idx; i >= 0 && t.revealed[t.qids[i]] && t.answers[t.qids[i]] === bank.byId[t.qids[i]].answer; i--) streak++;
  const L = Mascot.lines;
  const coach = shown
    ? (sel === q.answer
      ? { pose: streak >= 3 ? 'cheer' : 'happy', msg: streak >= 3 ? `${streak} in a row. Nicely done.` : Mascot.pick(L.correct, id) }
      : { pose: 'sad', msg: Mascot.pick(L.wrong, id) })
    : { pose: 'idle', msg: tutor || t.idx === 0 ? Mascot.pick(L.tips, id + t.idx) : '' };
  if (quizMascotOn()) Mascot.mount(document.getElementById('coachm'), { ...coach, msg: coach.msg && esc(coach.msg).replace(/&#39;/g, "'"), scale: 3 });
  bindTest(t, q); hydrateImages(); HlUI.paintAll($app);
  if (refocus) { const f = $app.querySelector(`[data-opt="${refocus}"]`); if (f) f.focus(); refocus = null; }
}

// Highlights and strikes on the question text. Stored per question as character ranges, for the length of the test only.
function markup(text, m) {
  if (!m) return esc(text);
  const n = text.length, flag = { h: new Uint8Array(n), s: new Uint8Array(n) };
  for (const k of ['s']) (m[k] || []).forEach(([a, b]) => { for (let i = a; i < b && i < n; i++) flag[k][i] = 1; });
  let out = '', i = 0;
  while (i < n) {
    let j = i; while (j < n && flag.h[j] === flag.h[i] && flag.s[j] === flag.s[i]) j++;
    let seg = esc(text.slice(i, j)); if (flag.s[i]) seg = `<s class="mk-s">${seg}</s>`; if (flag.h[i]) seg = `<mark class="mk-h">${seg}</mark>`;
    out += seg; i = j;
  }
  return out;
}
function toggleMark(m, k, a, b, n) {   // mark a..b, or unmark it if all of it is already marked
  const f = new Uint8Array(n); (m[k] || []).forEach(([x, y]) => { for (let i = x; i < y && i < n; i++) f[i] = 1; });
  let all = true; for (let i = a; i < b; i++) if (!f[i]) all = false;
  for (let i = a; i < b; i++) f[i] = all ? 0 : 1;
  const out = []; for (let i = 0; i < n;) { if (!f[i]) { i++; continue; } let j = i; while (j < n && f[j]) j++; out.push([i, j]); i = j; }
  m[k] = out;
}
function stemRange(el) {   // the selected text as character offsets inside the question text
  const sel = getSelection(); if (!el || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0); if (r.collapsed || !el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
  const a = pre.toString().length; return [a, a + r.toString().length];
}

function elapsed(t) { return t.paused ? t.elapsed : t.elapsed + (Date.now() - t.started) / 1000; }   // a paused test's clock is stopped
function startTimer(t) {
  $timer.hidden = false;
  const u = () => { const left = t.limit - elapsed(t); $timer.textContent = '⏱ ' + fmt(left); if (left <= 0) { clearInterval(tick); finish(); } };
  u(); tick = setInterval(u, 500);
}
// A paused test: the clock is stopped and the question is hidden (so a timed test cannot be studied while the time stands still).
function pausedScreen(t) {
  pageTitle('Test paused');
  $timer.hidden = false; $timer.textContent = '\u23f8 ' + fmt(t.limit ? Math.max(0, t.limit - elapsed(t)) : elapsed(t));
  const answered = t.qids.filter(x => t.answers[x]).length;
  $app.innerHTML = `<div class="card pausecard" role="region" aria-label="Test paused"><h2>Test paused</h2>
    <p>Your clock is stopped and the question is hidden. ${t.limit ? `You have <b>${fmt(Math.max(0, t.limit - elapsed(t)))}</b> left.` : `You have used <b>${fmt(elapsed(t))}</b> so far.`}</p>
    <p class="muted">Question ${t.idx + 1} of ${t.qids.length} &middot; ${answered} answered</p>
    <div class="row"><button class="primary" id="resume" type="button">Resume</button><button class="danger" id="pend" type="button">End test</button></div></div>`;
  const resume = document.getElementById('resume'); resume.focus();
  resume.onclick = () => { t.paused = false; t.started = Date.now(); persist(t); renderTest(); };
  document.getElementById('pend').onclick = async () => {
    const left = t.qids.filter(x => !t.answers[x]).length;
    if (await ask(`End this test now? ${left ? `${left} question${left === 1 ? ' is' : 's are'} unanswered and will count as incorrect.` : 'You have answered every question.'}`, 'End test')) { t.paused = false; t.started = Date.now(); finish(); }
  };
}
function persist(t) { t.elapsed = elapsed(t); t.started = Date.now(); Store.save(); }

function bindTest(t, q) {
  const id = q.id, tutor = t.mode === 'tutor', locked = tutor && t.revealed[id];
  const go = i => { t.idx = Math.min(t.qids.length - 1, Math.max(0, i)); persist(t); renderTest(); };
  const opts = [...$app.querySelectorAll('[data-opt]')];
  opts.forEach((el, i) => {
    const pick = (keyboard, target = el) => { if (locked) return; t.answers[id] = target.dataset.opt; refocus = keyboard ? target.dataset.opt : null; persist(t); renderTest(); };
    el.onclick = () => { const sl = getSelection(); if (sl && !sl.isCollapsed && el.contains(sl.anchorNode)) return; pick(false); };   // dragging over the words to highlight them does not pick the choice
    el.onkeydown = e => {
      if (e.key === ' ') { e.preventDefault(); pick(true); }
      else if (/^Arrow(Down|Right)$/.test(e.key)) { e.preventDefault(); pick(true, opts[(i + 1) % opts.length]); }
      else if (/^Arrow(Up|Left)$/.test(e.key)) { e.preventDefault(); pick(true, opts[(i - 1 + opts.length) % opts.length]); }
    };
  });
  $app.querySelectorAll('[data-strike]').forEach(b => b.onclick = e => {
    e.stopPropagation(); const a = t.struck[id] ||= [], k = b.dataset.strike, i = a.indexOf(k); i < 0 ? a.push(k) : a.splice(i, 1); persist(t); renderTest();
    const again = $app.querySelector(`[data-strike="${k}"]`); if (again) again.focus();
  });
  let lastSel = null;
  document.onselectionchange = () => { const r = stemRange(document.getElementById('stem')); if (r) lastSel = r; };
  const applyMark = k => {
    const ms = t.marks ||= {}, stemEl = document.getElementById('stem');
    if (k === 'h') return HlUI.highlightSelected();
    if (k === 'c') { delete ms[id]; HlUI.clearIn($app, 'q', id); stemEl.innerHTML = markup(q.stem, null); HlUI.paint(stemEl); persist(t); return toast('Highlights and strike-outs cleared for this question.'); }
    const r = stemRange(stemEl) || lastSel; if (!r) return toast('Select some text in the question first.');
    toggleMark(ms[id] ||= { h: [], s: [] }, 's', r[0], Math.min(r[1], q.stem.length), q.stem.length);
    persist(t); stemEl.innerHTML = markup(q.stem, ms[id]); HlUI.paint(stemEl); getSelection().removeAllRanges(); lastSel = null;
  };
  const cb = document.getElementById('calc'); if (cb) { cb.onmousedown = ev => ev.preventDefault(); cb.onclick = () => CalcUI.toggle(cb); }
  [['mk-h', 'h'], ['mk-s', 's'], ['mk-c', 'c']].forEach(([b, k]) => { const e = document.getElementById(b); if (e) { e.onmousedown = ev => ev.preventDefault(); e.onclick = () => applyMark(k); } });
  bindZoom();
  $app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
  const on = (i, fn) => { const e = document.getElementById(i); if (e) e.onclick = fn; };
  on('prev', () => go(t.idx - 1)); on('next', () => go(t.idx + 1));
  on('submit', submit); on('flag', () => { Store.toggleFlag(id); renderTest(); });
  on('fbk', () => feedbackDialog(q));
  const size = d => { Store.data.settings.quizText = Math.min(3, Math.max(0, (+Store.data.settings.quizText || 0) + d)); Store.touchSettings(); renderTest(); const a = document.getElementById(d > 0 ? 'tx-plus' : 'tx-minus'); if (a && !a.disabled) a.focus(); };
  on('tx-minus', () => size(-1)); on('tx-plus', () => size(1));
  on('ram', () => { Store.data.settings.quizMascot = !quizMascotOn(); Store.touchSettings(); renderTest(); const again = document.getElementById('ram'); if (again) again.focus(); });
  on('pause', () => { persist(t); t.paused = true; Store.save(); renderTest(); });
  on('end', async () => {
    const left = t.qids.filter(x => !t.answers[x]).length, flagged = t.qids.filter(x => (Store.qstat(x) || {}).flagged).length;
    const msg = `End this test now? ${left ? `${left} question${left === 1 ? ' is' : 's are'} unanswered and will count as incorrect.` : 'You have answered every question.'}${flagged ? ` ${flagged} ${flagged === 1 ? 'is' : 'are'} flagged for review.` : ''}`;
    if (await ask(msg, 'End test')) finish();
  });
  document.getElementById('note').onchange = e => Store.setNote(id, e.target.value);
  function submit() {
    if (!t.answers[id] || t.revealed[id]) return;
    t.revealed[id] = true; Store.record(id, t.answers[id] === q.answer, t.answers[id]); persist(t); renderTest();
  }
  document.onkeydown = e => {
    if (location.hash !== '#/test' || /TEXTAREA|INPUT|SELECT/.test(e.target.tagName) || document.querySelector('.modal') || e.target.closest('.calc')) return;
    const k = e.key.toUpperCase();
    if ((k === 'ENTER' || k === ' ') && /^(BUTTON|A)$/.test(e.target.tagName)) return;   // a focused button or link handles its own Enter/Space
    if (k === 'ARROWRIGHT') go(t.idx + 1); else if (k === 'ARROWLEFT') go(t.idx - 1);
    else if (k === 'F') { Store.toggleFlag(id); renderTest(); }
    else if (k === 'ENTER') { if (tutor && !t.revealed[id]) submit(); else go(t.idx + 1); }
    else if (!locked) {
      const idx = /^[1-9]$/.test(k) ? +k - 1 : q.options.findIndex(o => o.id.toUpperCase() === k);
      if (q.options[idx]) { t.answers[id] = q.options[idx].id; persist(t); renderTest(); }
    }
  };
}

function finish() {
  const t = Store.data.active; if (!t) return;
  clearInterval(tick); document.onkeydown = null;
  let c = 0;
  t.qids.forEach(qid => {
    const q = bank.byId[qid], ok = t.answers[qid] === q.answer;
    if (ok) c++;
    if (!(t.mode === 'tutor' && t.revealed[qid]) && t.answers[qid]) Store.record(qid, ok, t.answers[qid]); // not yet recorded
  });
  const rec = { id: t.id, date: Date.now(), mode: t.mode, qids: t.qids, answers: t.answers, correct: c, total: t.qids.length, seconds: Math.round(elapsed(t)) };
  Store.data.active = null; Store.addTest(rec);
  location.hash = '#/results/' + rec.id;
}

// ---------- results / review / history ----------
function groupTile(r) {
  const g = r.qids.map(q => bank.peer[q]).filter(Boolean); if (!g.length) return '';
  return `<div class="stat"><b>${Math.round(g.reduce((a, x) => a + x.pct, 0) / g.length)}%</b><span class="muted">Group average on these questions (${g.length} of ${r.qids.length} have enough data)</span></div>`;
}
function results(id) {
  pageTitle('Results');
  const r = Store.data.tests.find(x => x.id === id); if (!r) return (location.hash = '#/history');
  const by = {};
  r.qids.forEach(qid => { const q = bank.byId[qid]; if (!q) return; const o = by[q.subject] ||= { c: 0, n: 0 }; o.n++; if (r.answers[qid] === q.answer) o.c++; });
  const p = pct(r.correct, r.total);
  const subj = Object.entries(by).sort((a, b) => pct(a[1].c, a[1].n) - pct(b[1].c, b[1].n) || a[0].localeCompare(b[0]));
  const weak = subj.find(([, o]) => o.c < o.n);
  const prev = Store.data.tests.filter(x => x.id !== r.id && x.date < r.date).slice(0, 5), prevAvg = prev.length ? Math.round(prev.reduce((a, x) => a + pct(x.correct, x.total), 0) / prev.length) : null;
  $app.innerHTML = `<div class="card resulthead"><div id="res-mascot"></div><h2>Results</h2><div class="resrow">
    ${ring(p)}
    <div class="grid resstats"><div class="stat"><b>${r.correct}/${r.total}</b><span class="muted">Correct</span></div>
    <div class="stat"><b>${fmt(r.seconds)}</b><span class="muted">Time</span></div>
    <div class="stat"><b>${esc(r.mode)}</b><span class="muted">Mode</span></div>
    ${prevAvg !== null ? `<div class="stat"><b>${p - prevAvg >= 0 ? '+' : '−'}${Math.abs(p - prevAvg)}</b><span class="muted">Points vs your last ${prev.length} test${prev.length === 1 ? '' : 's'}</span></div>` : ''}
    ${groupTile(r)}</div></div></div>
    <div class="card"><h3>By subject <span class="muted small">weakest first</span></h3><ul class="subjbars">${subj.map(([sname, o]) => { const v = pct(o.c, o.n); return `<li><div class="sbtop"><span>${esc(sname)}</span><span class="muted">${o.c}/${o.n} &middot; <b>${v}%</b></span></div><div class="bar sbar" aria-hidden="true"><i style="width:${v}%;background:${scoreColor(v)}"></i></div></li>`; }).join('')}</ul></div>
    <div class="row"><a class="btn primary" href="#/review/${r.id}">Review questions</a>${weak ? `<a class="btn" href="#/create/${encodeURIComponent(weak[0])}">Practice ${esc(weak[0])}</a>` : ''}<a class="btn" href="#/create">New test</a></div>`;
  if (mascotOn()) Mascot.mount(document.getElementById('res-mascot'), p >= 80 ? { pose: 'cheer', msg: 'Outstanding. That is board-ready work.' } : p >= 60 ? { pose: 'happy', msg: 'Solid work. Review the misses and go again.' } : { pose: 'sad', msg: 'Rough exercise. Review makes it stick, and I\'m with you for the next rep.' });
}

function review(id) {
  pageTitle('Review');
  const r = Store.data.tests.find(x => x.id === id); if (!r) return (location.hash = '#/history');
  $app.innerHTML = `<p><a href="#/results/${r.id}">← Results</a></p>` + r.qids.map((qid, i) => {
    const q = bank.byId[qid]; if (!q) return '';
    const mine = r.answers[qid], ok = mine === q.answer;
    return `<div class="card"><div class="muted">${i + 1}. ${esc(q.subject)} · ${esc(q.topic || '')} <span class="tag hltag" data-hlq="${esc(qid)}"${Store.hlIn('q', qid).length ? '' : ' hidden'}>&#9998; Highlighted</span> — <b style="color:var(--${ok ? 'good' : 'bad'})">${ok ? 'Correct' : mine ? 'Incorrect' : 'Unanswered'}</b></div>
      <p class="stem" ${HlUI.attrs('q', qid, 'stem')}>${esc(q.stem)}</p>
      ${q.options.map(o => `<div class="opt ${o.id === q.answer ? 'correct' : o.id === mine ? 'wrong' : ''}"><span class="k">${esc(o.id)}.</span><span class="txt"><span ${HlUI.attrs('q', qid, 'opt-' + o.id)}>${esc(o.text)}</span></span>${pickBadge(qid, o.id)}</div>`).join('')}
      ${imgTag(q)}
      ${explanationHtml(q, mine, false)}
      <div class="row" style="margin-top:10px"><button data-fb="${esc(qid)}" title="Report a problem or suggest a change to this question">✎ Feedback</button></div></div>`;
  }).join('');
  bindZoom();
  $app.querySelectorAll('[data-fb]').forEach(b => b.onclick = () => feedbackDialog(bank.byId[b.dataset.fb]));
  hydrateImages(); HlUI.paintAll($app);
}

function historyPage() {
  pageTitle('Test history');
  const T = Store.data.tests;
  $app.innerHTML = `<div class="card"><h2>Test history</h2>${T.length ? `<table><thead><tr><th>Date</th><th>Mode</th><th>Score</th><th>Time</th><th><span class="sr">Details</span></th></tr></thead><tbody>${T.map(r =>
    `<tr><td>${new Date(r.date).toLocaleString()}</td><td>${r.mode}</td><td>${r.correct}/${r.total} (${pct(r.correct, r.total)}%)</td><td>${fmt(r.seconds)}</td><td><a href="#/results/${r.id}">View</a></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No completed tests yet.</p>'}</div>`;
  labelScrolls();
}

// ---------- settings ----------
function settings() {
  pageTitle('Settings');
  const th = Store.data.settings.theme;
  $app.innerHTML = `<div class="card"><h2>Settings</h2>
    <p><label for="theme">Light or dark</label> <select id="theme" style="width:auto">${['auto', 'light', 'dark'].map(v => `<option ${v === th ? 'selected' : ''}>${v}</option>`).join('')}</select></p>
    <p>Exam date: <b>${Store.data.settings.exam && validDate(Store.data.settings.exam.date) ? esc(new Date(Store.data.settings.exam.date + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })) : 'not set'}</b> <button id="exam-set" type="button">${Store.data.settings.exam && validDate(Store.data.settings.exam.date) ? 'Change' : 'Set'}</button></p>
    <p><label for="palette">Color theme</label> <select id="palette" style="width:auto"><option value="olive"${Store.data.settings.palette !== 'navy' ? ' selected' : ''}>Olive and gold</option><option value="navy"${Store.data.settings.palette === 'navy' ? ' selected' : ''}>Navy and teal</option></select></p>
    ${!Cloud.enabled || Admin.isEditor() ? `<label class="chk"><input type="checkbox" id="drafts" ${showDrafts() ? 'checked' : ''}> Include draft questions that a physician has not yet reviewed</label>` : ''}
    <label class="chk"><input type="checkbox" id="mascot" ${mascotOn() ? 'checked' : ''}> Show the mascot and encouragement</label>
    <label class="chk"><input type="checkbox" id="quizmascot" ${Store.data.settings.quizMascot !== false ? 'checked' : ''}> Show the ram while I take a test</label></div>
    ${Cloud.enabled ? `<div class="card"><h3>Account</h3>
      <p>Signed in as <b>${esc(Cloud.session.email)}</b>${profile ? ` <span class="tag">${esc(profile.role === 'admin' ? 'Admin' : profile.role === 'reviewer' ? 'Reviewer' : profile.plan === 'pro' ? 'Member' : 'Free')}</span>` : ''}</p>
      <p class="muted" id="syncline"></p>
      <div class="row"><button id="syncnow">Sync now</button><button id="signout">Sign out</button></div></div>
    <div class="card"><h3>Your name</h3>
      <p class="muted">Optional. If you join a residency program, its faculty will see this name in place of your email. Leave it blank to show your email. Administrators can see it too.</p>
      <form id="nm-form" class="row" style="align-items:flex-end;max-width:520px"><div style="flex:1;min-width:200px"><label for="nm">Name shown to faculty</label><input id="nm" type="text" maxlength="60" autocomplete="name" value="${esc((profile && profile.display_name) || '')}" placeholder="e.g. Dr. Jane Smith"></div><button class="primary" type="submit" id="nm-go">Save name</button></form>
      <p class="notice" id="nm-msg" hidden role="alert"></p></div>
    <div id="prog-card"></div>
    <div class="card"><h3>Change password</h3>
      <form id="pw" style="max-width:380px"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password" required>
      <label for="pw-new">New password (at least 8 characters)</label><input id="pw-new" type="password" autocomplete="new-password" minlength="8" required>
      <label for="pw-new2">Type the new password again</label><input id="pw-new2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="notice" id="pw-msg" hidden role="alert"></p><div class="row" style="margin-top:12px"><button class="primary" type="submit" id="pw-go">Change password</button></div></form></div>
    <div class="card"><h3>Your data</h3><p class="muted">Your progress is saved to your account and kept on this device so the app works offline.</p>
      <div class="row"><button class="danger" id="reset">Reset all progress</button></div></div>`
    : `<div class="card"><h3>Your data</h3><p class="muted">Progress is stored only in this browser. Export a backup to move devices or avoid losing it if you clear site data.</p>
      <div class="row"><button id="exp">Export progress</button><button id="imp">Import progress</button><input type="file" id="file" accept="application/json" hidden><button class="danger" id="reset">Reset all progress</button></div></div>`}`;
  if (document.getElementById('drafts')) document.getElementById('drafts').onchange = e => { Store.data.settings.showDrafts = e.target.checked; Store.touchSettings(); };
  if (Cloud.enabled) Program.mountSettings(document.getElementById('prog-card'));
  if (document.getElementById('nm-form')) document.getElementById('nm-form').onsubmit = async e => {
    e.preventDefault(); const v = document.getElementById('nm').value.trim().replace(/\s+/g, ' '), msg = document.getElementById('nm-msg');
    if (v.length > 60) { msg.textContent = 'Please keep it to 60 characters or fewer.'; msg.hidden = false; return; }
    document.getElementById('nm-go').disabled = true; msg.hidden = true;
    try { await Cloud.setMyName(v); if (profile) profile.display_name = v || null; document.getElementById('nm').value = v; toast(v ? 'Name saved.' : 'Name cleared. Faculty will see your email.'); }
    catch (x) { msg.textContent = x.offline ? 'No connection. Nothing was saved.' : 'Could not save: ' + x.message; msg.hidden = false; }
    document.getElementById('nm-go').disabled = false;
  };
  document.getElementById('quizmascot').onchange = e => { Store.data.settings.quizMascot = e.target.checked; Store.touchSettings(); };
  document.getElementById('mascot').onchange = e => { Store.data.settings.mascot = e.target.checked; Store.save(); };
  document.getElementById('exam-set').onclick = examDialog;
  document.getElementById('palette').onchange = e => { Store.data.settings.palette = e.target.value === 'navy' ? 'navy' : 'olive'; Store.touchSettings(); applyTheme(); };
  document.getElementById('theme').onchange = e => { Store.data.settings.theme = e.target.value; Store.touchSettings(); applyTheme(); };
  if (!Cloud.enabled) {
    document.getElementById('exp').onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([Store.exportJSON()], { type: 'application/json' }));
      a.download = 'qbank-progress-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    };
    document.getElementById('imp').onclick = () => document.getElementById('file').click();
    document.getElementById('file').onchange = async e => {
      try { Store.importJSON(await e.target.files[0].text()); applyTheme(); await ask('Progress imported.', 'OK', null); location.hash = '#/'; } catch (err) { ask('Import failed: ' + err.message, 'OK', null); }
    };
  } else {
    const line = document.getElementById('syncline');
    const paint = () => { const n = Cloud.pending(); line.textContent = n ? `${n} change${n > 1 ? 's' : ''} waiting to sync.` : (Cloud.lastSync ? 'All changes synced.' : 'Signed in.'); };
    paint();
    document.getElementById('syncnow').onclick = async () => { line.textContent = 'Syncing...'; try { await Cloud.sync(); } catch (e) { toast(e.offline ? 'No connection. Your changes are saved on this device.' : 'Could not sync. Try again shortly.'); } paint(); };
    document.getElementById('signout').onclick = () => signOut();
    document.getElementById('pw').onsubmit = async e => {
      e.preventDefault(); const msg = document.getElementById('pw-msg'), go = document.getElementById('pw-go');
      const cur = document.getElementById('pw-cur').value, n1 = document.getElementById('pw-new').value, n2 = document.getElementById('pw-new2').value;
      const say = t => { msg.textContent = t; msg.hidden = false; };
      if (n1 !== n2) return say('The two new passwords do not match.');
      if (n1 === cur) return say('Choose a password that is different from your current one.');
      go.disabled = true; msg.hidden = true;
      try { await Cloud.changePassword(cur, n1); e.target.reset(); toast('Password changed.'); } catch (x) { say(x.message); }
      go.disabled = false;
    };
  }
  document.getElementById('reset').onclick = async () => { if (await ask('Delete ALL progress? This cannot be undone.', 'Delete everything')) { Store.reset(); location.hash = '#/'; route(); } };
}

// ---------- accounts ----------
function lockUI(on) { document.body.classList.toggle('locked', on); if (on) { $timer.hidden = true; clearInterval(tick); Mascot.stop(); } }

function renderSignIn(note = '') {
  pageTitle('Sign in');
  ready = false; lockUI(true);
  $app.innerHTML = `<div class="card signin"><div class="signin-brand"><img class="logo" src="icons/logo.svg" alt="" width="44" height="44"><span class="wordmark big">AeroMed<b>QBank</b></span></div><h2>Sign in</h2>${note ? `<p class="notice">${esc(note)}</p>` : ''}
    <form id="si"><label for="si-email">Email</label><input id="si-email" type="email" autocomplete="username" required>
    <label for="si-pw">Password</label><input id="si-pw" type="password" autocomplete="current-password" required>
    <p class="notice" id="si-err" hidden></p>
    <div class="row"><button class="primary" type="submit" id="si-go">Sign in</button><button type="button" class="linkish" id="si-forgot">Forgot password?</button></div></form>
    <p class="muted" id="si-foot">Ask your program lead if you need an account. By signing in you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a> and <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p></div>`;
  const err = document.getElementById('si-err'), go = document.getElementById('si-go');
  const fail = m => { err.textContent = m; err.hidden = false; go.disabled = false; };
  document.getElementById('si').onsubmit = async e => {
    e.preventDefault(); err.hidden = true; go.disabled = true;
    try { await Cloud.signIn(document.getElementById('si-email').value.trim(), document.getElementById('si-pw').value); await startSession(); }
    catch (x) { fail(x.message); }
  };
  Cloud.signupOpen().then(open => {                       // the admin can switch self sign-up on or off
    const foot = document.getElementById('si-foot'); if (!open || !foot) return;
    foot.innerHTML = 'New here? <button type="button" class="linkish" id="si-new">Create a free account</button>. By signing in or creating an account you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a> and <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.';
    document.getElementById('si-new').onclick = () => renderSignUp();
  });
  document.getElementById('si-forgot').onclick = async () => {
    const em = document.getElementById('si-email').value.trim();
    if (!em) { fail('Type your email above first, then choose Forgot password.'); return document.getElementById('si-email').focus(); }
    try { await Cloud.recover(em); err.hidden = false; err.textContent = 'If that email has an account, a reset link is on its way. It can take a few minutes.'; }
    catch (x) { fail(x.message); }
  };
}

function renderSignUp() {
  pageTitle('Create an account');
  ready = false; lockUI(true);
  $app.innerHTML = `<div class="card signin"><div class="signin-brand"><img class="logo" src="icons/logo.svg" alt="" width="44" height="44"><span class="wordmark big">AeroMed<b>QBank</b></span></div><h2>Create a free account</h2>
    <form id="su"><label for="su-email">Email</label><input id="su-email" type="email" autocomplete="username" required>
    <label for="su-pw">Password (at least 8 characters)</label><input id="su-pw" type="password" autocomplete="new-password" minlength="8" required>
    <label for="su-pw2">Type the password again</label><input id="su-pw2" type="password" autocomplete="new-password" minlength="8" required>
    <div id="su-prog" hidden><label for="su-pick">Residency program (optional)</label><select id="su-pick"><option value="">I am not in a program / not listed</option></select>
      <p class="muted small">${esc(Program.NOTICE)} Faculty must approve you first.</p></div>
    <p class="notice" id="su-err" hidden role="alert"></p>
    <div class="row"><button class="primary" type="submit" id="su-go">Create account</button><button type="button" class="linkish" id="su-back">Back to sign in</button></div></form>
    <p class="muted">By creating an account you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a> and <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>. Free accounts include the free questions. Your program lead can upgrade you.</p></div>`;
  const err = document.getElementById('su-err'), go = document.getElementById('su-go');
  const fail = m => { err.textContent = m; err.hidden = false; go.disabled = false; };
  Cloud.programs().then(list => { const box = document.getElementById('su-prog'); if (!list.length || !box) return; document.getElementById('su-pick').insertAdjacentHTML('beforeend', Program.options(list, '')); box.hidden = false; });
  document.getElementById('su-back').onclick = () => renderSignIn();
  document.getElementById('su').onsubmit = async e => {
    e.preventDefault(); err.hidden = true;
    const email = document.getElementById('su-email').value.trim(), a = document.getElementById('su-pw').value, b = document.getElementById('su-pw2').value;
    if (a !== b) return fail('The two passwords do not match.');
    go.disabled = true;
    try {
      const r = await Cloud.signUp(email, a, (document.getElementById('su-pick') || {}).value || '');
      if (r.signedIn) return await startSession();
      $app.innerHTML = '<div class="card signin"><h2>Check your email</h2><p>We sent a link to confirm your address. Open it, then come back and sign in.</p><div class="row"><button class="primary" id="su-ok">Go to sign in</button></div></div>';
      document.getElementById('su-ok').onclick = () => renderSignIn();
    } catch (x) { fail(x.message); }
  };
}

function renderSetPassword(kind) {
  pageTitle('Choose a password');
  ready = false; lockUI(true);
  $app.innerHTML = `<div class="card signin"><h2>${kind === 'invite' || kind === 'temp' ? 'Welcome. Choose your own password' : 'Choose a new password'}</h2>${kind === 'temp' ? '<p class="muted">You signed in with a temporary password. Choose one only you know.</p>' : ''}
    <form id="sp"><label for="sp-1">New password (at least 8 characters)</label><input id="sp-1" type="password" autocomplete="new-password" minlength="8" required>
    <label for="sp-2">Type it again</label><input id="sp-2" type="password" autocomplete="new-password" minlength="8" required>
    <p class="notice" id="sp-err" hidden></p><div class="row"><button class="primary" type="submit" id="sp-go">Save password</button></div></form></div>`;
  document.getElementById('sp').onsubmit = async e => {
    e.preventDefault(); const err = document.getElementById('sp-err'), go = document.getElementById('sp-go');
    const a = document.getElementById('sp-1').value, b = document.getElementById('sp-2').value;
    if (a !== b) { err.textContent = 'The two passwords do not match.'; err.hidden = false; return; }
    go.disabled = true;
    try { await (kind === 'temp' ? Cloud.choosePassword(a) : Cloud.setPassword(a)); await startSession(); } catch (x) { err.textContent = x.message; err.hidden = false; go.disabled = false; }
  };
}

function renderBlocked(email) {
  pageTitle('Account not active');
  ready = false; lockUI(true);
  $app.innerHTML = `<div class="card signin"><h2>Account not active yet</h2>
    <p>You are signed in as <b>${esc(email)}</b>, but this email has not been approved for access.</p>
    <p class="muted">Ask your program lead to add it to the approved list, then choose Check again.</p>
    <div class="row"><button class="primary" id="again">Check again</button><button id="bo">Sign out</button></div></div>`;
  document.getElementById('again').onclick = () => startSession();
  document.getElementById('bo').onclick = () => signOut();
}

let badgeTimer = null;
async function refreshInboxBadge() {                       // red numbers on the menu: new messages for the team, new replies for a member
  if (!Cloud.enabled || !profile) return;
  const put = (id, n, word) => { const b = document.getElementById(id); if (b) { b.hidden = !n; b.innerHTML = n ? `<span aria-hidden="true">${n > 99 ? '99+' : n}</span><span class="sr"> ${n} ${word}${n === 1 ? '' : 's'}</span>` : ''; } };
  if (Admin.isEditor()) { const n = await Cloud.unreadFeedback(); Admin.unread = n; put('inbox-badge', n, 'new message'); }
  const before = bank.unreadReplies || 0, r = await Cloud.myUnreadReplies(); bank.unreadReplies = r; put('support-badge', r, 'new reply');
  if (r !== before && ready && !Store.data.active && /^#?\/?$/.test(location.hash)) route();       // refresh the dashboard notice
}
async function startSession() {
  ready = false; lockUI(true);
  $app.innerHTML = '<div class="card"><p class="muted">Loading your questions...</p></div>';
  if (Cloud.mustChangePassword) return renderSetPassword('temp');
  try {
    Store.use(Cloud.userKey()); applyTheme();
    profile = await Cloud.profile();
    if (!profile || !profile.active) return renderBlocked(Cloud.session.email);
    setQuestions(await Cloud.questions());
    bank.lessons = await Cloud.lessons().catch(() => []);
    await loadCards();
    bank.peer = await Cloud.peerStats(); bank.choices = await Cloud.peerChoices(); peerAt = Date.now();
    bank.program = await Cloud.myProgram();
    Cloud.prefetchImages(bank.questions.filter(privImg).map(privImg));   // in the background, so pictures also work offline
  } catch (e) {
    if (e.auth) return renderSignIn('Please sign in again.');
    $app.innerHTML = `<div class="card"><b>Could not load your questions.</b><p class="muted">${e.offline ? 'You are offline and this device has no saved copy yet. Connect once to download them.' : esc(e.message)}</p><button class="primary" id="retry">Try again</button> <button id="bo">Sign out</button></div>`;
    document.getElementById('retry').onclick = () => startSession(); document.getElementById('bo').onclick = () => signOut();
    return;
  }
  Store.hooks.attempt = (id, ok, chosen) => Cloud.queueAttempt(id, ok, chosen);
  Store.hooks.mark = id => Cloud.queueMark(id);
  Store.hooks.test = rec => Cloud.queueTest(rec);
  Store.hooks.settings = () => Cloud.queueSettings();
  Store.hooks.reset = () => Cloud.queueReset();
  Store.hooks.card = (id, st) => Cloud.queueCard(id, st);
  Store.hooks.hl = id => Cloud.queueHl(id);
  Store.hooks.mine = id => Cloud.queueMine(id);
  lockUI(false); ready = true;
  document.getElementById('nav-program').hidden = profile.role !== 'faculty';
  document.getElementById('nav-support').hidden = false;
  clearInterval(badgeTimer);
  const navAdmin = document.getElementById('nav-admin');
  navAdmin.hidden = !Admin.isEditor(); navAdmin.innerHTML = (profile.role === 'admin' ? 'Admin' : 'Questions') + '<span id="inbox-badge" class="navbadge" hidden></span>'; navAdmin.setAttribute('href', profile.role === 'admin' ? '#/admin' : '#/admin/questions');
  refreshInboxBadge(); badgeTimer = setInterval(refreshInboxBadge, 120000);
  if (!/^#\/[a-z]/.test(location.hash)) location.hash = '#/';       // keep a deep link (a lesson opened in a new tab, a bookmark, a reload); anything else, such as a reset-password token, goes to the dashboard
  route();
  Cloud.sync().then(() => { applyTheme(); if (ready && !Store.data.active && /^#?\/?$/.test(location.hash)) route(); }).catch(() => {});
}

async function signOut() {
  if (Cloud.pending()) {
    try { await Cloud.sync(); } catch {}
    if (Cloud.pending() && !(await ask(`${Cloud.pending()} change(s) have not synced yet and will be lost if you sign out now.`, 'Sign out anyway'))) return;
  }
  const key = Cloud.userKey();
  await Cloud.signOut(); Store.forget(key);
  ['attempt', 'mark', 'test', 'settings', 'reset', 'card', 'hl', 'mine'].forEach(k => delete Store.hooks[k]);
  profile = null; ready = false; Store.use('qbank.v1.signedout'); applyTheme();
  location.hash = '#/';                       // signing out clears the page, so the next person starts at the dashboard
  renderSignIn();
}

async function adminPage() {
  pageTitle('Admin');
  if (!profile || profile.role !== 'admin') { $app.innerHTML = '<div class="card"><h2>Admin</h2><p class="muted">This page is for administrators.</p></div>'; return; }
  $app.innerHTML = '<div class="card"><p class="muted">Loading the group summary...</p></div>';
  try {
    const [mem, qs, allowed, signupOn, peerMin] = await Promise.all([Cloud.rpc('admin_member_summary'), Cloud.rpc('admin_question_stats'), Cloud.rest('allowed_emails?select=*&order=email.asc'), Cloud.signupOpen(), Cloud.peerMin().catch(() => 10)]);
    const programs = await Cloud.adminPrograms().catch(() => []);
    const act = mem.filter(m => m.active), tot = act.reduce((x, m) => x + m.attempts, 0), cor = act.reduce((x, m) => x + m.correct, 0);
    const HARD_BELOW = 70, hard = qs.filter(q => !q.archived && q.attempts >= 3 && q.pct_correct < HARD_BELOW).sort((x, y) => x.pct_correct - y.pct_correct || y.attempts - x.attempts).slice(0, 15);   // only questions that really are hard, not just the lowest few
    const me = Cloud.session.email.toLowerCase();
    $app.innerHTML = `${Admin.tabs('overview')}<div class="grid">
      <div class="card stat"><b>${act.length}</b><span>Active members</span></div><div class="card stat"><b>${tot}</b><span>Questions answered</span></div>
      <div class="card stat"><b>${tot ? pct(cor, tot) + '%' : '-'}</b><span>Group correct</span></div><div class="card stat"><b>${qs.length}</b><span>Questions in bank</span></div></div>
      <div class="card"><div class="row spread"><h2 style="margin:0">Members</h2><button id="csv">Download CSV</button></div>
        <div class="scroll" role="region" tabindex="0" aria-label="Data table"><table><caption class="sr">Members and their activity</caption><thead><tr><th scope="col">Email</th><th scope="col">Access</th><th scope="col">Answered</th><th scope="col">Correct</th><th scope="col">Last active</th></tr></thead><tbody>${mem.map(m =>
        `<tr><td>${esc(m.email)}${m.display_name ? `<div class="muted small">${esc(m.display_name)}</div>` : ''}</td><td>${m.active ? esc(m.role === 'admin' ? 'Admin' : m.role === 'reviewer' ? 'Reviewer' : m.role === 'faculty' ? 'Faculty' : m.plan) : 'Not approved'}</td><td>${m.attempts}</td><td>${m.attempts ? pct(m.correct, m.attempts) + '%' : '-'}</td><td>${m.last_active ? new Date(m.last_active).toLocaleDateString() : '-'}</td></tr>`).join('')}</tbody></table></div></div>
      <div id="prog-admin"></div>
      <div class="card"><h2>Group averages</h2>
        <form id="peerf" class="row" style="align-items:flex-end"><div><label for="pm">Show a group average once this many members have answered a question</label><input id="pm" type="number" min="5" max="1000" value="${peerMin}"></div><button class="primary" type="submit">Save</button></form>
        <p class="muted">Members then see "72% of members answered this correctly" after they answer, in their results and in the subject table. Each member's first try counts. Nothing is shown for fewer than 5 people, so no one can be singled out.</p>
        <p class="notice" id="pm-msg" hidden role="alert"></p></div>
      <div class="card"><h2>Sign-up</h2><label class="chk"><input type="checkbox" id="su-open"${signupOn ? ' checked' : ''}> Let anyone create a free account on the sign-in page</label>
        <p class="muted">Anyone who signs up gets a <b>free</b> member account at once and appears in the list below, so you can upgrade or remove them. Free accounts only see questions set to <b>Free members too</b>; questions set to Pro members stay private. Turn this off to make the site invitation-only.</p></div>
      <div class="card"><h2>Approved emails</h2>
        <p class="muted">Only these emails can use the app. <b>Reviewers</b> can edit and review questions but cannot see members. <b>Add member</b> approves the email and creates their account with a temporary password for you to send them privately; they choose their own password the first time they sign in. Removing an email locks that person out at once.</p>
        <div class="scroll" role="region" tabindex="0" aria-label="Data table"><table><caption class="sr">Approved emails</caption><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Plan</th><th scope="col">Note</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody id="al">${allowed.map(r =>
        `<tr><td>${esc(r.email)}</td><td>${esc(r.role)}</td><td>${esc(r.plan)}</td><td>${esc(r.note || '')}</td>
        <td>${r.email === me ? '<span class="muted">you</span>' : `<button data-edit="${esc(r.email)}" aria-label="Edit ${esc(r.email)}">Edit</button> <button data-reset="${esc(r.email)}" aria-label="Reset password for ${esc(r.email)}">Reset password</button> <button data-rm="${esc(r.email)}" aria-label="Remove ${esc(r.email)}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div>
        <form id="addem" class="row" style="margin-top:12px;align-items:flex-end"><div><label for="ae-email">Email</label><input id="ae-email" type="email" required autocomplete="off"></div>
          <div><label for="ae-role">Role</label><select id="ae-role"><option>member</option><option>reviewer</option><option>faculty</option><option>admin</option></select></div>
          ${programs.length ? `<div><label for="ae-prog">Program</label><select id="ae-prog"><option value="">None</option>${Program.options(programs, '')}</select></div>` : ''}
          <div><label for="ae-plan">Plan</label><select id="ae-plan"><option>pro</option><option>free</option></select></div>
          <div><label for="ae-note">Note</label><input id="ae-note" type="text" maxlength="80" autocomplete="off"></div><button class="primary" type="submit">Add member</button></form>
        <p class="notice" id="ae-msg" hidden role="alert"></p></div>
      <div class="card"><h2>Hardest questions</h2><p class="muted">Questions under ${HARD_BELOW}% correct with at least 3 answers (all tries). For first-try difficulty and what to fix, open <a href="#/admin/questions">Questions</a>.</p>${hard.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Data table"><table><caption class="sr">Questions with the lowest percent correct</caption><thead><tr><th scope="col">Question</th><th scope="col">Subject</th><th scope="col">Answered</th><th scope="col">Correct</th></tr></thead><tbody>${hard.map(q =>
        `<tr><td>${esc(q.question_id)}</td><td>${esc(q.subject)}</td><td>${q.attempts}</td><td>${Math.round(q.pct_correct)}%</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${qs.some(q => q.attempts >= 3) ? `No question is under ${HARD_BELOW}% correct right now.` : 'Shows up once questions have been answered at least 3 times.'}</p>`}</div>`;
    labelScrolls();
    const say = t => { const m = document.getElementById('ae-msg'); m.textContent = t; m.hidden = !t; };
    const upsert = row => Cloud.rest('allowed_emails?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [row] });
    document.getElementById('csv').onclick = () => {
      const rows = [['email', 'role', 'plan', 'approved', 'answered', 'correct', 'percent_correct', 'last_active'], ...mem.map(m => [m.email, m.role, m.plan, m.active ? 'yes' : 'no', m.attempts, m.correct, m.attempts ? pct(m.correct, m.attempts) : '', m.last_active || ''])];
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' }));
      link.download = 'ramqbank-members-' + new Date().toISOString().slice(0, 10) + '.csv'; link.click();
    };
    document.getElementById('addem').onsubmit = async e => {
      e.preventDefault(); say('');
      const email = document.getElementById('ae-email').value.trim().toLowerCase(), role = document.getElementById('ae-role').value;
      if (email === me && role !== 'admin') return say('You cannot take away your own admin access.');
      const plan = document.getElementById('ae-plan').value, note = document.getElementById('ae-note').value.trim() || null, program_id = (document.getElementById('ae-prog') || {}).value || null;
      if (role === 'faculty' && !program_id) return say('Faculty need a program. Add one under Residency programs first, then choose it here.');
      try {
        try { const r = await Cloud.manageMember('create', { email, role, plan, note, program_id }); await showCredentials(r); adminPage(); return; }
        catch (x) {
          if (!x.notDeployed) throw x;
          await upsert(program_id ? { email, role, plan, note, program_id } : { email, role, plan, note }); adminPage();          // account tools not deployed: fall back to approving only
          toast(`Approved ${email}. Creating the account itself still needs Supabase (see the setup guide, step 4).`);
        }
      } catch (x) { say(x.offline ? 'No connection.' : 'Could not add: ' + x.message); }
    };
    $app.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
      const em = b.dataset.reset; if (!(await ask(`Make a new temporary password for ${em}? Their old password stops working.`, 'Reset password'))) return;
      try { await showCredentials(await Cloud.manageMember('reset', { email: em })); }
      catch (x) { say(x.notDeployed ? 'Account tools are not set up yet (see the setup guide).' : x.offline ? 'No connection.' : x.message); }
    });
    $app.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const em = b.dataset.rm; if (!(await ask(`Remove ${em}? They will be locked out immediately. Their saved progress is kept.`, 'Remove'))) return;
      try { await Cloud.rest('allowed_emails?email=eq.' + encodeURIComponent(em), { method: 'DELETE' }); toast('Removed ' + em); adminPage(); } catch (x) { say('Could not remove: ' + x.message); }
    });
    Program.mountAdmin(document.getElementById('prog-admin'), mem);
    document.getElementById('peerf').onsubmit = async e => {
      e.preventDefault(); const m = document.getElementById('pm-msg'); m.hidden = true;
      try { await Cloud.setPeerMin(parseInt(document.getElementById('pm').value, 10)); toast('Saved.'); }
      catch (x) { m.textContent = x.offline ? 'No connection.' : /from 5 to 1000/.test(x.message) ? 'Choose a number from 5 to 1000.' : 'Could not save: ' + x.message; m.hidden = false; }
    };
    document.getElementById('su-open').onchange = async e => {
      try { await Cloud.setSignupOpen(e.target.checked); toast(e.target.checked ? 'Anyone can now create a free account.' : 'Sign-up is closed. Only people you add can get in.'); }
      catch (x) { e.target.checked = !e.target.checked; say('Could not change: ' + (x.offline ? 'no connection' : x.message)); }
    };
    $app.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editMember(allowed.find(x => x.email === b.dataset.edit), say, programs));
  } catch (e) { $app.innerHTML = `<div class="card"><h2>Admin</h2><p class="muted">Could not load: ${esc(e.message)}</p></div>`; }
}

// Shows a new temporary password once, with a ready-to-send message.
function showCredentials(r) {
  return new Promise(res => {
    const site = location.href.split('#')[0].replace(/index\.html$/, '');
    const msg = r.existed ? `You have been approved for AeroMedQBank. Sign in here with your existing password: ${site}`
      : `Your AeroMedQBank account is ready.\nWebsite: ${site}\nEmail: ${r.email}\nTemporary password: ${r.password}\nYou will be asked to choose your own password when you first sign in.`;
    const d = document.createElement('div'); d.className = 'modal';
    d.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="cr-h" style="max-width:480px"><h3 id="cr-h" style="margin-top:0">${r.existed ? 'Already has an account' : 'Account ready'}</h3>
      <p>${r.existed ? esc(r.email) + ' already has an account. They are approved now and can sign in with their current password.' : `Send this to <b>${esc(r.email)}</b> privately (not in a group chat). <b>The password is shown only now.</b> If it is lost, use Reset password.`}</p>
      <label for="cr-msg">Message</label><textarea id="cr-msg" rows="6" readonly>${esc(msg)}</textarea>
      <div class="row" style="margin-top:12px"><button class="primary" id="cr-copy">Copy message</button><button id="cr-done">Done</button></div></div>`;
    document.body.appendChild(d);
    const close = () => { d.remove(); res(); };
    d.querySelector('#cr-done').onclick = close;
    d.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    d.querySelector('#cr-copy').onclick = async () => { try { await navigator.clipboard.writeText(msg); toast('Copied.'); } catch { const t = d.querySelector('#cr-msg'); t.select(); toast('Select the text and copy it.'); } };
    d.querySelector('#cr-copy').focus();
  });
}

// Edit a person's role, plan and note, or delete the account completely.
function editMember(r, say, programs = []) {
  const d = document.createElement('div'); d.className = 'modal';
  d.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="ed-h" style="max-width:460px"><h3 id="ed-h" style="margin-top:0">Edit ${esc(r.email)}</h3>
    <form id="ed"><label for="ed-role">Role</label><select id="ed-role">${['member', 'reviewer', 'faculty', 'admin'].map(v => `<option${v === r.role ? ' selected' : ''}>${v}</option>`).join('')}</select>
      ${programs.length ? `<label for="ed-prog">Program</label><select id="ed-prog"><option value="">None</option>${Program.options(programs, r.program_id || '')}</select>` : ''}
      <label for="ed-plan">Plan</label><select id="ed-plan">${['pro', 'free'].map(v => `<option${v === r.plan ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label for="ed-note">Note</label><input id="ed-note" type="text" maxlength="80" value="${esc(r.note || '')}" autocomplete="off">
      <p class="hint">Email addresses cannot be changed. To move someone to a new address, add the new one and remove the old one.</p>
      <div class="row" style="margin-top:12px"><button class="primary" type="submit" id="ed-save">Save</button><button type="button" id="ed-cancel">Cancel</button><span style="flex:1"></span><button type="button" class="danger" id="ed-del">Delete account</button></div></form></div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.querySelector('#ed-cancel').onclick = close;
  d.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  d.querySelector('#ed-role').focus();
  d.querySelector('#ed').onsubmit = async e => {
    e.preventDefault();
    const row = { email: r.email, role: d.querySelector('#ed-role').value, plan: d.querySelector('#ed-plan').value, note: d.querySelector('#ed-note').value.trim() || null };
    if (d.querySelector('#ed-prog')) row.program_id = d.querySelector('#ed-prog').value || null;
    if (row.role === 'faculty' && !row.program_id) { close(); return say('Faculty need a program. Edit again and choose one.'); }
    try { await Cloud.rest('allowed_emails?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [row] }); close(); toast('Saved.'); adminPage(); }
    catch (x) { close(); say(x.offline ? 'No connection.' : 'Could not save: ' + x.message); }
  };
  d.querySelector('#ed-del').onclick = async () => {
    close();
    if (!(await Admin.askText(`Permanently delete the account for ${r.email}? This erases the login and all of their answers, flags, notes and test history. It cannot be undone. To only lock them out and keep their history, use Remove instead.`, 'DELETE', 'Delete account'))) return;
    try { await Cloud.manageMember('delete', { email: r.email }); toast('Deleted ' + r.email); adminPage(); }
    catch (x) { say(x.notDeployed ? 'Account tools are not set up yet (see the setup guide, step 4A). You can still use Remove to lock them out.' : x.offline ? 'No connection.' : x.message); }
  };
}

// ---------- boot ----------
async function boot() {
  applyTheme();
  try {
    const files = await loadMeta();
    if (window.__QBANK_DATA) { setQuestions(files); ready = true; return route(); }          // single-file preview
    Cloud.init(bank.config.supabase);
    if (!Cloud.enabled) { await loadStatic(files); ready = true; return route(); }          // demo mode: no accounts
    Cloud.onAuthLost(() => renderSignIn('Your session ended. Please sign in again.'));
    const link = Cloud.consumeLink();
    if (link && link.error) return renderSignIn(link.error);
    if (link && (link.type === 'recovery' || link.type === 'invite')) return renderSetPassword(link.type);
    if (!Cloud.session) return renderSignIn();
    await startSession();
  } catch (e) { $app.innerHTML = `<div class="card"><b>Could not load.</b><p class="muted">${esc(e.message)}. If you opened this file directly, serve it over http (e.g. <code>python3 -m http.server</code>) or use GitHub Pages.</p></div>`; }
}
boot();
if ('serviceWorker' in navigator && !window.__QBANK_DATA && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
