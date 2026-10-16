-- Community feature requests, and the owners' decision on them.
--
-- Two distinct signals, deliberately not conflated:
--
--   community upvotes  — how many people want this
--   owner votes        — whether the platform will build it
--
-- Upvotes do not decide anything. A feature with a hundred upvotes and no owner
-- vote is still undecided, and one with none can still be accepted. Letting a
-- popular request auto-accept would hand the roadmap to whoever can organise the
-- most accounts, and the platform would have no way to decline something popular
-- and unbuildable. What upvotes buy is that the owners cannot claim not to know.

-- ── One definition of the threshold ────────────────────────────────────────
--
-- Two thirds of the owners who can vote, rounded up. This already existed twice:
-- once in blkfndr-treasury as carried(), once inline in project_consensus. A
-- third copy is how the numbers start disagreeing, so it lives here now and
-- project_consensus is rewritten to call it.
--
-- "Owners who can vote" excludes anyone still holding an unclaimed invitation.
-- Voting requires an account, so counting an invitation raises a threshold
-- nobody can reach — which is exactly the bug this rule had on its first outing.
create or replace function public.owner_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.platform_admins where user_id is not null;
$$;

create or replace function public.owner_votes_needed()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- ceil(2n/3) without a ceiling function, matching the contract exactly.
  select ((public.owner_count() * 2) + 2) / 3;
$$;

create or replace function public.owner_vote_carried(yes int)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (yes * 3) >= (public.owner_count() * 2);
$$;

revoke execute on function public.owner_count() from public;
revoke execute on function public.owner_votes_needed() from public;
revoke execute on function public.owner_vote_carried(int) from public;
grant execute on function public.owner_count(), public.owner_votes_needed(),
  public.owner_vote_carried(int) to authenticated;

-- Rewritten to use the shared definition rather than its own copy.
create or replace function public.project_consensus(pid text)
returns table (approvals int, rejections int, owners int, needed int, carried boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with tally as (
    select
      count(*) filter (where v.approve)::int     as yes,
      count(*) filter (where not v.approve)::int as no
      from public.project_approval_votes v
     where v.project_id = pid
  )
  select
    tally.yes,
    tally.no,
    public.owner_count(),
    public.owner_votes_needed(),
    public.owner_vote_carried(tally.yes)
  from tally;
$$;

revoke execute on function public.project_consensus(text) from public, anon;
grant execute on function public.project_consensus(text) to authenticated;

-- ── The requests ───────────────────────────────────────────────────────────

create type feature_request_status as enum ('open', 'planned', 'declined', 'shipped');

create table if not exists public.feature_requests (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 3 and 160),
  body         text not null default '' check (length(body) <= 5000),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  status       feature_request_status not null default 'open',
  -- Why it was declined, or where it landed. Written by an owner, shown to the
  -- person who asked: a request that disappears without explanation is worse
  -- than one declined with a reason.
  response     text not null default '',
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists feature_requests_status_idx
  on public.feature_requests (status, created_at desc);

/* One upvote per person. The primary key is the whole rule. */
create table if not exists public.feature_request_votes (
  request_id uuid not null references public.feature_requests(id) on delete cascade,
  voter_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, voter_id)
);

/* Owner decisions, kept apart from community upvotes so neither can be read as
   the other. Same shape as project_approval_votes, same threshold. */
create table if not exists public.feature_request_decisions (
  request_id uuid not null references public.feature_requests(id) on delete cascade,
  voter_id   uuid not null references auth.users(id) on delete cascade,
  approve    boolean not null,
  created_at timestamptz not null default now(),
  primary key (request_id, voter_id)
);

create or replace function public.feature_request_consensus(rid uuid)
returns table (approvals int, rejections int, owners int, needed int, carried boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with tally as (
    select
      count(*) filter (where d.approve)::int     as yes,
      count(*) filter (where not d.approve)::int as no
      from public.feature_request_decisions d
     where d.request_id = rid
  )
  select
    tally.yes,
    tally.no,
    public.owner_count(),
    public.owner_votes_needed(),
    public.owner_vote_carried(tally.yes)
  from tally;
$$;

revoke execute on function public.feature_request_consensus(uuid) from public, anon;
grant execute on function public.feature_request_consensus(uuid) to authenticated;

create or replace function public.apply_feature_request_consensus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select * into c from public.feature_request_consensus(new.request_id);

  if c.carried then
    update public.feature_requests
       set status = 'planned', decided_at = now()
     where id = new.request_id and status = 'open';

  -- Declining needs the same weight as accepting, so a minority cannot bury
  -- what a minority could not adopt.
  elsif (c.rejections * 3) >= (c.owners * 2) then
    update public.feature_requests
       set status = 'declined', decided_at = now()
     where id = new.request_id and status = 'open';
  end if;

  return new;
end;
$$;

drop trigger if exists apply_feature_request_consensus_trigger on public.feature_request_decisions;
create trigger apply_feature_request_consensus_trigger
  after insert or update on public.feature_request_decisions
  for each row execute function public.apply_feature_request_consensus();

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.feature_requests          enable row level security;
alter table public.feature_request_votes     enable row level security;
alter table public.feature_request_decisions enable row level security;

-- The board is public. A roadmap nobody can read is not a roadmap.
drop policy if exists feature_requests_read on public.feature_requests;
create policy feature_requests_read
  on public.feature_requests for select to anon, authenticated using (true);

-- Anyone signed in may ask for something, in their own name.
drop policy if exists feature_requests_submit on public.feature_requests;
create policy feature_requests_submit
  on public.feature_requests for insert to authenticated
  with check (submitted_by = auth.uid());

-- The author may edit their wording while it is still open; owners may set the
-- status and response at any point. Split into two policies because they are two
-- different permissions that happen to touch one table.
drop policy if exists feature_requests_author_edit on public.feature_requests;
create policy feature_requests_author_edit
  on public.feature_requests for update to authenticated
  using (submitted_by = auth.uid() and status = 'open')
  with check (submitted_by = auth.uid());

drop policy if exists feature_requests_owner_edit on public.feature_requests;
create policy feature_requests_owner_edit
  on public.feature_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists feature_request_votes_read on public.feature_request_votes;
create policy feature_request_votes_read
  on public.feature_request_votes for select to anon, authenticated using (true);

-- Upvote in your own name only. Without the auth.uid() check any signed-in user
-- could stuff the count with rows attributed to other people.
drop policy if exists feature_request_votes_write on public.feature_request_votes;
create policy feature_request_votes_write
  on public.feature_request_votes for all to authenticated
  using (voter_id = auth.uid()) with check (voter_id = auth.uid());

drop policy if exists feature_request_decisions_read on public.feature_request_decisions;
create policy feature_request_decisions_read
  on public.feature_request_decisions for select to authenticated
  using (public.is_admin());

drop policy if exists feature_request_decisions_write on public.feature_request_decisions;
create policy feature_request_decisions_write
  on public.feature_request_decisions for all to authenticated
  using (public.is_admin() and voter_id = auth.uid())
  with check (public.is_admin() and voter_id = auth.uid());

grant select on public.feature_requests to anon, authenticated;
grant insert, update on public.feature_requests to authenticated;
grant select on public.feature_request_votes to anon, authenticated;
grant insert, delete on public.feature_request_votes to authenticated;
grant select, insert, update, delete on public.feature_request_decisions to authenticated;

comment on table public.feature_requests is
  'Community roadmap. Upvotes are signal; only an owner vote at the two-thirds threshold changes status.';
