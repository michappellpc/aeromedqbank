'use strict';
// Shows the contact email from data/config.json on the privacy and terms pages.
fetch('data/config.json').then(function (r) { return r.json(); }).then(function (c) {
  if (c.contactEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.contactEmail)) {
    document.querySelectorAll('.contact').forEach(function (el) { var a = document.createElement('a'); a.href = 'mailto:' + c.contactEmail; a.textContent = c.contactEmail; el.replaceChildren(a); });
  }
}).catch(function () {});
