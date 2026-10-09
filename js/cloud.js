'use strict';
// Cloud accounts (Supabase). Completely off unless data/config.json has supabase.url and supabase.anonKey,
// in which case the app requires sign-in and keeps questions and progress in the private database.
// Progress is offline-first: the device is the working copy, changes are queued and sent when online.
const Cloud = (() => {
  let cfg = null, session = null, refreshing = null, syncing = null, timer = null, lastSync = 0, onAuthLost = () => {};
  const S_KEY = 'qbank.session';
  const now = () => Math.floor(Date.now() / 1000);
  const jget = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const jdel = k => { try { localStorage.removeItem(k); } catch {} };
  const claims = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; } };
  const uid = () => session && session.uid;
  const qKey = () => `qbank.queue.${uid()}`;
  const pKey = () => `qbank.profile.${uid()}`;

  // ---- tiny IndexedDB key/value store for the question cache (too big for localStorage) ----
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('qbank', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const kv = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', mode), out = fn(tx.objectStore('kv')); tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error); }); };
  const cacheGet = k => kv('readonly', s => s.get(k)).catch(() => null);
  const cacheSet = (k, v) => kv('readwrite', s => s.put(v, k)).catch(() => {});
  const cacheClear = () => kv('readwrite', s => s.clear()).catch(() => {});

  const authError = m => Object.assign(new Error(m || 'Please sign in again.'), { auth: true });
  const offlineError = () => Object.assign(new Error('No connection.'), { offline: true });

  async function raw(path, { method = 'GET', body, headers = {}, bearer } = {}) {
    // Newer Supabase keys (sb_publishable_...) are not JWTs and must only be sent in the apikey header.
    const h = { apikey: cfg.key, ...headers }, auth = bearer || (cfg.key.split('.').length === 3 ? cfg.key : '');
    if (auth) h.Authorization = 'Bearer ' + auth;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    let res;
    try { res = await fetch(cfg.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw offlineError(); }
    if (res.ok) { const t = await res.text(); try { return t ? JSON.parse(t) : null; } catch { return t; } }
    let msg = ''; try { const j = await res.json(); msg = j.msg || j.message || j.error_description || j.error || ''; } catch {}
    throw Object.assign(new Error(msg || `Request failed (${res.status})`), { status: res.status });
  }

  async function blobApi(path, retried = false) {
    let res;
    try { res = await fetch(cfg.url + path, { headers: { apikey: cfg.key, Authorization: 'Bearer ' + await token() } }); }
    catch (e) { throw e.auth ? e : offlineError(); }
    if (res.status === 401 && !retried && session) { session.expires_at = 0; await refresh(); return blobApi(path, true); }
    if (!res.ok) throw Object.assign(new Error('Image unavailable'), { status: res.status });
    return res.blob();
  }
  const imageUrls = new Map();   // path -> object URL, so a picture is only fetched once per visit

  function setSession(r) {
    const c = claims(r.access_token);
    session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at || now() + (r.expires_in || 3600), uid: (r.user && r.user.id) || c.sub, email: (r.user && r.user.email) || c.email,
      must: r.user ? !!(r.user.user_metadata && r.user.user_metadata.must_change_password) : !!(session && session.must) };
    jset(S_KEY, session);
  }
  function clearSession() { session = null; jdel(S_KEY); }

  async function refresh() {
    if (!session) throw authError();
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try { setSession(await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })); }
      catch (e) {
        if (e.offline) { if (session.expires_at > now()) return; throw e; }
        if (e.status === 400 || e.status === 401 || e.status === 403) { clearSession(); onAuthLost(); throw authError(); }
        throw e;
      } finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function token() {
    if (!session) throw authError();
    if (session.expires_at - now() < 60) await refresh();
    return session.access_token;
  }
  async function api(path, opts = {}, retried = false) {
    try { return await raw(path, { ...opts, bearer: await token() }); }
    catch (e) {
      if (e.status === 401 && !retried && session) { session.expires_at = 0; await refresh(); return api(path, opts, true); }
      throw e;
    }
  }

  // ---- queue of changes not yet on the server ----
  const blankQueue = () => ({ attempts: [], marks: {}, tests: {}, settings: null, reset: false, feedback: [], cards: {}, hl: {}, mine: {} });
  const queue = () => Object.assign(blankQueue(), jget(qKey()) || {});
  const saveQueue = q => jset(qKey(), q);
  const pending = () => { const q = queue(); return q.attempts.length + Object.keys(q.marks).length + Object.keys(q.tests).length + (q.settings ? 1 : 0) + (q.reset ? 1 : 0) + (q.feedback || []).length + Object.keys(q.cards || {}).length + Object.keys(q.hl || {}).length + Object.keys(q.mine || {}).length; };
  const cid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function change(fn) { if (!cfg || !session) return; const q = queue(); fn(q); saveQueue(q); schedule(); }
  function schedule(ms = 2500) { if (!cfg || !session) return; clearTimeout(timer); timer = setTimeout(() => sync().catch(() => {}), ms); }

  async function flush() {
    let q = queue();
    if (q.reset) { await api('/rest/v1/rpc/reset_my_progress', { method: 'POST', body: {} }); q = queue(); q.reset = false; saveQueue(q); }
    while ((q = queue()).attempts.length) {
      const batch = q.attempts.slice(0, 200), send = rows => api('/rest/v1/attempts?on_conflict=user_id,client_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: rows });
      if (noChosenColumn) await send(batch.map(({ chosen, ...rest }) => rest));
      else {
        try { await send(batch); }
        catch (e) {                                                            // database not upgraded yet: send scores without the picked option
          if (!(e.status === 400 && /chosen/i.test(e.message || ''))) throw e;
          noChosenColumn = true; await send(batch.map(({ chosen, ...rest }) => rest));
        }
      }
      q = queue(); q.attempts = q.attempts.slice(batch.length); saveQueue(q);
    }
    q = queue();
    const marks = Object.entries(q.marks).map(([question_id, m]) => ({ question_id, ...m }));
    if (marks.length) { await api('/rest/v1/question_marks?on_conflict=user_id,question_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: marks }); q = queue(); marks.forEach(m => { if (q.marks[m.question_id] && q.marks[m.question_id].updated_at === m.updated_at) delete q.marks[m.question_id]; }); saveQueue(q); }
    q = queue();
    const cardRows = Object.entries(q.cards || {}).map(([card_id, c]) => ({ card_id, ease: c.e, interval_days: c.i, due: c.due, reps: c.reps, lapses: c.lapses, last_reviewed: c.last || null, updated_at: new Date().toISOString() }));
    if (cardRows.length) {                                                // review schedules; kept if the database is not upgraded yet, and a card that was deleted is simply dropped
      const send = rows => api('/rest/v1/card_reviews?on_conflict=user_id,card_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows.map(r => ({ ...r, user_id: uid() })) });
      const done = ids => { const z = queue(); ids.forEach(id => delete z.cards[id]); saveQueue(z); };
      try { await send(cardRows); done(cardRows.map(r => r.card_id)); }
      catch (e) {
        if (noCardsTable(e)) { /* keep them for later */ }
        else if (e.status === 409 || e.status === 400 || e.status === 403) { for (const r of cardRows) { try { await send([r]); } catch (x) { if (x.offline || x.status >= 500) throw x; } done([r.card_id]); } }
        else throw e;
      }
    }
    for (const [key, table] of [['hl', 'highlights'], ['mine', 'my_cards']]) {   // highlights and own cards: a row to save, or null to delete
      q = queue(); const ents = Object.entries(q[key] || {}); if (!ents.length) continue;
      const done = list => { const z = queue(); list.forEach(([id, v]) => { if (JSON.stringify((z[key] || {})[id]) === JSON.stringify(v)) delete z[key][id]; }); saveQueue(z); };
      const ups = ents.filter(([, v]) => v), dels = ents.filter(([, v]) => !v);
      try {
        for (let i = 0; i < ups.length; i += 100) { const part = ups.slice(i, i + 100); await api(`/rest/v1/${table}?on_conflict=id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: part.map(([, v]) => v) }); done(part); }
        if (dels.length) { await api(`/rest/v1/${table}?id=in.(${dels.map(([id]) => id).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); done(dels); }
      } catch (e) {
        if (noOwnTable(e)) continue;                                        // not upgraded yet: keep them for later
        if (e.status === 400 || e.status === 403 || e.status === 409) { for (const ent of ups) { try { await api(`/rest/v1/${table}?on_conflict=id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [ent[1]] }); } catch (x) { if (x.offline || x.status >= 500) throw x; } done([ent]); } }   // one bad row (over the limit, say) must not block the rest
        else throw e;
      }
    }
    q = queue();
    const tests = Object.values(q.tests);
    if (tests.length) {
      await api('/rest/v1/tests?on_conflict=user_id,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: tests.map(t => ({ id: t.id, taken_at: new Date(t.date).toISOString(), mode: t.mode, qids: t.qids, answers: t.answers, correct: t.correct, total: t.total, seconds: t.seconds })) });
      q = queue(); tests.forEach(t => delete q.tests[t.id]); saveQueue(q);
    }
    while ((q = queue()).feedback.length) {                                    // messages to the team (kept, not lost, if the database is not upgraded yet)
      const batch = q.feedback.slice(0, 20);
      try { await api('/rest/v1/feedback?on_conflict=user_id,client_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: batch }); }
      catch (e) {
        if (e.status === 404 || /schema cache|relation .*feedback/i.test(e.message || '')) break;   // feedback table not there yet: try again after the upgrade
        if (e.status === 400 || e.status === 403) { /* refused (too many today, or not allowed): do not retry forever */ }
        else throw e;
      }
      q = queue(); q.feedback = q.feedback.slice(batch.length); saveQueue(q);
    }
    q = queue();
    if (q.settings) {
      const s = q.settings;
      await api('/rest/v1/user_settings?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [{ data: s.data, updated_at: s.updated_at }] });
      q = queue(); if (q.settings && q.settings.updated_at === s.updated_at) q.settings = null; saveQueue(q);
    }
  }

  const blankStat = () => ({ seen: 0, correct: 0, wrong: 0, flagged: false, note: '', last: null });
  async function pull() {
    const cardRes = await api('/rest/v1/card_reviews?select=card_id,ease,interval_days,due,reps,lapses,last_reviewed&limit=5000').catch(e => { if (noCardsTable(e)) return null; throw e; });
    const hlRes = await api('/rest/v1/highlights?select=id,kind,item_id,field,start_pos,end_pos,text_hl&limit=5000').catch(e => { if (noOwnTable(e)) return null; throw e; });
    const mineRes = await api('/rest/v1/my_cards?select=id,front,back,src_kind,src_id,ease,interval_days,due,reps,lapses,last_reviewed&limit=3000').catch(e => { if (noOwnTable(e)) return null; throw e; });
    const [prog, marks, tests, settings] = await Promise.all([
      api('/rest/v1/rpc/my_progress', { method: 'POST', body: {} }),
      api('/rest/v1/question_marks?select=question_id,flagged,note'),
      api('/rest/v1/tests?select=*&order=taken_at.desc&limit=500'),
      api('/rest/v1/user_settings?select=data&limit=1')
    ]);
    const Q = queue(), q = {};
    (prog || []).forEach(r => { q[r.question_id] = { ...blankStat(), seen: r.seen, correct: r.correct, wrong: r.wrong, last: r.last_ok ? 'c' : 'w' }; });
    Q.attempts.forEach(a => { const s = q[a.question_id] ||= blankStat(); s.seen++; a.ok ? s.correct++ : s.wrong++; s.last = a.ok ? 'c' : 'w'; });
    (marks || []).forEach(m => { const s = q[m.question_id] ||= blankStat(); s.flagged = m.flagged; s.note = m.note; });
    Object.entries(Q.marks).forEach(([id, m]) => { const s = q[id] ||= blankStat(); s.flagged = m.flagged; s.note = m.note; });
    const byId = new Map();
    (tests || []).forEach(t => byId.set(t.id, { id: t.id, date: Date.parse(t.taken_at), mode: t.mode, qids: t.qids, answers: t.answers, correct: t.correct, total: t.total, seconds: t.seconds }));
    Object.values(Q.tests).forEach(t => byId.set(t.id, t));
    const d = Store.data;
    if (cardRes) { const cs = {}; cardRes.forEach(r => { cs[r.card_id] = { e: r.ease, i: r.interval_days, due: r.due, reps: r.reps, lapses: r.lapses, last: r.last_reviewed }; }); Object.assign(cs, Q.cards || {}); Object.entries(d.cards || {}).forEach(([k, v]) => { if (k.startsWith('my:')) cs[k] = v; }); d.cards = cs; }
    if (hlRes) { const m = {}; hlRes.forEach(r => { m[r.id] = hlFromRow(r); }); Object.entries(Q.hl || {}).forEach(([id, row]) => { if (row) m[id] = hlFromRow(row); else delete m[id]; }); d.hl = m; }
    if (mineRes) {
      const m = {}, st = {}; mineRes.forEach(r => { m[r.id] = mineFromRow(r); if (r.due) st['my:' + r.id] = { e: r.ease, i: r.interval_days, due: r.due, reps: r.reps, lapses: r.lapses, last: r.last_reviewed }; });
      Object.entries(Q.mine || {}).forEach(([id, row]) => { if (!row) { delete m[id]; delete st['my:' + id]; return; } m[id] = mineFromRow(row); if (row.due) st['my:' + id] = { e: row.ease, i: row.interval_days, due: row.due, reps: row.reps, lapses: row.lapses, last: row.last_reviewed }; else delete st['my:' + id]; });
      d.mine = m; d.cards = { ...(d.cards || {}) }; Object.keys(d.cards).forEach(k => { if (k.startsWith('my:')) delete d.cards[k]; }); Object.assign(d.cards, st);
    }
    d.q = q; d.tests = [...byId.values()].sort((a, b) => b.date - a.date);
    if (!Q.settings && settings && settings[0]) {
      const { active: remoteActive, parked: remoteParked, activeAt: remoteAt, ...rest } = settings[0].data || {};
      d.settings = { ...d.settings, ...rest };
      if ((remoteAt || 0) > (d.activeAt || 0)) { d.active = remoteActive || null; d.parked = Array.isArray(remoteParked) ? remoteParked : []; d.activeAt = remoteAt; }      // the newest copy of the quiz in progress wins, including one that has been finished since
    }
    Store.save();
  }

  async function sync() {
    if (!cfg || !session) return;
    if (syncing) return syncing;
    syncing = (async () => {
      try { await flush(); await pull(); lastSync = Date.now(); api('/rest/v1/rpc/touch_seen', { method: 'POST', body: {} }).catch(() => {}); }
      finally { syncing = null; }
    })();
    return syncing;
  }

  const toQuestion = r => ({
    id: r.id, status: r.status, reviewedBy: r.reviewed_by || undefined, boards: r.boards, subject: r.subject, topic: r.topic || '',
    difficulty: r.difficulty || 2, stem: r.stem, image: r.image || undefined, imageAlt: r.image_alt || undefined,
    options: r.options, answer: r.answer, explanation: r.explanation, optionNotes: r.option_notes || undefined, references: r.refs || [], tier: r.tier, lessonId: r.lesson_id || undefined, objectives: r.objectives && r.objectives.length ? r.objectives : undefined
  });

  const toEditorQuestion = r => ({ ...toQuestion(r), archived: !!r.archived, updatedAt: r.updated_at, updatedBy: r.updated_by || '' });
  // app question -> database row. reviewed_by is deliberately not sent: the database records who reviewed.
  const toRow = q => {
    const row = { id: q.id, status: q.status, boards: q.boards, subject: q.subject, topic: q.topic || null, difficulty: q.difficulty || null, stem: q.stem,
      image: q.image || null, image_alt: q.imageAlt || null, options: q.options, answer: q.answer, explanation: q.explanation, option_notes: q.optionNotes || null,
      refs: q.references || [], tier: q.tier || 'pro' };
    if (typeof q.archived === 'boolean') row.archived = q.archived;
    if (q.lessonId !== undefined) row.lesson_id = q.lessonId || null;      // only sent when set or cleared, so an older database is not troubled
    if (q.objectives !== undefined) row.objectives = q.objectives || [];     // same: only sent when set or cleared
    return row;
  };
  let noChosenColumn = false;
  const inList = ids => '(' + ids.map(i => '"' + String(i).replace(/"/g, '') + '"').join(',') + ')';
  // ---- flashcards ----
  const toCard = r => ({ id: r.id, status: r.status, reviewedBy: r.reviewed_by || undefined, boards: r.boards, subject: r.subject, topic: r.topic || '', front: r.front, back: r.back, lessonId: r.lesson_id || undefined, objectives: r.objectives && r.objectives.length ? r.objectives : undefined, references: r.refs || [] });
  const toEditorCard = r => ({ ...toCard(r), archived: !!r.archived, updatedAt: r.updated_at, updatedBy: r.updated_by || '' });
  const toCardRow = c => { const row = { id: c.id, status: c.status, boards: c.boards, subject: c.subject, topic: c.topic || null, front: c.front, back: c.back, lesson_id: c.lessonId || null, refs: c.references || [] }; if (typeof c.archived === 'boolean') row.archived = c.archived; if (c.objectives !== undefined) row.objectives = c.objectives || []; return row; };
  // ---- lessons ----
  const toLesson = r => ({ id: r.id, status: r.status, reviewedBy: r.reviewed_by || undefined, boards: r.boards, subject: r.subject, title: r.title, summary: r.summary || '',
    order: r.position, blocks: r.blocks || [], references: r.refs || [], tier: r.tier, objectives: r.objectives && r.objectives.length ? r.objectives : undefined });
  const toEditorLesson = r => ({ ...toLesson(r), archived: !!r.archived, updatedAt: r.updated_at, updatedBy: r.updated_by || '' });
  const toLessonRow = l => { const row = { id: l.id, status: l.status, boards: l.boards, subject: l.subject, title: l.title, summary: l.summary || '', position: l.order === undefined ? 100 : l.order,
    blocks: l.blocks, refs: l.references || [], tier: l.tier || 'pro' }; if (typeof l.archived === 'boolean') row.archived = l.archived; if (l.objectives !== undefined) row.objectives = l.objectives || []; return row; };
  const noOwnTable = e => e && (e.status === 404 || e.status === 400) && /highlights|my_cards|schema cache|relation/i.test(e.message || '');
  const hlToRow = h => ({ id: h.id, user_id: uid(), kind: h.k, item_id: h.i, field: h.f, start_pos: h.a, end_pos: h.b, text_hl: h.t });
  const hlFromRow = r => ({ id: r.id, k: r.kind, i: r.item_id, f: r.field, a: r.start_pos, b: r.end_pos, t: r.text_hl });
  const mineToRow = (c, st) => ({ id: c.id, user_id: uid(), front: c.front, back: c.back, src_kind: c.sk || null, src_id: c.si || null, ease: st ? st.e : 2.5, interval_days: st ? st.i : 0, due: st ? st.due : null, reps: st ? st.reps : 0, lapses: st ? st.lapses : 0, last_reviewed: st && st.last || null });
  const mineFromRow = r => ({ id: r.id, front: r.front, back: r.back, sk: r.src_kind || undefined, si: r.src_id || undefined });
  const noCardsTable = e => e && (e.status === 404 || e.status === 400) && /flashcards|card_reviews|schema cache|relation/i.test(e.message || '');
  const noLessonsTable = e => e && (e.status === 404 || e.status === 400) && /lessons|schema cache|relation/i.test(e.message || '');
  async function allLessons(filter) {
    return api(`/rest/v1/lessons?select=*${filter}&order=position.asc,title.asc&limit=1000`);
  }
  const missingColumn = e => e && e.status === 400 && /archived|updated_by/i.test(e.message);
  async function allQuestions(filter) {                        // pages of 1000, oldest id first
    const rows = []; let offset = 0;
    for (;;) {
      const page = await api(`/rest/v1/questions?select=*${filter}&order=id.asc&limit=1000&offset=${offset}`);
      rows.push(...page); if (page.length < 1000) return rows; offset += 1000;
    }
  }
  async function blobPost(path, file, retried = false) {
    let res;
    try { res = await fetch(cfg.url + path, { method: 'POST', body: file, headers: { apikey: cfg.key, Authorization: 'Bearer ' + await token(), 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' } }); }
    catch (e) { throw e.auth ? e : offlineError(); }
    if (res.status === 401 && !retried && session) { session.expires_at = 0; await refresh(); return blobPost(path, file, true); }
    if (!res.ok) { let m = ''; try { m = (await res.json()).message || ''; } catch {} throw Object.assign(new Error(m || `Upload failed (${res.status})`), { status: res.status }); }
    return true;
  }

  return {
    get enabled() { return !!cfg; },
    get session() { return session; },
    init(c) {
      cfg = c && c.url && c.anonKey ? { url: String(c.url).replace(/\/+$/, ''), key: c.anonKey } : null;
      session = cfg ? jget(S_KEY) : null;
      window.addEventListener('online', () => schedule(500));
    },
    onAuthLost(fn) { onAuthLost = fn; },

    async signIn(email, password) {
      try { setSession(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })); }
      catch (e) {
        if (e.offline) throw new Error('No connection. You need internet to sign in.');
        if (e.status === 400) throw new Error('Email or password is incorrect.');
        if (e.status === 429) throw new Error('Too many attempts. Wait a minute and try again.');
        throw new Error('Could not sign in. Please try again.');
      }
    },
    // Open sign-up: anyone may make their own free account while the admin has this switched on.
    async signupOpen() { try { return (await raw('/rest/v1/rpc/signup_open', { method: 'POST', body: {} })) === true; } catch { return false; } },
    async setSignupOpen(open) { await api('/rest/v1/rpc/set_signup_open', { method: 'POST', body: { open } }); },
    async signUp(email, password, programId) {
      let r;
      try { r = await raw('/auth/v1/signup', { method: 'POST', body: programId ? { email, password, data: { program_id: programId } } : { email, password } }); }
      catch (e) {
        if (e.offline) throw new Error('No connection. You need internet to create an account.');
        if (e.status === 429) throw new Error('Too many attempts. Wait a minute and try again.');
        if (/registered|exists/i.test(e.message || '')) throw new Error('That email already has an account. Sign in instead, or use Forgot password.');
        if (e.status === 422 || e.status === 400) throw new Error(e.message || 'Could not create the account.');
        throw new Error('Could not create the account. Please try again.');
      }
      if (r && r.access_token) { setSession(r); return { signedIn: true }; }
      return { signedIn: false };              // the project asks people to confirm their email first
    },
    async recover(email) {
      try { await raw('/auth/v1/recover', { method: 'POST', body: { email } }); }
      catch (e) { if (e.offline) throw new Error('No connection.'); if (e.status === 429) throw new Error('Please wait a minute before asking again.'); }
    },
    // A new account made by an admin starts with a temporary password; this is the first-sign-in screen's way out.
    get mustChangePassword() { return !!(session && session.must); },
    async choosePassword(password) {
      try { await api('/auth/v1/user', { method: 'PUT', body: { password, data: { must_change_password: false } } }); }
      catch (e) { throw new Error(e.offline ? 'No connection.' : (e.message || 'Could not set the password.')); }
      session.must = false; jset(S_KEY, session);
    },
    // Admin-only account tools, run by the member-admin function on Supabase's servers (see supabase/functions/member-admin).
    async manageMember(action, fields) {
      let res;
      try { res = await fetch(cfg.url + '/functions/v1/member-admin', { method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...fields }) }); }
      catch (e) { throw e.auth ? e : offlineError(); }
      let out = null; try { out = await res.json(); } catch {}
      if (res.status === 404 && !(out && out.error)) throw Object.assign(new Error('Account tools are not set up yet.'), { notDeployed: true });
      if (!res.ok) throw Object.assign(new Error((out && out.error) || `Request failed (${res.status})`), { status: res.status });
      return out;
    },
    async setPassword(password) {
      try { await api('/auth/v1/user', { method: 'PUT', body: { password } }); }
      catch (e) { throw new Error(e.offline ? 'No connection.' : (e.message || 'Could not set the password.')); }
    },
    // Verifies the current password first, so a borrowed, unlocked device can't be used to take over the account.
    async changePassword(current, next) {
      try { setSession(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: session.email, password: current } })); }
      catch (e) { throw new Error(e.offline ? 'No connection.' : e.status === 400 ? 'Your current password is not correct.' : 'Could not check your password. Try again.'); }
      try { await api('/auth/v1/user', { method: 'PUT', body: { password: next } }); }
      catch (e) { throw new Error(e.offline ? 'No connection.' : (e.message || 'Could not change the password.')); }
    },
    // Admin-only tables and functions (the database rules refuse everyone else)
    rest: (path, opts) => api('/rest/v1/' + path, opts),
    // Links from invite / password-reset emails arrive as #access_token=...&type=recovery
    consumeLink() {
      if (!cfg) return null;
      const h = location.hash;
      if (!/^#(.*&)?(access_token|error)=/.test(h)) return null;
      const p = new URLSearchParams(h.slice(1));
      history.replaceState(null, '', location.pathname + location.search + '#/');
      if (p.get('error')) return { error: p.get('error_description') || p.get('error') };
      const at = p.get('access_token');
      setSession({ access_token: at, refresh_token: p.get('refresh_token'), expires_in: +p.get('expires_in') || 3600 });
      return { type: p.get('type') || 'signin' };
    },
    async signOut() {
      const u = uid();
      try { if (session) await raw('/auth/v1/logout', { method: 'POST', bearer: session.access_token }); } catch {}
      if (u) { jdel(`qbank.queue.${u}`); jdel(`qbank.profile.${u}`); jdel(`qbank.v1.${u}`); }
      clearSession(); imageUrls.forEach(u => URL.revokeObjectURL(u)); imageUrls.clear(); await cacheClear();
    },

    async setMyName(nm) {
      await api('/rest/v1/rpc/set_my_name', { method: 'POST', body: { nm } });
      const p = jget(pKey()); if (p) { p.display_name = String(nm || '').trim().replace(/\s+/g, ' ') || null; jset(pKey(), p); }
    },
    async profile() {
      try {
        const r = await api(`/rest/v1/profiles?select=email,display_name,role,plan,pro_until,active&id=eq.${uid()}&limit=1`).catch(e => { if (e && (e.status === 400 || e.status === 404) && /pro_until|schema cache|column/i.test(e.message || '')) return api(`/rest/v1/profiles?select=email,display_name,role,plan,active&id=eq.${uid()}&limit=1`); throw e; });   // an older database has no pro_until yet
        const p = r && r[0] ? r[0] : null;
        if (p) jset(pKey(), p);
        return p;
      } catch (e) { if (e.offline) return jget(pKey()); throw e; }
    },
    async questions() {
      try {
        let rows;
        try { rows = await allQuestions('&archived=eq.false'); }
        catch (e) { if (!missingColumn(e)) throw e; rows = await allQuestions(''); }     // database not upgraded yet
        const list = rows.map(toQuestion);
        await cacheSet('questions', { uid: uid(), at: Date.now(), list });
        return list;
      } catch (e) {
        if (!e.offline) throw e;
        const c = await cacheGet('questions');
        if (c && c.uid === uid()) return c.list;
        throw e;
      }
    },
    // ---- residency programs ----
    async programs() { try { return (await raw('/rest/v1/rpc/program_list', { method: 'POST', body: {} })) || []; } catch { return []; } },          // public: shown while signing up
    async myProgram() { try { const r = await api('/rest/v1/rpc/my_program', { method: 'POST', body: {} }); return r && r[0] ? r[0] : null; } catch { return null; } },
    requestProgram: id => api('/rest/v1/rpc/request_program', { method: 'POST', body: { pid: id } }),
    leaveProgram: () => api('/rest/v1/rpc/leave_program', { method: 'POST', body: {} }),
    previewRoster: pid => api('/rest/v1/rpc/preview_roster', { method: 'POST', body: { pid } }),
    previewSubjects: pid => api('/rest/v1/rpc/preview_subjects', { method: 'POST', body: { pid } }),
    questionRevisions: id => api('/rest/v1/question_revisions?select=*&question_id=eq.' + encodeURIComponent(id) + '&order=revised_at.desc&limit=20'),
    facultySubjectTrend: days => api('/rest/v1/rpc/faculty_subject_trend', { method: 'POST', body: { days: days || 30 } }),
    previewSubjectTrend: (pid, days) => api('/rest/v1/rpc/preview_subject_trend', { method: 'POST', body: { pid, days: days || 30 } }),
    facultyTopics: days => api('/rest/v1/rpc/faculty_topics', { method: 'POST', body: { days: days || 0 } }),
    facultyQuestions: days => api('/rest/v1/rpc/faculty_questions', { method: 'POST', body: { days: days || 0 } }),
    facultyWeekly: () => api('/rest/v1/rpc/faculty_weekly', { method: 'POST', body: {} }),
    previewTopics: (pid, days) => api('/rest/v1/rpc/preview_topics', { method: 'POST', body: { pid, days: days || 0 } }),
    previewQuestions: (pid, days) => api('/rest/v1/rpc/preview_questions', { method: 'POST', body: { pid, days: days || 0 } }),
    previewWeekly: pid => api('/rest/v1/rpc/preview_weekly', { method: 'POST', body: { pid } }),
    facultyRoster: () => api('/rest/v1/rpc/faculty_roster', { method: 'POST', body: {} }),
    facultySubjects: () => api('/rest/v1/rpc/faculty_subject_stats', { method: 'POST', body: {} }),
    programDecide: (pid, uid, approve) => api('/rest/v1/rpc/program_decide', { method: 'POST', body: { pid, uid, approve } }),
    programRemove: (pid, uid) => api('/rest/v1/rpc/program_remove', { method: 'POST', body: { pid, uid } }),
    facultyDecide: (uid, approve) => api('/rest/v1/rpc/faculty_decide', { method: 'POST', body: { uid, approve } }),
    facultyRemove: uid => api('/rest/v1/rpc/faculty_remove', { method: 'POST', body: { uid } }),
    adminPrograms: () => api('/rest/v1/programs?select=*&order=name.asc'),
    saveProgram: p => api('/rest/v1/programs?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [p] }),
    deleteProgram: id => api('/rest/v1/programs?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
    // ---- question feedback (members write, admins and reviewers read in Admin > Inbox) ----
    queueFeedback(row) { change(q => { (q.feedback ||= []).push({ ...row, client_id: cid() }); }); },
    inbox: () => api('/rest/v1/rpc/feedback_inbox', { method: 'POST', body: {} }),
    async unreadFeedback() { try { const n = await api('/rest/v1/rpc/feedback_unread_count', { method: 'POST', body: {} }); return typeof n === 'number' ? n : 0; } catch { return 0; } },
    setFeedback: (id, status, note) => api('/rest/v1/rpc/feedback_set', { method: 'POST', body: note === undefined ? { fid: id, new_status: status } : { fid: id, new_status: status, note } }),
    // ---- conversations: replies both ways, and support messages (a conversation with no question) ----
    myThreads: () => api('/rest/v1/rpc/my_threads', { method: 'POST', body: {} }),
    myThreadMessages: id => api('/rest/v1/rpc/my_thread_messages', { method: 'POST', body: { fid: id } }),
    markThreadSeen: id => api('/rest/v1/rpc/my_thread_seen', { method: 'POST', body: { fid: id } }),
    async myUnreadReplies() { try { const n = await api('/rest/v1/rpc/my_unread_replies', { method: 'POST', body: {} }); return typeof n === 'number' ? n : 0; } catch { return 0; } },
    replyThread: (id, msg) => api('/rest/v1/rpc/thread_member_reply', { method: 'POST', body: { fid: id, msg } }),
    threadMessages: id => api('/rest/v1/rpc/thread_messages', { method: 'POST', body: { fid: id } }),
    teamReply: (id, msg) => api('/rest/v1/rpc/thread_team_reply', { method: 'POST', body: { fid: id, msg } }),
    // ---- group averages (aggregate numbers only; the database withholds a question until enough members have answered it) ----
    async peerStats() {
      try {
        const rows = await api('/rest/v1/rpc/peer_stats', { method: 'POST', body: {} }), m = {};
        (rows || []).forEach(r => { m[r.question_id] = { users: r.users, pct: Math.round(r.pct_correct) }; });
        await cacheSet('peer', { uid: uid(), at: Date.now(), m }); return m;
      } catch (e) {
        if (e.offline) { const c = await cacheGet('peer'); return c && c.uid === uid() ? c.m : {}; }
        return {};                                                          // database not upgraded yet, or a hiccup: just show no averages
      }
    },
    async peerChoices() {                                                     // { question_id: { total, counts: { A: n, B: n } } }
      try {
        const rows = await api('/rest/v1/rpc/peer_choices', { method: 'POST', body: {} }), m = {};
        (rows || []).forEach(r => { const o = m[r.question_id] ||= { total: r.total, counts: {} }; o.counts[r.chosen] = r.picks; });
        await cacheSet('choices', { uid: uid(), at: Date.now(), m }); return m;
      } catch (e) {
        if (e.offline) { const x = await cacheGet('choices'); return x && x.uid === uid() ? x.m : {}; }
        return {};
      }
    },
    async peerMin() { const r = await api('/rest/v1/rpc/peer_min_users', { method: 'POST', body: {} }); return typeof r === 'number' ? r : 10; },
    async setPeerMin(n) { await api('/rest/v1/rpc/set_peer_min_users', { method: 'POST', body: { n } }); },
    // ---- flashcards (members read reviewed ones; editors read and write all) ----
    async cards() {
      try { const list = (await api('/rest/v1/flashcards?select=*&archived=eq.false&order=subject.asc,id.asc&limit=5000')).map(toCard); await cacheSet('cards', { uid: uid(), at: Date.now(), list }); return list; }
      catch (e) {
        if (noCardsTable(e)) return [];                                     // database not upgraded yet
        if (!e.offline) throw e;
        const c = await cacheGet('cards'); if (c && c.uid === uid()) return c.list; return [];
      }
    },
    async cardsReady() { try { await api('/rest/v1/flashcards?select=id&limit=1'); return true; } catch (e) { if (noCardsTable(e)) return false; throw e; } },
    async editorCards() { return (await api('/rest/v1/flashcards?select=*&order=subject.asc,id.asc&limit=5000')).map(toEditorCard); },
    async saveCards(list) { for (let i = 0; i < list.length; i += 50) await api('/rest/v1/flashcards?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: list.slice(i, i + 50).map(toCardRow) }); },
    patchCards: (ids, patch) => api('/rest/v1/flashcards?id=in.' + encodeURIComponent(inList(ids)), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch }),
    deleteCards: ids => api('/rest/v1/flashcards?id=in.' + encodeURIComponent(inList(ids)), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
    // ---- lessons (members read reviewed ones; editors read and write all) ----
    async lessons() {
      try { const list = (await allLessons('&archived=eq.false')).map(toLesson); await cacheSet('lessons', { uid: uid(), at: Date.now(), list }); return list; }
      catch (e) {
        if (noLessonsTable(e)) return [];                                   // database not upgraded yet
        if (!e.offline) throw e;
        const c = await cacheGet('lessons'); if (c && c.uid === uid()) return c.list; return [];
      }
    },
    async lessonsReady() { try { await api('/rest/v1/lessons?select=id&limit=1'); return true; } catch (e) { if (noLessonsTable(e)) return false; throw e; } },
    async editorLessons() { return (await allLessons('')).map(toEditorLesson); },
    async saveLessons(list) { for (let i = 0; i < list.length; i += 50) await api('/rest/v1/lessons?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: list.slice(i, i + 50).map(toLessonRow) }); },
    patchLessons: (ids, patch) => api('/rest/v1/lessons?id=in.' + encodeURIComponent(inList(ids)), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch }),
    deleteLessons: ids => api('/rest/v1/lessons?id=in.' + encodeURIComponent(inList(ids)), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
    async lessonUpdatedAt(id) { const r = await api('/rest/v1/lessons?select=updated_at&id=eq.' + encodeURIComponent(id)); return r && r[0] ? r[0].updated_at : null; },
    // ---- for admins and reviewers (the database refuses everyone else) ----
    async editorReady() { try { await api('/rest/v1/questions?select=archived,updated_by&limit=1'); return true; } catch (e) { if (missingColumn(e)) return false; throw e; } },
    async editorQuestions() { return (await allQuestions('')).map(toEditorQuestion); },
    async saveQuestions(list) {
      for (let i = 0; i < list.length; i += 100)
        await api('/rest/v1/questions?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: list.slice(i, i + 100).map(toRow) });
    },
    patchQuestions: (ids, patch) => api('/rest/v1/questions?id=in.' + encodeURIComponent(inList(ids)), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: patch }),
    deleteQuestions: ids => api('/rest/v1/questions?id=in.' + encodeURIComponent(inList(ids)), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
    async questionUpdatedAt(id) { const r = await api('/rest/v1/questions?select=updated_at&id=eq.' + encodeURIComponent(id)); return r && r[0] ? r[0].updated_at : null; },
    async uploadImage(name, file) { await blobPost('/storage/v1/object/question-images/' + encodeURIComponent(name), file); this.forgetImage(name); },
    forgetImage(name) { if (imageUrls.has(name)) { URL.revokeObjectURL(imageUrls.get(name)); imageUrls.delete(name); } kv('readwrite', s => s.delete('img:' + name)).catch(() => {}); },
    // Private pictures live in a private bucket; the database only releases one to someone who may see a question that uses it.
    async image(path) {
      if (imageUrls.has(path)) return imageUrls.get(path);
      const key = 'img:' + path, hit = await cacheGet(key);
      let blob = hit && hit.uid === uid() ? hit.blob : null;
      if (!blob) {
        blob = await blobApi('/storage/v1/object/authenticated/question-images/' + encodeURIComponent(path));
        if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error('Unsupported image');
        await cacheSet(key, { uid: uid(), blob });
      }
      const url = URL.createObjectURL(blob); imageUrls.set(path, url); return url;
    },
    async prefetchImages(paths) { for (const p of [...new Set(paths)]) { try { await this.image(p); } catch { /* fetched later, or unavailable */ } } },
    rpc: (name, args = {}) => api(`/rest/v1/rpc/${name}`, { method: 'POST', body: args }),

    // hooks called by the Store
    queueAttempt(question_id, ok, chosen) { change(q => q.attempts.push({ question_id, ok, ...(chosen ? { chosen: String(chosen).slice(0, 3) } : {}), client_id: cid(), at: new Date().toISOString() })); },
    queueMark(question_id) { change(q => { const s = Store.qstat(question_id) || {}; q.marks[question_id] = { flagged: !!s.flagged, note: s.note || '', updated_at: new Date().toISOString() }; }); },
    queueTest(rec) { change(q => { q.tests[rec.id] = rec; }); },
    queueSettings() { change(q => { const s = Store.data.settings; q.settings = { data: { theme: s.theme, showDrafts: s.showDrafts !== false, palette: s.palette || 'navy', ...(s.paletteChosen ? { paletteChosen: true } : {}), exam: s.exam || null, quizMascot: s.quizMascot !== false, quizText: +s.quizText || 0, ...(s.dash ? { dash: s.dash } : {}), ...(s.cards ? { cards: s.cards } : {}), ...(s.stressFree !== undefined ? { stressFree: !!s.stressFree } : {}), ...(Array.isArray(s.suspended) ? { suspended: s.suspended } : {}), ...(Store.data.activeAt ? { active: Store.data.active || null, parked: Store.data.parked || [], activeAt: Store.data.activeAt } : {}) }, updated_at: new Date().toISOString() }; }); },
    queueCard(id, st) { if (String(id).startsWith('my:')) return this.queueMine(String(id).slice(3)); change(q => { (q.cards ||= {})[id] = st; }); },
    queueHl(id) { change(q => { const h = (Store.data.hl || {})[id]; (q.hl ||= {})[id] = h ? hlToRow(h) : null; }); },
    queueMine(id) { change(q => { const c = (Store.data.mine || {})[id]; (q.mine ||= {})[id] = c ? mineToRow(c, (Store.data.cards || {})['my:' + id]) : null; }); },
    queueReset() { change(q => { const { hl, mine } = q; Object.assign(q, blankQueue(), { reset: true, hl: hl || {}, mine: mine || {} }); }); },
    sync, pending, get lastSync() { return lastSync; },
    userKey: () => `qbank.v1.${uid()}`
  };
})();
