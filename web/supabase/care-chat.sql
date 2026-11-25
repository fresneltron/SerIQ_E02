-- Apply in Supabase SQL Editor after configuring Auth providers.
-- This migration stores only account IDs and chat text; do not use with real
-- patient data for the solveathon prototype.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'patient' check (role in ('patient', 'doctor')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.create_seriq_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists seriq_auth_user_profile on auth.users;
create trigger seriq_auth_user_profile
  after insert on auth.users
  for each row execute function public.create_seriq_profile();

insert into public.profiles (user_id)
select id from auth.users on conflict (user_id) do nothing;

create table if not exists public.care_relationships (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(user_id) on delete cascade,
  doctor_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  check (patient_id <> doctor_id)
);

alter table public.care_relationships enable row level security;
grant select on public.care_relationships to authenticated;
drop policy if exists "Care participants can view their relationship" on public.care_relationships;
create policy "Care participants can view their relationship"
  on public.care_relationships for select to authenticated
  using ((select auth.jwt()) ->> 'is_anonymous' is distinct from 'true'
    and ((select auth.uid()) = patient_id or (select auth.uid()) = doctor_id));

create index if not exists care_relationships_patient_idx on public.care_relationships(patient_id, created_at desc);
create index if not exists care_relationships_doctor_idx on public.care_relationships(doctor_id, created_at desc);
create unique index if not exists care_relationships_one_doctor_per_patient on public.care_relationships(patient_id);

create table if not exists public.doctor_messages (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.care_relationships(id) on delete cascade,
  sender_id uuid not null references public.profiles(user_id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.doctor_messages enable row level security;
grant select, insert on public.doctor_messages to authenticated;
drop policy if exists "Care participants can read messages" on public.doctor_messages;
create policy "Care participants can read messages"
  on public.doctor_messages for select to authenticated
  using (exists (
    select 1 from public.care_relationships r
    where r.id = relationship_id and (select auth.jwt()) ->> 'is_anonymous' is distinct from 'true'
      and (select auth.uid()) in (r.patient_id, r.doctor_id)
  ));
drop policy if exists "Care participants can send messages as themselves" on public.doctor_messages;
create policy "Care participants can send messages as themselves"
  on public.doctor_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid()) and (select auth.jwt()) ->> 'is_anonymous' is distinct from 'true' and exists (
      select 1 from public.care_relationships r
      where r.id = relationship_id and (select auth.jwt()) ->> 'is_anonymous' is distinct from 'true'
        and (select auth.uid()) in (r.patient_id, r.doctor_id)
    )
  );

create index if not exists doctor_messages_thread_created_idx on public.doctor_messages(relationship_id, created_at);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'doctor_messages'
     ) then
    alter publication supabase_realtime add table public.doctor_messages;
  end if;
end;
$$;
