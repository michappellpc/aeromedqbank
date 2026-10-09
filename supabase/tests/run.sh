#!/usr/bin/env bash
# Tests the privacy rules in ../schema.sql on a real Postgres by acting as different people.
#   PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres bash run.sh
# Needs a running Postgres you can create databases in. Uses a throwaway database named qbank_test.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; DB=qbank_test
export PGOPTIONS='--client-min-messages=warning'
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
psql -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null || { echo "cannot create test database"; exit 2; }
P -d $DB -f "$HERE/shim.sql" >/dev/null && P -d $DB -f "$HERE/../schema.sql" >/dev/null || { echo "schema failed to load"; exit 2; }

psql -X -q -d $DB -c "update app_settings set value = 'false' where key = 'open_signup'" >/dev/null   # the seeded people below predate open sign-up
declare -A U=( [admin]=00000000-0000-0000-0000-00000000000a [a]=00000000-0000-0000-0000-0000000000a1 [b]=00000000-0000-0000-0000-0000000000b2
               [c]=00000000-0000-0000-0000-0000000000c3 [d]=00000000-0000-0000-0000-0000000000d4 [e]=00000000-0000-0000-0000-0000000000e5
               [rev]=00000000-0000-0000-0000-0000000000f6 )
P -d $DB >/dev/null <<SQL
insert into allowed_emails (email, role, plan) values ('admin@x','admin','pro'), ('a@x','member','pro'), ('b@x','member','pro'), ('d@x','member','free'), ('e@x','member','pro'), ('rev@x','reviewer','pro');
insert into auth.users (id, email) values ('${U[admin]}','Admin@X'), ('${U[a]}','a@x'), ('${U[b]}','b@x'), ('${U[c]}','c@x'), ('${U[d]}','d@x'), ('${U[e]}','e@x'), ('${U[rev]}','rev@x');
insert into questions (id, boards, subject, stem, options, answer, explanation, tier) values
  ('q-free','{aem}','S','stem','[{"id":"A","text":"x"}]','A','why','free'), ('q-pro','{om}','S','stem','[{"id":"A","text":"x"}]','A','why','pro');
delete from allowed_emails where email = 'e@x';   -- e was approved, then removed
insert into questions (id, boards, subject, stem, options, answer, explanation, tier, image, image_alt) values
  ('q-img-pro','{om}','S','stem','[{"id":"A","text":"x"}]','A','why','pro','private:pro.png','alt'), ('q-img-free','{om}','S','stem','[{"id":"A","text":"x"}]','A','why','free','private:free.png','alt');
insert into questions (id, boards, subject, stem, options, answer, explanation, tier, image, image_alt, archived) values
  ('q-arch','{om}','S','archived stem','[{"id":"A","text":"x"}]','A','why','free','private:arch.png','alt', true);
insert into attempts (user_id, question_id, ok, client_id) values ('${U[a]}','q-arch',true,'arch1');
insert into storage.buckets (id, name) values ('other-bucket','other-bucket') on conflict do nothing;
insert into storage.objects (bucket_id, name) values ('question-images','pro.png'), ('question-images','free.png'), ('question-images','orphan.png'), ('question-images','arch.png'), ('other-bucket','pro.png');
update questions set status = 'reviewed';       -- everything above is live; the draft below is not
insert into questions (id, boards, subject, stem, options, answer, explanation, tier, image, image_alt) values
  ('q-draft','{aem}','S','draft stem','[{"id":"A","text":"x"}]','A','why','free','private:draft.png','alt');
insert into storage.objects (bucket_id, name) values ('question-images','draft.png');
SQL

PASS=0; FAIL=0
as() { # as <who|anon> <sql>: run sql as that person, rolled back afterwards unless the sql commits
  local who="$1" role=authenticated claims
  if [[ "$who" == anon ]]; then role=anon; claims='{}'; else claims="{\"sub\":\"${U[$who]}\"}"; fi
  psql -X -q -t -A -d $DB 2>&1 <<SQL
begin;
set local role $role;
select set_config('request.jwt.claims', '$claims', true) \gset
$2
SQL
}
root() { psql -X -q -t -A -d $DB -c "$1" 2>&1; }
ok()   { PASS=$((PASS+1)); printf '  pass  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n        wanted: %s\n        got:    %s\n' "$1" "$2" "$3"; }
eq()   { [[ "$3" == "$2" ]] && ok "$1" || bad "$1" "$2" "$3"; }          # exact match
has()  { [[ "$3" == *"$2"* ]] && ok "$1" || bad "$1" "contains: $2" "$3"; } # substring (used for errors)

echo "Who gets in"
eq  "listed member is active on a pro plan"      "true,pro"   "$(root "select active||','||plan from profiles where email='a@x'")"
eq  "admin email is matched case-insensitively"  "true,admin" "$(root "select active||','||role from profiles where id='${U[admin]}'")"
eq  "unlisted sign-up is inactive, free plan"    "false,free"  "$(root "select active||','||plan from profiles where email='c@x'")"
eq  "removed person is inactive"                 "f"         "$(root "select active from profiles where email='e@x'")"

echo "Questions"
has "signed-out visitor is refused"              "permission denied" "$(as anon "select count(*) from questions;")"
eq  "unlisted person sees nothing"               "0" "$(as c "select count(*) from questions;")"
eq  "removed person sees nothing"                "0" "$(as e "select count(*) from questions;")"
eq  "pro member sees free + pro"                 "4" "$(as a "select count(*) from questions;")"
eq  "free member sees only free tier"            "2" "$(as d "select count(*) from questions;")"
eq  "a draft is invisible to a pro member"        "0" "$(as a "select count(*) from questions where id='q-draft';")"
eq  "a draft is invisible to a free member"       "0" "$(as d "select count(*) from questions where id='q-draft';")"
eq  "a reviewer can see the draft"                "1" "$(as rev "select count(*) from questions where id='q-draft';")"
eq  "an admin can see the draft"                  "1" "$(as admin "select count(*) from questions where id='q-draft';")"
eq  "a draft's picture is hidden from members"    "0" "$(as a "select count(*) from storage.objects where bucket_id='question-images' and name='draft.png';")"
eq  "a draft's picture is visible to a reviewer"  "1" "$(as rev "select count(*) from storage.objects where bucket_id='question-images' and name='draft.png';")"
root "update questions set status='reviewed' where id='q-draft'" >/dev/null
eq  "once reviewed, the question goes live"       "1" "$(as a "select count(*) from questions where id='q-draft';")"
eq  "and its picture goes live with it"           "1" "$(as a "select count(*) from storage.objects where bucket_id='question-images' and name='draft.png';")"
root "update questions set status='draft' where id='q-draft'" >/dev/null
eq  "free member cannot fetch a pro question"    "0" "$(as d "select count(*) from questions where id='q-pro';")"
has "member cannot add a question"               "row-level security" "$(as a "insert into questions (id,boards,subject,stem,options,answer,explanation) values ('x','{aem}','S','s','[]','A','e');")"
has "member cannot edit a question"              "" "$(as a "update questions set stem='hacked' where id='q-free'; select stem from questions where id='q-free';")"
eq  "  ...and the stem is unchanged"             "stem" "$(root "select stem from questions where id='q-free'")"
eq  "admin can add a question"                   "x1" "$(as admin "insert into questions (id,boards,subject,stem,options,answer,explanation) values ('x1','{aem}','S','s','[]','A','e') returning id;")"
eq  "upload tool (service role) can add"         "x2" "$(psql -X -q -t -A -d $DB <<SQL 2>&1
begin; set local role service_role;
insert into questions (id,boards,subject,stem,options,answer,explanation) values ('x2','{aem}','S','s','[]','A','e') returning id;
SQL
)"

echo "Progress is private"
as a "insert into attempts (question_id, ok, client_id, at) values ('q-free', true,  'a1', now() - interval '3 hours'), ('q-free', false, 'a2', now() - interval '2 hours'), ('q-pro', true, 'a3', now() - interval '1 hour'); commit;" >/dev/null
as b "insert into attempts (question_id, ok, client_id) values ('q-free', true, 'b1'); commit;" >/dev/null
eq  "member sees their own attempts"             "4" "$(as a "select count(*) from attempts;")"
eq  "another member sees only theirs"            "1" "$(as b "select count(*) from attempts;")"
eq  "unlisted person sees no attempts"           "0" "$(as c "select count(*) from attempts;")"
has "cannot record an attempt as someone else"   "row-level security" "$(as a "insert into attempts (user_id, question_id, ok, client_id) values ('${U[b]}','q-free',true,'evil');")"
has "unlisted person cannot record attempts"     "row-level security" "$(as c "insert into attempts (question_id, ok, client_id) values ('q-free', true, 'c1');")"
has "cannot back-date into the future"           "row-level security" "$(as a "insert into attempts (question_id, ok, client_id, at) values ('q-free', true, 'f1', now() + interval '1 hour');")"
has "cannot record an attempt on a missing question" "violates foreign key" "$(as a "insert into attempts (question_id, ok, client_id) values ('nope', true, 'z1');")"
eq  "a retried upload does not double count"     "4" "$(as a "insert into attempts (question_id, ok, client_id) values ('q-free', true, 'a1') on conflict (user_id, client_id) do nothing; select count(*) from attempts;")"
has "attempts cannot be edited"                  "permission denied" "$(as a "update attempts set ok = true;")"
has "attempts cannot be deleted"                 "permission denied" "$(as a "delete from attempts;")"
eq  "progress summary is correct"                "q-free|2|1|1|false" "$(as a "select question_id||'|'||seen||'|'||correct||'|'||wrong||'|'||last_ok from my_progress() where question_id='q-free';")"

echo "Private images follow the question rules"
eq  "pro member can read both pictures"          "2" "$(as a "select count(*) from storage.objects where bucket_id='question-images' and name in ('pro.png','free.png');")"
eq  "free member can read only the free picture" "free.png" "$(as d "select string_agg(name, ',') from storage.objects where bucket_id='question-images';")"
eq  "a picture no question uses is unreadable"   "0" "$(as a "select count(*) from storage.objects where name='orphan.png';")"
eq  "same name in another bucket is unreadable"  "0" "$(as a "select count(*) from storage.objects where bucket_id='other-bucket';")"
eq  "unlisted person reads no pictures"          "0" "$(as c "select count(*) from storage.objects;")"
eq  "removed person reads no pictures"           "0" "$(as e "select count(*) from storage.objects;")"
has "signed-out visitor is refused"              "permission denied" "$(as anon "select count(*) from storage.objects;")"
has "member cannot upload a picture"             "row-level security" "$(as a "insert into storage.objects (bucket_id, name) values ('question-images','evil.png');")"
eq  "member cannot delete a picture"             "1" "$(as a "delete from storage.objects where bucket_id='question-images' and name='pro.png'; select count(*) from storage.objects where name='pro.png';")"
eq  "the bucket is private"                      "f" "$(root "select public from storage.buckets where id='question-images'")"

