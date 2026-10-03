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
      ['explain', 'Improve the explanations', 'Improve the explanation and the optionNotes of each question: make them accurate and concise, say why the right answer is right and why each wrong choice is wrong, and add a clinical pearl where it helps. Do not change the question or the answer.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    lessons: [
      ['review', 'Check and fix errors', 'Check each lesson for factual errors, unclear wording, typos and inconsistent numbers. Fix what is wrong and leave the rest alone.'],
      ['clearer', 'Make clearer and shorter', 'Rewrite each lesson to be clearer and shorter: plain wording, one idea per paragraph, and tables or steps where they help. Keep every important fact.'],
      ['deeper', 'Add detail and pearls', 'Add useful detail to each lesson: clinical pearls, key points, and test-taking tips as callouts, and a table or step flow where it helps. Keep it accurate and concise.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    cards: [
      ['review', 'Check and fix errors', 'Check each card for factual errors, ambiguity and typos. Each card should test one fact. Fix what is wrong and leave the rest alone.'],
      ['tighter', 'Make shorter and clearer', 'Rewrite each card to be shorter and clearer, testing exactly one fact, with a prompt on the front and a short answer on the back.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    feedback: [
      ['fix', 'Fix the questions members flagged', 'For each message about a question, decide whether the member is right. Where a question needs a change, return a corrected version of that question. Do not change questions where the member is mistaken.'],
      ['group', 'Summarize and group the feedback', 'Group the messages by theme (for example unclear wording, wrong answer key, typos, pictures, requests for features) and summarize each group. List what to fix first.'],
      ['reply', 'Draft replies to members', 'Draft a short, kind, plain reply to each member message that I can post in the app. Do not promise changes that I have not decided on.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']]
  };
  const HEAD = 'I run a private board-prep question bank for aerospace, occupational and preventive medicine residents.';
  const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o[k] !== undefined && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)) r[k] = o[k]; }); return r; };
  const QF = ['id', 'boards', 'subject', 'topic', 'difficulty', 'stem', 'image', 'imageAlt', 'options', 'answer', 'explanation', 'optionNotes', 'references', 'tier'];
  const LF = ['id', 'boards', 'subject', 'title', 'summary', 'order', 'blocks', 'references', 'tier'];
  const CF = ['id', 'boards', 'subject', 'topic', 'front', 'back', 'lessonId', 'references'];
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
    if (note) lines.push('', 'MY NOTE: ' + note);
    lines.push('', 'RULES:', `- Return ALL ${n} ${label} as ONE JSON array in exactly the same format as the input. Keep every "id", "boards", "subject" and "tier" the same, and keep field names exactly.`, '- Set "status": "draft" on every item, so I can review it before it goes live. If an item needs no change, still include it unchanged.');
    if (kind === 'questions') lines.push('- Each question needs "stem", "options" (letters A, B, C, D with "text"), "answer" (a letter), "explanation", and "optionNotes" explaining each wrong choice. Keep every patient invented, with no real patient information. Keep the choices a similar length so the right one is not the longest.');
    if (kind === 'lessons') lines.push('- Keep the "blocks" structure: each block has a "type" (heading, text, list, callout, table, steps, compare, stats, chart or image) and the same fields it already has. In text use only **bold** and *italic*. Keep every fact accurate and every patient invented.');
    if (kind === 'cards') lines.push('- Each card has one prompt in "front" (up to 600 characters) and a short answer in "back" (up to 1500). Keep one fact per card.');
    lines.push('- After the JSON, add a short list of what you changed and why.');
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
    const d = doc.createElement('div'); d.className = 'modal';
    d.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="hf-h" style="max-width:720px;width:100%;max-height:92vh;overflow:auto"><h2 id="hf-h" style="margin-top:0">Copy</h2>
      <p class="muted" id="hf-sum"></p>
      ${sel.length ? `<fieldset class="inline"><legend class="sr">Which ${NOUN[kind][1]}</legend><label class="chk"><input type="radio" name="hf-src" value="shown" checked> All ${all.length} shown by the filters</label><label class="chk"><input type="radio" name="hf-src" value="sel"> Only the ${sel.length} I selected</label></fieldset>` : ''}
      <div class="fgrid"><div><label for="hf-task">What should Claude do?</label><select id="hf-task">${TASKS[kind].map(t => `<option value="${t[0]}">${esc(t[1])}</option>`).join('')}</select></div>
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
      const text = build(kind, chosen, { task: E('hf-task').value, note: E('hf-note').value, part: [idx, parts.length], stats });
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
