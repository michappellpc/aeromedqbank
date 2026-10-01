# Writing flashcards

Flashcards are short prompts a resident flips and rates ("Again, Hard, Good, Easy"). The app schedules each card with spaced repetition, so well-written cards matter more than many cards. They are **free for everyone**: there is no pro tier for cards.

## Workflow

1. **Draft** cards with Claude (prompt below), or write them yourself.
2. **Import** them in **Admin > Flashcards > Import from a chat**. Paste the whole reply. The checker reports problems and near-copies of cards you already have, and nothing is saved until you press Save. Everything arrives as **Draft**, hidden from members.
3. **Review** each card yourself. Check the facts against a real source.
4. **Publish** in the list: tick the cards and press **Mark reviewed (publish)**. Your name is recorded on each one.
5. Changing the wording of a live card sends it back to Draft until it is reviewed again.

Archiving hides a card but keeps everyone's schedule for it. **Delete permanently** (archived cards only) also erases every member's schedule for it.

## What makes a good card

- **One fact per card.** If the back has two unrelated points, make two cards.
- **A short, specific prompt** (under about 300 characters). It should have one clear answer.
- **A back that is as short as it can be**, with the one reason that makes it stick. Long answers are a sign the card should be split.
- **Test recall, not recognition.** "Which type of hypoxia can a pulse oximeter miss?" is better than "Hypemic hypoxia is related to what?".
- **Link a lesson** when one exists, and the back shows a "Study the lesson" link. If you leave it blank, the app picks the best match by wording.
- **Original wording only.** Do not paste real board exam items or text from commercial banks.
- **No patient information.**

## The format

Cards are JSON, the same shape the importer and `data/cards/*.json` use:

```json
[
  {
    "id": "aem-altitude-card-001",
    "status": "draft",
    "boards": ["aem"],
    "subject": "Altitude & Decompression",
    "topic": "Hypoxia",
    "front": "Which type of hypoxia can a pulse oximeter miss?",
    "back": "Hypemic, for example carbon monoxide. SpO2 can read falsely normal because the oximeter cannot tell carboxyhemoglobin from oxyhemoglobin.",
    "lessonId": "aem-hypoxia-types",
    "references": ["Textbook, chapter and page"]
  }
]
```

- `id`: lowercase letters, digits and hyphens, unique.
- `status`: always `"draft"` when importing.
- `boards`: `"aem"`, `"om"` and/or `"pm"`. `subject` must be one of that board's subjects in `data/manifest.json`.
- `front` is required (up to 600 characters). `back` is required (up to 1500).
- `lessonId` (optional) is the id of a lesson. `topic` and `references` are optional but recommended.

`node tools/validate.js` checks `data/cards/*.json` (listed under `"cards"` in the manifest) with the same rules as the editor.

## Prompt for Claude

````text
You are helping write flashcards for physician residents studying for the
[Aerospace Medicine / Occupational Medicine / Public Health & General Preventive Medicine]
board exam.

Write [30] ORIGINAL flashcards on: [subject], covering these topics: [paste topics].
Do not reproduce or paraphrase real exam questions or text from commercial banks.

Card style
- One fact or one distinction per card. If a topic has several parts, make several cards.
- "front": a short, specific prompt with one clear answer. Prefer a question that needs recall
  ("Which ... ?", "What happens to ... when ... ?") over "Define X".
- "back": the answer in 1 to 3 short sentences, with the single reason that makes it memorable.
- Standard units and values. Only state numbers you are certain of; if unsure, leave the card out.
- No patient information. No "all of the above".
- "references": 1 to 2 real, checkable sources. If you are not certain a source exists, leave
  references empty rather than guessing.

Output ONLY a JSON array, no commentary, matching this shape exactly:
[ { "id": "aem-altitude-card-001", "status": "draft", "boards": ["aem"], "subject": "...",
    "topic": "...", "front": "...", "back": "...", "references": ["..."] } ]

Rules
- "status" must always be "draft".
- "subject" must be EXACTLY one of the subjects listed for that board in data/manifest.json:
[paste the subject list for the board]
- "id" is lowercase letters, digits and hyphens, unique, numbered in order.
````

**An AI-written fact is not a checked fact.** Models write confident, wrong cards and invent references. A physician must check every card before it is published.
