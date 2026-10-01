# Turning on private accounts

This switches AeroMedQBank from "anyone with the link can use it" to **invitation-only, with a private question bank**:

- Only people whose email you approve can sign in.
- The questions live in a private database. They are not in this public repository and are only sent to approved, signed-in people.
- Each person's progress is saved to their account, so it follows them between phones and computers. It still works offline.
- You get an **Admin** page showing how the group is doing.

Plan on **about 40 minutes**. Nothing here costs money on Supabase's free plan for a small group (check their current limits before you rely on it).

You need: a computer, an email address for your Supabase account, and (for step 8 only) [Node.js](https://nodejs.org) installed. Choose the "LTS" download.

---

## 1. Create the database project

1. Go to **supabase.com** and sign up (free).
2. Click **New project**. Name it `ramqbank`. Choose the region closest to your residents.
3. Make up a **database password** and save it in a password manager. You will rarely need it.
4. Wait a couple of minutes while it sets up.

## 2. Create the tables and privacy rules

1. In the left menu click **SQL Editor**, then **New query**.
2. On GitHub, open the file `supabase/schema.sql`, click **Copy raw file**, and paste everything into the editor.
3. Click **Run**. You should see "Success. No rows returned".

This is safe to run again later. It creates the tables, and the rules that make each person's data private.

**Updating an existing project:** when a new version of the app adds features (for example the Questions editor, the reviewer role, hiding Draft questions from members, Lessons, group averages, answer-choice percentages, the in-app feedback inbox, Support messaging with replies, residency programs, admins or reviewers who are also residents, and flashcards), paste the latest `schema.sql` and Run it once more. Nothing is lost. Until you do, the app keeps working for members, and the Questions page shows a "one more setup step" note.

## 3. Approve people, starting with yourself

1. Left menu: **Table Editor** > table **allowed_emails** > **Insert row**.
2. **Add yourself first.** Email in lower case, `role` = `admin`, `plan` = `pro`. Save.
3. Add each resident: their email in lower case, `role` = `member`, `plan` = `pro`.

Nobody can see anything until their email is on this list. Removing an email from the list locks that person out immediately.

## 4. Create the accounts

There are two ways. The first means you never need to open Supabase to add a person.

### A. From the app (recommended): Admin > Approved emails > Add member

You set this up once (about 5 minutes), because creating logins needs a secret key that must stay on Supabase's servers and never in the website:

1. In Supabase click **Edge Functions** in the left menu, then **Deploy a new function** > **Via Editor**.
2. Name it exactly `member-admin`.
3. On GitHub open `supabase/functions/member-admin/index.ts`, click **Copy raw file**, and paste it over everything in the editor. Click **Deploy**.
4. Open the function's **Settings** (or **Details**) and turn **off** "Verify JWT with legacy secret" (the function checks that the caller is an administrator itself). Save.

After that, in the app: **Admin > Approved emails**, type the person's email, choose role and plan, click **Add member**. The app shows a temporary password once, with a message you can copy and send privately. The person is asked to choose their own password the first time they sign in. **Reset password** on any row makes a new temporary password (for someone who is locked out). No email service is needed.

If you skip this, **Add member** still approves the email, but you must create the login yourself with option B.

### B. In Supabase, by hand

1. Left menu: **Authentication** > **Users** > **Add user** > **Create new user**.
2. Enter the email and a password. **Tick "Auto Confirm User".** Click **Create user**.
3. Give each person their password privately. They can reset it later with **Forgot password** once step 6 is done.

(**Invite user** emails a link instead. Supabase's built-in email is limited to a few messages an hour, and may only reach your own team, so set up your own email service under **Authentication > Emails > SMTP settings** first if you use it.)

## 5. Sign-up settings

The app has its own switch: **Admin > Sign-up > "Let anyone create a free account on the sign-in page"**. While it is on, anyone can make an account on the sign-in page and gets a **free** member account straight away (they appear in Approved emails as "self sign-up", where you can upgrade, edit or delete them). Free accounts only see questions set to **Free members too**; questions set to **Pro members** stay private. Turn the switch off to make the site invitation-only again.

In Supabase, for the switch to work:
1. **Authentication** > **Sign In / Providers** > **Email**: keep "Allow new users to sign up" **on**.
2. Decide on **Confirm email**. Turned **off**, new accounts work at once (simplest, and fine because open sign-up does not depend on owning an address). Turned **on**, people must click an emailed link first, which needs your own email service (Authentication > Emails > SMTP settings), because Supabase's built-in email only reaches your own team.
3. Set the minimum password length to 8 or more.

Two safety rules are built into the database: someone who signs up on their own can never receive a role or plan from the approved list (so nobody can claim another person's pre-approval), and only accounts made by an admin through **Add member** get exactly what the list says.

## 6. Tell Supabase your website address

1. **Authentication** > **URL Configuration**.
2. **Site URL:** `https://aeromedqbank.com/`
3. Under **Redirect URLs** add the same address.

This is what makes the links in password-reset and invite emails open your app.

## 7. Connect the app

1. Left menu: **Project Settings** > **API** (or **API Keys**).
2. Copy the **Project URL**.
3. Copy the key labelled **anon / public** (or **Publishable key**).
4. In the repo, open `data/config.json` and fill in:

```json
"supabase": {
  "url": "https://YOUR-PROJECT.supabase.co",
  "anonKey": "the anon / publishable key"
}
```

> **Only ever put the anon / publishable key in this file.** It is designed to be public: the privacy rules from step 2 are what protect the data, not the key.
> **Never** put the **service_role / secret** key in the repo, in an email, or anywhere public. It bypasses every rule. It is only used on your own computer in step 8.

Commit that change. Once it is live, the app asks everyone to sign in.

## 8. Upload your questions (from your own computer)

Real questions must never be saved in the public repo. Keep them in the git-ignored folder `private/`.

1. Get the repo onto your computer (on GitHub: **Code** > **Download ZIP**, then unzip).
2. Open a terminal in that folder and create the private folder:
   ```bash
   node tools/push-questions.js --init
   ```
3. Put questions in it. Either save your JSON files in `private/questions/` and list them in `private/manifest.json`, or import a spreadsheet straight there:
   ```bash
   node tools/import-csv.js my-questions.csv --data private --prefix aem-altitude --add
   ```
4. Check them without sending anything:
   ```bash
   node tools/push-questions.js --dry
   ```
5. Get the secret key: **Project Settings > API** > **service_role / secret** key. In your terminal (not in any file):
   ```bash
   export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
   export SUPABASE_SERVICE_KEY="paste the secret key here"
   node tools/push-questions.js
   ```
   (On Windows PowerShell use `$env:SUPABASE_URL="..."` and `$env:SUPABASE_SERVICE_KEY="..."`.)

**Pictures** (audiograms, spirometry, charts) are private too. Put the image files in `private/images/` (lower-case names ending in `.png`, `.jpg`, `.webp` or `.gif`, each under 2 MB) and refer to them in a question as `"image": "private:audiogram-01.png"` with an `imageAlt` description. The upload tool sends the pictures first. A member can only see a picture if they can see a question that uses it.

Run it again any time to add or fix questions. Existing ones are updated by their `id`. `--tier free` makes a batch visible to free-plan accounts too (see "Free and paid" below).

## 9. Contact address and legal pages

The app has a privacy policy (`privacy.html`) and terms of use (`terms.html`), linked at the bottom of every page and on the sign-in screen. They describe what the app really collects, and they name the person who runs it as the contact.

1. In `data/config.json` set `"contactEmail"` to the address residents should write to (for example for locked-out accounts or deleting their data). Until you do, the pages say "the person who invited you".
2. Read both pages once. I wrote them from how the app actually works, but I am not a lawyer, so have someone qualified review them before you rely on them, especially if you ever charge.
3. Your privacy and terms pages are part of this site (`privacy.html` and `terms.html`).

## 10. First-time check (please do this before inviting everyone)

I built and tested all of this against a stand-in for Supabase and on a real test database, but I could not reach the real Supabase from where I work. So the first real run is yours:

- [ ] Open the site while signed out. You should see only the sign-in screen.
- [ ] Sign in as yourself. You should reach the dashboard and see your questions.
- [ ] Answer a few. In Supabase **Table Editor > attempts**, rows should appear.
- [ ] Sign in on a second device or browser. Your progress should be there.
- [ ] Turn on airplane mode, reload, and answer one. Turn it back on. The row should appear in `attempts` shortly after.
- [ ] Open **Admin** in the menu. You should see the member list and question stats.
- [ ] Sign in as a resident (or a test account) and confirm there is **no** Admin menu.
- [ ] In **Admin**, approve a test email, change its plan, and remove it again.
- [ ] In **Settings**, change your password, then sign out and back in with the new one.
- [ ] If you have uploaded a question with a picture, confirm the picture shows, then confirm it still shows in airplane mode.
- [ ] Try **Forgot password** and confirm the email arrives (only works if email is set up, step 4).
- [ ] Sign out, then check the device: reloading should show the sign-in screen.

If something fails, tell me exactly what you saw (a screenshot helps) and I will fix it.

---

## Residency programs and faculty

1. **Admin > Overview > Residency programs**: type a program name and click **Add program**. Residents will see it in a list when they create an account.
2. **Make faculty**: under Approved emails add the person with role **faculty** and choose their program (or click **Edit** on an existing person). Faculty then get a **Program** menu item. You can have several faculty per program.
3. Residents choose their program when they sign up, or in **Settings**. Faculty approve or decline each request on their Program page, and see progress only once approved.
4. To take someone out of a program, faculty click **Remove**, or the resident clicks **Leave** in Settings.

Program names are visible to anyone on the sign-up page, so name them generically if that matters (for example "Aerospace Medicine Residency" rather than a person's name).

## Everyday tasks

**Add, change or remove a person:** use **Admin > Approved emails** in the app. **Add member** creates the account (step 4A), **Edit** changes role, plan and note, **Reset password** makes a temporary password, **Remove** locks them out but keeps their history, and **Delete account** (inside Edit) erases the account and all of their data for good.

**A resident forgot their password:** they use **Forgot password** on the sign-in screen (needs email set up), or you set a new one for them under Authentication > Users. Everyone can change their own password in **Settings**.

**Add, edit, review or remove questions:** **Admin > Questions** (see docs/QUESTION-GUIDE.md). Give physician reviewers the `reviewer` role so they can review without seeing member data. Use **Download backup** now and then.

**See how the group is doing:** **Admin** shows members, how many questions each has answered, and the hardest questions. **Download CSV** exports the member list.

**Make a question or person "free" vs "pro":** every question has a `tier` and every person a `plan`. A `pro` plan sees everything, a `free` plan only sees `free` questions. Right now everyone you add is `pro`, so tiers do nothing until you decide to charge.

**See who is active:** the Admin page, or the `profiles` table.

**Back up:** keep your question files (the folder `private/`) somewhere safe, since they are the master copy. Progress can be exported as CSV from the Table Editor.

## What is and is not protected

- Protected: the question text, answers and explanations are only sent to approved, signed-in people, and each person only ever sees their own progress.
- Not protected: an approved person can still copy what they can see (screenshots, copying text). That cannot be prevented by any website.
- **Pictures** use the private image store (see step 8), not the public `images/` folder. Anything you put in the public `images/` folder is visible to anyone, so do not use it for real question images.
- The public repo still contains the app itself and 4 placeholder demo questions. That is fine. With accounts turned on the demo questions are not used.

## If you plan to charge later

The pieces for it are already in place: a `plan` for each person and a `tier` for each question, and access rules enforced in the database. What would still be needed is a payment service (such as Stripe) that sets a person's plan when they pay, plus terms of service and a privacy policy. Check with an ethics counselor before charging if you are a service member, and with a lawyer about question ownership.

## Troubleshooting

| You see | Likely cause |
|---|---|
| "Email or password is incorrect" | Wrong password, or the account wasn't created (step 4) or wasn't confirmed ("Auto Confirm User") |
| "Account not active yet" | Their email isn't in `allowed_emails`, or was typed with capital letters. Emails must be lower case |
| A picture says "Image unavailable" | The picture was not uploaded (run the upload tool again), the name in the question does not match the file, or the device is offline and had not saved it yet |
| Signed in but 0 questions | No questions uploaded yet (step 8), or the person is on the `free` plan and the questions are `pro` |
| "Could not load your questions" while online | The schema wasn't run (step 2) or the URL/key in `config.json` is wrong |
| Reset or invite email never arrives | Supabase's built-in email is rate-limited. Set up SMTP (step 4) |
| Reset link opens a blank or error page | The Site URL in step 6 doesn't match your real address |
