#!/usr/bin/env node
// Builds one self-contained HTML body (CSS, JS and questions inlined): node tools/build-preview.js <out.html>
const fs = require('fs'), path = require('path'), r = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const man = JSON.parse(r('data/manifest.json'));
const data = { config: JSON.parse(r('data/config.json')), boards: man.boards, subjects: man.subjects, questions: man.files.flatMap(f => JSON.parse(r('data/' + f))), lessons: (man.lessons || []).flatMap(f => JSON.parse(r('data/' + f))), cards: (man.cards || []).flatMap(f => JSON.parse(r('data/' + f))).filter(c => c.status === 'reviewed' && !c.archived) };
const css = r('css/style.css').replace(/url\(\.\.\/fonts\/([^)]+)\)/g, (m, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, '..', 'fonts', f)).toString('base64')})`);
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const html = r('index.html');
const logo = `data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, '..', 'icons', 'logo.svg')).toString('base64')}`;
const body = html.match(/<body>([\s\S]*?)<script src/)[1].replace(/icons\/logo\.svg/g, logo);
const out = `<title>AeroMedQBank</title>\n<style>\n${css}\nbody{padding-inline:0}\n</style>\n${body}
<script>window.__QBANK_DATA=${safe(JSON.stringify(data))};</script>
<script>\n${safe(r('js/store.js'))}\n</script>
<script>\n${safe(r('js/cloud.js'))}\n</script>
<script>\n${safe(r('js/qvalidate.js'))}\n</script>\n<script>\n${safe(r('js/related.js'))}\n</script>\n<script>\n${safe(r('js/cardsched.js'))}\n</script>\n<script>\n${safe(r('js/cvalidate.js'))}\n</script>\n<script>\n${safe(r('js/lvalidate.js'))}\n</script>\n<script>\n${safe(r('js/lessons.js'))}\n</script>\n<script>\n${safe(r('js/cards.js'))}\n</script>\n<script>\n${safe(r('js/program.js'))}\n</script>\n<script>\n${safe(r('js/mascot.js'))}\n</script>\n<script>\n${safe(r('js/admin.js'))}\n</script>\n<script>\n${safe(r('js/adminlessons.js'))}\n</script>\n<script>\n${safe(r('js/admincards.js'))}\n</script>\n<script>\n${safe(r('js/inbox.js'))}\n</script>\n<script>\n${safe(r('js/support.js'))}\n</script>\n<script>\n${safe(r('js/app.js').replace(/icons\/logo\.svg/g, logo))}\n</script>\n`;
fs.writeFileSync(process.argv[2] || 'preview.html', out);
