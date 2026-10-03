'use strict';
// Admin > Inbox: messages members send about questions. Admins see who sent each one; reviewers see the message only.
const Inbox = (() => {
  const CAT = { 'wrong-answer': 'Answer or explanation', unclear: 'Unclear', typo: 'Typo', picture: 'Picture', other: 'Other' };
  const view = { show: 'new', kind: '' };
  const when = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const tag = st => st === 'new' ? '<span class="tag draft">New</span>' : st === 'read' ? '<span class="tag">Read</span>' : '<span class="tag reviewed">Resolved</span>';

  async function page() {
    pageTitle('Inbox');
    $app.innerHTML = Admin.tabs('inbox') + '<div class="card"><p class="muted">Loading messages...</p></div>';
    let rows;
    try { rows = await Cloud.inbox(); }
    catch (e) { $app.innerHTML = Admin.tabs('inbox') + (/schema cache|function|404/i.test(e.message || '') || e.status === 404
      ? '<div class="card"><h2>One more setup step</h2><p>The database needs the updated blueprint before the inbox can work. In Supabase, open <b>SQL Editor</b>, paste the latest <code>supabase/schema.sql</code> from GitHub, and click <b>Run</b>. It is safe to run again, and nothing is lost.</p></div>'
      : `<div class="card"><p class="muted">Could not load the inbox: ${esc(e.offline ? 'you are offline' : e.message)}</p></div>`); return; }
    const admin = profile.role === 'admin', n = rows.filter(r => r.status === 'new').length;
    Admin.unread = n; const shown = () => rows.filter(r => (!view.kind || r.kind === view.kind) && (view.show === 'all' || (view.show === 'resolved' ? r.status === 'resolved' : r.status !== 'resolved' && (view.show !== 'new' || r.status === 'new'))));
    $app.innerHTML = `${Admin.tabs('inbox')}<div class="card"><div class="row spread"><div><h2 style="margin:0">Inbox</h2><p class="muted" style="margin:4px 0 0">${n} new &middot; ${rows.length} in total</p></div>
        <div class="row"><div><label for="ib-show" class="sr">Show</label><select id="ib-show" style="width:auto"><option value="new">New only</option><option value="open">New and read</option><option value="resolved">Resolved</option><option value="all">Everything</option></select></div>
          <div><label for="ib-kind" class="sr">Type</label><select id="ib-kind" style="width:auto"><option value="">Support and feedback</option><option value="support">Support only</option><option value="feedback">Question feedback only</option></select></div>
          <button id="ib-claude" type="button" title="Copy the messages you are looking at, with their questions, to paste into Claude">Copy for Claude</button>${n ? '<button id="ib-all">Mark all read</button>' : ''}</div></div>${admin ? '' : '<p class="muted small">As a reviewer you see the messages but not who sent them.</p>'}</div>
      <div id="ib-list"></div>`;
    document.getElementById('ib-show').value = view.show; document.getElementById('ib-kind').value = view.kind;
    document.getElementById('ib-claude').onclick = async () => {
      let qs = []; try { qs = await Cloud.editorQuestions(); } catch {}
      const items = shown().map(r => ({ ...r, question: r.question_id ? qs.find(q => q.id === r.question_id) || null : null }));
      Handoff.open({ kind: 'feedback', items, importHash: '#/admin/questions/import', describe: `${view.show === 'new' ? 'new only' : view.show === 'open' ? 'new and read' : view.show === 'resolved' ? 'resolved' : 'all'}${view.kind ? ', ' + (view.kind === 'support' ? 'support only' : 'question feedback only') : ''}` });
    };
    const paint = () => {
      const list = shown(); const box = document.getElementById('ib-list');
      box.innerHTML = list.length ? list.map(r => `<article class="card msg" data-id="${r.id}"><div class="row spread"><div>${tag(r.status)} ${r.kind === 'support' ? '<span class="tag">Support</span>' : `<span class="tag">${esc(CAT[r.category] || r.category)}</span>`} <span class="muted">${esc(when(r.last_activity || r.created_at))}${admin && r.reporter ? ' &middot; ' + esc(r.reporter) : ''}</span></div>
          ${r.question_id ? `<a href="#/admin/questions/edit/${encodeURIComponent(r.question_id)}">Open question</a>` : ''}</div>
        ${r.question_id ? `<p class="muted small" style="margin:6px 0 0">${esc(r.question_id)}${r.question_stem ? ': ' + esc(r.question_stem) + (r.question_stem.length >= 140 ? '...' : '') : ' (question no longer exists)'}</p>` : ''}
        ${r.kind === 'support' ? `<h3 style="margin:8px 0 0">${esc(r.subject || 'Support')}</h3>` : ''}
        <p class="msgtext">${esc(r.message)}</p>
        <details class="thread"><summary>Conversation${r.replies ? ` (${r.replies} repl${r.replies === 1 ? 'y' : 'ies'})` : ' and reply'}</summary><div class="thread-body" data-thread><p class="muted">Loading...</p></div></details>
        <div class="row"><button data-st="${r.status === 'resolved' ? 'read' : 'resolved'}" class="${r.status === 'resolved' ? '' : 'primary'}">${r.status === 'resolved' ? 'Reopen' : 'Mark resolved'}</button>
          ${r.status === 'new' ? '<button data-st="read">Mark read</button>' : r.status === 'read' ? '<button data-st="new">Mark unread</button>' : ''}</div>
        <label for="note-${r.id}" class="small" style="margin-top:8px">Internal note (only admins and reviewers see this)</label>
        <div class="row" style="flex-wrap:nowrap"><input id="note-${r.id}" type="text" maxlength="1000" value="${esc(r.admin_note || '')}" autocomplete="off"><button data-note>Save note</button></div></article>`).join('')
        : '<div class="card"><p class="muted">Nothing here. New messages from members show up in this list.</p></div>';
      box.querySelectorAll('.msg').forEach(el => {
        const r = rows.find(x => x.id === +el.dataset.id);
        const save = async (status, note, msg) => {
          try { await Cloud.setFeedback(r.id, status, note); if (status) r.status = status; if (note !== undefined) r.admin_note = note; toast(msg); Admin.unread = rows.filter(x => x.status === 'new').length; refreshInboxBadge(); paint(); head(); }
          catch (e) { toast(e.offline ? 'No connection. Nothing was changed.' : 'That did not work: ' + e.message); }
        };
        const det = el.querySelector('details.thread');
        const draw = async () => {
          const box = el.querySelector('[data-thread]');
          try { const msgs = await Cloud.threadMessages(r.id);
            box.innerHTML = `<div class="convo" role="log" aria-label="Conversation">${msgs.map(m => `<div class="bubblerow ${m.sender === 'team' ? 'me' : 'them'}"><div class="cbubble"><span class="who">${m.sender === 'team' ? 'Team' + (m.author ? ' (' + esc(m.author) + ')' : '') : (admin && r.reporter ? esc(r.reporter) : 'Member')} &middot; ${esc(when(m.created_at))}</span><p>${esc(m.message)}</p></div></div>`).join('')}</div>
              <label for="rep-${r.id}">Reply to the member</label><textarea id="rep-${r.id}" rows="3" maxlength="1500" placeholder="Write a reply. The member sees it under Support in the app."></textarea>
              <div class="row"><button class="primary" data-send>Send reply</button></div>`;
            box.querySelector('[data-send]').onclick = async () => { const t = box.querySelector('textarea').value.trim(); if (!t) return toast('Please write something first.');
              try { await Cloud.teamReply(r.id, t); r.replies++; if (r.status === 'new') r.status = 'read'; toast('Reply sent.'); Admin.unread = rows.filter(x => x.status === 'new').length; refreshInboxBadge(); paint(); head(); }
              catch (e) { toast(e.offline ? 'No connection. Nothing was sent.' : 'That did not work: ' + e.message); } };
          } catch (e) { box.innerHTML = `<p class="muted">Could not load the conversation: ${esc(e.message)}</p>`; }
        };
        let loaded = false; det.addEventListener('toggle', () => { if (det.open && !loaded) { loaded = true; draw(); } });
        el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => save(b.dataset.st, undefined, b.dataset.st === 'resolved' ? 'Marked resolved.' : b.dataset.st === 'new' ? 'Marked unread.' : 'Marked read.'));
        el.querySelector('[data-note]').onclick = () => save(r.status, el.querySelector('input').value.trim(), 'Note saved.');
      });
    };
    const head = () => { const c = document.querySelector('#ib-show').closest('.card').querySelector('p.muted'); const k = rows.filter(r => r.status === 'new').length; if (c) c.innerHTML = `${k} new &middot; ${rows.length} in total`; };
    document.getElementById('ib-show').onchange = e => { view.show = e.target.value; paint(); };
    document.getElementById('ib-kind').onchange = e => { view.kind = e.target.value; paint(); };
    const all = document.getElementById('ib-all');
    if (all) all.onclick = async () => { try { for (const r of rows.filter(x => x.status === 'new')) { await Cloud.setFeedback(r.id, 'read'); r.status = 'read'; } toast('All marked read.'); refreshInboxBadge(); page(); } catch (e) { toast('That did not work: ' + e.message); } };
    paint();
  }
  return { page };
})();
