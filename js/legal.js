'use strict';
// Shared by the privacy and terms pages: uses the member's saved colors, and shows the contact email from data/config.json.
// Navy and teal is the default (set in the page); olive and gold only if the member chose it, and light or dark only if they chose one (same rules as the app).
try {
  var ses = JSON.parse(localStorage.getItem('qbank.session') || 'null'), key = ses && ses.uid ? 'qbank.v1.' + ses.uid : 'qbank.v1';   // the app keeps each member's data under their own key
  var s = (JSON.parse(localStorage.getItem(key)) || {}).settings || {}, root = document.documentElement;
  if (s.palette === 'olive' && s.paletteChosen) { root.removeAttribute('data-palette'); var tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.setAttribute('content', '#2b3319'); }
  if (s.theme === 'light' || s.theme === 'dark') root.setAttribute('data-theme', s.theme);
} catch (e) {}
fetch('data/config.json').then(function (r) { return r.json(); }).then(function (c) {
  if (c.contactEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.contactEmail)) {
    document.querySelectorAll('.contact').forEach(function (el) { var a = document.createElement('a'); a.href = 'mailto:' + c.contactEmail; a.textContent = c.contactEmail; el.replaceChildren(a); });
  }
}).catch(function () {});