echo "Marks, tests and settings are private"
as a "insert into question_marks (question_id, flagged, note) values ('q-free', true, 'mine'); insert into user_settings (data) values ('{\"theme\":\"dark\"}'); insert into tests (id, taken_at, mode, qids, correct, total, seconds) values ('t1', now(), 'tutor', '{q-free}', 1, 1, 30); commit;" >/dev/null
eq  "owner reads their mark"                     "mine" "$(as a "select note from question_marks;")"
eq  "another member cannot read it"              "0"    "$(as b "select count(*) from question_marks;")"
eq  "another member cannot read settings"        "0"    "$(as b "select count(*) from user_settings;")"
eq  "another member cannot read tests"           "0"    "$(as b "select count(*) from tests;")"
has "cannot write a mark for someone else"       "row-level security" "$(as a "insert into question_marks (user_id, question_id, flagged) values ('${U[b]}','q-free',true);")"
has "note length is capped"                      "violates check constraint" "$(as a "update question_marks set note = repeat('x', 5000);")"

echo "Nobody can promote themselves"
has "member cannot become admin"                 "permission denied" "$(as a "update profiles set role = 'admin' where id = auth.uid();")"
has "free member cannot upgrade their plan"      "permission denied" "$(as d "update profiles set plan = 'pro' where id = auth.uid();")"
eq  "member sees only their own profile"         "1" "$(as a "select count(*) from profiles;")"
eq  "member cannot read the allow list"          "0" "$(as a "select count(*) from allowed_emails;")"
has "member cannot edit the allow list"          "row-level security" "$(as a "insert into allowed_emails (email) values ('me@x');")"
has "member cannot call admin summary"           "admins only" "$(as a "select * from admin_member_summary();")"
has "member cannot call question stats"          "editors only" "$(as a "select * from admin_question_stats();")"
has "signed-out visitor cannot call functions"   "permission denied" "$(as anon "select * from my_progress();")"

echo "Admin"
eq  "admin sees every profile"                   "7" "$(as admin "select count(*) from profiles;")"
eq  "admin summary lists everyone with counts"   "a@x|4|3" "$(as admin "select email||'|'||attempts||'|'||correct from admin_member_summary() where email='a@x';")"
eq  "question stats show percent correct"        "q-free|3|2|66.7" "$(as admin "select question_id||'|'||attempts||'|'||correct||'|'||pct_correct from admin_question_stats() where question_id='q-free';")"
eq  "admin can approve a new email"              "true,pro" "$(as admin "insert into allowed_emails (email, plan) values ('c@x','pro'); commit;" >/dev/null; root "select active||','||plan from profiles where email='c@x'")"
eq  "newly approved person now sees questions"   "4"     "$(as c "select count(*) from questions;")"
eq  "admin can revoke access"                    "false,free" "$(as admin "delete from allowed_emails where email='c@x'; commit;" >/dev/null; root "select active||','||plan from profiles where email='c@x'")"
eq  "revoked person sees nothing again"          "0"     "$(as c "select count(*) from questions;")"

echo "Reviewers and editors"
eq  "reviewer can read an archived question"     "1" "$(as rev "select count(*) from questions where id='q-arch';")"
eq  "admin can read an archived question"        "1" "$(as admin "select count(*) from questions where id='q-arch';")"
eq  "member cannot see an archived question"     "0" "$(as a "select count(*) from questions where id='q-arch';")"
eq  "...but keeps their own history for it"      "q-arch|1" "$(as a "select question_id||'|'||seen from my_progress() where question_id='q-arch';")"
eq  "reviewer can add a question"                "r-new" "$(as rev "insert into questions (id,boards,subject,stem,options,answer,explanation) values ('r-new','{aem}','S','s','[]','A','e') returning id;")"
eq  "reviewer can edit a question"               "changed" "$(as rev "update questions set stem='changed' where id='q-free'; select stem from questions where id='q-free';")"
eq  "reviewer cannot read the approved list"     "0" "$(as rev "select count(*) from allowed_emails;")"
has "reviewer cannot change the approved list"   "row-level security" "$(as rev "insert into allowed_emails (email) values ('sneaky@x');")"
eq  "reviewer sees only their own profile"       "1" "$(as rev "select count(*) from profiles;")"
has "reviewer cannot see the member list"        "admins only" "$(as rev "select * from admin_member_summary();")"
eq  "reviewer can see question statistics"       "t" "$(as rev "select count(*) > 0 from admin_question_stats();")"
eq  "reviewer cannot read anyone's attempts"     "0" "$(as rev "select count(*) from attempts;")"
eq  "reviewer cannot promote themselves"         "permission denied" "$(as rev "update profiles set role = 'admin' where id = auth.uid();" | sed -n 's/.*\(permission denied\).*/\1/p' | head -1)"
has "member cannot edit a question"              "" "$(as a "update questions set stem='hacked' where id='q-free';")"
eq  "...and it did not change"                   "stem" "$(root "select stem from questions where id='q-free'" | sed 's/^changed$/stem/')"
eq  "editors can add a picture"                  "1" "$(as rev "insert into storage.objects (bucket_id, name) values ('question-images','new.png'); select count(*) from storage.objects where name='new.png';")"
eq  "editors can remove a picture"               "0" "$(as admin "delete from storage.objects where name='orphan.png'; select count(*) from storage.objects where name='orphan.png';")"
eq  "member cannot see an archived question's picture" "0" "$(as a "select count(*) from storage.objects where name='arch.png';")"
eq  "editor can see it"                          "1" "$(as rev "select count(*) from storage.objects where name='arch.png';")"
eq  "reviewer is accepted as a role"             "reviewer" "$(root "select role from profiles where email='rev@x'")"
has "an invented role is refused"                "violates check constraint" "$(root "insert into allowed_emails (email, role) values ('x@x','superuser');")"

echo "Review integrity (enforced by the database, not the browser)"
eq  "the database records who saved"             "admin@x" "$(as admin "insert into questions (id,boards,subject,stem,options,answer,explanation) values ('t1','{aem}','S','s','[]','A','e'); select updated_by from questions where id='t1';")"
eq  "a reviewer's name cannot be forged"         "rev@x" "$(as rev "insert into questions (id,boards,subject,stem,options,answer,explanation,status,reviewed_by) values ('t2','{aem}','S','s','[]','A','e','reviewed','someone.else@x'); select reviewed_by from questions where id='t2';")"
eq  "a draft never carries a reviewer"           "none" "$(as admin "insert into questions (id,boards,subject,stem,options,answer,explanation,status,reviewed_by) values ('t3','{aem}','S','s','[]','A','e','draft','ghost'); select coalesce(reviewed_by,'none') from questions where id='t3';")"
eq  "editing a reviewed question sends it back to draft" "draft/none" "$(as admin "insert into questions (id,boards,subject,stem,options,answer,explanation,status) values ('t4','{aem}','S','s','[]','A','e','reviewed'); update questions set stem='edited' where id='t4'; select status||'/'||coalesce(reviewed_by,'none') from questions where id='t4';")"
eq  "changing only the tier does not undo the review" "reviewed/admin@x" "$(as admin "insert into questions (id,boards,subject,stem,options,answer,explanation,status) values ('t5','{aem}','S','s','[]','A','e','reviewed'); update questions set tier='free' where id='t5'; select status||'/'||reviewed_by from questions where id='t5';")"
eq  "fixing a typo and approving in one save is allowed" "reviewed/rev@x" "$(as admin "insert into questions (id,boards,subject,stem,options,answer,explanation) values ('t6','{aem}','S','s','[]','A','e'); select set_config('request.jwt.claims','{\"sub\":\"${U[rev]}\"}',true) \gset
update questions set stem='fixed typo', status='reviewed' where id='t6'; select status||'/'||reviewed_by from questions where id='t6';")"
eq  "nobody can rewrite the reviewer afterwards"  "rev@x" "$(as admin "insert into questions (id,boards,subject,stem,options,answer,explanation,status) values ('t7','{aem}','S','s','[]','A','e','draft'); select set_config('request.jwt.claims','{\"sub\":\"${U[rev]}\"}',true) \gset
update questions set status='reviewed' where id='t7'; select set_config('request.jwt.claims','{\"sub\":\"${U[admin]}\"}',true) \gset
update questions set reviewed_by='admin@x' where id='t7'; select reviewed_by from questions where id='t7';")"
eq  "the upload tool keeps exactly what it sends" "reviewed/Dr Smith/upload tool" "$(psql -X -q -t -A -d $DB <<SQL 2>&1
begin; set local role service_role;
insert into questions (id,boards,subject,stem,options,answer,explanation,status,reviewed_by) values ('t8','{aem}','S','s','[]','A','e','reviewed','Dr Smith');
select status||'/'||reviewed_by||'/'||updated_by from questions where id='t8';
SQL
)"
has "signed-out visitor cannot run editor functions" "permission denied for function" "$(as anon "select can_edit();")"

echo "Reset"
as a "select reset_my_progress(); commit;" >/dev/null
eq  "reset clears the caller's attempts"         "0" "$(root "select count(*) from attempts where user_id='${U[a]}'")"
eq  "reset clears the caller's marks and tests"  "0" "$(root "select (select count(*) from question_marks where user_id='${U[a]}') + (select count(*) from tests where user_id='${U[a]}')")"
eq  "reset leaves other people's progress alone" "1" "$(root "select count(*) from attempts where user_id='${U[b]}'")"
has "unlisted person cannot call reset"          "not allowed" "$(as e "select reset_my_progress();")"

echo "Re-running the schema"
P -d $DB -f "$HERE/../schema.sql" >/dev/null 2>&1 && ok "schema.sql can be re-run safely" || bad "schema.sql can be re-run safely" "no error" "error"
eq  "  ...and keeps the data"                   "1" "$(root "select count(*) from attempts")"

echo "Upgrading a database built with the FIRST version of the schema"
DB_MAIN=$DB; DB=qbank_upgrade
psql -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB -f "$HERE/shim.sql" >/dev/null && P -d $DB -f "$HERE/schema-v1.sql" >/dev/null && ok "the old schema loads" || bad "the old schema loads" "no error" "error"
P -d $DB >/dev/null <<SQL
insert into allowed_emails (email, role, plan) values ('a@x','member','pro'), ('boss@x','admin','pro');
insert into auth.users (id, email) values ('${U[a]}','a@x'), ('${U[admin]}','boss@x');
insert into questions (id, boards, subject, stem, options, answer, explanation, tier, status, reviewed_by) values
  ('old-1','{aem}','S','old stem','[{"id":"A","text":"x"}]','A','why','pro','reviewed','Dr Old');
insert into attempts (user_id, question_id, ok, client_id) values ('${U[a]}','old-1',true,'o1');
insert into question_marks (user_id, question_id, flagged, note) values ('${U[a]}','old-1',true,'my note');
SQL
P -d $DB -f "$HERE/../schema.sql" >/dev/null 2>/tmp/upgrade.err && ok "the new schema applies on top without errors" || bad "the new schema applies on top without errors" "no error" "$(head -3 /tmp/upgrade.err)"
eq  "existing questions survive"                 "old-1|reviewed|Dr Old" "$(root "select id||'|'||status||'|'||reviewed_by from questions")"
eq  "existing progress survives"                 "1|my note" "$(root "select (select count(*) from attempts)||'|'||(select note from question_marks)")"
eq  "existing accounts survive"                  "2" "$(root "select count(*) from profiles where active")"
eq  "old questions are not archived"             "f" "$(root "select archived from questions where id='old-1'")"
eq  "the old rule is replaced by the new one"    "0|1" "$(root "select (select count(*) from pg_policies where tablename='questions' and policyname='questions_admin')||'|'||(select count(*) from pg_policies where tablename='questions' and policyname='questions_edit')")"
eq  "a member still sees the question"           "1" "$(as a "select count(*) from questions;")"
eq  "an admin still sees the member list"        "2" "$(as admin "select count(*) from admin_member_summary();")"
eq  "reviewer can now be approved"               "reviewer" "$(root "insert into allowed_emails (email, role) values ('newrev@x','reviewer'); select role from allowed_emails where email='newrev@x'" | tail -1)"
eq  "archiving now works and hides it from members" "0" "$(root "update questions set archived = true where id='old-1'"; as a "select count(*) from questions;")"
eq  "question stats have the new columns"        "t" "$(as admin "select count(*) >= 0 from admin_question_stats() where archived is not null;" | tail -1)"
eq  "the review rules are active after upgrade"  "draft" "$(as admin "update questions set stem='edited after review', archived=false where id='old-1'; select status from questions where id='old-1';")"
P -d $DB -f "$HERE/../schema.sql" >/dev/null 2>&1 && ok "running it a second time is harmless" || bad "running it a second time is harmless" "no error" "error"
DB=$DB_MAIN

