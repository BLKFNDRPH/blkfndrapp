-- Profiles: application-level user data, keyed to Supabase Auth.
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  display_name       text        not null default 'Anonymous',
  avatar_url         text,
  stellar_public_key text unique,
  wallet_status      text        not null default 'disconnected'
                       check (wallet_status in ('connected', 'disconnected')),
  legacy_uid         text unique,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index profiles_stellar_public_key_idx on public.profiles (stellar_public_key);
create index profiles_legacy_uid_idx on public.profiles (legacy_uid);

-- Admin identity. Read the role from app_metadata, never user_metadata:
-- the latter is self-service and a user can set it to anything they like.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'Anonymous'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tables created in SQL do not get RLS automatically, and public is served
-- over the REST API with a key that ships to every browser.
alter table public.profiles enable row level security;

create policy "profiles are readable by authenticated users"
  on public.profiles for select to authenticated using (true);

create policy "a user updates only their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "admins update any profile"
  on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
