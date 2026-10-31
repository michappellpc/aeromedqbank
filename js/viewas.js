'use strict';
// Admin only: a switch in the header to look at the app the way a reviewer sees it, or the way each residency program's faculty see it. It changes only what is shown
// (the menu, the Admin tabs and the Dashboard); it never changes what the account is allowed to do, which the database decides. Loaded after cloud.js; uses app.js globals.
const ViewAs = (() => {
  let programs = [];
  const real = () => (profile && profile.role) || '';
  const keyName = () => 'qbank.viewas.' + (((typeof Cloud !== 'undefined' && Cloud.session && Cloud.session.email) || '').toLowerCase());
  const read = () => { try { return localStorage.getItem(keyName()) || 'admin'; } catch { return 'admin'; } };
  // 'admin', 'reviewer' or 'faculty:<program id>'; anything else (or a program that no longer exists) is 'admin'
  const get = () => {
    if (real() !== 'admin') return 'admin';
    const v = read();
    return v === 'reviewer' || (v.startsWith('faculty:') && programs.some(p => p.id === v.slice(8))) ? v : 'admin';
  };
  // The role the screens should show: the real one, except an admin who chose another view
  const role = () => { if (real() !== 'admin') return real(); const v = get(); return v === 'reviewer' ? 'reviewer' : v.startsWith('faculty:') ? 'faculty' : 'admin'; };
  const pid = () => { const v = get(); return v.startsWith('faculty:') ? v.slice(8) : ''; };
  const label = () => { const v = get(); return v === 'reviewer' ? 'Reviewer' : v.startsWith('faculty:') ? 'Faculty: ' + ((programs.find(p => p.id === v.slice(8)) || {}).name || v.slice(8)) : 'Admin'; };
  const box = () => document.getElementById('viewsw'), btn = () => document.getElementById('viewsw-btn'), menu = () => document.getElementById('viewsw-menu');

  // The Admin link in the menu: Admin for an admin, Questions for a reviewer, none for faculty and members
  function applyNav() {
    const a = document.getElementById('nav-admin'); if (!a || !profile) return;
    const r = role(), editor = r === 'admin' || r === 'reviewer';
    a.hidden = !editor;
    a.innerHTML = (r === 'admin' ? 'Admin' : 'Questions') + '<span id="inbox-badge" class="navbadge" hidden></span>';
    a.setAttribute('href', r === 'admin' ? '#/admin' : '#/admin/questions');
    const c = document.getElementById('viewsw-cur'); if (c) c.textContent = label();
    const m = menu(); if (m) m.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === get())));
  }
  const close = back => { const b = btn(), m = menu(); if (!b || !m) return; m.hidden = true; b.setAttribute('aria-expanded', 'false'); if (back) b.focus(); };
  document.addEventListener('click', e => { const m = menu(); if (m && !m.hidden && !e.target.closest('#viewsw')) close(); });
  document.addEventListener('keydown', e => { const m = menu(); if (e.key === 'Escape' && m && !m.hidden) { e.stopPropagation(); close(true); } });
  window.addEventListener('hashchange', () => close());

  function choose(v) {
    try { localStorage.setItem(keyName(), v); } catch { /* not remembered */ }
    close(); applyNav(); if (typeof refreshInboxBadge === 'function') refreshInboxBadge();
    const to = v === 'reviewer' ? '#/admin/questions' : v.startsWith('faculty:') ? '#/program/' + encodeURIComponent(v.slice(8)) + '/dashboard' : '#/admin';
    if (location.hash === to) route(); else location.hash = to;
  }

  async function setup() {
    const b = box(); if (!b) return;
    if (real() !== 'admin') { b.hidden = true; programs = []; applyNav(); return; }
    programs = (await Cloud.adminPrograms().catch(() => [])).filter(p => p.active !== false);
    if (real() !== 'admin') return;                                          // signed out while it loaded
    const m = menu(), t = btn();
    m.innerHTML = `<div class="mhead">View the app as</div>
      <button type="button" role="menuitemradio" data-v="admin">Admin<span class="muted small">Everything</span></button>
      <button type="button" role="menuitemradio" data-v="reviewer">Reviewer<span class="muted small">Questions, lessons, flashcards and the inbox</span></button>
      ${programs.length ? `<hr><div class="mhead">Faculty, by program</div>${programs.map(p => `<button type="button" role="menuitemradio" data-v="faculty:${esc(p.id)}">${esc(p.name)}</button>`).join('')}` : ''}`;
    m.querySelectorAll('[data-v]').forEach(x => { x.onclick = () => choose(x.dataset.v); });
    t.onclick = () => { const open = m.hidden; m.hidden = !open; t.setAttribute('aria-expanded', String(open)); if (open) { const cur = m.querySelector('[aria-checked="true"]') || m.querySelector('[data-v]'); if (cur) cur.focus(); } };
    m.addEventListener('keydown', e => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault(); const items = [...m.querySelectorAll('[data-v]')], i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); });
    b.hidden = false; applyNav();
  }
  return { setup, applyNav, get, role, pid, label, close };
})();