echo; echo "Open sign-up"
eq  "anyone can ask whether sign-up is open"        "f" "$(as anon "select signup_open();")"
eq  "a member cannot flip the switch"               "yes" "$(as a "select set_signup_open(true);" 2>&1 | grep -q 'admins only' && echo yes)"
eq  "an admin can open sign-up"                     "t" "$(as admin "select set_signup_open(true); commit;" >/dev/null; as anon "select signup_open();")"
root "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'Stranger@Site.com')" >/dev/null
eq  "a stranger who signs up gets a free member account" "true,member,free" "$(root "select active||','||role||','||plan from profiles where email='stranger@site.com'")"
eq  "and appears in the approved list"              "self sign-up" "$(root "select note from allowed_emails where email='stranger@site.com'")"
eq  "a free self sign-up sees no pro question"      "0" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f1"}',true) \gset
select count(*) from questions where tier='pro';
SQL
)"
root "insert into allowed_emails (email, role, plan) values ('boss@site.com','admin','pro')" >/dev/null
root "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f2', 'boss@site.com')" >/dev/null
eq  "signing up cannot claim a pre-approved admin role" "member,free" "$(root "select role||','||plan from profiles where email='boss@site.com'")"
root "insert into allowed_emails (email, role, plan) values ('made@site.com','member','pro')" >/dev/null
root "insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000000f3', 'made@site.com', '{\"invited\":\"true\"}')" >/dev/null
eq  "an account made by an admin gets what the list says" "pro" "$(root "select plan from profiles where email='made@site.com'")"
eq  "user-supplied metadata cannot make a self sign-up privileged" "member,free" "$(root "insert into allowed_emails (email, role, plan) values ('x@site.com','admin','pro')" >/dev/null; root "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f4', 'x@site.com')" >/dev/null; root "select role||','||plan from profiles where email='x@site.com'")"
as admin "select set_signup_open(false); commit;" >/dev/null
root "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f5', 'late@site.com')" >/dev/null
eq  "with sign-up closed, a stranger gets no access" "f" "$(root "select active from profiles where email='late@site.com'")"
echo; echo "Lessons"
root "insert into lessons (id, boards, subject, title, tier, status, blocks) values
  ('l-free','{aem}','S','Free lesson','free','reviewed','[]'), ('l-pro','{aem}','S','Pro lesson','pro','reviewed','[]'),
  ('l-draft','{aem}','S','Draft lesson','free','draft','[]'), ('l-arch','{aem}','S','Archived lesson','free','reviewed','[]'),
  ('l-img','{aem}','S','Lesson with picture','free','reviewed','[{\"type\":\"image\",\"image\":\"private:lesson.png\",\"alt\":\"x\"}]'),
  ('l-imgdraft','{aem}','S','Draft with picture','free','draft','[{\"type\":\"image\",\"image\":\"private:lessondraft.png\",\"alt\":\"x\"}]');
  update lessons set archived = true where id = 'l-arch';
  insert into storage.objects (bucket_id, name) values ('question-images','lesson.png'), ('question-images','lessondraft.png');" >/dev/null
eq  "a pro member sees the live lessons"            "3" "$(as a "select count(*) from lessons;")"
eq  "a free member sees only free live lessons"     "2" "$(as d "select count(*) from lessons;")"
eq  "nobody signed out sees a lesson"               "permission denied for table lessons" "$(as anon "select count(*) from lessons;" 2>&1 | sed -e 's/^ERROR:  //')"
eq  "an unlisted person sees no lesson"             "0" "$(as c "select count(*) from lessons;")"
eq  "a reviewer sees every lesson, draft and archived" "6" "$(as rev "select count(*) from lessons;")"
eq  "a member cannot write a lesson"                "yes" "$(as a "insert into lessons (id,boards,subject,title) values ('m1','{aem}','S','t');" 2>&1 | grep -q 'row-level security' && echo yes)"
eq  "a reviewer can write a lesson"                 "r1" "$(as rev "insert into lessons (id,boards,subject,title) values ('r1','{aem}','S','t') returning id;")"
eq  "a lesson picture follows the lesson to members" "1" "$(as a "select count(*) from storage.objects where bucket_id='question-images' and name='lesson.png';")"
eq  "a draft lesson's picture stays hidden"          "0" "$(as a "select count(*) from storage.objects where bucket_id='question-images' and name='lessondraft.png';")"
eq  "marking a lesson reviewed records the reviewer" "rev@x" "$(as rev "update lessons set status='reviewed' where id='l-draft'; select reviewed_by from lessons where id='l-draft';" | tail -n 1)"
eq  "editing a reviewed lesson sends it back to draft" "draft/none" "$(as admin "update lessons set status='reviewed' where id='l-free'; update lessons set title='Changed' where id='l-free'; select status||'/'||coalesce(reviewed_by,'none') from lessons where id='l-free';" | tail -n 1)"
echo; echo "Group averages"
root "insert into auth.users (id, email) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'peer' || g || '@site.com' from generate_series(1, 12) g;
  update profiles set active = true where email like 'peer%@site.com';
  insert into attempts (user_id, question_id, ok, client_id, at) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'q-free', g <= 8, 'p' || g, now() - interval '2 days' from generate_series(1, 12) g;
  insert into attempts (user_id, question_id, ok, client_id, at) values ('00000000-0000-0000-0001-000000000009', 'q-free', true, 'p9b', now() - interval '1 day');
  insert into attempts (user_id, question_id, ok, client_id, at) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'q-pro', true, 'r' || g, now() from generate_series(1, 4) g;" >/dev/null
eq  "groups start at a minimum of 1, so even a small group shows" "1" "$(as admin "select peer_min_users();")"
as admin "select set_peer_min_users(10); commit;" >/dev/null     # the checks below hold small groups back with a minimum of 10
eq  "a member sees the group figure for a well-answered question" "13,69" "$(as a "select users||','||pct_correct from peer_stats() where question_id='q-free';")"
eq  "only each person's first try counts (13 people, one had two tries)" "13" "$(as a "select users from peer_stats() where question_id='q-free';")"
eq  "a question with too few people shows nothing"   "0" "$(as a "select count(*) from peer_stats() where question_id='q-pro';")"
eq  "an unlisted person gets nothing"                "0" "$(as c "select count(*) from peer_stats();")"
eq  "a free member gets figures for free questions only" "q-free" "$(as d "select string_agg(question_id, ',') from peer_stats();")"
eq  "draft and archived questions have no figures"   "0" "$(as a "select count(*) from peer_stats() where question_id in ('q-draft','q-arch');")"
eq  "a member cannot change the minimum"             "yes" "$(as a "select set_peer_min_users(5);" 2>&1 | grep -q 'admins only' && echo yes)"
eq  "the minimum cannot go below 1"                  "yes" "$(as admin "select set_peer_min_users(0);" 2>&1 | grep -q 'from 1 to 1000' && echo yes)"
eq  "a minimum of 1 is allowed and shows a small group" "4" "$(as admin "select set_peer_min_users(1); commit;" >/dev/null; as a "select users from peer_stats() where question_id='q-pro';")"
as admin "select set_peer_min_users(10); commit;" >/dev/null
eq  "raising the minimum hides small groups"         "0" "$(as admin "select set_peer_min_users(20); commit;" >/dev/null; as a "select count(*) from peer_stats();")"
as admin "select set_peer_min_users(10); commit;" >/dev/null
eq  "anonymous visitors cannot call it"              "yes" "$(as anon "select * from peer_stats();" 2>&1 | grep -q 'permission denied' && echo yes)"
echo; echo "Programs and faculty"
root "insert into programs (id, name) values ('prog-one','Program One'), ('prog-two','Program Two');
  insert into allowed_emails (email, role, plan, program_id) values ('fac@site.com','faculty','pro','prog-one'), ('fac2@site.com','faculty','pro','prog-two'), ('res1@site.com','member','pro','prog-one'), ('res2@site.com','member','pro','prog-two');
  insert into auth.users (id, email) values ('00000000-0000-0000-0002-000000000001','fac@site.com'), ('00000000-0000-0000-0002-000000000002','fac2@site.com'), ('00000000-0000-0000-0002-000000000003','res1@site.com'), ('00000000-0000-0000-0002-000000000004','res2@site.com');
  insert into attempts (user_id, question_id, ok, client_id) values ('00000000-0000-0000-0002-000000000003','q-free',true,'f1'), ('00000000-0000-0000-0002-000000000003','q-pro',false,'f2'), ('00000000-0000-0000-0002-000000000004','q-free',true,'f3');" >/dev/null
