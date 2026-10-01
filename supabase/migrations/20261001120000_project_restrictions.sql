-- Hiding and locking a project: platform decisions, not contract ones.
--
-- A vault has no admin key and no pause switch, by design, and nothing here
-- adds one. What the platform does control is its own surface — which listings
-- it carries, and which actions its interface will build a transaction for —
-- and these two restrictions act on exactly that.
--
--   hidden  The listing leaves every public surface: explore, search, the home
--           page, a direct link. Its builder, anyone holding a stake in it and
--           the console keep sight of it, because a stakeholder must always be
--           able to reach the vault holding their money.
--
--   locked  The platform stops building the actions that move a project
--           forward: new stakes, the builder opening a milestone vote, and
--           milestone proof. Stakeholders keep every action that is theirs —
--           voting in a window already open, executing a release they carried,
--           reclaiming their stake. A lock pauses a project; it never traps
--           anyone's money, and it never overrides a stakeholder vote.
--
-- The vault stays permissionless, so a lock binds this platform's interface and
-- server, not a caller who assembles the transaction by hand. That is the
-- honest reach of a system-level control, and the interface says so.
--
-- ## Its own table, keyed by vault address
--
-- For the reason project_moderation gives: `projects` belongs to the indexer and
-- is rewritten whenever its vault changes, so a column there would be one resync
-- away from silently reverting. Keyed on the vault address rather than
-- project_id because the address is what the indexer upserts on — immutable, and
-- the vault's on-chain identity — where project_id is a value the indexer
-- writes. No foreign key onto projects, deliberately: a resync that rebuilds
-- rows must not cascade a restriction away.
--
-- ## Who
--
-- An owner, a platform administrator or a project administrator, acting alone
-- with a stated reason. Moderation has to be quick enough to answer abuse, so
-- this is not an owner vote; the audit log is what holds it to account.

create table if not exists public.project_restrictions (
  vault_address text primary key,
  hidden_at     timestamptz,
  hidden_by     uuid references auth.users(id) on delete set null,
  hidden_reason text not null default '',
  locked_at     timestamptz,
  locked_by     uuid references auth.users(id) on delete set null,
  locked_reason text not null default '',
  updated_at    timestamptz not null default now(),

  -- A row that restricts nothing is deleted rather than kept, so "is there a
  -- row" and "is this project restricted" can never disagree.
  constraint project_restrictions_restricts_something
    check (hidden_at is not null or locked_at is not null),
  constraint project_restrictions_reason_length
    check (char_length(hidden_reason) <= 500 and char_length(locked_reason) <= 500)
);

comment on table public.project_restrictions is
  'Platform-level hide and lock, per vault. Absent row means unrestricted, the ordinary case. Written only through set_project_hidden / set_project_locked.';

-- ── Predicates ─────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER for the reason is_admin() is: the policies below call these,
-- and an invoker-rights read of project_restrictions from inside a projects
-- policy would loop back through project_restrictions' own policy, which reads
-- projects.

create or replace function public.project_is_hidden(vault text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_restrictions r
     where r.vault_address = vault and r.hidden_at is not null
  );
$$;

create or replace function public.project_is_locked(vault text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_restrictions r
     where r.vault_address = vault and r.locked_at is not null
  );
$$;

/* Whether the caller holds, or has held, a stake in this vault.

   Read from the indexer's record of DEPOSIT/CONTRIB events — payload
   [project_id, contributor, amount, raised_total] — matched against the wallet
   the caller proved control of when they linked it. A stake made from a wallet
   never linked to the account does not count, the same limit the builder's own
   read policy has: an address is "yours" here only once you have signed for it.

   Someone who has since reclaimed their stake still counts. They have a history
   with the vault, and their receipts on the profile page point at it. */
create or replace function public.holds_stake_in(vault text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.profiles p
      join public.contract_events e
        on e.contract_id = vault
       and e.topic1 = 'DEPOSIT'
       and e.topic2 = 'CONTRIB'
       and e.payload ->> 1 = p.stellar_public_key
     where p.id = auth.uid()
       and p.stellar_public_key is not null
  );
