'use strict';
// Support and conversations for members: everything they have sent the team (feedback on questions, and support messages),
// the team's replies, and a form to start a new support message. Loaded before app.js.
const Support = (() => {
  const when = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const kindTag = k => k === 'support' ? '<span class="tag">Support</span>' : '<span class="tag">Question feedback</span>';
  const snip = (t, n = 110) => (t.length > n ? t.slice(0, n) + '...' : t);

  async function page(arg) {
    if (!Cloud.enabled) { pageTitle('Support'); $app.innerHTML = '<div class="card"><h2>Support</h2><p class="muted">Messaging is available when you are signed in to an account.</p></div>'; return; }
    if (arg === 'new') return composer();
    if (arg && /^\d+$/.test(arg)) return conversation(+arg);
    return list();
  }

  async function list() {
    pageTitle('Support');
    $app.innerHTML = '<div class="card"><p class="muted">Loading your messages...</p></div>';
    let rows; try { rows = await Cloud.myThreads(); } catch (e) { rows = null; var err = e; }
    if (!rows) { $app.innerHTML = `<div class="card"><h2>Support</h2>${err && (err.status === 404 || /schema cache/.test(err.message || '')) ? '<p class="muted">Messaging is not switched on yet. Please check back soon.</p>' : `<p class="muted">Could not load: ${esc(err && err.offline ? 'you are offline' : (err && err.message) || 'unknown error')}</p>`}</div>`; return; }
    $app.innerHTML = `<div class="pagehead"><div><h2 class="pagetitle">Support</h2><p class="muted">Message the team with a question about the app or your account. Replies to feedback you send about a question show up here too.</p></div><a class="btn primary" href="#/support/new">New message</a></div>
      ${rows.length ? `<div class="card">${rows.map(r => `<a class="lessoncard" href="#/support/${r.id}"><b>${r.member_unread ? '<span class="dot" aria-hidden="true"></span>' : ''}${esc(r.kind === 'support' ? r.subject || 'Support' : 'About question ' + (r.question_id || ''))}${r.member_unread ? '<span class="sr"> (new reply)</span>' : ''}</b>
        <span class="muted">${esc(snip(r.first_message))}</span><span>${kindTag(r.kind)}${r.member_unread ? '<span class="tag draft">New reply</span>' : r.replies ? '<span class="tag">Answered</span>' : '<span class="tag">Waiting for the team</span>'} <span class="muted small">${esc(when(r.last_activity))}</span></span></a>`).join('')}</div>`
      : '<div class="card"><p class="muted">You have not sent any messages yet. Use New message to reach the team, or the Feedback button on a question.</p></div>'}`;
  }

  function composer() {
    pageTitle('New message');
    $app.innerHTML = `<p class="crumb"><a href="#/support">Support</a></p><div class="card" style="max-width:640px"><h2>New message to the team</h2>
      <form id="sf" novalidate><label for="sf-sub">Subject (optional)</label><input id="sf-sub" type="text" maxlength="120" autocomplete="off" placeholder="e.g. Trouble signing in">
        <label for="sf-msg">Your message</label><textarea id="sf-msg" rows="7" maxlength="1500" placeholder="How can we help?"></textarea>
        <p class="muted small">Sent to the site's administrators and reviewers. The team replies here in the app, not by email. Please do not include patient information.</p>
        <p class="notice" id="sf-err" hidden role="alert"></p>
        <div class="row"><button class="primary" type="submit" id="sf-go">Send</button><a class="btn" href="#/support">Cancel</a></div></form></div>`;
    document.getElementById('sf').onsubmit = async e => {
      e.preventDefault(); const msg = document.getElementById('sf-msg').value.trim(), err = document.getElementById('sf-err');
      if (msg.length < 10) { err.textContent = 'Please write a little more so the team can help (at least 10 characters).'; err.hidden = false; return; }
      document.getElementById('sf-go').disabled = true;
      Cloud.queueFeedback({ kind: 'support', subject: document.getElementById('sf-sub').value.trim() || null, category: 'other', message: msg });
      try { await Cloud.sync(); } catch {}
      toast(navigator.onLine === false ? 'Saved. It will send when you are back online.' : 'Sent. The team will reply here.');
      location.hash = '#/support';
    };
  }

  async function conversation(id) {
    pageTitle('Conversation');
    $app.innerHTML = '<div class="card"><p class="muted">Loading...</p></div>';
    let msgs, head;
    try { [msgs, head] = await Promise.all([Cloud.myThreadMessages(id), Cloud.myThreads()]); } catch (e) { $app.innerHTML = `<div class="card"><p class="muted">Could not load: ${esc(e.offline ? 'you are offline' : e.message)}</p></div>`; return; }
    const t = head.find(x => x.id === id);
    if (!t || !msgs.length) { $app.innerHTML = '<div class="card"><h2>Not found</h2><p class="muted"><a href="#/support">Back to Support</a></p></div>'; return; }
    if (t.member_unread) Cloud.markThreadSeen(id).then(() => refreshInboxBadge()).catch(() => {});
    $app.innerHTML = `<p class="crumb"><a href="#/support">Support</a></p>
      <div class="card"><h2 style="margin-top:0">${esc(t.kind === 'support' ? t.subject || 'Support' : 'About question ' + (t.question_id || ''))}</h2><p>${kindTag(t.kind)}</p>
        <div class="convo" role="log" aria-label="Conversation">${msgs.map(m => `<div class="bubblerow ${m.sender === 'member' ? 'me' : 'them'}"><div class="cbubble"><span class="who">${m.sender === 'team' ? 'The team' : 'You'} &middot; ${esc(when(m.created_at))}</span><p>${esc(m.message)}</p></div></div>`).join('')}</div>
        <form id="rf" novalidate><label for="rf-msg">Reply</label><textarea id="rf-msg" rows="3" maxlength="1500" placeholder="Write a reply"></textarea>
          <p class="notice" id="rf-err" hidden role="alert"></p><div class="row"><button class="primary" type="submit" id="rf-go">Send reply</button></div></form></div>`;
    document.getElementById('rf').onsubmit = async e => {
      e.preventDefault(); const m = document.getElementById('rf-msg').value.trim(), err = document.getElementById('rf-err');
      if (!m) { err.textContent = 'Please write something first.'; err.hidden = false; return; }
      document.getElementById('rf-go').disabled = true;
      try { await Cloud.replyThread(id, m); toast('Sent.'); conversation(id); }
      catch (x) { document.getElementById('rf-go').disabled = false; err.textContent = x.offline ? 'You need a connection to reply.' : /too many/.test(x.message) ? 'You have sent a lot of messages today. Please try again tomorrow.' : 'Could not send: ' + x.message; err.hidden = false; }
    };
  }
  return { page };
})();