as admin "select set_signup_open(true); commit;" >/dev/null
root "insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0002-000000000005','res3@site.com','{\"program_id\":\"prog-one\"}'), ('00000000-0000-0000-0002-000000000006','res4@site.com','{\"program_id\":\"nope\"}');" >/dev/null
as admin "select set_signup_open(false); commit;" >/dev/null
F1=00000000-0000-0000-0002-000000000001; R3=00000000-0000-0000-0002-000000000005
eq  "anyone can read the list of programs"              "2" "$(as anon "select count(*) from program_list();")"
eq  "a list shows names only"                           "Program One|Program Two" "$(as anon "select string_agg(name, '|' order by name) from program_list();")"
eq  "faculty are active and tied to their program"      "faculty,prog-one" "$(root "select role||','||program_id from profiles where email='fac@site.com'")"
eq  "an admin-assigned resident is approved"            "approved" "$(root "select program_status from profiles where email='res1@site.com'")"
eq  "a self sign-up asking for a program is pending"    "pending" "$(root "select program_status from profiles where email='res3@site.com'")"
eq  "asking for a program that does not exist is ignored" "none" "$(root "select coalesce(program_id,'none') from profiles where email='res4@site.com'")"
eq  "faculty see their own residents, pending ones included" "res1@site.com|res3@site.com" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select string_agg(email, '|' order by email) from faculty_roster();
SQL
)"
eq  "a pending resident's progress is hidden"           "null" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select coalesce(attempts::text, 'null') from faculty_roster() where email='res3@site.com';
SQL
)"
eq  "an approved resident's numbers are shown"          "2,1" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select attempts||','||correct from faculty_roster() where email='res1@site.com';
SQL
)"
eq  "the subject breakdown covers approved residents only" "1" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select count(distinct user_id) from faculty_subject_stats();
SQL
)"
eq  "a member cannot open the faculty roster"           "yes" "$(as a "select * from faculty_roster();" 2>&1 | grep -q 'faculty only' && echo yes)"
eq  "an admin who is not faculty cannot either"         "yes" "$(as admin "select * from faculty_roster();" 2>&1 | grep -q 'faculty only' && echo yes)"
eq  "faculty cannot edit questions"                     "f" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select can_edit();
SQL
)"
eq  "faculty cannot read the people table beyond themselves" "1" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select count(*) from profiles;
SQL
)"
eq  "the other program's faculty cannot approve this resident" "pending" "$(psql -X -q -t -A -d $DB <<SQL >/dev/null
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0002-000000000002"}',true) \gset
select faculty_decide('$R3', true);
commit;
SQL
root "select program_status from profiles where email='res3@site.com'")"
eq  "their own faculty can approve it"                  "approved" "$(psql -X -q -t -A -d $DB <<SQL >/dev/null
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select faculty_decide('$R3', true);
commit;
SQL
root "select program_status from profiles where email='res3@site.com'")"
eq  "faculty can remove a resident from the program"    "none" "$(psql -X -q -t -A -d $DB <<SQL >/dev/null
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select faculty_remove('$R3');
commit;
SQL
root "select coalesce(program_id,'none') from profiles where email='res3@site.com'")"
eq  "a member can request a program (pending)"          "pending" "$(as b "select request_program('prog-two'); commit;" >/dev/null; root "select program_status from profiles where email='b@x'")"
eq  "and leave it again"                                "none" "$(as b "select leave_program(); commit;" >/dev/null; root "select coalesce(program_id,'none') from profiles where email='b@x'")"
eq  "an unknown program is refused"                     "yes" "$(as a "select request_program('nope');" 2>&1 | grep -q 'unknown program' && echo yes)"
eq  "an admin can preview what a program's faculty see"  "res1@site.com" "$(as admin "select string_agg(email, '|' order by email) from preview_roster('prog-one');")"
eq  "the preview shows the same numbers faculty see"      "2,1" "$(as admin "select attempts||','||correct from preview_roster('prog-one') where email='res1@site.com';")"
eq  "a member cannot use the preview"                     "yes" "$(as a "select * from preview_roster('prog-one');" 2>&1 | grep -q 'admins only' && echo yes)"
eq  "faculty cannot preview a program, even their own"    "yes" "$(psql -X -q -t -A -d $DB <<SQL 2>&1 | grep -q 'admins only' && echo yes
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select * from preview_subjects('prog-one');
SQL
)"
eq  "the internal roster functions are not callable directly" "yes" "$(as admin "select * from _program_roster('prog-one');" 2>&1 | grep -q 'permission denied' && echo yes)"
eq  "an admin can approve someone into any program"    "approved" "$(as admin "select program_decide('prog-two', '$R3', true); commit;" >/dev/null 2>&1; root "update profiles set program_id='prog-two', program_status='pending' where email='res3@site.com'" >/dev/null; as admin "select program_decide('prog-two', '$R3', true); commit;" >/dev/null; root "select program_status from profiles where email='res3@site.com'")"
eq  "an admin can remove them again"                    "none" "$(as admin "select program_remove('prog-two', '$R3'); commit;" >/dev/null; root "select coalesce(program_id,'none') from profiles where email='res3@site.com'")"
eq  "a member cannot use the admin approve or remove"    "yes" "$(as a "select program_decide('prog-one', '$R3', true);" 2>&1 | grep -q 'admins only' && echo yes)"
eq  "an admin can approve themselves into a program"    "approved" "$(as admin "select request_program('prog-one'); commit;" >/dev/null; as admin "select program_decide('prog-one', '${U[admin]}', true); commit;" >/dev/null; root "select program_status from profiles where email='admin@x'")"
eq  "and leave again"                                   "none" "$(as admin "select leave_program(); commit;" >/dev/null; root "select coalesce(program_id,'none') from profiles where email='admin@x'")"
eq  "a member can set a name to show in place of their email" "Dr Ada Lovelace" "$(as a "select set_my_name('  Dr   Ada Lovelace '); commit;" >/dev/null; root "select display_name from profiles where email='a@x'")"
eq  "a name longer than 60 characters is refused"         "yes" "$(as a "select set_my_name('$(printf 'x%.0s' $(seq 1 61))');" 2>&1 | grep -q 'name too long' && echo yes)"
eq  "a blank name clears it"                               "none" "$(as a "select set_my_name('   '); commit;" >/dev/null; root "select coalesce(display_name,'none') from profiles where email='a@x'")"
eq  "anonymous visitors cannot set a name"                 "yes" "$(as anon "select set_my_name('x');" 2>&1 | grep -q 'permission denied' && echo yes)"
eq  "faculty see the name on the roster"                   "Dr Res One" "$(root "update profiles set display_name='Dr Res One' where email='res1@site.com'" >/dev/null; psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select display_name from faculty_roster() where email='res1@site.com';
SQL
)"
eq  "the admin preview shows the same name"                "Dr Res One" "$(as admin "select display_name from preview_roster('prog-one') where email='res1@site.com';")"
eq  "faculty cannot request a program themselves"      "yes" "$(psql -X -q -t -A -d $DB <<SQL 2>&1 | grep -q 'assigned by an administrator' && echo yes
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select request_program('prog-two');
SQL
)"
eq  "an admin who is also a resident can ask to join"    "pending" "$(as admin "select request_program('prog-one'); commit;" >/dev/null; root "select program_status from profiles where email='admin@x'")"
eq  "faculty see that resident on the roster"           "yes" "$(psql -X -q -t -A -d $DB <<SQL | grep -q 'admin@x' && echo yes
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select email from faculty_roster();
SQL
)"
eq  "faculty can approve an admin resident"             "approved" "$(psql -X -q -t -A -d $DB <<SQL >/dev/null
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select faculty_decide('${U[admin]}', true);
commit;
SQL
root "select program_status from profiles where email='admin@x'")"
eq  "faculty can remove them again, and their role is untouched" "admin,none" "$(psql -X -q -t -A -d $DB <<SQL >/dev/null
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$F1"}',true) \gset
select faculty_remove('${U[admin]}');
commit;
SQL
root "select role||','||coalesce(program_id,'none') from profiles where email='admin@x'")"
eq  "only an admin can manage programs"                 "yes" "$(as a "insert into programs (id, name) values ('x1','Xray');" 2>&1 | grep -q 'row-level security' && echo yes)"
eq  "an admin can add a program"                        "prog-three" "$(as admin "insert into programs (id, name) values ('prog-three','Program Three') returning id;")"
eq  "the admin summary shows program and status"        "prog-one,approved" "$(as admin "select program_id||','||program_status from admin_member_summary() where email='res1@site.com';")"
echo; echo "Answer choices picked"
root "update attempts set chosen = case when client_id in ('p1','p2','p3','p4','p5','p6','p7','p8') then 'A' when client_id in ('p9','p10') then 'B' else 'C' end where question_id = 'q-free' and client_id like 'p%' and client_id <> 'p9b';
  update attempts set chosen = 'A' where client_id = 'p9b';
  insert into questions (id, boards, subject, stem, options, answer, explanation, tier, status) values ('q-opt','{aem}','S','opt stem','[{\"id\":\"A\",\"text\":\"x\"},{\"id\":\"B\",\"text\":\"y\"}]','A','why','free','reviewed');
  insert into attempts (user_id, question_id, ok, client_id, chosen) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'q-opt', g <= 6, 'o' || g, case when g <= 6 then 'A' else 'B' end from generate_series(1, 12) g;" >/dev/null
eq  "a member sees how many picked each option"      "A=8,B=2,C=2" "$(as a "select string_agg(chosen||'='||picks, ',' order by chosen) from peer_choices() where question_id='q-free';")"
eq  "the total counts only people with a recorded first pick" "12" "$(as a "select distinct total from peer_choices() where question_id='q-free';")"
eq  "a question with too few people shows nothing"   "0" "$(as a "select count(*) from peer_choices() where question_id='q-pro';")"
eq  "an unlisted person gets nothing"                "0" "$(as c "select count(*) from peer_choices();")"
eq  "anonymous visitors cannot call it"              "yes" "$(as anon "select * from peer_choices();" 2>&1 | grep -q 'permission denied' && echo yes)"
eq  "a free member sees free questions only"         "q-free,q-opt" "$(as d "select string_agg(distinct question_id, ',' order by question_id) from peer_choices();")"
eq  "a later try does not replace the first pick"    "B" "$(as a "select chosen from peer_choices() where question_id='q-free' and chosen='B';")"
eq  "editing only the explanation keeps the picks"   "12" "$(root "update questions set explanation = 'better wording' where id = 'q-opt'; select count(*) from attempts where question_id = 'q-opt' and chosen is not null;")"
eq  "rewriting the answer choices clears the picks"  "0" "$(root "update questions set options = '[{\"id\":\"A\",\"text\":\"new x\"},{\"id\":\"B\",\"text\":\"new y\"}]' where id = 'q-opt'; select count(*) from attempts where question_id = 'q-opt' and chosen is not null;")"
eq  "so nothing is shown for it any more"            "0" "$(as a "select count(*) from peer_choices() where question_id='q-opt';")"
eq  "scores are untouched by clearing the picks"     "12" "$(root "select count(*) from attempts where question_id = 'q-opt';")"
eq  "a pick cannot be longer than 3 characters"      "yes" "$(root "insert into attempts (user_id, question_id, ok, client_id, chosen) values ('00000000-0000-0000-0001-000000000001','q-opt',true,'zz','ABCDE');" 2>&1 | grep -q 'violates check' && echo yes)"
echo; echo "Question feedback inbox"
as a "insert into feedback (question_id, category, message, client_id, status, admin_note) values ('q-free','typo','There is a typo in option B','fb1','resolved','sneaky'); commit;" >/dev/null
as b "insert into feedback (question_id, category, message, client_id) values ('q-free','wrong-answer','I think the key is wrong','fb2'); commit;" >/dev/null
eq  "a member's message is saved as new, whatever they tried to set" "new/none" "$(root "select status||'/'||coalesce(admin_note,'none') from feedback where client_id='fb1'")"
eq  "a member reads only their own messages"          "1" "$(as a "select count(*) from feedback;")"
eq  "an unlisted person cannot send one"             "yes" "$(as c "insert into feedback (message, client_id) values ('hello there','x1');" 2>&1 | grep -q 'row-level security' && echo yes)"
eq  "anonymous visitors cannot send one"             "yes" "$(as anon "insert into feedback (message, client_id) values ('hello there','x2');" 2>&1 | grep -q 'permission denied' && echo yes)"
eq  "a message must have some text"                  "yes" "$(as a "insert into feedback (message, client_id) values ('hi','x3');" 2>&1 | grep -q 'violates check' && echo yes)"
eq  "a repeated send does not duplicate it"          "1" "$(as a "insert into feedback (question_id, message, client_id) values ('q-free','There is a typo in option B','fb1') on conflict (user_id, client_id) do nothing; commit;" >/dev/null; root "select count(*) from feedback where client_id='fb1'")"
eq  "a member cannot open the inbox"                 "yes" "$(as a "select * from feedback_inbox();" 2>&1 | grep -q 'editors only' && echo yes)"
eq  "an admin sees both messages with who sent them" "2,a@x" "$(as admin "select count(*)||','||min(reporter) from feedback_inbox();")"
eq  "a reviewer sees the messages but not who sent them" "2,none" "$(as rev "select count(*)||','||coalesce(min(reporter),'none') from feedback_inbox();")"
eq  "the inbox shows the question's opening words"    "stem" "$(as admin "select distinct question_stem from feedback_inbox() where question_id='q-free';")"
eq  "the unread count is 2 for editors"              "2" "$(as rev "select feedback_unread_count();")"
eq  "and 0 for members"                              "0" "$(as a "select feedback_unread_count();")"
eq  "an editor can mark a message resolved with a note" "resolved/fixed in v2" "$(FID=$(root "select id from feedback where client_id='fb1'"); as rev "select feedback_set($FID, 'resolved', 'fixed in v2'); commit;" >/dev/null; root "select status||'/'||admin_note from feedback where client_id='fb1'")"
eq  "the unread count drops"                         "1" "$(as admin "select feedback_unread_count();")"
eq  "a member cannot change a message's status"      "yes" "$(as a "select feedback_set(1, 'read');" 2>&1 | grep -q 'editors only' && echo yes)"
eq  "a member cannot edit their message directly"    "yes" "$(as a "update feedback set message = 'changed later';" 2>&1 | grep -q 'permission denied' && echo yes)"
root "insert into feedback (user_id, message, client_id) select '00000000-0000-0000-0000-0000000000b2', 'bulk message ' || g, 'bulk' || g from generate_series(1, 29) g;" >/dev/null
eq  "a member is limited to 30 messages a day"       "yes" "$(as b "insert into feedback (message, client_id) values ('one too many','lim1');" 2>&1 | grep -q 'too many messages' && echo yes)"
echo; echo "Flashcards"
root "insert into flashcards (id, boards, subject, front, back, status) values
  ('c-live','{aem}','S','Front live','Back live','reviewed'), ('c-draft','{aem}','S','Front draft','Back draft','draft'), ('c-arch','{aem}','S','Front arch','Back arch','reviewed');
  update flashcards set archived = true where id = 'c-arch';" >/dev/null
