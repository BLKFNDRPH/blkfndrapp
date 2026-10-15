-- Wallet-link challenges kept against the account that asked for them (Gate 4
-- findings M3 and L4).
--
-- auth_challenges was keyed by wallet address alone. Any signed-in user could
-- ask for, or overwrite, the challenge for anyone's wallet, and the verify
-- route accepted the signature from whichever session sent it. With the bare
-- hex nonce as the signed text, a phished signature linked the victim's
-- wallet to the attacker's account.
--
-- This table is keyed by user_id: one challenge per account, replaced only by
-- that account, redeemed only by that account's session. message is the exact
-- text the wallet signed (buildWalletLinkMessage: site, account, wallet,
-- network, nonce, expiry), and the signature is checked against it.
--
-- A new table rather than a change to auth_challenges, so the app deployed
-- now keeps linking wallets through the old table until the new one ships.
-- auth_challenges is unused after that and can be dropped in a later
-- migration.
--
-- Server-only, like auth_challenges: RLS on with no policy, and no grants to
-- anon or authenticated (Supabase grants new tables to both by default).

create table public.wallet_link_challenges (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  public_key text not null,
  nonce      text not null,
  message    text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index wallet_link_challenges_expires_at_idx on public.wallet_link_challenges (expires_at);

alter table public.wallet_link_challenges enable row level security;
revoke all on public.wallet_link_challenges from anon, authenticated;
