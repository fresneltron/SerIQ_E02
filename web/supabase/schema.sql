create table if not exists public.rehab_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null check (exercise_id in ('E01', 'E02', 'E03', 'E04')),
  verdict text not null check (verdict in ('complete', 'check', 'quality')),
  probability real not null check (probability >= 0 and probability <= 1),
  confidence real not null check (confidence >= 0 and confidence <= 1),
  detected_percent real not null check (detected_percent >= 0 and detected_percent <= 100),
  duration_seconds real not null check (duration_seconds >= 0),
  cycle_count integer not null default 0 check (cycle_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.rehab_attempts enable row level security;
grant select, insert, delete on public.rehab_attempts to authenticated;

create policy "Users can read their own attempts"
  on public.rehab_attempts for select
  to authenticated using ((select auth.uid()) = user_id);

create policy "Users can add their own attempts"
  on public.rehab_attempts for insert
  to authenticated with check ((select auth.uid()) = user_id);

create policy "Users can delete their own attempts"
  on public.rehab_attempts for delete
  to authenticated using ((select auth.uid()) = user_id);

create index if not exists rehab_attempts_user_created_idx
  on public.rehab_attempts (user_id, created_at desc);

-- Public read-only bucket for the exercise demonstration clip.
-- Upload web/public/instructions/video2.mp4 as video2.mp4 in Supabase Storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('instruction-videos', 'instruction-videos', true, 52428800, array['video/mp4'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = array['video/mp4'];
