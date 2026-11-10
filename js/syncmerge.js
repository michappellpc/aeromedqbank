'use strict';
// Keeping the device's copy of a list (questions, lessons, flashcards) up to date with as little downloading as possible. The server is asked
// for every row's id and last-changed stamp (small); only rows that are new or changed are fetched in full, and rows that are gone are dropped.
// Pure logic, no page code. Runs in the browser and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.SyncMerge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const stamp = r => String(r.updated_at || '');
  // stamps: { id: updated_at } as last saved; index: [{ id, updated_at }] from the server now
  function plan(stamps, index) {
    const have = stamps || {}, now = new Set(), fetch = [];
    (index || []).forEach(r => { now.add(r.id); if (!(r.id in have) || have[r.id] !== stamp(r)) fetch.push(r.id); });
    const remove = Object.keys(have).filter(id => !now.has(id));
    return { fetch, remove, same: !fetch.length && !remove.length };
  }
  // the list after the plan: fetched rows (already mapped to app items) replace or join, removed ids go
  function apply(list, fetched, remove) {
    const gone = new Set(remove || []), fresh = new Map((fetched || []).map(x => [x.id, x]));
    const out = (list || []).filter(x => !gone.has(x.id)).map(x => fresh.get(x.id) || x);
    const seen = new Set(out.map(x => x.id));
    (fetched || []).forEach(x => { if (!seen.has(x.id)) { out.push(x); seen.add(x.id); } });
    return out;
  }
  const stamps = index => Object.fromEntries((index || []).map(r => [r.id, stamp(r)]));
  return { plan, apply, stamps };
});
