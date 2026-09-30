# AeroMedQBank

Static question bank for Aerospace, Occupational, and Preventive Medicine boards. Runs on GitHub Pages at `aeromedqbank.com` — no backend. Progress is saved in the browser (export/import from Settings).

## Adding questions
See **docs/QUESTION-GUIDE.md** for the full workflow (including a ready-made prompt for drafting questions with an AI model, physician review, spreadsheet import/export, and images). Short version:

1. Add or edit JSON files in `data/questions/` (see `sample.json` for the format).
2. List each file in `data/manifest.json` under `files`. Subjects live in the same file.
3. Run `node tools/validate.js` — checks ids, boards, subjects, answers.

Question fields: `id` (unique), `status` (`draft` or `reviewed`), `boards` (`aem`/`om`/`pm`, one or more), `subject`, `topic`, `difficulty` (1-3), `stem`, `options[{id,text}]`, `answer` (option id), `explanation`, `optionNotes{id:text}`, `references[]`, optional `image` + `imageAlt`, `reviewedBy`. Schema: `data/question.schema.json`.

## Accounts and private questions (optional)
Off by default, so the demo works with no setup. To turn on accounts (self sign-up for free accounts or invitation-only, your choice) with a private question bank, saved progress and an admin page, follow **docs/CLOUD-SETUP.md** (about 40 minutes, uses a free Supabase project). Database and privacy rules: `supabase/schema.sql`, tested with `supabase/tests/run.sh`. Real questions and their pictures live in the git-ignored `private/` folder and are uploaded with `tools/push-questions.js`. Admins can add members (creating their login through the `member-admin` Edge Function in `supabase/functions/`), reset passwords, change plans and download the member list in the app, and admins and reviewers can add, import (paste a chat reply), edit, review, archive and back up questions from **Admin > Questions** (`js/admin.js`, shared checker in `js/qvalidate.js`, tested with `tools/test-qvalidate.js`). Legal pages: `privacy.html`, `terms.html` (set `contactEmail` in `data/config.json`).

## Question feedback (in-app inbox)
With accounts on, the **Feedback** button on every question opens a short form (what it is about, and a message). Messages go to **Admin > Inbox**, where admins and reviewers mark them read or resolved, add an internal note, and jump to the question. The Admin menu shows a red count of new messages. Only admins see who sent each message; a member can send at most 30 a day. Offline messages are saved and sent later. Without accounts (the demo site) the button still opens the Google Form set as `feedbackUrl` in `data/config.json`.

## Highlighting and striking out
During a test, select text in the question and choose **Highlight** or **Strike out** above it (choose it again on the same text to undo, or **Clear marks** to start over). Marks stay on your device and last for that test only. Answer choices can be crossed out with the ✕ beside each one.

## Related lessons
Under each explanation (after answering in a tutor test, and on the review page) the app links the most relevant lesson. It matches by the words the question, its correct answer and its explanation share with each lesson's title, summary and text, and opens the lesson in a new tab so a test is not interrupted. If no lesson fits well, it links the lessons for that question's subject instead, and if there are none it shows nothing. This needs no setup and adds nothing to the questions. The matching is in `js/related.js`, with tests in `tools/test-related.js`.

## Support and replies (in the app, no email)
The **Support** tab lets any signed-in member send the team a question (optional subject, then the message). Question feedback and Support share one system: the team answers from **Admin > Inbox** (filter by Support or Feedback, open the conversation, type a reply), and the member sees the reply under **Support** with a red count on the tab and a notice on the dashboard. Members can reply back. Reviewers can reply too without seeing who they are talking to; only admins see the sender. Nothing is sent by email. Run the latest `supabase/schema.sql` to switch this on.

## Question feedback (Google Form, demo site)
Every question has a **Feedback** button (during a test and on the review page). It opens the team's Google Form in a new tab, with a Copy button for the question's reference so people can paste it into the form. The form address is `feedbackUrl` in `data/config.json`.

## Phones and offline
The app is installable ("Add to Home Screen") and works offline after the first visit. `sw.js` keeps a cached copy; when online it always fetches fresh files. Fonts are hosted in `fonts/` (SIL OFL license) so nothing loads from outside sites. `node tools/make-icons.js` regenerates the app icons.

## Local preview
`python3 -m http.server` from the repo root, then open `http://localhost:8000/`.

## Cover picture
The dashboard cover is a built-in vector illustration. To use your own photo instead, put an image (JPEG or WebP, about 1600 px wide, one you have the right to use) in `img/` and set `"coverImage": "img/your-photo.jpg"` in `data/config.json`. Government photos from DVIDS are usually free to use, but check each photo's terms.

## Group averages and flags
After a member answers a question they see how many members got it right on their first try, and the same average appears in results, review and the subject table. The database only releases a figure once at least N members (set in Admin, never below 5) have answered, so no individual can be identified. After answering, members also see the percentage who picked each answer choice (first tries only, same minimum). If you rewrite a question's answer choices, its earlier picks are cleared, because they no longer describe the same options. Members can flag any question and review flagged questions from the dashboard's Flagged tile.

## Focus areas
The dashboard's **Focus areas** card lists a member's weakest subjects (below 80% correct, at least 5 answered), the most missed topics in each, links to that subject's lessons, and a button that opens a test of just the questions they missed there. It is computed on the device from their own answers, so it needs no database changes.

## Residency programs
Admins add programs under **Admin > Overview > Residency programs**. Residents pick their program while creating an account (or later in Settings) and its faculty approve them. An account with the role **faculty** and a program gets a **Program** page with a roster, percent correct by subject, a program average, approvals and a CSV download. Faculty see progress only, never answers, notes or test history, and residents are told so up front (`js/program.js`).

## Lessons
The **Lessons** tab has short teaching pages per subject with tables, charts, step flows and comparisons, plus a button to practice questions in that subject. Admins and reviewers write, preview, import and publish them under **Admin > Lessons** (`js/adminlessons.js`, renderer in `js/lessons.js`, rules in `js/lvalidate.js`). See **docs/LESSON-GUIDE.md**, including a ready-made prompt for drafting lessons. Sample lessons (unreviewed drafts) are in `data/lessons/`.

## Features
Tutor and timed modes, filters (board, subject, unused/incorrect/flagged), option cross-out, flagging, notes, question navigator, keyboard shortcuts (1-9/letters, ←/→, F, Enter), results by subject, test review, history, dark mode, progress backup.

## Not built yet
Spaced repetition, percentile vs. peers.
