'use strict';
// Grouping and sorting items (questions, lessons, flashcards) by subject, by topic or by board learning objective (an outline domain, with its
// percent of the exam). Pure logic, no page code. Runs in the browser and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require('./outlinechart.js') : root.OutlineChart); else root.GroupBy = factory(root.OutlineChart);
})(typeof self !== 'undefined' ? self : this, function (OC) {
  const MODES = { subject: 'Subject', topic: 'Topic', objective: 'Learning objective' };
  const NONE = 'Not tagged to the outline yet';
  // ctx: { boards: [{ id, name }], subjects: { boardId: [subject, ...] } } (the bank's own order); boards name the objective groups
  const boardName = (ctx, id) => ((ctx && ctx.boards || []).find(b => b.id === id) || { name: id }).name;
  const boardIdx = (ctx, id) => { const i = ((ctx && ctx.boards) || []).findIndex(b => b.id === id); return i < 0 ? 99 : i; };
  const subjIdx = (ctx, s) => { let i = 0; for (const b of ((ctx && ctx.boards) || [])) for (const x of ((ctx.subjects || {})[b.id] || [])) { if (x === s) return i; i++; } return 999; };
  const num = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  // The groups an item belongs to: [{ key, label, sub, sort }]. An item tagged in two domains is in both; one with no tag is in the last group.
  function keys(item, mode, ctx) {
    if (mode === 'topic') return [{ key: 'T|' + item.subject + '|' + (item.topic || ''), label: item.topic || '(no topic)', sub: item.subject, sort: [subjIdx(ctx, item.subject), item.topic ? 0 : 1, String(item.topic || '').toLowerCase()] }];
    if (mode === 'objective') {
      const ds = OC ? OC.domainsOf(item) : [];
      if (!ds.length) return [{ key: 'O|none', label: NONE, sub: '', sort: [999, 0, '']}];
      return ds.map(d => ({ key: 'O|' + d.board + '|' + d.key, label: (/^[IVX]+$/.test(d.key) ? d.key + '. ' : d.key + ' ') + d.name, sub: boardName(ctx, d.board), weight: d.weight, sort: [boardIdx(ctx, d.board), d.order, '']}));
    }
    return [{ key: 'S|' + item.subject, label: item.subject || '(no subject)', sub: '', sort: [subjIdx(ctx, item.subject), 0, '']}];
  }
  const cmp = (a, b) => num(a[0], b[0]) || num(a[1], b[1]) || num(a[2], b[2]);

  // Items grouped in order: [{ key, label, sub, weight, items }]. within: how to order the items inside a group.
  function groups(items, mode, ctx, within) {
    const by = new Map();
    (items || []).forEach(it => keys(it, mode, ctx).forEach(k => { let g = by.get(k.key); if (!g) by.set(k.key, g = { key: k.key, label: k.label, sub: k.sub, weight: k.weight, sort: k.sort, items: [] }); g.items.push(it); }));
    const list = [...by.values()].sort((a, b) => cmp(a.sort, b.sort) || a.label.localeCompare(b.label));
    if (within) list.forEach(g => { g.items = g.items.slice().sort(within); });
    return list;
  }
  // The items in one list, ordered by group (subject, topic or objective), then by tie. An item in several groups appears once, by its first group.
  function sortItems(items, mode, ctx, tie) {
    const first = it => keys(it, mode, ctx)[0].sort;
    return (items || []).slice().sort((a, b) => cmp(first(a), first(b)) || (tie ? tie(a, b) : 0));
  }
  // For a table already ordered by sortItems: heading(item) returns the group's heading the first time it appears in a row, else ''.
  function heading(mode, ctx) {
    let last = null;
    return it => { const k = keys(it, mode, ctx)[0]; if (k.key === last) return ''; last = k.key; return (mode === 'topic' && k.sub ? k.sub + ': ' : '') + k.label + (k.weight != null ? ' (' + k.weight + '% of the exam)' : ''); };
  }
  return { MODES, NONE, keys, groups, sortItems, heading };
});
