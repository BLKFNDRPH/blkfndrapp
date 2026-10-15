-- An administrator invite binds only to an account whose email is confirmed
-- (Gate 4 finding F1).
--
-- An invite is a platform_admins row addressed to an email before the account
-- exists. claim_admin_invite bound it the moment an auth.users row with that
-- email was inserted, confirmed or not, and is_admin(), is_owner(),
-- has_admin_role() and my_role() also matched a row by the email in the
-- caller's token. So whoever registered an invited address first held the
-- role, without ever proving they own the mailbox. Live had two unclaimed
-- owner invites when this was written, and no unconfirmed account matching
-- either.
--
-- Now:
--   * claim_admin_invite binds only once email_confirmed_at is set. It runs on
--     insert (OAuth sign-ups arrive confirmed) and again when an account's
--     email is confirmed or changed, so an email sign-up is bound when its
--     owner clicks the link.
--   * The role functions match by email through caller_confirmed_email(),
--     read from auth.users rather than the token, so an unconfirmed address
--     never matches. And they match by email only for a row not yet bound to
--     an account: once bound, the row belongs to that account alone.
--
-- Every other part of the four functions is unchanged. guard_admin_removal
-- still compares the token's email, but only to refuse a self-removal, so a
-- looser match there can only refuse more.

create or replace function public.caller_confirmed_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
    from auth.users u
   where u.id = auth.uid()
     and u.email_confirmed_at is not null;
$$;

revoke execute on function public.caller_confirmed_email() from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.platform_admins a
     where a.user_id = auth.uid()
        or (a.user_id is null and lower(a.email) = public.caller_confirmed_email())
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a
     where a.role = 'owner'
       and (a.user_id = auth.uid()
            or (a.user_id is null and lower(a.email) = public.caller_confirmed_email()))
  );
$$;

create or replace function public.has_admin_role(wanted public.admin_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a
     where (a.role = wanted or a.role = 'owner')
       and (a.user_id = auth.uid()
            or (a.user_id is null and lower(a.email) = public.caller_confirmed_email()))
  );
$$;

create or replace function public.my_role()
returns public.admin_role
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
    from public.platform_admins a
   where a.user_id = auth.uid()
      or (a.user_id is null and lower(a.email) = public.caller_confirmed_email())
   limit 1;
$$;

create or replace function public.claim_admin_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null then
    return new;
  end if;
  update public.platform_admins
     set user_id = new.id
   where user_id is null
     and lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists claim_admin_invite_on_confirm on auth.users;
create trigger claim_admin_invite_on_confirm
  after update of email_confirmed_at, email on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function public.claim_admin_invite();
