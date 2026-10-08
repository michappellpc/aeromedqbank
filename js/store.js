// Persistence layer (localStorage). The working copy always lives on the device so the app works offline.
// In cloud mode Cloud.js listens to Store.hooks and sends changes to the account; Store.use() switches to a per-account key.
const Store = (() => {
  let KEY = 'qbank.v1';
  const blank = () => ({ q: {}, tests: [], active: null, settings: { theme: 'auto' }, cards: {}, cardsMeta: { day: '', newSeen: 0 }, hl: {}, mine: {} });
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { return blank(); } };
  let d = load();
  const hooks = {};   // attempt(id, ok), mark(id), test(rec), settings(), reset()
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  // q[id] = { seen, correct, wrong, flagged, note, last: 'c'|'w' }
  const qs = id => (d.q[id] ||= { seen: 0, correct: 0, wrong: 0, flagged: false, note: '', last: null });
  const fire = (name, ...a) => { try { hooks[name] && hooks[name](...a); } catch {} };
  return {
    get data() { return d; }, save, hooks,
    use(key) { KEY = key; d = load(); },
    forget(key) { try { localStorage.removeItem(key); } catch {} d = blank(); },
    qstat: id => d.q[id] || null,
    record(id, ok, chosen) { const s = qs(id); s.seen++; ok ? s.correct++ : s.wrong++; s.last = ok ? 'c' : 'w'; save(); fire('attempt', id, ok, chosen); },
    toggleFlag(id) { const s = qs(id); s.flagged = !s.flagged; save(); fire('mark', id); return s.flagged; },
    setNote(id, t) { qs(id).note = t; save(); fire('mark', id); },
    // flashcards: cards[id] = { e: ease, i: interval days, due: 'YYYY-MM-DD', reps, lapses, last }
    cardState: id => (d.cards || {})[id] || null,
    cardStates: () => d.cards || (d.cards = {}),
    rateCard(id, st) { (d.cards || (d.cards = {}))[id] = st; save(); fire('card', id, st); },
    // suspended flashcards: a list of card ids in settings, so it syncs with the other settings
    suspended: () => ((d.settings || {}).suspended || []).filter(x => typeof x === 'string'),
    setSuspended(id, on) { const set = new Set(((d.settings || {}).suspended || []).filter(x => typeof x === 'string')); on ? set.add(id) : set.delete(id); d.settings.suspended = [...set].slice(0, 5000); save(); fire('settings'); },
    newCardsSeen(day) { const m = d.cardsMeta || {}; return m.day === day ? m.newSeen || 0 : 0; },
    countNewCard(day) { const m = d.cardsMeta && d.cardsMeta.day === day ? d.cardsMeta : (d.cardsMeta = { day, newSeen: 0 }); m.newSeen = (m.newSeen || 0) + 1; save(); },
    // highlights: hl[id] = { id, k: 'q'|'l', i: item id, f: field, a, b, t: the highlighted words }
    hls: () => d.hl || (d.hl = {}),
    hlIn(k, i, f) { return Object.values(d.hl || {}).filter(h => h.k === k && h.i === i && (f === undefined || h.f === f)); },
    putHl(e) { (d.hl || (d.hl = {}))[e.id] = e; save(); fire('hl', e.id); },
    delHl(id) { if (d.hl) delete d.hl[id]; save(); fire('hl', id); },
    // a member's own flashcards: mine[id] = { id, front, back, sk: source kind, si: source id, at }; their schedule lives in cards['my:' + id]
    mineMap: () => d.mine || (d.mine = {}),
    putMine(c) { (d.mine || (d.mine = {}))[c.id] = c; save(); fire('mine', c.id); },
    delMine(id) { if (d.mine) delete d.mine[id]; if (d.cards) delete d.cards['my:' + id]; save(); fire('mine', id); },
    addTest(rec) { d.tests.unshift(rec); save(); fire('test', rec); },
    touchSettings() { save(); fire('settings'); },
    // The quiz in progress (or paused) travels with the account so signing out, or using another device, does not lose it. activeAt says which copy is newest.
    touchActive() { d.activeAt = Date.now(); save(); fire('settings'); },
    exportJSON: () => JSON.stringify(d, null, 2),
    importJSON(t) { const o = JSON.parse(t); if (!o || typeof o !== 'object' || !o.q || !Array.isArray(o.tests)) throw new Error('Not a QBank export'); d = { ...blank(), ...o }; save(); },
    reset() { const keep = { hl: d.hl, mine: d.mine, cards: Object.fromEntries(Object.entries(d.cards || {}).filter(([k]) => k.startsWith('my:'))) }; if (d.settings && d.settings.stressFree !== undefined) keep.settings = { ...blank().settings, stressFree: d.settings.stressFree }; d = { ...blank(), ...keep }; save(); fire('reset'); }   // progress goes; highlights, your own cards and the Stress Free choice stay
  };
})();
