'use strict';
// Residency programs: the resident's Settings card, the faculty page, and the admin's program list.
// Loaded before app.js; uses app.js helpers (esc, ask, toast, pageTitle, bank, profile, Cloud, csvCell, pct, $app) when it runs.
const Program = (() => {
  const NOTICE = 'Faculty in your program can see your progress: how many questions you have answered, your percent correct by subject, and when you were last active. Faculty also see group totals for the whole program, such as which topics and questions the program finds hardest and how it compares with all members; these never show your own answers by topic, and are shown only when at least 3 residents are in the program. They cannot see which answers you chose, your notes, your flags or your test history. You can leave at any time.';
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
      const who = r => r.display_name || r.email;   // the name a resident chose, else their email
      const pending = roster.filter(r => r.status === 'pending'), res = roster.filter(r => r.status === 'approved');
      const subjects = [...new Set(subj.map(x => x.subject))].sort();
      const cell = (u, s) => { const x = subj.find(y => y.user_id === u && y.subject === s); return x ? { n: Number(x.attempts), p: pct(Number(x.correct), Number(x.attempts)) } : null; };
      const heat = c => !c ? '<td class="heat none">-</td>' : `<td class="heat ${c.p >= 70 ? 'hi' : c.p >= 50 ? 'mid' : 'lo'}"><b>${c.p}%</b><span> (${c.n})</span></td>`;
      const avg = s => { const rows = subj.filter(x => x.subject === s), n = rows.reduce((a, x) => a + Number(x.attempts), 0), c = rows.reduce((a, x) => a + Number(x.correct), 0); return n ? { n, p: pct(c, n) } : null; };
      const tot = res.reduce((a, r) => a + Number(r.attempts || 0), 0), cor = res.reduce((a, r) => a + Number(r.correct || 0), 0);
      $app.innerHTML = `${preview ? `<div class="card notice"><b>Preview.</b> This is what faculty for ${esc(mine.name)} see. As an admin you can also do what they can here: approve, decline and remove. <a href="#/admin">Back to Admin</a></div>` : ''}<div class="pagehead"><div><h2 class="pagetitle">${esc(mine.name)}</h2><p class="muted">Faculty view. You see counts, percent correct by subject and last active. You cannot see individual answers, notes or test history.</p></div><button id="pg-csv">Download CSV</button></div>
        <div class="grid"><div class="card stat"><b>${res.length}</b><span>Residents</span></div><div class="card stat"><b>${tot}</b><span>Questions answered</span></div><div class="card stat"><b>${tot ? pct(cor, tot) + '%' : '-'}</b><span>Program correct</span></div><div class="card stat"><b>${pending.length}</b><span>Waiting for approval</span></div></div>
        <div class="card row spread"><div><b>Program insights</b><div class="muted">Where your residents are weakest as a group, and the lessons that would help most.</div></div><a class="btn primary" href="#/program/${preview ? esc(pid) + '/' : ''}insights">Open insights</a></div>
        ${pending.length ? `<div class="card"><h2>Waiting for your approval</h2><p class="muted">These people asked to join. You cannot see any of their progress until you approve them.</p><table><caption class="sr">Requests to join</caption><thead><tr><th scope="col">Email</th><th scope="col">Asked</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${pending.map(r => `<tr><td>${esc(who(r))}</td><td>${day(r.joined)}</td><td><button class="primary" data-ok="${esc(r.user_id)}" aria-label="Approve ${esc(who(r))}">Approve</button> <button data-no="${esc(r.user_id)}" aria-label="Decline ${esc(who(r))}">Decline</button></td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="card"><h2>Residents</h2>${res.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Residents table"><table><caption class="sr">Residents and their progress</caption><thead><tr><th scope="col">Resident</th><th scope="col">Answered</th><th scope="col">Correct</th><th scope="col">Last active</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${res.map(r => `<tr><td>${esc(who(r))}</td><td>${r.attempts}</td><td>${Number(r.attempts) ? pct(Number(r.correct), Number(r.attempts)) + '%' : '-'}</td><td>${day(r.last_active)}</td><td><button data-rm="${esc(r.user_id)}" data-email="${esc(who(r))}" aria-label="Remove ${esc(who(r))} from the program">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No residents yet. People join by choosing your program in Settings, or when they create an account.</p>'}</div>
        ${subjects.length ? `<div class="card"><h2>By subject</h2><p class="muted">Percent correct, with the number of questions answered in brackets. Green is 70% or more, amber 50 to 69, red under 50.</p><div class="scroll" role="region" tabindex="0" aria-label="Subject table"><table class="heatmap"><caption class="sr">Percent correct by resident and subject</caption><thead><tr><th scope="col">Resident</th>${subjects.map(s => `<th scope="col">${esc(s)}</th>`).join('')}</tr></thead>
          <tbody><tr class="avgrow"><th scope="row">Program average</th>${subjects.map(s => heat(avg(s))).join('')}</tr>${res.map(r => `<tr><th scope="row">${esc(who(r))}</th>${subjects.map(s => heat(cell(r.user_id, s))).join('')}</tr>`).join('')}</tbody></table></div></div>` : ''}`;
      const act = async (fn, msg) => { try { await fn(); toast(msg); facultyPage(pid); } catch (x) { toast(x.offline ? 'No connection.' : 'That did not work: ' + x.message); } };
      $app.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => act(() => preview ? Cloud.programDecide(pid, b.dataset.ok, true) : Cloud.facultyDecide(b.dataset.ok, true), 'Approved.'));
      $app.querySelectorAll('[data-no]').forEach(b => b.onclick = () => act(() => preview ? Cloud.programDecide(pid, b.dataset.no, false) : Cloud.facultyDecide(b.dataset.no, false), 'Declined.'));
      $app.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (await ask(`Remove ${b.dataset.email} from the program? You will no longer see their progress.`, 'Remove')) act(() => preview ? Cloud.programRemove(pid, b.dataset.rm) : Cloud.facultyRemove(b.dataset.rm), 'Removed.'); });
      document.getElementById('pg-csv').onclick = () => {
        const head = ['resident', 'answered', 'correct', 'percent_correct', 'last_active', ...subjects.flatMap(s => [s + ' answered', s + ' percent'])];
        const rows = res.map(r => [who(r), r.attempts, r.correct, Number(r.attempts) ? pct(Number(r.correct), Number(r.attempts)) : '', r.last_active ? new Date(r.last_active).toISOString().slice(0, 10) : '', ...subjects.flatMap(s => { const c = cell(r.user_id, s); return c ? [c.n, c.p] : ['', '']; })]);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' }));
        a.download = 'program-progress-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      };
    } catch (e) { $app.innerHTML = `<div class="card"><h2>Program</h2><p class="muted">Could not load: ${esc(e.offline ? 'you are offline' : e.message)}</p></div>`; }
  }

  // ------------------------------------------------------------------ faculty: program insights
  // Where the program as a group is weakest, the lessons that would help most, the questions missed most, and who may need a check-in.
  // Group totals only: nothing here shows one resident's answers by topic. The logic is in insights.js.
  let range = 0;
  const RANGES = [[0, 'All time'], [90, 'Last 90 days'], [30, 'Last 30 days'], [14, 'Last 14 days']];
  async function insightsPage(pid) {
    pageTitle('Program insights');
    const preview = !!pid && !!profile && profile.role === 'admin';
    if (!profile || (profile.role !== 'faculty' && !preview)) { $app.innerHTML = '<div class="card"><h2>Program insights</h2><p class="muted">This page is for program faculty.</p></div>'; return; }
    $app.innerHTML = '<div class="card"><p class="muted">Working out where your residents are weakest...</p></div>';
    const back = preview ? `#/program/${esc(pid)}` : '#/program';
    try {
      const [mine, roster, topics, questions, weekly] = preview
        ? await Promise.all([Cloud.adminPrograms().then(l => l.find(p => p.id === pid) || null), Cloud.previewRoster(pid), Cloud.previewTopics(pid, range), Cloud.previewQuestions(pid, range), Cloud.previewWeekly(pid)])
        : await Promise.all([Cloud.myProgram(), Cloud.facultyRoster(), Cloud.facultyTopics(range), Cloud.facultyQuestions(range), Cloud.facultyWeekly()]);
      if (!mine) { $app.innerHTML = `<div class="card"><h2>Program insights</h2><p class="muted">No program found. <a href="${back}">Back</a></p></div>`; return; }
      const res = roster.filter(r => r.status === 'approved');
      const head = `<p class="crumb"><a href="${back}">Program</a></p><div class="pagehead"><div><h2 class="pagetitle">Program insights</h2><p class="muted">${esc(mine.name)}${preview ? ' (preview as admin)' : ''}</p></div></div>`;
      if (res.length < 3) {
        $app.innerHTML = `${head}<div class="card"><h2>Not enough residents yet</h2><p class="muted">Insights need at least 3 approved residents, so a total can never be one person's results. You have ${res.length}. Approve more requests on the <a href="${back}">Program page</a>.</p></div>`;
        return;
      }
      const lessons = bank.lessons || [], qs = bank.questions || [], ws = Insights.weak(topics).slice(0, 8);
      const recs = ws.map(w => ({ w, rec: Insights.lessonsFor(w, lessons, qs) }));
      const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0), tA = sum(topics, 'attempts'), tC = sum(topics, 'correct'), gA = sum(topics, 'group_attempts'), gC = sum(topics, 'group_correct');
      const active7 = res.filter(r => r.last_active && Date.now() - Date.parse(r.last_active) < 7 * 86400000).length;
      const who = r => r.display_name || r.email, att = Insights.attention(roster, new Date().toISOString().slice(0, 10)), byId = Object.fromEntries(res.map(r => [r.user_id, r]));
      const miss = Insights.missed(questions).filter(m => m.pct < 70).slice(0, 10), wk = Insights.weeks(weekly);
      // lessons that come up for the most weak topics: where to start
      const tally = new Map(); recs.forEach(({ rec }) => rec.forEach(r => { const t = tally.get(r.lesson.id) || { lesson: r.lesson, n: 0 }; t.n++; tally.set(r.lesson.id, t); }));
      const start = [...tally.values()].sort((a, b) => b.n - a.n || a.lesson.title.localeCompare(b.lesson.title)).slice(0, 5);
      const bar = (p, cls) => `<div class="bar insbar ${cls}" aria-hidden="true"><i style="width:${p}%;background:${scoreColor(p)}"></i></div>`;
      const wrongText = m => { if (!m.wrong) return '<span class="muted">-</span>'; const q = bank.byId[m.id], o = q && q.options.find(x => x.id === m.wrong); return `<b>${esc(m.wrong)}</b>${o ? ' ' + esc(o.text.length > 70 ? o.text.slice(0, 69) + '…' : o.text) : ''} <span class="muted small">(${m.wrongShare}% of wrong answers)</span>`; };
      $app.innerHTML = `${head}
        <div class="row" style="margin-bottom:12px"><label for="ins-range" class="sr">Time range</label><select id="ins-range" style="width:auto">${RANGES.map(([d, l]) => `<option value="${d}"${d === range ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <button type="button" id="ins-csv">Download CSV</button><button type="button" id="ins-print">Print report</button></div>
        <div class="grid"><div class="card stat"><b>${res.length}</b><span>Approved residents</span></div><div class="card stat"><b>${active7}</b><span>Active in the last 7 days</span></div>
          <div class="card stat"><b>${tA ? pct(tC, tA) + '%' : '-'}</b><span>Program correct${gA ? ` (all members ${pct(gC, gA)}%)` : ''}</span></div><div class="card stat"><b>${Insights.weak(topics).length}</b><span>Topics under ${Insights.TARGET}%</span></div></div>
        <div class="card" id="ins-weak"><h2>Where your residents are weakest</h2>
          <p class="muted">Topics ranked by how far the program is under ${Insights.TARGET}% and behind all members, how many residents are struggling, and how many answers back it up. A topic needs 10 answers from 3 residents to appear.</p>
          ${recs.length ? `<ol class="weaklist">${recs.map(({ w, rec }) => `<li class="weakitem"><div class="row spread"><b>${esc(w.label)}</b><span class="muted small">${w.attempts} answers &middot; ${w.residents} residents</span></div>
            <div class="weakbars"><div><span class="small">Program <b>${w.pct}%</b></span>${bar(w.pct, 'prog')}</div>${w.group !== null ? `<div><span class="small">All members <b>${w.group}%</b></span>${bar(w.group, 'all')}</div>` : ''}</div>
            <p class="small">${w.low} of ${w.residents} residents are under 60% here${w.behind > 0 ? `, and the program is ${w.behind} point${w.behind === 1 ? '' : 's'} behind all members` : ''}.</p>
            ${rec.length ? `<div class="small"><b>Lessons that would help most:</b><ul class="reclist">${rec.map(r => `<li><a href="#/lesson/${encodeURIComponent(r.lesson.id)}">${esc(r.lesson.title)}</a> <span class="muted">${esc(r.reason)}</span></li>`).join('')}</ul></div>` : '<p class="small"><span class="tag gap">No lesson yet</span> No lesson covers this topic. Ask an administrator to add one.</p>'}</li>`).join('')}</ol>`
            : `<p>${topics.length ? 'No topic is under the target right now. Nice work.' : 'Not enough answers yet to show topics. Topics appear once 3 residents have answered 10 questions in them.'}</p>`}</div>
        ${start.length ? `<div class="card"><h2>Lessons to start with</h2><p class="muted">The lessons that come up for the most weak topics.</p><ul class="reclist">${start.map(t => `<li><a href="#/lesson/${encodeURIComponent(t.lesson.id)}">${esc(t.lesson.title)}</a> <span class="muted">${esc(t.lesson.subject)} &middot; helps with ${t.n} weak topic${t.n === 1 ? '' : 's'}</span></li>`).join('')}</ul></div>` : ''}
        <div class="card"><h2>Questions your program misses most</h2><p class="muted">Questions under 70% correct with at least 5 answers from 3 residents. The wrong answer people pick most is shown when at least 2 chose it.</p>
          ${miss.length ? `<div class="scroll" role="region" tabindex="0" aria-label="Most-missed questions table"><table><caption class="sr">Questions the program misses most</caption><thead><tr><th scope="col">Question</th><th scope="col">Program</th><th scope="col">All members</th><th scope="col">Wrong answer picked most</th></tr></thead>
            <tbody>${miss.map(m => `<tr><td><a href="#/question/${encodeURIComponent(m.id)}">${esc(m.stem.length > 110 ? m.stem.slice(0, 109) + '…' : m.stem)}</a><div class="muted small">${esc(m.subject)}${m.topic ? ' &middot; ' + esc(m.topic) : ''}</div></td><td><b>${m.pct}%</b> <span class="muted small">(${m.attempts})</span></td><td>${m.group === null ? '-' : m.group + '%'}</td><td>${wrongText(m)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No question stands out yet.</p>'}</div>
        ${wk.length >= 2 ? `<div class="card"><h2>Weekly trend</h2><p class="muted">Percent correct for the whole program each week. Last week: ${wk[wk.length - 1].total} answers from ${wk[wk.length - 1].active} resident${wk[wk.length - 1].active === 1 ? '' : 's'}.</p>${trendChart(wk.slice().reverse(), 'weekly program scores')}</div>` : ''}
        <div class="card"><h2>Residents who may need a check-in</h2>${att.length ? `<ul class="reclist">${att.map(a => `<li><b>${esc(who(byId[a.user_id]))}</b> <span class="muted">${a.reasons.map(esc).join('; ')}</span></li>`).join('')}</ul>` : '<p class="muted">Everyone is active and doing fine.</p>'}</div>
        <p class="muted small">These are totals for your approved residents as a group, never one resident's answers by topic. Residents are told this when they join.</p>`;
      document.getElementById('ins-range').onchange = e => { range = +e.target.value; insightsPage(pid); };
      document.getElementById('ins-print').onclick = () => window.print();
      document.getElementById('ins-csv').onclick = () => {
        const head = ['topic', 'subject', 'program_percent', 'answers', 'residents', 'residents_under_60', 'all_members_percent', 'points_behind_all_members', 'lessons_to_assign'];
        const rows = Insights.weak(topics).map(w => [w.topic || w.subject, w.subject, w.pct, w.attempts, w.residents, w.low, w.group === null ? '' : w.group, w.behind === null ? '' : w.behind, Insights.lessonsFor(w, lessons, qs).map(r => r.lesson.title).join('; ')]);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' }));
        a.download = 'program-weaknesses-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      };
    } catch (e) { $app.innerHTML = `<div class="card"><h2>Program insights</h2><p class="muted">Could not load: ${esc(e.offline ? 'you are offline' : /schema cache|does not exist|Could not find/i.test(e.message || '') ? 'the database has not been upgraded for insights yet. Ask an administrator to run the latest schema.' : e.message)}</p></div>`; }
  }

  // ------------------------------------------------------------------ admin: program list (inside Admin > Overview)
  async function mountAdmin(box, members) {
    if (!box) return;
    let list; try { list = await Cloud.adminPrograms(); } catch (e) { box.innerHTML = ''; return; }        // old database: hide quietly
    const count = (id, fn) => members.filter(m => m.program_id === id && fn(m)).length;
    box.innerHTML = `<div class="card"><h2>Residency programs</h2>
      <p class="muted">Residents choose their program when they create an account (or in Settings) and its faculty approve them. Make someone faculty by editing their row under Approved emails and choosing the role <b>faculty</b> and a program. <b>View as faculty</b> opens a program the way its faculty see it, and lets you approve, decline and remove there too.</p>
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
  return { mountSettings, facultyPage, insightsPage, mountAdmin, options, NOTICE, slug };
})();
