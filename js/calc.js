'use strict';
// Calculator for the question screen. The maths is a small parser (no eval), so it is safe and testable in Node.
//   Calc.evaluate('2*(3+4)^2') -> 98     Supports + - * / ^ ( ) % ! , sqrt log ln exp abs, sin cos tan sec csc cot asin acos atan (also arcsin ...),
//   pi and e, and "ans". Angles are radians unless ctx.angle is 'deg':  Calc.evaluate('sin(30)', { angle: 'deg' }) -> 0.5
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FN = { sqrt: Math.sqrt, log: Math.log10, ln: Math.log, exp: Math.exp, abs: Math.abs };
  // Trig. In degree mode the angle in (or the angle out, for asin acos atan) is in degrees. Results are snapped so sin(180) is 0 and cos(60) is 0.5, not 1.2e-16 and 0.5000000000000001.
  const TRIG_ALIAS = { arcsin: 'asin', arccos: 'acos', arctan: 'atan' };
  const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan']);
  const snap = r => (Math.abs(r) < 1e-14 ? 0 : parseFloat(r.toPrecision(15)));
  function trig(name, v, deg) {
    const k = Math.PI / 180;
    if (name === 'asin' || name === 'acos') { if (v < -1 || v > 1) throw new Error(name + ' needs a value from -1 to 1'); }
    if (name === 'asin' || name === 'acos' || name === 'atan') { const r = Math[name](v); return snap(deg ? r / k : r); }
    const x = deg ? v * k : v, s = snap(Math.sin(x)), c = snap(Math.cos(x));
    if (name === 'sin') return s; if (name === 'cos') return c;
    if (name === 'tan') { if (c === 0) throw new Error('tan is not defined there'); return snap(Math.tan(x)); }
    if (name === 'sec') { if (c === 0) throw new Error('sec is not defined there'); return snap(1 / c); }
    if (name === 'csc') { if (s === 0) throw new Error('csc is not defined there'); return snap(1 / s); }
    if (s === 0) throw new Error('cot is not defined there'); return snap(1 / Math.tan(x));
  }
  const fact = n => { if (n < 0 || n !== Math.floor(n) || n > 170) throw new Error('Factorial needs a whole number from 0 to 170'); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  function tokenize(src) {
    const s = String(src).toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/,/g, '');
    const out = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) { const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i)); if (!m) throw new Error('Bad number'); out.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if (/[a-z]/.test(c)) { const m = /^[a-z]+/.exec(s.slice(i))[0]; out.push({ t: 'w', v: m }); i += m.length; continue; }
      if ('+-*/^()%!'.includes(c)) { out.push({ t: c }); i++; continue; }
      throw new Error('Unexpected "' + c + '"');
    }
    return out;
  }
  function evaluate(src, ctx = {}) {
    const tk = tokenize(src); let p = 0;
    const peek = () => tk[p], eat = t => { if (peek() && peek().t === t) { p++; return true; } return false; };
    // expr := term (('+'|'-') term)*   term := unary (('*'|'/') unary)*   unary := '-' unary | power   power := post ('^' unary)?
    function expr() { let v = term(); for (;;) { if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; } }
    function term() {
      let v = unary();
      for (;;) {
        if (eat('*')) v *= unary();
        else if (eat('/')) { const d = unary(); if (d === 0) throw new Error('Cannot divide by zero'); v /= d; }
        else if (peek() && (peek().t === '(' || peek().t === 'n' || peek().t === 'w')) v *= unary();   // 2(3+4) and 2pi
        else return v;
      }
    }
    function unary() { if (eat('-')) return -unary(); if (eat('+')) return unary(); return power(); }
    function power() { const b = post(); if (eat('^')) return Math.pow(b, unary()); return b; }
    function post() { let v = atom(); for (;;) { if (eat('!')) v = fact(v); else if (eat('%')) v = v / 100; else return v; } }
    function atom() {
      const t = peek(); if (!t) throw new Error('Incomplete expression'); p++;
      if (t.t === 'n') return t.v;
      if (t.t === '(') { const v = expr(); if (!eat(')')) throw new Error('Missing )'); return v; }
      if (t.t === 'w') {
        if (t.v === 'pi') return Math.PI; if (t.v === 'e') return Math.E; if (t.v === 'ans') return ctx.ans || 0;
        const tn = TRIG_ALIAS[t.v] || t.v;
        if (TRIG.has(tn)) { if (!eat('(')) throw new Error('Use ' + t.v + '( )'); const v = expr(); if (!eat(')')) throw new Error('Missing )'); return trig(tn, v, ctx.angle === 'deg'); }
        if (Object.prototype.hasOwnProperty.call(FN, t.v)) { if (!eat('(')) throw new Error('Use ' + t.v + '( )'); const v = expr(); if (!eat(')')) throw new Error('Missing )'); return FN[t.v](v); }
        throw new Error('Unknown "' + t.v + '"');
      }
      throw new Error('Unexpected "' + t.t + '"');
    }
    const v = expr(); if (p < tk.length) throw new Error('Unexpected "' + tk[p].t + (tk[p].v || '') + '"');
    if (!isFinite(v) || isNaN(v)) throw new Error('Not a real number');
    return v;
  }
  function format(v) {   // 12 significant digits, no trailing noise (0.1+0.2 shows as 0.3)
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e12 || a < 1e-7) return v.toExponential(6).replace(/\.?0+e/, 'e');
    return String(parseFloat(v.toPrecision(12)));
  }
  return { evaluate, format };
});
