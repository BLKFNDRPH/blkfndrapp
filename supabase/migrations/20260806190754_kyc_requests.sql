-- KYC requests. Defended in three layers: RLS confines a caller to their own
-- row, column grants withhold every identity field from browser-facing roles,
-- and the document itself lives in private Storage rather than in a column.
create table public.kyc_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references public.profiles (id) on delete cascade,
  stellar_address     text        not null unique,

  full_name           text        not null,
  email               text        not null,
  id_number           text,
  date_of_birth       date,
  residential_address text,
  details_hash        text        not null,
  document_path       text        not null,

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

alter table public.kyc_requests enable row level security;

create policy "an applicant sees only their own submission"
  on public.kyc_requests for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "an applicant files their own submission"
  on public.kyc_requests for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'pending');

create policy "an applicant may resubmit while unapproved"
  on public.kyc_requests for update to authenticated
  using ((select auth.uid()) = user_id and status in ('pending', 'rejected'))
  with check ((select auth.uid()) = user_id and status = 'pending');

-- No delete policy: an applicant cannot erase a rejection and start over.
-- No admin policy: review runs server-side with the service-role key, which is
-- the only context in which the identity columns below are readable at all.

-- RLS decides which rows; grants decide which columns.
revoke all on public.kyc_requests from anon, authenticated;

grant select (
  id, user_id, stellar_address, document_type, document_expires_on,
  status, rejection_reason, created_at, updated_at
) on public.kyc_requests to authenticated;

grant insert on public.kyc_requests to authenticated;

grant update (
  full_name, email, id_number, date_of_birth, residential_address,
  details_hash, document_path, document_type, document_expires_on,
  status, consent_given
) on public.kyc_requests to authenticated;
