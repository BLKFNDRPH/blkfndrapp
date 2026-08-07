-- KYC submission has never once succeeded: the table is empty because every
-- write was rejected with "permission denied for table kyc_requests".
--
-- The cause is not RLS and not a missing grant. The write went through
-- PostgREST's upsert, which compiles to INSERT ... ON CONFLICT DO UPDATE, and
-- Postgres requires SELECT privilege on every column such a statement assigns
-- -- a plain UPDATE requires no such thing. The identity columns are
-- deliberately not readable by `authenticated`; that withholding is the point
-- of this table. So the statement was refused at privilege-check time, before
-- RLS was ever consulted, which is why the error named the table rather than a
-- policy.
--
-- Verified by running each statement shape as the `authenticated` role:
--   ON CONFLICT ... SET document_type (UPDATE + SELECT granted) -> reaches RLS
--   ON CONFLICT ... SET email         (UPDATE, no SELECT)       -> denied
--   ON CONFLICT ... SET rejection_reason (SELECT, no UPDATE)    -> denied
--   plain UPDATE SET full_name, email                           -> ok
--
-- submitOwnKyc now branches explicitly into INSERT or UPDATE. Two things the
-- database has to supply for that branch to be correct:

-- 1. One submission per applicant.
--
-- getOwnSubmission() looks the row up by user_id with maybeSingle(). Only
-- stellar_address was unique, so an applicant who reconnected with a different
-- wallet would have inserted a second row and made their own status page start
-- erroring. The table is empty, so this constraint costs nothing to add now and
-- would be a data cleanup later. Its index also subsumes the plain lookup index.
alter table public.kyc_requests
  add constraint kyc_requests_user_id_key unique (user_id);

drop index if exists public.kyc_requests_user_id_idx;

-- 2. A resubmission clears the stale rejection.
--
-- An applicant holds no UPDATE grant on rejection_reason -- deliberately, so a
-- rejection cannot be quietly erased -- which means the resubmit path cannot
-- clear it itself, and a freshly resubmitted row would keep displaying the
-- reason it was last rejected for. A BEFORE trigger assigns the column without
-- it appearing in the caller's statement, so the grant stays closed.
create or replace function public.clear_rejection_reason_on_resubmit()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status = 'pending' and old.status is distinct from 'pending' then
    new.rejection_reason := '';
  end if;
  return new;
end;
$$;

-- Same reasoning as 20260806190906: a trigger function left executable is a
-- PostgREST RPC endpoint.
revoke execute on function public.clear_rejection_reason_on_resubmit()
  from public, anon, authenticated;

create trigger kyc_requests_clear_rejection_reason
  before update on public.kyc_requests
  for each row execute function public.clear_rejection_reason_on_resubmit();
