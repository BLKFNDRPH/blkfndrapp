-- Contract event log and indexer cursor.
--
-- The Mongo version stored each event payload as a JSON *string*, so finding a
-- contributor's events meant an unindexed regex over every document -- both a
-- full-collection scan and, since the pattern came from chain data, a
-- regex-injection surface. jsonb with a GIN index makes those real queries.
--
-- The event_id unique constraint is what lets the indexer upsert instead of
-- read-then-write, closing the window where a crash between the two left an
-- event marked processed that never was.

create table public.contract_events (
  id               uuid primary key default gen_random_uuid(),
  -- Soroban's event id. The dedup key.
  event_id         text not null unique,
  ledger           bigint not null,
  ledger_closed_at timestamptz,
  contract_id      text not null,
  topic1           text not null default '',
  topic2           text not null default '',
  payload          jsonb not null default '[]'::jsonb,
  processed_at     timestamptz,
  -- Set when handling threw, so a failure is visible instead of silently
  -- leaving the event marked done.
  error            text,
  created_at       timestamptz not null default now()
);

create index contract_events_ledger_idx on public.contract_events (ledger);
create index contract_events_contract_id_idx on public.contract_events (contract_id);
create index contract_events_topics_idx on public.contract_events (topic1, topic2);
create index contract_events_payload_idx on public.contract_events using gin (payload);
-- Partial index over the ones still needing attention.
create index contract_events_unprocessed_idx on public.contract_events (ledger)
  where processed_at is null;

create table public.indexer_state (
  key        text primary key,
  value      bigint not null,
  updated_at timestamptz not null default now()
);

create trigger indexer_state_touch_updated_at
  before update on public.indexer_state
  for each row execute function public.touch_updated_at();

-- Indexer internals. RLS on with no policy is deny-by-default, which is right:
-- nothing holding a browser key has business here, and the indexer uses the
-- service-role key, which bypasses RLS.
alter table public.contract_events enable row level security;
alter table public.indexer_state enable row level security;

revoke all on public.contract_events from anon, authenticated;
revoke all on public.indexer_state from anon, authenticated;
