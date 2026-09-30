// Persistence layer (localStorage). The working copy always lives on the device so the app works offline.
// In cloud mode Cloud.js listens to Store.hooks and sends changes to the account; Store.use() switches to a per-account key.
const Store = (() => {
  let KEY = 'qbank.v1';
  const blank = () => ({ q: {}, tests: [], active: null, settings: { theme: 'auto' } });
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
    addTest(rec) { d.tests.unshift(rec); save(); fire('test', rec); },
    touchSettings() { save(); fire('settings'); },
    exportJSON: () => JSON.stringify(d, null, 2),
    importJSON(t) { const o = JSON.parse(t); if (!o || typeof o !== 'object' || !o.q || !Array.isArray(o.tests)) throw new Error('Not a QBank export'); d = { ...blank(), ...o }; save(); },
    reset() { d = blank(); save(); fire('reset'); }
  };
})();
