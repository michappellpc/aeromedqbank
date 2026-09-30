// Supabase Edge Function "member-admin".
// Lets a signed-in ADMIN create a member's account, reset a password, or delete an account from the app's Admin page, so nobody has to open
// Supabase for it. It runs on Supabase's servers with the project's service key, which never reaches the browser.
// Deploy: Supabase > Edge Functions > Deploy a new function > "Via Editor", name it member-admin, paste this file, Deploy.
// Then open the function's Settings and turn OFF "Verify JWT with legacy secret" (this function checks the caller itself).
// (Plain JavaScript on purpose: it runs unchanged in Deno and in the tests.)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const BASE = Deno.env.get('SUPABASE_URL');
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SERVICE = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

// A temporary password: 12 characters from an alphabet without look-alikes (no 0/O, 1/l/I), shown to the admin once.
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

async function callerIsAdmin(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { status: 401, error: 'Please sign in again.' };
  const who = await fetch(BASE + '/auth/v1/user', { headers: { apikey: KEY, Authorization: 'Bearer ' + token } });
  if (!who.ok) return { status: 401, error: 'Please sign in again.' };
  const me = await who.json();
  const rows = await (await fetch(`${BASE}/rest/v1/profiles?select=role,active&id=eq.${encodeURIComponent(me.id)}`, { headers: SERVICE })).json();
  if (!Array.isArray(rows) || !rows[0] || rows[0].role !== 'admin' || !rows[0].active) return { status: 403, error: 'Only administrators can do this.' };
  return { me };
}

const handler = async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only.' });
  try {
    const auth = await callerIsAdmin(req);
    if (auth.error) return reply(auth.status, { error: auth.error });
    let body; try { body = await req.json(); } catch { return reply(400, { error: 'Bad request.' }); }
    const email = String(body.email || '').trim().toLowerCase();
    if (body.action === 'delete' && email === String(auth.me.email || '').toLowerCase()) return reply(400, { error: 'You cannot delete your own account.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return reply(400, { error: 'That does not look like an email address.' });

    if (body.action === 'create') {
      const role = body.role || 'member', plan = body.plan || 'pro';
      if (!['member', 'reviewer', 'faculty', 'admin'].includes(role) || !['free', 'pro'].includes(plan)) return reply(400, { error: 'Unknown role or plan.' });
      const note = body.note ? String(body.note).slice(0, 80) : null;
      const program_id = body.program_id ? String(body.program_id).slice(0, 60) : null;
      if (role === 'faculty' && !program_id) return reply(400, { error: 'Faculty need a program.' });
      // 1. approve the email (this also switches on an account that already exists)
      const ap = await fetch(BASE + '/rest/v1/allowed_emails?on_conflict=email', { method: 'POST', headers: { ...SERVICE, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([program_id ? { email, role, plan, note, program_id } : { email, role, plan, note }]) });
      if (!ap.ok) return reply(500, { error: 'Could not save the approval.' });
      // 2. create the account with a temporary password; the person must choose their own at first sign-in
      const password = tempPassword();
      const mk = await fetch(BASE + '/auth/v1/admin/users', { method: 'POST', headers: SERVICE, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { must_change_password: true }, app_metadata: { invited: 'true' } }) });
      if (mk.status === 422 || mk.status === 409) return reply(200, { ok: true, existed: true, email });
      if (!mk.ok) return reply(500, { error: 'The email was approved but the account could not be created.' });
      return reply(200, { ok: true, existed: false, email, password });
    }

    if (body.action === 'reset') {
      const rows = await (await fetch(`${BASE}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}`, { headers: SERVICE })).json();
      if (!Array.isArray(rows) || !rows[0]) return reply(404, { error: 'That person has not got an account yet. Use Add member first.' });
      const password = tempPassword();
      const up = await fetch(`${BASE}/auth/v1/admin/users/${rows[0].id}`, { method: 'PUT', headers: SERVICE, body: JSON.stringify({ password, user_metadata: { must_change_password: true } }) });
      if (!up.ok) return reply(500, { error: 'Could not reset the password.' });
      return reply(200, { ok: true, email, password });
    }
    if (body.action === 'delete') {
      const rows = await (await fetch(`${BASE}/rest/v1/profiles?select=id,role,active&email=eq.${encodeURIComponent(email)}`, { headers: SERVICE })).json();
      const target = Array.isArray(rows) ? rows[0] : null;
      if (target && target.role === 'admin') {                          // never remove the last way into the Admin page
        const admins = await (await fetch(`${BASE}/rest/v1/profiles?select=id&role=eq.admin&active=eq.true`, { headers: SERVICE })).json();
        if (!Array.isArray(admins) || admins.filter(a => a.id !== target.id).length < 1) return reply(400, { error: 'That is the only administrator. Make someone else an administrator first.' });
      }
      await fetch(`${BASE}/rest/v1/allowed_emails?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: SERVICE });
      if (target) {
        const del = await fetch(`${BASE}/auth/v1/admin/users/${target.id}`, { method: 'DELETE', headers: SERVICE });
        if (!del.ok) return reply(500, { error: 'Access was removed but the account could not be deleted.' });
      }
      return reply(200, { ok: true, email, hadAccount: !!target });
    }
    return reply(400, { error: 'Unknown action.' });
  } catch (e) {
    return reply(500, { error: 'Something went wrong on the server.' });
  }
};

Deno.serve(handler);
