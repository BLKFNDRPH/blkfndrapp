import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBuilderRecord, type AttestationInput } from "../builder-record.ts";
import { canonicalHash } from "../canonical-json.ts";
import { listingInput, vaultTermsInput, type VaultInfoSource } from "./inputs.ts";
import {
  BASE_SCORE,
  MAX_FACTORS,
  MODEL_FACTOR_WEIGHT,
  bps,
  modelFactors,
  scoreRisk,
} from "./rules.ts";
import { buildRiskReport, RULES_ONLY } from "./build.ts";
import { parseModelReply } from "./model.ts";
import { RiskReportSchema, riskReportHash } from "./report.ts";

/** Run with `npm test`. Covers the pure half of the risk pipeline (item 1.2). */

const VAULT = `C${"A".repeat(55)}`;
const OTHER_VAULT = `C${"D".repeat(55)}`;
const BUILDER = `G${"B".repeat(55)}`;
const TOKEN = `C${"T".repeat(55)}`;

const info = (over: Partial<VaultInfoSource> = {}): VaultInfoSource => ({
  project_id: 12n,
  creator: BUILDER,
  token: TOKEN,
  goal: 10_000_0000000n,
  deadline: 1_800_000_000n,
  bond_amount: 500_0000000n,
  bond_posted: true,
  min_contribution: 5_0000000n,
  voting_window_secs: 604_800n,
  platform_fee: 1_0000000n,
  milestones: [
    { id: 1, amount: 3_000_0000000n },
    { id: 0, amount: 3_000_0000000n },
    { id: 2, amount: 4_000_0000000n },
  ],
  ...over,
});

const LONG = "A community solar pump for twelve farms. ".repeat(10);
const listing = (over = {}) =>
  listingInput({
    id: "12",
    title: "Solar pump",
    tagline: "Water for twelve farms",
    description: LONG,
    category: "Energy",
    location: "Kibera",
    imageUrl: "ipfs://x",
    ...over,
  });

const attestation = (over: Partial<AttestationInput> = {}): AttestationInput => ({
  builder: BUILDER,
  vault: OTHER_VAULT,
  project_id: 3n,
  outcome: 0,
  total_raised: 100n,
  bond_posted: 5n,
  milestones_total: 3,
  milestones_approved: 3,
  closed_at: 1_700_000_000n,
  ...over,
});

const openListing = { id: "12", title: "Solar pump", status: "raising", vaultAddress: VAULT, creatorAddress: BUILDER };

test("vault terms are fixed: strings for amounts, milestones in id order, no running totals", () => {
  const terms = vaultTermsInput(VAULT, info());
  assert.equal(terms.goalRaw, "100000000000");
  assert.deepEqual(terms.milestones.map((m) => m.id), [0, 1, 2]);
  assert.equal("raised_amount" in terms, false);
  // Same terms, same hash, whatever order the milestones came in.
  const shuffled = vaultTermsInput(VAULT, info({ milestones: [...info().milestones].reverse() }));
  assert.equal(canonicalHash(terms), canonicalHash(shuffled));
});

test("a listing input ignores fields the report is not written from", () => {
  const a = listingInput({ id: "12", title: " Solar pump ", description: "x" });
  const b = listingInput({ id: "12", title: "Solar pump", description: "x", ...{ status: "raising" } } as never);
  assert.equal(canonicalHash(a), canonicalHash(b));
});

test("bps rounds down and survives a zero goal", () => {
  assert.equal(bps("1", "3"), 3333);
  assert.equal(bps("5", "0"), 0);
});

test("a first-time builder with one stage scores higher than a proven one with four", () => {
  const first = scoreRisk({
    listing: listing(),
    builderRecord: buildBuilderRecord(BUILDER, [], [openListing]),
    vaultTerms: vaultTermsInput(VAULT, info({ milestones: [{ id: 0, amount: 10_000_0000000n }] })),
  });
  const proven = scoreRisk({
    listing: listing(),
    builderRecord: buildBuilderRecord(BUILDER, [attestation(), attestation({ vault: `C${"E".repeat(55)}` })], [openListing]),
    vaultTerms: vaultTermsInput(
      VAULT,
      info({
        bond_amount: 1_500_0000000n,
        milestones: [0, 1, 2, 3].map((id) => ({ id, amount: 2_500_0000000n })),
      }),
    ),
  });
  assert.ok(first.score > proven.score, `${first.score} > ${proven.score}`);
  assert.ok(first.factors.some((f) => f.code === "first-vault"));
  assert.ok(first.factors.some((f) => f.code === "single-stage"));
  assert.ok(proven.factors.some((f) => f.code === "completed-vaults" && f.effect === "lowers"));
});

