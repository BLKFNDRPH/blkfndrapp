-- Admins are identified by email and wallet address. Until now the roster held
-- only the email.
--
-- That gap is what makes a correctly connected wallet look unrecognised. An
-- admin is invited by email, signs in, connects Freighter — and nothing has ever
-- recorded which wallet belongs to them, so there is no fact in the system that
-- could match the two. The console can only fall back to the on-chain factory
-- admin, which is a single deployer key, so every other admin's wallet reads as
-- a stranger's.
--
-- Adding the column here does NOT grant contract powers. The ledger checks a
-- signature against its own roster and does not read this table. What this gives
-- is the app's side of the identity: "this wallet belongs to this admin", which
-- is what the console needs to stop treating a known person as anonymous.

alter table public.platform_admins
  add column if not exists wallet_address text;

-- Stellar strkeys are uppercase base32: 'G' followed by 55 characters, and the
-- alphabet excludes 0, 1, 8 and I. Constrained here rather than only in the
-- form, because an address that is wrong by one character is indistinguishable
-- from an address belonging to someone else, and both fail silently at compare
-- time. NULL stays allowed: an invite is addressed before its holder has a
-- wallet to name.
alter table public.platform_admins
  drop constraint if exists platform_admins_wallet_address_strkey;

alter table public.platform_admins
  add constraint platform_admins_wallet_address_strkey
  check (
    wallet_address is null
    or wallet_address ~ '^G[A-Z2-7]{55}$'
  );

-- Case-sensitive and exact, unlike the email index below it. A strkey is not
-- free text — lower-casing one would produce an address that is simply invalid,
-- and matching case-insensitively would accept a string the network never will.
create unique index if not exists platform_admins_wallet_address_idx
  on public.platform_admins (wallet_address)
  where wallet_address is not null;

comment on column public.platform_admins.wallet_address is
  'The admin''s Stellar address, for recognising them when they connect Freighter. Not a grant of contract authority: that is the on-chain roster, which does not consult this table.';

-- ── Recognising a connected wallet ─────────────────────────────────────────
--
-- The console needs to answer "is the wallet in front of me an admin's?" before
-- the visitor is known to be one — the wallet bar renders for anyone who reaches
-- the dashboard. Reading platform_admins directly cannot answer that, because
-- its RLS restricts every select to admins, so a non-admin gets zero rows and a
-- non-admin's wallet and an unknown wallet look identical.
--
-- SECURITY DEFINER with a boolean return is the narrow way through: it answers
-- one yes/no question about one address the caller already holds, and discloses
-- nothing else. It deliberately does not return who the admin is, so it cannot
-- be walked to enumerate the roster.
create or replace function public.is_admin_wallet(addr text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.platform_admins a
     where a.wallet_address = addr
  );
$$;

revoke execute on function public.is_admin_wallet(text) from public;
grant execute on function public.is_admin_wallet(text) to authenticated;

comment on function public.is_admin_wallet(text) is
  'Whether a Stellar address belongs to a platform admin. Returns only a boolean so it cannot be used to enumerate the roster.';
