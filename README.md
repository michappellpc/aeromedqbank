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

## Names instead of emails
In **Settings > Your name**, a resident can add a name. Faculty of their program (and an admin using View as faculty) see that name in place of the email, on the roster, the subject grid and the CSV; blank shows the email. It is optional and the privacy policy says so. Admins also see the name under the email in the member list. Run the latest `supabase/schema.sql` to switch it on.

## Difficulty on the New Test screen
The New Test screen has Easy, Medium and Hard checkboxes (all on by default), each showing how many questions apply given the other choices, and an **Order of questions** choice: Random, Easiest first or Hardest first. Ordering applies after the questions are picked, so a 20-question test of mixed levels can run easy to hard.

## Reworded copies
When you import or save a question, the app compares its wording with every question you already have. If it shares most of its words with one that has a different id, it adds a note ("reads like a reworded copy of ..."), because saving it would add a second question rather than replace the first. Use the same id to replace, or archive the old one. `node tools/validate.js` also reports near-copies inside the bank. It is a warning only; nothing is blocked.

## Sorting the question list
Admin > Questions has a Difficulty column, a **Difficulty** filter (Easy, Medium, Hard) and a **Sort by** choice (ID, Hardest first, Easiest first).

## Exam countdown
The home screen has an **Exam countdown** card: the member adds their exam date (and an optional name) and sees the days left, the date, and how many new questions a day would cover the ones they have not seen yet. It also reads "Today is the day" and, once the date passes, offers to change it. The date can be set or changed on the home screen or in Settings, is saved to the account (synced across devices) and works in the demo too.

## Quieting the ram during tests
The question screen has a **Hide ram** button (and **Show ram** to bring it back), so the talking ram is not a distraction mid-test. It only affects tests: the dashboard and results keep the ram. The same choice is in Settings ("Show the ram while I take a test"), is saved to the account and follows the member between devices. Turning the mascot off entirely in Settings still removes it everywhere.

## Program insights (faculty)

