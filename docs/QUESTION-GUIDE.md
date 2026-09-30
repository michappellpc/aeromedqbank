# Adding questions to AeroMedQBank

## Where the questions live

With accounts turned on (docs/CLOUD-SETUP.md), **real questions never go in the public repo.** Keep them in `private/`, which git ignores, and upload them to the private database with `node tools/push-questions.js`. The examples below use `data/questions/` for the public demo; for real work add `--data private` to the import, export and validate commands and save files under `private/questions/`.

## The easiest way: the Questions page in the app

Sign in as an admin (or reviewer) and open **Admin > Questions**. With accounts turned on this is all most people need.

1. **Draft** questions with Fable (prompt below).
2. **Import**: click **Import from a chat**, paste Claude's whole reply (extra chatter and code fences are fine), and read the check results. Good questions are saved as **Draft**, which means **only admins and reviewers can see them**; ones with problems are listed with a plain reason and skipped.
3. **Edit** any question: click its id, change the text, choices, picture or tags, and press Save. **Preview** shows what a member will see.
4. **Review and publish**: a physician opens the question, reads it against a reference, and sets Status to **Reviewed** (or selects several rows and uses **Mark reviewed**). **Reviewed questions go live for members.** The reviewer's email is recorded automatically and cannot be typed in. Rewriting a question's answer choices also clears the percentages of who picked each choice (they would no longer match). Editing the wording of a reviewed question sends it back to Draft, which hides it from members until it is reviewed again. To take a question offline without deleting it, use **Mark draft (hide)** (temporary) or **Archive** (retired).
5. **Remove**: **Archive** hides a question from members but keeps everyone's history and lets you **Restore** it. **Delete permanently** is only offered for archived questions and needs the word DELETE typed, because it also erases members' history for that question.
6. **Back up**: **Download backup** saves every question as one JSON file. Import it again (tick "Keep review status") to restore.

Give physician reviewers the **reviewer** role (in **Admin > Approved emails**, or the `role` column of `allowed_emails`). They can use only the Questions page, and they never see member names or scores. Admins and reviewers can change questions; no one else can.

The command-line steps below still work and are handy for big batches or for keeping a copy in a file.

## The workflow (command line)

1. **Draft** questions with Fable (prompt below), or write them yourselves.
2. **Save** the JSON it returns as `private/questions/<name>.json` (`node tools/push-questions.js --init` creates the folder).
3. **Check** it: `node tools/validate.js --data private`.
4. **List** the file in `private/manifest.json` under `files` (the importer can do this with `--add`).
5. **Upload** it: `node tools/push-questions.js` (see docs/CLOUD-SETUP.md, step 8).
6. **Review** every question with a physician (see "Review" below), then mark it `reviewed` and upload again.

Everything a model writes starts as `"status": "draft"`. Draft questions show an amber **Draft** tag in the app, and any user can hide them under Settings. Only a physician reviewer should change a question to `reviewed`.

## Rules that keep the bank trustworthy

- **Nobody should trust an AI-written medical fact until a physician has checked it.** Models write plausible, confident, wrong answers, and they invent references. Check the answer, the explanation, and that every reference exists.
- **Write original questions.** Do not paste in or ask a model to reproduce real board exam items, or questions from commercial banks. Exam candidates agree not to share exam content, and copying a competitor's bank is a copyright problem.
- **No patient information.** Vignettes must be invented composites. Nothing from a real chart, and nothing controlled or sensitive from a real unit or mission.
- Give it the **official content outline** for each board (paste it into the prompt) so questions cover what is actually tested.

## Prompt for Fable

Paste this, fill in the bracketed parts, and attach or paste the content outline.

````text
You are helping write practice questions for physician residents studying for the
[American Board of Preventive Medicine: Aerospace Medicine / Occupational Medicine /
Public Health & General Preventive Medicine] certification exam.

