-- Guard self-removal by email as well as by id.
--
-- The original guard in 20260807112735_platform_admins.sql compared only
-- old.user_id against auth.uid(). An administrator invited by email has a null
-- user_id until claim_admin_invite() binds it on first sign-in, and is_admin()
-- accepts them in the meantime through its email branch. So an admin holding an
-- unclaimed row was a real administrator that the self-removal check could
-- never match, and could delete their own row.
--
-- The last-administrator check below would still have refused the final
-- deletion, so the roster could not be emptied. But on a roster of two this
-- let an admin remove themselves, which the guard exists to prevent.
--
-- Reconstructed from the deployed function: this migration was applied to the
-- database without ever being committed, so the file and the schema had
-- diverged. The body below is what public.guard_admin_removal() actually runs.
create or replace function public.guard_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.user_id is not null and old.user_id = auth.uid())
     or lower(old.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  then
    raise exception 'An admin cannot remove themselves.'
      using errcode = 'check_violation';
  end if;

  if (select count(*) from public.platform_admins) <= 1 then
    raise exception 'The last administrator cannot be removed.'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;
