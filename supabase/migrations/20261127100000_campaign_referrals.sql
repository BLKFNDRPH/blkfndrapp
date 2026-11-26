-- Campaign: referral codes, referred sign-ups and practice-USDC claims
-- (Sprint 2, plan item 1.4).
--
--   referral_codes        one code per account, made the first time the
--                         account asks for its referral link.
--   campaign_referrals    one row per referred account: who referred it and
--                         with which code. A referred account is counted once
--                         (unique referred_user_id), nobody refers themselves
--                         (check constraint). "Referred sign-ups" in the
--                         campaign baseline is count(*) of this table.
--   campaign_usdc_claims  the practice-USDC dispenser's ledger: one paid (or
--                         in-flight) claim per account and per wallet, the
--                         wallet being the account's linked one at the time.
--
-- Server-only, like wallet_link_challenges: RLS on with no policy, and no
-- grants to anon or authenticated (Supabase grants new tables to both by
-- default; see 20261015141432_revoke_browser_table_grants). Every read and
-- write goes through the service role after requireCaller(), in
-- src/lib/campaign.
--
-- campaign_reserve_usdc_claim is the one place a claim is admitted. It takes a
-- transaction-scoped advisory lock so the daily cap holds under concurrent
-- claims, and relies on the partial unique indexes for "once per account and
-- per wallet". A claim the network refused is marked failed, which frees the
-- account and wallet to try again; a failed row stays as history.

create table public.referral_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  code       text not null unique
             check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  created_at timestamptz not null default now()
);

create table public.campaign_referrals (
  id               bigint generated always as identity primary key,
  referrer_id      uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  code             text not null,
  created_at       timestamptz not null default now(),
  constraint campaign_referrals_not_self check (referrer_id <> referred_user_id)
);

create index campaign_referrals_referrer_idx on public.campaign_referrals (referrer_id);

create table public.campaign_usdc_claims (
  id             bigint generated always as identity primary key,
  -- Kept when the account is deleted (set null) so the wallet stays spent.
  user_id        uuid references auth.users(id) on delete set null,
  wallet_address text not null check (wallet_address ~ '^G[A-Z2-7]{55}$'),
  amount_stroops bigint not null check (amount_stroops > 0),
  asset_code     text not null,
  asset_issuer   text not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'paid', 'failed')),
  tx_hash        text,
  error          text,
  created_at     timestamptz not null default now(),
  settled_at     timestamptz
);

create unique index campaign_usdc_claims_one_per_user
  on public.campaign_usdc_claims (user_id) where status in ('pending', 'paid');
create unique index campaign_usdc_claims_one_per_wallet
  on public.campaign_usdc_claims (wallet_address) where status in ('pending', 'paid');
create index campaign_usdc_claims_created_at_idx on public.campaign_usdc_claims (created_at);

alter table public.referral_codes enable row level security;
alter table public.campaign_referrals enable row level security;
alter table public.campaign_usdc_claims enable row level security;

revoke all on public.referral_codes from anon, authenticated;
revoke all on public.campaign_referrals from anon, authenticated;
revoke all on public.campaign_usdc_claims from anon, authenticated;

-- Admit one claim, or say why not: 'reserved', 'already-claimed' or
-- 'daily-cap'. The reserved row's id comes back with 'reserved'.
create or replace function public.campaign_reserve_usdc_claim(
  p_user_id        uuid,
  p_wallet         text,
  p_amount_stroops bigint,
  p_asset_code     text,
  p_asset_issuer   text,
  p_daily_cap      integer
)
returns table (outcome text, claim_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  today_count integer;
  new_id bigint;
begin
  -- One admission at a time, so two claims cannot both see room under the cap.
  perform pg_advisory_xact_lock(hashtext('campaign_usdc_claims'));

  if exists (
    select 1 from public.campaign_usdc_claims c
     where c.status in ('pending', 'paid')
       and (c.user_id = p_user_id or c.wallet_address = p_wallet)
  ) then
    return query select 'already-claimed'::text, null::bigint;
    return;
  end if;

  select count(*) into today_count
    from public.campaign_usdc_claims c
   where c.status in ('pending', 'paid')
     and c.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  if today_count >= p_daily_cap then
    return query select 'daily-cap'::text, null::bigint;
    return;
  end if;

  insert into public.campaign_usdc_claims
    (user_id, wallet_address, amount_stroops, asset_code, asset_issuer)
  values
    (p_user_id, p_wallet, p_amount_stroops, p_asset_code, p_asset_issuer)
  returning id into new_id;

  return query select 'reserved'::text, new_id;
end;
$$;

revoke execute on function public.campaign_reserve_usdc_claim(uuid, text, bigint, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.campaign_reserve_usdc_claim(uuid, text, bigint, text, text, integer)
  to service_role;
