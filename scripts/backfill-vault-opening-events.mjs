#!/usr/bin/env node
//
// Print the SQL that records the opening events the indexer missed.
//
// A vault's VAULT/INIT and BOND/POSTED come from its initialize, inside the
// factory's create_vault transaction. The indexer used to read only contracts
// already in `projects`, and a vault reaches `projects` only once its
// FACTORY/DEPLOY is handled, so it skipped both events for nearly every vault.
// The Record tab lost the line saying the builder locked a deposit.
//
// For every FACTORY/DEPLOY row whose vault has no VAULT/INIT or BOND/POSTED
// row, the two events are rebuilt from the DEPLOY. initialize emits INIT then
// BOND/POSTED as its last two events, and create_vault emits DEPLOY straight
// after it returns, so they sit at the DEPLOY's index minus 2 and minus 1, in
// its ledger. INIT carries the DEPLOY's project id and metadata CID;
// BOND/POSTED carries the project id and the vault's bond_amount, read from the
// vault, which never changes it after initialize. While the DEPLOY's ledger is
// still inside the RPC's retention (about 7 days on testnet), the events are
// also read from getEvents and must match the rebuild exactly, or the run
// stops. Horizon is no help past that: it no longer returns result meta.
//
// Read-only. It reads contract_events with the service-role key, and the chain
// through the RPC and Horizon; it writes nothing. The SQL inserts with
// `on conflict (event_id) do nothing`, so running it twice changes nothing.
// Rows are marked processed: both events' handler only re-reads the vault,
// which every later event has done since, and neither notifies anyone.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-vault-opening-events.mjs > backfill.sql
//
// Apply the output only with the owner's go-ahead. Dry-run it first: send it
// with a final `do $$ begin raise exception 'dry run'; end $$;` in the same
// execute_sql call, which rolls the whole call back.

import { createClient } from "@supabase/supabase-js";
import { contract, rpc, scValToNative } from "@stellar/stellar-sdk";

const PUBLIC = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || (PUBLIC ? "" : "https://soroban-testnet.stellar.org");
const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  (PUBLIC ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");
const PASSPHRASE = PUBLIC
  ? "Public Global Stellar Network ; September 2015"
  : "Test SDF Network ; September 2015";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!RPC_URL) fail("NEXT_PUBLIC_SOROBAN_RPC_URL is required on Mainnet.");
const { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, SUPABASE_SECRET_KEY: SECRET } = process.env;
if (!SUPABASE_URL || !SECRET) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");

const db = createClient(SUPABASE_URL, SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const server = new rpc.Server(RPC_URL);

/** As PostgREST stores a payload: i128 and u64 values become decimal strings. */
const asJson = (value) =>
  JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));

const pad = (n, width) => String(n).padStart(width, "0");

async function rows(topic1, topic2, columns) {
  const { data, error } = await db
    .from("contract_events")
    .select(columns)
    .eq("topic1", topic1)
    .eq("topic2", topic2)
    .order("ledger");
  if (error) fail(`Could not read ${topic1}/${topic2} rows: ${error.message}`);
  return data;
}

/** The vault's bond, exactly, from the vault itself. */
async function bondAmount(vault) {
  const client = await contract.Client.from({
    contractId: vault,
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
  });
  const info = (await client.get_info()).result;
  return BigInt(info.bond_amount);
}

/** The create_vault transaction, for the reader to check on an explorer. */
async function transactionHash(toid) {
  // Horizon numbers a transaction's operations from 1; Soroban's TOID from 0.
  const response = await fetch(`${HORIZON_URL}/operations/${BigInt(toid) + 1n}`);
  if (!response.ok) return null;
  return (await response.json()).transaction_hash ?? null;
}

function rebuild(deploy, bond) {
  const [toid, index] = deploy.event_id.split("-");
  const [projectId, vault, , metadataCid] = deploy.payload;
  const base = {
    ledger: Number(deploy.ledger),
    ledger_closed_at: new Date(deploy.ledger_closed_at).toISOString(),
    contract_id: vault,
  };
  return [
    {
      ...base,
      event_id: `${toid}-${pad(Number(index) - 2, 10)}`,
      topic1: "VAULT",
      topic2: "INIT",
      payload: asJson([projectId, metadataCid]),
    },
    {
      ...base,
      event_id: `${toid}-${pad(Number(index) - 1, 10)}`,
      topic1: "BOND",
      topic2: "POSTED",
      payload: asJson([projectId, bond]),
    },
  ];
}

