-- Reviewers now send their changes to an admin instead of publishing them (change_requests), and no longer see the member inbox.
-- Safe to run again. Run it in the Supabase SQL Editor (or paste the whole supabase/schema.sql).

drop policy if exists questions_editor_read on public.questions;
drop policy if exists questions_edit        on public.questions;
create policy questions_editor_read on public.questions for select to authenticated using (public.can_edit());
create policy questions_edit on public.questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists lessons_editor_read on public.lessons;
drop policy if exists lessons_edit        on public.lessons;
create policy lessons_editor_read on public.lessons for select to authenticated using (public.can_edit());
create policy lessons_edit on public.lessons for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists cards_editor_read on public.flashcards;
drop policy if exists cards_edit        on public.flashcards;
create policy cards_editor_read on public.flashcards for select to authenticated using (public.can_edit());
create policy cards_edit on public.flashcards for all to authenticated using (public.is_admin()) with check (public.is_admin());

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
     and coalesce(current_setting('app.approving', true), '') <> 'on'
     and (new.stem, new.options, new.answer, new.explanation, new.option_notes, new.refs, new.image, new.image_alt, new.subject, new.boards)
         is distinct from (old.stem, old.options, old.answer, old.explanation, old.option_notes, old.refs, old.image, old.image_alt, old.subject, old.boards)
  then new.status := 'draft'; end if;      -- (the difficulty and topic labels are advice and filing, not wording, so changing them keeps a question live)
  if new.status <> 'reviewed' then new.reviewed_by := null;
  elsif tg_op = 'INSERT' or old.status <> 'reviewed' then new.reviewed_by := who;      -- whoever marks it reviewed
  else new.reviewed_by := old.reviewed_by; end if;                                      -- nobody can rewrite it later
  return new;
end $$;

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
     and coalesce(current_setting('app.approving', true), '') <> 'on'
     and (new.title, new.summary, new.blocks, new.refs, new.subject, new.boards)
         is distinct from (old.title, old.summary, old.blocks, old.refs, old.subject, old.boards)
  then new.status := 'draft'; end if;
  if new.status <> 'reviewed' then new.reviewed_by := null;
  elsif tg_op = 'INSERT' or old.status <> 'reviewed' then new.reviewed_by := who;
  else new.reviewed_by := old.reviewed_by; end if;
  return new;
end $$;

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
     and coalesce(current_setting('app.approving', true), '') <> 'on'
     and (new.front, new.back, new.refs, new.subject, new.boards, new.lesson_id)
         is distinct from (old.front, old.back, old.refs, old.subject, old.boards, old.lesson_id)
  then new.status := 'draft'; end if;      -- (the topic label is filing, not wording, so changing it keeps a card live)
  if new.status <> 'reviewed' then new.reviewed_by := null;
  elsif tg_op = 'INSERT' or old.status <> 'reviewed' then new.reviewed_by := who;
  else new.reviewed_by := old.reviewed_by; end if;
  return new;
end $$;

