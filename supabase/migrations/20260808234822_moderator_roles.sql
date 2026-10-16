-- Console access without a share: moderators.
--
-- Until now every row in platform_admins was an owner — someone who holds a
-- share of platform revenue and votes on how it moves. That made hiring a
-- financial act: adding a KYC reviewer diluted everyone's earnings and handed
-- them a vote on the treasury.
--
-- Roles separate the two questions. An owner owns the platform. A moderator does
-- a job on it.
--
-- ## The rule that matters
--
-- Only owners count toward the threshold, and only owners may edit the roster.
-- Before this, platform_admins_write was gated on is_admin() — "anyone with
-- console access" — which under a role system would have let a newly hired
-- accountant promote themselves to owner and vote on the money. The narrowing
-- below is the whole point of the migration; the rest is plumbing.

create type admin_role as enum ('owner', 'kyc_manager', 'project_approver', 'accountant');

-- Defaulting to owner is what keeps the existing roster correct: every row that
-- exists today was created when owner was the only kind of admin there was.
alter table public.platform_admins
  add column if not exists role admin_role not null default 'owner';

comment on column public.platform_admins.role is
  'owner holds a share and votes; the others are jobs on the platform and hold neither.';

create index if not exists platform_admins_role_idx on public.platform_admins (role);

-- ── Who is what ────────────────────────────────────────────────────────────

/* Console access of any kind. Unchanged in meaning, so every existing policy
   that gates on it keeps working — a moderator can reach the dashboard. */
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins a
     where a.user_id = auth.uid()
        or lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

/* Ownership: a share, and a vote. This is the one that gates money. */
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins a
     where a.role = 'owner'
       and (a.user_id = auth.uid()
            or lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

/* A specific job. Owners hold every capability, because an owner who could not
   review a KYC request while short-staffed would have to appoint themselves to
   a role to do it, and the roster would drift from who actually runs things. */
create or replace function public.has_admin_role(wanted admin_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins a
     where (a.role = wanted or a.role = 'owner')
       and (a.user_id = auth.uid()
            or lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

revoke execute on function public.is_owner() from public;
revoke execute on function public.has_admin_role(admin_role) from public;
grant execute on function public.is_owner(), public.has_admin_role(admin_role)
  to anon, authenticated;

-- ── Only owners count toward a vote ────────────────────────────────────────
--
-- Without this a moderator would raise the threshold without being able to help
-- meet it: three owners and two accountants would need four votes from three
-- eligible people, and every consensus would deadlock.
create or replace function public.owner_count()
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from public.platform_admins
   where user_id is not null and role = 'owner';
$$;

-- ── The roster is owners-only ──────────────────────────────────────────────
--
-- The narrowing this migration exists for. A moderator may read the roster —
-- knowing who to ask is part of doing the job — but may not change it, and so
-- cannot promote themselves.
drop policy if exists platform_admins_write on public.platform_admins;
create policy platform_admins_write
  on public.platform_admins for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ── Capabilities ───────────────────────────────────────────────────────────

/* KYC: the support manager's job, and nobody else's.
   
   Additive. kyc_requests had no admin policy at all — reviewers reached it
   through the service-role client, which bypasses RLS and means the only thing
   standing between a console session and every applicant's identity documents
   was application code. These sit alongside the applicant policies rather than
   replacing them (policies are OR'd), so an applicant keeps seeing their own
   submission and a KYC manager can now work through their own session, with the
   database enforcing the boundary rather than trusting a route to. */
drop policy if exists kyc_manager_reads_submissions on public.kyc_requests;
create policy kyc_manager_reads_submissions
  on public.kyc_requests for select to authenticated
  using (public.has_admin_role('kyc_manager'));

drop policy if exists kyc_manager_decides on public.kyc_requests;
create policy kyc_manager_decides
  on public.kyc_requests for update to authenticated
  using (public.has_admin_role('kyc_manager'))
  with check (public.has_admin_role('kyc_manager'));

/* Flagging a listing for owner consensus is the approver's job. */
drop policy if exists project_moderation_write on public.project_moderation;
create policy project_moderation_write
  on public.project_moderation for all to authenticated
  using (public.has_admin_role('project_approver'))
  with check (public.has_admin_role('project_approver'));

/* Voting is ownership, not a job. An approver decides what needs a vote; only
   owners cast one. Same for the roadmap. */
drop policy if exists project_approval_votes_write on public.project_approval_votes;
create policy project_approval_votes_write
  on public.project_approval_votes for all to authenticated
  using (public.is_owner() and voter_id = auth.uid())
  with check (public.is_owner() and voter_id = auth.uid());

drop policy if exists project_approval_votes_read on public.project_approval_votes;
create policy project_approval_votes_read
  on public.project_approval_votes for select to authenticated
  using (public.is_admin());

drop policy if exists feature_request_decisions_write on public.feature_request_decisions;
create policy feature_request_decisions_write
  on public.feature_request_decisions for all to authenticated
  using (public.is_owner() and voter_id = auth.uid())
  with check (public.is_owner() and voter_id = auth.uid());

/* The accountant reads and never writes. Financial history is already readable
   by any admin; the role exists so someone can be given that and nothing else,
   which no policy below has to state — it is the absence of write policies for
   them that does the work. */
drop policy if exists admin_audit_log_read on public.admin_audit_log;
create policy admin_audit_log_read
  on public.admin_audit_log for select to authenticated
  using (public.is_admin());

comment on function public.is_owner() is
  'Holds a share and a vote. Gates the roster, the treasury and every consensus.';
comment on function public.has_admin_role(admin_role) is
  'Holds a specific job, or is an owner. Gates the day-to-day console capabilities.';