Write [20] ORIGINAL multiple-choice questions on: [subject, e.g. "Altitude &
Decompression"], covering these topics from the content outline: [paste topics].
Do not reproduce or paraphrase real exam questions or questions from commercial
question banks.

Question style
- Board-style clinical or operational vignette, 3-6 sentences, ending in one clear question.
- Single best answer. 4 or 5 options (A-D or A-E). Plausible distractors that reflect real misconceptions.
- No "all of the above" / "none of the above". No negative stems ("which is NOT").
- Vary the correct letter across the set. Vary difficulty (1 easy, 2 medium, 3 hard).
- All patients and cases are invented. No real patient details.
- Use standard units and values. Only state numbers you are certain of; if unsure, rewrite the question so it does not depend on the number.

For each question also write
- "explanation": why the correct answer is right, with the teaching point (2-5 sentences).
- "optionNotes": one sentence for EVERY option saying why it is right or wrong.
- "references": 1-3 real, checkable sources (textbook and chapter, guideline, regulation section). If you are not certain a source exists, leave references empty rather than guessing.

Output ONLY a JSON array, no commentary, matching this shape exactly:

[
  {
    "id": "aem-altitude-001",
    "status": "draft",
    "boards": ["aem"],
    "subject": "Altitude & Decompression",
    "topic": "Hypoxia",
    "difficulty": 2,
    "stem": "...",
    "options": [
      { "id": "A", "text": "..." },
      { "id": "B", "text": "..." },
      { "id": "C", "text": "..." },
      { "id": "D", "text": "..." }
    ],
    "answer": "A",
    "explanation": "...",
    "optionNotes": { "A": "...", "B": "...", "C": "...", "D": "..." },
    "references": ["..."]
  }
]

Rules for the fields
- "status" must always be "draft".
- "boards" uses: "aem" (Aerospace Medicine), "om" (Occupational Medicine), "pm" (General Preventive Medicine & Public Health). A question can list more than one.
- "subject" must be EXACTLY one of the subjects listed for that board in data/manifest.json:
[paste the subject list for the board]
- "id" is lowercase letters, digits and hyphens, unique, numbered in order.
````

The exact schema is in `data/question.schema.json` if you want to give it to the model as well.

## Review

Physician reviewers work best in a spreadsheet:

```bash
node tools/export-csv.js data/questions/aem-altitude.json > review.csv   # open in Excel or Google Sheets
```

Reviewers fix wording and answers, then set `status` to `reviewed` and put their initials in `reviewedBy` for each question they approve. Save as CSV, then:

```bash
node tools/import-csv.js review.csv --out data/questions/aem-altitude.json
node tools/validate.js
```

Ids are kept, so re-importing replaces the old version of the same file. Anything not approved stays `draft`.

## Starting from a spreadsheet instead

`docs/question-template.csv` has every column with an example row. Fill it in (use `|` to separate several boards or references), save as CSV, then:

```bash
node tools/import-csv.js my-questions.csv --prefix aem-altitude --add
node tools/validate.js
```

`--add` lists the new file in the manifest. `--prefix` sets the ids for rows that have none.

## Images

**With accounts (recommended):** keep images in `private/images/` (PNG, JPEG, WebP or GIF, lower-case file names, under 2 MB each) and refer to them like this:

```json
"image": "private:audiogram-01.png",
"imageAlt": "Audiogram: bilateral notch at 4 kHz, worse in the left ear"
```

`push-questions.js` uploads them to the private image store first. Only members who may see the question can see its picture, and pictures are saved on the device for offline use.

**Demo mode only:** put files in `images/` and use `"image": "images/name.png"`. Anything in that folder is public.

`imageAlt` is required either way (the validator enforces it). It is the text description for screen readers and shows if the image cannot load. Tapping a picture enlarges it. Only use images you created or have the right to use.

## Validation

`node tools/validate.js` fails on real problems (duplicate ids or stems, an answer that isn't an option, a subject that doesn't belong to the board, missing image files). It only warns about things like missing references or per-option notes. Add `--strict` to make warnings fail too, and `--summary` for counts by board, subject, status and answer letter.
