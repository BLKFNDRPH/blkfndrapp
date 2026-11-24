import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandForScore,
  normaliseRiskReport,
  riskReportHash,
  serialiseRiskReport,
  type RiskReport,
} from "./report.ts";

/** Run with `npm test`. */

const VAULT = `C${"A".repeat(55)}`;
const BUILDER = `G${"B".repeat(55)}`;
const HASH = (c: string) => c.repeat(64);

const report = (over: Partial<RiskReport> = {}): RiskReport => ({
  schema: "blkfndr.risk-report/1",
  subject: { network: "testnet", vault: VAULT, projectId: "12", builder: BUILDER },
  inputs: { listing: HASH("a"), builderRecord: HASH("b"), vaultTerms: HASH("c") },
  score: 40,
  band: "medium",
  factors: [
    { code: "single-stage", input: "vault-terms", effect: "raises", detail: "The whole goal is paid in one stage." },
    { code: "first-vault", input: "builder-record", effect: "raises", detail: "This builder has not closed a vault before." },
    { code: "clear-budget", input: "listing", effect: "lowers", detail: "The listing breaks the goal down by cost." },
  ],
  engine: { model: "gemma4:12b", rules: 1 },
  generatedAt: 1_795_000_000,
  ...over,
});

test("bands follow the score", () => {
  assert.equal(bandForScore(0), "low");
  assert.equal(bandForScore(33), "low");
  assert.equal(bandForScore(34), "medium");
  assert.equal(bandForScore(66), "medium");
  assert.equal(bandForScore(67), "high");
  assert.equal(bandForScore(100), "high");
});

test("factors are put in input order, then by code", () => {
  assert.deepEqual(
    normaliseRiskReport(report()).factors.map((f) => f.code),
    ["clear-budget", "first-vault", "single-stage"],
  );
});

test("the hash does not depend on factor order or key order", () => {
  const a = report();
  const b = report({ factors: [...a.factors].reverse() });
  const c = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(riskReportHash(a), riskReportHash(b));
  assert.equal(riskReportHash(a), riskReportHash(c));
  assert.match(riskReportHash(a), /^[0-9a-f]{64}$/);
});

test("the serialised report hashes to itself after a round trip", () => {
  const text = serialiseRiskReport(report());
  assert.equal(serialiseRiskReport(JSON.parse(text)), text);
  assert.equal(riskReportHash(JSON.parse(text)), riskReportHash(report()));
});

test("a changed listing is a different report", () => {
  const changed = report({ inputs: { listing: HASH("d"), builderRecord: HASH("b"), vaultTerms: HASH("c") } });
  assert.notEqual(riskReportHash(changed), riskReportHash(report()));
});

test("a band that disagrees with the score is refused", () => {
  assert.throws(() => normaliseRiskReport(report({ score: 90, band: "low" })), /band does not match score/);
});

test("anything outside the schema is refused, not hashed", () => {
  assert.throws(() => normaliseRiskReport({ ...report(), note: "extra" }));
  assert.throws(() => normaliseRiskReport(report({ score: 40.5 })));
  assert.throws(() => normaliseRiskReport(report({ inputs: { listing: "ABC", builderRecord: HASH("b"), vaultTerms: HASH("c") } })));
  assert.throws(() =>
    normaliseRiskReport(report({ factors: [{ code: "Not A Code", input: "listing", effect: "raises", detail: "x" }] })),
  );
});
