-- Admins become their own roster, instead of a cached reflection of the chain.
--
-- Before this, the only way to be an admin was to link a Freighter wallet that
-- sat on the on-chain blkfndr-admin roster. That had two problems.
--
-- It could not express an operational admin. Someone whose job is reviewing KYC
-- documents had to hold a key that could also change the platform fee, because
-- there was exactly one notion of "admin" and it lived on the ledger.
--
-- And it went stale in the dangerous direction. app_metadata.role was written
-- when a wallet was linked and never re-read, so removing someone from the
-- on-chain roster did not revoke their console access — it persisted until they
-- happened to re-link or unlink. The old wallet gate masked this by re-reading
-- the chain on every page load; the moment sign-in became session-based, the
-- stale claim would have become the whole answer.
--
-- So there are now two rosters, for two different powers:
--
--   platform_admins (here)  — who may use the console: KYC review, categories,
--                             project moderation. Enforced by RLS.
--   blkfndr-admin (on-chain) — who may sign a contract change. Enforced by the
--                             ledger, which does not consult this table and
--                             cannot be persuaded by anything the app believes.
--
-- Holding one does not grant the other. That is the point.

create table if not exists public.platform_admins (
  id         uuid primary key default gen_random_uuid(),
  -- Stored lower-cased via the index below. An invite is addressed to an email
  -- before the account exists, so email is the durable key and user_id is
  -- filled in on first sign-in.
  email      text not null,
  user_id    uuid unique references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  note       text not null default ''
);

create unique index if not exists platform_admins_email_lower_idx
  on public.platform_admins (lower(email));

create index if not exists platform_admins_user_id_idx
  on public.platform_admins (user_id);

-- ── is_admin() now answers from the roster ─────────────────────────────────
--
-- SECURITY DEFINER, because platform_admins has RLS that itself calls
-- is_admin(); an invoker-rights lookup would recurse. Definer rights read the
-- table directly and end the recursion.
--
-- Matching on user_id OR email covers the window between an invite being
-- written and the invitee first signing in, when user_id is still null.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.platform_admins a
     where a.user_id = auth.uid()
        or lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ── Claim the invite on first sign-in ──────────────────────────────────────
-- Binds the row to a user id the first time that address authenticates, so
-- later checks hit the indexed user_id rather than the email comparison.
create or replace function public.claim_admin_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.platform_admins
     set user_id = new.id
   where user_id is null
     and lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists claim_admin_invite_on_signup on auth.users;
create trigger claim_admin_invite_on_signup
  after insert on auth.users
  for each row execute function public.claim_admin_invite();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.platform_admins enable row level security;

-- Admins can see the roster. Nobody else can, so this is not a directory of
-- who runs the platform for anyone who happens to be signed in.
drop policy if exists platform_admins_read on public.platform_admins;
create policy platform_admins_read
  on public.platform_admins for select
  to authenticated
  using (public.is_admin());

drop policy if exists platform_admins_write on public.platform_admins;
create policy platform_admins_write
  on public.platform_admins for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.platform_admins to authenticated;

-- Nobody removes themselves, and the last admin cannot be removed. Both are
-- enforced here rather than in application code, because a roster that can be
-- emptied leaves no one able to restore it without direct database access.
create or replace function public.guard_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id is not null and old.user_id = auth.uid() then
    raise exception 'An admin cannot remove themselves.'
      using errcode = 'check_violation';
  end if;

  if (select count(*) from public.platform_admins) <= 1 then
    raise exception 'The last administrator cannot be removed.'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists guard_admin_removal_trigger on public.platform_admins;
create trigger guard_admin_removal_trigger
  before delete on public.platform_admins
  for each row execute function public.guard_admin_removal();

-- ── Audit ──────────────────────────────────────────────────────────────────
-- Who granted or revoked what, and when. Prevention is not the only layer
-- worth having: an admin console that can read identity documents and move
-- money should also be able to answer "who did this".
create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  actor_id    uuid references auth.users(id) on delete set null,
  target_email text not null default '',
  detail      text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

-- Readable by admins, written only by the service role. No browser-facing
-- insert grant: an append-only record that the actor can write is not one.
drop policy if exists admin_audit_log_read on public.admin_audit_log;
create policy admin_audit_log_read
  on public.admin_audit_log for select
  to authenticated
  using (public.is_admin());

grant select on public.admin_audit_log to authenticated;
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;

-- ── Bootstrap ──────────────────────────────────────────────────────────────
--
-- An empty roster means is_admin() is false for everyone, and the RLS above
-- then makes it impossible to add the first admin from the application. That is
-- the correct failure mode — it is just not a usable starting state — so the
-- first row is seeded here.
--
-- user_id is left null deliberately. The account does not exist yet; is_admin()
-- matches on email until it does, and claim_admin_invite() binds the id on first
-- sign-in. Whoever controls this mailbox becomes the first administrator, so on
-- a fresh deployment change this address before running the migration.
-- Superseded by 20260808090000_correct_bootstrap_admin.sql, which replaces this
-- address with the platform owner. Left as-is rather than edited, because this
-- migration has already been applied and changing it would diverge from what
-- the database actually ran.
insert into public.platform_admins (email, note)
values ('info@makerspaceinnovhub.com', 'Bootstrap administrator')
on conflict do nothing;

comment on table public.platform_admins is
  'Who may use the admin console. Separate from the on-chain blkfndr-admin roster, which governs contract signing and is not derived from this table.';
