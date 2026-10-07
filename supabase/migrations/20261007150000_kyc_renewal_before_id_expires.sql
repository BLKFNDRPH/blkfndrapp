-- An identity verification lasts as long as the document it was approved on,
-- and is renewed with a current one before then.
--
-- Until now an approval never ran out. The attestation on the record stood
-- for good, whatever happened to the ID behind it. With the documents deleted
-- after the decision (20261007130000), the expiry date is what is left to say
-- how long the check holds.
--
-- verified_until is that date: the expiry of the document the check was last
-- approved on. document_expires_on can't serve. A renewal writes the new
-- document's expiry there while the old approval still stands on the record,
-- so a turned-down renewal would otherwise leave nothing saying when the old
-- one runs out. So:
--
--   set     when a check becomes approved (this trigger), to its expiry
--   kept    while a renewal is under review or after one is turned down; the
--           record still holds the previous approval until this date
--   cleared when the attestation is revoked (revokeSubmissionAttestation)
--
-- An approved check may be resubmitted from 30 days before verified_until --
-- RENEWAL_WINDOW_DAYS in src/lib/kyc/renewal.ts -- and after it. Approving the
-- renewal replaces the hash on the record (attestSubmission). Past the date
-- the verification has lapsed. The app stops counting it, and reviewers are
-- told to revoke it if it isn't renewed.

alter table public.kyc_requests add column verified_until date;

comment on column public.kyc_requests.verified_until is
  'Expiry of the document this check was last approved on: the attestation on the record holds until then. Set on approval, kept through a renewal, cleared on revocation.';

create or replace function public.track_verified_until()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.verified_until := new.document_expires_on;
  end if;
  return new;
end;
$$;

-- Same reasoning as 20260806190906: a trigger function left executable is a
-- PostgREST RPC endpoint.
revoke execute on function public.track_verified_until()
  from public, anon, authenticated;

create trigger kyc_requests_track_verified_until
  before insert or update on public.kyc_requests
  for each row execute function public.track_verified_until();

-- The checks already approved. updated_at is what the applicant's page shows as
-- the submission date, so the touch trigger sits this one out.
alter table public.kyc_requests disable trigger kyc_requests_touch_updated_at;
update public.kyc_requests set verified_until = document_expires_on where status = 'approved';
alter table public.kyc_requests enable trigger kyc_requests_touch_updated_at;

-- The applicant sees when their verification runs out. Read only: no write
-- grant, and the trigger is the only thing that sets it.
grant select (verified_until) on public.kyc_requests to authenticated;

-- An approved check may be resubmitted once it is due for renewal. The write
-- check is unchanged: the row goes back to pending, on the caller's own linked
-- wallet (20261006155050).
alter policy "an applicant may resubmit while unapproved"
  on public.kyc_requests
  rename to "an applicant may resubmit while unapproved or due for renewal";

alter policy "an applicant may resubmit while unapproved or due for renewal"
  on public.kyc_requests
  using (
    (select auth.uid()) = user_id
    and (
      status in ('pending', 'rejected')
      or (status = 'approved' and verified_until <= current_date + 30)
    )
  );
