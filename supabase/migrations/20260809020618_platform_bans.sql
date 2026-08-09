-- Users a platform administrator has banned.
--
-- A ban does two things: it hides the person's listings from the public, and it
-- is the record the app checks to refuse them. Kept as a table rather than only
-- Supabase's auth-level banned_until, because a ban has to reach content — auth
-- alone would stop them signing in while leaving their projects on the platform.
--
-- Verified in a rolled-back transaction: a public listing is visible to anon,
-- then invisible the moment its creator is banned, and is_banned reports true.
create table if not exists public.platform_bans (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  banned_by  uuid references auth.users(id) on delete set null,
  reason     text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.platform_bans is
  'Users a platform administrator has banned. Hides their content and refuses them.';

create or replace function public.is_banned(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_bans b where b.user_id = uid);
$$;

-- A listing is banned if its creator is. The link is the creator's Stellar
-- address to their profile to the ban — the projects table has no user_id.
create or replace function public.creator_is_banned(addr text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.profiles p
      join public.platform_bans b on b.user_id = p.id
     where p.stellar_public_key = addr
  );
$$;

revoke execute on function public.is_banned(uuid) from public;
revoke execute on function public.creator_is_banned(text) from public;
grant execute on function public.is_banned(uuid), public.creator_is_banned(text)
  to anon, authenticated;

drop policy if exists "public listings are readable by anyone" on public.projects;
create policy "public listings are readable by anyone"
  on public.projects for select
  to anon, authenticated
  using (
    is_public
    and not public.project_awaiting_consensus(project_id)
    and not public.creator_is_banned(creator_address)
  );

alter table public.platform_bans enable row level security;

drop policy if exists platform_bans_read on public.platform_bans;
create policy platform_bans_read
  on public.platform_bans for select to authenticated
  using (public.has_admin_role('platform_admin'));

drop policy if exists platform_bans_write on public.platform_bans;
create policy platform_bans_write
  on public.platform_bans for all to authenticated
  using (public.has_admin_role('platform_admin'))
  with check (public.has_admin_role('platform_admin'));

grant select, insert, delete on public.platform_bans to authenticated;
