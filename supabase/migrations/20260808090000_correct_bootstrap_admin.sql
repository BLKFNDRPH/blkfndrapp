-- Correct the bootstrap administrator.
--
-- 20260807112735_platform_admins.sql seeded info@makerspaceinnovhub.com, which
-- is not the platform owner's account. The owner signs in as
-- tzarumang@gmail.com, so the seeded invite was never claimable by them and the
-- console was unreachable for the only person who had registered.
--
-- Written as a correction rather than an edit to the original migration. That
-- one has already been applied, so editing it would change nothing here while
-- silently diverging from what the database actually ran.
--
-- Order matters: guard_admin_removal refuses to remove the last administrator,
-- so the replacement is inserted before the old row is deleted. Reversing these
-- two statements makes the migration fail rather than empty the roster, which
-- is the trigger behaving correctly.

-- user_id is bound directly when the account already exists.
-- claim_admin_invite() only fires on INSERT into auth.users, so an email-only
-- row for an existing account would keep a null user_id forever — still a valid
-- administrator via the email branch of is_admin(), but matched by string
-- comparison on every check rather than by the indexed id.
insert into public.platform_admins (email, user_id, note)
select u.email, u.id, 'Platform owner'
  from auth.users u
 where lower(u.email) = 'tzarumang@gmail.com'
on conflict do nothing;

-- Falls back to an unclaimed invite if that account does not exist yet, so a
-- fresh deployment applying every migration in order still ends up with the
-- right administrator.
insert into public.platform_admins (email, note)
select 'tzarumang@gmail.com', 'Platform owner'
 where not exists (
   select 1 from public.platform_admins
    where lower(email) = 'tzarumang@gmail.com'
 );

delete from public.platform_admins
 where lower(email) = 'info@makerspaceinnovhub.com';
