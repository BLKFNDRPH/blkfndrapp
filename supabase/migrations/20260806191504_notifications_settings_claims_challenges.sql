-- Notifications.
--
-- user_id is a real foreign key to profiles, not a loose string. That alone
-- removes the IDOR the Mongo version had, where updateMany({_id: {$in: ids}})
-- with no ownership filter let any signed-in caller mark or delete anyone's
-- notifications: here the policy scopes every statement to the caller's rows.

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  caption    text not null default '',
  url        text,
  -- Project this notification refers to, when there is one.
  project_id uuid references public.projects (id) on delete set null,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id)
  where not is_read;

alter table public.notifications enable row level security;

create policy "a user reads only their own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

-- Marking read is the only field a recipient may change, and only on their own
-- rows. Creating notifications is a server-side action.
create policy "a user marks only their own notifications read"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "a user dismisses only their own notifications"
  on public.notifications for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke insert on public.notifications from anon, authenticated;
grant update (is_read) on public.notifications to authenticated;


-- Platform settings: a singleton row.
create table public.platform_settings (
  id               boolean primary key default true check (id),
  fee_wallet_email text not null default 'admin@blkfndr.com',
  updated_at       timestamptz not null default now()
);

insert into public.platform_settings (id) values (true) on conflict do nothing;

create trigger platform_settings_touch_updated_at
  before update on public.platform_settings
  for each row execute function public.touch_updated_at();

alter table public.platform_settings enable row level security;

create policy "admins read platform settings"
  on public.platform_settings for select to authenticated
  using (public.is_admin());

-- Writes go through the service-role key after an admin check.
revoke insert, update, delete on public.platform_settings from anon, authenticated;


-- Withdrawal claim requests raised by builders.
create table public.claim_requests (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (project_id)
);

create index claim_requests_requested_by_idx on public.claim_requests (requested_by);

alter table public.claim_requests enable row level security;

create policy "a builder sees their own claim requests"
  on public.claim_requests for select to authenticated
  using ((select auth.uid()) = requested_by);

create policy "admins see every claim request"
  on public.claim_requests for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.claim_requests from anon, authenticated;


-- Freighter wallet-link challenges.
--
-- Supabase Auth owns identity now; this is only for proving control of a
-- Stellar address before linking it to an account. Issued and verified
-- server-side, so no browser role gets any access.

create table public.auth_challenges (
  public_key text primary key,
  nonce      text not null,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now()
);

create index auth_challenges_expires_at_idx on public.auth_challenges (expires_at);

alter table public.auth_challenges enable row level security;
revoke all on public.auth_challenges from anon, authenticated;

-- Mongo expired these with a TTL index. Postgres has no equivalent, so expiry
-- is enforced at verification time by the query, and this reclaims the rows.
create or replace function public.purge_expired_auth_challenges()
returns void language sql security definer set search_path = ''
as $$
  delete from public.auth_challenges where expires_at < now();
$$;

revoke execute on function public.purge_expired_auth_challenges()
  from public, anon, authenticated;
