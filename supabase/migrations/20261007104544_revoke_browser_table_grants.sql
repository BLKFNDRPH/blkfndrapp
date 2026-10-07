-- Take back the table writes the browser roles hold but the app never uses.
--
-- Supabase grants every new table in public ALL to anon and authenticated.
-- Most migrations here then wrote the grants they meant (`grant insert, delete
-- on feature_request_votes to authenticated`, `grant update (is_read) on
-- notifications`), but a GRANT only adds, so the defaults stayed underneath and
-- the narrow grants narrowed nothing. RLS has been the only real guard, and it
-- has two gaps that grants are supposed to cover:
--
--   * A policy says which rows, never which columns. Where a write policy
--     exists, table-wide UPDATE lets its holder change every column of the rows
--     it covers. This was the profiles wallet hole (20261007100549) and the
--     notifications one (fixed by notification_emails, live 20261007104401). Below, it
--     lets a feature-request author mark their own request planned, and lets a
--     single project approver record an owner vote outcome that never happened.
--   * TRUNCATE is not subject to RLS at all. PostgREST has no verb for it, so
--     no request can send it today, but any future path that runs SQL as these
--     roles would empty the table without a policy being asked.
--
-- The rule applied to every table below:
--
--   * anon writes nothing. Every browser write in src goes through
--     createClient() in @/lib/supabase/server after requireCaller() or
--     requireAdmin(), so it always runs as authenticated.
--   * authenticated keeps exactly the verbs, and where it inserts or updates
--     only some columns exactly those columns, that the app sends through that
--     client. Writes made with createAdminClient() (the service role) do not
--     use these grants and are unaffected.
--   * Tables the app writes with PostgREST's .upsert() keep table-wide INSERT
--     and UPDATE. An upsert is INSERT ... ON CONFLICT DO UPDATE SET <every
--     column in the payload>, which needs UPDATE on each of those columns even
--     when nothing conflicts, and column grants on such tables are what broke
--     KYC submission in 20260807174623. On all three the payload is every column
--     but created_at, so a column grant would buy almost nothing.
--
-- Every database function that writes these tables (the consensus triggers,
-- handle_new_user, claim_admin_invite, set_project_hidden/locked, the purge) is
-- SECURITY DEFINER and runs as its owner, so none of them depend on these
-- grants. Foreign-key cascades also run as the table owner, so deleting a
-- flagged listing still removes its votes after DELETE on the votes is revoked.
--
-- No application change goes with this, so it can be applied at any time.
--
-- Dry run on live, 2026-10-07, in one transaction rolled back by a final
-- RAISE, not applied. Every browser write the app makes was run as the role it
-- runs as, before and after these lines, and all 20 changed at least one row
-- both times. That covers both branches of each upsert, the clearModeration
-- cascade, and the KYC first filing and resubmission. Of 19 writes the app
-- never makes, 11 changed a row before. All 19 are now refused with
-- "permission denied", and an author marking their own request planned now
-- changes nothing. TRUNCATE is refused on all 22 public tables for both
-- roles, and service_role is unchanged.
--
-- REFERENCES and TRIGGER stay as they are. Neither is a write, and neither is
-- reachable through PostgREST.


-- ── admin_audit_log ────────────────────────────────────────────────────────
-- Written only by record() in src/lib/data/admins.ts, through the service
-- role. 20260807112735 revoked insert, update and delete but not TRUNCATE, the
-- one write that would erase the trail without RLS being consulted. Reading
-- (admin_audit_log_read, is_admin()) is unchanged.
revoke truncate on public.admin_audit_log from anon, authenticated;


-- ── feature_requests ───────────────────────────────────────────────────────
-- Browser writes (src/lib/data/feature-requests.ts):
--   submitFeatureRequest     insert (title, body, submitted_by)
--   respondToFeatureRequest  update (response, status), admins only
-- Nothing deletes a request from the browser.
--
-- The insert policy checks only submitted_by, so table-wide INSERT let anyone
-- signed in file a request that was already 'planned' or 'shipped', with a
-- response and a decided_at of their choosing, and the owners' two-thirds vote
-- never happened. INSERT is narrowed to the three columns the form sends.
--
-- feature_requests_author_edit was written so an author could fix the wording
-- of an open request, but a policy cannot see which columns change. With
-- table-wide UPDATE it let an author set status, response and decided_at on
-- their own open request, for example marking it planned. No app path edits
-- wording, and once UPDATE is narrowed to (response, status) the policy could
-- only ever allow that, so it is dropped. Status now changes only through
-- feature_requests_owner_edit (is_admin()) and the definer consensus trigger.
revoke insert, update, delete, truncate on public.feature_requests from anon, authenticated;
grant insert (title, body, submitted_by) on public.feature_requests to authenticated;
grant update (response, status) on public.feature_requests to authenticated;
drop policy if exists feature_requests_author_edit on public.feature_requests;


-- ── feature_request_votes ──────────────────────────────────────────────────
-- toggleUpvote upserts (request_id, voter_id) to add an upvote and deletes the
-- row to take it back. The upsert keeps INSERT and UPDATE table-wide (see the
-- header); the write policy pins voter_id to the caller either way. Only
-- TRUNCATE goes from authenticated.
revoke insert, update, delete, truncate on public.feature_request_votes from anon;
revoke truncate on public.feature_request_votes from authenticated;


