#!/usr/bin/env node
// Tests for the calculator maths (js/calc.js):  node tools/test-calc.js
const C = require('../js/calc.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
const ev = (s, c) => { try { return C.evaluate(s, c); } catch (e) { return 'ERR:' + e.message; } };
const near = (a, b, e = 1e-9) => typeof a === "number" && Math.abs(a - b) < e;

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
console.log('Trigonometry');
const D = { angle: 'deg' }, R = { angle: 'rad' };
t('radians are the default for the maths itself', near(ev('sin(pi/6)'), 0.5) && ev('cos(pi)') === -1 && near(ev('tan(pi/4)'), 1));
t('degree mode: the common angles come out clean', ev('sin(30)', D) === 0.5 && ev('cos(60)', D) === 0.5 && ev('tan(45)', D) === 1 && ev('sin(90)', D) === 1 && ev('cos(90)', D) === 0 && ev('sin(180)', D) === 0 && ev('cos(180)', D) === -1 && ev('sin(0)', D) === 0);
t('degree mode: inverse functions give degrees', near(ev('asin(0.5)', D), 30) && near(ev('acos(0.5)', D), 60) && near(ev('atan(1)', D), 45) && ev('asin(1)', D) === 90);
t('radian mode: inverse functions give radians', near(ev('atan(1)', R), Math.PI / 4) && near(ev('acos(0)', R), Math.PI / 2));
t('sec, csc and cot', ev('sec(60)', D) === 2 && ev('csc(30)', D) === 2 && ev('cot(45)', D) === 1);
t('arcsin, arccos and arctan are accepted too, in any case', near(ev('arcsin(0.5)', D), 30) && near(ev('ARCTAN(1)', D), 45) && ev('SIN(30)', D) === 0.5);
t('they combine with the rest of the maths', ev('2sin(30)', D) === 1 && near(ev('sin(asin(0.3))', R), 0.3) && ev('1/cos(60)', D) === 2 && ev('sin(30)+cos(60)', D) === 1 && near(ev('sqrt(3)/2 - sin(60)', D), 0));
t('an aeromedical sum: load factor in a 60 degree banked turn is 2 g', ev('1/cos(60)', D) === 2 && near(ev('1/cos(75.5225)', D), 4, 0.0001) || near(ev('1/cos(75.5225)', D), 4));
t('negative angles and big angles', ev('sin(-30)', D) === -0.5 && ev('sin(390)', D) === 0.5 && ev('cos(360)', D) === 1);
t('places where a function does not exist say so', /not defined/.test(ev('tan(90)', D)) && /not defined/.test(ev('tan(270)', D)) && /not defined/.test(ev('cot(0)', D)) && /not defined/.test(ev('csc(0)', D)) && /not defined/.test(ev('sec(90)', D)) && /not defined/.test(ev('tan(pi/2)', R)));
t('asin and acos need a value from -1 to 1', /from -1 to 1/.test(ev('asin(2)', D)) && /from -1 to 1/.test(ev('acos(-1.5)', D)));
t('a trig name needs brackets', /Use sin/.test(ev('sin 30', D)) && /Missing/.test(ev('sin(30', D)));
t('the result is formatted without noise', C.format(ev('cos(60)', D)) === '0.5' && C.format(ev('sin(180)', D)) === '0' && C.format(ev('tan(30)', D)) === '0.57735026919');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
