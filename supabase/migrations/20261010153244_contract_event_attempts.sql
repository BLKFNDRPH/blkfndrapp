-- How many indexer passes have started handling each event.
--
-- A handler that threw left its event's row without processed_at, and the next
-- pass, finding the row, took the event for handled and skipped it: a failure
-- was never retried. The indexer now retries such an event and counts each
-- attempt here before its handler runs, so an attempt cut short by a redeploy
-- counts too. After five it gives up and moves on, so one event that always
-- fails cannot hold every project's indexing behind it. An event it gave up on
-- keeps processed_at null, its last error and its count, and the console's
-- health view reports it.
--
-- Rows already here start at 0. Every one of them is processed, and one that
-- was not would simply be retried from its first attempt.
--
-- The table's grants were revoked from anon and authenticated when it was
-- created, and a new column gains none, so only the service role reads it.

alter table public.contract_events
  add column attempts integer not null default 0;