drop function if exists public.feedback_inbox();
create function public.feedback_inbox()
  returns table (id bigint, kind text, subject text, question_id text, question_stem text, category text, message text, context text, status text, admin_note text,
                 created_at timestamptz, last_activity timestamptz, replies int, reporter text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
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
  if not public.is_admin() then return 0; end if;
  return (select count(*)::int from public.feedback where status = 'new');
end $$;

create or replace function public.feedback_set(fid bigint, new_status text, note text default null) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if new_status not in ('new', 'read', 'resolved') then raise exception 'unknown status'; end if;
  update public.feedback set status = new_status, admin_note = coalesce(note, admin_note), updated_at = now() where id = fid;
end $$;

create or replace function public.thread_messages(fid bigint)
  returns table (sender text, message text, created_at timestamptz, author text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select 'member'::text, f.message, f.created_at, null::text from public.feedback f where f.id = fid
    union all
    select m.sender, m.message, m.created_at, case when m.sender = 'team' and public.is_admin() then p.email end
    from public.feedback_messages m left join public.profiles p on p.id = m.author_id where m.feedback_id = fid
    order by 3;
end $$;

create or replace function public.thread_team_reply(fid bigint, msg text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if char_length(trim(msg)) < 1 or char_length(msg) > 1500 then raise exception 'a reply must be 1 to 1500 characters'; end if;
  if not exists (select 1 from public.feedback where id = fid) then raise exception 'no such conversation'; end if;
  insert into public.feedback_messages (feedback_id, sender, author_id, message) values (fid, 'team', auth.uid(), trim(msg));
  update public.feedback set member_unread = true, last_activity = now(), updated_at = now(), status = case when status = 'new' then 'read' else status end where id = fid;
end $$;

-- ============================================================ reviewer changes wait for an admin
-- A reviewer can read everything, but cannot change what members see. Their edits and new items are sent to change_requests as a
-- PROPOSAL; an admin accepts it (as written, or after editing it) or rejects it. Only then does it reach the live tables.
create table if not exists public.change_requests (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('question', 'lesson', 'card')),
  item_id         text not null,
  action          text not null check (action in ('new', 'edit')),
  payload         jsonb not null,                     -- the whole proposed row, in the same shape the editors save
  base_updated_at timestamptz,                        -- when the live item was last saved, as the reviewer saw it (null for a new item)
  author_id       uuid default auth.uid() references auth.users (id) on delete set null,
  author_email    text,
  note            text not null default '',           -- the reviewer's note to the admin
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decision_note   text not null default '',           -- what the admin said back
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      text
);
-- one open proposal per reviewer per item: saving again replaces it
create unique index if not exists change_requests_open on public.change_requests (author_id, kind, item_id) where status = 'pending';
create index if not exists change_requests_status on public.change_requests (status, created_at desc);
alter table public.change_requests enable row level security;
drop policy if exists change_read on public.change_requests;
create policy change_read on public.change_requests for select to authenticated using (public.is_admin() or author_id = auth.uid());
grant select on public.change_requests to authenticated;        -- no direct writes: the functions below are the only way in

create or replace function public.change_table(k text) returns text
  language sql immutable set search_path = public as
$$ select case k when 'question' then 'questions' when 'lesson' then 'lessons' when 'card' then 'flashcards' end $$;

-- the keys a proposal may never carry: the database fills these in itself
create or replace function public.change_clean(p jsonb) returns jsonb
  language sql immutable set search_path = public as
$$ select coalesce(p, '{}'::jsonb) - 'created_at' - 'updated_at' - 'updated_by' - 'revised_at' - 'reviewed_by' $$;

-- A reviewer (or an admin looking at the app as one) sends an edit or a new item. A reviewer cannot publish, hide or archive anything
-- this way: a new item always arrives as a draft, and an edit keeps the status and archive state the live item has now.
create or replace function public.submit_change(p_kind text, p_item_id text, p_action text, p_payload jsonb, p_note text default '') returns bigint
  language plpgsql security definer set search_path = public as
$$
declare tbl text := public.change_table(p_kind); pay jsonb := public.change_clean(p_payload); st text; arch boolean; base timestamptz; who text; rid bigint; n int;
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  if tbl is null then raise exception 'unknown kind'; end if;
  if p_action not in ('new', 'edit') then raise exception 'unknown action'; end if;
  if jsonb_typeof(pay) <> 'object' or pay->>'id' is distinct from p_item_id or char_length(coalesce(p_item_id, '')) not between 1 and 120 then raise exception 'the proposal does not match the item'; end if;
  if char_length(pay::text) > 400000 then raise exception 'the proposal is too large'; end if;
  if char_length(coalesce(p_note, '')) > 2000 then raise exception 'the note is too long'; end if;
  if p_action = 'new' then
    execute format('select count(*) from public.%I where id = $1', tbl) into n using p_item_id;
    if n > 0 then raise exception 'an item with the id % already exists', p_item_id; end if;
    if exists (select 1 from public.change_requests where kind = p_kind and item_id = p_item_id and action = 'new' and status = 'pending' and author_id is distinct from auth.uid())
      then raise exception 'someone else has already proposed an item with the id %', p_item_id; end if;
    pay := pay || jsonb_build_object('status', 'draft', 'archived', false);
    base := null;
  else
    execute format('select status, archived, updated_at from public.%I where id = $1', tbl) into st, arch, base using p_item_id;
    if st is null then raise exception 'that item no longer exists'; end if;
    pay := pay || jsonb_build_object('status', st, 'archived', arch);
  end if;
  select email into who from public.profiles where id = auth.uid();
  insert into public.change_requests (kind, item_id, action, payload, base_updated_at, author_id, author_email, note)
    values (p_kind, p_item_id, p_action, pay, base, auth.uid(), who, coalesce(p_note, ''))
    on conflict (author_id, kind, item_id) where status = 'pending'
    do update set payload = excluded.payload, base_updated_at = excluded.base_updated_at, note = excluded.note, action = excluded.action, created_at = now()
    returning id into rid;
  return rid;
end $$;

-- the writer takes their own open proposal back
create or replace function public.withdraw_change(p_id bigint) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.can_edit() then raise exception 'editors only'; end if;
  delete from public.change_requests where id = p_id and author_id = auth.uid() and status = 'pending';
end $$;

-- Admin: accept a proposal. p_payload is the admin's own edited version (null accepts it as written); p_status 'draft' or 'reviewed' sets the
-- state it lands in (null keeps what the proposal says). While this runs, changing the wording of a live item does not send it back to draft,
-- because the admin is the reviewer.
create or replace function public.accept_change(p_id bigint, p_payload jsonb default null, p_status text default null, p_note text default '') returns void
  language plpgsql security definer set search_path = public as
$$
declare r public.change_requests; tbl text; pay jsonb; cols text; sets text; who text; n int;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into r from public.change_requests where id = p_id for update;
  if not found then raise exception 'no such change'; end if;
  if r.status <> 'pending' then raise exception 'that change was already decided'; end if;
  tbl := public.change_table(r.kind);
  pay := public.change_clean(coalesce(p_payload, r.payload));
  if pay->>'id' is distinct from r.item_id then raise exception 'the id cannot be changed'; end if;
  if p_status is not null then
    if p_status not in ('draft', 'reviewed') then raise exception 'unknown status'; end if;
    pay := pay || jsonb_build_object('status', p_status);
  end if;
  if r.action = 'new' then
    execute format('select count(*) from public.%I where id = $1', tbl) into n using r.item_id;
    if n > 0 then raise exception 'an item with the id % already exists now', r.item_id; end if;
  end if;
  select string_agg(quote_ident(k), ', ') into cols
    from jsonb_object_keys(pay) k
    where exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = tbl and c.column_name = k);
  perform set_config('app.approving', 'on', true);
  if r.action = 'new' then
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', tbl, cols, cols, tbl) using pay;
  else      -- an edit changes only the fields it carries
    select string_agg(quote_ident(k) || ' = n.' || quote_ident(k), ', ') into sets
      from jsonb_object_keys(pay) k
      where k <> 'id' and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = tbl and c.column_name = k);
    if sets is not null then
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) n where t.id = $2', tbl, sets, tbl) using pay, r.item_id;
    end if;
  end if;
  perform set_config('app.approving', 'off', true);
  select email into who from public.profiles where id = auth.uid();
  update public.change_requests set status = 'accepted', decided_at = now(), decided_by = who, decision_note = left(coalesce(p_note, ''), 2000),
    payload = pay where id = p_id;
