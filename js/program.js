'use strict';
// Residency programs: the resident's Settings card, the faculty page, and the admin's program list.
// Loaded before app.js; uses app.js helpers (esc, ask, toast, pageTitle, bank, profile, Cloud, csvCell, pct, $app) when it runs.
const Program = (() => {
  const NOTICE = 'Faculty in your program can see your progress: how many questions you have answered, your percent correct by subject, and when you were last active. They cannot see which answers you chose, your notes, your flags or your test history. You can leave at any time.';
  const slug = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const options = (list, sel) => list.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  function askValue(msg, initial, yes) {
    return new Promise(res => {
      const d = document.createElement('div'); d.className = 'modal';
      d.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="${esc(msg)}"><form><label for="av">${esc(msg)}</label><input id="av" type="text" maxlength="120" value="${esc(initial)}" autocomplete="off"><div class="row" style="margin-top:12px"><button class="primary" type="submit">${esc(yes)}</button><button type="button" data-n>Cancel</button></div></form></div>`;
      document.body.appendChild(d); const input = d.querySelector('#av'); input.focus(); input.select();
      const done = v => { d.remove(); res(v); };
      d.querySelector('[data-n]').onclick = () => done(null); d.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
      d.querySelector('form').onsubmit = e => { e.preventDefault(); done(input.value.trim() || null); };
    });
  }
  const day = t => (t ? new Date(t).toLocaleDateString() : '-');

  // ------------------------------------------------------------------ resident: Settings card
  async function mountSettings(box) {
    if (!box || !profile) return;
    const [mine, all] = await Promise.all([Cloud.myProgram(), Cloud.programs()]);
    if (!document.body.contains(box)) return;
    if (profile.role === 'faculty') { box.innerHTML = `<div class="card"><h3>Residency program</h3><p>You are faculty for <b>${esc(mine ? mine.name : 'no program yet')}</b>. Open <a href="#/program">Program</a> to see your residents.</p></div>`; return; }
    if (!all.length && !mine) return;                                         // nothing to join yet: stay out of the way
    const draw = m => {
      const state = !m ? 'none' : m.status;
      box.innerHTML = `<div class="card"><h3>Residency program</h3>
        ${state === 'approved' ? `<p>You are in <b>${esc(m.name)}</b>. ${esc(NOTICE)}</p><div class="row"><button id="pg-leave">Leave the program</button></div>`
        : state === 'pending' ? `<p>Waiting for faculty at <b>${esc(m.name)}</b> to approve you. Until then they cannot see anything about you.</p><div class="row"><button id="pg-leave">Cancel the request</button></div>`
        : `<p class="muted">Are you in a residency program? Ask to join it so your faculty can follow your progress.</p>
           <form id="pg-form" class="row" style="align-items:flex-end"><div><label for="pg-pick">Program</label><select id="pg-pick"><option value="">Choose your program</option>${options(all, '')}</select></div><button class="primary" type="submit">Ask to join</button></form>
           <p class="muted small">${esc(NOTICE)}</p>`}
        <p class="notice" id="pg-msg" hidden role="alert"></p></div>`;
      const msg = t => { const n = box.querySelector('#pg-msg'); n.textContent = t; n.hidden = !t; };
      const form = box.querySelector('#pg-form');
      if (form) form.onsubmit = async e => {
        e.preventDefault(); const id = box.querySelector('#pg-pick').value; if (!id) return msg('Choose your program first.');
        try { await Cloud.requestProgram(id); toast('Request sent. Faculty will review it.'); draw(await Cloud.myProgram()); } catch (x) { msg(x.offline ? 'No connection.' : 'Could not send the request: ' + x.message); }
      };
      const leave = box.querySelector('#pg-leave');
      if (leave) leave.onclick = async () => { if (state === 'approved' && !(await ask(`Leave ${m.name}? Its faculty will no longer see your progress.`, 'Leave'))) return; try { await Cloud.leaveProgram(); draw(null); } catch (x) { msg(x.message); } };
    };
    draw(mine);
  }

  // ------------------------------------------------------------------ faculty page
  async function facultyPage(pid) {
    pageTitle('Program');
    const preview = !!pid && !!profile && profile.role === 'admin';   // an admin looking at exactly what a program's faculty see
    if (!profile || (profile.role !== 'faculty' && !preview)) { $app.innerHTML = '<div class="card"><h2>Program</h2><p class="muted">This page is for program faculty.</p></div>'; return; }
    $app.innerHTML = '<div class="card"><p class="muted">Loading your residents...</p></div>';
    try {
      const [mine, roster, subj] = preview
        ? await Promise.all([Cloud.adminPrograms().then(l => l.find(p => p.id === pid) || null), Cloud.previewRoster(pid), Cloud.previewSubjects(pid)])
        : await Promise.all([Cloud.myProgram(), Cloud.facultyRoster(), Cloud.facultySubjects()]);
      if (!mine && preview) { $app.innerHTML = '<div class="card"><h2>Program</h2><p class="muted">That program was not found. <a href="#/admin">Back to Admin</a></p></div>'; return; }
      if (!mine) { $app.innerHTML = '<div class="card"><h2>Program</h2><p class="muted">You have not been assigned to a program yet. Ask an administrator.</p></div>'; return; }
      const pending = roster.filter(r => r.status === 'pending'), res = roster.filter(r => r.status === 'approved');
      const subjects = [...new Set(subj.map(x => x.subject))].sort();
      const cell = (u, s) => { const x = subj.find(y => y.user_id === u && y.subject === s); return x ? { n: Number(x.attempts), p: pct(Number(x.correct), Number(x.attempts)) } : null; };
      const heat = c => !c ? '<td class="heat none">-</td>' : `<td class="heat ${c.p >= 70 ? 'hi' : c.p >= 50 ? 'mid' : 'lo'}"><b>${c.p}%</b><span> (${c.n})</span></td>`;
      const avg = s => { const rows = subj.filter(x => x.subject === s), n = rows.reduce((a, x) => a + Number(x.attempts), 0), c = rows.reduce((a, x) => a + Number(x.correct), 0); return n ? { n, p: pct(c, n) } : null; };
      const tot = res.reduce((a, r) => a + Number(r.attempts || 0), 0), cor = res.reduce((a, r) => a + Number(r.correct || 0), 0);
      $app.innerHTML = `${preview ? `<div class="card notice"><b>Preview.</b> This is what faculty for ${esc(mine.name)} see. Approving, declining and removing are switched off here. <a href="#/admin">Back to Admin</a></div>` : ''}<div class="pagehead"><div><h2 class="pagetitle">${esc(mine.name)}</h2><p class="muted">Faculty view. You see counts, percent correct by subject and last active. You cannot see individual answers, notes or test history.</p></div><button id="pg-csv">Download CSV</button></div>
        <div class="grid"><div class="card stat"><b>${res.length}</b><span>Residents</span></div><div class="card stat"><b>${tot}</b><span>Questions answered</span></div><div class="card stat"><b>${tot ? pct(cor, tot) + '%' : '-'}</b><span>Program correct</span></div><div class="card stat"><b>${pending.length}</b><span>Waiting for approval</span></div></div>
        ${pending.length ? `<div class="card"><h2>Waiting for your approval</h2><p class="muted">These people asked to join. You cannot see any of their progress until you approve them.</p><table><caption class="sr">Requests to join</caption><thead><tr><th scope="col">Email</th><th scope="col">Asked</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${pending.map(r => `<tr><td>${esc(r.email)}</td><td>${day(r.joined)}</td><td>${preview ? '' : `<button class="primary" data-ok="${esc(r.user_id)}" aria-label="Approve ${esc(r.email)}">Approve</button> <button data-no="${esc(r.user_id)}" aria-label="Decline ${esc(r.email)}">Decline</button>`}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="card"><h2>Residents</h2>${res.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Residents table"><table><caption class="sr">Residents and their progress</caption><thead><tr><th scope="col">Resident</th><th scope="col">Answered</th><th scope="col">Correct</th><th scope="col">Last active</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${res.map(r => `<tr><td>${esc(r.email)}</td><td>${r.attempts}</td><td>${Number(r.attempts) ? pct(Number(r.correct), Number(r.attempts)) + '%' : '-'}</td><td>${day(r.last_active)}</td><td>${preview ? '' : `<button data-rm="${esc(r.user_id)}" data-email="${esc(r.email)}" aria-label="Remove ${esc(r.email)} from the program">Remove</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No residents yet. People join by choosing your program in Settings, or when they create an account.</p>'}</div>
        ${subjects.length ? `<div class="card"><h2>By subject</h2><p class="muted">Percent correct, with the number of questions answered in brackets. Green is 70% or more, amber 50 to 69, red under 50.</p><div class="scroll" role="region" tabindex="0" aria-label="Subject table"><table class="heatmap"><caption class="sr">Percent correct by resident and subject</caption><thead><tr><th scope="col">Resident</th>${subjects.map(s => `<th scope="col">${esc(s)}</th>`).join('')}</tr></thead>
          <tbody><tr class="avgrow"><th scope="row">Program average</th>${subjects.map(s => heat(avg(s))).join('')}</tr>${res.map(r => `<tr><th scope="row">${esc(r.email)}</th>${subjects.map(s => heat(cell(r.user_id, s))).join('')}</tr>`).join('')}</tbody></table></div></div>` : ''}`;
      const act = async (fn, msg) => { try { await fn(); toast(msg); facultyPage(); } catch (x) { toast(x.offline ? 'No connection.' : 'That did not work: ' + x.message); } };
      $app.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => act(() => Cloud.facultyDecide(b.dataset.ok, true), 'Approved.'));
      $app.querySelectorAll('[data-no]').forEach(b => b.onclick = () => act(() => Cloud.facultyDecide(b.dataset.no, false), 'Declined.'));
      $app.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (await ask(`Remove ${b.dataset.email} from the program? You will no longer see their progress.`, 'Remove')) act(() => Cloud.facultyRemove(b.dataset.rm), 'Removed.'); });
      document.getElementById('pg-csv').onclick = () => {
        const head = ['resident', 'answered', 'correct', 'percent_correct', 'last_active', ...subjects.flatMap(s => [s + ' answered', s + ' percent'])];
        const rows = res.map(r => [r.email, r.attempts, r.correct, Number(r.attempts) ? pct(Number(r.correct), Number(r.attempts)) : '', r.last_active ? new Date(r.last_active).toISOString().slice(0, 10) : '', ...subjects.flatMap(s => { const c = cell(r.user_id, s); return c ? [c.n, c.p] : ['', '']; })]);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' }));
        a.download = 'program-progress-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      };
    } catch (e) { $app.innerHTML = `<div class="card"><h2>Program</h2><p class="muted">Could not load: ${esc(e.offline ? 'you are offline' : e.message)}</p></div>`; }
  }

  // ------------------------------------------------------------------ admin: program list (inside Admin > Overview)
  async function mountAdmin(box, members) {
    if (!box) return;
    let list; try { list = await Cloud.adminPrograms(); } catch (e) { box.innerHTML = ''; return; }        // old database: hide quietly
    const count = (id, fn) => members.filter(m => m.program_id === id && fn(m)).length;
    box.innerHTML = `<div class="card"><h2>Residency programs</h2>
      <p class="muted">Residents choose their program when they create an account (or in Settings) and its faculty approve them. Make someone faculty by editing their row under Approved emails and choosing the role <b>faculty</b> and a program. <b>View as faculty</b> shows you a program exactly as its faculty see it.</p>
      ${list.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Programs table"><table><caption class="sr">Programs</caption><thead><tr><th scope="col">Program</th><th scope="col">Residents</th><th scope="col">Waiting</th><th scope="col">Faculty</th><th scope="col">Shown at sign-up</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
        <tbody>${list.map(p => `<tr><td>${esc(p.name)}<div class="muted small">${esc(p.id)}</div></td><td>${count(p.id, m => m.role !== 'faculty' && m.program_status === 'approved')}</td><td>${count(p.id, m => m.program_status === 'pending')}</td><td>${count(p.id, m => m.role === 'faculty')}</td><td>${p.active ? 'Yes' : 'Hidden'}</td>
          <td><a class="btn" href="#/program/${esc(p.id)}" aria-label="View ${esc(p.name)} as its faculty see it">View as faculty</a> <button data-pren="${esc(p.id)}">Rename</button> <button data-ptog="${esc(p.id)}">${p.active ? 'Hide' : 'Show'}</button> <button class="danger" data-pdel="${esc(p.id)}" aria-label="Delete ${esc(p.name)}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No programs yet. Add the first one below.</p>'}
      <form id="pgadd" class="row" style="margin-top:12px;align-items:flex-end"><div><label for="pg-name">New program name</label><input id="pg-name" type="text" maxlength="120" placeholder="e.g. Aerospace Medicine Residency, Wright-Patterson" autocomplete="off" required></div><button class="primary" type="submit">Add program</button></form>
      <p class="notice" id="pg-amsg" hidden role="alert"></p></div>`;
    const say = t => { const n = box.querySelector('#pg-amsg'); n.textContent = t; n.hidden = !t; };
    const again = () => mountAdmin(box, members);
    box.querySelector('#pgadd').onsubmit = async e => {
      e.preventDefault(); say(''); const name = box.querySelector('#pg-name').value.trim(), id = slug(name);
      if (!id) return say('Please type a name.'); if (list.some(p => p.id === id || p.name.toLowerCase() === name.toLowerCase())) return say('A program with that name already exists.');
      try { await Cloud.saveProgram({ id, name, active: true }); toast('Added ' + name); again(); } catch (x) { say(x.offline ? 'No connection.' : 'Could not add: ' + x.message); }
    };
    box.querySelectorAll('[data-pren]').forEach(b => b.onclick = async () => {
      const p = list.find(x => x.id === b.dataset.pren), name = await askValue('New name for this program', p.name, 'Rename'); if (!name || name === p.name) return;
      try { await Cloud.saveProgram({ ...p, name }); toast('Renamed.'); again(); } catch (x) { say('Could not rename: ' + x.message); }
    });
    box.querySelectorAll('[data-ptog]').forEach(b => b.onclick = async () => { const p = list.find(x => x.id === b.dataset.ptog); try { await Cloud.saveProgram({ ...p, active: !p.active }); again(); } catch (x) { say(x.message); } });
    box.querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
      const p = list.find(x => x.id === b.dataset.pdel); if (!(await ask(`Delete ${p.name}? Everyone in it is taken out of the program (their accounts and progress stay). Faculty for it will see nothing until reassigned.`, 'Delete'))) return;
      try { await Cloud.deleteProgram(p.id); toast('Deleted.'); again(); } catch (x) { say('Could not delete: ' + x.message); }
    });
  }
  return { mountSettings, facultyPage, mountAdmin, options, NOTICE, slug };
})();
