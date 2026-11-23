-- Hardening against abuse: picture bucket limits and rights, row size limits, and daily volume caps. Safe to run again; run it in the Supabase SQL Editor.

-- ============================================================ hardening against abuse (safe to run again)
-- 1. Pictures: the bucket itself refuses anything but small images; editors may add pictures, only admins may replace or delete them.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'] where id = 'question-images';
  end if;
end $$;
drop policy if exists question_images_edit  on storage.objects;
drop policy if exists question_images_add   on storage.objects;
drop policy if exists question_images_admin on storage.objects;
drop policy if exists question_images_drop  on storage.objects;
drop policy if exists question_images_editor_read on storage.objects;
create policy question_images_editor_read on storage.objects for select to authenticated using (bucket_id = 'question-images' and public.can_edit());   -- editors see every picture, attached or not
create policy question_images_add   on storage.objects for insert to authenticated with check (bucket_id = 'question-images' and public.can_edit());
create policy question_images_admin on storage.objects for update to authenticated using (bucket_id = 'question-images' and public.is_admin()) with check (bucket_id = 'question-images' and public.is_admin());
create policy question_images_drop  on storage.objects for delete to authenticated using (bucket_id = 'question-images' and public.is_admin());

-- 2. Sizes: no row a member writes can be unreasonably large (new rows only; existing rows are left alone).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attempts_client_id_len') then alter table public.attempts add constraint attempts_client_id_len check (char_length(client_id) <= 80) not valid; end if;
  if not exists (select 1 from pg_constraint where conname = 'skill_attempts_client_id_len') then alter table public.skill_attempts add constraint skill_attempts_client_id_len check (char_length(client_id) <= 80) not valid; end if;
  if not exists (select 1 from pg_constraint where conname = 'tests_sane') then alter table public.tests add constraint tests_sane check (char_length(id) <= 80 and cardinality(qids) between 1 and 400 and total between 1 and 400 and correct between 0 and total and seconds between 0 and 172800 and pg_column_size(answers) <= 65536) not valid; end if;
  if not exists (select 1 from pg_constraint where conname = 'user_settings_size') then alter table public.user_settings add constraint user_settings_size check (pg_column_size(data) <= 524288) not valid; end if;
end $$;

-- 3. Volume: a person cannot write more than a human could in a day (the upload tool, with no signed-in user, is not limited). Messages and replies already have their own daily caps.
create or replace function public.volume_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'attempts' then
    select count(*) into n from public.attempts where user_id = auth.uid() and at > now() - interval '24 hours';
    if n >= 4000 then raise exception 'too many answers today'; end if;
  elsif tg_table_name = 'skill_attempts' then
    select count(*) into n from public.skill_attempts where user_id = auth.uid() and at > now() - interval '24 hours';
    if n >= 4000 then raise exception 'too many answers today'; end if;
  elsif tg_table_name = 'tests' then
    select count(*) into n from public.tests where user_id = auth.uid() and taken_at > now() - interval '24 hours';
    if n >= 300 then raise exception 'too many tests today'; end if;
  end if;
  return new;
end $$;
drop trigger if exists volume_guard on public.attempts;
create trigger volume_guard before insert on public.attempts for each row execute function public.volume_guard();
drop trigger if exists volume_guard on public.skill_attempts;
create trigger volume_guard before insert on public.skill_attempts for each row execute function public.volume_guard();
drop trigger if exists volume_guard on public.tests;
create trigger volume_guard before insert on public.tests for each row execute function public.volume_guard();

notify pgrst, 'reload schema';
