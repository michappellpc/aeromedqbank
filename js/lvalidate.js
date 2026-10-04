'use strict';
// The rules for lessons, shared by the admin Lessons page (in the browser) and the tests (in Node).
// A lesson is { id, boards, subject, title, summary, order, status, tier, references, blocks: [...] }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LValidate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS = ['draft', 'reviewed'], TIERS = ['free', 'pro'];
  const FIELDS = ['id', 'status', 'reviewedBy', 'boards', 'subject', 'title', 'summary', 'order', 'blocks', 'references', 'tier', 'objectives', 'archived'];
  const KINDS = ['pearl', 'key', 'warning', 'tip'];
  const LIMITS = { blocks: 80, text: 4000, cols: 12, rows: 40, cats: 24, series: 4, items: 12, steps: 12 };
  const isStr = v => typeof v === 'string';
  const str = (v, max = LIMITS.text) => isStr(v) && v.trim().length > 0 && v.length <= max;

  // Checks one block; returns a list of plain-language problems ('' prefix added by the caller).
  function checkBlock(b, i, imageOk) {
    const out = [], at = `block ${i + 1}`, bad = m => out.push(`${at} (${b && b.type}): ${m}`);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return [`${at} is not a block`];
    switch (b.type) {
      case 'heading': if (!str(b.text, 200)) bad('needs text (up to 200 characters)'); break;
      case 'text': if (!str(b.text)) bad('needs text'); break;
      case 'list':
        if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30 || !b.items.every(x => str(x, 600))) bad('needs 1 to 30 items of text');
        if (b.style && !['bullets', 'numbers'].includes(b.style)) bad('style must be "bullets" or "numbers"');
        break;
      case 'callout':
        if (!KINDS.includes(b.kind || 'key')) bad(`kind must be one of ${KINDS.join(', ')}`);
        if (!str(b.text, 1500)) bad('needs text (up to 1500 characters)');
        if (b.title !== undefined && !str(b.title, 120)) bad('title must be short text');
        break;
      case 'table': {
        const cols = b.columns, rows = b.rows;
        if (!Array.isArray(cols) || cols.length < 2 || cols.length > LIMITS.cols || !cols.every(c => isStr(c) && c.length <= 120)) { bad(`needs 2 to ${LIMITS.cols} column names`); break; }
        if (!Array.isArray(rows) || !rows.length || rows.length > LIMITS.rows) { bad(`needs 1 to ${LIMITS.rows} rows`); break; }
        rows.forEach((r, k) => { if (!Array.isArray(r) || r.length !== cols.length || !r.every(c => isStr(c) && c.length <= 600)) bad(`row ${k + 1} must have exactly ${cols.length} cells of text`); });
        if (b.caption !== undefined && !str(b.caption, 200)) bad('caption must be short text');
        break;
      }
      case 'steps':
        if (!Array.isArray(b.steps) || b.steps.length < 2 || b.steps.length > LIMITS.steps || !b.steps.every(s => s && str(s.title, 120) && (s.text === undefined || str(s.text, 600)))) bad(`needs 2 to ${LIMITS.steps} steps, each with a title`);
        break;
      case 'compare':
        if (!Array.isArray(b.items) || b.items.length < 2 || b.items.length > 4 || !b.items.every(x => x && str(x.title, 120) && Array.isArray(x.points) && x.points.length > 0 && x.points.length <= 10 && x.points.every(p => str(p, 400)))) bad('needs 2 to 4 columns, each with a title and 1 to 10 points');
        else if (b.items.some(x => x.tone && !['neutral', 'good', 'bad'].includes(x.tone))) bad('tone must be neutral, good or bad');
        break;
      case 'stats':
        if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 6 || !b.items.every(x => x && str(x.value, 40) && str(x.label, 160))) bad('needs 1 to 6 items, each with a short value and a label');
        break;
      case 'chart': {
        if (!['bar', 'line'].includes(b.kind)) { bad('kind must be "bar" or "line"'); break; }
        const cats = b.categories, ser = b.series;
        if (!Array.isArray(cats) || cats.length < 2 || cats.length > LIMITS.cats || !cats.every(c => str(c, 40))) { bad(`needs 2 to ${LIMITS.cats} categories`); break; }
        if (!Array.isArray(ser) || !ser.length || ser.length > LIMITS.series) { bad(`needs 1 to ${LIMITS.series} series`); break; }
        ser.forEach((s, k) => {
          if (!s || !str(s.name, 60)) bad(`series ${k + 1} needs a name`);
          else if (!Array.isArray(s.values) || s.values.length !== cats.length || !s.values.every(v => typeof v === 'number' && isFinite(v))) bad(`series "${s.name}" needs exactly ${cats.length} numbers`);
          else if (b.yScale === 'log' && s.values.some(v => v <= 0)) bad('a log scale needs every number to be above zero');
        });
        if (b.yScale && !['linear', 'log'].includes(b.yScale)) bad('yScale must be "linear" or "log"');
        if (!str(b.title, 160)) bad('needs a title');
        break;
      }
      case 'image':
        if (!isStr(b.image) || !b.image) bad('needs an image');
        else if (imageOk && imageOk(b.image) === false) bad('that picture was not found');
        if (!str(b.alt, 300)) bad('needs a description of the picture for people who cannot see it (alt)');
        break;
      default: bad('unknown block type. Use heading, text, list, callout, table, steps, compare, stats, chart or image');
    }
    return out;
  }

  // check(l, ctx) -> [{ level, msg }].  ctx: { boards:[{id}], subjects:{boardId:[]}, ids:Set, label, imageOk(name) }
  function check(l, ctx) {
    const out = [], err = m => out.push({ level: 'error', msg: m }), warn = m => out.push({ level: 'warn', msg: m });
    const boardIds = new Set(ctx.boards.map(b => b.id));
    if (!l.id) err('missing id'); else if (!/^[a-z0-9][a-z0-9-]*$/.test(l.id)) err('id must be lowercase letters, digits and hyphens'); else if (ctx.ids && ctx.ids.has(l.id)) err('duplicate id'); else if (ctx.ids) ctx.ids.add(l.id);
    if (!STATUS.includes(l.status)) err('status must be "draft" or "reviewed"');
    if (l.tier !== undefined && !TIERS.includes(l.tier)) err('tier must be "free" or "pro"');
    if (l.objectives != null) {
      if (!Array.isArray(l.objectives) || l.objectives.length > 12 || l.objectives.some(o => typeof o !== 'string' || !/^(aem|om|pm):[TK][0-9]+(\.[A-Za-z0-9]+)*$/.test(o))) err('objectives must be a list of at most 12 board outline items such as "aem:K1.E.1"');
      else { l.objectives.forEach(o => { if (ctx.knownObjective && !ctx.knownObjective(o)) warn(`objective "${o}" is not an item in the board outline`); else if (Array.isArray(l.boards) && l.boards.length && !l.boards.includes(o.split(':')[0])) warn(`objective "${o}" is from a board this lesson is not listed for`); }); }
    }
    if (!Array.isArray(l.boards) || !l.boards.length || l.boards.some(b => !boardIds.has(b))) err('invalid boards (use aem, om, pm)');
    else if (!l.subject) err('missing subject');
    else if (!l.boards.some(b => (ctx.subjects[b] || []).includes(l.subject))) err(`subject "${l.subject}" is not listed for board(s) ${l.boards.join(', ')} in the manifest`);
    if (!str(l.title, 160)) err('needs a title (up to 160 characters)');
    if (l.summary !== undefined && (!isStr(l.summary) || l.summary.length > 400)) err('summary must be text up to 400 characters');
    if (l.order !== undefined && !(Number.isInteger(l.order) && l.order >= 0 && l.order <= 100000)) err('order must be a whole number');
    if (!Array.isArray(l.blocks) || !l.blocks.length) err('needs at least one block of content');
    else if (l.blocks.length > LIMITS.blocks) err(`too many blocks (${l.blocks.length}); split it into two lessons`);
    else {
      l.blocks.forEach((b, i) => checkBlock(b, i, ctx.imageOk).forEach(m => err(m)));
      if (!l.blocks.some(b => b && b.type === 'text' || b && b.type === 'list')) warn('has no explanatory text, only visuals');
      if (l.blocks.length && l.blocks[0].type !== 'heading' && l.blocks[0].type !== 'text' && l.blocks[0].type !== 'stats') warn('usually starts with a heading or a short introduction');
    }
    if (l.references !== undefined && (!Array.isArray(l.references) || !l.references.every(r => str(r, 300)))) err('references must be a list of short text');
    else if (!l.references || !l.references.length) warn('no references');
    if (!l.summary) warn('no summary (shown on the lesson list)');
    return out;
  }

  function normalize(l) {
    const clean = {}, dropped = [];
    Object.keys(l || {}).forEach(k => { if (FIELDS.includes(k)) clean[k] = l[k]; else dropped.push(k); });
    if (clean.status === undefined) clean.status = 'draft';
    if (clean.tier === undefined) clean.tier = 'pro';
    ['id', 'title', 'summary'].forEach(k => { if (isStr(clean[k])) clean[k] = clean[k].trim(); });
    if (Array.isArray(clean.references)) clean.references = clean.references.map(r => String(r).trim()).filter(Boolean);
    if (Array.isArray(clean.objectives)) { const seen = new Set(); clean.objectives = clean.objectives.map(o => String(o).trim()).map(o => { const m = o.match(/^([A-Za-z]+):\s*([A-Za-z])([0-9][A-Za-z0-9.]*)$/); return m ? m[1].toLowerCase() + ':' + m[2].toUpperCase() + m[3] : o; }).filter(o => o && !seen.has(o) && seen.add(o)); }
    return { clean, dropped };
  }
  return { check, checkBlock, normalize, FIELDS, STATUS, TIERS, KINDS, LIMITS };
});
