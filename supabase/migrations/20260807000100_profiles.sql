-- Profiles: application-level user data, keyed to Supabase Auth.
--
-- App data does not go in auth.users. That table belongs to the auth schema and
-- is not exposed over the REST API, so anything we put there is awkward to read
-- and impossible to protect with ordinary policies.
--
-- Replaces the Mongo `users` collection. The old `uid` was the Google `sub`;
-- it is kept as `legacy_uid` so existing records can be reconciled when a
-- returning user signs in for the first time through Supabase Auth.

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  display_name       text        not null default 'Anonymous',
  avatar_url         text,
  -- One wallet belongs to one account. The old code enforced this with a
  -- findOne() check that raced; a unique constraint cannot.
  stellar_public_key text unique,
  wallet_status      text        not null default 'disconnected'
                       check (wallet_status in ('connected', 'disconnected')),
  -- Google `sub` from the pre-Supabase system. Null for accounts created after
  -- the migration. Dropped once reconciliation is complete.
  legacy_uid         text unique,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.profiles.legacy_uid is
  'Google sub from the pre-Supabase auth system, for one-time account linking.';

-- Policy predicates must be indexed or every check is a scan.
create index profiles_stellar_public_key_idx on public.profiles (stellar_public_key);
create index profiles_legacy_uid_idx on public.profiles (legacy_uid);

-- ── Admin identity ─────────────────────────────────────────────────────────
--
-- Read the role from app_metadata, never user_metadata: the latter is
-- self-service and a user can set it to anything they like.
--
-- On-chain remains the source of truth for who is an admin. A server-side job
-- mirrors that into app_metadata using the service-role key, which is the only
-- way the claim can be set. Nothing a client sends can influence this.

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

comment on function public.is_admin() is
  'True when the caller carries app_metadata.role = admin. Mirrored from on-chain state server-side.';

-- ── Keep updated_at honest ─────────────────────────────────────────────────

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

-- ── Create a profile whenever an account is created ────────────────────────
--
-- Runs as definer because the inserting context is the auth system, not a
-- policy-bearing user.

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

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Tables created in SQL do not get RLS automatically, and public is served over
-- the REST API with a key that ships to every browser. Without this, the table
-- is world-readable.

alter table public.profiles enable row level security;

-- Display name, avatar and wallet address are shown next to projects and
-- contributions, so profiles are readable by signed-in users. Note what is NOT
-- in this table: no email, and no role column to enumerate admins with.
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "a user updates only their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "admins update any profile"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Insert is the trigger's job; delete cascades from auth.users. Neither gets a
-- policy, so both are denied for ordinary callers.
