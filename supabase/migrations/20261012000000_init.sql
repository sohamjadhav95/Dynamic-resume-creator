-- Resume Tailor: initial schema.
-- Every table has Row Level Security: a signed-in user can only see and change their own rows.


-- One "master" resume per user: everything they have ever done.
create table if not exists public.master_resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- One row per job they tailored for.
create table if not exists public.tailored_resumes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  job_title        text not null default '',
  company          text not null default '',
  job_description  text not null default '' check (char_length(job_description) <= 20000),
  data             jsonb not null,
  insights         jsonb not null default '{}'::jsonb,  -- keywords, project ideas, advice
  match_score      int,
  engine           text not null default 'offline',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists tailored_resumes_user_idx on public.tailored_resumes (user_id, updated_at desc);

-- AI usage log for daily limits. Only the API (service role) touches this table.
create table if not exists public.usage_events (
  id          bigint generated always as identity primary key,
  subject     text not null,          -- 'user:<uuid>' or 'ip:<salted hash>'
  kind        text not null,          -- tailor | rewrite | parse
  created_at  timestamptz not null default now()
);
create index if not exists usage_events_lookup_idx on public.usage_events (subject, kind, created_at desc);

-- Keep updated_at fresh.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists master_resumes_touch on public.master_resumes;
create trigger master_resumes_touch before update on public.master_resumes
  for each row execute function public.touch_updated_at();
drop trigger if exists tailored_resumes_touch on public.tailored_resumes;
create trigger tailored_resumes_touch before update on public.tailored_resumes
  for each row execute function public.touch_updated_at();

-- Row Level Security
alter table public.master_resumes   enable row level security;
alter table public.tailored_resumes enable row level security;
alter table public.usage_events     enable row level security;  -- no policies: invisible to browsers

drop policy if exists "own master resume" on public.master_resumes;
create policy "own master resume" on public.master_resumes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own tailored resumes" on public.tailored_resumes;
create policy "own tailored resumes" on public.tailored_resumes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Atomically check and record one use. Returns remaining uses, or -1 when over the limit.
create or replace function public.consume_quota(p_subject text, p_kind text, p_limit int)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  used int;
begin
  perform pg_advisory_xact_lock(hashtext(p_subject || ':' || p_kind));
  select count(*) into used from public.usage_events
    where subject = p_subject and kind = p_kind and created_at > now() - interval '24 hours';
  if used >= p_limit then
    return -1;
  end if;
  insert into public.usage_events (subject, kind) values (p_subject, p_kind);
  return p_limit - used - 1;
end;
$$;

revoke all on function public.consume_quota(text, text, int) from public, anon, authenticated;
grant execute on function public.consume_quota(text, text, int) to service_role;

-- Housekeeping: delete usage rows older than 3 days (call from a cron or occasionally).
create or replace function public.prune_usage_events() returns void
language sql security definer set search_path = '' as $$
  delete from public.usage_events where created_at < now() - interval '3 days';
$$;
revoke all on function public.prune_usage_events() from public, anon, authenticated;
grant execute on function public.prune_usage_events() to service_role;
