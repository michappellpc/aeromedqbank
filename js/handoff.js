'use strict';
// "Copy": turns the questions, lessons, flashcards or feedback you are looking at (so the filters you set decide what goes) into
// one message to paste into a chat. The data is in the same JSON format that Import from a chat accepts, so the AI's reply can be pasted straight
// back. The builders are pure (tested in Node); open() is the small dialog. Loaded before the admin pages.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root); else root.Handoff = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  // How many fit comfortably in one message to a chat
  const CHUNK = { questions: 20, lessons: 5, cards: 40, feedback: 25 };               // how many go in one message by default
  const SIZES = { questions: [10, 20, 40, 60, 100], lessons: [3, 5, 10, 15, 25], cards: [20, 40, 80, 150, 250], feedback: [10, 25, 50, 100] };   // the choices offered
  const NOUN = { questions: ['question', 'questions'], lessons: ['lesson', 'lessons'], cards: ['flashcard', 'flashcards'], feedback: ['message', 'messages'] };
  const IMPORT = { questions: '#/admin/questions/import', lessons: '#/admin/lessons/import', cards: '#/admin/cards/import' };
  // The "Sort by high yield" instruction. noun is what is being sorted ("questions"), unit what one of them tests ("question", "lesson", "card").
  // The point: high yield means concepts a board exam keeps returning to, not memorized trivia, however neatly the trivia can be written as an item.
  const hyInstruction = (noun, unit) => `Decide which ${noun} are HIGH YIELD: the ones most worth a resident's limited study time. Judge the TOPIC each ${unit} covers, not how hard or well written it is: a hard ${unit} about trivia is low yield, and a simple ${unit} about a core concept is high yield. `
    + 'MARK IT HIGH YIELD when it covers: (1) a core concept or mechanism that many other questions depend on and that the board returns to again and again, for example the types of spatial disorientation and vestibular illusions (the leans, Coriolis, somatogravic and others) and how to tell them apart, the types of hypoxia, decompression sickness, G-LOC, how a waiver or fitness decision is reasoned, outbreak investigation steps, the main epidemiology and statistics measures, or how the main regulations are structured; (2) a decision with safety or clinical consequences, such as a must-not-miss diagnosis, the first or best next step, or a finding that disqualifies someone; (3) a commonly confused pair or classification that an exam likes to separate ("X versus Y"); (4) a knowledge item or task at the center of the board content outline, especially one that connects to several outline items; (5) a number or threshold only if it drives a decision or is anchored in a core concept (for example a key altitude or exposure limit), never just because it is exact. '
    + 'LEAVE IT UNMARKED when it covers: memorized operational or administrative trivia with little transfer, for example what a particular code or signal means, a form or section number, equipment details, historical dates or names, or details that apply to one aircraft or one agency; a rare condition or edge case that would not change what you do; one number from a single study; or a detail inside a topic that is itself low yield. '
    + `HOW TO DECIDE: for each ${unit} ask (a) how likely is a board exam to ask this, (b) does knowing it help answer other questions or manage real patients, and (c) is it a concept or principle rather than a memorized label? If (b) and (c) are both no, leave it unmarked. `
    + 'Be selective: in this batch about one in four or five (roughly 20% to 30%) should be high yield, and it is fine to mark fewer, but do not mark more than a third unless they truly all qualify. Treat items on the same concept the same way. An item that is already marked high yield stays marked unless it clearly is not. If my note below says which topics to emphasize, follow it. '
    + 'Set "highYield": true or false on every one and change nothing else about it.';
  // The writing rules for questions, each one written against an error that actually happened in the bank. They go into every Copy task that writes or
  // changes question content, and "Audit against the writing rules" checks them one by one.
  const QRULES = [
    'WRITING RULES (each one prevents an error that really happened in this bank; follow them, and fix a problem rather than just noting it):',
    '1. Answerable from a principle, never from recall of one named event, report or inquiry. A specific accident, mishap, inquiry or study may appear as context, but the key must be a mechanism, a disposition, a classification or a management decision that a resident could reason to without having read that report. If the key is "which finding did the board cite" or "which inquiry concluded what", rewrite the item around the concept the case illustrates.',
    '2. Never key a question to the fact that a guideline, score or regulation changed ("what was removed in the revision", "what replaced X", "what year did this change"). Ask why the change was made, or ask the current rule directly.',
    '3. Before a question whose answer is a threshold, interval, dose, percentage or list, find the sentence in the source that states it, and make the key what that sentence says. If you cannot find the sentence, do not infer the number from a neighbouring rule, a different agency or a similar condition: rewrite the question so it does not depend on the number.',
    '4. When the governing document is silent, the question is about the silence. The correct answer is the general rule (consult the Aerospace Medical Certification Division or the Regional Flight Surgeon, apply the Condition Not Listed table, or apply the catch-all row), not an interval borrowed from a similar condition. Never write a stem that implies a rule exists where none does.',
    '5. State the source\'s own stated reason, not a plausible mechanism. If the explanation says "because X", X must be the reason the source gives. A mechanism you believe is true but the source does not cite belongs nowhere in the item.',
    '6. Disposition questions: read every row of the table, not just the one that matches the vignette. Before keying a certification item, decide which row each distractor would fall into. A distractor in the same row as the key, or in a row the stem does not exclude, is a second correct answer.',
    '7. Conjunctions in a source\'s criteria are load-bearing. Copy them exactly ("weakness or numbness or functional limitations" is not "weakness and numbness"), and quote the structure to yourself before writing the distractors.',
    '8. Option length is a numeric check: the correct option\'s length divided by the mean length of the distractors must be between 0.80 and 1.20, and the correct option must not be the single longest. Fix it by editing option text, never by changing the key.',
    '9. Do not write two questions whose keyed fact is the same, even in different subjects. If another question already turns on the same fact, write a different fact or a contrast item that cannot be answered by recalling the first.',
    '10. The "topic" must exactly match a topic already in use for that subject (listed below when available). Do not invent a variant of an existing one.',
    'SELF-CHECK before you reply (fix, do not just flag): Could a resident who never read the cited report still answer? Is every number in the stem, options and explanation traceable to a sentence in a cited source? For each distractor, under the same source, what makes it wrong (if "nothing explicit", it is a second key)? Does any part depend on a rule the source does not state? Is the length ratio between 0.80 and 1.20 with the key not the longest? Does the keyed fact already appear in the bank? Does the topic exactly match one in use?'
  ].join('\n');
  // The shorter version for flashcards (one fact each): the rules about where a fact comes from
  const CRULES = 'WRITING RULES: (1) Test a principle, mechanism, disposition or management decision, never recall of one named accident, report or inquiry. (2) Never make the fact that a guideline, score or regulation changed the answer; ask the current rule or why it changed. (3) Every number, interval, dose or list must come from a sentence in a source; if you cannot find it, do not infer it from a similar rule, agency or condition, and rewrite the card so it does not depend on it. (4) Where the governing document is silent, the card is about the general rule (consult the certification authority, apply the catch-all), not a borrowed interval. (5) Give the source\'s own stated reason, not a plausible mechanism. (6) Do not duplicate another card that already tests the same fact. (7) The "topic" must exactly match one already in use for that subject (listed below when available).';
  // Tasks that write or change the words of questions (or cards) get the rules; tasks that only tag or sort do not
  const RULE_TASKS = { questions: ['review', 'harder', 'easier', 'match', 'explain', 'facts', 'rules', 'custom'], cards: ['review', 'facts', 'tighter', 'custom'] };
  const TASKS = {
    questions: [
      ['review', 'Check and fix errors', 'Check each question for factual errors, a wrong answer key, unclear wording, typos, and a correct answer that is much longer than the other choices. Fix what is wrong and leave the rest alone.'],
      ['topics', 'Tidy topic names', 'Give each item the single best TOPIC NAME from the list of topics already in use for its subject. The list has near-duplicates (for example "Cardiovascular conditions" and "Cardiovascular conditions and aeromedical disposition", or "Vision standards" and "Vision and refractive surgery standards", or several wordings of the same space radiation topic): merge those into ONE name, preferring the clearest wording and, when equal, the one used by the most items, so the same topic gets the same name in every batch. Keep genuinely different topics apart, and do not make a name so broad that it hides what the item is about. Judge each item from its subject, its current topic and the start of its text. Change nothing else.'],
      ['rules', 'Audit against the writing rules', 'Audit each question against every one of the WRITING RULES below, one by one, and fix every question that breaks any of them: rewrite the stem, options, explanation or optionNotes as needed (never just flag a problem and leave it). If a rule cannot be met without a source you do not have, rewrite the question so it does not depend on the missing fact, and say so. Leave questions that pass untouched. Then list for every changed question which rule(s) it broke and what you did.'],
      ['harder', 'Make harder', 'Rewrite each question to be harder: make the wrong choices more tempting (plausible, from the same category as the right answer, each reflecting a real misconception), and add a clinically relevant detail or a second step of reasoning. Do not make it harder by being obscure or tricky in wording.'],
      ['easier', 'Make easier', 'Rewrite each question to be easier: make the stem clearer and more direct with one concept per question, and make the wrong choices easier to rule out while still plausible. Do not give the answer away in the wording.'],
      ['match', 'Match difficulty to its category', 'Make each question truly Easy, Medium or Hard to match the label it carries, whatever the number of answers, even none. Easy should be answered correctly on the first try by about 80% or more of members, Medium by about 55% to 79%, and Hard by under about 55%. Step 1, read the question and every answer choice and rate how hard it really is from the content alone. Easy is one direct recall or recognition with a clear stem and wrong choices that are plainly different. Medium is applying a concept to a short scenario, or recall with some closely related wrong choices. Hard is multi-step reasoning, a clinical vignette that needs several facts put together, or telling apart several plausible choices. Notice cues that change the real difficulty: a stem or a longest choice that gives the answer away makes it easier, wrong choices no informed resident would pick make it easier, and two defensible choices make it harder or flawed. Step 2, bring in how members actually did, when there are numbers below. Each line gives a best estimate (already pulled toward the label when few have answered), a likely range, and whether it looks consistent with the label, leans easier or harder, or is clearly easier or harder. There is no minimum number of answers: with none, your own reading from Step 1 decides; with a few, your reading leads and the numbers move you only if they clearly disagree; with many (about 30 or more) the numbers lead and your reading explains them. Step 3, decide. If the combined picture fits the label, leave it unchanged. If not, change it in proportion: a real rewrite when the picture is clearly easier or harder than the label, a light nudge when it only leans that way or the evidence is thin. To make a question harder: more tempting wrong choices from the same category as the right answer and a clinically relevant extra step, never obscure wording. To make it easier: a clearer, more direct stem, one concept, and wrong choices that are easier to rule out but still plausible. If the numbers point to a problem with the answer key (a wrong choice picked more than the key), say so instead of rewriting. Keep the difficulty label as it is, and keep the same concept and the same correct answer. After the JSON, list every question with your content rating, what the data said (or that there were no answers), your verdict, and whether you made a light, moderate or full change or left it unchanged.'],
      ['explain', 'Improve the explanations', 'Improve the explanation and the optionNotes of each question: make them accurate and concise, say why the right answer is right and why each wrong choice is wrong, and add a clinical pearl where it helps. Do not change the question or the answer.'],
      ['facts', 'Verify and update facts (laws, policies, guidelines)', 'Verify and update the facts in each item. Policies, laws, regulations and guidelines change often, so check every claim that could be out of date (laws and regulations such as OSHA, ADA and FMLA, DoD and service instructions, FAA and ICAO standards, clinical guidelines and screening recommendations, drug doses and thresholds, statistics) against the most recent authoritative source you can find. Update anything that has changed, and update the "references" with the source and its year. Do not guess: if you cannot verify a claim, leave it unchanged and tell me which claims I should check myself.'],
      ['lessons', 'Check each question links to the best lesson', 'Check whether each question links to the best lesson for the concept it tests. You get the list of lessons I have and the lesson each question shows now. Where a different lesson is clearly better, or none is shown and one fits, set "lessonId" on that question to that lesson\'s id. Leave "lessonId" out where the current lesson is already the best, so that better lessons I add later can take over by themselves. Do not change anything else about a question.'],
      ['outline', 'Tag with the board outline items it covers', 'Decide which items of the ABPM content outline each item covers and set "objectives" on it to a list of those items as "board:code" strings, for example "aem:K1.E.1". You get the outline below; use only codes from it, choose the most specific item that fits (at most 4 per item), and leave "objectives" out where nothing on the outline fits. Do not change anything else about the item.'],
      ['highyield', 'Sort by high yield', hyInstruction('questions', 'question')],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    lessons: [
      ['review', 'Check and fix errors', 'Check each lesson for factual errors, unclear wording, typos and inconsistent numbers. Fix what is wrong and leave the rest alone.'],
      ['clearer', 'Make clearer and shorter', 'Rewrite each lesson to be clearer and shorter: plain wording, one idea per paragraph, and tables or steps where they help. Keep every important fact.'],
      ['facts', 'Verify and update facts (laws, policies, guidelines)', 'Verify and update the facts in each item. Policies, laws, regulations and guidelines change often, so check every claim that could be out of date (laws and regulations such as OSHA, ADA and FMLA, DoD and service instructions, FAA and ICAO standards, clinical guidelines and screening recommendations, drug doses and thresholds, statistics) against the most recent authoritative source you can find. Update anything that has changed, and update the "references" with the source and its year. Do not guess: if you cannot verify a claim, leave it unchanged and tell me which claims I should check myself.'],
      ['deeper', 'Add detail and pearls', 'Add useful detail to each lesson: clinical pearls, key points, and test-taking tips as callouts, and a table or step flow where it helps. Keep it accurate and concise.'],
      ['outline', 'Tag with the board outline items it covers', 'Decide which items of the ABPM content outline each item covers and set "objectives" on it to a list of those items as "board:code" strings, for example "aem:K1.E.1". You get the outline below; use only codes from it, choose the most specific item that fits (at most 4 per item), and leave "objectives" out where nothing on the outline fits. Do not change anything else about the item.'],
      ['highyield', 'Sort by high yield', hyInstruction('lessons', 'lesson')],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    cards: [
      ['review', 'Check and fix errors', 'Check each card for factual errors, ambiguity and typos. Each card should test one fact. Fix what is wrong and leave the rest alone.'],
      ['facts', 'Verify and update facts (laws, policies, guidelines)', 'Verify and update the facts in each item. Policies, laws, regulations and guidelines change often, so check every claim that could be out of date (laws and regulations such as OSHA, ADA and FMLA, DoD and service instructions, FAA and ICAO standards, clinical guidelines and screening recommendations, drug doses and thresholds, statistics) against the most recent authoritative source you can find. Update anything that has changed, and update the "references" with the source and its year. Do not guess: if you cannot verify a claim, leave it unchanged and tell me which claims I should check myself.'],
      ['topics', 'Tidy topic names', 'Give each item the single best TOPIC NAME from the list of topics already in use for its subject. The list has near-duplicates (for example "Cardiovascular conditions" and "Cardiovascular conditions and aeromedical disposition", or "Vision standards" and "Vision and refractive surgery standards", or several wordings of the same space radiation topic): merge those into ONE name, preferring the clearest wording and, when equal, the one used by the most items, so the same topic gets the same name in every batch. Keep genuinely different topics apart, and do not make a name so broad that it hides what the item is about. Judge each item from its subject, its current topic and the start of its text. Change nothing else.'],
      ['tighter', 'Make shorter and clearer', 'Rewrite each card to be shorter and clearer, testing exactly one fact, with a prompt on the front and a short answer on the back.'],
      ['outline', 'Tag with the board outline items it covers', 'Decide which items of the ABPM content outline each item covers and set "objectives" on it to a list of those items as "board:code" strings, for example "aem:K1.E.1". You get the outline below; use only codes from it, choose the most specific item that fits (at most 4 per item), and leave "objectives" out where nothing on the outline fits. Do not change anything else about the item.'],
      ['highyield', 'Sort by high yield', hyInstruction('flashcards', 'card')],
      ['custom', 'Only do what my note says', 'Do what my note below says.']],
    feedback: [
      ['fix', 'Fix the questions members flagged', 'For each message about a question (read the conversation under it too, when there is one), decide whether the member is right. Where a question needs a change, return a corrected version of that question. Do not change questions where the member is mistaken.'],
      ['group', 'Summarize and group the feedback', 'Group the messages by theme (for example unclear wording, wrong answer key, typos, pictures, requests for features) and summarize each group. List what to fix first.'],
      ['reply', 'Draft replies to members', 'Draft a short, kind, plain reply to each member message that I can post in the app. Where a message has a conversation under it, read all of it first and write the next reply in that conversation, without repeating what the team already said and without answering things that were already settled. Do not promise changes that I have not decided on.'],
      ['custom', 'Only do what my note says', 'Do what my note below says.']]
  };
  const HEAD = 'I run a private board-prep question bank for aerospace, occupational and preventive medicine residents.';
  const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o[k] !== undefined && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length) && !(k === 'highYield' && !o[k])) r[k] = o[k]; }); return r; };
  const QF = ['id', 'boards', 'subject', 'topic', 'difficulty', 'stem', 'image', 'imageAlt', 'options', 'answer', 'explanation', 'optionNotes', 'references', 'tier', 'lessonId', 'objectives', 'highYield'];
  const LF = ['id', 'boards', 'subject', 'title', 'summary', 'order', 'blocks', 'references', 'tier', 'objectives', 'highYield'];
  const CF = ['id', 'boards', 'subject', 'topic', 'front', 'back', 'lessonId', 'objectives', 'highYield', 'references'];
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
        // the rest of the conversation, oldest first (the member's first message is the one above); replies are labelled Member or Team, with no names or emails
        const later = (m.thread || []).slice(1);
        if (later.length) lines.push(`Conversation so far (${later.length} ${later.length === 1 ? 'reply' : 'replies'}, oldest first):`, ...later.map(r => `  ${r.sender === 'team' ? 'Team' : 'Member'}${r.created_at ? ' (' + String(r.created_at).slice(0, 10) + ')' : ''}: ${String(r.message || '').replace(/\s+/g, ' ').trim()}`));
        if (m.subject && m.kind === 'support') lines.push(`Subject: ${m.subject}`);
        if (m.question_id) { lines.push(`About question ${m.question_id}:`); lines.push(m.question ? json(draft(pick(m.question, QF))) : '(the question no longer exists)'); }
      });
      return lines.join('\n');
    }
    const label = NOUN[kind][1], fields = { questions: QF, lessons: LF, cards: CF }[kind];
    lines.push(`${HEAD} ${part}Below are ${plural(kind, n)} as JSON, in the exact format my app imports.`, '', 'TASK: ' + instruction);
    if (opts.task === 'facts' && opts.today) lines.push('', `Today's date is ${opts.today}. Treat anything that predates your most reliable knowledge as possibly out of date.`);
    if (note) lines.push('', 'MY NOTE: ' + note);
    const tp = opts.task === 'topics', hy = opts.task === 'highyield' || tp;       // this task answers with just each id and its highYield, which a separate "Apply high yield list" button applies without touching anything else
    if (tp) lines.push('', 'RULES:', `- Return ONE JSON array with an object for EVERY one of the ${n} ${label}, each with only "id" (exactly as given) and "topic", for example [{"id": "aem-example-001", "topic": "Hypoxia"}]. Do not return anything else about an item.`, '- Every "topic" must be one of the topic names already in use for that subject (listed below), written exactly as listed. Do not invent a new name unless no listed one fits, and say so for that item.', '- After the JSON, list each topic name you merged into another (old name, new name, how many items), and any items where no listed topic fit.');
    else if (hy) lines.push('', 'RULES:', `- Return ONE JSON array with an object for EVERY one of the ${n} ${label}, each with only "id" (exactly as given) and "highYield" (true or false), for example [{"id": "aem-example-001", "highYield": true}]. Do not return the other fields.`, '- I will paste this array into my app, which changes only the high yield mark, so nothing goes back to draft and nothing else changes.', '- After the JSON, say how many you marked high yield and give one short reason for each one you marked.');
    else lines.push('', 'RULES:', `- Return ALL ${n} ${label} as ONE JSON array in exactly the same format as the input. Keep every "id", "boards", "subject" and "tier" the same, and keep field names exactly.`, '- Set "status": "draft" on every item, so I can review it before it goes live. If an item needs no change, still include it unchanged.');
    if (hy) { /* no field rules: only the flag is returned */ }
    else if (kind === 'questions') lines.push('- Each question needs "stem", "options" (letters A, B, C, D with "text"), "answer" (a letter), "explanation", and "optionNotes" explaining each wrong choice. Keep every patient invented, with no real patient information. Keep the choices a similar length so the right one is not the longest.');
    if (hy) { /* nothing to add */ } else if (kind === 'lessons') lines.push('- Keep the "blocks" structure: each block has a "type" (heading, text, list, callout, table, steps, compare, stats, chart or image) and the same fields it already has. In text use only **bold** and *italic*. Keep every fact accurate and every patient invented.');
    if (hy) { /* nothing to add */ } else if (kind === 'cards') lines.push('- Each card has one prompt in "front" (up to 600 characters) and a short answer in "back" (up to 1500). Keep one fact per card.');
    if (hy) { /* the rules above already say what to return */ }
    else if (opts.task === 'facts') lines.push('- Keep the "references" list accurate: add or update the source and year for anything you changed.', '- After the JSON, list for every item you changed: what changed, the source, and how confident you are. Also list any claims you could not verify.');
    else if (opts.task === 'lessons' && kind === 'questions') lines.push('- "lessonId" must be exactly one of the ids in the lesson list below. Include it only where a different lesson is clearly better, or where none is shown and one fits.', '- After the JSON, list the questions for which no lesson fits well, each with the title of a new lesson that would fit.');
    else if (opts.task === 'outline') lines.push('- "objectives" must only contain codes from the outline list below, written as "board:code" exactly as listed (for example "aem:K1.E.1"). Keep any that are already right.', '- After the JSON, list the items where nothing on the outline fits.');
    else lines.push('- After the JSON, add a short list of what you changed and why.');
    if (RULE_TASKS[kind] && RULE_TASKS[kind].includes(opts.task || TASKS[kind][0][0])) lines.push('', kind === 'questions' ? QRULES : CRULES);
    if (opts.topics && kind !== 'lessons' && RULE_TASKS[kind] && (tp || (!hy && RULE_TASKS[kind].includes(opts.task || TASKS[kind][0][0])))) {
      const subs = Object.keys(opts.topics).sort();
      if (subs.length) lines.push('', 'TOPICS ALREADY IN USE, BY SUBJECT (a "topic" must match one of these exactly, with the same wording and capitalization; if none fits, say so instead of inventing a variant. The number in brackets is how many items use it):', ...subs.map(sb => `- ${sb}: ${opts.topics[sb].map(t => t.topic + (t.n > 1 ? ' (' + t.n + ')' : '')).join('; ')}`));
    }
    if (kind === 'questions' && opts.task === 'rules' && opts.siblings && Object.keys(opts.siblings).length) lines.push('', 'OTHER QUESTIONS ALREADY IN MY BANK ON THE SAME SUBJECT AND TOPIC (id | what it asks | keyed answer), so you can catch a question whose keyed fact is already tested:', ...Object.entries(opts.siblings).flatMap(([id, list]) => list.length ? [`For ${id}:`, ...list.map(x => `  - ${x.id} | ${x.stem} | ${x.answer}`)] : []));
    if (opts.task === 'lessons' && kind === 'questions' && opts.catalog) lines.push('', 'THE LESSONS I HAVE (id | subject | title | summary):', ...opts.catalog.map(l => `- ${l.id} | ${l.subject} | ${l.title}${l.summary ? ' | ' + String(l.summary).replace(/\s+/g, ' ').slice(0, 140) : ''}`), '', 'THE LESSON EACH QUESTION SHOWS NOW:', ...items.map(i => { const c = opts.current && opts.current[i.id]; return `- ${i.id}: ${c ? `${c.id} (${c.title}), ${c.pinned ? 'chosen by hand' : 'picked automatically'}` : 'none'}`; }));
    if (hy && opts.coverage) lines.push('', 'HOW MUCH OF MY BANK COVERS THE SAME BOARD OUTLINE ITEMS AS EACH ' + NOUN[kind][0].toUpperCase() + ' (a hint only: many other items on the same outline items suggests a core topic that is worth knowing well, while none suggests a one-off; items with no outline tags have no signal):', ...items.map(i => { const n = opts.coverage[i.id]; return `- ${i.id}: ${n === null || n === undefined ? 'not tagged with outline items yet' : n === 0 ? 'no other items share its outline items' : `${n} other item${n === 1 ? '' : 's'} share its outline items`}`; }));
    if (opts.task === 'outline' && opts.outline) lines.push('', 'THE BOARD OUTLINE (board:code | what it says):', ...opts.outline.map(o => `- ${o.ref} | ${o.text}`));
    if (opts.task === 'match' && !(opts.stats && Object.keys(opts.stats).length)) lines.push('', 'HOW THEY HAVE BEEN PERFORMING: no numbers are available, so judge each question from its wording alone.');
    else if (opts.task === 'match') lines.push('', 'HOW THEY HAVE BEEN PERFORMING (percent of members right on their first try, with the evidence level; a question with no line below, or marked "no answers yet", has no data, so judge it from its wording alone):', ...items.map(i => opts.stats[i.id] || `- ${i.id}: no answers yet; labeled ${['', 'Easy', 'Medium', 'Hard'][i.difficulty || 2]}`).map(l => (l.startsWith('- ') ? l : '- ' + l)));
    else if (opts.stats && Object.keys(opts.stats).length) lines.push('', 'HOW THEY HAVE BEEN PERFORMING (percent of members right on their first try, and how well the question separates strong from weak members):', ...items.map(i => opts.stats[i.id]).filter(Boolean).map(l => '- ' + l));
    lines.push('', kind === 'questions' ? 'THE QUESTIONS:' : kind === 'lessons' ? 'THE LESSONS:' : 'THE FLASHCARDS:', json(items.map(i => tp ? { id: i.id, subject: i.subject, topic: i.topic || '', [kind === 'cards' ? 'front' : 'stem']: String(kind === 'cards' ? i.front : i.stem).replace(/\s+/g, ' ').slice(0, 220) } : hy ? pick(i, fields) : draft(pick(i, fields)))));
    return lines.join('\n');
  }

  // The topic names in use, for the subjects of the items being sent: { subject: [{ topic, n }] }, most used first
  function topicVocab(vocab, items) {
    const subjects = new Set(items.map(i => i.subject).filter(Boolean)), by = {};
    (vocab || []).forEach(v => { if (!v.topic || !subjects.has(v.subject)) return; const m = by[v.subject] ||= new Map(); const t = String(v.topic).trim(); m.set(t, (m.get(t) || 0) + 1); });
    return Object.fromEntries(Object.entries(by).map(([sb, m]) => [sb, [...m].map(([topic, n]) => ({ topic, n })).sort((a, b) => b.n - a.n || a.topic.localeCompare(b.topic))]));
  }
  // For each item, a few other questions of the same subject and topic (capped overall so the message stays a sensible size)
  function siblingsOf(vocab, items, per = 5, cap = 80) {
    const out = {}; let total = 0;
    for (const it of items) {
      const list = []; for (const v of vocab || []) { if (v.id === it.id || v.subject !== it.subject || String(v.topic || '').trim() !== String(it.topic || '').trim() || !v.stem) continue; if (list.length >= per || total >= cap) break; const ans = (v.options || []).find(o => o.id === v.answer); list.push({ id: v.id, stem: String(v.stem).replace(/\s+/g, ' ').slice(0, 140), answer: ans ? String(ans.text).replace(/\s+/g, ' ').slice(0, 90) : '' }); total++; }
      out[it.id] = list;
    }
    return out;
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
      <div class="fgrid"><div><label for="hf-task">What should the AI do?</label><select id="hf-task">${tasks.map(t => `<option value="${t[0]}">${esc(t[1])}</option>`).join('')}</select></div>
        <div><label for="hf-size-sel">${NOUN[kind][1].replace(/^./, c => c.toUpperCase())} per message</label><select id="hf-size-sel">${SIZES[kind].map(n => `<option value="${n}">${n}${n === CHUNK[kind] ? ' (default)' : ''}</option>`).join('')}</select></div>
        <div id="hf-partbox" hidden><label for="hf-part">Part</label><select id="hf-part"></select></div></div>
      <p class="muted small">A bigger message lets the AI work on more at once and uses more of your usage. The AI has to write every changed item back in full, so if its reply stops partway, pick a smaller number.</p>
      <label for="hf-note">Your note to the AI (optional): how you like things done</label><textarea id="hf-note" rows="3" placeholder="e.g. Keep my explanations short. Use ABPM wording. Do not change the references."></textarea>
      ${o.stats ? '<label class="chk"><input type="checkbox" id="hf-stats" checked> Include how each has been performing</label>' : ''}
      <label for="hf-prev">The message (you can read it before you copy)</label><textarea id="hf-prev" rows="9" readonly style="font:12px/1.4 ui-monospace,Menlo,Consolas,monospace"></textarea>
      <p class="muted small" id="hf-size" aria-live="polite"></p>
      <div class="row"><button class="primary" id="hf-copy" type="button">Copy to clipboard</button><button id="hf-dl" type="button">Download as a file</button><button id="hf-x" type="button">Close</button></div>
      <p class="muted small">Then paste it into your AI chat. When it replies, copy its JSON and ${o.importHash ? `<a href="${o.importHash}" id="hf-imp">bring it back with Import from a chat</a>` : 'use it to update the items'}. Everything comes back as a draft for you to review.</p></div>`;
    const prev = doc.activeElement, E = id => d.querySelector('#' + id);
    const close = () => { d.remove(); doc.removeEventListener('keydown', onKey, true); if (prev && doc.body.contains(prev)) prev.focus(); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    doc.addEventListener('keydown', onKey, true);
    d.onclick = e => { if (e.target === d) close(); };
    const size = () => { const v = +E('hf-size-sel').value; return SIZES[kind].includes(v) ? v : CHUNK[kind]; };
    const current = () => { const src = d.querySelector('[name=hf-src]:checked'); return src && src.value === 'sel' ? sel : all; };
    const draw = () => {
      const list = current(), parts = chunk(list, size()), pb = E('hf-partbox'), ps = E('hf-part');
      if (parts.length > 1) { const keep = +ps.value || 0; ps.innerHTML = parts.map((p, i) => `<option value="${i}">${i + 1} of ${parts.length} (${plural(kind, p.length)})</option>`).join(''); ps.value = String(Math.min(keep, parts.length - 1)); pb.hidden = false; } else pb.hidden = true;
      const idx = parts.length > 1 ? +ps.value : 0, chosen = parts[idx] || [];
      const stats = o.stats && E('hf-stats') && E('hf-stats').checked ? Object.fromEntries(chosen.map(i => [i.id, o.stats(i)]).filter(x => x[1])) : null;
      const tk = E('hf-task').value, today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const coverage = tk === 'highyield' && o.coverage ? Object.fromEntries(chosen.map(i => [i.id, o.coverage(i)])) : null;
      const outline = tk === 'outline' && root.Objectives ? [...new Set(chosen.flatMap(i => i.boards || []))].flatMap(b => root.Objectives.board(b).items.map(i => ({ ref: b + ':' + i.code, text: (i.parent ? i.parent.code + ' ' : '') + i.text.slice(0, 110) }))) : null;
      const catalog = tk === 'lessons' && o.lessons ? o.lessons.map(l => ({ id: l.id, subject: l.subject, title: l.title, summary: l.summary })) : null;
      const shows = tk === 'lessons' && o.currentLesson ? Object.fromEntries(chosen.map(i => { const c = o.currentLesson(i); return [i.id, c ? { id: c.lesson.id, title: c.lesson.title, pinned: c.pinned } : null]; })) : null;
      const topics = o.vocab ? topicVocab(o.vocab, chosen) : null;
      const siblings = tk === 'rules' && o.vocab ? siblingsOf(o.vocab, chosen) : null;
      const text = build(kind, chosen, { task: tk, note: E('hf-note').value, part: [idx, parts.length], stats, today: ymd, catalog, outline, current: shows, coverage, topics, siblings });
      E('hf-prev').value = text; d._text = text;
      E('hf-sum').textContent = `${plural(kind, list.length)}${o.describe ? ' (' + o.describe + ')' : ''}${parts.length > 1 ? `. That is a lot for one message, so it is split into ${parts.length} parts of up to ${size()}: copy one part at a time.` : '.'}`;
      E('hf-size').textContent = `About ${Math.round(text.length / 5).toLocaleString()} words in this message.`;
    };
    ['hf-task', 'hf-part', 'hf-size-sel', 'hf-note', 'hf-stats'].forEach(id => { const e = E(id); if (e) e.addEventListener(id === 'hf-note' ? 'input' : 'change', draw); });
    d.querySelectorAll('[name=hf-src]').forEach(r => r.addEventListener('change', () => { E('hf-part').value = '0'; draw(); }));
    E('hf-x').onclick = close;
    E('hf-copy').onclick = async () => {
      try { await root.navigator.clipboard.writeText(d._text); root.toast && root.toast('Copied. Paste it into your AI chat.'); }
      catch { E('hf-prev').readOnly = false; E('hf-prev').focus(); E('hf-prev').select(); root.toast && root.toast('Could not copy automatically. The message is selected: press Ctrl+C (or Cmd+C).'); }
    };
    E('hf-dl').onclick = () => { const a = doc.createElement('a'); a.href = root.URL.createObjectURL(new root.Blob([d._text], { type: 'text/plain' })); a.download = `for-ai-${kind}-${new Date().toISOString().slice(0, 10)}.txt`; a.click(); };
    const imp = E('hf-imp'); if (imp) imp.onclick = () => close();
    try { const saved = +root.localStorage.getItem('qbank.hfsize.' + kind); E('hf-size-sel').value = String(SIZES[kind].includes(saved) ? saved : CHUNK[kind]); } catch { E('hf-size-sel').value = String(CHUNK[kind]); }   // the last choice is remembered
    E('hf-size-sel').addEventListener('change', () => { try { root.localStorage.setItem('qbank.hfsize.' + kind, E('hf-size-sel').value); } catch { /* not saved */ } E('hf-part').value = '0'; });
    doc.body.appendChild(d); draw(); E('hf-copy').focus();
  }
  return { build, chunk, open, topicVocab, siblingsOf, TASKS, CHUNK, SIZES, IMPORT, QF, LF, CF, QRULES };
});
