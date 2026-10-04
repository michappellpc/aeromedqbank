'use strict';
// "Copy": turns the questions, lessons, flashcards or feedback you are looking at (so the filters you set decide what goes) into
// one message to paste into a chat. The data is in the same JSON format that Import from a chat accepts, so Claude's reply can be pasted straight
// back. The builders are pure (tested in Node); open() is the small dialog. Loaded before the admin pages.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root); else root.Handoff = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  // How many fit comfortably in one message to a chat
  const CHUNK = { questions: 20, lessons: 5, cards: 40, feedback: 25 };
  const NOUN = { questions: ['question', 'questions'], lessons: ['lesson', 'lessons'], cards: ['flashcard', 'flashcards'], feedback: ['message', 'messages'] };
  const IMPORT = { questions: '#/admin/questions/import', lessons: '#/admin/lessons/import', cards: '#/admin/cards/import' };
  const TASKS = {
    questions: [
      ['review', 'Check and fix errors', 'Check each question for factual errors, a wrong answer key, unclear wording, typos, and a correct answer that is much longer than the other choices. Fix what is wrong and leave the rest alone.'],
      ['harder', 'Make harder', 'Rewrite each question to be harder: make the wrong choices more tempting (plausible, from the same category as the right answer, each reflecting a real misconception), and add a clinically relevant detail or a second step of reasoning. Do not make it harder by being obscure or tricky in wording.'],
      ['easier', 'Make easier', 'Rewrite each question to be easier: make the stem clearer and more direct with one concept per question, and make the wrong choices easier to rule out while still plausible. Do not give the answer away in the wording.'],
      ['match', 'Match difficulty to its category', 'Look at how each question has actually performed (the first-try numbers below) and adjust it so it fits the difficulty category it is labeled with. A question labeled Easy should be answered correctly on the first try by about 80% or more of members, Medium by about 55% to 79%, and Hard by under about 55%. If a question performs easier than its category (above its range), make it harder: more tempting wrong choices from the same category as the right answer and a clinically relevant extra step, never obscure wording. If it performs harder than its category (below its range), make it easier: a clearer, more direct stem, one concept, and wrong choices that are easier to rule out but still plausible. Leave a question unchanged if it is already inside its range, if it has too few answers to judge, or if the numbers point to a problem with the answer key (then say so instead). Keep the difficulty label as it is, and keep the same concept and the same correct answer.'],
      ['explain', 'Improve the explanations', 'Improve the explanation and the optionNotes of each question: make them accurate and concise, say why the right answer is right and why each wrong choice is wrong, and add a clinical pearl where it helps. Do not change the question or the answer.'],
      ['facts', 'Verify and update facts (laws, policies, guidelines)', 'Verify and update the facts in each item. Policies, laws, regulations and guidelines change often, so check every claim that could be out of date (laws and regulations such as OSHA, ADA and FMLA, DoD and service instructions, FAA and ICAO standards, clinical guidelines and screening recommendations, drug doses and thresholds, statistics) against the most recent authoritative source you can find. Update anything that has changed, and update the "references" with the source and its year. Do not guess: if you cannot verify a claim, leave it unchanged and tell me which claims I should check myself.'],
      ['lessons', 'Check each question links to the best lesson', 'Check whether each question links to the best lesson for the concept it tests. You get the list of lessons I have and the lesson each question shows now. Where a different lesson is clearly better, or none is shown and one fits, set "lessonId" on that question to that lesson\'s id. Leave "lessonId" out where the current lesson is already the best, so that better lessons I add later can take over by themselves. Do not change anything else about a question.'],
      ['outline', 'Tag with the board outline items it covers', 'Decide which items of the ABPM content outline each item covers and set "objectives" on it to a list of those items as "board:code" strings, for example "aem:K1.E.1". You get the outline below; use only codes from it, choose the most specific item that fits (at most 4 per item), and leave "objectives" out where nothing on the outline fits. Do not change anything else about the item.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    lessons: [
      ['review', 'Check and fix errors', 'Check each lesson for factual errors, unclear wording, typos and inconsistent numbers. Fix what is wrong and leave the rest alone.'],
      ['clearer', 'Make clearer and shorter', 'Rewrite each lesson to be clearer and shorter: plain wording, one idea per paragraph, and tables or steps where they help. Keep every important fact.'],
      ['facts', 'Verify and update facts (laws, policies, guidelines)', 'Verify and update the facts in each item. Policies, laws, regulations and guidelines change often, so check every claim that could be out of date (laws and regulations such as OSHA, ADA and FMLA, DoD and service instructions, FAA and ICAO standards, clinical guidelines and screening recommendations, drug doses and thresholds, statistics) against the most recent authoritative source you can find. Update anything that has changed, and update the "references" with the source and its year. Do not guess: if you cannot verify a claim, leave it unchanged and tell me which claims I should check myself.'],
      ['deeper', 'Add detail and pearls', 'Add useful detail to each lesson: clinical pearls, key points, and test-taking tips as callouts, and a table or step flow where it helps. Keep it accurate and concise.'],
      ['outline', 'Tag with the board outline items it covers', 'Decide which items of the ABPM content outline each item covers and set "objectives" on it to a list of those items as "board:code" strings, for example "aem:K1.E.1". You get the outline below; use only codes from it, choose the most specific item that fits (at most 4 per item), and leave "objectives" out where nothing on the outline fits. Do not change anything else about the item.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    cards: [
      ['review', 'Check and fix errors', 'Check each card for factual errors, ambiguity and typos. Each card should test one fact. Fix what is wrong and leave the rest alone.'],
      ['facts', 'Verify and update facts (laws, policies, guidelines)', 'Verify and update the facts in each item. Policies, laws, regulations and guidelines change often, so check every claim that could be out of date (laws and regulations such as OSHA, ADA and FMLA, DoD and service instructions, FAA and ICAO standards, clinical guidelines and screening recommendations, drug doses and thresholds, statistics) against the most recent authoritative source you can find. Update anything that has changed, and update the "references" with the source and its year. Do not guess: if you cannot verify a claim, leave it unchanged and tell me which claims I should check myself.'],
      ['tighter', 'Make shorter and clearer', 'Rewrite each card to be shorter and clearer, testing exactly one fact, with a prompt on the front and a short answer on the back.'],
      ['outline', 'Tag with the board outline items it covers', 'Decide which items of the ABPM content outline each item covers and set "objectives" on it to a list of those items as "board:code" strings, for example "aem:K1.E.1". You get the outline below; use only codes from it, choose the most specific item that fits (at most 4 per item), and leave "objectives" out where nothing on the outline fits. Do not change anything else about the item.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    feedback: [
      ['fix', 'Fix the questions members flagged', 'For each message about a question, decide whether the member is right. Where a question needs a change, return a corrected version of that question. Do not change questions where the member is mistaken.'],
      ['group', 'Summarize and group the feedback', 'Group the messages by theme (for example unclear wording, wrong answer key, typos, pictures, requests for features) and summarize each group. List what to fix first.'],
      ['reply', 'Draft replies to members', 'Draft a short, kind, plain reply to each member message that I can post in the app. Do not promise changes that I have not decided on.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']]
  };
  const HEAD = 'I run a private board-prep question bank for aerospace, occupational and preventive medicine residents.';
  const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o[k] !== undefined && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)) r[k] = o[k]; }); return r; };
  const QF = ['id', 'boards', 'subject', 'topic', 'difficulty', 'stem', 'image', 'imageAlt', 'options', 'answer', 'explanation', 'optionNotes', 'references', 'tier', 'lessonId', 'objectives'];
  const LF = ['id', 'boards', 'subject', 'title', 'summary', 'order', 'blocks', 'references', 'tier', 'objectives'];
  const CF = ['id', 'boards', 'subject', 'topic', 'front', 'back', 'lessonId', 'objectives', 'references'];
  const draft = o => ({ ...o, status: 'draft' });
  const task = (kind, key) => (TASKS[kind].find(t => t[0] === key) || TASKS[kind][0]);
  const json = v => JSON.stringify(v, null, 2);
  const plural = (kind, n) => `${n} ${NOUN[kind][n === 1 ? 0 : 1]}`;
  const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

  // opts: { task, note, part: [index, count], stats: { id: 'line' } }
  function build(kind, items, opts = {}) {
    const [, , instruction] = task(kind, opts.task), part = opts.part && opts.part[1] > 1 ? `This is part ${opts.part[0] + 1} of ${opts.part[1]}. ` : '';
    const note = (opts.note || '').trim(), n = items.length;
    const lines = [];
    if (kind === 'feedback') {
      lines.push(`${HEAD} ${part}Below are ${plural(kind, n)} that members sent through the app (and the question each one is about, as JSON).`, '', 'TASK: ' + instruction);
      if (note) lines.push('', 'MY NOTE: ' + note);
      lines.push('', 'HOW TO ANSWER:');
      if (!opts.task || opts.task === 'fix') lines.push('1. First, one line per message: its id, whether it is valid, not valid, or needs more information, and why in a sentence.', '2. Then ONE JSON array containing only the corrected questions, in exactly the same format as the input questions, with "status": "draft" (so I can review and import them). Keep every id.', '3. Then a short list of what you changed and why.');
      else lines.push('Answer in plain text, one short section per group or per message id.');
      lines.push('', 'MESSAGES:');
      items.forEach((m, i) => {
        lines.push('', `--- message ${m.id} (${m.kind === 'support' ? 'support' : 'question feedback'}${m.category ? ', ' + m.category : ''}) ---`, m.message);
        if (m.subject && m.kind === 'support') lines.push(`Subject: ${m.subject}`);
        if (m.question_id) { lines.push(`About question ${m.question_id}:`); lines.push(m.question ? json(draft(pick(m.question, QF))) : '(the question no longer exists)'); }
      });
      return lines.join('\n');
    }
    const label = NOUN[kind][1], fields = { questions: QF, lessons: LF, cards: CF }[kind];
    lines.push(`${HEAD} ${part}Below are ${plural(kind, n)} as JSON, in the exact format my app imports.`, '', 'TASK: ' + instruction);
    if (opts.task === 'facts' && opts.today) lines.push('', `Today's date is ${opts.today}. Treat anything that predates your most reliable knowledge as possibly out of date.`);
    if (note) lines.push('', 'MY NOTE: ' + note);
    lines.push('', 'RULES:', `- Return ALL ${n} ${label} as ONE JSON array in exactly the same format as the input. Keep every "id", "boards", "subject" and "tier" the same, and keep field names exactly.`, '- Set "status": "draft" on every item, so I can review it before it goes live. If an item needs no change, still include it unchanged.');
    if (kind === 'questions') lines.push('- Each question needs "stem", "options" (letters A, B, C, D with "text"), "answer" (a letter), "explanation", and "optionNotes" explaining each wrong choice. Keep every patient invented, with no real patient information. Keep the choices a similar length so the right one is not the longest.');
    if (kind === 'lessons') lines.push('- Keep the "blocks" structure: each block has a "type" (heading, text, list, callout, table, steps, compare, stats, chart or image) and the same fields it already has. In text use only **bold** and *italic*. Keep every fact accurate and every patient invented.');
    if (kind === 'cards') lines.push('- Each card has one prompt in "front" (up to 600 characters) and a short answer in "back" (up to 1500). Keep one fact per card.');
    if (opts.task === 'facts') lines.push('- Keep the "references" list accurate: add or update the source and year for anything you changed.', '- After the JSON, list for every item you changed: what changed, the source, and how confident you are. Also list any claims you could not verify.');
    else if (opts.task === 'lessons' && kind === 'questions') lines.push('- "lessonId" must be exactly one of the ids in the lesson list below. Include it only where a different lesson is clearly better, or where none is shown and one fits.', '- After the JSON, list the questions for which no lesson fits well, each with the title of a new lesson that would fit.');
    else if (opts.task === 'outline') lines.push('- "objectives" must only contain codes from the outline list below, written as "board:code" exactly as listed (for example "aem:K1.E.1"). Keep any that are already right.', '- After the JSON, list the items where nothing on the outline fits.');
    else lines.push('- After the JSON, add a short list of what you changed and why.');
    if (opts.task === 'lessons' && kind === 'questions' && opts.catalog) lines.push('', 'THE LESSONS I HAVE (id | subject | title | summary):', ...opts.catalog.map(l => `- ${l.id} | ${l.subject} | ${l.title}${l.summary ? ' | ' + String(l.summary).replace(/\s+/g, ' ').slice(0, 140) : ''}`), '', 'THE LESSON EACH QUESTION SHOWS NOW:', ...items.map(i => { const c = opts.current && opts.current[i.id]; return `- ${i.id}: ${c ? `${c.id} (${c.title}), ${c.pinned ? 'chosen by hand' : 'picked automatically'}` : 'none'}`; }));
    if (opts.task === 'outline' && opts.outline) lines.push('', 'THE BOARD OUTLINE (board:code | what it says):', ...opts.outline.map(o => `- ${o.ref} | ${o.text}`));
    if (opts.stats && Object.keys(opts.stats).length) lines.push('', 'HOW THEY HAVE BEEN PERFORMING (percent of members right on their first try, and how well the question separates strong from weak members):', ...items.map(i => opts.stats[i.id]).filter(Boolean).map(l => '- ' + l));
    lines.push('', kind === 'questions' ? 'THE QUESTIONS:' : kind === 'lessons' ? 'THE LESSONS:' : 'THE FLASHCARDS:', json(items.map(i => draft(pick(i, fields)))));
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ the dialog (browser only)
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // opts: { kind, items, selected: [ids], describe: 'what the filters are', stats: fn(item) -> line, importHash }
  function open(o) {
    const doc = root.document, kind = o.kind, all = o.items || [], sel = all.filter(i => (o.selected || []).includes(i.id));
    if (!all.length) return root.toast && root.toast(`There are no ${NOUN[kind][1]} to copy. Change the filters first.`);
    const tasks = TASKS[kind].filter(t => !(t[0] === 'lessons' && !(o.lessons && o.lessons.length)));
    const d = doc.createElement('div'); d.className = 'modal';
    d.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="hf-h" style="max-width:720px;width:100%;max-height:92vh;overflow:auto"><h2 id="hf-h" style="margin-top:0">Copy</h2>
      <p class="muted" id="hf-sum"></p>
      ${sel.length ? `<fieldset class="inline"><legend class="sr">Which ${NOUN[kind][1]}</legend><label class="chk"><input type="radio" name="hf-src" value="shown" checked> All ${all.length} shown by the filters</label><label class="chk"><input type="radio" name="hf-src" value="sel"> Only the ${sel.length} I selected</label></fieldset>` : ''}
      <div class="fgrid"><div><label for="hf-task">What should Claude do?</label><select id="hf-task">${tasks.map(t => `<option value="${t[0]}">${esc(t[1])}</option>`).join('')}</select></div>
        <div id="hf-partbox" hidden><label for="hf-part">Part</label><select id="hf-part"></select></div></div>
      <label for="hf-note">Your note to Claude (optional): how you like things done</label><textarea id="hf-note" rows="3" placeholder="e.g. Keep my explanations short. Use ABPM wording. Do not change the references."></textarea>
      ${o.stats ? '<label class="chk"><input type="checkbox" id="hf-stats" checked> Include how each has been performing</label>' : ''}
      <label for="hf-prev">The message (you can read it before you copy)</label><textarea id="hf-prev" rows="9" readonly style="font:12px/1.4 ui-monospace,Menlo,Consolas,monospace"></textarea>
      <p class="muted small" id="hf-size" aria-live="polite"></p>
      <div class="row"><button class="primary" id="hf-copy" type="button">Copy to clipboard</button><button id="hf-dl" type="button">Download as a file</button><button id="hf-x" type="button">Close</button></div>
      <p class="muted small">Then paste it into Claude. When Claude replies, copy its JSON and ${o.importHash ? `<a href="${o.importHash}" id="hf-imp">bring it back with Import from a chat</a>` : 'use it to update the items'}. Everything comes back as a draft for you to review.</p></div>`;
    const prev = doc.activeElement, E = id => d.querySelector('#' + id);
    const close = () => { d.remove(); doc.removeEventListener('keydown', onKey, true); if (prev && doc.body.contains(prev)) prev.focus(); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    doc.addEventListener('keydown', onKey, true);
    d.onclick = e => { if (e.target === d) close(); };
    const current = () => { const src = d.querySelector('[name=hf-src]:checked'); return src && src.value === 'sel' ? sel : all; };
    const draw = () => {
      const list = current(), parts = chunk(list, CHUNK[kind]), pb = E('hf-partbox'), ps = E('hf-part');
      if (parts.length > 1) { const keep = +ps.value || 0; ps.innerHTML = parts.map((p, i) => `<option value="${i}">${i + 1} of ${parts.length} (${plural(kind, p.length)})</option>`).join(''); ps.value = String(Math.min(keep, parts.length - 1)); pb.hidden = false; } else pb.hidden = true;
      const idx = parts.length > 1 ? +ps.value : 0, chosen = parts[idx] || [];
      const stats = o.stats && E('hf-stats') && E('hf-stats').checked ? Object.fromEntries(chosen.map(i => [i.id, o.stats(i)]).filter(x => x[1])) : null;
      const tk = E('hf-task').value, today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const outline = tk === 'outline' && root.Objectives ? [...new Set(chosen.flatMap(i => i.boards || []))].flatMap(b => root.Objectives.board(b).items.map(i => ({ ref: b + ':' + i.code, text: (i.parent ? i.parent.code + ' ' : '') + i.text.slice(0, 110) }))) : null;
      const catalog = tk === 'lessons' && o.lessons ? o.lessons.map(l => ({ id: l.id, subject: l.subject, title: l.title, summary: l.summary })) : null;
      const shows = tk === 'lessons' && o.currentLesson ? Object.fromEntries(chosen.map(i => { const c = o.currentLesson(i); return [i.id, c ? { id: c.lesson.id, title: c.lesson.title, pinned: c.pinned } : null]; })) : null;
      const text = build(kind, chosen, { task: tk, note: E('hf-note').value, part: [idx, parts.length], stats, today: ymd, catalog, outline, current: shows });
      E('hf-prev').value = text; d._text = text;
      E('hf-sum').textContent = `${plural(kind, list.length)}${o.describe ? ' (' + o.describe + ')' : ''}${parts.length > 1 ? `. That is a lot for one message, so it is split into ${parts.length} parts of up to ${CHUNK[kind]}: copy one part at a time.` : '.'}`;
      E('hf-size').textContent = `About ${Math.round(text.length / 5).toLocaleString()} words in this message.`;
    };
    ['hf-task', 'hf-part', 'hf-note', 'hf-stats'].forEach(id => { const e = E(id); if (e) e.addEventListener(id === 'hf-note' ? 'input' : 'change', draw); });
    d.querySelectorAll('[name=hf-src]').forEach(r => r.addEventListener('change', () => { E('hf-part').value = '0'; draw(); }));
    E('hf-x').onclick = close;
    E('hf-copy').onclick = async () => {
      try { await root.navigator.clipboard.writeText(d._text); root.toast && root.toast('Copied. Paste it into Claude.'); }
      catch { E('hf-prev').readOnly = false; E('hf-prev').focus(); E('hf-prev').select(); root.toast && root.toast('Could not copy automatically. The message is selected: press Ctrl+C (or Cmd+C).'); }
    };
    E('hf-dl').onclick = () => { const a = doc.createElement('a'); a.href = root.URL.createObjectURL(new root.Blob([d._text], { type: 'text/plain' })); a.download = `for-claude-${kind}-${new Date().toISOString().slice(0, 10)}.txt`; a.click(); };
    const imp = E('hf-imp'); if (imp) imp.onclick = () => close();
    doc.body.appendChild(d); draw(); E('hf-copy').focus();
  }
  return { build, chunk, open, TASKS, CHUNK, IMPORT, QF, LF, CF };
});
