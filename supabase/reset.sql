-- START FRESH: deletes every account and all their data, then makes sure the tables exist.
-- Run it yourself in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- This cannot be undone.

-- 1. All accounts. Their resumes, tailored versions and files go with them (on delete cascade).
delete from auth.users;

-- 2. Anything left over, and the guest usage counters.
truncate table public.tailored_resumes, public.master_resumes, public.usage_events;
truncate table public.resume_files;  -- run supabase/migrations/20261024000000_resume_files.sql first if this table is missing
