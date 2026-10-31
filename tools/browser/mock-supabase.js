// A tiny stand-in for Supabase on port 9998 for the browser tests in this folder: sign in as admin@x / rev@x / fac@x / m@x and open the admin, reviewer and faculty-preview screens.
// A tiny stand-in for Supabase, enough to sign in and open the admin, reviewer and faculty-preview screens.
const http = require('http');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, email) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, exp: Math.floor(Date.now() / 1000) + 36000, role: 'authenticated' })}.sig`;
const USERS = { 'admin@x': { id: 'ad', pw: 'pw-admin-1', role: 'admin' }, 'rev@x': { id: 're', pw: 'pw-rev-1', role: 'reviewer' }, 'fac@x': { id: 'fa', pw: 'pw-fac-1', role: 'faculty' }, 'm@x': { id: 'me', pw: 'pw-m-1', role: 'member' } };
const PROGS = [{ id: 'prog-one', name: 'Program One', active: true, created_at: '2026-01-01T00:00:00Z' }, { id: 'prog-two', name: 'Program Two', active: true, created_at: '2026-01-01T00:00:00Z' }, { id: 'prog-old', name: 'Retired Program', active: false, created_at: '2026-01-01T00:00:00Z' }];
const Q = [1, 2, 3].map(i => ({ id: 'q-' + i, status: 'reviewed', reviewed_by: 'T', boards: ['aem'], subject: 'Altitude & Decompression', topic: 'T' + i, difficulty: 2, stem: 'Question ' + i + '?', options: [{ id: 'A', text: 'Right' }, { id: 'B', text: 'Wrong' }], answer: 'A', explanation: 'Because.', refs: ['Ref'], tier: 'free', archived: false, updated_by: 'seed', updated_at: '2026-01-01T00:00:00Z' }));
const byToken = req => { const t = (req.headers.authorization || '').replace('Bearer ', ''); try { const c = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); return Object.entries(USERS).find(([e]) => e === c.email); } catch { return null; } };
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const CR = [], LOG = []; let CRID = 1;       // reviewer proposals (like the change_requests table) and a log of direct writes to the bank
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  let data = ''; req.on('data', c => data += c); req.on('end', () => {
    const url = new URL(req.url, 'http://x'), p = url.pathname; let body = {}; try { body = JSON.parse(data || '{}'); } catch { /* none */ }
    if (p === '/auth/v1/token') { const u = USERS[(body.email || '').toLowerCase()]; if (!u || u.pw !== body.password) return send(res, 400, { error: 'invalid_grant', msg: 'bad' }); return send(res, 200, { access_token: jwt(u.id, body.email), refresh_token: 'r', expires_in: 36000, user: { id: u.id, email: body.email } }); }
    if (p === '/auth/v1/user') { const w = byToken(req); return w ? send(res, 200, { id: w[1].id, email: w[0] }) : send(res, 401, { msg: 'no' }); }
    const w = byToken(req), me = w ? { email: w[0], ...w[1] } : null;
    if (p === '/rest/v1/profiles') return send(res, 200, me ? [{ email: me.email, display_name: null, role: me.role, plan: 'pro', pro_until: null, active: true }] : []);
    if (p === '/rest/v1/programs') return send(res, 200, PROGS);
    if (p === '/__log') return send(res, 200, LOG);
    if (p === '/rest/v1/questions') { if (req.method !== 'GET') { LOG.push(req.method + ' questions'); return send(res, 204); } return send(res, 200, Q); }
    if (p === '/rest/v1/change_requests') { const st = (url.searchParams.get('status') || '').replace('eq.', ''); return send(res, 200, CR.filter(r => me && (me.role === 'admin' || r.author_email === me.email) && (!st || r.status === st)).slice().reverse()); }
    if (p.startsWith('/rest/v1/rpc/')) {
      const n = p.slice(13);
      if (n === 'program_list') return send(res, 200, PROGS.filter(x => x.active).map(({ id, name }) => ({ id, name })));
      if (n === 'peer_min_users') return send(res, 200, 10);
      if (n === 'signup_open') return send(res, 200, true);
      if (n === 'feedback_unread_count' || n === 'my_unread_replies') return send(res, 200, 0);
      if (n === 'pending_change_count') return send(res, 200, CR.filter(r => r.status === 'pending' && me && (me.role === 'admin' || r.author_email === me.email)).length);
      if (n === 'admin_question_stats') return send(res, 200, Q.map((q, i) => ({ question_id: q.id, subject: q.subject, status: q.status, archived: false, attempts: 20 * (i + 1), correct: 10 * (i + 1) - i, pct_correct: 50, bank: 'main' })));
      if (n === 'submit_change') {
        const live = body.p_kind === 'question' ? Q.find(q => q.id === body.p_item_id) : null;
        const pay = { ...body.p_payload, ...(body.p_action === 'new' ? { status: 'draft', archived: false } : live ? { status: live.status, archived: live.archived } : {}) };
        const old = CR.find(r => r.status === 'pending' && r.author_email === me.email && r.kind === body.p_kind && r.item_id === body.p_item_id);
        const row = { id: old ? old.id : CRID++, kind: body.p_kind, item_id: body.p_item_id, action: body.p_action, payload: pay, base_updated_at: live ? live.updated_at : null, author_email: me.email, note: body.p_note || '', status: 'pending', decision_note: '', created_at: new Date().toISOString() };
        if (old) CR.splice(CR.indexOf(old), 1, row); else CR.push(row); return send(res, 200, row.id);
      }
      if (n === 'accept_change' || n === 'reject_change' || n === 'withdraw_change') {
        const r = CR.find(x => x.id === body.p_id); if (!r || (me.role !== 'admin' && n !== 'withdraw_change')) return send(res, 400, { message: 'admins only' });
        if (n === 'withdraw_change') { CR.splice(CR.indexOf(r), 1); return send(res, 200, null); }
        r.status = n === 'accept_change' ? 'accepted' : 'rejected'; r.decided_by = me.email; r.decided_at = new Date().toISOString(); r.decision_note = body.p_note || '';
        if (n === 'accept_change' && r.kind === 'question') { const pay = { ...(body.p_payload || r.payload), ...(body.p_status ? { status: body.p_status } : {}) }, i = Q.findIndex(q => q.id === r.item_id); if (i >= 0) Q[i] = { ...Q[i], ...pay }; else Q.push({ archived: false, updated_at: new Date().toISOString(), ...pay }); LOG.push('accepted ' + r.item_id + ' as ' + pay.status); }
        return send(res, 200, null);
      }
      if (n === 'my_program') return send(res, 200, me && me.role === 'faculty' ? [{ id: 'prog-one', name: 'Program One', status: 'approved' }] : []);
      if (n === 'admin_member_summary') return send(res, 200, [{ user_id: 'ad', email: 'admin@x', role: 'admin', plan: 'pro', active: true, attempts: 0, correct: 0 }]);
      return send(res, 200, []);
    }
    if (req.method === 'GET') return send(res, 200, []);
    send(res, 204);
  });
}).listen(9998, () => console.log('mock ready'));
