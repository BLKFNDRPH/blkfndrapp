-- Only an owner can ban someone on the administrator roster (Gate 4 finding M1).
--
-- platform_bans_write lets any platform_admin write a ban, and nothing looked at
-- who it was for. A ban also sets Supabase's own ban on the account, so a
-- platform_admin could lock an owner, or any other administrator, out of the
-- platform. The roster is owner business: only an owner adds or removes
-- someone on it (revokeAdmin, guard_admin_removal), so only an owner bans them.
--
-- Checked in a trigger, not the policy, because the policy cannot see the
-- target's roster entry by email without reading auth.users, and because the
-- live table still grants UPDATE table-wide (20261007104544 is not applied
-- there), so a ban row could otherwise be re-pointed at an owner after it was
-- written. The trigger covers both INSERT and UPDATE of user_id.
--
-- It also refuses a ban on yourself, and records banned_by as the caller
-- rather than whatever the client sent.
--
-- Writes with no signed-in caller (the service role, the SQL console) are
-- trusted and pass unchanged. The app writes bans through the caller's
-- session, so its path always meets the check.

create or replace function public.guard_platform_ban()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target_email text;
begin
  if caller is null then
    return new;
  end if;

  if new.user_id = caller then
    raise exception 'You cannot ban yourself.'
      using errcode = 'insufficient_privilege';
  end if;

  select lower(u.email) into target_email from auth.users u where u.id = new.user_id;

  -- Matched by user_id or by email, as is_admin() matches the caller: an
  -- invite that has not been claimed yet is on the roster by email only.
  if exists (
    select 1 from public.platform_admins a
     where a.user_id = new.user_id
        or (target_email is not null and lower(a.email) = target_email)
  ) and not public.is_owner() then
    raise exception 'Only an owner can ban an administrator.'
      using errcode = 'insufficient_privilege';
  end if;

  new.banned_by := caller;
  return new;
end;
$$;

revoke execute on function public.guard_platform_ban() from public, anon, authenticated;

drop trigger if exists guard_platform_ban on public.platform_bans;
create trigger guard_platform_ban
  before insert or update of user_id on public.platform_bans
  for each row execute function public.guard_platform_ban();
