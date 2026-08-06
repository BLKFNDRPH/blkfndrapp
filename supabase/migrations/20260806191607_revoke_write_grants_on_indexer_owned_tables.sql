-- Tighten writes on the tables the indexer owns.
--
-- These already had no INSERT/UPDATE/DELETE policy, so RLS filtered any write
-- to zero rows -- the data was never actually modifiable. But the default
-- Supabase GRANT of INSERT/UPDATE/DELETE to anon and authenticated was still
-- present, which means the statement was *accepted* and silently did nothing
-- rather than being rejected.
--
-- That distinction matters: it leaves the safety of on-chain-derived data
-- resting entirely on nobody ever adding a permissive policy later. Revoking
-- the privilege makes the refusal structural, and makes a mistaken policy
-- addition insufficient on its own to open a write path.
--
-- Found by probing the live database as the anon role rather than by reading
-- the policies and assuming.
--
-- Select grants are untouched: public listings stay publicly readable.

revoke insert, update, delete, truncate on public.projects from anon, authenticated;
revoke insert, update, delete, truncate on public.project_milestones from anon, authenticated;
revoke insert, update, delete, truncate on public.platform_settings from anon, authenticated;
revoke insert, update, delete, truncate on public.claim_requests from anon, authenticated;

-- kyc_requests keeps its narrow column-scoped insert/update grants, and
-- notifications keeps update(is_read) plus delete, both fenced by policies that
-- scope to the caller's own rows.
revoke truncate on public.kyc_requests from anon, authenticated;
revoke truncate on public.notifications from anon, authenticated;
