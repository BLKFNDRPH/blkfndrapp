-- An identity check's personal data is deleted once a reviewer has decided.
--
-- Until now a decided check kept everything it was filed with -- the ID
-- number, date of birth, home address, email and the document scan -- for as
-- long as the account existed, though nothing reads any of it after the
-- decision. The attestation commits to details_hash, and recording or revoking
-- it reads only that hash and the wallet.
--
-- What is cleared, and when:
--
--   document_path         on any decision. The hash never covered the image.
--   email, id_number,     once the hash is final: on a rejection, or on an
--   date_of_birth,        approval with a wallet. An approval given before the
--   residential_address   applicant had a wallet keeps them until one is
--                         attached, because attachOwnKycWallet recomputes the
--                         hash from them together with the address. The update
--                         that attaches the wallet then clears them itself.
--
-- Kept: full_name, document_type, document_expires_on, details_hash, status and
-- the wallet. That is the record of who was verified and against what
-- commitment. A rejected applicant re-enters every field to resubmit (they
-- cannot read them back anyway), so clearing a rejection costs them nothing.
--
-- A trigger rather than the review code, so every write path obeys it, the
-- dashboard included.
--
-- The document itself is a Storage object, and SQL cannot delete those:
-- storage.objects carries protect_objects_delete. So the decision clears
-- document_path here, and the app deletes, through the Storage API, every
-- object no row points at any more. kyc_documents_to_delete() below lists them.

-- A decided row no longer has these. A pending one still must: the review
-- needs both, and the not-null constraints were what guaranteed that.
alter table public.kyc_requests
  alter column email drop not null,
  alter column document_path drop not null,
  add constraint kyc_requests_pending_is_complete
    check (status <> 'pending' or (email is not null and document_path is not null));

create or replace function public.drop_identity_after_decision()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status in ('approved', 'rejected') then
    new.document_path := null;
    if new.status = 'rejected' or new.stellar_address is not null then
      new.email := null;
      new.id_number := null;
      new.date_of_birth := null;
      new.residential_address := null;
    end if;
  end if;
  return new;
end;
$$;

-- Same reasoning as 20260806190906: a trigger function left executable is a
-- PostgREST RPC endpoint.
revoke execute on function public.drop_identity_after_decision()
  from public, anon, authenticated;

create trigger kyc_requests_drop_identity_after_decision
  before insert or update on public.kyc_requests
  for each row execute function public.drop_identity_after_decision();

-- The checks already decided. updated_at is what the applicant's page shows as
-- the submission date, so the touch trigger sits this one out.
alter table public.kyc_requests disable trigger kyc_requests_touch_updated_at;
update public.kyc_requests set status = status where status in ('approved', 'rejected');
alter table public.kyc_requests enable trigger kyc_requests_touch_updated_at;

-- Identity documents no submission points at: all of one applicant's at once,
-- and anyone's after an hour. The applicant's own are what a decision or a
-- resubmission just let go of. The hour is for the rest -- an abandoned upload,
-- a deleted account, a delete that failed -- and is far longer than the
-- seconds between an upload and the submission that names it, so a document on
-- its way to review is never listed.
--
-- Read-only. The caller deletes what it returns, through the Storage API.
create or replace function public.kyc_documents_to_delete(for_user uuid)
returns text[]
language sql
stable
set search_path to ''
as $$
  select coalesce(array_agg(o.name order by o.name), '{}')
  from storage.objects o
  where o.bucket_id = 'kyc-documents'
    and not exists (
      select 1 from public.kyc_requests r where r.document_path = o.name
    )
    and (
      (storage.foldername(o.name))[1] = for_user::text
      or o.created_at < now() - interval '1 hour'
    );
$$;

revoke execute on function public.kyc_documents_to_delete(uuid)
  from public, anon, authenticated;
grant execute on function public.kyc_documents_to_delete(uuid) to service_role;