-- ── feature_request_decisions ──────────────────────────────────────────────
-- decideFeatureRequest upserts (request_id, voter_id, approve), so INSERT and
-- UPDATE stay table-wide. An owner changes their mind by voting again, and
-- nothing in the app deletes a decision. DELETE let an owner remove their vote
-- without a trace, after the trigger had counted it.
revoke insert, update, delete, truncate on public.feature_request_decisions from anon;
revoke delete, truncate on public.feature_request_decisions from authenticated;


-- ── platform_admins ────────────────────────────────────────────────────────
-- Browser writes (src/lib/data/admins.ts), both through the caller's session on
-- purpose, so is_owner() and guard_admin_removal apply:
--   grantAdmin   insert (email, display_name, role, user_id, wallet_address,
--                granted_by, note)
--   revokeAdmin  delete
-- managed_wallet is set only by the service role, after the platform has
-- generated and funded that key, and no browser path updates a row. Table-wide
-- UPDATE let an owner's session rewrite any administrator's role, wallet or
-- managed_wallet in place, and table-wide INSERT let it write a managed_wallet
-- the platform holds no key for.
revoke insert, update, delete, truncate on public.platform_admins from anon, authenticated;
grant insert (email, display_name, role, user_id, wallet_address, granted_by, note)
  on public.platform_admins to authenticated;
grant delete on public.platform_admins to authenticated;


-- ── platform_bans ──────────────────────────────────────────────────────────
-- banUser inserts (user_id, banned_by, reason) and unbanUser deletes, through
-- the caller's session so the platform_admin role check is the policy's. A ban
-- is never edited in place, so UPDATE goes, and INSERT is narrowed to the
-- columns banUser sends.
revoke insert, update, delete, truncate on public.platform_bans from anon, authenticated;
grant insert (user_id, banned_by, reason) on public.platform_bans to authenticated;
grant delete on public.platform_bans to authenticated;


-- ── project_approval_votes ─────────────────────────────────────────────────
-- voteOnProject upserts (project_id, voter_id, approve), so INSERT and UPDATE
-- stay table-wide. Nothing in the app deletes a vote. Votes disappear only
-- when clearModeration deletes their listing's row, through the ON DELETE
-- CASCADE, which runs as the table owner and does not need this grant.
revoke insert, update, delete, truncate on public.project_approval_votes from anon;
revoke delete, truncate on public.project_approval_votes from authenticated;


-- ── project_categories ─────────────────────────────────────────────────────
-- addCategory and removeCategory write with the service role after
-- requireAdmin(). The browser only reads (listCategories), so every write grant
-- goes. project_categories_admin_write is left as it is; no browser role can
-- reach it now.
revoke insert, update, delete, truncate on public.project_categories from anon, authenticated;


-- ── project_moderation ─────────────────────────────────────────────────────
-- Browser writes (src/lib/data/project-moderation.ts):
--   flagForConsensus  insert (project_id, flagged_by, reason)
--   clearModeration   delete
-- state and decided_at are written only by apply_project_consensus, which is
-- SECURITY DEFINER. With table-wide UPDATE and INSERT, any one holder of
-- project_approver could write 'approved' or 'rejected' onto a listing, either
-- on an existing row or on a new one, with no owner vote cast.
revoke insert, update, delete, truncate on public.project_moderation from anon, authenticated;
grant insert (project_id, flagged_by, reason) on public.project_moderation to authenticated;
grant delete on public.project_moderation to authenticated;


-- ── profiles ───────────────────────────────────────────────────────────────
-- Rows are created by handle_new_user (SECURITY DEFINER, on auth.users insert)
-- and removed by the auth.users cascade. The only browser write is
-- updateOwnProfile, already narrowed to update (display_name, avatar_url) by
-- 20261007100549. No policy allows INSERT or DELETE, so those were inert, but
-- they go so that a future policy cannot open them by accident. UPDATE is not
-- touched: revoking it table-wide would also strip the column grant.
revoke insert, delete, truncate on public.profiles from anon, authenticated;


-- ── kyc_requests ───────────────────────────────────────────────────────────
-- submitOwnKyc files a first submission with a plain insert of exactly these
-- columns. It is not an upsert (20260807174623). A resubmission is a plain
-- update of the columns already granted by 20260806190754, unchanged here.
-- The insert policy pins user_id, status = 'pending' and stellar_address, but
-- table-wide INSERT also let the applicant set rejection_reason, created_at,
-- updated_at and id. Nothing treats those as proof of anything today, but
-- they belong to the reviewers and the server. anon has held nothing here
-- since 20260806190754.
revoke insert on public.kyc_requests from authenticated;
grant insert (
  user_id, stellar_address, full_name, email, document_type, document_path,
  id_number, date_of_birth, document_expires_on, residential_address,
  details_hash, consent_given, status
) on public.kyc_requests to authenticated;


-- ── notifications ──────────────────────────────────────────────────────────
-- notification_emails (live 20261007104401) narrowed UPDATE to (is_read) and
-- took anon's UPDATE, and authenticated keeps DELETE for dismiss and
-- dismissAll. That left anon holding DELETE. anon has no session and no policy
-- here, so the grant removed nothing, but it goes too.
revoke delete on public.notifications from anon;
