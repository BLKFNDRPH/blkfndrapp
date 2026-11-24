import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBuilderRecord,
  type AttestationInput,
  type ListingInput,
} from "./builder-record.ts";
import { canonicalHash } from "./canonical-json.ts";

/**
 * Attestations shaped as the contract binding returns them (i128 and u64 as
 * bigint, u32 as number) and listings shaped as `Project`.
 *
 * Run with `npm test`.
 */

const BUILDER = "GBUILDER";
const OTHER = "GOTHER";

const attestation = (over: Partial<AttestationInput>): AttestationInput => ({
  builder: BUILDER,
  vault: "CVAULT1",
  project_id: 1n,
  outcome: 0,
  total_raised: 5_000_000_000n,
  bond_posted: 250_000_000n,
  milestones_total: 3,
  milestones_approved: 3,
  closed_at: 1_790_000_000n,
  ...over,
});

const listing = (over: Partial<ListingInput>): ListingInput => ({
  id: "1",
  title: "A workshop",
  status: "raising",
  vaultAddress: "CVAULT1",
  creatorAddress: BUILDER,
  currencyType: "USDC",
  fundingGoalRaw: "5000000000",
  currentFundingRaw: "1000000000",
  createdAt: "2026-10-01T00:00:00+00:00",
  ...over,
});

test("a builder with no history has an empty record, not a missing one", () => {
  const record = buildBuilderRecord(BUILDER, [], []);
  assert.deepEqual(record.summary, {
    completed: 0,
    failedWithForfeiture: 0,
    failedToFund: 0,
    closed: 0,
    open: 0,
    milestonesApproved: 0,
    milestonesTotal: 0,
  });
  assert.deepEqual(record.closed, []);
  assert.deepEqual(record.open, []);
});

test("closed vaults come from the registry and are counted by outcome", () => {
  const record = buildBuilderRecord(
    BUILDER,
    [
      attestation({ vault: "CVAULT3", project_id: 3n, outcome: 2, milestones_approved: 0, closed_at: 1_790_000_300n }),
      attestation({ vault: "CVAULT1", project_id: 1n, outcome: 0, closed_at: 1_790_000_100n }),
      attestation({ vault: "CVAULT2", project_id: 2n, outcome: 1, milestones_approved: 1, closed_at: 1_790_000_200n }),
    ],
    [],
  );
  assert.deepEqual(
    record.closed.map((v) => [v.vault, v.outcome]),
    [
      ["CVAULT1", "completed"],
      ["CVAULT2", "failed-with-forfeiture"],
      ["CVAULT3", "failed-to-fund"],
    ],
  );
  assert.equal(record.summary.completed, 1);
  assert.equal(record.summary.failedWithForfeiture, 1);
  assert.equal(record.summary.failedToFund, 1);
  assert.equal(record.summary.closed, 3);
  assert.equal(record.summary.milestonesApproved, 4);
  assert.equal(record.summary.milestonesTotal, 9);
});

test("amounts and ids leave as decimal strings", () => {
  const [vault] = buildBuilderRecord(BUILDER, [attestation({})], []).closed;
  assert.equal(vault.projectId, "1");
  assert.equal(vault.totalRaisedRaw, "5000000000");
  assert.equal(vault.bondPostedRaw, "250000000");
  assert.equal(vault.closedAt, 1_790_000_000);
});

test("a listing with no registry entry is an open vault", () => {
  const record = buildBuilderRecord(
    BUILDER,
    [attestation({ vault: "CVAULT1" })],
    [
      listing({ id: "1", vaultAddress: "CVAULT1", status: "completed" }),
      listing({ id: "2", vaultAddress: "CVAULT2", title: "Second run" }),
    ],
  );
  assert.equal(record.summary.open, 1);
  assert.deepEqual(record.open, [
    {
      vault: "CVAULT2",
      projectId: "2",
      title: "Second run",
      currency: "USDC",
      status: "raising",
      goalRaw: "5000000000",
      raisedRaw: "1000000000",
      openedAt: "2026-10-01T00:00:00+00:00",
    },
  ]);
  // The closed vault picks up its listing's title, and is not listed as open.
  assert.deepEqual(record.closed[0].listing, { title: "A workshop", currency: "USDC" });
});

test("a closed vault whose listing the caller cannot see still counts", () => {
  const record = buildBuilderRecord(BUILDER, [attestation({})], []);
  assert.equal(record.summary.closed, 1);
  assert.equal(record.closed[0].listing, null);
});

test("another builder's attestations and listings are left out", () => {
  const record = buildBuilderRecord(
    BUILDER,
    [attestation({ builder: OTHER, vault: "CVAULT9" })],
    [listing({ creatorAddress: OTHER, vaultAddress: "CVAULT8" }), listing({ vaultAddress: undefined })],
  );
  assert.equal(record.summary.closed, 0);
  assert.equal(record.summary.open, 0);
});

test("a vault returned twice counts once", () => {
  const record = buildBuilderRecord(BUILDER, [attestation({}), attestation({})], []);
  assert.equal(record.summary.closed, 1);
});

test("an outcome the app does not know is an error, not a guess", () => {
  assert.throws(() => buildBuilderRecord(BUILDER, [attestation({ outcome: 7 })], []), /Unknown attestation outcome 7/);
});

test("the same history gives the same hash whatever order it arrived in", () => {
  const a1 = attestation({ vault: "CVAULT1", closed_at: 1_790_000_100n });
  const a2 = attestation({ vault: "CVAULT2", project_id: 2n, closed_at: 1_790_000_200n });
  const l3 = listing({ id: "3", vaultAddress: "CVAULT3", createdAt: "2026-11-01T00:00:00+00:00" });
  const l4 = listing({ id: "4", vaultAddress: "CVAULT4", createdAt: "2026-11-02T00:00:00+00:00" });
  const one = buildBuilderRecord(BUILDER, [a1, a2], [l3, l4]);
  const two = buildBuilderRecord(BUILDER, [a2, a1], [l4, l3]);
  assert.equal(canonicalHash(one), canonicalHash(two));
});