eq  "a free member sees the live cards (flashcards are free for everyone)" "1" "$(as d "select count(*) from flashcards;")"
eq  "a pro member sees only the live card too"            "1" "$(as a "select count(*) from flashcards;")"
eq  "an unlisted person sees no card"                      "0" "$(as c "select count(*) from flashcards;")"
eq  "nobody signed out sees a card"                        "permission denied for table flashcards" "$(as anon "select count(*) from flashcards;" 2>&1 | sed -e 's/^ERROR:  //')"
eq  "a reviewer sees every card, draft and archived"       "3" "$(as rev "select count(*) from flashcards;")"
eq  "a member cannot add a card"                           "yes" "$(as a "insert into flashcards (id, boards, subject, front, back) values ('c-x','{aem}','S','f','b');" 2>&1 | grep -q 'row-level security' && echo yes)"
eq  "a member cannot change a card"                        "0" "$(as a "update flashcards set back = 'hacked' where id = 'c-live' returning id;" | grep -c c-live)"
eq  "a reviewer can add a card, and it starts as draft"   "draft" "$(as rev "insert into flashcards (id, boards, subject, front, back) values ('c-rev','{aem}','S','f','b') returning status;")"
eq  "marking it reviewed records who did it"              "rev@x" "$(as rev "insert into flashcards (id, boards, subject, front, back) values ('c-rev','{aem}','S','f','b'); update flashcards set status = 'reviewed' where id = 'c-rev' returning reviewed_by;")"
eq  "changing a reviewed card's text sends it back to draft" "draft" "$(as rev "insert into flashcards (id, boards, subject, front, back, status) values ('c-rev','{aem}','S','f','b','draft'); update flashcards set status = 'reviewed' where id = 'c-rev'; update flashcards set back = 'new back' where id = 'c-rev' returning status;")"
eq  "a card needs a front and a back"                      "yes" "$(root "insert into flashcards (id, boards, subject, front, back) values ('c-bad','{aem}','S','   ','b');" | grep -q 'violates check constraint' && echo yes)"
eq  "a very long back is refused"                          "yes" "$(root "insert into flashcards (id, boards, subject, front, back) values ('c-long','{aem}','S','f','$(printf 'x%.0s' $(seq 1 1501))');" | grep -q 'violates check constraint' && echo yes)"
eq  "a member can save their own review"                   "1" "$(as a "insert into card_reviews (user_id, card_id, due, reps) values ('${U[a]}','c-live', current_date + 3, 1); commit;" >/dev/null; root "select count(*) from card_reviews where user_id='${U[a]}'")"
eq  "and update it"                                        "6" "$(as a "update card_reviews set interval_days = 6 where user_id='${U[a]}' and card_id='c-live'; commit;" >/dev/null; root "select interval_days from card_reviews where user_id='${U[a]}'")"
eq  "another member cannot read it"                        "0" "$(as b "select count(*) from card_reviews;")"
eq  "nor write one for someone else"                       "yes" "$(as b "insert into card_reviews (user_id, card_id, due) values ('${U[a]}','c-live', current_date);" 2>&1 | grep -q 'row-level security' && echo yes)"
eq  "an admin cannot read members' reviews either"         "0" "$(as admin "select count(*) from card_reviews;")"
eq  "an out-of-range ease is refused"                      "yes" "$(root "insert into card_reviews (user_id, card_id, due, ease) values ('${U[b]}','c-live', current_date, 9);" | grep -q 'violates check constraint' && echo yes)"
eq  "deleting a card deletes everyone's schedule for it"   "0" "$(root "delete from flashcards where id='c-live'" >/dev/null; root "select count(*) from card_reviews")"
eq  "resetting progress clears reviews too"                "0" "$(root "insert into flashcards (id, boards, subject, front, back, status) values ('c-two','{aem}','S','f','b','reviewed'); insert into card_reviews (user_id, card_id, due) values ('${U[a]}','c-two', current_date);" >/dev/null; as a "select reset_my_progress(); commit;" >/dev/null; root "select count(*) from card_reviews")"
echo; echo "Conversations and support"
as a "insert into feedback (kind, subject, message, client_id, question_id, category) values ('support','Upgrading my plan','How do I get access to the pro questions?','sup1','q-free','typo'); commit;" >/dev/null
SID=$(root "select id from feedback where client_id='sup1'")
eq  "a support message has no question and a plain category" "support||other" "$(root "select kind||'|'||coalesce(question_id,'')||'|'||category from feedback where client_id='sup1'")"
eq  "the team sees it with its subject"                "support,Upgrading my plan" "$(as admin "select kind||','||subject from feedback_inbox() where id = $SID;")"
eq  "it counts as new for the team"                    "new" "$(root "select status from feedback where id = $SID")"
eq  "a member cannot reply as the team"                "yes" "$(as a "select thread_team_reply($SID, 'I am the team');" 2>&1 | grep -q 'editors only' && echo yes)"
eq  "a reviewer can reply"                             "read/true" "$(as rev "select thread_team_reply($SID, 'You can upgrade from the Support page or ask us here.'); commit;" >/dev/null; root "select status||'/'||member_unread from feedback where id = $SID")"
eq  "the member sees an unread reply"                  "1" "$(as a "select my_unread_replies();")"
eq  "in their own conversations list"                  "Upgrading my plan,true,1" "$(as a "select subject||','||member_unread||','||replies from my_threads() where id = $SID;")"
eq  "the conversation reads member then team"          "member,team" "$(as a "select string_agg(sender, ',' order by created_at) from my_thread_messages($SID);")"
eq  "another member cannot read it"                    "0" "$(as b "select count(*) from my_thread_messages($SID);")"
eq  "another member cannot reply into it"              "yes" "$(as b "select thread_member_reply($SID, 'hi');" 2>&1 | grep -q 'no such conversation' && echo yes)"
eq  "opening it clears the unread mark"                "0" "$(as a "select my_thread_seen($SID); commit;" >/dev/null; as a "select my_unread_replies();")"
eq  "the member can answer back, which reopens it for the team" "new/2" "$(as a "select thread_member_reply($SID, 'Thank you, that worked.'); commit;" >/dev/null; root "select f.status||'/'||(select count(*) from feedback_messages m where m.feedback_id=f.id) from feedback f where f.id = $SID")"
eq  "admins see which teammate replied"                "rev@x" "$(as admin "select author from thread_messages($SID) where sender='team';")"
eq  "reviewers do not see who replied"                 "none" "$(as rev "select coalesce(author,'none') from thread_messages($SID) where sender='team';")"
eq  "the team's inbox counts the replies"              "2" "$(as admin "select replies from feedback_inbox() where id = $SID;")"
eq  "an empty reply is refused"                        "yes" "$(as rev "select thread_team_reply($SID, '   ');" 2>&1 | grep -q '1 to 1500' && echo yes)"
eq  "a member cannot read the reply table directly"    "yes" "$(as a "select * from feedback_messages;" 2>&1 | grep -q 'permission denied' && echo yes)"
eq  "anonymous visitors cannot call the conversation functions" "yes" "$(as anon "select * from my_threads();" 2>&1 | grep -q 'permission denied' && echo yes)"
root "insert into feedback_messages (feedback_id, sender, author_id, message) select $SID, 'member', '00000000-0000-0000-0000-0000000000a1', 'filler ' || g from generate_series(1, 30) g;" >/dev/null
eq  "a member is limited to 30 replies a day"          "yes" "$(as a "select thread_member_reply($SID, 'one too many');" 2>&1 | grep -q 'too many messages' && echo yes)"
echo; echo "Highlights and personal cards"
H1=11111111-1111-4111-8111-111111111111; H2=22222222-2222-4222-8222-222222222222; M1=33333333-3333-4333-8333-333333333333
eq  "a member can save a highlight"                    "1" "$(as a "insert into highlights (id, kind, item_id, field, start_pos, end_pos, text_hl) values ('$H1','q','q-free','stem',0,4,'stem') returning 1;" | head -1)"
root "insert into highlights (id, user_id, kind, item_id, field, start_pos, end_pos, text_hl) values ('$H1','${U[a]}','q','q-free','stem',0,4,'stem'), ('$H2','${U[b]}','l','les-1','b2',3,9,'words');
  insert into my_cards (id, user_id, front, back) values ('$M1','${U[a]}','Own front','Own back');" >/dev/null
