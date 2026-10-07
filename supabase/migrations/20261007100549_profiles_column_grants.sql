-- Narrow profile writes to the columns a user may set for themselves.
--
-- `profiles` had table-wide UPDATE granted to `authenticated`, and its update
-- policy checked only row ownership, not which columns changed. So a signed-in
-- user could
--
--   PATCH /rest/v1/profiles?id=eq.<self>
--     { "stellar_public_key": "G...", "wallet_status": "connected" }
--
-- directly against PostgREST — with no nonce and no signature — bypassing the
-- Freighter challenge that linkWallet is meant to sit behind, and claiming any
-- as-yet-unlinked address as their own. `requireWalletOwnerOrAdmin` then trusts
-- that column, so the forged link passed the ownership gate on milestone-proof
-- submission and under-review listing reads.
--
-- Fix: revoke the table-wide UPDATE and re-grant only the self-service display
-- fields. `stellar_public_key`, `wallet_status` and `last_login_at` are now
-- writable only through the service-role server path (linkWallet / unlinkWallet),
-- and only after the signature challenge has been verified — the same
-- write-only-column pattern already used on `kyc_requests`.
--
-- The RLS policies are unchanged: "a user updates only their own profile" and
-- "admins update any profile" still apply, now within a column grant that keeps
-- both confined to the display fields. Every wallet write in the codebase was
-- moved to the service-role client in the same change set, so nothing that
-- should work stops working.
--
-- DEPLOY ORDER: apply this after the accompanying application code is live
-- (linkWallet/unlinkWallet now use the service-role client). If it is applied
-- first, wallet linking would fail for the window before the new code deploys.

revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- anon held the same table-wide UPDATE. No policy lets it change a row, so it
-- did nothing, but the grant is closed too rather than left for a future
-- policy to open by accident.
--
-- Applied 2026-10-07. A live dry run first showed a signed-in user setting
-- their own stellar_public_key with no signature succeed; after these lines it
-- is refused, as are wallet_status, last_login_at and id. display_name and
-- avatar_url edits, an admin renaming a user, and the service-role linkWallet
-- path all still work; an admin setting another user's wallet is refused.
revoke update on public.profiles from anon;