On the Program page, **Open insights** shows how the residents do as a group: the topics they are weakest in, ranked by how far under 70% the program is, how far behind all members, how many residents struggle and how many answers back it up; the lessons that would help most for each weak topic (matched on the topic's name and the wording of its questions, with "No lesson yet" when nothing covers it); the questions the program misses most with the wrong answer picked most; a weekly trend; and residents who may need a check-in (quiet for two weeks, or under half right over 20 or more answers). There is a time range (all time, 90, 30 or 14 days), a CSV download and a print view. Admins see the same through View as faculty.

**Privacy.** Only group totals over approved residents are returned, never one resident's answers by topic, and nothing at all unless the program has at least 3 approved residents. A topic needs 10 answers from 3 residents, a question 5 answers from 3 residents, and the most common wrong answer is shown only when at least 2 residents chose it. This is enforced in the database functions `faculty_topics`, `faculty_questions` and `faculty_weekly` (and `preview_*` for admins), with tests in `supabase/tests/run.sh`. The notice residents see when joining and the privacy policy say so. Run the latest `supabase/schema.sql` to switch it on.

## Highlights, My highlights and your own flashcards

**Highlighting.** Select text in a question, an answer choice, an explanation or a lesson and a small toolbar offers Highlight and Make flashcard. Click a highlight to remove it, or select highlighted text and choose Remove highlight. The Highlight button in the tools row works on whatever you last selected. Highlights are saved to your account, so they come back in every test and on every device. A pencil marker shows on the question number, the question header and lessons that have highlights. Strike out stays a per-test tool on the question text. Dragging over words in an answer choice never picks the choice.

**My highlights** (menu: Highlights) lists everything you have highlighted, grouped by question or lesson, with search, a Questions/Lessons filter, Make flashcard and Remove. Open question shows a question on its own with its explanation.

**Your own flashcards.** Flashcards > My cards lets you write cards, edit them and delete them. Make flashcard on a highlight fills the front with the sentence around it (the highlighted words hidden as [ ... ]) and the back with the highlighted words; Make flashcard under an explanation fills the card from the whole question. Your cards form the deck "My cards", studied and scheduled like any other deck.

**Privacy and limits.** Highlights and your own cards are private to you: administrators, reviewers and faculty cannot read them (the database policies enforce this, with tests in `supabase/tests/run.sh`). Up to 5000 highlights and 2000 own cards. If a question or lesson is edited later, a highlight finds its words again; if they are gone, it stays listed in My highlights. Resetting your progress keeps highlights and cards. Run the latest `supabase/schema.sql` to switch this on; until then everything works on the device and syncs after the upgrade.

## Calculator

A Calculator button in the tools row of the question screen opens a floating calculator that stays open from question to question. It handles + - x / ^ and brackets, percent, factorial, square root, log, ln, e^x, pi, e, 1/x and a memory of the last answer, and keeps the last five results. Type a sum and press Enter, or use the keypad. Drag it by its title bar on a computer; on a phone it opens as a sheet above the bottom bar. Escape or the X closes it. The maths is a small parser, not `eval`, with tests in `tools/test-calc.js`. No database change.

## Navigation

On desktop every link sits in the top bar. On phones the bottom bar keeps Dashboard, New Test, Lessons and Flashcards on one row, and a More button opens a panel with History, Support, Program, Admin and Settings. More lights up while you are on one of those pages and shows a red dot when Support or the inbox has something new. Escape, tapping outside or choosing a link closes the panel.

## Results and dashboard charts

The Results screen shows a score ring (the number is printed inside, so colour is never the only signal), time, mode and the change against your previous tests, then a bar for each subject with the weakest first. A button starts a practice test on the weakest subject. The dashboard has a "Continue where you left off" card for an unfinished test and a Recent scores line chart once you have two finished tests. The charts are plain SVG with a text label for screen readers; there is no chart library and no database change.

## The New Test screen

Mode is two choice cards (Tutor, Timed). Boards, question status and difficulty are chips with live counts. Subjects are grouped by board in collapsible sections, each showing how many of its subjects are selected. The summary panel beside the form (below it on phones) shows how many questions are available, the number to use, quick picks of 10, 20, 40 or All, and the order. Nothing here touches the database.

## The question screen
The tools above the question are compact (Highlight, Strike out, Clear marks) with **A-** and **A+** to change the text size (saved to the account). Submit, Previous, Next, Flag, Feedback, Hide ram and End test sit in a bar that stays at the bottom while you scroll. **End test** says how many questions are unanswered and flagged before it ends. After answering, the explanation is laid out in sections: a Correct or Incorrect banner, how other members did, the Explanation, a row for each answer choice's note, a lesson card and references. The Review page uses the same layout.

## Colour themes and type
Settings > **Colour theme** switches between **Olive and gold** (the original) and **Navy and teal**, each with light and dark modes. The choice is saved to the account and follows the member to other devices. Text is set in Inter (self-hosted in `fonts/`, SIL Open Font License). The themes are CSS variables in `css/style.css` (`data-palette` on the page), so adding a third is a short block of colours.

## Flashcards
The **Flashcards** tab has short cards a resident flips and rates (Again, Hard, Good, Easy). A simple spaced-repetition schedule (a form of SM-2) brings each card back just before it is forgotten, with up to 10 new cards a day. Each member's schedule is saved to their account, works offline, and is cleared by **Reset all progress**. Flashcards are free for everyone. Admins and reviewers manage them under **Admin > Flashcards** (add, edit, import from a chat, publish, archive, delete, backup), the same way as questions. **Browse all cards** lets a member read through the cards (search, filter by subject, show or hide answers) without rating or scheduling anything. Each member can adjust **Flashcard settings** on the Flashcards page: new cards per day (0 to 100), most reviews in one session (20, 50, 100, 200 or no limit), shuffled or most-overdue-first order, whether the buttons show when a card returns, and reverse cards (answer first). The settings follow the member to other devices. Writing guide and AI prompt: `docs/CARD-GUIDE.md`. Run the latest `supabase/schema.sql` to switch them on. The demo site loads `data/cards/sample.json`.

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
