create table if not exists public.health_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('exercise', 'meal', 'sleep', 'meditation', 'social')),
  entry_date date not null,
  created_at timestamptz not null,
  raw_text text not null,
  fields jsonb not null default '{}'::jsonb,
  extraction jsonb,
  extraction_status text,
  meal_suggestion jsonb,
  updated_at timestamptz not null default now()
);

alter table public.health_entries enable row level security;

drop policy if exists "Users can read their own health entries" on public.health_entries;
create policy "Users can read their own health entries"
  on public.health_entries
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own health entries" on public.health_entries;
create policy "Users can insert their own health entries"
  on public.health_entries
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own health entries" on public.health_entries;
create policy "Users can update their own health entries"
  on public.health_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own health entries" on public.health_entries;
create policy "Users can delete their own health entries"
  on public.health_entries
  for delete
  using (auth.uid() = user_id);

create index if not exists health_entries_user_date_idx
  on public.health_entries(user_id, entry_date desc, created_at desc);

alter table public.health_entries
  add column if not exists meal_suggestion jsonb;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_health_entries_updated_at on public.health_entries;
create trigger set_health_entries_updated_at
  before update on public.health_entries
  for each row
  execute function public.set_updated_at();

create table if not exists public.health_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.health_profiles enable row level security;

drop policy if exists "Users can read their own health profile" on public.health_profiles;
create policy "Users can read their own health profile"
  on public.health_profiles
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own health profile" on public.health_profiles;
create policy "Users can insert their own health profile"
  on public.health_profiles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own health profile" on public.health_profiles;
create policy "Users can update their own health profile"
  on public.health_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists set_health_profiles_updated_at on public.health_profiles;
create trigger set_health_profiles_updated_at
  before update on public.health_profiles
  for each row
  execute function public.set_updated_at();
