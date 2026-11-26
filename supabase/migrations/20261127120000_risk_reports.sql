-- Risk reports (Sprint 2, items 1.2 and 1.3).
--
-- One row per report the risk pipeline writes for a vault. report_json is the
-- report's canonical bytes (src/lib/risk/report.ts, serialiseRiskReport), kept
-- as text, not jsonb: jsonb reorders keys and rewrites whitespace, and the
-- whole point of the row is that sha256(report_json) = report_hash, the value
-- anchored on Stellar by the report-anchor registry.
--
-- A report is never edited. A re-run is a new row; the anchor columns are
-- filled once, when the report's hash is anchored.
--
-- Server-only: RLS on with no policy, no grants to anon or authenticated. The
-- public reads a report through /api/risk-reports, by hash or by vault, which
-- serves report_json as stored.

create table public.risk_reports (
  id              bigint generated always as identity primary key,
  vault_address   text not null,
  project_id      text not null,
  report_hash     text not null unique check (report_hash ~ '^[0-9a-f]{64}$'),
  report_json     text not null,
  schema_version  integer not null check (schema_version > 0),
  rules_version   integer not null check (rules_version > 0),
  score           integer not null check (score between 0 and 100),
  band            text not null check (band in ('low', 'medium', 'high')),
  listing_hash        text not null check (listing_hash ~ '^[0-9a-f]{64}$'),
  builder_record_hash text not null check (builder_record_hash ~ '^[0-9a-f]{64}$'),
  vault_terms_hash    text not null check (vault_terms_hash ~ '^[0-9a-f]{64}$'),
  generated_at    timestamptz not null,
  -- Filled when anchored: the registry's seq for this vault, the transaction,
  -- and the ledger close time the registry recorded.
  anchor_contract text,
  anchor_seq      integer,
  anchor_tx       text,
  anchored_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint risk_reports_anchor_complete check (
    (anchor_tx is null and anchor_seq is null and anchored_at is null and anchor_contract is null)
    or (anchor_tx is not null and anchor_seq is not null and anchored_at is not null and anchor_contract is not null)
  )
);

create index risk_reports_vault_idx on public.risk_reports (vault_address, generated_at desc);
create index risk_reports_unanchored_idx on public.risk_reports (id) where anchor_tx is null;

-- The anchor columns are the only thing that may change, and only once.
create function public.risk_reports_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anchor_tx is not null then
    raise exception 'risk report % is already anchored', old.report_hash;
  end if;
  if new.vault_address   is distinct from old.vault_address
     or new.project_id   is distinct from old.project_id
     or new.report_hash  is distinct from old.report_hash
     or new.report_json  is distinct from old.report_json
     or new.schema_version is distinct from old.schema_version
     or new.rules_version is distinct from old.rules_version
     or new.score        is distinct from old.score
     or new.band         is distinct from old.band
     or new.listing_hash is distinct from old.listing_hash
     or new.builder_record_hash is distinct from old.builder_record_hash
     or new.vault_terms_hash is distinct from old.vault_terms_hash
     or new.generated_at is distinct from old.generated_at
     or new.created_at   is distinct from old.created_at then
    raise exception 'risk reports are append-only; only the anchor may be recorded';
  end if;
  return new;
end;
$$;

create trigger risk_reports_immutable
  before update on public.risk_reports
  for each row execute function public.risk_reports_immutable();

alter table public.risk_reports enable row level security;
revoke all on public.risk_reports from anon, authenticated;