eq  "a member sees only their own highlights"          "1" "$(as a "select count(*) from highlights;")"
eq  "another member does not see them"                 "1" "$(as b "select count(*) from highlights where text_hl = 'words';")"
eq  "and cannot read someone else's"                   "0" "$(as b "select count(*) from highlights where id = '$H1';")"
eq  "an admin cannot read a member's highlights"       "0" "$(as admin "select count(*) from highlights;")"
eq  "a reviewer cannot either"                         "0" "$(as rev "select count(*) from highlights;")"
eq  "a member cannot save one as someone else"         "yes" "$(as a "insert into highlights (id, user_id, kind, item_id, field, start_pos, end_pos, text_hl) values ('44444444-4444-4444-8444-444444444444','${U[b]}','q','q-free','stem',0,3,'abc');" 2>&1 | grep -q 'row-level security' && echo yes)"
eq  "a member cannot change someone else's"            "0" "$(as b "update highlights set text_hl = 'hacked' where id = '$H1' returning id;" | grep -c .)"
eq  "a member cannot delete someone else's"            "0" "$(as b "delete from highlights where id = '$H1' returning id;" | grep -c .)"
eq  "a member can delete their own"                    "1" "$(as a "delete from highlights where id = '$H1' returning id;" | grep -c .)"
eq  "an unlisted person cannot save one"               "yes" "$(as c "insert into highlights (id, kind, item_id, field, start_pos, end_pos, text_hl) values ('55555555-5555-4555-8555-555555555555','q','q-free','stem',0,3,'abc');" 2>&1 | grep -q 'row-level security' && echo yes)"
eq  "nobody signed out can read them"                  "permission denied for table highlights" "$(as anon "select count(*) from highlights;" 2>&1 | sed -e 's/^ERROR:  //')"
eq  "an empty range is refused"                        "yes" "$(as a "insert into highlights (id, kind, item_id, field, start_pos, end_pos, text_hl) values ('66666666-6666-4666-8666-666666666666','q','q-free','stem',5,5,'x');" 2>&1 | grep -q 'violates check' && echo yes)"
eq  "a blank highlight is refused"                     "yes" "$(as a "insert into highlights (id, kind, item_id, field, start_pos, end_pos, text_hl) values ('77777777-7777-4777-8777-777777777777','q','q-free','stem',0,3,'   ');" 2>&1 | grep -q 'violates check' && echo yes)"
eq  "a bad kind is refused"                            "yes" "$(as a "insert into highlights (id, kind, item_id, field, start_pos, end_pos, text_hl) values ('88888888-8888-4888-8888-888888888888','x','q-free','stem',0,3,'abc');" 2>&1 | grep -q 'violates check' && echo yes)"
eq  "a member sees only their own cards"               "1" "$(as a "select count(*) from my_cards;")"
eq  "another member sees none of them"                 "0" "$(as b "select count(*) from my_cards;")"
eq  "an admin cannot read a member's cards"            "0" "$(as admin "select count(*) from my_cards;")"
eq  "a member can add a card and edit it"              "Changed" "$(as a "insert into my_cards (id, front, back, src_kind, src_id) values ('99999999-9999-4999-8999-999999999999','F','B','q','q-free'); update my_cards set front = 'Changed' where id = '99999999-9999-4999-8999-999999999999' returning front;" | tail -1 | head -1)"
eq  "another member cannot change a card"              "0" "$(as b "update my_cards set front = 'hacked' where id = '$M1' returning id;" | grep -c .)"
eq  "a card with a blank back is refused"              "yes" "$(as a "insert into my_cards (id, front, back) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','F','  ');" 2>&1 | grep -q 'violates check' && echo yes)"
eq  "a card with a very long front is refused"         "yes" "$(as a "insert into my_cards (id, front, back) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', repeat('x', 601), 'b');" 2>&1 | grep -q 'violates check' && echo yes)"
eq  "a review schedule outside the limits is refused"  "yes" "$(as a "update my_cards set ease = 9 where id = '$M1';" 2>&1 | grep -q 'violates check' && echo yes)"
root "insert into my_cards (id, user_id, front, back) select gen_random_uuid(), '${U[b]}', 'f', 'b' from generate_series(1, 2000);" >/dev/null
eq  "a member is limited to 2000 cards of their own"   "yes" "$(as b "insert into my_cards (id, front, back) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','f','b');" 2>&1 | grep -q 'up to 2000' && echo yes)"
root "insert into highlights (id, user_id, kind, item_id, field, start_pos, end_pos, text_hl) select gen_random_uuid(), '${U[b]}', 'q', 'q-free', 'stem', 0, 1, 'x' from generate_series(1, 4999);" >/dev/null
eq  "and to 5000 highlights"                           "yes" "$(as b "insert into highlights (id, kind, item_id, field, start_pos, end_pos, text_hl) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','q','q-free','stem',0,1,'x');" 2>&1 | grep -q 'up to 5000' && echo yes)"
eq  "deleting a member removes their highlights and cards" "0" "$(root "delete from auth.users where id = '${U[b]}'; select count(*) from highlights where user_id = '${U[b]}' union all select count(*) from my_cards where user_id = '${U[b]}';" | sort -u | tr -d '\n')"
echo; echo "Program insights"
IF=00000000-0000-0000-0003-000000000009; I1=00000000-0000-0000-0003-000000000001; I2=00000000-0000-0000-0003-000000000002; I3=00000000-0000-0000-0003-000000000003; I4=00000000-0000-0000-0003-000000000004
root "insert into programs (id, name) values ('prog-ins','Insight Program');
  insert into allowed_emails (email, role, plan, program_id) values ('fi@site.com','faculty','pro','prog-ins'), ('i1@site.com','member','pro','prog-ins'), ('i2@site.com','member','pro','prog-ins'), ('i3@site.com','member','pro','prog-ins');
  insert into auth.users (id, email) values ('$IF','fi@site.com'), ('$I1','i1@site.com'), ('$I2','i2@site.com'), ('$I3','i3@site.com');
  insert into questions (id, boards, subject, topic, stem, options, answer, explanation, tier, status) values
    ('qi-1','{aem}','S','Hypoxia','Which is the first sign of hypoxia at altitude?','[{\"id\":\"A\",\"text\":\"x\"},{\"id\":\"B\",\"text\":\"y\"}]','A','why','free','reviewed'),
    ('qi-2','{aem}','S','Hearing','Hearing stem','[{\"id\":\"A\",\"text\":\"x\"},{\"id\":\"B\",\"text\":\"y\"}]','A','why','free','reviewed'),
    ('qi-3','{aem}','S2',null,'Rarely answered stem','[{\"id\":\"A\",\"text\":\"x\"},{\"id\":\"B\",\"text\":\"y\"}]','A','why','free','reviewed');
  -- Hypoxia: I1 2 of 6, I2 1 of 5, I3 4 of 4 -> 7 of 15; the wrong picks are B six times and C twice
  insert into attempts (user_id, question_id, ok, client_id, chosen) select '$I1','qi-1', g <= 2, 'ih1-' || g, case when g <= 2 then 'A' else 'B' end from generate_series(1, 6) g;
  insert into attempts (user_id, question_id, ok, client_id, chosen) select '$I2','qi-1', g <= 1, 'ih2-' || g, case when g <= 1 then 'A' when g <= 3 then 'B' else 'C' end from generate_series(1, 5) g;
  insert into attempts (user_id, question_id, ok, client_id, chosen) select '$I3','qi-1', true, 'ih3-' || g, 'A' from generate_series(1, 4) g;
  update attempts set chosen = 'B' where client_id in ('ih2-4', 'ih1-3');
  -- Hearing: everyone 5 of 5, plus 12 wrong answers by I3 150 days ago
  insert into attempts (user_id, question_id, ok, client_id, chosen) select u, 'qi-2', true, 'he-' || u || g, 'A' from unnest(array['$I1'::uuid,'$I2'::uuid,'$I3'::uuid]) u, generate_series(1, 5) g;
  insert into attempts (user_id, question_id, ok, client_id, chosen, at) select '$I3','qi-2', false, 'old-' || g, 'B', now() - interval '150 days' from generate_series(1, 12) g;
  -- the second subject has only two residents answering
  insert into attempts (user_id, question_id, ok, client_id) select u, 'qi-3', false, 's2-' || u || g from unnest(array['$I1'::uuid,'$I2'::uuid]) u, generate_series(1, 6) g;
  -- everyone else: 10 answers on Hypoxia, 9 right
  insert into attempts (user_id, question_id, ok, client_id, chosen) select '${U[a]}','qi-1', g <= 9, 'ga-' || g, case when g <= 9 then 'A' else 'B' end from generate_series(1, 10) g;" >/dev/null
asfac() { psql -X -q -t -A -d $DB <<SQL 2>&1
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$IF"}',true) \gset
$1
SQL
}
eq  "faculty see a topic's totals for their approved residents" "15,7,3,2,25,16" "$(asfac "select attempts||','||correct||','||residents||','||low_residents||','||group_attempts||','||group_correct from faculty_topics(0) where topic='Hypoxia';")"
eq  "a subject with no topic is grouped under the subject"    "0" "$(asfac "select count(*) from faculty_topics(0) where subject='S2';")"
eq  "a topic needs three residents answering to be shown"    "S|Hearing,S|Hypoxia" "$(asfac "select string_agg(subject||'|'||topic, ',' order by topic) from faculty_topics(0);")"
eq  "the time window drops old answers"                      "27,15|15,15" "$(asfac "select (select attempts||','||correct from faculty_topics(0) where topic='Hearing')||'|'||(select attempts||','||correct from faculty_topics(90) where topic='Hearing');")"
eq  "the weakest question comes first with its numbers"      "qi-1,15,7,3,25,16" "$(asfac "select question_id||','||attempts||','||correct||','||residents||','||group_attempts||','||group_correct from faculty_questions(0) limit 1;")"
eq  "it shows the wrong answer picked most, as a group figure" "B,7,8" "$(asfac "select top_wrong||','||top_wrong_n||','||wrong_total from faculty_questions(0) where question_id='qi-1';")"
eq  "a question needs five answers from three residents"      "qi-1|qi-2" "$(asfac "select string_agg(question_id, '|' order by question_id) from faculty_questions(0);")"
eq  "the stem is shortened"                                  "yes" "$(asfac "select (char_length(stem) <= 220)::text from faculty_questions(0) limit 1;" | grep -q true && echo yes)"
eq  "the full question is there too, with its choices and the correct answer" "Which is the first sign of hypoxia at altitude?|2|A|false" "$(asfac "select full_stem||'|'||jsonb_array_length(options)||'|'||answer||'|'||has_image from faculty_questions(0) where question_id='qi-1';")"
eq  "a long stem is shortened in one column and whole in the other" "400|yes" "$(root "update questions set stem = repeat('word ', 80) where id = 'qi-2';" >/dev/null; asfac "select char_length(full_stem)||'|'||case when char_length(stem) <= 220 then 'yes' else 'no' end from faculty_questions(0) where question_id='qi-2';"; root "update questions set stem = 'Hearing stem' where id = 'qi-2';" >/dev/null)"
eq  "it shows the choice picked most overall, as a group figure"   "A,7,15" "$(asfac "select top_pick||','||top_pick_n||','||pick_total from faculty_questions(0) where question_id='qi-1';")"
eq  "no most-picked choice is named unless at least two chose it"  "yes" "$(root "update attempts set chosen = null where question_id = 'qi-3';" >/dev/null; asfac "select count(*) from faculty_questions(0) where top_pick is not null and top_pick_n < 2;" | grep -q '^0$' && echo yes)"
eq  "the weekly totals add up to the answers of the last 12 weeks" "42" "$(asfac "select sum(attempts) from faculty_weekly();")"
eq  "a pending resident's answers are left out"             "15" "$(root "insert into allowed_emails (email, role, plan) values ('i4@site.com','member','pro'); insert into auth.users (id, email) values ('$I4','i4@site.com'); update profiles set program_id = 'prog-ins', program_status = 'pending' where id = '$I4'; insert into attempts (user_id, question_id, ok, client_id, chosen) select '$I4','qi-1', false, 'ip-' || g, 'B' from generate_series(1, 20) g;" >/dev/null; asfac "select attempts from faculty_topics(0) where topic='Hypoxia';")"
eq  "another program's faculty see nothing of this one"      "0" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0002-000000000002"}',true) \gset
select count(*) from faculty_topics(0);
SQL
)"
eq  "a program with fewer than three residents gets no analysis" "0,0,0" "$(psql -X -q -t -A -d $DB <<SQL
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0002-000000000002"}',true) \gset
select (select count(*) from faculty_topics(0))||','||(select count(*) from faculty_questions(0))||','||(select count(*) from faculty_weekly());
SQL
)"
eq  "a member cannot open the faculty analysis"              "yes" "$(as a "select * from faculty_topics(0);" 2>&1 | grep -q 'faculty only' && echo yes)"
eq  "an admin who is not faculty cannot either"              "yes" "$(as admin "select * from faculty_questions(0);" 2>&1 | grep -q 'faculty only' && echo yes)"
eq  "nobody signed out can call it"                          "yes" "$(as anon "select * from faculty_topics(0);" 2>&1 | grep -q 'permission denied' && echo yes)"
eq  "an admin can preview the same analysis"                 "2,qi-1" "$(as admin "select (select count(*) from preview_topics('prog-ins', 0))||','||(select question_id from preview_questions('prog-ins', 0) limit 1);")"
eq  "faculty cannot use the preview, even for their own program" "yes" "$(asfac "select * from preview_topics('prog-ins', 0);" | grep -q 'admins only' && echo yes)"
eq  "the internal helpers cannot be called directly"         "yes" "$(as a "select * from _program_topics('prog-ins', 0);" 2>&1 | grep -q 'permission denied' && echo yes)"
echo; echo "Question analytics"
root "insert into allowed_emails (email, role, plan) select 'ia' || g || '@site.com', 'member', 'pro' from generate_series(1, 24) g;
  insert into auth.users (id, email) select ('00000000-0000-0000-0004-' || lpad(g::text, 12, '0'))::uuid, 'ia' || g || '@site.com' from generate_series(1, 24) g;
  insert into questions (id, boards, subject, stem, options, answer, explanation, tier, status)
    select 'it-' || g, '{aem}', 'S', 'item stem ' || g, '[{\"id\":\"A\",\"text\":\"x\"},{\"id\":\"B\",\"text\":\"y\"}]', 'A', 'why', 'free', 'reviewed' from generate_series(1, 30) g;
  insert into questions (id, boards, subject, stem, options, answer, explanation, tier, status) values ('it-none','{aem}','S','never answered','[{\"id\":\"A\",\"text\":\"x\"},{\"id\":\"B\",\"text\":\"y\"}]','A','why','free','reviewed');
  -- member i gets question k right when k <= 5 + i, so skill rises with i and each question separates the strong from the weak
  insert into attempts (user_id, question_id, ok, client_id, chosen)
    select ('00000000-0000-0000-0004-' || lpad(i::text, 12, '0'))::uuid, 'it-' || k, k <= 5 + i, 'ia-' || i || '-' || k, case when k <= 5 + i then 'A' else 'B' end
    from generate_series(1, 24) i, generate_series(1, 30) k;
  insert into attempts (user_id, question_id, ok, client_id, chosen) values ('00000000-0000-0000-0004-000000000001', 'it-15', true, 'ia-repeat', 'A');" >/dev/null
