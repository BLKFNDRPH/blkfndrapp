import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VAULT_STATES,
  compareWithChain,
  replayVault,
  type ChainVault,
  type ReplayedVault,
  type StoredEvent,
  type VaultTerms,
} from "./vault-replay.ts";

/**
 * Replays modelled on testnet histories, with payloads shaped as PostgREST
 * stores them: i128 and u64 as decimal strings, u32 as numbers.
 *
 * Run with `npm test`.
 */

const VAULT = "CDRPVAULT";
const ALICE = "GALICE";
const BOB = "GBOB";
const UNIT = 10_000_000n;

let seq = 0;
function ev(topic1: string, topic2: string, payload: unknown[]): StoredEvent {
  seq += 1;
  return {
    event_id: `${String(seq).padStart(19, "0")}-0000000000`,
    ledger: 5_000_000 + seq,
    contract_id: VAULT,
    topic1,
    topic2,
    payload,
  };
}

const TERMS: VaultTerms = { goal: 1000n * UNIT, deadline: 2_000_000_000n, milestoneIds: [1, 2] };
const BEFORE_DEADLINE = 1_900_000_000n;
const AFTER_DEADLINE = 2_100_000_000n;

function opened(): StoredEvent[] {
  seq = 0;
  return [ev("VAULT", "INIT", ["16", "bafy"]), ev("BOND", "POSTED", ["16", String(50n * UNIT)])];
}

function stake(who: string, amount: bigint, running: bigint) {
  return ev("DEPOSIT", "CONTRIB", ["16", who, String(amount * UNIT), String(running * UNIT)]);
}

/** The vault's reads as they would answer for a replayed vault. */
function chainOf(v: ReplayedVault): ChainVault {
  return {
    state: v.state,
    info: {
      raised_amount: v.raised,
      released_total: v.releasedTotal,
      bond_amount: v.bondAmount,
      bond_posted: v.bondPosted,
      bond_returned: v.bondReturned,
      unclaimed_contributions: v.unclaimed,
      milestones: v.milestones.map((m) => ({
        id: m.id,
        released: m.released,
        failed: m.failed,
        vote_opens_at: m.voteOpensAt,
        approved_weight: m.approvedWeight,
      })),
    },
    contributorCount: v.balances.size,
    balances: new Map(v.balances),
  };
}

test("stakes add up to the raise and each staker's balance", () => {
  const v = replayVault(
    TERMS,
    [...opened(), stake(ALICE, 300n, 300n), stake(BOB, 30n, 330n), stake(ALICE, 300n, 630n)],
    BEFORE_DEADLINE,
  );
  assert.equal(VAULT_STATES[v.state], "raising");
  assert.equal(v.raised, 630n * UNIT);
  assert.equal(v.balances.get(ALICE), 600n * UNIT);
  assert.equal(v.balances.get(BOB), 30n * UNIT);
  assert.equal(v.bondAmount, 50n * UNIT);
  assert.equal(v.bondPosted, true);
  assert.deepEqual(v.selfCheck, []);
});

test("a raise past its deadline reads as funded or failed before anyone settles it", () => {
  const short = [...opened(), stake(ALICE, 300n, 300n)];
  assert.equal(VAULT_STATES[replayVault(TERMS, short, AFTER_DEADLINE).state], "failed");

  const met = [...opened(), stake(ALICE, 1000n, 1000n)];
  assert.equal(VAULT_STATES[replayVault(TERMS, met, AFTER_DEADLINE).state], "funded");
});

test("payouts move the vault to active, then completed with the deposit back", () => {
  const events = [
    ...opened(),
    ev("VAULT", "FUNDED", ["16", String(1000n * UNIT)]),
    stake(ALICE, 1000n, 1000n),
    ev("MILESTN", "VOTEOPEN", ["16", 1, "1950000000", "1950604800"]),
    ev("MILESTN", "APPROVE", ["16", 1, ALICE, String(200n * UNIT), String(200n * UNIT)]),
    ev("MILESTN", "RELEASE", ["16", 1, String(400n * UNIT), String(400n * UNIT)]),
  ];
  const active = replayVault(TERMS, events, BEFORE_DEADLINE);
  assert.equal(VAULT_STATES[active.state], "active");
  assert.equal(active.milestones[0].released, true);
  assert.equal(active.milestones[0].voteOpensAt, 1_950_000_000n);
  assert.equal(active.milestones[0].approvedWeight, 200n * UNIT);
  assert.equal(active.bondReturned, false);

  const done = replayVault(
    TERMS,
    [
      ...events,
      ev("MILESTN", "VOTEOPEN", ["16", 2, "1960000000", "1960604800"]),
      ev("MILESTN", "APPROVE", ["16", 2, ALICE, String(200n * UNIT), String(200n * UNIT)]),
      ev("BOND", "RETURNED", ["16", String(50n * UNIT)]),
      ev("MILESTN", "RELEASE", ["16", 2, String(600n * UNIT), String(1000n * UNIT)]),
    ],
    AFTER_DEADLINE,
  );
  assert.equal(VAULT_STATES[done.state], "completed");
  assert.equal(done.releasedTotal, 1000n * UNIT);
  assert.equal(done.bondReturned, true);
  assert.deepEqual(done.selfCheck, []);
});

