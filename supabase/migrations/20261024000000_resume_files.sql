-- Uploaded PDFs: the page people see and edit is their original file (see web/src/lib/source.ts).
-- One row per file per user; resumes point to it by id (a hash of the file). Private to each user.

create table if not exists public.resume_files (
  id          text not null check (id ~ '^[0-9a-f]{16,64}$'),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 300),
  data        text not null check (char_length(data) <= 4500000),  -- base64 PDF, at most ~3 MB
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.resume_files enable row level security;

drop policy if exists "own files" on public.resume_files;
create policy "own files" on public.resume_files
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
