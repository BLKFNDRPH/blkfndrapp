-- Trigger functions are reachable over PostgREST as /rest/v1/rpc/<name> unless
-- EXECUTE is revoked, because Postgres grants it to PUBLIC by default. Caught
-- by the Supabase security advisor after the first migrations landed.
--
-- handle_new_user is SECURITY DEFINER and writes to public.profiles. Invoked
-- outside a trigger it errors on the missing NEW record, so the practical
-- exposure is small -- but a definer-rights function that writes to a table
-- should not be in the public API surface, and "it happens to fail" is not an
-- access control.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Supabase's own event trigger, which auto-enables RLS on tables created in
-- public. Event triggers fire on DDL as their owner regardless of EXECUTE
-- grants, so revoking removes the RPC path without disabling the safety net.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- is_admin stays callable: SECURITY INVOKER, reading only the caller's own JWT.