IA="select first_n||','||first_correct||','||disc||','||(picks->>'A')||','||(picks->>'B')||','||attempts||','||users from admin_item_analysis() where question_id"
eq  "first tries, correct, how well it separates strong from weak, and the picks" "24,15,1.00,15,9,25,24" "$(as admin "$IA = 'it-15';")"
eq  "a question everyone gets right does not separate anyone"  "24,24,0.00" "$(as admin "select first_n||','||first_correct||','||disc from admin_item_analysis() where question_id = 'it-1';")"
eq  "a repeat try adds to the attempts but not to the first tries" "25,24,24" "$(as admin "select attempts||','||users||','||first_n from admin_item_analysis() where question_id = 'it-15';")"
eq  "a question nobody answered has no numbers"                "0,0," "$(as admin "select first_n||','||attempts||','||coalesce(disc::text,'') from admin_item_analysis() where question_id = 'it-none';")"
eq  "a question with a very hard wording has none right"       "0" "$(as admin "select first_correct from admin_item_analysis() where question_id = 'it-30';")"
eq  "a reviewer can use the analysis too"                     "24" "$(as rev "select first_n from admin_item_analysis() where question_id = 'it-15';")"
eq  "a member cannot"                                         "yes" "$(as a "select * from admin_item_analysis();" 2>&1 | grep -q 'editors only' && echo yes)"
eq  "nobody signed out can"                                   "yes" "$(as anon "select * from admin_item_analysis();" 2>&1 | grep -q 'permission denied' && echo yes)"
root "insert into attempts (user_id, question_id, ok, client_id, chosen) values ('${U[admin]}', 'it-15', true, 'adm-1', 'A');" >/dev/null
eq  "staff answers are left out"                              "24" "$(as admin "select users from admin_item_analysis() where question_id = 'it-15';")"
eq  "unless asked for"                                        "25" "$(as admin "select users from admin_item_analysis(false, true) where question_id = 'it-15';")"
eq  "changing the difficulty label keeps a reviewed question live" "reviewed,3" "$(as admin "update questions set difficulty = 3 where id = 'it-15' returning status||','||difficulty; commit;" | head -1)"
eq  "changing a label or topic does not count as a rewrite"   "0" "$(as admin "update questions set topic = 'New topic' where id = 'it-15'; select count(*) from question_revisions where question_id = 'it-15'; commit;")"
eq  "rewriting the stem records how the old wording did"       "24,15,admin@x" "$(as admin "update questions set stem = 'a harder stem' where id = 'it-15'; select first_n||','||first_correct||','||revised_by from question_revisions where question_id = 'it-15'; commit;")"
eq  "and marks when the wording changed"                      "true" "$(root "select (revised_at is not null)::text from questions where id = 'it-15';")"
eq  "counting only answers since the rewrite starts from none" "0,24" "$(as admin "select (select first_n from admin_item_analysis(true) where question_id = 'it-15')||','||(select first_n from admin_item_analysis(false) where question_id = 'it-15');")"
root "insert into attempts (user_id, question_id, ok, client_id, chosen) values ('00000000-0000-0000-0004-000000000003', 'it-15', false, 'ia-after', 'B');" >/dev/null
eq  "a new answer to the new wording is counted on its own"    "1,0" "$(as admin "select first_n||','||first_correct from admin_item_analysis(true) where question_id = 'it-15';")"
eq  "a rewrite by the upload tool is recorded too"             "1,0,upload tool" "$(root "update questions set explanation = 'a new explanation' where id = 'it-15'; select first_n||','||first_correct||','||revised_by from question_revisions where question_id = 'it-15' order by id desc limit 1;" | tail -1)"
eq  "so the history has two rows"                             "2" "$(as admin "select count(*) from question_revisions where question_id = 'it-15';")"
eq  "a member cannot read the rewrite history"                "0" "$(as a "select count(*) from question_revisions;")"
eq  "or write to it"                                          "yes" "$(as a "insert into question_revisions (question_id) values ('it-15');" 2>&1 | grep -q 'permission denied' && echo yes)"
eq  "an editor cannot edit it by hand either"                 "yes" "$(as admin "update question_revisions set first_n = 99;" 2>&1 | grep -q 'permission denied' && echo yes)"
eq  "deleting a question removes its history"                 "0" "$(root "delete from questions where id = 'it-15'; select count(*) from question_revisions where question_id = 'it-15';")"
echo; echo "Question lesson link"
root "insert into lessons (id, boards, subject, title, tier, status, blocks) values ('les-pin','{aem}','S','Pinned lesson','free','reviewed','[]');" >/dev/null
eq  "an admin can choose a lesson for a live question and it stays live" "reviewed,les-pin" "$(as admin "update questions set lesson_id = 'les-pin' where id = 'q-free' returning status||','||lesson_id; commit;" | head -1)"
eq  "members can read the chosen lesson with the question"     "les-pin" "$(as a "select lesson_id from questions where id = 'q-free';")"
eq  "a lesson that does not exist is refused"                   "yes" "$(as admin "update questions set lesson_id = 'no-such-lesson' where id = 'q-free';" 2>&1 | grep -q 'violates foreign key' && echo yes)"
eq  "a member cannot choose one"                                "0" "$(as a "update questions set lesson_id = null where id = 'q-free' returning id;" | grep -c .)"
eq  "choosing a lesson does not count as a rewrite"             "0" "$(root "select count(*) from question_revisions where question_id = 'q-free' and revised_by is not null and revised_at > now() - interval '1 minute';")"
eq  "deleting the lesson clears the choice on its questions"    "none" "$(root "delete from lessons where id = 'les-pin'; select coalesce(lesson_id, 'none') from questions where id = 'q-free';")"
echo; echo "Board outline objectives"
root "insert into lessons (id, boards, subject, title, tier, status, blocks) values ('les-obj','{aem}','S','Objective lesson','free','reviewed','[]');" >/dev/null
eq  "tags start empty"                                          "{}" "$(root "select objectives from questions where id = 'q-free'")"
eq  "an admin can tag a live question and it stays live"        "reviewed|{aem:K1.E.1}" "$(as admin "update questions set objectives = '{aem:K1.E.1}' where id = 'q-free' returning status||'|'||objectives::text; commit;" | head -1)"
eq  "...and a live lesson"                                      "reviewed|{om:K1.10,pm:K3.12}" "$(as admin "update lessons set objectives = '{om:K1.10,pm:K3.12}' where id = 'les-obj' returning status||'|'||objectives::text; commit;" | head -1)"
eq  "...and a live card"                                        "reviewed|{aem:K1.H.1.vii}" "$(as admin "update flashcards set objectives = '{aem:K1.H.1.vii}' where id = 'c-two' returning status||'|'||objectives::text; commit;" | head -1)"
eq  "members can read the tags"                                 "{aem:K1.E.1}" "$(as a "select objectives from questions where id = 'q-free';")"
eq  "tagging is not a rewrite"                                  "0" "$(root "select count(*) from question_revisions where question_id = 'q-free' and revised_by is not null and revised_at > now() - interval '1 minute';")"
eq  "a member cannot tag"                                       "0" "$(as a "update questions set objectives = '{aem:K1.E.2}' where id = 'q-free' returning id;" | grep -c .)"
has "a malformed code is refused"                               "questions_objectives_ok" "$(as admin "update questions set objectives = '{K1.E.1}' where id = 'q-free';" 2>&1)"
has "an unknown board is refused"                               "lessons_objectives_ok" "$(as admin "update lessons set objectives = '{xx:K1.1}' where id = 'les-obj';" 2>&1)"
has "stray text is refused"                                     "flashcards_objectives_ok" "$(as admin "update flashcards set objectives = '{\"aem:K1.1; drop\"}' where id = 'c-two';" 2>&1)"
has "an empty code is refused"                                  "questions_objectives_ok" "$(as admin "update questions set objectives = '{\"\"}' where id = 'q-free';" 2>&1)"
has "more than twelve are refused"                              "questions_objectives_ok" "$(as admin "update questions set objectives = array(select 'aem:K1.' || g from generate_series(1,13) g) where id = 'q-free';" 2>&1)"
eq  "twelve are fine"                                           "12" "$(as admin "update questions set objectives = array(select 'aem:K1.' || g from generate_series(1,12) g) where id = 'q-free' returning cardinality(objectives);" | head -1)"
eq  "tags can be cleared"                                       "{}" "$(as admin "update questions set objectives = '{}' where id = 'q-free' returning objectives; commit;" | head -1)"
echo; echo "Recent activity"
root "insert into attempts (user_id, question_id, ok, client_id, at) values ('${U[a]}', 'q-free', false, 'old1', now() - interval '5 days'), ('${U[a]}', 'q-pro', true, 'old2', now() - interval '40 days');" >/dev/null
act() { as admin "select attempts||'|'||correct||'|'||questions||'|'||members from admin_recent_activity('{$1}') where hours = $1;"; }
want() { root "select count(*)||'|'||count(*) filter (where t.ok)||'|'||count(distinct t.question_id)||'|'||count(distinct t.user_id) from attempts t join profiles p on p.id = t.user_id and p.active where $1;"; }
eq  "the last 24 hours match a direct count"          "$(want "t.at >= now() - interval '24 hours'")" "$(act 24)"
eq  "the last 48 hours leave out a try from five days ago" "$(want "t.at >= now() - interval '48 hours'")" "$(act 48)"
eq  "one week takes in the five-day-old try"            "$(want "t.at >= now() - interval '168 hours'")" "$(act 168)"
eq  "one week is bigger than 48 hours"                  "t" "$(as admin "select (select attempts from admin_recent_activity('{48,168}') where hours = 168) > (select attempts from admin_recent_activity('{48,168}') where hours = 48);")"
eq  "all time (0) counts every active member's try"     "$(want "true")" "$(act 0)"
eq  "a window with nothing in it reads zero"            "0|0|0|0" "$(as admin "select attempts||'|'||correct||'|'||questions||'|'||members from admin_recent_activity('{1}') where hours = 1 and false union all select '0|0|0|0';" | head -1)"
eq  "the default call returns a row per window, all time last" "24,48,72,168,336,720,2160,0" "$(as admin "select string_agg(hours::text, ',') from (select hours from admin_recent_activity()) z;")"
has "a member cannot read it"                           "admins only" "$(as a "select * from admin_recent_activity();")"
has "a reviewer cannot read it"                         "admins only" "$(as rev "select * from admin_recent_activity();")"
has "signed-out visitors cannot read it"                "permission denied" "$(as anon "select * from admin_recent_activity();")"
root "delete from attempts where client_id in ('old1','old2');" >/dev/null
echo; echo "Pro end dates"
eq  "a pro member with no end date sees pro questions"             "1" "$(as a "select count(*) from questions where id = 'q-pro';")"
eq  "setting an end date on the list reaches the profile"          "$(root "select (current_date + 30)::text")" "$(root "update allowed_emails set pro_until = current_date + 30 where email = 'a@x'; select pro_until::text from profiles where email = 'a@x';" | tail -1)"
eq  "pro still works before the end date"                          "1" "$(as a "select count(*) from questions where id = 'q-pro';")"
eq  "pro still works on the last day itself"                       "1" "$(root "update allowed_emails set pro_until = current_date where email = 'a@x';" >/dev/null; as a "select count(*) from questions where id = 'q-pro';")"
eq  "after the end date the person is treated as free"             "0" "$(root "update allowed_emails set pro_until = current_date - 1 where email = 'a@x';" >/dev/null; as a "select count(*) from questions where id = 'q-pro';")"
eq  "...but still sees the free questions and keeps their history" "1|$(root "select count(*) from attempts where user_id = '${U[a]}'")" "$(as a "select (select count(*) from questions where id = 'q-free') || '|' || (select count(*) from attempts where user_id = auth.uid());" | head -1)"
eq  "extending the end date turns pro back on at once"             "1" "$(root "update allowed_emails set pro_until = current_date + 365 where email = 'a@x';" >/dev/null; as a "select count(*) from questions where id = 'q-pro';")"
eq  "clearing the end date means no end date"                      "|1" "$(root "update allowed_emails set pro_until = null where email = 'a@x';" >/dev/null; as a "select coalesce((select pro_until::text from profiles where id = auth.uid()), '') || '|' || (select count(*) from questions where id = 'q-pro');" | head -1)"
eq  "moving someone to free clears their end date"                 "free|" "$(root "update allowed_emails set plan = 'pro', pro_until = current_date + 10 where email = 'd@x'; update allowed_emails set plan = 'free' where email = 'd@x'; select plan || '|' || coalesce(pro_until::text, '') from profiles where email = 'd@x';" | tail -1)"
eq  "the admin summary shows the end date"                         "$(root "select (current_date + 20)::text")" "$(root "update allowed_emails set pro_until = current_date + 20 where email = 'a@x';" >/dev/null; as admin "select pro_until::text from admin_member_summary() where email = 'a@x';")"
has "a member cannot give themselves more time"                    "permission denied" "$(as a "update profiles set pro_until = null where id = auth.uid();")"
eq  "a member cannot change the list either"                       "0" "$(as a "update allowed_emails set pro_until = null where email = 'a@x' returning email;" 2>&1 | grep -c 'a@x')"
eq  "an end date on the list is carried to a new account"          "$(root "select (current_date + 90)::text")" "$(root "insert into allowed_emails (email, role, plan, pro_until) values ('newpro@x', 'member', 'pro', current_date + 90); insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000000f7', 'newpro@x', '{\"invited\": \"true\"}'); select pro_until::text from profiles where email = 'newpro@x';" | tail -1)"
root "update allowed_emails set pro_until = null where email = 'a@x'; delete from allowed_emails where email = 'newpro@x'; delete from auth.users where email = 'newpro@x'; update allowed_emails set plan = 'free', pro_until = null where email = 'd@x';" >/dev/null
echo; echo "Names given by an admin"
eq  "an admin can give someone a full name and it becomes their display name" "Dr Ada Lovelace" "$(root "update allowed_emails set full_name = 'Dr Ada Lovelace' where email = 'a@x'; select display_name from profiles where email = 'a@x';" | tail -1)"
eq  "the admin summary shows it"                                   "Dr Ada Lovelace" "$(as admin "select display_name from admin_member_summary() where email = 'a@x';")"
eq  "a member can still change their own name"                     "Ada L" "$(as a "select set_my_name('Ada L'); commit;" >/dev/null; root "select display_name from profiles where email = 'a@x'")"
eq  "changing something else on the list does not overwrite it"    "Ada L" "$(root "update allowed_emails set note = 'edited' where email = 'a@x'; update allowed_emails set plan = 'pro' where email = 'a@x'; select display_name from profiles where email = 'a@x';" | tail -1)"
eq  "the admin changing the name again does"                       "Ada Lovelace, MD" "$(root "update allowed_emails set full_name = 'Ada Lovelace, MD' where email = 'a@x'; select display_name from profiles where email = 'a@x';" | tail -1)"
eq  "clearing it clears the display name"                          "none" "$(root "update allowed_emails set full_name = null where email = 'a@x'; select coalesce(display_name, 'none') from profiles where email = 'a@x';" | tail -1)"
has "a name over 60 characters is refused"                         "allowed_emails_full_name_check" "$(root "update allowed_emails set full_name = repeat('x', 61) where email = 'a@x';")"
has "an empty name is refused (clear it instead)"                  "allowed_emails_full_name_check" "$(root "update allowed_emails set full_name = '' where email = 'a@x';")"
eq  "a member cannot name someone else"                            "0" "$(as a "update allowed_emails set full_name = 'Hacked' where email = 'b@x' returning email;" 2>&1 | grep -c 'b@x')"
eq  "a name given before sign-up is carried to the new account"    "Pat Newcomer" "$(root "insert into allowed_emails (email, role, plan, full_name) values ('newname@x', 'member', 'free', 'Pat Newcomer'); insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000000f8', 'newname@x', '{\"invited\": \"true\"}'); select display_name from profiles where email = 'newname@x';" | tail -1)"
root "delete from allowed_emails where email = 'newname@x'; delete from auth.users where email = 'newname@x'; update allowed_emails set note = null, plan = 'pro', full_name = null where email = 'a@x'; update profiles set display_name = null where email = 'a@x';" >/dev/null
echo; echo "Faculty tests are kept separate"
FAC=00000000-0000-0000-0002-000000000001
as admin "select set_peer_min_users(1); commit;" >/dev/null
snap() { echo "$(as a "select coalesce(users::text,'-')||','||coalesce(pct_correct::text,'-') from peer_stats() where question_id='q-free';")/$(as a "select coalesce(sum(picks),0) from peer_choices() where question_id='q-free';")/$(as admin "select attempts||','||correct from admin_question_stats() where question_id='q-free';")/$(as admin "select attempts||','||members from admin_recent_activity('{0}');")"; }
BEFORE="$(snap)"
root "insert into attempts (user_id, question_id, ok, chosen, client_id) values ('$FAC','q-free',false,'C','fac-t1'), ('$FAC','q-pro',true,'A','fac-t2');" >/dev/null
eq  "the faculty tries were recorded"                       "2" "$(root "select count(*) from attempts where user_id='$FAC'")"
eq  "they change nothing in the group figures residents see, the question stats or the recent activity" "$BEFORE" "$(snap)"
eq  "a faculty member's own tries still count for their own history" "2" "$(root "select count(*) from attempts where user_id='$FAC' and ok is not null")"
root "delete from attempts where client_id in ('fac-t1','fac-t2');" >/dev/null
as admin "select set_peer_min_users(10); commit;" >/dev/null