test("every point is a factor: the score is the base plus the factors' points, clamped", () => {
  const r = scoreRisk({
    listing: listing({ description: "short", location: "", imageUrl: "" }),
    builderRecord: buildBuilderRecord(
      BUILDER,
      [attestation({ outcome: 1, milestones_approved: 1 }), attestation({ vault: `C${"F".repeat(55)}`, outcome: 1 })],
      [openListing],
    ),
    vaultTerms: vaultTermsInput(VAULT, info({ bond_posted: false, milestones: [{ id: 0, amount: 1n }] })),
  });
  const sum = r.scored.reduce((n, f) => n + f.points, BASE_SCORE);
  assert.equal(r.score, Math.max(0, Math.min(100, sum)));
  assert.equal(r.score, 100);
});

test("model findings are capped, prefixed and weighted, never free to move the score", () => {
  const findings = Array.from({ length: 6 }, (_, i) => ({
    code: `concern-${i}`,
    effect: "raises" as const,
    detail: `Concern ${i}.`,
  }));
  const f = modelFactors([...findings, { code: "BAD CODE", effect: "raises", detail: "x" }]);
  assert.equal(f.length, 3);
  assert.ok(f.every((x) => x.code.startsWith("model-") && x.points === MODEL_FACTOR_WEIGHT));
});

test("factors never exceed the schema's limit", () => {
  const r = scoreRisk({
    listing: listing({ description: "short", location: "", imageUrl: "" }),
    builderRecord: buildBuilderRecord(
      BUILDER,
      [attestation(), attestation({ vault: `C${"F".repeat(55)}`, outcome: 1, milestones_approved: 0 }), attestation({ vault: `C${"G".repeat(55)}`, outcome: 2 })],
      [
        openListing,
        { ...openListing, id: "13", vaultAddress: `C${"H".repeat(55)}` },
        { ...openListing, id: "14", vaultAddress: `C${"I".repeat(55)}` },
      ],
    ),
    vaultTerms: vaultTermsInput(
      VAULT,
      info({ bond_posted: false, milestones: [{ id: 0, amount: 9_000_0000000n }, { id: 1, amount: 1n }, { id: 2, amount: 1n }, { id: 3, amount: 1n }] }),
    ),
    modelFindings: [1, 2, 3].map((i) => ({ code: `c${i}`, effect: "raises" as const, detail: "d" })),
  });
  assert.ok(r.factors.length <= MAX_FACTORS);
});

test("a built report validates, and the same inputs at the same time give the same hash", () => {
  const args = {
    network: "testnet" as const,
    listing: listing(),
    builderRecord: buildBuilderRecord(BUILDER, [], [openListing]),
    vaultTerms: vaultTermsInput(VAULT, info()),
    modelFindings: [{ code: "unclear-budget", effect: "raises" as const, detail: "No cost breakdown." }],
    model: "gemma4:12b",
    generatedAt: 1_795_000_000,
  };
  const a = buildRiskReport(args);
  const b = buildRiskReport({ ...args, modelFindings: [...args.modelFindings] });
  RiskReportSchema.parse(JSON.parse(a.json));
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash, riskReportHash(JSON.parse(a.json)));
  assert.equal(a.report.inputs.vaultTerms, canonicalHash(args.vaultTerms));
  assert.ok(a.report.factors.some((f) => f.code === "model-unclear-budget"));
});

test("without a model the report says rules-only and ignores stray findings", () => {
  const r = buildRiskReport({
    network: "testnet",
    listing: listing(),
    builderRecord: buildBuilderRecord(BUILDER, [], [openListing]),
    vaultTerms: vaultTermsInput(VAULT, info()),
    modelFindings: [{ code: "x", effect: "raises", detail: "y" }],
    model: null,
    generatedAt: 1_795_000_000,
  });
  assert.equal(r.report.engine.model, RULES_ONLY);
  assert.ok(!r.report.factors.some((f) => f.code.startsWith("model-")));
});

test("a report refuses inputs about different builders or projects", () => {
  const base = {
    network: "testnet" as const,
    listing: listing(),
    builderRecord: buildBuilderRecord(`G${"Z".repeat(55)}`, [], []),
    vaultTerms: vaultTermsInput(VAULT, info()),
    model: null,
    generatedAt: 1,
  };
  assert.throws(() => buildRiskReport(base), /Builder record is for/);
  assert.throws(
    () => buildRiskReport({ ...base, builderRecord: buildBuilderRecord(BUILDER, [], []), listing: listing({ id: "99" }) }),
    /Listing is project 99/,
  );
});

test("a model reply off the schema is refused", () => {
  assert.deepEqual(parseModelReply('{"findings":[]}'), []);
  assert.throws(() => parseModelReply('{"findings":[{"code":"Bad Code","effect":"raises","detail":"x"}]}'));
  assert.throws(() => parseModelReply('{"findings":[{"code":"ok","effect":"maybe","detail":"x"}]}'));
});
