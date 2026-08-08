-- Projects that need the owners' consensus before they go public.
--
-- Most listings need no approval: a project exists when its vault is deployed,
-- and no admin decides whether it may. This is the exception — a listing an
-- owner has flagged as needing agreement before the platform carries it.
--
-- ## Why this is not a column on `projects`
--
-- `projects` is written by the indexer from chain events, and a row is rewritten
-- whenever the vault it mirrors changes. Moderation is a platform decision, not
-- a fact about the ledger, so a column there would be silently reverted by the
-- next sync. Keeping it in its own table means the indexer can own its table
-- completely and this can outlive any number of resyncs.
--
-- ## The rule is the treasury's rule
--
-- Two thirds of the owners, by headcount, rounded up. Deliberately identical to
-- the release threshold in blkfndr-treasury, because a platform where money
-- needs two-to-one but publishing needs a simple majority invites the question
-- of which number is the real one.

create type project_approval_state as enum ('pending', 'approved', 'rejected');

create table if not exists public.project_moderation (
  -- The indexer's business key, not the surrogate id, so a resync that rebuilds
  -- projects rows cannot orphan a decision.
  project_id  text primary key,
  state       project_approval_state not null default 'pending',
  flagged_by  uuid references auth.users(id) on delete set null,
  flagged_at  timestamptz not null default now(),
  decided_at  timestamptz,
  reason      text not null default ''
);

comment on table public.project_moderation is
  'Listings requiring owner consensus before they are public. Absent row means no approval is needed, which is the ordinary case.';

create table if not exists public.project_approval_votes (
  project_id text not null references public.project_moderation(project_id) on delete cascade,
  -- The voter's account, not their email: an owner who changes address must not
  -- be able to vote a second time.
  voter_id   uuid not null references auth.users(id) on delete cascade,
  approve    boolean not null,
  created_at timestamptz not null default now(),
  primary key (project_id, voter_id)
);

create index if not exists project_approval_votes_project_idx
  on public.project_approval_votes (project_id);

-- ── Counting ───────────────────────────────────────────────────────────────
--
-- Owners are the admin roster. When the moderator role arrives, this is the one
-- place that has to learn the difference, because it is the only place that
-- turns "how many admins are there" into a threshold.
create or replace function public.project_consensus(pid text)
returns table (approvals int, rejections int, owners int, needed int, carried boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with tally as (
    select
      count(*) filter (where v.approve)     as yes,
      count(*) filter (where not v.approve) as no
      from public.project_approval_votes v
     where v.project_id = pid
  ),
  roster as (select count(*)::int as n from public.platform_admins)
  select
    tally.yes::int,
    tally.no::int,
    roster.n,
    -- Two thirds rounded up, computed the same way the contract does it:
    -- ceil(2n/3) without a ceiling function.
    ((roster.n * 2) + 2) / 3,
    (tally.yes * 3) >= (roster.n * 2)
  from tally, roster;
$$;

revoke execute on function public.project_consensus(text) from public, anon;
grant execute on function public.project_consensus(text) to authenticated;

-- Flip the row the moment the threshold is met, so "approved" is a stored fact
-- rather than something every reader has to recompute and agree about.
create or replace function public.apply_project_consensus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select * into c from public.project_consensus(new.project_id);

  if c.carried then
    update public.project_moderation
       set state = 'approved', decided_at = now()
     where project_id = new.project_id and state = 'pending';

  -- Rejection needs the same weight as approval. Anything less would let a
  -- minority block what a minority cannot pass.
  elsif (c.rejections * 3) >= (c.owners * 2) then
    update public.project_moderation
       set state = 'rejected', decided_at = now()
     where project_id = new.project_id and state = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists apply_project_consensus_trigger on public.project_approval_votes;
create trigger apply_project_consensus_trigger
  after insert or update on public.project_approval_votes
  for each row execute function public.apply_project_consensus();

-- ── Visibility ─────────────────────────────────────────────────────────────
--
-- A flagged listing is hidden from the public until it carries. Its builder can
-- always see it, otherwise a project would vanish from its own creator's
-- dashboard with no explanation while it is under review.
create or replace function public.project_awaiting_consensus(pid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_moderation m
     where m.project_id = pid and m.state = 'pending'
  );
$$;

revoke execute on function public.project_awaiting_consensus(text) from public;
grant execute on function public.project_awaiting_consensus(text) to anon, authenticated;

drop policy if exists "public listings are readable by anyone" on public.projects;
create policy "public listings are readable by anyone"
  on public.projects for select
  to anon, authenticated
  using (is_public and not public.project_awaiting_consensus(project_id));

-- The builder keeps sight of their own listing while it is under review.
drop policy if exists "builders read their own listing under review" on public.projects;
create policy "builders read their own listing under review"
  on public.projects for select
  to authenticated
  using (
    creator_address = coalesce(
      (select p.stellar_public_key from public.profiles p where p.id = auth.uid()),
      ''
    )
  );

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.project_moderation    enable row level security;
alter table public.project_approval_votes enable row level security;

-- Readable by anyone, so a visitor can be told *why* a listing is not shown yet
-- rather than being shown nothing. It holds no personal data — a project id, a
-- state, and a timestamp.
drop policy if exists project_moderation_read on public.project_moderation;
create policy project_moderation_read
  on public.project_moderation for select to anon, authenticated using (true);

drop policy if exists project_moderation_write on public.project_moderation;
create policy project_moderation_write
  on public.project_moderation for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists project_approval_votes_read on public.project_approval_votes;
create policy project_approval_votes_read
  on public.project_approval_votes for select to authenticated using (public.is_admin());

-- An owner casts their own vote and nobody else's. `voter_id = auth.uid()` is
-- the part that matters: is_admin() alone would let any admin write a row in
-- another admin's name and manufacture a consensus single-handed.
drop policy if exists project_approval_votes_write on public.project_approval_votes;
create policy project_approval_votes_write
  on public.project_approval_votes for all to authenticated
  using (public.is_admin() and voter_id = auth.uid())
  with check (public.is_admin() and voter_id = auth.uid());

grant select on public.project_moderation to anon, authenticated;
grant insert, update, delete on public.project_moderation to authenticated;
grant select, insert, update, delete on public.project_approval_votes to authenticated;
