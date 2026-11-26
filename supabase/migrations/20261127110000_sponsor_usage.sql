-- Fee sponsorship usage and the database half of its kill switch (sprint 2,
-- item 1.6).
--
-- /api/sponsor wraps a stakeholder's own signed contract call in a fee-bump
-- paid by the ops key. Each one it is about to pay for is claimed here first,
-- against two caps: sponsored transactions per account per UTC day, and the
-- total fee bid per UTC day. The caps are passed in by the server
-- (SPONSOR_PER_ACCOUNT_DAILY, SPONSOR_DAILY_BUDGET_STROOPS), placeholders
-- until decision D3 sets them.
--
-- claim_sponsor_slot checks and inserts under one transaction-scoped advisory
-- lock, so concurrent requests are serialised and cannot each see room under
-- a cap and all pass. Sponsorship is low-volume; one global lock is enough.
--
-- A claim the network then refuses before any ledger (no fee charged) is
-- settled as 'rejected' and stops counting. One that was submitted keeps
-- counting at its full bid, the most it can have cost.
--
-- Server-only, like wallet_link_challenges: RLS on with no policy, no table
-- grants to anon or authenticated, and the functions executable by the
-- service role alone.

create table public.sponsor_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users(id) on delete set null,
  account       text not null,
  contract_id   text not null,
  function_name text not null,
  fee_stroops   bigint not null check (fee_stroops > 0),
  day           date not null default ((now() at time zone 'utc')::date),
  status        text not null default 'claimed'
                  check (status in ('claimed', 'submitted', 'rejected')),
  tx_hash       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index sponsor_usage_day_account_idx on public.sponsor_usage (day, account);
create index sponsor_usage_day_user_idx on public.sponsor_usage (day, user_id);

create trigger sponsor_usage_touch_updated_at
  before update on public.sponsor_usage
  for each row execute function public.touch_updated_at();

alter table public.sponsor_usage enable row level security;
revoke all on public.sponsor_usage from anon, authenticated;

-- Claim one sponsored transaction for today, or say which cap refuses it.
-- Returns the new row's id and a null refusal, or a null id and
-- 'account_cap' / 'budget_exhausted'. An account is counted by wallet and by
-- user, so moving a wallet between accounts does not reset either.
create or replace function public.claim_sponsor_slot(
  p_user_id uuid,
  p_account text,
  p_contract_id text,
  p_function_name text,
  p_fee_stroops bigint,
  p_per_account_daily integer,
  p_daily_budget_stroops bigint
)
returns table (slot_id bigint, refusal text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  used  integer;
  spent bigint;
begin
  if p_fee_stroops is null or p_fee_stroops <= 0 then
    raise exception 'fee must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.sponsor_usage'));

  select count(*) into used
    from public.sponsor_usage u
   where u.day = today
     and u.status <> 'rejected'
     and (u.account = p_account or (p_user_id is not null and u.user_id = p_user_id));

  if used >= p_per_account_daily then
    return query select null::bigint, 'account_cap'::text;
    return;
  end if;

  select coalesce(sum(u.fee_stroops), 0) into spent
    from public.sponsor_usage u
   where u.day = today
     and u.status <> 'rejected';

  if spent + p_fee_stroops > p_daily_budget_stroops then
    return query select null::bigint, 'budget_exhausted'::text;
    return;
  end if;

  return query
    insert into public.sponsor_usage (user_id, account, contract_id, function_name, fee_stroops, day)
    values (p_user_id, p_account, p_contract_id, p_function_name, p_fee_stroops, today)
    returning id, null::text;
end;
$$;

-- Record what happened to a claimed slot: 'submitted' with its hash, or
-- 'rejected' when the network refused it before a ledger (it stops counting).
create or replace function public.settle_sponsor_slot(
  p_slot_id bigint,
  p_status text,
  p_tx_hash text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sponsor_usage
     set status = p_status, tx_hash = coalesce(p_tx_hash, tx_hash)
   where id = p_slot_id and status = 'claimed';
$$;

revoke execute on function public.claim_sponsor_slot(uuid, text, text, text, bigint, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.claim_sponsor_slot(uuid, text, text, text, bigint, integer, bigint)
  to service_role;
revoke execute on function public.settle_sponsor_slot(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_sponsor_slot(bigint, text, text)
  to service_role;

-- The kill switch an operator can flip without a redeploy. Sponsorship runs
-- only while SPONSOR_ENABLED is set on the server and this is false; a read
-- that fails counts as paused. Writes go through the service role, like the
-- rest of platform_settings.
alter table public.platform_settings
  add column sponsor_paused boolean not null default false;
