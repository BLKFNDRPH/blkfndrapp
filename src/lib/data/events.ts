import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Contract event storage and the indexer cursor.
 *
 * Replaces the Mongo `eventlogs` and `indexerstates` collections. Two things
 * the old shape got wrong are fixed by the schema rather than by care here:
 *
 *   * payloads are jsonb, so finding a contributor's events is an indexed
 *     containment query rather than a regex over every document — which was
 *     both a full scan and, since the pattern came from chain data, an
 *     injection surface;
 *   * event_id is unique, so recording an event is an upsert instead of a
 *     read-then-write that could crash between the two and leave an event
 *     marked processed that never was.
 */

const CURSOR_KEY = "last_processed_ledger";

export async function getCursor(): Promise<number | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("indexer_state")
    .select("value")
    .eq("key", CURSOR_KEY)
    .maybeSingle();
  return data ? Number(data.value) : null;
}

export async function setCursor(ledger: number) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("indexer_state")
    .upsert({ key: CURSOR_KEY, value: ledger }, { onConflict: "key" });
  if (error) throw new Error(`Could not save indexer cursor: ${error.message}`);
}

/**
 * Record a new event as the indexer's first attempt at it, and return null. An
 * event recorded before is left untouched and its row returned, so the caller
 * can tell one already handled from one an earlier pass failed.
 */
export async function recordEvent(event: {
  eventId: string;
  ledger: number;
  ledgerClosedAt?: string | null;
  contractId: string;
  topic1: string;
  topic2: string;
  payload: unknown;
}): Promise<{ processedAt: string | null; attempts: number; error: string | null } | null> {
  const admin = createAdminClient();

  const { error } = await admin.from("contract_events").insert({
    event_id: event.eventId,
    ledger: event.ledger,
    ledger_closed_at: event.ledgerClosedAt ?? null,
    contract_id: event.contractId,
    topic1: event.topic1,
    topic2: event.topic2,
    payload: event.payload as never,
    attempts: 1,
  });

  if (!error) return null;
  // 23505 is a unique violation: we have seen this event before.
  if (error.code !== "23505") throw new Error(`Could not record event: ${error.message}`);

  const { data, error: readError } = await admin
    .from("contract_events")
    .select("processed_at, attempts, error")
    .eq("event_id", event.eventId)
    .single();
  if (readError) throw new Error(`Could not read event ${event.eventId}: ${readError.message}`);
  return { processedAt: data.processed_at, attempts: data.attempts, error: data.error };
}

/** Count another attempt at an event the indexer is about to retry. */
export async function countAttempt(eventId: string, attempts: number) {
  const admin = createAdminClient();
  const { error } = await admin.from("contract_events").update({ attempts }).eq("event_id", eventId);
  if (error) throw new Error(`Could not count attempt ${attempts} at event ${eventId}: ${error.message}`);
}

/**
 * Mark an event handled.
 *
 * The old version set `processed: true` at insert time, before the handler ran,
 * so a handler that threw left an event permanently marked done and never
 * retried. Here `processed_at` is only set on success, and a write that fails
 * throws, so the event is retried rather than left looking unfinished for good.
 */
export async function markHandled(eventId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("contract_events")
    .update({ processed_at: new Date().toISOString(), error: null })
    .eq("event_id", eventId);
  if (error) throw new Error(`Could not mark event ${eventId} handled: ${error.message}`);
}

/** Record why the indexer's latest attempt at an event failed. */
export async function markFailed(eventId: string, reason: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("contract_events")
    .update({ error: reason.slice(0, 2000) })
    .eq("event_id", eventId);
  if (error) throw new Error(`Could not record that event ${eventId} failed: ${error.message}`);
}

/**
 * A wallet's contribution history, reconstructed from deposit events.
 *
 * The jsonb containment operator uses the GIN index. The Mongo version matched
 * the address with a regex over the serialised payload, which scanned the whole
 * collection and let chain-supplied text reach the pattern.
 */
export async function getContributionsByAddress(address: string) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("contract_events")
    .select("event_id, ledger_closed_at, contract_id, payload")
    .eq("topic1", "DEPOSIT")
    .eq("topic2", "CONTRIB")
    .contains("payload", [null, address] as never)
    .order("ledger", { ascending: false })
    .limit(500);

  if (error) {
    // Containment against a positional array is brittle if the event shape
    // changes; fall back to a bounded scan rather than returning nothing.
    const { data: fallback } = await admin
      .from("contract_events")
      .select("event_id, ledger_closed_at, contract_id, payload")
      .eq("topic1", "DEPOSIT")
      .eq("topic2", "CONTRIB")
      .order("ledger", { ascending: false })
      .limit(2000);

    return (fallback ?? []).filter((row) =>
      Array.isArray(row.payload) ? row.payload.some((v) => v === address) : false,
    );
  }

  return data ?? [];
}

export async function getAllContributions(limit = 500) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("contract_events")
    .select("event_id, ledger_closed_at, contract_id, payload")
    .eq("topic1", "DEPOSIT")
    .eq("topic2", "CONTRIB")
    .order("ledger", { ascending: false })
    .limit(limit);
  return data ?? [];
}
