-- A feature request is planned or declined only by the owners' vote (Gate 4
-- finding L2).
--
-- feature_requests_owner_edit was is_admin(), so any administrator, an
-- accountant or a KYC reviewer included, could write status straight onto a
-- request: 'planned' with no owner vote cast, or 'declined' on one the owners
-- had accepted. The two-thirds rule in apply_feature_request_consensus was the
-- intended path and nothing forced it.
--
-- Now:
--   * The edit policy is is_owner(). Only an owner writes a request's response
--     note, or its status.
--   * guard_feature_request_status refuses any status change made from a
--     browser session except the one the app offers: an owner marking a
--     planned request shipped. open -> planned / declined is written only by
--     apply_feature_request_consensus, a SECURITY DEFINER trigger. Its update
--     runs as the function's owner, not as authenticated, so the guard lets it
--     through, and no browser role can call it directly.
--
-- Status changes by the service role or the SQL console are not browser
-- sessions and pass unchanged.

alter policy feature_requests_owner_edit on public.feature_requests
  using (public.is_owner())
  with check (public.is_owner());

create or replace function public.guard_feature_request_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- SECURITY INVOKER on purpose: current_user is then the role that issued the
  -- update, authenticated for a browser session and the definer's owner when
  -- the consensus trigger writes the outcome.
  if new.status is distinct from old.status
     and current_user in ('anon', 'authenticated')
     and not (old.status = 'planned' and new.status = 'shipped')
  then
    raise exception 'A request is planned or declined only by the owners'' vote. Once planned, an owner can mark it shipped.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_feature_request_status() from public, anon, authenticated;

drop trigger if exists guard_feature_request_status on public.feature_requests;
create trigger guard_feature_request_status
  before update of status on public.feature_requests
  for each row execute function public.guard_feature_request_status();