end $$;

create or replace function public.reject_change(p_id bigint, p_note text default '') returns void
  language plpgsql security definer set search_path = public as
$$
declare who text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select email into who from public.profiles where id = auth.uid();
  update public.change_requests set status = 'rejected', decided_at = now(), decided_by = who, decision_note = left(coalesce(p_note, ''), 2000)
    where id = p_id and status = 'pending';
  if not found then raise exception 'that change was already decided or does not exist'; end if;
end $$;

-- the number on the menu: all open proposals for an admin, a reviewer's own open ones for a reviewer
create or replace function public.pending_change_count() returns int
  language sql stable security definer set search_path = public as
$$ select case when public.is_admin() then (select count(*)::int from public.change_requests where status = 'pending')
               when public.can_edit() then (select count(*)::int from public.change_requests where status = 'pending' and author_id = auth.uid())
               else 0 end $$;

revoke execute on function public.submit_change(text, text, text, jsonb, text), public.withdraw_change(bigint), public.accept_change(bigint, jsonb, text, text),
  public.reject_change(bigint, text), public.pending_change_count(), public.change_table(text), public.change_clean(jsonb) from public, anon;
grant execute on function public.submit_change(text, text, text, jsonb, text), public.withdraw_change(bigint),
  public.accept_change(bigint, jsonb, text, text), public.reject_change(bigint, text), public.pending_change_count() to authenticated;

grant execute on function public.feedback_inbox(), public.feedback_unread_count(), public.feedback_set(bigint, text, text), public.thread_messages(bigint), public.thread_team_reply(bigint, text) to authenticated;
notify pgrst, 'reload schema';
