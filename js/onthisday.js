'use strict';
// "This day in history": aerospace medicine, aviation and spaceflight events for a calendar day. The events live in onthisday-data.js. Pure logic, no
// page code. Runs in the browser and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require('./onthisday-data.js') : root.OnThisDayData); else root.OnThisDay = factory(root.OnThisDayData);
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  const KINDS = ['m', 'a', 's'];                          // aerospace medicine, aviation, spaceflight
  const key = (m, d) => String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  // Medicine events come first, then the rest in the order they were written. Normally 1 to 3 events; a day with more than 3 shows them all
  // (the data only has more when the extra events are significant).
  function forDate(month, day, data = DATA) {
    const list = ((data || {})[key(month, day)] || []).filter(e => e && KINDS.includes(e.k) && Number.isInteger(e.y) && typeof e.t === 'string' && e.t.trim());
    return list.slice().sort((a, b) => KINDS.indexOf(a.k) === 0 ? (KINDS.indexOf(b.k) === 0 ? 0 : -1) : KINDS.indexOf(b.k) === 0 ? 1 : 0);
  }
  return { KINDS, key, forDate };
});
