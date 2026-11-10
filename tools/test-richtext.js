#!/usr/bin/env node
// Tests for the light text formatting (js/richtext.js):  node tools/test-richtext.js
const R = require('../js/richtext.js');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '   ' + extra}`); };
t('**bold** becomes strong', R.inline('I want **this part** bold.') === 'I want <strong>this part</strong> bold.', R.inline('I want **this part** bold.'));
t('*italic* becomes em, and two in one line both work', R.inline('a *b* and *c*') === 'a <em>b</em> and <em>c</em>', R.inline('a *b* and *c*'));
t('bold and italic can share a line', R.inline('**Key:** the *first* sign') === '<strong>Key:</strong> the <em>first</em> sign');
t('line breaks become <br>', R.inline('one\ntwo') === 'one<br>two');
t('a lone asterisk, a multiplication sign and a space-padded star are left alone', R.inline('2 * 3 = 6') === '2 * 3 = 6' && R.inline('*') === '*' && R.inline('a * b * c') === 'a * b * c');
t('markup in the text is escaped, so it cannot inject HTML', R.inline('<b onclick="x">hi</b> **ok**') === '&lt;b onclick=&quot;x&quot;&gt;hi&lt;/b&gt; <strong>ok</strong>');
t('strip removes the markers for labels and screen readers', R.strip('I want **this** and *that*') === 'I want this and that' && R.strip(null) === '');
t('empty and missing text are fine', R.inline('') === '' && R.inline(undefined) === '');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
