'use strict';
const O = require('../js/objectives.js'), D = require('../js/outlines-data.js'), M = require('../data/manifest.json');
let pass = 0, fail = 0; const t = (n, ok, x) => { if (ok) { pass++; console.log('  pass  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? ' ' + x : '')); } };

console.log('The outlines');
t('all three boards are there with the published number of items', D.aem.items.length === 175 && D.om.items.length === 170 && D.pm.items.length === 188);
t('Occupational and Public Health both list tasks (T) and knowledge (K); Aerospace is knowledge only', D.om.items.some(i => i.kind === 'T') && D.pm.items.some(i => i.kind === 'T') && D.aem.items.every(i => i.kind === 'K'));
t('codes are unique within a board and kind', ['aem', 'om', 'pm'].every(b => { const k = D[b].items.map(i => i.kind + i.code); return new Set(k).size === k.length; }));
t('numbered codes have no gaps (K1.1 ... K1.18 and so on)', ['om', 'pm'].every(b => { const by = {}; D[b].items.forEach(i => { const m = i.code.match(/^([TK]\d+)\.(\d+)$/); if (m) (by[m[1]] ||= []).push(+m[2]); }); return Object.values(by).every(v => v.length === Math.max(...v)); }));
t('wording is copied as published (spot checks)', D.aem.items.find(i => i.code === 'K1.E.1').text === 'Hypobaric exposures' && D.om.items.find(i => i.code === 'K1.10').text.startsWith('OSHA legal Standards') && D.pm.items.find(i => i.code === 'K3.12').text === 'Statistical inference and hypothesis testing');
t('no web-page footer or stray ligature gaps leaked into the text', ['aem', 'om', 'pm'].every(b => D[b].items.every(i => !/Terms of Use|West Jackson|\b(fi|fl|ffi) [a-z]/.test(i.text + i.detail?.join(' ')))));
t('each board says where it came from', ['aem', 'om', 'pm'].every(b => /theabpm\.org/.test(D[b].url) && D[b].retrieved === '2026-10-03'));

console.log('Sections');
const subj = []; ['aem', 'om', 'pm'].forEach(b => M.subjects[b].forEach(s => subj.push([b, s])));
t('every one of the 23 subjects has outline items', subj.length === 23 && subj.every(([b, s]) => O.forSection(b, s).length > 0), subj.filter(([b, s]) => !O.forSection(b, s).length).join());
t('every code listed for a subject exists in its outline (no typos)', subj.every(([b, s]) => O.ANCHORS[b][s].every(c => O.board(b).items.some(i => i.code === c || i.code.startsWith(c + '.')))));
t('a subject that has no entry gives nothing', O.forSection('aem', 'Nope').length === 0 && O.forTopic('aem', 'Nope', 'x', []).length === 0 && O.headlines('om', 'Nope').length === 0);
t('a code covers its group: K1.C brings K1.C.1 to K1.C.15', O.forSection('aem', 'Aviation Physiology').filter(i => /^K1\.C\.\d+$/.test(i.code)).length === 15);
t('headline items are the listed codes, in order', O.headlines('aem', 'Altitude & Decompression', 3).map(i => i.code).join() === 'K1.E,K1.C.14,K1.C.11');
t('a subject maps to its board', O.boardOf('Space Medicine', M.subjects) === 'aem' && O.boardOf('Biostatistics', M.subjects) === 'pm' && O.boardOf('Toxicology', M.subjects) === 'om' && O.boardOf('Zzz', M.subjects) === null);

console.log('Topics');
const top = (b, s, tp, q) => O.forTopic(b, s, tp, q || []).map(x => x.item.code + ':' + x.via[0]).join();
t('Hypoxia in Altitude lands on hypobaric exposures', top('aem', 'Altitude & Decompression', 'Hypoxia') === 'K1.E.1:t');
t('everyday words reach the clinical terms (vision -> ophthalmologic)', /^K1\.C\.10:t/.test(top('aem', 'Aviation Physiology', 'Vision at altitude, night vision, dark adaptation')));
t('Cabin pressurization and O2 systems lands on survival and life-support systems', /K1\.H\.1\.vii:t/.test(top('aem', 'Altitude & Decompression', 'Cabin pressurization and O2 systems')));
t('Noise exposure limits lands on noise thresholds', /^K4\.7:t/.test(top('om', 'Hearing Conservation & Noise', 'Noise exposure limits')));
t('Public health law and ethics finds the ethics and the law items', /K5\.1:t/.test(top('pm', 'Health Policy & Management', 'Public health law and ethics')) && /K2\.22:t/.test(top('pm', 'Health Policy & Management', 'Public health law and ethics')));
t('the words of the topic count, not the generic ones ("basics" alone matches nothing)', top('aem', 'Aviation Physiology', 'Basics') === 'K1.A:s,K1.B:s');
t('a topic with no match falls back to the first items of its section, marked as section', O.forTopic('aem', 'Aviation Physiology', 'Xyzzy', []).every(x => x.via === 'section') && O.forTopic('aem', 'Aviation Physiology', 'Xyzzy', []).length === 2);
t('only the closest second item is added', O.forTopic('aem', 'Altitude & Decompression', 'Hypoxia', []).length === 1);
t('the questions of a topic help too', (() => { const q = [{ subject: 'Space Medicine', topic: 'Zzz', stem: 'Astronauts show bone loss from microgravity', explanation: '' }]; return O.forTopic('aem', 'Space Medicine', 'Zzz', q)[0].item.code === 'K1.D.2'; })());
t('results never cross into another section\'s items', (() => { const ok = new Set(O.forSection('om', 'Toxicology').map(i => i.code)); return ['Pneumoconioses', 'Lead', 'Solvents'].every(tp => O.forTopic('om', 'Toxicology', tp, []).every(x => ok.has(x.item.code))); })());
t('pneumoconioses matches the outline\'s pneumoconiosis', O.forTopic('om', 'Occupational Lung Disease', 'Pneumoconioses', []).some(x => x.via === 'topic' && x.item.code === 'K1.2'));

console.log('Labels');
const l = O.label(D.aem.items.find(i => i.code === 'K1.E.1') && O.board('aem').byCode.get('K1.E.1'));
t('a child item shows what it sits under, without the trailing "related to:"', l.code === 'K1.E.1' && l.under.code === 'K1.E' && l.under.text === 'Pressure effects on human physiology', JSON.stringify(l));
t('a top-level item has nothing above it', O.label(O.board('om').byCode.get('K1.10')).under === null);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
