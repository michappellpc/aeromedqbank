#!/usr/bin/env node
// Tests for the calculator maths (js/calc.js):  node tools/test-calc.js
const C = require('../js/calc.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const ev = (s, c) => { try { return C.evaluate(s, c); } catch (e) { return 'ERR:' + e.message; } };
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;

console.log('Arithmetic');
t('order of operations', ev('2+3*4') === 14 && ev('(2+3)*4') === 20 && ev('10-4-3') === 3 && ev('100/5/2') === 10);
t('unary minus and powers', ev('-3^2') === -9 && ev('2^3^2') === 512 && ev('(-3)^2') === 9 && ev('2^-1') === 0.5);
t('implicit multiplication', ev('2(3+4)') === 14 && near(ev('2pi'), 2 * Math.PI));
t('decimals and exponent notation', ev('.5+.25') === 0.75 && ev('1.5e3') === 1500);
t('typed symbols are accepted', ev('6×3÷2') === 9 && ev('5−2') === 3);
t('percent and factorial', ev('50%') === 0.5 && ev('5!') === 120 && ev('0!') === 1);
t('thousands commas are ignored', ev('1,000+1') === 1001);

console.log('Functions and constants');
t('sqrt, log, ln, exp, abs', ev('sqrt(144)') === 12 && ev('log(1000)') === 3 && near(ev('ln(e)'), 1) && near(ev('exp(0)'), 1) && ev('abs(-7)') === 7);
t('pi, e and ans', near(ev('pi'), Math.PI) && near(ev('e'), Math.E) && ev('ans*2', { ans: 21 }) === 42);
t('a typical biostatistics sum: sensitivity and PPV', near(ev('90/(90+10)'), 0.9) && near(ev('(0.9*0.01)/(0.9*0.01+0.05*0.99)'), 0.15384615384615385));
t('a typical epidemiology sum: relative risk and NNT', near(ev('(15/100)/(5/100)'), 3) && near(ev('1/(0.15-0.05)'), 10));

console.log('Mistakes give a message, never a crash');
t('divide by zero', /zero/.test(ev('1/0')));
t('unbalanced brackets', /Missing/.test(ev('(1+2')) && /Unexpected/.test(ev('1+2)')));
t('unknown words and symbols', /Unknown/.test(ev('foo(2)')) && /Unexpected/.test(ev('2 # 3')));
t('empty and incomplete', /Incomplete/.test(ev('')) && /Incomplete/.test(ev('2+')));
t('not a real number', /real/.test(ev('sqrt(-1)')) && /real/.test(ev('ln(-1)')));
t('code cannot be run through it', /Unknown|Unexpected/.test(ev('alert(1)')) && /Unknown/.test(ev('constructor')));
t('bad factorial', /whole/.test(ev('2.5!')) && /whole/.test(ev('(-1)!')));

console.log('Display');
t('floating noise is trimmed', C.format(0.1 + 0.2) === '0.3' && C.format(1 / 3) === '0.333333333333');
t('big and small numbers use exponent form', /e\+?12|e12/.test(C.format(1e12)) && /e-8/.test(C.format(1.5e-8)));
t('zero', C.format(0) === '0');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
