'use strict';
const $app = document.getElementById('app'), $timer = document.getElementById('timer');
let bank = { boards: [], subjects: {}, questions: [], byId: {}, config: {}, lessons: [], lessonFiles: [], peer: {}, choices: {}, program: null };
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
const showDrafts = () => Store.data.settings.showDrafts !== false;
const notesText = q => q.optionNotes ? '\n\nAnswer choices:\n' + q.options.filter(o => q.optionNotes[o.id]).map(o => esc(`${o.id}. ${q.optionNotes[o.id]}`)).join('\n') : '';
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
  const t = Store.data.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

// Boards and subjects are not sensitive, so they always come from the static manifest. Questions come from the
// private database in cloud mode, or from the static files (the pilot/demo mode) when accounts are not configured.
async function loadMeta() {
  if (window.__QBANK_DATA) { const m = window.__QBANK_DATA; bank.config = m.config || {}; bank.boards = m.boards; bank.subjects = m.subjects; bank.lessons = m.lessons || []; return m.questions; }
  const base = 'data/';
  const m = await (await fetch(base + 'manifest.json')).json();
  bank.config = await fetch(base + 'config.json').then(r => r.json()).catch(() => ({}));
  bank.boards = m.boards; bank.subjects = m.subjects; bank.lessonFiles = m.lessons || [];
  return m.files;
}
async function loadStatic(files) {
  const lists = Array.isArray(files) && typeof files[0] === 'object' ? [files] : await Promise.all(files.map(f => fetch('data/' + f).then(r => r.json())));
  setQuestions(lists.flat());
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

// ---------- router ----------
async function route() {
  clearInterval(tick); $timer.hidden = true; Mascot.stop();
  if (Cloud.enabled && !ready) return;
  const [p, arg, arg2, arg3] = location.hash.replace(/^#\/?/, '').split('/');
  if (Cloud.enabled && p !== 'admin' && Admin.changed) {      // questions were edited on the Admin pages; load the new set before practising
    Admin.changed = false;
    try { setQuestions(await Cloud.questions()); bank.lessons = await Cloud.lessons(); } catch {}
    if (location.hash.replace(/^#\/?/, '').split('/')[0] !== p) return;   // the person moved on while it loaded
  }
  document.querySelectorAll('nav a').forEach(l => l.classList.toggle('on', l.getAttribute('href').split('/').slice(0, 2).join('/') === '#/' + (p === 'test' ? 'create' : p === 'lesson' ? 'lessons' : p === 'results' || p === 'review' ? 'history' : p)));
  if (p === '' || p === 'results') refreshPeer();
  const t = Store.data.active;
  if (p === 'test' && t) return renderTest();
  ({ '': dashboard, create: () => create(arg, arg2), flagged: flaggedPage, program: () => Program.facultyPage(), support: () => Support.page(arg), lessons: () => (arg ? Lessons.subjectPage(arg) : Lessons.indexPage()), lesson: () => Lessons.lessonPage(arg), history: historyPage, settings, admin: () => Admin.route(arg, arg2, arg3), results: () => results(arg), review: () => review(arg) }[p] || dashboard)();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- dashboard ----------
// "Focus areas": the member's weakest subjects (lowest percent correct, at least MIN answers), with the lessons for each and
// a one-click practice of the questions they missed in it.
const FOCUS_MIN = 5, FOCUS_BELOW = 80, FOCUS_SHOW = 3;
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
  } else if (Object.values(by).some(o => o.right + o.wrong >= FOCUS_MIN)) body = '<p class="muted">No weak spots right now: every subject you have practised is at 80% or better. Keep going.</p>';
  else {                                                     // not enough answers yet: show the feature and how close they are
    const most = Math.max(0, ...Object.values(by).map(o => o.right + o.wrong)), need = FOCUS_MIN - most;
    body = `<p><b>Need ${need} more question${need === 1 ? '' : 's'}</b> in one subject until your focus areas appear.</p>
      <div class="bar" role="progressbar" aria-label="Progress toward focus areas" aria-valuemin="0" aria-valuemax="${FOCUS_MIN}" aria-valuenow="${most}"><i style="width:${pct(most, FOCUS_MIN)}%"></i></div>
      <p class="muted small" style="margin-top:8px">Once you have answered ${FOCUS_MIN} questions in a subject, this section shows your weakest subjects, the topics you miss most, and the lessons to review, with a button to practice the questions you missed.</p>`;
  }
  return `<div class="card" id="focus"><h2>Focus areas</h2>${body}</div>`;
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
  ${active ? `<div class="card row spread"><div><b>Test in progress</b> <span class="muted">(${Object.keys(active.answers).length}/${active.qids.length} answered)</span></div><a class="btn primary" href="#/test">Resume</a></div>` : ''}
  <div class="grid">
    <div class="card stat"><b>${bank.questions.length}</b><span class="muted">Questions in bank</span></div>
    <div class="card stat"><b>${used}</b><span class="muted">Used (${pct(used, bank.questions.length)}%)</span></div>
    <div class="card stat"><b>${c + w ? pct(c, c + w) + '%' : '—'}</b><span class="muted">Overall correct</span></div>
    ${all.some(s => s.flagged) ? `<a class="card stat statlink" href="#/flagged"><b>${all.filter(s => s.flagged).length}</b><span class="muted">Flagged &rsaquo; review</span></a>` : `<div class="card stat"><b>0</b><span class="muted">Flagged</span></div>`}
  </div>
  ${focusAreas()}
  <div class="card"><h2>Performance by subject</h2>
    ${rows.length ? `<table><thead><tr><th>Board</th><th>Subject</th><th>Used</th><th>Correct</th><th title="Average of all members, first tries">Group</th><th><span class="sr">Progress</span></th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="muted">No questions loaded.</p>'}
  </div>
  `;
  document.getElementById('cover-text').innerHTML = `<h2 class="pagetitle">Dashboard</h2><p>${esc(headline)}</p><a class="btn primary" href="#/create">Create a new test</a>`;
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
  const subjBoxes = subjects.map(s => `<label class="chk"><input type="checkbox" name="subj" value="${esc(s)}" checked> ${esc(s)} <span class="cnt" data-cnt="subj:${esc(s)}"></span></label>`).join('');
  $app.innerHTML = `<div class="card"><h2>New test</h2><form id="f">
    <fieldset><legend>Mode</legend>
      <label class="chk"><input type="radio" name="mode" value="tutor" checked> Tutor (feedback after each question)</label>
      <label class="chk"><input type="radio" name="mode" value="timed"> Timed (feedback at the end, ~90 s/question)</label></fieldset>
    <fieldset><legend>Board</legend>${boardBoxes}</fieldset>
    <fieldset><legend>Subjects</legend><div class="row"><button type="button" id="all">All</button><button type="button" id="none">None</button></div>${subjBoxes}</fieldset>
    <fieldset><legend>Question status</legend>
      ${[['unused', 'Unused'], ['incorrect', 'Previously incorrect'], ['flagged', 'Flagged'], ['all', 'All']].map(([v, l], i) => `<label class="chk"><input type="checkbox" name="status" value="${v}" ${i == 0 ? 'checked' : ''}> ${l} <span class="cnt" data-cnt="status:${v}"></span></label>`).join('')}</fieldset>
    <p><label for="n">Number of questions</label> <input type="number" id="n" min="1" value="20"> <span class="muted" id="avail" aria-live="polite"></span></p>
    <button class="primary" id="go">Start test</button></form></div>`;
  const f = document.getElementById('f');
  if (preSubject) {                                  // arrived from a lesson: practise just that subject
    const want = decodeURIComponent(preSubject);
    f.querySelectorAll('[name=subj]').forEach(e => { e.checked = e.value === want; });
  }
  if (preStatus === 'incorrect') f.querySelectorAll('[name=status]').forEach(e => { e.checked = e.value === 'incorrect'; });   // arrived from Focus areas: just the missed questions
  const vals = n => [...f.querySelectorAll(`[name=${n}]:checked`)].map(e => e.value);
  // Does a question fit the current choices? Anything passed as null is left out of the check, so each checkbox
  // can show how many questions would apply to it given everything else that is selected.
  const fits = (q, bs, ss, stt) => {
    if (isDraft(q) && !showDrafts()) return false;
    if (bs && !q.boards.some(b => bs.includes(b))) return false;
    if (ss && !ss.includes(q.subject)) return false;
    if (stt) {
      if (stt.includes('all')) return true;
      const s = Store.qstat(q.id);
      return (stt.includes('unused') && (!s || !s.seen)) || (stt.includes('incorrect') && s && s.last === 'w') || (stt.includes('flagged') && s && s.flagged);
    }
    return true;
  };
  const pool = () => { const bs = vals('board'), ss = vals('subj'), stt = vals('status'); return bank.questions.filter(q => fits(q, bs, ss, stt)); };
  const upd = () => {
    const p = pool().length, bs = vals('board'), ss = vals('subj'), stt = vals('status');
    document.getElementById('avail').textContent = `(${p} available)`; document.getElementById('go').disabled = !p;
    f.querySelectorAll('[data-cnt]').forEach(span => {
      const [kind, key] = span.dataset.cnt.split(/:(.*)/s);
      const n = bank.questions.filter(q => kind === 'board' ? q.boards.includes(key) && fits(q, null, ss, stt)
        : kind === 'subj' ? q.subject === key && fits(q, bs, null, stt)
        : fits(q, bs, ss, [key])).length;
      span.textContent = `(${n})`; span.closest('label').classList.toggle('zero', n === 0);
    });
  };
  f.addEventListener('change', upd); upd();
  document.getElementById('all').onclick = () => { f.querySelectorAll('[name=subj]').forEach(e => e.checked = true); upd(); };
  document.getElementById('none').onclick = () => { f.querySelectorAll('[name=subj]').forEach(e => e.checked = false); upd(); };
  f.onsubmit = e => {
    e.preventDefault();
    const p = pool(); const n = Math.min(p.length, Math.max(1, +document.getElementById('n').value || 1));
    const qids = shuffle(p).slice(0, n).map(q => q.id), mode = f.mode.value;
    Store.data.active = { id: uid(), mode, qids, answers: {}, struck: {}, revealed: {}, idx: 0, started: Date.now(), elapsed: 0, limit: mode === 'timed' ? n * 90 : 0 };
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
  if (t.limit) startTimer(t);
  else { $timer.hidden = false; tick = setInterval(() => $timer.textContent = fmt(elapsed(t)), 500); $timer.textContent = fmt(elapsed(t)); }
  const nav = t.qids.map((qid, i) => {
    let c = i === t.idx ? 'cur ' : '';
    if (t.answers[qid]) c += 'ans ';
    if (tutor && t.revealed[qid]) c += t.answers[qid] === bank.byId[qid].answer ? 'ok ' : 'no ';
    const s = Store.qstat(qid); if (s && s.flagged) c += 'flag ';
    return `<button class="${c}" data-go="${i}">${i + 1}</button>`;
  }).join('');
  $app.innerHTML = `<div class="testlayout"><div class="testmain">
  <div class="card qcard">
    <div class="row spread"><div>${q.boards.map(b => `<span class="tag">${esc(boardName(b))}</span>`).join('')}${isDraft(q) ? '<span class="tag draft" title="Not yet reviewed by a physician">Draft</span>' : ''}<span class="muted">${esc(q.subject)}${q.topic && shown ? ' · ' + esc(q.topic) : ''}</span></div>
      <div class="muted">Question ${t.idx + 1} of ${t.qids.length}</div></div>
    <p class="stem">${esc(q.stem)}</p>
    ${imgTag(q)}
    <div id="opts" role="radiogroup" aria-label="Answer choices">${q.options.map(o => {
      let c = 'opt'; if (sel === o.id) c += ' sel'; if (struck.includes(o.id)) c += ' struck';
      if (shown) { if (o.id === q.answer) c += ' correct'; else if (sel === o.id) c += ' wrong'; }
      const tab = locked0 ? -1 : (sel ? (sel === o.id ? 0 : -1) : (o === q.options[0] ? 0 : -1));
      return `<div class="optrow"><div class="${c}" data-opt="${esc(o.id)}" role="radio" aria-checked="${sel === o.id}" ${locked0 ? 'aria-disabled="true"' : ''} tabindex="${tab}"><span class="k">${esc(o.id)}.</span><span class="txt">${esc(o.text)}${struck.includes(o.id) ? '<span class="sr"> (crossed out)</span>' : ''}${shown && o.id === q.answer ? '<span class="sr"> (correct answer)</span>' : ''}</span>${shown ? pickBadge(id, o.id) : ''}</div>
        ${shown ? '' : `<button class="x" data-strike="${esc(o.id)}" aria-pressed="${struck.includes(o.id)}" aria-label="Cross out choice ${esc(o.id)}" title="Cross out">✕</button>`}</div>`;
    }).join('')}</div>
    ${shown ? `<div class="expl"><b>${sel === q.answer ? 'Correct' : 'Incorrect'}.</b> Correct answer: ${esc(q.answer)}.${peerLine(id) ? '\n' + peerLine(id) : ''}\n\n${esc(q.explanation)}${notesText(q)}${q.references && q.references.length ? `\n\n<span class="muted">References: ${q.references.map(esc).join('; ')}</span>` : ''}</div>` : ''}
    <div class="row" style="margin-top:14px">
      ${tutor && !shown ? `<button class="primary" id="submit" ${sel ? '' : 'disabled'}>Submit</button>` : ''}
      <button id="prev" ${t.idx ? '' : 'disabled'}>← Prev</button>
      <button id="next" ${t.idx < t.qids.length - 1 ? '' : 'disabled'}>Next →</button>
      <button class="flagbtn ${st && st.flagged ? 'on' : ''}" id="flag">⚑ Flag</button>
      <button id="fbk" title="Report a problem or suggest a change to this question">✎ Feedback</button>
      <span style="flex:1"></span><button class="danger" id="end">End test</button>
    </div>
    <details style="margin-top:12px"><summary>Notes</summary><textarea id="note" rows="3" placeholder="Your notes on this question">${esc(st ? st.note : '')}</textarea></details>
  </div></div>
  <aside class="card navcard" aria-label="Question navigator"><h2 class="navh">Questions</h2><div class="nav">${nav}</div>
    <p class="muted small legend">${t.qids.filter(x => t.answers[x]).length} of ${t.qids.length} answered</p><div class="bar" aria-hidden="true"><i style="width:${Math.round(100 * t.qids.filter(x => t.answers[x]).length / t.qids.length)}%"></i></div></aside></div>
  <div style="height:110px"></div><div id="coach" class="coach"></div>`;
  let streak = 0;
  if (shown && sel === q.answer) for (let i = t.idx; i >= 0 && t.revealed[t.qids[i]] && t.answers[t.qids[i]] === bank.byId[t.qids[i]].answer; i--) streak++;
  const L = Mascot.lines;
  const coach = shown
    ? (sel === q.answer
      ? { pose: streak >= 3 ? 'cheer' : 'happy', msg: streak >= 3 ? `${streak} in a row. Nicely done.` : Mascot.pick(L.correct, id) }
      : { pose: 'sad', msg: Mascot.pick(L.wrong, id) })
    : { pose: 'idle', msg: tutor || t.idx === 0 ? Mascot.pick(L.tips, id + t.idx) : '' };
  if (mascotOn()) Mascot.mount(document.getElementById('coach'), { ...coach, msg: coach.msg && esc(coach.msg).replace(/&#39;/g, "'"), scale: 3 });
  bindTest(t, q); hydrateImages();
  if (refocus) { const f = $app.querySelector(`[data-opt="${refocus}"]`); if (f) f.focus(); refocus = null; }
}

function elapsed(t) { return t.elapsed + (Date.now() - t.started) / 1000; }
function startTimer(t) {
  $timer.hidden = false;
  const u = () => { const left = t.limit - elapsed(t); $timer.textContent = '⏱ ' + fmt(left); if (left <= 0) { clearInterval(tick); finish(); } };
  u(); tick = setInterval(u, 500);
}
function persist(t) { t.elapsed = elapsed(t); t.started = Date.now(); Store.save(); }

function bindTest(t, q) {
  const id = q.id, tutor = t.mode === 'tutor', locked = tutor && t.revealed[id];
  const go = i => { t.idx = Math.min(t.qids.length - 1, Math.max(0, i)); persist(t); renderTest(); };
  const opts = [...$app.querySelectorAll('[data-opt]')];
  opts.forEach((el, i) => {
    const pick = (keyboard, target = el) => { if (locked) return; t.answers[id] = target.dataset.opt; refocus = keyboard ? target.dataset.opt : null; persist(t); renderTest(); };
    el.onclick = () => pick(false);
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
  bindZoom();
  $app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
  const on = (i, fn) => { const e = document.getElementById(i); if (e) e.onclick = fn; };
  on('prev', () => go(t.idx - 1)); on('next', () => go(t.idx + 1));
  on('submit', submit); on('flag', () => { Store.toggleFlag(id); renderTest(); });
  on('fbk', () => feedbackDialog(q));
  on('end', async () => { if (await ask('End this test now? Unanswered questions count as incorrect.', 'End test')) finish(); });
  document.getElementById('note').onchange = e => Store.setNote(id, e.target.value);
  function submit() {
    if (!t.answers[id] || t.revealed[id]) return;
    t.revealed[id] = true; Store.record(id, t.answers[id] === q.answer, t.answers[id]); persist(t); renderTest();
  }
  document.onkeydown = e => {
    if (location.hash !== '#/test' || /TEXTAREA|INPUT|SELECT/.test(e.target.tagName) || document.querySelector('.modal')) return;
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
  $app.innerHTML = `<div class="card"><div id="res-mascot"></div><h2>Results</h2>
    <div class="grid"><div class="stat"><b>${pct(r.correct, r.total)}%</b><span class="muted">${r.correct}/${r.total} correct</span></div>
    <div class="stat"><b>${fmt(r.seconds)}</b><span class="muted">Time</span></div>
    <div class="stat"><b>${r.mode}</b><span class="muted">Mode</span></div>${groupTile(r)}</div></div>
    <div class="card"><h3>By subject</h3><table><tbody>${Object.entries(by).map(([s, o]) => `<tr><td>${esc(s)}</td><td>${o.c}/${o.n}</td><td>${pct(o.c, o.n)}%</td></tr>`).join('')}</tbody></table></div>
    <a class="btn primary" href="#/review/${r.id}">Review questions</a> <a class="btn" href="#/create">New test</a>`;
  if (mascotOn()) Mascot.mount(document.getElementById('res-mascot'), p >= 80 ? { pose: 'cheer', msg: 'Outstanding. That is board-ready work.' } : p >= 60 ? { pose: 'happy', msg: 'Solid work. Review the misses and go again.' } : { pose: 'sad', msg: 'Rough exercise. Review makes it stick, and I\'m with you for the next rep.' });
}

function review(id) {
  pageTitle('Review');
  const r = Store.data.tests.find(x => x.id === id); if (!r) return (location.hash = '#/history');
  $app.innerHTML = `<p><a href="#/results/${r.id}">← Results</a></p>` + r.qids.map((qid, i) => {
    const q = bank.byId[qid]; if (!q) return '';
    const mine = r.answers[qid], ok = mine === q.answer;
    return `<div class="card"><div class="muted">${i + 1}. ${esc(q.subject)} · ${esc(q.topic || '')} — <b style="color:var(--${ok ? 'good' : 'bad'})">${ok ? 'Correct' : mine ? 'Incorrect' : 'Unanswered'}</b></div>
      <p class="stem">${esc(q.stem)}</p>
      ${q.options.map(o => `<div class="opt ${o.id === q.answer ? 'correct' : o.id === mine ? 'wrong' : ''}"><span class="k">${esc(o.id)}.</span><span class="txt">${esc(o.text)}</span>${pickBadge(qid, o.id)}</div>`).join('')}
      ${imgTag(q)}
      <div class="expl">${peerLine(qid) ? peerLine(qid) + '\n\n' : ''}${esc(q.explanation)}${notesText(q)}</div>
      <div class="row" style="margin-top:10px"><button data-fb="${esc(qid)}" title="Report a problem or suggest a change to this question">✎ Feedback</button></div></div>`;
  }).join('');
  bindZoom();
  $app.querySelectorAll('[data-fb]').forEach(b => b.onclick = () => feedbackDialog(bank.byId[b.dataset.fb]));
  hydrateImages();
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
    <p><label for="theme">Theme</label> <select id="theme" style="width:auto">${['auto', 'light', 'dark'].map(v => `<option ${v === th ? 'selected' : ''}>${v}</option>`).join('')}</select></p>
    ${!Cloud.enabled || Admin.isEditor() ? `<label class="chk"><input type="checkbox" id="drafts" ${showDrafts() ? 'checked' : ''}> Include draft questions that a physician has not yet reviewed</label>` : ''}
    <label class="chk"><input type="checkbox" id="mascot" ${mascotOn() ? 'checked' : ''}> Show the mascot and encouragement</label></div>
    ${Cloud.enabled ? `<div class="card"><h3>Account</h3>
      <p>Signed in as <b>${esc(Cloud.session.email)}</b>${profile ? ` <span class="tag">${esc(profile.role === 'admin' ? 'Admin' : profile.role === 'reviewer' ? 'Reviewer' : profile.plan === 'pro' ? 'Member' : 'Free')}</span>` : ''}</p>
      <p class="muted" id="syncline"></p>
      <div class="row"><button id="syncnow">Sync now</button><button id="signout">Sign out</button></div></div>
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
  document.getElementById('mascot').onchange = e => { Store.data.settings.mascot = e.target.checked; Store.save(); };
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
  lockUI(false); ready = true;
  document.getElementById('nav-program').hidden = profile.role !== 'faculty';
  document.getElementById('nav-support').hidden = false;
  clearInterval(badgeTimer);
  const navAdmin = document.getElementById('nav-admin');
  navAdmin.hidden = !Admin.isEditor(); navAdmin.innerHTML = (profile.role === 'admin' ? 'Admin' : 'Questions') + '<span id="inbox-badge" class="navbadge" hidden></span>'; navAdmin.setAttribute('href', profile.role === 'admin' ? '#/admin' : '#/admin/questions');
  refreshInboxBadge(); badgeTimer = setInterval(refreshInboxBadge, 120000);
  location.hash = '#/'; route();
  Cloud.sync().then(() => { applyTheme(); if (ready && !Store.data.active && /^#?\/?$/.test(location.hash)) route(); }).catch(() => {});
}

async function signOut() {
  if (Cloud.pending()) {
    try { await Cloud.sync(); } catch {}
    if (Cloud.pending() && !(await ask(`${Cloud.pending()} change(s) have not synced yet and will be lost if you sign out now.`, 'Sign out anyway'))) return;
  }
  const key = Cloud.userKey();
  await Cloud.signOut(); Store.forget(key);
  ['attempt', 'mark', 'test', 'settings', 'reset'].forEach(k => delete Store.hooks[k]);
  profile = null; ready = false; Store.use('qbank.v1.signedout'); applyTheme();
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
    const hard = qs.filter(q => q.attempts >= 3).sort((x, y) => x.pct_correct - y.pct_correct).slice(0, 15);
    const me = Cloud.session.email.toLowerCase();
    $app.innerHTML = `${Admin.tabs('overview')}<div class="grid">
      <div class="card stat"><b>${act.length}</b><span>Active members</span></div><div class="card stat"><b>${tot}</b><span>Questions answered</span></div>
      <div class="card stat"><b>${tot ? pct(cor, tot) + '%' : '-'}</b><span>Group correct</span></div><div class="card stat"><b>${qs.length}</b><span>Questions in bank</span></div></div>
      <div class="card"><div class="row spread"><h2 style="margin:0">Members</h2><button id="csv">Download CSV</button></div>
        <div class="scroll" role="region" tabindex="0" aria-label="Data table"><table><caption class="sr">Members and their activity</caption><thead><tr><th scope="col">Email</th><th scope="col">Access</th><th scope="col">Answered</th><th scope="col">Correct</th><th scope="col">Last active</th></tr></thead><tbody>${mem.map(m =>
        `<tr><td>${esc(m.email)}</td><td>${m.active ? esc(m.role === 'admin' ? 'Admin' : m.role === 'reviewer' ? 'Reviewer' : m.role === 'faculty' ? 'Faculty' : m.plan) : 'Not approved'}</td><td>${m.attempts}</td><td>${m.attempts ? pct(m.correct, m.attempts) + '%' : '-'}</td><td>${m.last_active ? new Date(m.last_active).toLocaleDateString() : '-'}</td></tr>`).join('')}</tbody></table></div></div>
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
      <div class="card"><h2>Hardest questions</h2>${hard.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Data table"><table><caption class="sr">Questions with the lowest percent correct</caption><thead><tr><th scope="col">Question</th><th scope="col">Subject</th><th scope="col">Answered</th><th scope="col">Correct</th></tr></thead><tbody>${hard.map(q =>
        `<tr><td>${esc(q.question_id)}</td><td>${esc(q.subject)}</td><td>${q.attempts}</td><td>${Math.round(q.pct_correct)}%</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Shows up once questions have been answered at least 3 times.</p>'}</div>`;
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
