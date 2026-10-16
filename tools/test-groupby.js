#!/usr/bin/env node
// Tests for grouping and sorting by subject, topic or board learning objective (js/groupby.js).
//   node tools/test-groupby.js
const GB = require('../js/groupby.js'), OC = require('../js/outlinechart.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const ctx = { boards: [{ id: 'aem', name: 'Aerospace Medicine' }, { id: 'om', name: 'Occupational Medicine' }], subjects: { aem: ['Aviation Physiology', 'Altitude & Decompression'], om: ['Toxicology'] } };
const it = (id, subject, topic, objectives) => ({ id, title: id, subject, topic, objectives: objectives || [] });
const items = [it('a', 'Altitude & Decompression', 'Hypoxia', ['aem:K1.E.1']), it('b', 'Aviation Physiology', 'Vision', ['aem:K2.A.5', 'aem:K1.F.1']), it('c', 'Toxicology', 'Metals', ['om:K4.22']), it('d', 'Altitude & Decompression', '', []), it('e', 'Aviation Physiology', 'Hearing', ['aem:K1.E.1'])];

console.log('Domains of an item');
const d = OC.domainsOf(items[1]);
t('an item is placed in each outline domain it is tagged into, in outline order, with the domain\'s weight', d.map(x => x.key).join() === 'K1,K2' && d[0].weight === 20 && d[1].weight === 33 && d[0].name === 'The Human within the Flight Environment', JSON.stringify(d));
t('a tag that is not an outline item, or no tag, places it nowhere', OC.domainsOf({ objectives: ['aem:K9.9', 'junk'] }).length === 0 && OC.domainsOf({}).length === 0);

console.log('Groups');
const gs = GB.groups(items, 'subject', ctx).map(g => g.label);
t('by subject: in the bank\'s own order (board, then subject order)', gs.join('|') === 'Aviation Physiology|Altitude & Decompression|Toxicology', gs.join('|'));
const gt = GB.groups(items, 'topic', ctx);
t('by topic: topics under their subject, in subject order then A to Z, and items with no topic last in their subject', gt.map(g => g.sub + ':' + g.label).join('|') === 'Aviation Physiology:Hearing|Aviation Physiology:Vision|Altitude & Decompression:Hypoxia|Altitude & Decompression:(no topic)|Toxicology:Metals', gt.map(g => g.sub + ':' + g.label).join('|'));
const go = GB.groups(items, 'objective', ctx);
t('by learning objective: outline domains in outline order, boards in the bank\'s order, untagged items last', go.map(g => g.label).join('|') === 'K1 The Human within the Flight Environment|K2 Clinical Aerospace Medicine|IV. Hazard and Disaster Prevention and Management|' + GB.NONE, go.map(g => g.label).join('|'));
t('each objective group carries its board and its percent of the exam', go[0].sub === 'Aerospace Medicine' && go[0].weight === 20 && go[1].weight === 33 && go[2].sub === 'Occupational Medicine' && go[2].weight === 8, JSON.stringify(go.map(g => [g.sub, g.weight])));
t('an item tagged in two domains is in both groups, and every item is somewhere', go[0].items.map(x => x.id).join() === 'a,b,e' && go[1].items.map(x => x.id).join() === 'b' && go[3].items.map(x => x.id).join() === 'd');
t('items inside a group can be ordered', GB.groups(items, 'objective', ctx, (a, b) => b.id.localeCompare(a.id))[0].items.map(x => x.id).join() === 'e,b,a');

console.log('Sorting one list');
t('by subject, topic and objective each keep every item once', ['subject', 'topic', 'objective'].every(m => GB.sortItems(items, m, ctx).length === items.length && new Set(GB.sortItems(items, m, ctx).map(x => x.id)).size === items.length));
t('sorted by topic: subject order, then topic A to Z', GB.sortItems(items, 'topic', ctx).map(x => x.id).join() === 'e,b,a,d,c', GB.sortItems(items, 'topic', ctx).map(x => x.id).join());
t('sorted by learning objective: first domain, outline order, untagged last, ties broken as asked', GB.sortItems(items, 'objective', ctx, (a, b) => a.id.localeCompare(b.id)).map(x => x.id).join() === 'a,b,e,c,d', GB.sortItems(items, 'objective', ctx, (a, b) => a.id.localeCompare(b.id)).map(x => x.id).join());
t('the original list is not changed', items.map(x => x.id).join() === 'a,b,c,d,e');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
