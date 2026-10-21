-- Clinical skills bank (questions and lessons). Safe to run more than once; run it in the Supabase SQL Editor.
-- The bank values are 'main' (board prep, the default) and 'skills'. Do not use any other value: the app and the check constraints expect exactly these two.

alter table public.questions add column if not exists bank text not null default 'main';
alter table public.questions drop constraint if exists questions_bank_check;
alter table public.questions add constraint questions_bank_check check (bank in ('main', 'skills'));

create table if not exists public.skill_attempts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete cascade,
  ok          boolean not null,
  client_id   text not null,
  at          timestamptz not null default now(),
  chosen      text check (chosen is null or char_length(chosen) between 1 and 3),
  unique (user_id, client_id)
);
create index if not exists skill_attempts_user_idx on public.skill_attempts (user_id, question_id);
alter table public.skill_attempts enable row level security;

create or replace function public.is_skills_question(qid text) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.questions where id = qid and bank = 'skills') $$;

drop policy if exists attempts_insert    on public.attempts;

create policy attempts_insert on public.attempts       for insert to authenticated
  with check (user_id = auth.uid() and public.is_active() and at <= now() + interval '5 minutes' and not public.is_skills_question(question_id));    -- skills answers go in skill_attempts

drop policy if exists skill_attempts_read   on public.skill_attempts;
drop policy if exists skill_attempts_insert on public.skill_attempts;
create policy skill_attempts_read   on public.skill_attempts for select to authenticated using (user_id = auth.uid() and public.is_active());
create policy skill_attempts_insert on public.skill_attempts for insert to authenticated
  with check (user_id = auth.uid() and public.is_active() and at <= now() + interval '5 minutes' and public.is_skills_question(question_id));

grant select, insert on public.skill_attempts to authenticated;

create or replace function public.my_skills_progress()
  returns table (question_id text, seen int, correct int, wrong int, last_ok boolean)
  language sql stable security invoker set search_path = public as
$$
  select a.question_id, count(*)::int, (count(*) filter (where a.ok))::int, (count(*) filter (where not a.ok))::int,
         (array_agg(a.ok order by a.at desc, a.id desc))[1]
  from public.skill_attempts a where a.user_id = auth.uid() group by a.question_id
$$;

grant execute on function public.my_skills_progress(), public.is_skills_question(text) to authenticated;

drop function if exists public.admin_question_stats();
create function public.admin_question_stats()
  returns table (question_id text, subject text, status text, archived boolean, attempts bigint, correct bigint, pct_correct numeric, bank text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  return query
    with ans as (
      select a.question_id as qid, a.ok from public.attempts a
        where not exists (select 1 from public.profiles f where f.id = a.user_id and f.role = 'faculty')   -- faculty tests are not residents' performance
      union all
      select k.question_id, k.ok from public.skill_attempts k                                              -- a skills question's own answers, shown only on its own row
    )
    select q.id, q.subject, q.status, q.archived, count(a.qid), count(a.qid) filter (where a.ok),
           case when count(a.qid) = 0 then null else round(100.0 * count(a.qid) filter (where a.ok) / count(a.qid), 1) end, q.bank
    from public.questions q left join ans a on a.qid = q.id
    group by q.id order by q.id;
end $$;
grant execute on function public.admin_question_stats() to authenticated;

-- Lessons carry the same bank column.
alter table public.lessons add column if not exists bank text not null default 'main';
alter table public.lessons drop constraint if exists lessons_bank_check;
alter table public.lessons add constraint lessons_bank_check check (bank in ('main', 'skills'));

-- Make the API see the new columns and functions straight away (otherwise: "Could not find the 'bank' column ... in the schema cache").
notify pgrst, 'reload schema';
