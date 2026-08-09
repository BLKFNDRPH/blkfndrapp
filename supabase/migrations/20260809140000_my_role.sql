-- The caller's own role, asked fresh.
--
-- The dashboard needs to show a KYC manager the identity queue and nothing else,
-- an accountant the vault and nothing else. That is a question about the person
-- looking, and like is_admin() it is answered from the roster on each request
-- rather than from a claim baked into the token — a role cached in a JWT only
-- ever goes stale in the dangerous direction.
--
-- Returns null for someone who is not on the roster at all, so a caller who is
-- not an admin is distinguishable from one whose role could not be read.
create or replace function public.my_role()
returns admin_role
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
    from public.platform_admins a
   where a.user_id = auth.uid()
      or lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
   limit 1;
$$;

revoke execute on function public.my_role() from public;
grant execute on function public.my_role() to anon, authenticated;

comment on function public.my_role() is
  'The calling admin''s role, or null if they are not on the roster. Read fresh, never from a token claim.';