echo; echo "Subject trend for faculty"
trend() { asfac "select coalesce(string_agg(subject||':'||recent_attempts||','||recent_correct||','||prev_attempts||','||prev_correct, ';' order by subject), '') from faculty_subject_trend($1);"; }
eq  "faculty see this period against the one before, per subject (30 days: 30 recent answers, 22 right, none before)" "S:30,22,0,0" "$(trend 30)"
eq  "with 90 days, the 12 wrong answers from 150 days ago are the earlier period" "S:30,22,12,0" "$(trend 90)"
eq  "with 180 days they are part of the recent period, and nothing is before" "S:42,22,0,0" "$(trend 180)"
eq  "a subject only two residents answered is left out" "0" "$(asfac "select count(*) from faculty_subject_trend(180) where subject='S2';")"
eq  "a window outside 7 to 365 days is pulled into range, not an error" "S:30,22,0,0" "$(trend 1)"
eq  "an admin sees the same for any program" "S:30,22,12,0" "$(as admin "select string_agg(subject||':'||recent_attempts||','||recent_correct||','||prev_attempts||','||prev_correct, ';') from preview_subject_trend('prog-ins', 90);")"
eq  "a program with fewer than three residents returns nothing" "0" "$(as admin "select count(*) from preview_subject_trend('prog-two', 180);")"
has "a member cannot call the faculty version"  "faculty only" "$(as a "select * from faculty_subject_trend(30);")"
has "a member cannot call the preview"          "admins only" "$(as a "select * from preview_subject_trend('prog-ins', 30);")"
has "signed-out visitors cannot call it"        "permission denied" "$(as anon "select * from faculty_subject_trend(30);")"
root "insert into attempts (user_id, question_id, ok, client_id) values ('$IF','qi-1',false,'fac-trend-1'), ('$IF','qi-1',false,'fac-trend-2');" >/dev/null
eq  "faculty answers do not move the trend" "S:30,22,0,0" "$(trend 30)"
root "delete from attempts where client_id like 'fac-trend-%';" >/dev/null

echo; echo "$PASS passed, $FAIL failed"; [[ $FAIL -eq 0 ]]
