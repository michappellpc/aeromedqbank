#!/usr/bin/env node
// Renders the mascot into PNG app icons (needs Playwright + Chromium): node tools/make-icons.js
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'mascot.js'), 'utf8') + ';global.M = Mascot');
const out = path.join(__dirname, '..', 'icons');
const jobs = [['icon-192.png', 192, .82], ['icon-512.png', 512, .82], ['icon-maskable-512.png', 512, .62], ['apple-touch-icon.png', 180, .8]];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const [name, size, fill] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const svg = M.sprite('idle', 1).replace(/width="\d+" height="\d+"/, `width="${Math.round(size * fill)}" height="${Math.round(size * fill)}"`);
    await p.setContent(`<body style="margin:0;width:${size}px;height:${size}px;background:#4b5320;display:grid;place-items:center">${svg}</body>`);
    await p.screenshot({ path: path.join(out, name) });
    await p.close();
  }
  await b.close();
})();