$$;

/* has_admin_role is true for the named role or for an owner, so this reads
   "an owner, a platform administrator or a project administrator". */
create or replace function public.can_restrict_projects()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_admin_role('project_approver')
      or public.has_admin_role('platform_admin');
$$;

-- ── Visibility ─────────────────────────────────────────────────────────────

drop policy if exists "public listings are readable by anyone" on public.projects;
create policy "public listings are readable by anyone"
  on public.projects for select
  to anon, authenticated
  using (
    is_public
    and not public.project_awaiting_consensus(project_id)
    and not public.creator_is_banned(creator_address)
    and not public.project_is_hidden(vault_address)
  );

-- Additive, like the builder's policy: whatever keeps a listing off the public
-- site — hidden, banned creator, awaiting consensus — never keeps a stakeholder
-- from the vault that holds their stake. Refunds are claimed from that page.
drop policy if exists "stakeholders read a listing they hold a stake in" on public.projects;
create policy "stakeholders read a listing they hold a stake in"
  on public.projects for select
  to authenticated
  using (public.holds_stake_in(vault_address));

-- ── Writing ────────────────────────────────────────────────────────────────
--
-- Through these functions only: no browser role holds a write grant on the
-- table. That puts the role check, the restricting admin's identity and the
-- audit entry in one transaction where a caller cannot supply any of them — the
-- actor is auth.uid(), never an argument.

create or replace function public.set_project_hidden(vault text, hide boolean, reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text := left(btrim(coalesce(reason, '')), 500);
  cur public.project_restrictions%rowtype;
  had_row boolean;
begin
  if not public.can_restrict_projects() then
    raise exception 'Only an owner, a platform administrator or a project administrator can hide a project.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.projects p where p.vault_address = vault) then
    raise exception 'No project uses that vault.';
  end if;

  select * into cur from public.project_restrictions r where r.vault_address = vault for update;
  had_row := found;

  if hide then
    if why = '' then
      raise exception 'Give a reason. The builder is shown it, and it is kept in the audit log.';
    end if;
    if had_row and cur.hidden_at is not null then
      raise exception 'That project is already hidden.';
    end if;

    insert into public.project_restrictions (vault_address, hidden_at, hidden_by, hidden_reason)
    values (vault, now(), auth.uid(), why)
    on conflict (vault_address) do update
       set hidden_at     = excluded.hidden_at,
           hidden_by     = excluded.hidden_by,
           hidden_reason = excluded.hidden_reason,
           updated_at    = now();
  else
    if not had_row or cur.hidden_at is null then
      raise exception 'That project is not hidden.';
    end if;

    if cur.locked_at is null then
      delete from public.project_restrictions r where r.vault_address = vault;
    else
      update public.project_restrictions r
         set hidden_at = null, hidden_by = null, hidden_reason = '', updated_at = now()
       where r.vault_address = vault;
    end if;
  end if;

  insert into public.admin_audit_log (action, actor_id, detail)
  values (
    case when hide then 'project.hide' else 'project.unhide' end,
    auth.uid(),
    vault || case when why = '' then '' else ': ' || why end
  );
end;
$$;

create or replace function public.set_project_locked(vault text, lock boolean, reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text := left(btrim(coalesce(reason, '')), 500);
  cur public.project_restrictions%rowtype;
  had_row boolean;
begin
  if not public.can_restrict_projects() then
    raise exception 'Only an owner, a platform administrator or a project administrator can lock a project.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.projects p where p.vault_address = vault) then
    raise exception 'No project uses that vault.';
  end if;

  select * into cur from public.project_restrictions r where r.vault_address = vault for update;
  had_row := found;

  if lock then
    if why = '' then
      raise exception 'Give a reason. It is shown on the listing, and it is kept in the audit log.';
    end if;
    if had_row and cur.locked_at is not null then
      raise exception 'That project is already locked.';
    end if;

    insert into public.project_restrictions (vault_address, locked_at, locked_by, locked_reason)
    values (vault, now(), auth.uid(), why)
    on conflict (vault_address) do update
       set locked_at     = excluded.locked_at,
           locked_by     = excluded.locked_by,
           locked_reason = excluded.locked_reason,
           updated_at    = now();
  else
    if not had_row or cur.locked_at is null then
      raise exception 'That project is not locked.';
    end if;

    if cur.hidden_at is null then
      delete from public.project_restrictions r where r.vault_address = vault;
    else
      update public.project_restrictions r
         set locked_at = null, locked_by = null, locked_reason = '', updated_at = now()
       where r.vault_address = vault;
    end if;
  end if;

  insert into public.admin_audit_log (action, actor_id, detail)
  values (
    case when lock then 'project.lock' else 'project.unlock' end,
    auth.uid(),
    vault || case when why = '' then '' else ': ' || why end
  );
end;
$$;

-- ── Milestone proof under a lock ───────────────────────────────────────────
--
-- Proof is the one lock-covered action that is not a transaction: the server
-- writes it with the service role, which RLS does not reach. A trigger does.
-- `before update of proof` fires only when proof is in the SET list, so the
-- indexer's milestone upserts — which never write proof — pass straight through.
create or replace function public.guard_locked_milestone_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.proof is distinct from old.proof and exists (
    select 1 from public.projects p
     where p.id = new.project_id
       and public.project_is_locked(p.vault_address)
  ) then
    raise exception 'This project is locked by the platform. Milestone proof cannot be submitted while it is locked.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_locked_milestone_proof_trigger on public.project_milestones;
create trigger guard_locked_milestone_proof_trigger
  before update of proof on public.project_milestones
  for each row execute function public.guard_locked_milestone_proof();

-- ── RLS and grants ─────────────────────────────────────────────────────────

alter table public.project_restrictions enable row level security;

-- Readable wherever the project itself is. The subquery runs under the caller's
-- own policies on projects, so this inherits every visibility rule rather than
-- restating them: anyone sees the lock on a public listing, a builder and their
-- stakeholders see why a hidden listing is hidden, and a visitor learns nothing
-- about a listing they cannot see. Admins read every row, including one whose
-- project row a resync has not rebuilt yet.
drop policy if exists project_restrictions_read on public.project_restrictions;
create policy project_restrictions_read
  on public.project_restrictions for select
  to anon, authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.projects p
       where p.vault_address = project_restrictions.vault_address
    )
  );

