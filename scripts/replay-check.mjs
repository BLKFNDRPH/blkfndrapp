#!/usr/bin/env node
//
// Rebuild every vault's state from the indexer's stored events, and check it
// against the vault itself.
//
// The indexer re-reads a vault when one of its events arrives, so the figures
// in `projects` come from the ledger. This shows the events are enough on their
// own: src/lib/vault-replay.ts replays each vault's contract_events in order,
// starting from the terms the vault fixes when it opens (goal, deadline, stage
// ids), which no event carries. The result is compared field by field with
// get_state, get_info, contributor_count and get_balance for every staker.
//
// A vault whose events arrived after the indexer's cursor is reported as
// "behind", not as a mismatch: the indexer has not stored them yet.
//
// Read-only. It reads contract_events and indexer_state with the service-role
// key, and the chain through the RPC; it writes nothing.
//
// Usage:
//   node --env-file=.env.local scripts/replay-check.mjs          a table, then any differences
//   node --env-file=.env.local scripts/replay-check.mjs --json   the same, as JSON
//
// Exits 1 if any vault differs or its events disagree with themselves.

import { createClient } from "@supabase/supabase-js";
import { contract, rpc } from "@stellar/stellar-sdk";
import { VAULT_STATES, compareWithChain, replayVault } from "../src/lib/vault-replay.ts";

const PUBLIC = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || (PUBLIC ? "" : "https://soroban-testnet.stellar.org");
const PASSPHRASE = PUBLIC
  ? "Public Global Stellar Network ; September 2015"
  : "Test SDF Network ; September 2015";
const JSON_OUT = process.argv.includes("--json");

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

/** Every stored event, in pages: PostgREST returns at most 1,000 rows a request. */
async function storedEvents() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("contract_events")
      .select("event_id, ledger, contract_id, topic1, topic2, payload")
      .order("event_id")
      .range(from, from + 999);
    if (error) fail(`Could not read contract_events: ${error.message}`);
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

async function indexerCursor() {
  const { data, error } = await db
    .from("indexer_state")
    .select("value")
    .eq("key", "last_processed_ledger")
    .maybeSingle();
  if (error) fail(`Could not read the indexer cursor: ${error.message}`);
  return Number(data?.value ?? 0);
}

/** Vaults with events on the chain the indexer has not reached yet. */
async function vaultsAhead(vaults, cursor) {
  const ahead = new Set();
  for (let i = 0; i < vaults.length; i += 5) {
    let pageCursor;
    for (;;) {
      const response = await server.getEvents(
        pageCursor
          ? { cursor: pageCursor, filters: [{ type: "contract", contractIds: vaults.slice(i, i + 5) }], limit: 200 }
          : {
              startLedger: cursor + 1,
              filters: [{ type: "contract", contractIds: vaults.slice(i, i + 5) }],
              limit: 200,
            },
      );
      for (const e of response.events) ahead.add(String(e.contractId));
      if (response.events.length < 200) break;
      pageCursor = response.cursor;
    }
  }
  return ahead;
}

/** What the vault itself reports. Older vault code lacks some reads; those are skipped. */
async function readChain(vault, stakers) {
  const client = await contract.Client.from({
    contractId: vault,
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
  });
  const [state, info] = await Promise.all([client.get_state(), client.get_info()]);
  let contributorCount;
  if (typeof client.contributor_count === "function") {
    contributorCount = Number((await client.contributor_count()).result);
  }
  const balances = new Map();
  for (const who of stakers) {
    balances.set(who, BigInt((await client.get_balance({ contributor: who })).result));
  }
  const raw = state.result;
  return {
    // The binding answers an integer enum as its number.
    state: typeof raw === "number" ? raw : Number(raw?.tag ?? raw),
    info: info.result,
    contributorCount,
    balances,
  };
}

const short = (address) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const units = (raw) => (Number(raw) / 1e7).toLocaleString("en-US", { maximumFractionDigits: 7 });

/**
 * Which vaults the indexer is behind on, or null when the RPC could not say.
 *
 * The latest ledger comes from getHealth, not getLatestLedger: the latter
 * decodes the whole latest ledger, other people's transactions included, and
 * throws on any XDR the SDK predates. getEvents can still fail (the RPC, or an
 * event value the SDK cannot decode). That only costs the lag check: the
 * comparison itself still runs, and a difference is then reported as a
 * mismatch rather than excused as "behind".
 */
