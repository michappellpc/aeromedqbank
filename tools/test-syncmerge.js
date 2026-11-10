#!/usr/bin/env node
// Tests for the incremental refresh of the bank lists (js/syncmerge.js):  node tools/test-syncmerge.js
const M = require('../js/syncmerge.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const saved = { a: '2026-01-01T00:00:00Z', b: '2026-01-02T00:00:00Z', c: '2026-01-03T00:00:00Z' };
const server = [{ id: 'a', updated_at: '2026-01-01T00:00:00Z' }, { id: 'b', updated_at: '2026-02-09T10:00:00Z' }, { id: 'd', updated_at: '2026-02-10T00:00:00Z' }];
const p = M.plan(saved, server);
t('only changed and new rows are fetched', p.fetch.join() === 'b,d', p.fetch.join());
t('rows no longer on the server are removed', p.remove.join() === 'c');
t('nothing to do when nothing changed', M.plan(saved, Object.entries(saved).map(([id, u]) => ({ id, updated_at: u }))).same === true && p.same === false);
t('with nothing saved, everything is fetched', M.plan(null, server).fetch.length === 3 && M.plan({}, server).remove.length === 0);
t('a missing stamp on the server still counts as a change the first time, then settles', M.plan({ a: '' }, [{ id: 'a' }]).same === true && M.plan({ a: 'x' }, [{ id: 'a' }]).fetch.join() === 'a');
const list = [{ id: 'a', stem: 'A' }, { id: 'b', stem: 'B old' }, { id: 'c', stem: 'C' }];
const out = M.apply(list, [{ id: 'b', stem: 'B new' }, { id: 'd', stem: 'D' }], ['c']);
t('the list is updated in place: changed rows replaced, removed rows gone, new rows added', out.map(x => x.id + ':' + x.stem).join('|') === 'a:A|b:B new|d:D', JSON.stringify(out));
t('the saved stamps become the server\'s', JSON.stringify(M.stamps(server)) === JSON.stringify({ a: '2026-01-01T00:00:00Z', b: '2026-02-09T10:00:00Z', d: '2026-02-10T00:00:00Z' }));
t('apply with nothing fetched and nothing removed returns the same items', M.apply(list, [], []).length === 3);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
