-- Projects: the off-chain cache of on-chain vault state.
--
-- Two things the Mongo model got wrong are fixed here.
--
-- First, amounts. Mongo stored each figure twice -- a JS Number for display and
-- a string for the raw stroop value -- and the two could disagree, because
-- Number(raised)/10_000_000 silently loses precision above 2^53 and the app did
-- that conversion in several places. Here the raw value is numeric (exact, and
-- wide enough for i128) and the human figure is a generated column, so drift
-- between them is not expressible.
--
-- Second, milestones were an embedded array, which meant updating one released
-- flag rewrote the whole document and nothing constrained the ids. They are now
-- a child table with a real key.

create type public.project_status as enum (
  'pending', 'approved', 'raising', 'funded', 'active',
  'completed', 'failed', 'refunding', 'expired', 'rejected', 'hidden'
);

create type public.currency_type as enum ('USDC', 'USDT', 'XLM', 'WBTC', 'WETH');

-- Stellar assets carry 7 decimals.
create or replace function public.stroops_to_units(raw numeric)
returns numeric language sql immutable set search_path = ''
as $$ select raw / 10000000.0 $$;

create table public.projects (
  id                  uuid primary key default gen_random_uuid(),
  -- The on-chain project counter from the factory.
  project_id          text not null unique,
  vault_address       text not null unique,

  title               text not null,
  tagline             text not null default '',
  description         text not null default '',
  category            text not null default 'General',
  image_url           text not null default '',
  metadata_cid        text not null default '',

  creator_address     text not null,
  creator_display     text not null default '',
  creator_avatar_url  text not null default '',

  funding_goal_raw    numeric(78, 0) not null,
  current_funding_raw numeric(78, 0) not null default 0,
  bond_amount_raw     numeric(78, 0) not null default 0,
  released_total_raw  numeric(78, 0) not null default 0,

  -- Derived, never stored independently.
  funding_goal        numeric generated always as (funding_goal_raw / 10000000.0) stored,
  current_funding     numeric generated always as (current_funding_raw / 10000000.0) stored,
  bond_amount         numeric generated always as (bond_amount_raw / 10000000.0) stored,
  released_total      numeric generated always as (released_total_raw / 10000000.0) stored,

  status              public.project_status not null default 'pending',
  currency            public.currency_type  not null default 'USDC',
  bond_posted         boolean not null default false,
  featured            boolean not null default false,
  is_public           boolean not null default true,

  -- Was an epoch-milliseconds integer, which no database could reason about.
  funding_deadline    timestamptz not null,
  created_on_chain_at timestamptz not null,
  last_updated_ledger bigint not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index projects_creator_address_idx on public.projects (creator_address);
create index projects_status_idx on public.projects (status);
create index projects_is_public_idx on public.projects (is_public);

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

create table public.project_milestones (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  -- The on-chain milestone id, unique within its project.
  milestone_id integer not null,
  amount_raw   numeric(78, 0) not null,
  amount       numeric generated always as (amount_raw / 10000000.0) stored,
  released     boolean not null default false,
  title        text not null default '',
  description  text not null default '',
  -- Delivery evidence submitted by the builder. Off-chain by nature.
  proof        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, milestone_id)
);

create index project_milestones_project_id_idx on public.project_milestones (project_id);

create trigger project_milestones_touch_updated_at
  before update on public.project_milestones
  for each row execute function public.touch_updated_at();

-- Listings are public by design. Writes are not: every field mirrors on-chain
-- state and is written by the indexer with the service-role key. That is what
-- stopped an anonymous caller rewriting a funding total in the Mongo version.
alter table public.projects enable row level security;
alter table public.project_milestones enable row level security;

create policy "public listings are readable by anyone"
  on public.projects for select to anon, authenticated using (is_public);

create policy "admins read every listing"
  on public.projects for select to authenticated using (public.is_admin());

create policy "milestones of a visible project are readable"
  on public.project_milestones for select to anon, authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_milestones.project_id
        and (p.is_public or public.is_admin())
    )
  );
