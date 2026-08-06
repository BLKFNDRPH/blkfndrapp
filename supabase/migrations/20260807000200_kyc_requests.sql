-- KYC requests.
--
-- This is the table whose contents were readable by any anonymous caller in the
-- Mongo version, because authorization lived entirely in application code and
-- one Server Action forgot to check. The defence here is layered so that no
-- single omission repeats that:
--
--   1. RLS confines a caller to their own row.
--   2. Column grants withhold every identity field from the `authenticated`
--      role outright, so no policy bug, no forgotten guard, and no client-side
--      query can return an ID number or a home address. Those columns are
--      reachable only with the service-role key, from server-only code, after
--      an explicit admin check.
--   3. The document scan is not in the database at all -- only a path into a
--      private Storage bucket.
--
-- Replaces the Mongo `kycrequests` collection, which stored the ID document as
-- a base64 string in the row. That is why a single unguarded query returned
-- actual identity documents.

create table public.kyc_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references public.profiles (id) on delete cascade,
  -- One submission per wallet, enforced by the database rather than by a
  -- read-then-write in application code.
  stellar_address     text        not null unique,

  -- Identity fields. See the column grants below: `authenticated` has no read
  -- privilege on any of these.
  full_name           text        not null,
  email               text        not null,
  id_number           text,
  date_of_birth       date,
  residential_address text,
  details_hash        text        not null,
  -- Object path within the private `kyc-documents` bucket. Never the document.
  document_path       text        not null,

  -- Non-sensitive: the applicant needs to see where their submission stands.
  document_type       text        not null,
  document_expires_on date,
  status              text        not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected')),
  rejection_reason    text        not null default '',
  consent_given       boolean     not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint kyc_requests_consent_required check (consent_given)
);

comment on table public.kyc_requests is
  'Identity verification submissions. Identity columns are not granted to the authenticated role -- service-role only.';
comment on column public.kyc_requests.document_path is
  'Path in the private kyc-documents storage bucket. The document itself is never stored in Postgres.';

create index kyc_requests_user_id_idx on public.kyc_requests (user_id);
create index kyc_requests_status_idx on public.kyc_requests (status);

create trigger kyc_requests_touch_updated_at
  before update on public.kyc_requests
  for each row execute function public.touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.kyc_requests enable row level security;

create policy "an applicant sees only their own submission"
  on public.kyc_requests for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "an applicant files their own submission"
  on public.kyc_requests for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    -- A submission always enters as pending. Self-approval is not expressible.
    and status = 'pending'
  );

-- Resubmission after rejection, without touching the verdict.
create policy "an applicant may resubmit while unapproved"
  on public.kyc_requests for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and status in ('pending', 'rejected')
  )
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
  );

-- Deliberately no delete policy: an applicant cannot erase a rejection and
-- start over with a clean history.
--
-- Deliberately no admin policy either. Admin review runs server-side with the
-- service-role key, which bypasses RLS -- that is the only context in which the
-- identity columns below are readable at all, and it keeps review off the path
-- that a browser key can reach.

-- ── Column privileges ──────────────────────────────────────────────────────
--
-- RLS decides which rows; grants decide which columns. Supabase grants all
-- columns to anon/authenticated by default, so this narrows it explicitly.
--
-- The effect: `select * from kyc_requests` fails for a browser key even on the
-- caller's own row. Only the status-tracking columns come back.

revoke all on public.kyc_requests from anon, authenticated;

grant select (
  id,
  user_id,
  stellar_address,
  document_type,
  document_expires_on,
  status,
  rejection_reason,
  created_at,
  updated_at
) on public.kyc_requests to authenticated;

grant insert on public.kyc_requests to authenticated;

grant update (
  full_name,
  email,
  id_number,
  date_of_birth,
  residential_address,
  details_hash,
  document_path,
  document_type,
  document_expires_on,
  status,
  consent_given
) on public.kyc_requests to authenticated;

-- anon gets nothing at all.