async function indexerLag(vaults, cursor) {
  try {
    const { latestLedger } = await server.getHealth();
    return { latest: latestLedger, ahead: latestLedger > cursor ? await vaultsAhead(vaults, cursor) : new Set() };
  } catch (error) {
    return { latest: null, ahead: null, error: String(error?.message ?? error) };
  }
}

const [events, cursor] = await Promise.all([storedEvents(), indexerCursor()]);
const now = BigInt(Math.floor(Date.now() / 1000));

const deploys = events
  .filter((e) => e.topic1 === "FACTORY" && e.topic2 === "DEPLOY")
  .map((e) => ({ projectId: String(e.payload[0]), vault: String(e.payload[1]) }));
const lag = await indexerLag(deploys.map((d) => d.vault), cursor);
const ahead = lag.ahead ?? new Set();

const results = [];
for (const { projectId, vault } of deploys) {
  const own = events.filter((e) => e.contract_id === vault);
  const stakers = [
    ...new Set(own.filter((e) => e.topic1 === "DEPOSIT" && e.topic2 === "CONTRIB").map((e) => String(e.payload[1]))),
  ];

  let chain;
  try {
    chain = await readChain(vault, stakers);
  } catch (error) {
    results.push({ projectId, vault, result: "unreadable", error: String(error?.message ?? error) });
    continue;
  }

  const terms = {
    goal: BigInt(chain.info.goal),
    deadline: BigInt(chain.info.deadline),
    milestoneIds: chain.info.milestones.map((m) => Number(m.id)),
  };
  const replayed = replayVault(terms, own, now);
  const differences = compareWithChain(replayed, chain);
  const nearDeadline = replayed.state <= 3 && (now - terms.deadline < 120n && terms.deadline - now < 120n);

  results.push({
    projectId,
    vault,
    events: replayed.events,
    state: VAULT_STATES[replayed.state],
    raised: replayed.raised.toString(),
    releasedTotal: replayed.releasedTotal.toString(),
    stakers: replayed.balances.size,
    stages: replayed.milestones.map((m) => (m.released ? "paid" : m.failed ? "failed" : m.voteOpensAt ? "voting" : "open")),
    differences,
    selfCheck: replayed.selfCheck,
    result:
      differences.length === 0 && replayed.selfCheck.length === 0
        ? "match"
        : ahead.has(vault) || nearDeadline
          ? "behind"
          : "MISMATCH",
  });
}

results.sort((a, b) => Number(a.projectId) - Number(b.projectId));
const summary = {
  checkedAt: new Date().toISOString(),
  network: PUBLIC ? "public" : "testnet",
  indexerCursor: cursor,
  latestLedger: lag.latest,
  indexerLagError: lag.error,
  storedEvents: events.length,
  vaults: results.length,
  match: results.filter((r) => r.result === "match").length,
  behind: results.filter((r) => r.result === "behind").length,
  mismatch: results.filter((r) => r.result === "MISMATCH" || r.result === "unreadable").length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, results }, null, 2));
} else {
  console.log(
    `Replay check, ${summary.network}, ${summary.checkedAt}\n` +
      `${summary.storedEvents} stored events; indexer at ledger ${cursor}, ` +
      (lag.error ? `could not check indexer lag (${lag.error})\n` : `chain at ${lag.latest}\n`),
  );
  console.table(
    results.map((r) => ({
      project: `#${r.projectId}`,
      vault: short(r.vault),
      events: r.events,
      state: r.state,
      raised: r.raised === undefined ? "" : units(r.raised),
      paid: r.releasedTotal === undefined ? "" : units(r.releasedTotal),
      stakers: r.stakers,
      stages: r.stages?.join(" ") ?? "",
      result: r.result,
    })),
  );
  for (const r of results) {
    if (r.result === "match") continue;
    console.log(`\n#${r.projectId} ${r.vault}: ${r.result}`);
    if (r.error) console.log(`  could not read the vault: ${r.error}`);
    for (const d of r.differences ?? []) {
      console.log(`  ${d.field}: replayed ${d.replayed}, vault says ${d.chain}`);
    }
    for (const s of r.selfCheck ?? []) console.log(`  events disagree: ${s}`);
  }
  console.log(
    `\n${summary.match} of ${summary.vaults} vaults match the chain` +
      (summary.behind ? `, ${summary.behind} behind the indexer (rerun shortly)` : "") +
      (summary.mismatch ? `, ${summary.mismatch} DIFFER` : "") +
      ".",
  );
}

process.exit(summary.mismatch ? 1 : 0);
