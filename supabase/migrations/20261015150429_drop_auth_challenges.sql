-- Drop the wallet-link challenge table the app no longer uses.
--
-- wallet_link_challenges (20261015144208, #200) replaced auth_challenges: the
-- deployed app has issued and redeemed every challenge through the new table
-- since #200 shipped on 2026-10-15, and nothing in the code, the scheduled
-- jobs or the database refers to the old one or to its purge function.
-- auth_challenges held only five-minute challenges, none of them open when
-- this was written, so nothing of value goes with it.

drop function if exists public.purge_expired_auth_challenges();
drop table if exists public.auth_challenges;
