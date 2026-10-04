'use strict';
// The one set of flashcard rules, shared by the admin Flashcards page (browser) and tools/validate.js (Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.CardValidate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS = ['draft', 'reviewed'];
  const FIELDS = ['id', 'status', 'reviewedBy', 'boards', 'subject', 'topic', 'front', 'back', 'lessonId', 'objectives', 'references', 'archived'];
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // normalize(raw) -> { clean, dropped }: keeps only known fields and tidies text
  function normalize(raw) {
    const clean = {}, dropped = [];
    Object.keys(raw || {}).forEach(k => { if (FIELDS.includes(k)) clean[k] = raw[k]; else dropped.push(k); });
    ['id', 'subject', 'topic', 'front', 'back', 'lessonId'].forEach(k => { if (typeof clean[k] === 'string') clean[k] = clean[k].trim(); });
    if (!clean.status) clean.status = 'draft';
    if (Array.isArray(clean.objectives)) { const seen = new Set(); clean.objectives = clean.objectives.map(o => String(o).trim()).map(o => { const m = o.match(/^([A-Za-z]+):\s*([A-Za-z])([0-9][A-Za-z0-9.]*)$/); return m ? m[1].toLowerCase() + ':' + m[2].toUpperCase() + m[3] : o; }).filter(o => o && !seen.has(o) && seen.add(o)); }
    return { clean, dropped };
  }

  // check(card, ctx) -> [{ level: 'error' | 'warn', msg }]
  //   ctx.boards [{id}], ctx.subjects { boardId: [] }, ctx.ids Set (updated), ctx.fronts Map (updated), ctx.label, ctx.lessonIds Set (optional), ctx.recordsReviewer
  function check(c, ctx) {
    const out = [], err = m => out.push({ level: 'error', msg: m }), warn = m => out.push({ level: 'warn', msg: m });
    const boardIds = new Set(ctx.boards.map(b => b.id)), label = ctx.label || c.id;
    if (!c.id) err('missing id'); else if (!/^[a-z0-9][a-z0-9-]*$/.test(c.id)) err('id must be lowercase letters, digits and hyphens'); else if (ctx.ids.has(c.id)) err('duplicate id'); else ctx.ids.add(c.id);
    if (!STATUS.includes(c.status)) err('status must be "draft" or "reviewed"');
    if (c.status === 'reviewed' && !c.reviewedBy && !ctx.recordsReviewer) warn('reviewed but no reviewedBy');
    if (!Array.isArray(c.boards) || !c.boards.length || c.boards.some(b => !boardIds.has(b))) err('invalid boards (use aem, om, pm)');
    else if (!c.subject) err('missing subject');
    else if (!c.boards.some(b => (ctx.subjects[b] || []).includes(c.subject))) err(`subject "${c.subject}" is not listed for board(s) ${c.boards.join(', ')} in the manifest`);
    if (c.archived != null && typeof c.archived !== 'boolean') err('archived must be true or false');
    if (c.topic != null && typeof c.topic !== 'string') err('topic must be text');
    const front = typeof c.front === 'string' ? c.front.trim() : '', back = typeof c.back === 'string' ? c.back.trim() : '';
    if (!front) err('missing front'); else {
      if (front.length > 600) err('front is longer than 600 characters');
      else if (front.length > 300) warn('front is long; cards work best with a short prompt');
      const k = norm(front), other = ctx.fronts.get(k);
      if (other !== undefined && other !== label) err(`front duplicates ${other}`); else ctx.fronts.set(k, label);
    }
    if (!back) err('missing back'); else {
      if (back.length > 1500) err('back is longer than 1500 characters');
      else if (back.length > 700) warn('back is long; consider splitting this into two cards');
    }
    if (front && back && norm(front) === norm(back)) err('front and back are the same');
    if (c.objectives != null) {
      if (!Array.isArray(c.objectives) || c.objectives.length > 12 || c.objectives.some(o => typeof o !== 'string' || !/^(aem|om|pm):[TK][0-9]+(\.[A-Za-z0-9]+)*$/.test(o))) err('objectives must be a list of at most 12 board outline items such as "aem:K1.E.1"');
      else { c.objectives.forEach(o => { if (ctx.knownObjective && !ctx.knownObjective(o)) warn(`objective "${o}" is not an item in the board outline`); else if (Array.isArray(c.boards) && c.boards.length && !c.boards.includes(o.split(':')[0])) warn(`objective "${o}" is from a board this card is not listed for`); }); }
    }
    if (c.lessonId != null && (typeof c.lessonId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.lessonId))) err('lessonId must be a lesson id');
    else if (c.lessonId && ctx.lessonIds && !ctx.lessonIds.has(c.lessonId)) warn(`lessonId "${c.lessonId}" does not match any lesson`);
    if (c.references != null && (!Array.isArray(c.references) || c.references.some(r => typeof r !== 'string'))) err('references must be a list of text');
    else if (!c.references || !c.references.length) warn('no references');
    return out;
  }

  return { check, normalize, norm, FIELDS, STATUS };
});
