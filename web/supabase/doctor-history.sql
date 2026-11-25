-- Run after schema.sql and care-chat.sql in Supabase SQL Editor.
-- Stores compact E02 angle samples and per-cycle features (not video).

alter table public.rehab_attempts
  add column if not exists angle_series jsonb,
  add column if not exists cycle_features jsonb,
  add column if not exists doctor_verdict text check (doctor_verdict in ('complete', 'check')),
  add column if not exists doctor_note text,
  add column if not exists doctor_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists doctor_reviewed_at timestamptz;

create table if not exists public.doctor_history_consents (
  patient_id uuid primary key references auth.users(id) on delete cascade,
  allow_history boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.doctor_history_consents enable row level security;
grant select, insert, update on public.doctor_history_consents to authenticated;
revoke update on public.rehab_attempts from authenticated;
grant update (doctor_verdict, doctor_note, doctor_reviewed_by, doctor_reviewed_at)
  on public.rehab_attempts to authenticated;

drop policy if exists "Patients can read own doctor history consent" on public.doctor_history_consents;
create policy "Patients can read own doctor history consent"
  on public.doctor_history_consents for select to authenticated
  using ((select auth.uid()) = patient_id);

drop policy if exists "Assigned doctors can read patient consent" on public.doctor_history_consents;
create policy "Assigned doctors can read patient consent"
  on public.doctor_history_consents for select to authenticated
  using (exists (
    select 1 from public.care_relationships r
    where r.patient_id = doctor_history_consents.patient_id
      and r.doctor_id = (select auth.uid())
  ));

drop policy if exists "Patients can create own doctor history consent" on public.doctor_history_consents;
create policy "Patients can create own doctor history consent"
  on public.doctor_history_consents for insert to authenticated
  with check ((select auth.uid()) = patient_id);

drop policy if exists "Patients can update own doctor history consent" on public.doctor_history_consents;
create policy "Patients can update own doctor history consent"
  on public.doctor_history_consents for update to authenticated
  using ((select auth.uid()) = patient_id)
  with check ((select auth.uid()) = patient_id);

drop policy if exists "Users can read their own attempts" on public.rehab_attempts;
drop policy if exists "Assigned doctors can read consented patient attempts" on public.rehab_attempts;
create policy "Users and consented doctors can read attempts"
  on public.rehab_attempts for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.care_relationships r
      join public.doctor_history_consents c on c.patient_id = r.patient_id
      where r.patient_id = rehab_attempts.user_id
        and r.doctor_id = (select auth.uid())
        and c.allow_history = true
    )
  );

drop policy if exists "Assigned doctors can review consented attempts" on public.rehab_attempts;
create policy "Assigned doctors can review consented attempts"
  on public.rehab_attempts for update to authenticated
  using (exists (
    select 1 from public.care_relationships r
    join public.doctor_history_consents c on c.patient_id = r.patient_id
    where r.patient_id = rehab_attempts.user_id
      and r.doctor_id = (select auth.uid())
      and c.allow_history = true
  ))
  with check (
    doctor_reviewed_by = (select auth.uid())
    and exists (
      select 1 from public.care_relationships r
      join public.doctor_history_consents c on c.patient_id = r.patient_id
      where r.patient_id = rehab_attempts.user_id
        and r.doctor_id = (select auth.uid())
        and c.allow_history = true
    )
  );

comment on column public.rehab_attempts.angle_series is
  'Downsampled E02 elbow-to-wrist angle samples with relative seconds; no source video.';
comment on column public.rehab_attempts.cycle_features is
  'Per-cycle numerical pose features used for the prototype classifier.';
