# Adding lessons to AeroMedQBank

Lessons are short teaching pages for one subject: text, tables, charts, step-by-step flows and comparisons. Members open them from the **Lessons** tab, and every lesson has a **Practice questions in this subject** button.

## The easy way: Admin > Lessons

1. Ask Claude to write lessons with the prompt below.
2. In the app open **Admin > Lessons > Import from a chat** and paste the whole reply. Each lesson is checked and saved as a **Draft**, which only admins and reviewers can see.
3. Open a lesson (**Edit**) to see a live preview, fix wording, or insert an example block from the menu.
4. A physician reads it against the references, then selects it in the list and clicks **Publish (mark reviewed)**. Their email is recorded as the reviewer.
5. Editing the wording of a live lesson hides it again until it is reviewed again. **Archive** retires a lesson without deleting it.

Set **Who can see it** to *Pro members* or *Free members too*, the same as questions. If you allow open sign-up, free accounts only see lessons set to free.

## Block types

Each lesson has a list of blocks, shown in order.

| Block | What it is | Main fields |
|---|---|---|
| `heading` | Section heading (also builds the "In this lesson" list) | `text` |
| `text` | Paragraphs. `**bold**` and `*italic*` work; a blank line starts a new paragraph | `text` |
| `list` | Bullets or numbers | `style` (`bullets`/`numbers`), `items` |
| `callout` | Highlighted box | `kind` (`pearl`, `key`, `warning`, `tip`), `title` (optional), `text` |
| `table` | A table, first column shown as row headers | `caption`, `columns`, `rows` |
| `steps` | Numbered flow | `title`, `steps` (each with `title`, `text`) |
| `compare` | 2 to 4 side-by-side cards | `title`, `items` (each `title`, `points`, `tone`: `neutral`/`good`/`bad`) |
| `stats` | Big-number tiles | `items` (each `value`, `label`) |
| `chart` | Bar or line chart (drawn by the app, with the numbers available as a table) | `kind` (`bar`/`line`), `title`, `xLabel`, `yLabel`, `yScale` (`linear`/`log`), `categories`, `series` (each `name`, `values`), `note` |
| `image` | A picture (upload with **Upload a picture as a new block**) | `image`, `alt`, `caption` |

Limits: 80 blocks per lesson, tables up to 12 columns by 40 rows, charts up to 24 categories and 4 series.

## Prompt for Claude

Copy everything in the box, fill in the topic line, and paste it into a new chat.

```
You are writing lessons for AeroMedQBank, a board-prep site for resident physicians in aerospace medicine, occupational medicine and general preventive medicine.

Topic: [SUBJECT AND WHAT THE LESSON SHOULD COVER]
Board: [aem, om or pm]   Subject (exactly as listed): [SUBJECT NAME]

Write [1] lesson(s) as a JSON list and nothing else (no commentary). Each lesson:
{
  "id": "aem-hypoxia-types",              // lowercase letters, digits, hyphens
  "status": "draft",
  "tier": "pro",
  "boards": ["aem"],
  "subject": "<exact subject name>",
  "order": 1,
  "title": "...", "summary": "one line",
  "blocks": [ ... ],
  "references": ["textbook or guideline, edition, chapter"]
}

Allowed blocks (use only these): heading{text}; text{text} with **bold**; list{style,items}; callout{kind: pearl|key|warning|tip, title?, text}; table{caption,columns,rows}; steps{title,steps:[{title,text}]}; compare{title,items:[{title,points,tone}]}; stats{items:[{value,label}]}; chart{kind: bar|line,title,xLabel,yLabel,yScale?,categories,series:[{name,values}],note?}.

Rules:
- Teach for a board exam: lead with what is most testable. Use tables to compare, steps for procedures, charts only when numbers make the point, callouts for pearls and traps.
- Use only facts you are confident are correct and current. Do not invent numbers, guidelines, or citations. If a value differs between sources, say so in a chart note or callout. Mark anything you are unsure of in the text with "(verify)".
- 8 to 20 blocks per lesson. Every table row must have exactly as many cells as columns; every chart series must have exactly one number per category.
- Reference real, checkable sources (edition and chapter or guideline number) that a physician can look up.
```

## Reviewing lessons

A lesson goes live only after a physician has checked the facts, numbers and references. Pay special attention to numbers in charts and tables, dose or limit values, and anything Claude marked "(verify)". Sample lessons that ship in `data/lessons/sample.json` are drafts written for the demo and have **not** been medically reviewed.

## From the command line

Lessons are plain JSON, so you can also keep them in files. `node tools/test-lvalidate.js` checks the rules and the bundled samples. The demo site (no accounts) loads the files listed under `"lessons"` in `data/manifest.json`.
