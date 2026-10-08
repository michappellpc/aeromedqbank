'use strict';
// Spaced repetition for flashcards: when a card should come back, and which cards are in today's session.
// A simple version of the SM-2 method. Runs in the browser and in Node (for tests).
//   state = { e: ease, i: interval in days, due: 'YYYY-MM-DD', reps, lapses, last: 'YYYY-MM-DD' | null }
//   rating: 1 Again, 2 Hard, 3 Good, 4 Easy
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.CardSched = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = n => String(n).padStart(2, '0');
  const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // the device's own date
  const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  const daysBetween = (a, b) => { const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 86400000); };   // whole days from a to b
  const MAX_DAYS = 3650, MIN_EASE = 1.3, MAX_EASE = 3.0;

  function rate(st, r, now) {
    const s = st ? { ...st } : { e: 2.5, i: 0, due: now, reps: 0, lapses: 0, last: null };
    if (r === 1) {
      if (s.reps > 0) s.lapses++;
      s.reps = 0; s.i = 0; s.e = Math.max(MIN_EASE, s.e - 0.2); s.due = now;           // comes straight back
    } else {
      if (r === 2) { s.i = s.reps === 0 ? 1 : Math.max(1, Math.round(s.i * 1.2)); s.e = Math.max(MIN_EASE, s.e - 0.15); }
      else if (r === 3) s.i = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(s.i + 1, Math.round(s.i * s.e));
      else { s.i = s.reps === 0 ? 4 : Math.max(s.i + 2, Math.round(s.i * s.e * 1.3)); s.e = Math.min(MAX_EASE, s.e + 0.15); }
      s.i = Math.min(MAX_DAYS, s.i); s.reps++; s.due = addDays(now, s.i);
    }
    s.e = Math.round(s.e * 100) / 100; s.last = now;
    return s;
  }
  // The label for a rating button: how long until the card returns
  const preview = (st, r, now) => { const n = rate(st, r, now); return r === 1 ? 'today' : n.i === 1 ? '1 day' : n.i + ' days'; };

  const isNew = st => !st;
  const isDue = (st, now) => !!st && st.due <= now;

  // Today's session: cards that are due (oldest first), then new cards up to what is left of today's new-card allowance.
  // Suspended cards (opts.suspended, a list of card ids) are left out of everything: not due, not new, not counted.
  const active = (cards, opts) => { const sus = new Set(opts.suspended || []); return sus.size ? cards.filter(c => !sus.has(c.id)) : cards; };
  function queue(allCards, states, now, opts = {}) {
    const cards = active(allCards, opts);
    const newLeft = Math.max(0, (opts.newPerDay ?? 10) - (opts.newSeenToday || 0));
    let due = cards.filter(c => isDue(states[c.id], now)).sort((a, b) => states[a.id].due.localeCompare(states[b.id].due) || a.id.localeCompare(b.id));
    if (opts.maxReviews > 0) due = due.slice(0, opts.maxReviews);                      // 0 or missing means no limit
    const fresh = cards.filter(c => isNew(states[c.id])).sort((a, b) => a.id.localeCompare(b.id)).slice(0, newLeft);
    return [...due, ...fresh];
  }
  function counts(allCards, states, now, opts = {}) {
    const cards = active(allCards, opts), q = queue(allCards, states, now, opts);
    return { suspended: allCards.length - cards.length, due: cards.filter(c => isDue(states[c.id], now)).length, new: q.filter(c => isNew(states[c.id])).length, newTotal: cards.filter(c => isNew(states[c.id])).length,
      learned: cards.filter(c => states[c.id] && states[c.id].reps >= 3).length, total: cards.length };
  }
  // The member's choices, tidied: anything out of range falls back to the default
  const DEFAULTS = { newPerDay: 10, maxReviews: 0, order: 'due', intervals: true, reverse: false };
  const MAX_REVIEW_CHOICES = [0, 20, 50, 100, 200];
  function settings(raw) {
    const r = raw || {}, n = Number(r.newPerDay);
    return {
      newPerDay: Number.isInteger(n) && n >= 0 && n <= 100 ? n : DEFAULTS.newPerDay,
      maxReviews: MAX_REVIEW_CHOICES.includes(Number(r.maxReviews)) ? Number(r.maxReviews) : DEFAULTS.maxReviews,
      order: r.order === 'shuffle' ? 'shuffle' : 'due',
      intervals: r.intervals !== false,
      reverse: r.reverse === true
    };
  }
  return { rate, preview, queue, counts, isDue, isNew, today, addDays, daysBetween, settings, DEFAULTS, MAX_REVIEW_CHOICES };
});
