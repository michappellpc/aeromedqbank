'use strict';
// Lessons: renders a lesson's blocks (text, tables, charts, step flows, comparisons) and the Lessons pages.
// Loaded before app.js; the pages use app.js's helpers (esc, pageTitle, bank, $app, bindZoom, hydrateImages) when they run.
const Lessons = (() => {
  const X = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // **bold**, *italic* and line breaks only. Everything else is shown as plain text, so pasted content cannot inject markup.
  const inline = s => X(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>').replace(/\n/g, '<br>');
  const fmt = v => Number.isInteger(v) ? v.toLocaleString('en-US') : String(+v.toFixed(2));
  const CALLOUT = { pearl: 'Clinical pearl', key: 'Key point', warning: 'Watch out', tip: 'Test-taking tip' };
  let uid = 0;

  // ---------------------------------------------------------------- charts (inline SVG, colours from CSS variables)
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function chart(b) {
    const id = 'lc' + (++uid), W = 640, H = 340, cats = b.categories, S = b.series, n = cats.length, rot = n > 8 || cats.some(c => c.length > 12);
    const m = { l: 74, r: 16, t: 18, b: (rot ? 92 : 58) + (b.xLabel ? 18 : 0) };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, all = S.flatMap(s => s.values), log = b.yScale === 'log';
    let lo = 0, hi, ticks = [];
    if (log) {
      const a = Math.floor(Math.log10(Math.min(...all))), z = Math.max(a + 1, Math.ceil(Math.log10(Math.max(...all))));
      lo = Math.pow(10, a); hi = Math.pow(10, z); for (let e = a; e <= z; e++) ticks.push(Math.pow(10, e));
    } else {
      const step = niceStep(Math.max(...all, 1) / 5); hi = Math.ceil(Math.max(...all, 1) / step) * step; for (let v = 0; v <= hi + step / 1000; v += step) ticks.push(+v.toFixed(6));
    }
    const y = v => log ? m.t + ph * (1 - (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) : m.t + ph * (1 - v / hi);
    const gw = pw / n, bw = Math.min(46, gw * 0.72 / S.length), showVals = n * S.length <= 16;
    let g = ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="lgrid"/><text x="${m.l - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" class="ltick">${fmt(t)}</text>`).join('');
    g += `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" class="laxis"/><line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" class="laxis"/>`;
    cats.forEach((c, i) => {
      const cx = m.l + gw * (i + 0.5), ty = m.t + ph + 16;
      g += rot ? `<text transform="translate(${cx.toFixed(1)} ${ty}) rotate(-35)" text-anchor="end" class="ltick">${X(c)}</text>` : `<text x="${cx.toFixed(1)}" y="${ty}" text-anchor="middle" class="ltick">${X(c)}</text>`;
    });
    S.forEach((s, k) => {
      const col = `var(--cs${(k % 4) + 1})`;
      if (b.kind === 'bar') s.values.forEach((v, i) => {
        const x = m.l + gw * (i + 0.5) - (bw * S.length) / 2 + k * bw, yy = y(v), base = m.t + ph;
        g += `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0, base - yy).toFixed(1)}" rx="2" fill="${col}"/>`;
        if (showVals) g += `<text x="${(x + (bw - 2) / 2).toFixed(1)}" y="${(yy - 5).toFixed(1)}" text-anchor="middle" class="lval">${fmt(v)}</text>`;
      });
      else {
        const pts = s.values.map((v, i) => [m.l + gw * (i + 0.5), y(v)]);
        g += `<polyline points="${pts.map(p => p.map(q => q.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
        pts.forEach(([px, py], i) => { g += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${col}"/>`; if (showVals) g += `<text x="${px.toFixed(1)}" y="${(py - 9).toFixed(1)}" text-anchor="middle" class="lval">${fmt(s.values[i])}</text>`; });
      }
    });
    if (b.yLabel) g += `<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" class="ltitle">${X(b.yLabel)}${log ? ' (log scale)' : ''}</text>`;
    if (b.xLabel) g += `<text x="${m.l + pw / 2}" y="${H - 8}" text-anchor="middle" class="ltitle">${X(b.xLabel)}</text>`;
    const desc = `${b.kind === 'bar' ? 'Bar' : 'Line'} chart: ${b.title}.${b.yLabel ? ' ' + b.yLabel + ' by ' + (b.xLabel || 'category') + '.' : ''} Full numbers are in the table below the chart.`;
    const legend = S.length > 1 ? `<ul class="llegend">${S.map((s, k) => `<li><i style="background:var(--cs${(k % 4) + 1})"></i>${X(s.name)}</li>`).join('')}</ul>` : '';
    const table = `<details class="ldata"><summary>Show the numbers</summary><div class="scroll" role="region" tabindex="0" aria-label="Chart data"><table><thead><tr><th scope="col">${X(b.xLabel || 'Category')}</th>${S.map(s => `<th scope="col">${X(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${cats.map((c, i) => `<tr><th scope="row">${X(c)}</th>${S.map(s => `<td>${fmt(s.values[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
    return `<figure class="lchart"><figcaption>${X(b.title)}</figcaption><div class="lchart-scroll" role="region" tabindex="0" aria-label="${X(b.title)} (chart, scrolls sideways on small screens)"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}t" focusable="false"><title id="${id}t">${X(desc)}</title>${g}</svg></div>${legend}${b.note ? `<p class="muted small">${inline(b.note)}</p>` : ''}${table}</figure>`;
  }

  // ---------------------------------------------------------------- blocks
  function block(b, i) {
    switch (b.type) {
      case 'heading': return `<h3 class="lh" id="lh-${i}">${X(b.text)}</h3>`;
      case 'text': return String(b.text).split(/\n\s*\n/).map(p => `<p>${inline(p.trim())}</p>`).join('');
      case 'list': { const tag = b.style === 'numbers' ? 'ol' : 'ul'; return `<${tag} class="llist">${b.items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`; }
      case 'callout': { const k = b.kind || 'key'; return `<div class="lcallout k-${k}" role="note"><b>${X(b.title || CALLOUT[k])}</b><p>${inline(b.text)}</p></div>`; }
      case 'table': {
        const rowHead = b.firstColumnHeader !== false;
        return `<div class="scroll" role="region" tabindex="0" aria-label="${X(b.caption || 'Table')}"><table class="ltable">${b.caption ? `<caption>${X(b.caption)}</caption>` : ''}<thead><tr>${b.columns.map(c => `<th scope="col">${String(c).trim() ? inline(c) : '<span class="sr">Row</span>'}</th>`).join('')}</tr></thead>
          <tbody>${b.rows.map(r => `<tr>${r.map((c, j) => (j === 0 && rowHead) ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      case 'steps': return `<div class="lblock">${b.title ? `<h3 class="lblock-title">${X(b.title)}</h3>` : ''}<ol class="lsteps">${b.steps.map((s, k) => `<li><span class="ln" aria-hidden="true">${k + 1}</span><div><b>${inline(s.title)}</b>${s.text ? `<p>${inline(s.text)}</p>` : ''}</div></li>`).join('')}</ol></div>`;
      case 'compare': return `<div class="lblock">${b.title ? `<h3 class="lblock-title">${X(b.title)}</h3>` : ''}<div class="lcompare c${b.items.length}">${b.items.map(it => `<section class="lc-${it.tone || 'neutral'}"><h4>${inline(it.title)}</h4><ul>${it.points.map(p => `<li>${inline(p)}</li>`).join('')}</ul></section>`).join('')}</div></div>`;
      case 'stats': return `<div class="lstats">${b.items.map(it => `<div><b>${X(it.value)}</b><span>${inline(it.label)}</span></div>`).join('')}</div>`;
      case 'chart': return chart(b);
      case 'image': {
        const priv = String(b.image).startsWith('private:');
        const img = priv ? `<img class="qimg" data-zoom data-private="${X(b.image.slice(8))}" alt="${X(b.alt)}" title="Tap to enlarge" hidden><p class="muted" data-imgnote>Loading image...</p>` : `<img class="qimg" data-zoom src="${X(b.image)}" alt="${X(b.alt)}" title="Tap to enlarge">`;
        return `<figure class="limg">${img}${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`;
      }
      default: return '';
    }
  }
  const render = blocks => (blocks || []).map(block).join('\n');

  // ---------------------------------------------------------------- pages (need app.js globals when called)
  const board = id => (bank.boards.find(b => b.id === id) || { name: id }).name;
  const enc = encodeURIComponent;
  const staff = () => typeof profile !== 'undefined' && profile && (profile.role === 'admin' || profile.role === 'reviewer');
  const tags = l => l.boards.map(b => `<span class="tag">${X(board(b))}</span>`).join('') + (l.status !== 'reviewed' ? '<span class="tag draft" title="Only admins and reviewers can see drafts">Draft</span>' : '');
  const sorted = list => list.slice().sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
  const done = () => { bindZoom(); hydrateImages(); };

  function indexPage() {
    pageTitle('Lessons');
    const all = bank.lessons || [];
    const tile = (subj, n) => n ? `<a class="subjtile" href="#/lessons/${enc(subj)}"><b>${X(subj)}</b><span>${n} lesson${n === 1 ? '' : 's'}</span></a>` : `<div class="subjtile off" aria-disabled="true"><b>${X(subj)}</b><span>No lessons yet</span></div>`;
    $app.innerHTML = `<div class="pagehead"><div><h2 class="pagetitle">Lessons</h2><p class="muted">Short reviews with tables, charts and step-by-step flows. Choose a subject.</p></div>
      <div class="lsearch"><label class="sr" for="lq">Search lessons</label><input id="lq" type="search" placeholder="Search lessons" autocomplete="off"></div></div>
      <div id="lres"></div>
      <div id="lidx">${bank.boards.map(b => `<section class="card"><h2>${X(b.name)}</h2><div class="subjgrid">${(bank.subjects[b.id] || []).map(s => tile(s, all.filter(l => l.boards.includes(b.id) && l.subject === s).length)).join('')}</div></section>`).join('')}
      ${all.length ? '' : '<p class="muted">Lessons have not been added yet.</p>'}</div>`;
    document.getElementById('lq').addEventListener('input', e => {
      const w = e.target.value.trim().toLowerCase(), res = document.getElementById('lres'), idx = document.getElementById('lidx');
      idx.hidden = !!w; if (!w) { res.innerHTML = ''; return; }
      const hits = all.filter(l => (l.title + ' ' + l.summary + ' ' + l.subject).toLowerCase().includes(w));
      res.innerHTML = `<div class="card" aria-live="polite"><h2>${hits.length} result${hits.length === 1 ? '' : 's'}</h2>${hits.map(card).join('') || '<p class="muted">No lessons match.</p>'}</div>`;
    });
  }
  const card = l => `<a class="lessoncard" href="#/lesson/${enc(l.id)}"><b>${X(l.title)}</b><span class="muted">${X(l.subject)}${l.summary ? ' &middot; ' + X(l.summary) : ''}</span><span>${tags(l)}${Store.hlIn('l', l.id).length ? '<span class="tag hltag">&#9998; Highlighted</span>' : ''}</span></a>`;

  function subjectPage(subject) {
    subject = decodeURIComponent(subject || '');
    pageTitle(subject || 'Lessons');
    const list = sorted((bank.lessons || []).filter(l => l.subject === subject));
    $app.innerHTML = `<div class="pagehead"><div><p class="crumb"><a href="#/lessons">Lessons</a></p><h2 class="pagetitle">${X(subject)}</h2></div><a class="btn primary" href="#/create/${enc(subject)}">Practice questions in this subject</a></div>
      <div class="card">${list.length ? list.map(card).join('') : '<p class="muted">No lessons in this subject yet.</p>'}</div>`;
  }

  function lessonPage(id) {
    id = decodeURIComponent(id || '');
    const l = (bank.lessons || []).find(x => x.id === id);
    if (!l) { pageTitle('Lessons'); $app.innerHTML = '<div class="card"><h2>Lesson not found</h2><p class="muted">It may have been removed. <a href="#/lessons">Back to lessons</a></p></div>'; return; }
    pageTitle(l.title);
    const sib = sorted(bank.lessons.filter(x => x.subject === l.subject)), at = sib.findIndex(x => x.id === l.id), prev = sib[at - 1], next = sib[at + 1];
    const heads = l.blocks.map((b, i) => b.type === 'heading' ? [i, b.text] : null).filter(Boolean);
    $app.innerHTML = `<p class="crumb"><a href="#/lessons">Lessons</a> &rsaquo; <a href="#/lessons/${enc(l.subject)}">${X(l.subject)}</a></p>
      <div class="lessonlayout${heads.length > 1 ? '' : ' solo'}"><article class="card lesson"><header><h2 class="pagetitle">${X(l.title)}</h2><p>${tags(l)}<span class="tag hltag" data-hll="${X(l.id)}"${Store.hlIn('l', l.id).length ? '' : ' hidden'}>&#9998; Highlighted</span></p>${l.summary ? `<p class="lsummary">${inline(l.summary)}</p>` : ''}</header>
        <div class="lbody">${render(l.blocks)}</div>
        ${l.references && l.references.length ? `<section class="lrefs"><h3 class="lh">References</h3><ul>${l.references.map(r => `<li>${X(r)}</li>`).join('')}</ul></section>` : ''}
        <footer class="row spread lfoot"><span>${prev ? `<a class="btn" href="#/lesson/${enc(prev.id)}">&larr; ${X(prev.title)}</a>` : ''}</span><a class="btn primary" href="#/create/${enc(l.subject)}">Practice questions in this subject</a><span>${next ? `<a class="btn" href="#/lesson/${enc(next.id)}">${X(next.title)} &rarr;</a>` : ''}</span></footer></article>
        ${heads.length > 1 ? `<nav class="card ltoc" aria-label="In this lesson"><h2 class="navh">In this lesson</h2><ul>${heads.map(([i, t]) => `<li><button type="button" class="linkish" data-jump="lh-${i}">${X(t)}</button></li>`).join('')}</ul></nav>` : ''}</div>`;
    $app.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => { const el = document.getElementById(b.dataset.jump); if (el) { el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); } });
    done(); HlUI.tagLesson($app.querySelector('article.lesson .lbody'), l.id); HlUI.paintAll($app, true);
  }
  return { render, chart, inline, indexPage, subjectPage, lessonPage, done, tags, sorted };
})();
