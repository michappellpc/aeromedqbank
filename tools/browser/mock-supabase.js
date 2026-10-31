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
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  let data = ''; req.on('data', c => data += c); req.on('end', () => {
    const url = new URL(req.url, 'http://x'), p = url.pathname; let body = {}; try { body = JSON.parse(data || '{}'); } catch { /* none */ }
    if (p === '/auth/v1/token') { const u = USERS[(body.email || '').toLowerCase()]; if (!u || u.pw !== body.password) return send(res, 400, { error: 'invalid_grant', msg: 'bad' }); return send(res, 200, { access_token: jwt(u.id, body.email), refresh_token: 'r', expires_in: 36000, user: { id: u.id, email: body.email } }); }
    if (p === '/auth/v1/user') { const w = byToken(req); return w ? send(res, 200, { id: w[1].id, email: w[0] }) : send(res, 401, { msg: 'no' }); }
    const w = byToken(req), me = w ? { email: w[0], ...w[1] } : null;
    if (p === '/rest/v1/profiles') return send(res, 200, me ? [{ email: me.email, display_name: null, role: me.role, plan: 'pro', pro_until: null, active: true }] : []);
    if (p === '/rest/v1/programs') return send(res, 200, PROGS);
    if (p === '/rest/v1/questions') return send(res, 200, Q);
    if (p.startsWith('/rest/v1/rpc/')) {
      const n = p.slice(13);
      if (n === 'program_list') return send(res, 200, PROGS.filter(x => x.active).map(({ id, name }) => ({ id, name })));
      if (n === 'peer_min_users') return send(res, 200, 10);
      if (n === 'signup_open') return send(res, 200, true);
      if (n === 'feedback_unread_count' || n === 'my_unread_replies') return send(res, 200, 0);
      if (n === 'my_program') return send(res, 200, me && me.role === 'faculty' ? [{ id: 'prog-one', name: 'Program One', status: 'approved' }] : []);
      if (n === 'admin_member_summary') return send(res, 200, [{ user_id: 'ad', email: 'admin@x', role: 'admin', plan: 'pro', active: true, attempts: 0, correct: 0 }]);
      return send(res, 200, []);
    }
    if (req.method === 'GET') return send(res, 200, []);
    send(res, 204);
  });
}).listen(9998, () => console.log('mock ready'));
