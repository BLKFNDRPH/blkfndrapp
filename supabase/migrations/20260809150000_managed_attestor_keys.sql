-- Managed signing keys for KYC attestors.
--
-- A KYC attestor is hired to review identity, not to run a wallet. The platform
-- generates their signing key, funds it for gas, and holds it — so the reviewer
-- approves in the console and the server signs the on-chain attestation on their
-- behalf. They never connect Freighter, and the key can attest and do nothing
-- else: it holds no project funds and is not the registry admin.
--
-- The private key lives in Supabase Vault, reachable only by the service role
-- this server holds — not anon, not a signed-in owner. That is the same boundary
-- get_platform_secret draws, and for the same reason: a key a browser session
-- could read is a key an attacker with a stolen session could read. The public
-- key is not a secret and lives in a column, so the console can show which
-- attestor holds which wallet and whether the registry has appointed it.
--
-- Verified against the live database before shipping: the service role can round
-- -trip a key, and reading one back is refused to authenticated and anon.

-- The attestor's public key. Null unless the platform currently holds a key for
-- this person — which is the whole lifecycle: present when assigned, gone when
-- removed. Kept distinct from wallet_address, which is a key the *owner* connects
-- themselves; a managed wallet is one the owner never sees the secret of.
alter table public.platform_admins
  add column if not exists managed_wallet text;

-- A generated key is random, so a collision is astronomically unlikely — but an
-- accidental double-assignment of the same address to two rows is a bug we would
-- rather have the database refuse than chase. Partial, so the many rows without a
-- managed key do not collide on null.
create unique index if not exists platform_admins_managed_wallet_key
  on public.platform_admins (managed_wallet)
  where managed_wallet is not null;

-- Write: service role only. The secret is generated server-side and must never
-- transit a browser, so unlike set_platform_secret this is not offered to
-- authenticated at all — the only caller is the provisioning server action, which
-- holds the service-role key. key_ref is the attestor's email; the vault name is
-- namespaced here so the caller cannot address a secret outside this space.
create or replace function public.set_managed_key(key_ref text, secret_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  vname text := 'managed_attestor:' || lower(key_ref);
  existing uuid;
begin
  select id into existing from vault.secrets where name = vname;
  if existing is null then
    perform vault.create_secret(secret_value, vname, 'Managed KYC attestor signing key');
  else
    perform vault.update_secret(existing, secret_value);
  end if;
end;
$$;

revoke execute on function public.set_managed_key(text, text) from public, anon, authenticated;
grant execute on function public.set_managed_key(text, text) to service_role;

-- Read: service role only. This is the one function that returns a private key,
-- so it is reachable by nothing a browser can hold. The server loads the key to
-- sign an attestation and never sends it anywhere else.
create or replace function public.get_managed_key(key_ref text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'managed_attestor:' || lower(key_ref)
   limit 1;
$$;

revoke execute on function public.get_managed_key(text) from public, anon, authenticated;
grant execute on function public.get_managed_key(text) to service_role;

-- Delete: service role only. Called after the key's remaining balance has been
-- swept back, when an attestor is removed — the secret should not outlive the
-- appointment. Idempotent: removing a key that is already gone is not an error,
-- so a half-finished removal can be retried.
create or replace function public.delete_managed_key(key_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'managed_attestor:' || lower(key_ref);
end;
$$;

revoke execute on function public.delete_managed_key(text) from public, anon, authenticated;
grant execute on function public.delete_managed_key(text) to service_role;
