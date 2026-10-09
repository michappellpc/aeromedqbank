-- AeroMedQBank database. Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.
-- Safe to re-run: it only creates what is missing and replaces functions/policies.
--
-- The privacy model
--   * Nobody can read anything unless they are signed in AND their email is on the allowed_emails list.
--   * Members only ever see their own progress. Only admins can see everyone's, through the admin_* functions.
--   * Questions are readable by active members whose plan covers the question's tier ('free' or 'pro').
--   * The questions themselves are written only by the upload tool (service key) or an admin.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------ residency programs
-- A program is a residency. Faculty (role 'faculty' on that program) can see the progress of the residents in it.
create table if not exists public.programs (
  id         text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name       text not null unique check (length(name) between 2 and 120),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- people
create table if not exists public.allowed_emails (
  email    text primary key check (email = lower(email)),
  role     text not null default 'member' check (role in ('member', 'reviewer', 'faculty', 'admin')),
  plan     text not null default 'pro'    check (plan in ('free', 'pro')),
  note     text,
  added_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  role         text not null default 'member' check (role in ('member', 'reviewer', 'faculty', 'admin')),
  plan         text not null default 'free'   check (plan in ('free', 'pro')),
  active       boolean not null default false,
  created_at   timestamptz not null default now(),
  last_seen    timestamptz
);

-- ------------------------------------------------------------- questions
create table if not exists public.questions (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  status      text not null default 'draft' check (status in ('draft', 'reviewed')),
  reviewed_by text,
  boards      text[] not null check (cardinality(boards) > 0),
  subject     text not null,
  topic       text,
  difficulty  int check (difficulty between 1 and 3),
  stem        text not null,
  image       text,
  image_alt   text,
  options     jsonb not null,
  answer      text not null,
  explanation text not null,
  option_notes jsonb,
  refs        text[] not null default '{}',
  tier        text not null default 'pro' check (tier in ('free', 'pro')),
  archived    boolean not null default false,        -- hidden from members, history kept, can be restored
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------- lessons
-- A lesson is a short teaching page for one subject: text, tables, charts, step flows and comparisons stored as "blocks".
-- Draft lessons are visible to admins and reviewers only; reviewed ones are live for members whose plan covers the tier.
create table if not exists public.lessons (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  status      text not null default 'draft' check (status in ('draft', 'reviewed')),
  reviewed_by text,
  boards      text[] not null check (cardinality(boards) > 0),
  subject     text not null,
  title       text not null,
  summary     text not null default '',
  position    int  not null default 100,
  blocks      jsonb not null default '[]' check (jsonb_typeof(blocks) = 'array'),
  refs        text[] not null default '{}',
  tier        text not null default 'pro' check (tier in ('free', 'pro')),
  archived    boolean not null default false,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------- flashcards
-- A card is a front and a back. Draft cards are visible to admins and reviewers only; reviewed ones are live for every active member
-- (flashcards are free for everyone, so there is no tier). Each member's own schedule for a card is kept in card_reviews.
create table if not exists public.flashcards (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  status      text not null default 'draft' check (status in ('draft', 'reviewed')),
  reviewed_by text,
  boards      text[] not null check (cardinality(boards) > 0),
  subject     text not null,
  topic       text,
  front       text not null check (char_length(btrim(front)) between 1 and 600),
  back        text not null check (char_length(btrim(back)) between 1 and 1500),
  lesson_id   text,
  refs        text[] not null default '{}',
  archived    boolean not null default false,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.card_reviews (
  user_id       uuid not null references auth.users (id) on delete cascade,
  card_id       text not null references public.flashcards (id) on delete cascade,
  ease          real not null default 2.5 check (ease between 1.3 and 4),
  interval_days int  not null default 0 check (interval_days between 0 and 3650),
  due           date not null,
  reps          int  not null default 0 check (reps >= 0),
  lapses        int  not null default 0 check (lapses >= 0),
  last_reviewed date,
  updated_at    timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- ------------------------------------------------------- highlights and personal flashcards
-- Private to each member: nobody else (faculty and admins included) can read these. start_pos/end_pos are character offsets into one
-- field of one question or lesson (field says which, e.g. stem, opt-B, expl, or a lesson block); text_hl keeps the highlighted words so the
-- highlight can be found again if the wording is edited later. my_cards holds a member's own cards with their review schedule.
create table if not exists public.highlights (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('q', 'l')),
  item_id    text not null check (char_length(item_id) between 1 and 120),
  field      text not null check (char_length(field) between 1 and 40),
  start_pos  int  not null check (start_pos >= 0),
  end_pos    int  not null,
  text_hl    text not null check (char_length(btrim(text_hl)) between 1 and 1000),
  created_at timestamptz not null default now(),
  check (end_pos > start_pos)
);
create index if not exists highlights_owner on public.highlights (user_id, kind, item_id);

create table if not exists public.my_cards (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  front         text not null check (char_length(btrim(front)) between 1 and 600),
  back          text not null check (char_length(btrim(back)) between 1 and 1500),
  src_kind      text check (src_kind in ('q', 'l')),
  src_id        text check (char_length(src_id) <= 120),
  ease          real not null default 2.5 check (ease between 1.3 and 4),
  interval_days int  not null default 0 check (interval_days between 0 and 3650),
  due           date,
  reps          int  not null default 0 check (reps >= 0),
  lapses        int  not null default 0 check (lapses >= 0),
  last_reviewed date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists my_cards_owner on public.my_cards (user_id);

-- Databases created before the reviewer role / archive existed are upgraded here (safe to re-run).
alter table public.allowed_emails drop constraint if exists allowed_emails_role_check;
alter table public.allowed_emails add constraint allowed_emails_role_check check (role in ('member', 'reviewer', 'faculty', 'admin'));
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('member', 'reviewer', 'faculty', 'admin'));
alter table public.allowed_emails add column if not exists program_id text references public.programs (id) on delete set null;
alter table public.profiles add column if not exists program_id text references public.programs (id) on delete set null;
-- When pro access ends (the last day it works). Null = no end date. After it, the person is treated as free without anyone changing anything.
alter table public.allowed_emails add column if not exists pro_until date;
alter table public.profiles add column if not exists pro_until date;
-- A full name an admin gives someone (before or after they sign up). It becomes their display name; they can still change it themselves in Settings, and an
-- admin's later edit of something else on the list does not overwrite that: the name only flows across when the admin changes it.
alter table public.allowed_emails add column if not exists full_name text check (full_name is null or char_length(full_name) between 1 and 60);
alter table public.profiles add column if not exists program_status text check (program_status in ('pending', 'approved'));
alter table public.questions add column if not exists archived boolean not null default false;
alter table public.questions add column if not exists updated_by text;
-- When the wording (stem, choices, answer, explanation or picture) last changed. Null = never rewritten. Lets the admin tables count only answers to the current wording.
alter table public.questions add column if not exists revised_at timestamptz;
-- A lesson chosen by hand for this question's "Study this" link. Null = pick the best match automatically. Metadata, not wording: changing it keeps a live question live.
alter table public.questions add column if not exists lesson_id text references public.lessons (id) on delete set null;

-- Board outline items a question, lesson or flashcard covers, stored as "board:code" (for example aem:K1.E.1). Metadata only: the review guards leave it out on purpose.
alter table public.questions  add column if not exists objectives text[] not null default '{}';
alter table public.lessons    add column if not exists objectives text[] not null default '{}';
alter table public.flashcards add column if not exists objectives text[] not null default '{}';
do $$ declare t text; begin
  foreach t in array array['questions','lessons','flashcards'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_objectives_ok') then
      execute format('alter table public.%I add constraint %I check (cardinality(objectives) <= 12 and array_position(objectives, '''') is null and array_to_string(objectives, '','') ~ %L)', t, t || '_objectives_ok', '^((aem|om|pm):[TK][0-9]+(\.[A-Za-z0-9]+)*(,|$))*$');
    end if;
  end loop;
end $$;

-- One row each time a question's wording changes: how members had done on the old wording (first try per member), so a rewrite can be judged.
create table if not exists public.question_revisions (
  id            bigint generated always as identity primary key,
  question_id   text not null references public.questions (id) on delete cascade,
  revised_at    timestamptz not null default now(),
  revised_by    text,
  era_start     timestamptz,                -- the previous wording dated from here (null = from the beginning)
  first_n       int not null default 0,     -- members who had answered the old wording, counting each member's first try
  first_correct int not null default 0
);
create index if not exists question_revisions_q on public.question_revisions (question_id, revised_at desc);

-- ------------------------------------------------------------ question feedback (the in-app inbox)
-- Members send a short message about a question. Admins and reviewers read it in Admin > Inbox. Only admins see who sent it.
create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text,                                     -- plain text so the message outlives a deleted question
  category    text not null default 'other' check (category in ('wrong-answer', 'unclear', 'typo', 'picture', 'other')),
  message     text not null check (char_length(message) between 3 and 1500),
  context     text check (char_length(context) <= 300),
  client_id   text not null,                            -- makes retries harmless
  status      text not null default 'new' check (status in ('new', 'read', 'resolved')),
  admin_note  text check (char_length(admin_note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  kind        text not null default 'feedback' check (kind in ('feedback', 'support')),     -- feedback = about a question; support = a general message
  subject     text check (char_length(subject) <= 120),
  member_unread boolean not null default false,        -- the team has replied and the member has not opened it yet
  last_activity timestamptz not null default now(),
  unique (user_id, client_id)
);
alter table public.feedback add column if not exists kind text not null default 'feedback' check (kind in ('feedback', 'support'));
alter table public.feedback add column if not exists subject text check (char_length(subject) <= 120);
alter table public.feedback add column if not exists member_unread boolean not null default false;
alter table public.feedback add column if not exists last_activity timestamptz not null default now();
-- Replies inside a conversation (the first message lives on the feedback row). Read and written only through the functions below.
create table if not exists public.feedback_messages (
  id          bigint generated always as identity primary key,
  feedback_id bigint not null references public.feedback (id) on delete cascade,
  sender      text not null check (sender in ('member', 'team')),
  author_id   uuid references auth.users (id) on delete set null,
  message     text not null check (char_length(message) between 1 and 1500),
  created_at  timestamptz not null default now()
);
create index if not exists feedback_messages_thread_idx on public.feedback_messages (feedback_id, created_at);
alter table public.feedback_messages enable row level security;
alter table public.feedback enable row level security;

-- ------------------------------------------------------- per-person data
create table if not exists public.attempts (          -- one row per answered question; never edited
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete cascade,
  ok          boolean not null,
  client_id   text not null,                            -- makes retries harmless
  at          timestamptz not null default now(),
  chosen      text check (chosen is null or char_length(chosen) between 1 and 3),   -- which option was picked (older rows have none)
  unique (user_id, client_id)
);
alter table public.attempts add column if not exists chosen text check (chosen is null or char_length(chosen) between 1 and 3);
create index if not exists attempts_question_idx on public.attempts (question_id);
create index if not exists attempts_user_idx on public.attempts (user_id, at);

create table if not exists public.question_marks (    -- flag + private note per question
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete cascade,
  flagged     boolean not null default false,
  note        text not null default '' check (length(note) <= 4000),
  updated_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.tests (             -- finished tests, for history and review
  id       text not null,
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  taken_at timestamptz not null,
  mode     text not null check (mode in ('tutor', 'timed')),
  qids     text[] not null,
  answers  jsonb not null default '{}',
  correct  int not null,
  total    int not null,
  seconds  int not null,
  primary key (user_id, id)
);

create table if not exists public.user_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------ access helpers
create or replace function public.is_active() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active) $$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin') $$;

-- Admins and reviewers can edit questions; only admins see member information.
create or replace function public.can_edit() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'reviewer')) $$;

create or replace function public.has_plan(t text) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active
                  and (t = 'free' or (p.plan = 'pro' and (p.pro_until is null or p.pro_until >= current_date)) or p.role in ('admin', 'reviewer'))) $$;

-- ------------------------------------------- keep profiles in step with the allow list
-- Sign-up switch. When on, anyone can create their own account on the sign-in page and gets a FREE member account at once
-- (the admin can raise or remove it later). When off, only people an admin created (or approved by hand) can get in.
create table if not exists public.app_settings (key text primary key, value jsonb not null);
alter table public.app_settings enable row level security;          -- no policies: only the functions below can touch it
insert into public.app_settings (key, value) values ('open_signup', 'true') on conflict (key) do nothing;

create or replace function public.signup_open() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((select (value)::text = 'true' from public.app_settings where key = 'open_signup'), false) $$;

create or replace function public.set_signup_open(open boolean) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  insert into public.app_settings (key, value) values ('open_signup', to_jsonb(open))
    on conflict (key) do update set value = excluded.value;
end $$;

-- A new login becomes a profile. Accounts made by an admin (through the member-admin function, which marks them "invited"
-- in app_metadata, something a visitor cannot set) get exactly what the approved list says. A person who signs up on their
-- own gets a free member account and never a role or plan from the list, so nobody can claim someone else's pre-approval.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare
  a public.allowed_emails;
  invited boolean := coalesce(new.raw_app_meta_data ->> 'invited', '') = 'true';
  want text := new.raw_user_meta_data ->> 'program_id';      -- a self sign-up may ASK for a program; faculty must approve it
  pid text;
  listed boolean;
begin
  select * into a from public.allowed_emails where email = lower(new.email);
  listed := found;                                             -- FOUND is reset by every SELECT, so keep this one
  select id into pid from public.programs where id = want and active;
  if listed and invited then
    insert into public.profiles (id, email, display_name, active, role, plan, pro_until, program_id, program_status)
      values (new.id, lower(new.email), a.full_name, true, a.role, a.plan, case when a.plan = 'pro' then a.pro_until end, a.program_id, case when a.program_id is null then null else 'approved' end);
  elsif public.signup_open() and not invited then
    if not listed then insert into public.allowed_emails (email, role, plan, note) values (lower(new.email), 'member', 'free', 'self sign-up'); end if;
    insert into public.profiles (id, email, active, role, plan, program_id, program_status)
      values (new.id, lower(new.email), true, 'member', 'free', pid, case when pid is null then null else 'pending' end);
  else
    insert into public.profiles (id, email, display_name, active, role, plan, pro_until, program_id, program_status)
      values (new.id, lower(new.email), a.full_name, a.email is not null, coalesce(a.role, 'member'), coalesce(a.plan, 'free'), case when a.plan = 'pro' then a.pro_until end, a.program_id, case when a.program_id is null then null else 'approved' end);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.sync_allowed() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'DELETE' then
    update public.profiles set active = false, role = 'member', plan = 'free', pro_until = null where lower(email) = old.email;
    return old;
  end if;
  -- Faculty mirror the program on the list. A resident the admin puts in a program is approved at once; a row with no program
  -- leaves a resident's own request alone.
  update public.profiles set active = true, role = new.role, plan = new.plan, pro_until = case when new.plan = 'pro' then new.pro_until else null end,
    display_name = case when tg_op = 'UPDATE' and new.full_name is distinct from old.full_name or tg_op = 'INSERT' and new.full_name is not null then new.full_name else display_name end,
    program_id = case when new.role = 'faculty' or new.program_id is not null then new.program_id else program_id end,
    program_status = case when new.role = 'faculty' or new.program_id is not null then (case when new.program_id is null then null else 'approved' end) else program_status end
  where lower(email) = new.email;
  return new;
end $$;

drop trigger if exists on_allowed_change on public.allowed_emails;
create trigger on_allowed_change after insert or update or delete on public.allowed_emails
  for each row execute function public.sync_allowed();

-- ------------------------------------------------------------- row security
alter table public.allowed_emails  enable row level security;
alter table public.profiles        enable row level security;
alter table public.questions       enable row level security;
alter table public.lessons         enable row level security;
alter table public.flashcards      enable row level security;
alter table public.card_reviews    enable row level security;
alter table public.highlights      enable row level security;
alter table public.question_revisions enable row level security;
alter table public.my_cards        enable row level security;
alter table public.programs        enable row level security;
alter table public.attempts        enable row level security;
alter table public.question_marks  enable row level security;
alter table public.tests           enable row level security;
alter table public.user_settings   enable row level security;

drop policy if exists allowed_admin      on public.allowed_emails;
drop policy if exists profiles_read      on public.profiles;
drop policy if exists questions_read     on public.questions;
drop policy if exists questions_admin    on public.questions;
drop policy if exists questions_edit     on public.questions;
drop policy if exists programs_admin     on public.programs;
drop policy if exists feedback_insert     on public.feedback;
drop policy if exists feedback_own        on public.feedback;
drop policy if exists lessons_read       on public.lessons;
drop policy if exists lessons_edit       on public.lessons;
drop policy if exists cards_read         on public.flashcards;
drop policy if exists cards_edit         on public.flashcards;
drop policy if exists card_reviews_own   on public.card_reviews;
drop policy if exists highlights_own     on public.highlights;
drop policy if exists revisions_read     on public.question_revisions;
drop policy if exists my_cards_own       on public.my_cards;
drop policy if exists attempts_read      on public.attempts;
drop policy if exists attempts_insert    on public.attempts;
drop policy if exists marks_own          on public.question_marks;
drop policy if exists tests_own          on public.tests;
drop policy if exists settings_own       on public.user_settings;

create policy allowed_admin   on public.allowed_emails for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_read   on public.profiles       for select to authenticated using (id = auth.uid() or public.is_admin());
create policy questions_read  on public.questions      for select to authenticated using (public.has_plan(tier) and not archived and status = 'reviewed');   -- drafts are visible to admins and reviewers only
create policy questions_edit  on public.questions      for all    to authenticated using (public.can_edit()) with check (public.can_edit());
create policy programs_admin   on public.programs       for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy feedback_insert  on public.feedback       for insert to authenticated with check (user_id = auth.uid() and public.is_active());
create policy feedback_own     on public.feedback       for select to authenticated using (user_id = auth.uid());
create policy lessons_read    on public.lessons        for select to authenticated using (public.has_plan(tier) and not archived and status = 'reviewed');
create policy lessons_edit    on public.lessons        for all    to authenticated using (public.can_edit()) with check (public.can_edit());
create policy cards_read      on public.flashcards     for select to authenticated using (public.is_active() and not archived and status = 'reviewed');
create policy cards_edit      on public.flashcards     for all    to authenticated using (public.can_edit()) with check (public.can_edit());
create policy card_reviews_own on public.card_reviews  for all    to authenticated using (user_id = auth.uid() and public.is_active()) with check (user_id = auth.uid() and public.is_active());
create policy revisions_read   on public.question_revisions for select to authenticated using (public.can_edit());
create policy highlights_own   on public.highlights    for all to authenticated using (user_id = auth.uid() and public.is_active()) with check (user_id = auth.uid() and public.is_active());
create policy my_cards_own     on public.my_cards      for all to authenticated using (user_id = auth.uid() and public.is_active()) with check (user_id = auth.uid() and public.is_active());
create policy attempts_read   on public.attempts       for select to authenticated using (user_id = auth.uid() and public.is_active());
create policy attempts_insert on public.attempts       for insert to authenticated
  with check (user_id = auth.uid() and public.is_active() and at <= now() + interval '5 minutes');
create policy marks_own       on public.question_marks for all    to authenticated using (user_id = auth.uid() and public.is_active()) with check (user_id = auth.uid() and public.is_active());
create policy tests_own       on public.tests          for all    to authenticated using (user_id = auth.uid() and public.is_active()) with check (user_id = auth.uid() and public.is_active());
create policy settings_own    on public.user_settings  for all    to authenticated using (user_id = auth.uid() and public.is_active()) with check (user_id = auth.uid() and public.is_active());

-- ----------------------------------------------- privileges (explicit, not left to defaults)
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;
grant usage on schema public to anon, authenticated, service_role;
grant select                         on public.profiles       to authenticated;
grant select, insert, update, delete on public.allowed_emails to authenticated;
grant select, insert, update, delete on public.questions      to authenticated;
grant select, insert, update, delete on public.lessons        to authenticated;
grant select, insert, update, delete on public.flashcards     to authenticated;
grant select, insert, update, delete on public.card_reviews   to authenticated;
grant select, insert, update, delete on public.highlights     to authenticated;
grant select                         on public.question_revisions to authenticated;
grant select, insert, update, delete on public.my_cards       to authenticated;
grant select, insert, update, delete on public.programs       to authenticated;
grant select, insert                 on public.feedback       to authenticated;
grant select, insert                 on public.attempts       to authenticated;
grant select, insert, update, delete on public.question_marks, public.tests, public.user_settings to authenticated;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ------------------------------------------------------- private images
-- A question whose image is "private:name.png" has its picture in this private bucket. A member can read the picture
-- only if they can read a question that uses it, so pictures follow the same plan and approval rules as the questions.
insert into storage.buckets (id, name, public) values ('question-images', 'question-images', false) on conflict (id) do nothing;
drop policy if exists question_images_read on storage.objects;
create policy question_images_read on storage.objects for select to authenticated
  using (bucket_id = 'question-images'
         and (exists (select 1 from public.questions q where q.image = 'private:' || storage.objects.name)
              or exists (select 1 from public.lessons l where position('"private:' || storage.objects.name || '"' in l.blocks::text) > 0)));

drop policy if exists question_images_edit on storage.objects;
create policy question_images_edit on storage.objects for all to authenticated
  using (bucket_id = 'question-images' and public.can_edit())
  with check (bucket_id = 'question-images' and public.can_edit());

-- ------------------------------------------------ review integrity (who reviewed, and when it must be redone)
-- For a signed-in person (not the upload tool): the database, not the browser, records who saved and who reviewed,
-- and a reviewed question that is edited goes back to draft so it must be reviewed again.
create or replace function public.questions_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare who text;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.stem, new.options, new.answer, new.explanation, new.option_notes, new.image)
       is distinct from (old.stem, old.options, old.answer, old.explanation, old.option_notes, old.image) then
    -- the wording changed: remember how it had been doing, and start counting afresh for the new wording
    new.revised_at := now();
    insert into public.question_revisions (question_id, revised_by, era_start, first_n, first_correct)
      select old.id, coalesce((select email from public.profiles where id = auth.uid()), 'upload tool'), old.revised_at, count(*), count(*) filter (where f.ok)
      from (select distinct on (a.user_id) a.ok from public.attempts a join public.profiles p on p.id = a.user_id
            where a.question_id = old.id and p.role = 'member' and (old.revised_at is null or a.at >= old.revised_at)
            order by a.user_id, a.at, a.id) f;
  end if;
  if auth.uid() is null then                       -- the upload tool (service key)
    if new.updated_by is null then new.updated_by := 'upload tool'; end if;
    return new;
  end if;
  select email into who from public.profiles where id = auth.uid();
  new.updated_by := who;
  if tg_op = 'UPDATE' and old.status = 'reviewed' and new.status = 'reviewed'
     and (new.stem, new.options, new.answer, new.explanation, new.option_notes, new.refs, new.image, new.image_alt, new.subject, new.boards, new.topic)
         is distinct from (old.stem, old.options, old.answer, old.explanation, old.option_notes, old.refs, old.image, old.image_alt, old.subject, old.boards, old.topic)
  then new.status := 'draft'; end if;      -- (the difficulty label is advice, not wording, so changing it keeps a question live)
  if new.status <> 'reviewed' then new.reviewed_by := null;
  elsif tg_op = 'INSERT' or old.status <> 'reviewed' then new.reviewed_by := who;      -- whoever marks it reviewed
  else new.reviewed_by := old.reviewed_by; end if;                                      -- nobody can rewrite it later
  return new;
end $$;

drop trigger if exists questions_guard on public.questions;
create trigger questions_guard before insert or update on public.questions
  for each row execute function public.questions_guard();

create or replace function public.lessons_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare who text;
begin
  new.updated_at := now();
  if auth.uid() is null then
    if new.updated_by is null then new.updated_by := 'upload tool'; end if;
    return new;
  end if;
  select email into who from public.profiles where id = auth.uid();
  new.updated_by := who;
  if tg_op = 'UPDATE' and old.status = 'reviewed' and new.status = 'reviewed'
     and (new.title, new.summary, new.blocks, new.refs, new.subject, new.boards)
         is distinct from (old.title, old.summary, old.blocks, old.refs, old.subject, old.boards)
  then new.status := 'draft'; end if;
  if new.status <> 'reviewed' then new.reviewed_by := null;
  elsif tg_op = 'INSERT' or old.status <> 'reviewed' then new.reviewed_by := who;
  else new.reviewed_by := old.reviewed_by; end if;
  return new;
end $$;

drop trigger if exists lessons_guard on public.lessons;
create trigger lessons_guard before insert or update on public.lessons
  for each row execute function public.lessons_guard();

create or replace function public.cards_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare who text;
begin
  new.updated_at := now();
  if auth.uid() is null then
    if new.updated_by is null then new.updated_by := 'upload tool'; end if;
    return new;
  end if;
  select email into who from public.profiles where id = auth.uid();
  new.updated_by := who;
  if tg_op = 'UPDATE' and old.status = 'reviewed' and new.status = 'reviewed'
     and (new.front, new.back, new.refs, new.subject, new.boards, new.topic, new.lesson_id)
         is distinct from (old.front, old.back, old.refs, old.subject, old.boards, old.topic, old.lesson_id)
  then new.status := 'draft'; end if;
  if new.status <> 'reviewed' then new.reviewed_by := null;
  elsif tg_op = 'INSERT' or old.status <> 'reviewed' then new.reviewed_by := who;
  else new.reviewed_by := old.reviewed_by; end if;
  return new;
end $$;

drop trigger if exists cards_guard on public.flashcards;
create trigger cards_guard before insert or update on public.flashcards
  for each row execute function public.cards_guard();

-- A member can keep this many of each, so the tables cannot be filled up. my_cards also stamps its own update time.
create or replace function public.own_rows_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if tg_table_name = 'my_cards' then
    new.updated_at := now();
    select count(*) into n from public.my_cards where user_id = new.user_id;
    if tg_op = 'INSERT' and n >= 2000 then raise exception 'You can keep up to 2000 cards of your own'; end if;
  else
    select count(*) into n from public.highlights where user_id = new.user_id;
    if tg_op = 'INSERT' and n >= 5000 then raise exception 'You can keep up to 5000 highlights'; end if;
  end if;
  return new;
end $$;
drop trigger if exists own_rows_guard on public.highlights;
create trigger own_rows_guard before insert or update on public.highlights for each row execute function public.own_rows_guard();
drop trigger if exists own_rows_guard on public.my_cards;
create trigger own_rows_guard before insert or update on public.my_cards for each row execute function public.own_rows_guard();

-- ---------------------------------------------------------------- functions the app calls
create or replace function public.my_progress()
  returns table (question_id text, seen int, correct int, wrong int, last_ok boolean)
  language sql stable security invoker set search_path = public as
$$
  select a.question_id, count(*)::int, (count(*) filter (where a.ok))::int, (count(*) filter (where not a.ok))::int,
         (array_agg(a.ok order by a.at desc, a.id desc))[1]
  from public.attempts a where a.user_id = auth.uid() group by a.question_id
$$;

create or replace function public.touch_seen() returns void
  language sql security definer set search_path = public as
$$ update public.profiles set last_seen = now() where id = auth.uid() $$;

create or replace function public.reset_my_progress() returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_active() then raise exception 'not allowed'; end if;
  delete from public.attempts       where user_id = auth.uid();
  delete from public.question_marks where user_id = auth.uid();
  delete from public.tests          where user_id = auth.uid();
  delete from public.card_reviews   where user_id = auth.uid();
end $$;

-- admin-only summaries (raise an error for everyone else)
drop function if exists public.admin_member_summary();
create function public.admin_member_summary()
  returns table (user_id uuid, email text, display_name text, role text, plan text, active boolean,
                 attempts bigint, correct bigint, last_active timestamptz, program_id text, program_status text, pro_until date)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select p.id, p.email, p.display_name, p.role, p.plan, p.active,
           count(a.id), count(a.id) filter (where a.ok), greatest(max(a.at), p.last_seen), p.program_id, p.program_status, p.pro_until
    from public.profiles p left join public.attempts a on a.user_id = p.id
    group by p.id order by p.email;
end $$;

drop function if exists public.admin_question_stats();
create function public.admin_question_stats()
  returns table (question_id text, subject text, status text, archived boolean, attempts bigint, correct bigint, pct_correct numeric)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  return query
    select q.id, q.subject, q.status, q.archived, count(a.id), count(a.id) filter (where a.ok),
           case when count(a.id) = 0 then null else round(100.0 * count(a.id) filter (where a.ok) / count(a.id), 1) end
    from public.questions q
    left join public.attempts a on a.question_id = q.id and not exists (select 1 from public.profiles f where f.id = a.user_id and f.role = 'faculty')   -- faculty tests are not residents' performance
    group by q.id order by q.id;
end $$;

-- How much the group has answered lately, for the admin Overview: one row per window of hours, counting every try by active members (faculty left out: they test questions).
-- hours = 0 means all time. questions is how many different questions were answered, members how many different people answered.
drop function if exists public.admin_recent_activity(int[]);
create function public.admin_recent_activity(windows int[] default array[24, 48, 72, 168, 336, 720, 2160, 0])
  returns table (hours int, attempts bigint, correct bigint, questions bigint, members bigint)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select w.h, count(a.id), count(a.id) filter (where a.ok), count(distinct a.question_id), count(distinct a.user_id)
    from unnest(windows) as w(h)
    left join (select t.id, t.ok, t.question_id, t.user_id, t.at from public.attempts t join public.profiles p on p.id = t.user_id and p.active and p.role <> 'faculty') a
      on w.h = 0 or a.at >= now() - make_interval(hours => w.h)
    group by w.h order by case when w.h = 0 then 2147483647 else w.h end;
end $$;

-- Item analysis for the admin Difficulty tab. One row per question. Each member's FIRST try is what counts for difficulty (repeat tries are
-- recall, not difficulty). disc is how well the question separates strong from weak members: the share of the top 27% (by first-try accuracy on
-- everything, members with at least 20 answers) who got it right minus the share of the bottom 27%; null until at least 5 members sit in each
-- group. picks is how many first tries chose each option. since_edit counts only answers given since the wording last changed. Staff
-- accounts (admins, reviewers) and faculty are left out unless include_staff, because they test questions rather than study them.
drop function if exists public.admin_item_analysis(boolean, boolean);
create function public.admin_item_analysis(since_edit boolean default false, include_staff boolean default false)
  returns table (question_id text, attempts bigint, users bigint, first_n bigint, first_correct bigint, disc numeric, picks jsonb, last_at timestamptz, revised_at timestamptz)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  return query
  with base as (
    select a.id, a.user_id, a.question_id, a.ok, a.chosen, a.at
    from public.attempts a
    join public.questions q on q.id = a.question_id
    join public.profiles p on p.id = a.user_id
    where p.active and (coalesce(include_staff, false) or p.role = 'member')
      and (not coalesce(since_edit, false) or q.revised_at is null or a.at >= q.revised_at)),
  first as (select distinct on (b.user_id, b.question_id) b.user_id, b.question_id, b.ok, b.chosen from base b order by b.user_id, b.question_id, b.at, b.id),
  skill as (select f.user_id, avg(f.ok::int) as acc from first f group by f.user_id having count(*) >= 20),
  ranked as (select s.user_id, percent_rank() over (order by s.acc) as pr from skill s),
  grp as (
    select f.question_id,
           count(*) filter (where r.pr >= 0.73) as hi_n, avg(f.ok::int) filter (where r.pr >= 0.73) as hi,
           count(*) filter (where r.pr <= 0.27) as lo_n, avg(f.ok::int) filter (where r.pr <= 0.27) as lo
    from first f join ranked r on r.user_id = f.user_id group by f.question_id),
  tot as (select b.question_id, count(*) as n, count(distinct b.user_id) as u, max(b.at) as last_at from base b group by b.question_id),
  fst as (select f.question_id, count(*) as n, count(*) filter (where f.ok) as c from first f group by f.question_id),
  pk as (select z.question_id, jsonb_object_agg(z.chosen, z.n) as picks from (select f.question_id, f.chosen, count(*) as n from first f where f.chosen is not null group by 1, 2) z group by z.question_id)
  select q.id, coalesce(t.n, 0), coalesce(t.u, 0), coalesce(f.n, 0), coalesce(f.c, 0),
         case when g.hi_n >= 5 and g.lo_n >= 5 then round((g.hi - g.lo)::numeric, 2) end,
         coalesce(k.picks, '{}'::jsonb), t.last_at, q.revised_at
  from public.questions q
  left join tot t on t.question_id = q.id left join fst f on f.question_id = q.id
  left join grp g on g.question_id = q.id left join pk k on k.question_id = q.id
  order by q.id;
end $$;

-- ------------------------------------------------------------ programs: residents and faculty
-- The list of programs is public on purpose (a resident picks theirs while creating an account).
create or replace function public.program_list() returns table (id text, name text)
  language sql stable security definer set search_path = public as
$$ select p.id, p.name from public.programs p where p.active order by p.name $$;

create or replace function public.my_program() returns table (id text, name text, status text)
  language sql stable security definer set search_path = public as
$$ select p.id, p.name, pr.program_status from public.profiles pr join public.programs p on p.id = pr.program_id where pr.id = auth.uid() $$;

create or replace function public.request_program(pid text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_active() then raise exception 'not active'; end if;
  if not exists (select 1 from public.programs where id = pid and active) then raise exception 'unknown program'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'faculty') then raise exception 'faculty accounts are assigned by an administrator'; end if;
  update public.profiles set program_id = pid, program_status = 'pending'
    where id = auth.uid() and (program_id is distinct from pid);
end $$;

create or replace function public.leave_program() returns void
  language sql security definer set search_path = public as
$$ update public.profiles set program_id = null, program_status = null where id = auth.uid() and role not in ('faculty') $$;

-- the program a signed-in faculty member looks after (null for everyone else)
create or replace function public.faculty_program_id() returns text
  language sql stable security definer set search_path = public as
$$ select program_id from public.profiles where id = auth.uid() and active and role = 'faculty' $$;

-- Faculty see progress only: counts, percent correct by subject, last active. Never which answer was chosen, notes, or test history.
-- (the roster functions gained a column, so the old versions are dropped first)
drop function if exists public.faculty_roster();
drop function if exists public.preview_roster(text);
drop function if exists public._program_roster(text);
-- The faculty view is built by two internal functions that take a program id. Faculty reach them through faculty_roster() and
-- faculty_subject_stats() for their own program; an admin reaches them through preview_roster() / preview_subjects() to see exactly
-- what faculty see for any program. They are not granted to anyone directly.
create or replace function public._program_roster(fp text)
  returns table (user_id uuid, email text, display_name text, status text, attempts bigint, correct bigint, last_active timestamptz, joined timestamptz)
  language sql stable security definer set search_path = public as
$$
  select p.id, p.email, p.display_name, p.program_status,
         case when p.program_status = 'approved' then count(a.id) end,
         case when p.program_status = 'approved' then count(a.id) filter (where a.ok) end,
         case when p.program_status = 'approved' then greatest(max(a.at), p.last_seen) end, p.created_at
  from public.profiles p left join public.attempts a on a.user_id = p.id and p.program_status = 'approved'
  where p.program_id = fp and p.role <> 'faculty' and p.active
  group by p.id order by p.email
$$;
create or replace function public._program_subjects(fp text)
  returns table (user_id uuid, subject text, attempts bigint, correct bigint)
  language sql stable security definer set search_path = public as
$$
  select a.user_id, q.subject, count(*), count(*) filter (where a.ok)
  from public.attempts a join public.profiles p on p.id = a.user_id join public.questions q on q.id = a.question_id
  where p.program_id = fp and p.program_status = 'approved' and p.role <> 'faculty' and p.active
  group by a.user_id, q.subject
$$;
create or replace function public.faculty_roster()
  returns table (user_id uuid, email text, display_name text, status text, attempts bigint, correct bigint, last_active timestamptz, joined timestamptz)
  language plpgsql stable security definer set search_path = public as
$$
declare fp text := public.faculty_program_id();
begin
  if fp is null then raise exception 'faculty only'; end if;
  return query select * from public._program_roster(fp);
end $$;
create or replace function public.faculty_subject_stats()
  returns table (user_id uuid, subject text, attempts bigint, correct bigint)
  language plpgsql stable security definer set search_path = public as
$$
declare fp text := public.faculty_program_id();
begin
  if fp is null then raise exception 'faculty only'; end if;
  return query select * from public._program_subjects(fp);
end $$;
create or replace function public.preview_roster(pid text)
  returns table (user_id uuid, email text, display_name text, status text, attempts bigint, correct bigint, last_active timestamptz, joined timestamptz)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query select * from public._program_roster(pid);
end $$;
create or replace function public.preview_subjects(pid text)
  returns table (user_id uuid, subject text, attempts bigint, correct bigint)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query select * from public._program_subjects(pid);
end $$;

-- ------------------------------------------------------------- program insights
-- Group-level analysis for a program's faculty: which topics and questions the residents as a group miss most, how that compares with all
-- members, and the weekly trend. Only totals over the program's APPROVED residents are returned, never one person's numbers by topic,
-- and nothing at all unless the program has at least 3 approved residents (so a total can never be one person). Topics need 10 answers from
-- 3 residents and questions 5 answers from 3 residents. The wrong answer people pick most is shown only when at least 2 chose it.
-- days: only look at the last N days (0 or null = all time).
drop function if exists public.faculty_topics(int);
drop function if exists public.faculty_questions(int);
drop function if exists public.faculty_weekly();
drop function if exists public.preview_topics(text, int);
drop function if exists public.preview_questions(text, int);
drop function if exists public.preview_weekly(text);
drop function if exists public.preview_subject_trend(text, int);
drop function if exists public.faculty_subject_trend(int);
drop function if exists public._program_subject_trend(text, int);
drop function if exists public._program_topics(text, int);
drop function if exists public._program_questions(text, int);
drop function if exists public._program_weekly(text);
drop function if exists public._program_cohort_ok(text);

create or replace function public._program_cohort_ok(fp text) returns boolean
  language sql stable security definer set search_path = public as
$$ select count(*) >= 3 from public.profiles p where p.program_id = fp and p.program_status = 'approved' and p.role <> 'faculty' and p.active $$;

create or replace function public._program_topics(fp text, days int)
  returns table (subject text, topic text, attempts bigint, correct bigint, residents bigint, low_residents bigint, group_attempts bigint, group_correct bigint)
  language sql stable security definer set search_path = public as
$$
  with mem as (
    select p.id from public.profiles p where p.program_id = fp and p.program_status = 'approved' and p.role <> 'faculty' and p.active),
  a as (
    select t.user_id, q.subject, coalesce(nullif(btrim(q.topic), ''), '') as topic, t.ok
    from public.attempts t join public.questions q on q.id = t.question_id
    where not q.archived and q.status = 'reviewed' and (coalesce(days, 0) <= 0 or t.at >= now() - make_interval(days => days))),
  per_user as (
    select a.subject, a.topic, a.user_id, count(*) as n, count(*) filter (where a.ok) as c
    from a join mem on mem.id = a.user_id group by 1, 2, 3),
  prog as (
    select subject, topic, sum(n) as attempts, sum(c) as correct, count(*) as residents, count(*) filter (where n >= 3 and c * 100 < 60 * n) as low
    from per_user group by 1, 2),
  grp as (
    select a.subject, a.topic, count(*) as n, count(*) filter (where a.ok) as c
    from a join public.profiles pr on pr.id = a.user_id where pr.active and pr.role <> 'faculty' group by 1, 2)
  select p.subject, p.topic, p.attempts::bigint, p.correct::bigint, p.residents, p.low, g.n, g.c
  from prog p left join grp g on g.subject = p.subject and g.topic = p.topic
  where public._program_cohort_ok(fp) and p.residents >= 3 and p.attempts >= 10
$$;

create or replace function public._program_questions(fp text, days int)
  returns table (question_id text, subject text, topic text, stem text, attempts bigint, correct bigint, residents bigint,
                 group_attempts bigint, group_correct bigint, top_wrong text, top_wrong_n bigint, wrong_total bigint,
                 full_stem text, options jsonb, answer text, has_image boolean, top_pick text, top_pick_n bigint, pick_total bigint)
  language sql stable security definer set search_path = public as
$$
  with mem as (
    select p.id from public.profiles p where p.program_id = fp and p.program_status = 'approved' and p.role <> 'faculty' and p.active),
  a as (
    select t.user_id, t.question_id, t.ok, t.chosen from public.attempts t
    where coalesce(days, 0) <= 0 or t.at >= now() - make_interval(days => days)),
  prog as (
    select a.question_id, count(*) as n, count(*) filter (where a.ok) as c, count(distinct a.user_id) as r
    from a join mem on mem.id = a.user_id group by 1),
  wrong as (
    select a.question_id, a.chosen, count(*) as k from a join mem on mem.id = a.user_id where not a.ok and a.chosen is not null group by 1, 2),
  topw as (select distinct on (question_id) question_id, chosen, k from wrong order by question_id, k desc, chosen),
  wt as (select question_id, sum(k) as tot from wrong group by 1),
  picks as (select a.question_id, a.chosen, count(*) as k from a join mem on mem.id = a.user_id where a.chosen is not null group by 1, 2),
  topp as (select distinct on (question_id) question_id, chosen, k from picks order by question_id, k desc, chosen),
  pt as (select question_id, sum(k) as tot from picks group by 1),
  grp as (
    select a.question_id, count(*) as n, count(*) filter (where a.ok) as c
    from a join public.profiles pr on pr.id = a.user_id where pr.active and pr.role <> 'faculty' group by 1)
  select q.id, q.subject, coalesce(nullif(btrim(q.topic), ''), ''), left(q.stem, 220), p.n, p.c, p.r, g.n, g.c,
         case when t.k >= 2 then t.chosen end, case when t.k >= 2 then t.k end, w.tot::bigint,
         q.stem, q.options, q.answer, q.image is not null,
         case when tp.k >= 2 then tp.chosen end, case when tp.k >= 2 then tp.k end, ptot.tot::bigint
  from prog p
  join public.questions q on q.id = p.question_id and not q.archived and q.status = 'reviewed'
  left join grp g on g.question_id = p.question_id
  left join topw t on t.question_id = p.question_id
  left join wt w on w.question_id = p.question_id
  left join topp tp on tp.question_id = p.question_id
  left join pt ptot on ptot.question_id = p.question_id
  where public._program_cohort_ok(fp) and p.r >= 3 and p.n >= 5
  order by (p.c::numeric / p.n) asc, p.n desc, q.id
  limit 30
$$;

create or replace function public._program_weekly(fp text)
  returns table (week_start date, attempts bigint, correct bigint, active_residents bigint)
  language sql stable security definer set search_path = public as
$$
  select date_trunc('week', t.at)::date, count(*), count(*) filter (where t.ok), count(distinct t.user_id)
  from public.attempts t join public.profiles p on p.id = t.user_id
  where public._program_cohort_ok(fp) and p.program_id = fp and p.program_status = 'approved' and p.role <> 'faculty' and p.active
    and t.at >= date_trunc('week', now()) - interval '11 weeks'
  group by 1 order by 1
$$;

create or replace function public.faculty_topics(days int default 0)
  returns table (subject text, topic text, attempts bigint, correct bigint, residents bigint, low_residents bigint, group_attempts bigint, group_correct bigint)
  language plpgsql stable security definer set search_path = public as
$$
declare fp text := public.faculty_program_id();
begin
  if fp is null then raise exception 'faculty only'; end if;
  return query select * from public._program_topics(fp, days);
end $$;
create or replace function public.faculty_questions(days int default 0)
  returns table (question_id text, subject text, topic text, stem text, attempts bigint, correct bigint, residents bigint,
                 group_attempts bigint, group_correct bigint, top_wrong text, top_wrong_n bigint, wrong_total bigint,
                 full_stem text, options jsonb, answer text, has_image boolean, top_pick text, top_pick_n bigint, pick_total bigint)
  language plpgsql stable security definer set search_path = public as
$$
declare fp text := public.faculty_program_id();
begin
  if fp is null then raise exception 'faculty only'; end if;
  return query select * from public._program_questions(fp, days);
end $$;
create or replace function public.faculty_weekly()
  returns table (week_start date, attempts bigint, correct bigint, active_residents bigint)
  language plpgsql stable security definer set search_path = public as
$$
declare fp text := public.faculty_program_id();
begin
  if fp is null then raise exception 'faculty only'; end if;
  return query select * from public._program_weekly(fp);
end $$;
create or replace function public.preview_topics(pid text, days int default 0)
  returns table (subject text, topic text, attempts bigint, correct bigint, residents bigint, low_residents bigint, group_attempts bigint, group_correct bigint)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query select * from public._program_topics(pid, days);
end $$;
create or replace function public.preview_questions(pid text, days int default 0)
  returns table (question_id text, subject text, topic text, stem text, attempts bigint, correct bigint, residents bigint,
                 group_attempts bigint, group_correct bigint, top_wrong text, top_wrong_n bigint, wrong_total bigint,
                 full_stem text, options jsonb, answer text, has_image boolean, top_pick text, top_pick_n bigint, pick_total bigint)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query select * from public._program_questions(pid, days);
end $$;
create or replace function public.preview_weekly(pid text)
  returns table (week_start date, attempts bigint, correct bigint, active_residents bigint)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query select * from public._program_weekly(pid);
end $$;

-- How each subject is moving: the program's percent correct over the last N days against the N days before that (N from 7 to 365).
-- Group totals only, like the rest of the faculty analysis, and a subject needs at least three residents answering in the two
-- periods together before it is shown. Faculty and staff answers are left out; so are archived and draft questions.
create or replace function public._program_subject_trend(fp text, days int)
  returns table (subject text, recent_attempts bigint, recent_correct bigint, prev_attempts bigint, prev_correct bigint)
  language sql stable security definer set search_path = public as
$$
  with d as (select least(greatest(coalesce(days, 30), 7), 365) as n),
  mem as (
    select p.id from public.profiles p where p.program_id = fp and p.program_status = 'approved' and p.role <> 'faculty' and p.active),
  a as (
    select q.subject, t.user_id, t.ok, t.at >= now() - make_interval(days => d.n) as recent
    from public.attempts t
    join public.questions q on q.id = t.question_id
    join mem on mem.id = t.user_id
    cross join d
    where not q.archived and q.status = 'reviewed' and t.at >= now() - make_interval(days => 2 * d.n))
  select a.subject, count(*) filter (where a.recent), count(*) filter (where a.recent and a.ok),
         count(*) filter (where not a.recent), count(*) filter (where not a.recent and a.ok)
  from a group by a.subject
  having count(distinct a.user_id) >= 3 and public._program_cohort_ok(fp)
$$;
create or replace function public.faculty_subject_trend(days int default 30)
  returns table (subject text, recent_attempts bigint, recent_correct bigint, prev_attempts bigint, prev_correct bigint)
  language plpgsql stable security definer set search_path = public as
$$
declare fp text := public.faculty_program_id();
begin
  if fp is null then raise exception 'faculty only'; end if;
  return query select * from public._program_subject_trend(fp, days);
end $$;
create or replace function public.preview_subject_trend(pid text, days int default 30)
  returns table (subject text, recent_attempts bigint, recent_correct bigint, prev_attempts bigint, prev_correct bigint)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query select * from public._program_subject_trend(pid, days);
end $$;

-- A member can choose a name to show in place of their email wherever a program's faculty look at them. Optional; blank clears it.
create or replace function public.set_my_name(nm text) returns void
  language plpgsql security definer set search_path = public as
$$
declare v text := nullif(btrim(regexp_replace(coalesce(nm, ''), '\s+', ' ', 'g')), '');
begin
  if not public.is_active() then raise exception 'not active'; end if;
  if v is not null and char_length(v) > 60 then raise exception 'name too long'; end if;
  update public.profiles set display_name = v where id = auth.uid();
end $$;

-- Admins can do what a program's faculty do, for any program: approve, decline and remove.
create or replace function public.program_decide(pid text, uid uuid, approve boolean) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if approve then update public.profiles set program_status = 'approved' where id = uid and program_id = pid and program_status = 'pending';
  else update public.profiles set program_id = null, program_status = null where id = uid and program_id = pid and program_status = 'pending'; end if;
end $$;
create or replace function public.program_remove(pid text, uid uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.profiles set program_id = null, program_status = null where id = uid and program_id = pid and role <> 'faculty';
end $$;

create or replace function public.faculty_decide(uid uuid, approve boolean) returns void
  language plpgsql security definer set search_path = public as
$$
declare fp text := public.faculty_program_id();
begin
  if fp is null then raise exception 'faculty only'; end if;
  if approve then update public.profiles set program_status = 'approved' where id = uid and program_id = fp and program_status = 'pending';
  else update public.profiles set program_id = null, program_status = null where id = uid and program_id = fp and program_status = 'pending'; end if;
end $$;

create or replace function public.faculty_remove(uid uuid) returns void
  language plpgsql security definer set search_path = public as
$$
declare fp text := public.faculty_program_id();
begin
  if fp is null then raise exception 'faculty only'; end if;
  update public.profiles set program_id = null, program_status = null where id = uid and program_id = fp and role <> 'faculty';
end $$;

-- ------------------------------------------------------------ feedback and support conversations
create or replace function public.feedback_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null then return new; end if;
  new.status := 'new'; new.admin_note := null; new.updated_at := now();      -- a member cannot mark their own message
  new.member_unread := false; new.last_activity := now();
  if new.kind = 'support' then new.question_id := null; new.category := 'other'; new.subject := coalesce(nullif(trim(new.subject), ''), 'Support'); else new.subject := null; end if;
  if (select count(*) from public.feedback where user_id = auth.uid() and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'too many messages today';
  end if;
  return new;
end $$;
drop trigger if exists feedback_guard on public.feedback;
create trigger feedback_guard before insert on public.feedback for each row execute function public.feedback_guard();

-- the team's view: every conversation, newest activity first. Only admins see who sent it.
drop function if exists public.feedback_inbox();
create function public.feedback_inbox()
  returns table (id bigint, kind text, subject text, question_id text, question_stem text, category text, message text, context text, status text, admin_note text,
                 created_at timestamptz, last_activity timestamptz, replies int, reporter text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  return query
    select f.id, f.kind, f.subject, f.question_id, left(q.stem, 140), f.category, f.message, f.context, f.status, f.admin_note, f.created_at, f.last_activity,
           (select count(*)::int from public.feedback_messages m where m.feedback_id = f.id),
           case when public.is_admin() then p.email end
    from public.feedback f left join public.questions q on q.id = f.question_id left join public.profiles p on p.id = f.user_id
    order by f.last_activity desc limit 500;
end $$;

create or replace function public.feedback_unread_count() returns int
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.can_edit() then return 0; end if;
  return (select count(*)::int from public.feedback where status = 'new');
end $$;

create or replace function public.feedback_set(fid bigint, new_status text, note text default null) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  if new_status not in ('new', 'read', 'resolved') then raise exception 'unknown status'; end if;
  update public.feedback set status = new_status, admin_note = coalesce(note, admin_note), updated_at = now() where id = fid;
end $$;

-- the whole conversation, for the team. The first message is the member's; later ones say who wrote them (admins see which teammate).
create or replace function public.thread_messages(fid bigint)
  returns table (sender text, message text, created_at timestamptz, author text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  return query
    select 'member'::text, f.message, f.created_at, null::text from public.feedback f where f.id = fid
    union all
    select m.sender, m.message, m.created_at, case when m.sender = 'team' and public.is_admin() then p.email end
    from public.feedback_messages m left join public.profiles p on p.id = m.author_id where m.feedback_id = fid
    order by 3;
end $$;

-- a reply from the team: the member is told (member_unread), and it moves out of "new"
create or replace function public.thread_team_reply(fid bigint, msg text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  if char_length(trim(msg)) < 1 or char_length(msg) > 1500 then raise exception 'a reply must be 1 to 1500 characters'; end if;
  if not exists (select 1 from public.feedback where id = fid) then raise exception 'no such conversation'; end if;
  insert into public.feedback_messages (feedback_id, sender, author_id, message) values (fid, 'team', auth.uid(), trim(msg));
  update public.feedback set member_unread = true, last_activity = now(), updated_at = now(), status = case when status = 'new' then 'read' else status end where id = fid;
end $$;

-- the member's side: their own conversations only
create or replace function public.my_threads()
  returns table (id bigint, kind text, subject text, question_id text, first_message text, created_at timestamptz, last_activity timestamptz, status text, member_unread boolean, replies int)
  language sql stable security definer set search_path = public as
$$
  select f.id, f.kind, f.subject, f.question_id, f.message, f.created_at, f.last_activity, f.status, f.member_unread,
         (select count(*)::int from public.feedback_messages m where m.feedback_id = f.id)
  from public.feedback f where f.user_id = auth.uid() and public.is_active() order by f.last_activity desc limit 200
$$;

create or replace function public.my_thread_messages(fid bigint) returns table (sender text, message text, created_at timestamptz)
  language sql stable security definer set search_path = public as
$$
  select 'member'::text, f.message, f.created_at from public.feedback f where f.id = fid and f.user_id = auth.uid() and public.is_active()
  union all
  select m.sender, m.message, m.created_at from public.feedback_messages m join public.feedback f on f.id = m.feedback_id where f.id = fid and f.user_id = auth.uid() and public.is_active()
  order by 3
$$;

create or replace function public.my_thread_seen(fid bigint) returns void
  language sql security definer set search_path = public as
$$ update public.feedback set member_unread = false where id = fid and user_id = auth.uid() and member_unread $$;

create or replace function public.my_unread_replies() returns int
  language sql stable security definer set search_path = public as
$$ select count(*)::int from public.feedback where user_id = auth.uid() and member_unread and public.is_active() $$;

create or replace function public.thread_member_reply(fid bigint, msg text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_active() then raise exception 'not active'; end if;
  if not exists (select 1 from public.feedback where id = fid and user_id = auth.uid()) then raise exception 'no such conversation'; end if;
  if char_length(trim(msg)) < 1 or char_length(msg) > 1500 then raise exception 'a reply must be 1 to 1500 characters'; end if;
  if (select count(*) from public.feedback_messages where author_id = auth.uid() and sender = 'member' and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'too many messages today';
  end if;
  insert into public.feedback_messages (feedback_id, sender, author_id, message) values (fid, 'member', auth.uid(), trim(msg));
  update public.feedback set status = 'new', last_activity = now(), updated_at = now() where id = fid;      -- back to the top of the team's inbox
end $$;

-- ------------------------------------------------------------ group averages (like the percentages UWorld shows)
-- Only aggregate numbers leave the database: how many members got a question right on their first try, and how many picked each choice.
-- A figure shows once at least N different active members have answered the question. N is chosen by an admin and starts at 1, so figures show
-- however few members have answered (with a very small group a figure can reflect one or two people). Raise N in Admin > Overview to hold small
-- groups back. Each member's FIRST try counts.
insert into public.app_settings (key, value) values ('peer_min_users', '1') on conflict (key) do nothing;
-- One time: groups used to need 10 members. Move an existing setting to 1, once, and remember that it was done so a later choice by an admin is kept.
do $$ begin
  if not exists (select 1 from public.app_settings where key = 'peer_min_users_moved_to_1') then
    update public.app_settings set value = '1' where key = 'peer_min_users';
    insert into public.app_settings (key, value) values ('peer_min_users_moved_to_1', 'true');
  end if;
end $$;

create or replace function public.peer_min_users() returns int
  language sql stable security definer set search_path = public as
$$ select greatest(1, coalesce((select (value)::text::int from public.app_settings where key = 'peer_min_users'), 1)) $$;

create or replace function public.set_peer_min_users(n int) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if n < 1 or n > 1000 then raise exception 'choose a number from 1 to 1000'; end if;
  insert into public.app_settings (key, value) values ('peer_min_users', to_jsonb(n))
    on conflict (key) do update set value = excluded.value;
end $$;

create or replace function public.peer_stats() returns table (question_id text, users int, pct_correct numeric)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_active() then return; end if;
  return query
  with first_try as (
    select distinct on (a.user_id, a.question_id) a.user_id, a.question_id as qid, a.ok
    from public.attempts a join public.profiles p on p.id = a.user_id and p.active and p.role <> 'faculty'     -- faculty try questions to test them, so they are kept out of the group figures
    order by a.user_id, a.question_id, a.at, a.id
  )
  select f.qid, count(*)::int, round(100.0 * count(*) filter (where f.ok) / count(*), 0)
  from first_try f join public.questions q on q.id = f.qid
  where not q.archived and q.status = 'reviewed' and public.has_plan(q.tier)
  group by f.qid having count(*) >= public.peer_min_users();
end $$;

-- Which options members picked (shown as percentages after answering). Same rules as the group averages: first tries only,
-- and nothing is released until at least the minimum number of members have a recorded pick for that question.
create or replace function public.peer_choices() returns table (question_id text, chosen text, picks int, total int)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_active() then return; end if;
  return query
  with first_try as (
    select distinct on (a.user_id, a.question_id) a.user_id, a.question_id as qid, a.chosen
    from public.attempts a join public.profiles p on p.id = a.user_id and p.active and p.role <> 'faculty'
    order by a.user_id, a.question_id, a.at, a.id
  ), counted as (
    select f.qid, f.chosen as pick, count(*)::int as n, sum(count(*)) over (partition by f.qid)::int as tot
    from first_try f join public.questions q on q.id = f.qid
    where f.chosen is not null and not q.archived and q.status = 'reviewed' and public.has_plan(q.tier)
    group by f.qid, f.chosen
  )
  select c.qid, c.pick, c.n, c.tot from counted c where c.tot >= public.peer_min_users();
end $$;

-- If a question's answer choices are rewritten, earlier picks no longer describe the same options, so they are cleared.
create or replace function public.questions_options_changed() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if new.options is distinct from old.options then update public.attempts set chosen = null where question_id = new.id and chosen is not null; end if;
  return new;
end $$;
drop trigger if exists questions_options_changed on public.questions;
create trigger questions_options_changed after update of options on public.questions
  for each row execute function public.questions_options_changed();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_active(), public.is_admin(), public.can_edit(), public.has_plan(text) to authenticated;
grant execute on function public.my_progress(), public.touch_seen(), public.reset_my_progress() to authenticated;
grant execute on function public.admin_member_summary(), public.admin_question_stats(), public.admin_item_analysis(boolean, boolean) to authenticated;
grant execute on function public.admin_recent_activity(int[]) to authenticated;
grant execute on function public.signup_open() to anon, authenticated;
grant execute on function public.feedback_inbox(), public.feedback_unread_count() to authenticated;
grant execute on function public.feedback_set(bigint, text, text) to authenticated;
grant execute on function public.thread_messages(bigint), public.thread_team_reply(bigint, text) to authenticated;
grant execute on function public.my_threads(), public.my_thread_messages(bigint), public.my_thread_seen(bigint), public.my_unread_replies(), public.thread_member_reply(bigint, text) to authenticated;
grant execute on function public.program_list() to anon, authenticated;
grant execute on function public.my_program(), public.leave_program(), public.faculty_program_id(), public.faculty_roster(), public.faculty_subject_stats() to authenticated;
grant execute on function public.set_my_name(text) to authenticated;
grant execute on function public.preview_roster(text), public.preview_subjects(text), public.program_decide(text, uuid, boolean), public.program_remove(text, uuid) to authenticated;
grant execute on function public.faculty_topics(int), public.faculty_questions(int), public.faculty_weekly(), public.preview_topics(text, int), public.preview_questions(text, int), public.preview_weekly(text) to authenticated;
grant execute on function public.faculty_subject_trend(int), public.preview_subject_trend(text, int) to authenticated;
grant execute on function public.request_program(text), public.faculty_decide(uuid, boolean), public.faculty_remove(uuid) to authenticated;
grant execute on function public.peer_stats(), public.peer_choices(), public.peer_min_users() to authenticated;
grant execute on function public.set_peer_min_users(int) to authenticated;
grant execute on function public.set_signup_open(boolean) to authenticated;