async function fromRpc(vault, ledger) {
  const response = await server.getEvents({
    startLedger: ledger,
    endLedger: ledger + 1,
    filters: [{ type: "contract", contractIds: [vault] }],
    limit: 10,
  });
  return response.events.map((e) => {
    const topics = e.topic.map((t) => String(scValToNative(t)));
    return {
      event_id: e.id,
      ledger: e.ledger,
      ledger_closed_at: new Date(e.ledgerClosedAt).toISOString(),
      contract_id: String(e.contractId),
      topic1: topics[0] ?? "",
      topic2: topics[1] ?? "",
      payload: asJson(scValToNative(e.value)),
      txHash: e.txHash,
    };
  });
}

const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;
const same = (a, b) =>
  ["event_id", "ledger", "ledger_closed_at", "contract_id", "topic1", "topic2", "payload"].every(
    (k) => a[k] === b[k],
  );

const deploys = await rows("FACTORY", "DEPLOY", "event_id, ledger, ledger_closed_at, payload");
const withInit = new Set((await rows("VAULT", "INIT", "contract_id")).map((r) => r.contract_id));
const withBond = new Set((await rows("BOND", "POSTED", "contract_id")).map((r) => r.contract_id));
const { oldestLedger } = await server.getHealth();

/** Comment lines and value rows, in output order. */
const lines = [];
let vaults = 0;
for (const deploy of deploys) {
  const [projectId, vault] = deploy.payload;
  if (withInit.has(vault) && withBond.has(vault)) continue;

  const ledger = Number(deploy.ledger);
  const expected = rebuild(deploy, await bondAmount(vault));
  let source = "rebuilt from its FACTORY/DEPLOY row (outside the RPC's retention)";
  let hash = null;

  if (ledger >= oldestLedger) {
    const read = (await fromRpc(vault, ledger)).filter(
      (e) => `${e.topic1}/${e.topic2}` === "VAULT/INIT" || `${e.topic1}/${e.topic2}` === "BOND/POSTED",
    );
    if (read.length !== 2 || !expected.every((row, i) => same(row, read[i]))) {
      fail(
        `#${projectId} ${vault}: the RPC's events do not match the rebuild.\n` +
          `rebuilt: ${JSON.stringify(expected)}\nrpc:     ${JSON.stringify(read)}`,
      );
    }
    source = "read from getEvents, identical to the rebuild";
    hash = read[0].txHash;
  }
  hash ??= await transactionHash(deploy.event_id.split("-")[0]);

  // A vault holding one of the two keeps it; on conflict skips it anyway.
  const missing = expected.filter((r) => !(r.topic1 === "VAULT" ? withInit : withBond).has(vault));
  lines.push({ comment: `-- #${projectId} ${vault}: create_vault ${hash ?? "(transaction not found)"}, ${source}` });
  for (const r of missing) {
    lines.push({
      row:
        `(${sql(r.event_id)}, ${r.ledger}, ${sql(r.ledger_closed_at)}, ${sql(r.contract_id)}, ` +
        `${sql(r.topic1)}, ${sql(r.topic2)}, ${sql(r.payload)}::jsonb, now())`,
    });
  }
  vaults++;
  console.error(`#${projectId} ${vault}: ${missing.length} row(s), ${source}`);
}

const count = lines.filter((l) => l.row).length;
if (count === 0) {
  console.error("Every deployed vault already has its opening events.");
  process.exit(0);
}

let written = 0;
console.log(
  [
    `-- The opening events (VAULT/INIT, BOND/POSTED) of ${vaults} vault(s), ${count} row(s).`,
    `-- Generated ${new Date().toISOString()} by scripts/backfill-vault-opening-events.mjs`,
    `-- from ${RPC_URL} (retention from ledger ${oldestLedger}).`,
    "insert into public.contract_events",
    "  (event_id, ledger, ledger_closed_at, contract_id, topic1, topic2, payload, processed_at)",
    "values",
    ...lines.map((l) => (l.comment ? `  ${l.comment}` : `  ${l.row}${++written < count ? "," : ""}`)),
    "on conflict (event_id) do nothing;",
  ].join("\n"),
);
