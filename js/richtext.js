'use strict';
// Light formatting for text members read: **bold**, *italic* and line breaks, and nothing else. The text is escaped first, so pasted content cannot
// inject markup. Used for lessons and flashcards. Pure logic, no page code. Runs in the browser and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.RichText = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const BOLD = /\*\*(.+?)\*\*/g, ITALIC = /(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g;
  // HTML with <strong>, <em> and <br>
  const inline = s => esc(s).replace(BOLD, '<strong>$1</strong>').replace(ITALIC, '$1<em>$2</em>').replace(/\n/g, '<br>');
  // the same text with the markers removed (for titles, labels and anything read aloud)
  const strip = s => String(s == null ? '' : s).replace(BOLD, '$1').replace(ITALIC, '$1$2');
  return { inline, strip, esc };
});