test("a stall fails the first open stage, and the last refund sweeps the deposit", () => {
  const events = [
    ...opened(),
    stake(ALICE, 600n, 600n),
    ev("VAULT", "FUNDED", ["16", String(1000n * UNIT)]),
    stake(BOB, 400n, 1000n),
    ev("VAULT", "STALLED", ["16", "1950000000"]),
    ev("BOND", "SLASHED", ["16", String(50n * UNIT)]),
    ev("DEPOSIT", "REFUND", ["16", ALICE, String(630n * UNIT)]),
  ];
  const v = replayVault(TERMS, events, AFTER_DEADLINE);
  assert.equal(VAULT_STATES[v.state], "refunding");
  assert.deepEqual(
    v.milestones.map((m) => m.failed),
    [true, false],
  );
  assert.equal(v.balances.get(ALICE), 0n);
  assert.equal(v.unclaimed, 400n * UNIT);
  assert.equal(v.bondReturned, false);

  const swept = replayVault(
    TERMS,
    [...events, ev("DEPOSIT", "REFUND", ["16", BOB, String(420n * UNIT)])],
    AFTER_DEADLINE,
  );
  assert.equal(swept.unclaimed, 0n);
  assert.equal(swept.bondReturned, true);
});

test("a vote that ends short fails its stage and opens refunds", () => {
  const v = replayVault(
    TERMS,
    [
      ...opened(),
      stake(ALICE, 1000n, 1000n),
      ev("VAULT", "FUNDED", ["16", String(1000n * UNIT)]),
      ev("MILESTN", "VOTEOPEN", ["16", 2, "1950000000", "1950604800"]),
      ev("MILESTN", "FAILED", ["16", 2, "0", String(1000n * UNIT)]),
      ev("BOND", "SLASHED", ["16", String(50n * UNIT)]),
    ],
    AFTER_DEADLINE,
  );
  assert.equal(VAULT_STATES[v.state], "refunding");
  assert.deepEqual(
    v.milestones.map((m) => [m.id, m.failed]),
    [
      [1, false],
      [2, true],
    ],
  );
});

test("events are replayed in chain order, whatever order they are passed in", () => {
  const events = [...opened(), stake(ALICE, 300n, 300n), stake(BOB, 30n, 330n)];
  const forward = replayVault(TERMS, events, BEFORE_DEADLINE);
  const reversed = replayVault(TERMS, [...events].reverse(), BEFORE_DEADLINE);
  assert.deepEqual(reversed.selfCheck, []);
  assert.deepEqual(compareWithChain(reversed, chainOf(forward)), []);
});

test("a missing stake shows up both in the events and against the vault", () => {
  const full = [...opened(), stake(ALICE, 300n, 300n), stake(BOB, 30n, 330n)];
  const chain = chainOf(replayVault(TERMS, full, BEFORE_DEADLINE));

  const gap = replayVault(TERMS, full.filter((_, i) => i !== 2), BEFORE_DEADLINE);
  assert.match(gap.selfCheck.join("\n"), /says 3300000000 raised/);

  const fields = compareWithChain(gap, chain).map((d) => d.field);
  assert.ok(fields.includes("raised_amount"));
  assert.ok(fields.includes("contributor_count"));
  assert.ok(fields.includes("unclaimed_contributions"));
});

test("a wrong state, payout or vote weight is reported field by field", () => {
  const v = replayVault(TERMS, [...opened(), stake(ALICE, 1000n, 1000n)], BEFORE_DEADLINE);
  const chain = chainOf(v);
  chain.state = 1;
  chain.info.released_total = 5n;
  chain.info.milestones[1].approved_weight = 7n;
  chain.balances.set(ALICE, 1n);

  assert.deepEqual(compareWithChain(v, chain), [
    { field: "state", replayed: "raising", chain: "funded" },
    { field: "released_total", replayed: "0", chain: "5" },
    { field: "stage 2 approved_weight", replayed: "0", chain: "7" },
    { field: `balance ${ALICE}`, replayed: String(1000n * UNIT), chain: "1" },
  ]);
});

test("fields older vault code does not have are skipped, not counted as differences", () => {
  const v = replayVault(TERMS, [...opened(), stake(ALICE, 300n, 300n)], BEFORE_DEADLINE);
  const chain = chainOf(v);
  delete chain.info.bond_returned;
  delete chain.info.unclaimed_contributions;
  chain.info.milestones = chain.info.milestones.map(({ id, released }) => ({ id, released }));
  chain.contributorCount = undefined;
  assert.deepEqual(compareWithChain(v, chain), []);
});
