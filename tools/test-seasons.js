// The dashboard banner seasons: Halloween (October and November 1), winter (November 2 to the end of January), and the usual scene otherwise.
const fs = require('fs'), vm = require('vm'), path = require('path');
const M = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'mascot.js'), 'utf8') + '\n;Mascot', {});
let pass = 0, fail = 0; const ok = (d, c) => { c ? pass++ : fail++; console.log(`  ${c ? 'pass' : 'FAIL'}  ${d}`); };
const d = (y, m, day) => new Date(y, m - 1, day);
ok('winter starts the day after Halloween, November 2', M.winter(d(2026, 11, 2)) && !M.winter(d(2026, 11, 1)) && !M.winter(d(2026, 10, 31)));
ok('winter covers November, December and January', M.winter(d(2026, 11, 30)) && M.winter(d(2026, 12, 25)) && M.winter(d(2027, 1, 1)) && M.winter(d(2027, 1, 31)));
ok('winter ends on February 1', !M.winter(d(2027, 2, 1)) && !M.winter(d(2027, 3, 1)) && !M.winter(d(2026, 9, 30)));
ok('Halloween is unchanged', M.halloween(d(2026, 10, 31)) && M.halloween(d(2026, 11, 1)) && !M.halloween(d(2026, 11, 2)) && !M.halloween(d(2026, 12, 1)));
ok('the two seasons never overlap', Array.from({ length: 365 }, (_, i) => new Date(2026, 0, 1 + i)).every(x => !(M.halloween(x) && M.winter(x))));
ok('forcing winter draws the winter banner', /class="cover winter"/.test(M.scene(undefined, 'winter')) && M.scene(undefined, 'winter').includes('wb-sky'));
ok('forcing Halloween still draws the Halloween banner', /class="cover halloween"/.test(M.scene(undefined, true)));
ok('forcing off draws the plain banner', /class="cover"/.test(M.scene(undefined, false)));
ok('a custom cover image always wins', /cover-photo/.test(M.scene('x.jpg', 'winter')) && !/winter/.test(M.scene('x.jpg', 'winter')));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