-- Who restricted a project is the audit log's business, readable by admins
-- there; the reason is meant to be read. So the *_by columns are granted to no
-- browser role, and nothing is writable from a browser at all.
revoke all on public.project_restrictions from anon, authenticated;
grant select (vault_address, hidden_at, hidden_reason, locked_at, locked_reason, updated_at)
  on public.project_restrictions to anon, authenticated;

revoke execute on function
  public.project_is_hidden(text),
  public.project_is_locked(text),
  public.holds_stake_in(text),
  public.can_restrict_projects(),
  public.set_project_hidden(text, boolean, text),
  public.set_project_locked(text, boolean, text),
  public.guard_locked_milestone_proof()
  from public, anon, authenticated;

-- The two predicates appear in policies that apply to anon, and the interface
-- asks project_is_locked before building a stake.
grant execute on function
  public.project_is_hidden(text),
  public.project_is_locked(text)
  to anon, authenticated;

grant execute on function
  public.holds_stake_in(text),
  public.can_restrict_projects(),
  public.set_project_hidden(text, boolean, text),
  public.set_project_locked(text, boolean, text)
  to authenticated;

comment on function public.set_project_hidden(text, boolean, text) is
  'Hide or unhide a listing. Owner, platform administrator or project administrator; reason required to hide; audit-logged.';
comment on function public.set_project_locked(text, boolean, text) is
  'Lock or unlock a project on the platform. Pauses new stakes, opening milestone votes and milestone proof; never refunds, stakeholder votes or carried releases.';
