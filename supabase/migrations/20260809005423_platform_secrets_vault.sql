-- Integration secrets live in Supabase Vault, not in a table and never in the
-- client bundle. Owners set them; the server reads them; no session in between
-- can ever see a value.
--
-- Verified against the live database: an owner can set a secret and see it
-- listed as present, but reading its value back is refused even to them; only
-- the service role can read it; and a non-owner is refused the write outright.

-- Write: owner-only. The value passes through as an argument and goes straight
-- into the Vault, encrypted at rest. Upsert by name so replacing a rotated key
-- is the same call as setting it the first time.
create or replace function public.set_platform_secret(secret_name text, secret_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare existing uuid;
begin
  if not public.is_owner() then
    raise exception 'Only an owner may set platform secrets.' using errcode = '42501';
  end if;
  if secret_name not in ('pinata_jwt', 'resend_api_key') then
    raise exception 'Unknown platform secret: %', secret_name using errcode = '22023';
  end if;

  select id into existing from vault.secrets where name = secret_name;
  if existing is null then
    perform vault.create_secret(secret_value, secret_name, 'Platform integration secret');
  else
    perform vault.update_secret(existing, secret_value);
  end if;
end;
$$;

revoke execute on function public.set_platform_secret(text, text) from public, anon;
grant execute on function public.set_platform_secret(text, text) to authenticated;

-- Read: service role only. This is the one function that returns a secret value,
-- so it is reachable by nothing a browser can hold — not anon, not a signed-in
-- owner, only the server's own key.
create or replace function public.get_platform_secret(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;

revoke execute on function public.get_platform_secret(text) from public, anon, authenticated;
grant execute on function public.get_platform_secret(text) to service_role;

-- Status: presence and age, never the value. Owners only — a non-owner gets no
-- rows rather than an error, which is the same shape is_owner uses elsewhere.
create or replace function public.platform_secret_status()
returns table (name text, is_set boolean, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.name,
         exists (select 1 from vault.secrets s where s.name = n.name),
         (select s.updated_at from vault.secrets s where s.name = n.name)
    from (values ('pinata_jwt'), ('resend_api_key')) as n(name)
   where public.is_owner();
$$;

revoke execute on function public.platform_secret_status() from public, anon;
grant execute on function public.platform_secret_status() to authenticated;
