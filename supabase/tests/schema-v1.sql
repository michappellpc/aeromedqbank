-- Ram QBank database. Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.
-- Safe to re-run: it only creates what is missing and replaces functions/policies.
--
-- The privacy model
--   * Nobody can read anything unless they are signed in AND their email is on the allowed_emails list.
--   * Members only ever see their own progress. Only admins can see everyone's, through the admin_* functions.
--   * Questions are readable by active members whose plan covers the question's tier ('free' or 'pro').
--   * The questions themselves are written only by the upload tool (service key) or an admin.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- people
create table if not exists public.allowed_emails (
  email    text primary key check (email = lower(email)),
  role     text not null default 'member' check (role in ('member', 'admin')),
  plan     text not null default 'pro'    check (plan in ('free', 'pro')),
  note     text,
  added_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  role         text not null default 'member' check (role in ('member', 'admin')),
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
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------- per-person data
create table if not exists public.attempts (          -- one row per answered question; never edited
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete cascade,
  ok          boolean not null,
  client_id   text not null,                            -- makes retries harmless
  at          timestamptz not null default now(),
  unique (user_id, client_id)
);
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

create or replace function public.has_plan(t text) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active
                  and (t = 'free' or p.plan = 'pro' or p.role = 'admin')) $$;

-- ------------------------------------------- keep profiles in step with the allow list
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  insert into public.profiles (id, email, active, role, plan)
  select new.id, lower(new.email), a.email is not null, coalesce(a.role, 'member'), coalesce(a.plan, 'free')
  from (select 1) s left join public.allowed_emails a on a.email = lower(new.email);
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
    update public.profiles set active = false, role = 'member', plan = 'free' where lower(email) = old.email;
    return old;
  end if;
  update public.profiles set active = true, role = new.role, plan = new.plan where lower(email) = new.email;
  return new;
end $$;

drop trigger if exists on_allowed_change on public.allowed_emails;
create trigger on_allowed_change after insert or update or delete on public.allowed_emails
  for each row execute function public.sync_allowed();

-- ------------------------------------------------------------- row security
alter table public.allowed_emails  enable row level security;
alter table public.profiles        enable row level security;
alter table public.questions       enable row level security;
alter table public.attempts        enable row level security;
alter table public.question_marks  enable row level security;
alter table public.tests           enable row level security;
alter table public.user_settings   enable row level security;

drop policy if exists allowed_admin      on public.allowed_emails;
drop policy if exists profiles_read      on public.profiles;
drop policy if exists questions_read     on public.questions;
drop policy if exists questions_admin    on public.questions;
drop policy if exists attempts_read      on public.attempts;
drop policy if exists attempts_insert    on public.attempts;
drop policy if exists marks_own          on public.question_marks;
drop policy if exists tests_own          on public.tests;
drop policy if exists settings_own       on public.user_settings;

create policy allowed_admin   on public.allowed_emails for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_read   on public.profiles       for select to authenticated using (id = auth.uid() or public.is_admin());
create policy questions_read  on public.questions      for select to authenticated using (public.has_plan(tier));
create policy questions_admin on public.questions      for all    to authenticated using (public.is_admin()) with check (public.is_admin());
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
         and exists (select 1 from public.questions q where q.image = 'private:' || storage.objects.name));

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
end $$;

-- admin-only summaries (raise an error for everyone else)
create or replace function public.admin_member_summary()
  returns table (user_id uuid, email text, display_name text, role text, plan text, active boolean,
                 attempts bigint, correct bigint, last_active timestamptz)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select p.id, p.email, p.display_name, p.role, p.plan, p.active,
           count(a.id), count(a.id) filter (where a.ok), greatest(max(a.at), p.last_seen)
    from public.profiles p left join public.attempts a on a.user_id = p.id
    group by p.id order by p.email;
end $$;

create or replace function public.admin_question_stats()
  returns table (question_id text, subject text, status text, attempts bigint, correct bigint, pct_correct numeric)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select q.id, q.subject, q.status, count(a.id), count(a.id) filter (where a.ok),
           case when count(a.id) = 0 then null else round(100.0 * count(a.id) filter (where a.ok) / count(a.id), 1) end
    from public.questions q left join public.attempts a on a.question_id = q.id
    group by q.id order by q.id;
end $$;

grant execute on function public.is_active(), public.is_admin(), public.has_plan(text) to authenticated;
grant execute on function public.my_progress(), public.touch_seen(), public.reset_my_progress() to authenticated;
grant execute on function public.admin_member_summary(), public.admin_question_stats() to authenticated;
