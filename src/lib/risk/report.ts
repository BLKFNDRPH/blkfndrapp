/**
 * The risk report: what the risk pipeline writes for one vault, and the one
 * form of it whose hash is anchored on the ledger.
 *
 * The model's reply is not repeatable; the report is. Once a report exists,
 * `riskReportHash` gives the same 32 bytes on any machine, so anyone holding
 * the report can check it against the anchor. That is why the report carries
 * no floats, sorts its factors, and names its three inputs by hash rather than
 * embedding them: a backer can see which listing text, which builder record
 * and which vault terms a report was written from, and a re-run on a changed
 * listing is a new report with a different listing hash.
 *
 * Design and the open decisions: docs/design/risk-report-anchor.md.
 *
 * Self-contained (zod and canonical-json only) so node --test can load it.
 */

import { z } from "zod";
import { canonicalHash, canonicalJson } from "../canonical-json.ts";

export const RISK_REPORT_SCHEMA = "blkfndr.risk-report/1";
/** The schema's number, as the report-anchor registry stores it. */
export const RISK_REPORT_SCHEMA_VERSION = 1;

export const RISK_BANDS = ["low", "medium", "high"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/** The three things a report is written from. */
export const RISK_INPUTS = ["listing", "builder-record", "vault-terms"] as const;
export type RiskInput = (typeof RISK_INPUTS)[number];

/**
 * Where a score becomes a band. Higher is riskier. The band is derived, never
 * taken from the model, so a report cannot say "low" beside a score of 90.
 * Placeholder thresholds until the pipeline has run on the existing listings.
 */
export const MEDIUM_FROM = 34;
export const HIGH_FROM = 67;

export function bandForScore(score: number): RiskBand {
  if (score >= HIGH_FROM) return "high";
  if (score >= MEDIUM_FROM) return "medium";
  return "low";
}

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 lowercase hex characters");

export const RiskFactorSchema = z.strictObject({
  /** A stable name for the finding, e.g. "first-vault" or "goal-above-category-norm". */
  code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  /** Which input the finding comes from. */
  input: z.enum(RISK_INPUTS),
  effect: z.enum(["raises", "lowers"]),
  /** One sentence a backer reads. */
  detail: z.string().min(1).max(280),
});
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

export const RiskReportSchema = z
  .strictObject({
    schema: z.literal(RISK_REPORT_SCHEMA),
    subject: z.strictObject({
      network: z.enum(["testnet", "mainnet"]),
      vault: z.string().regex(/^C[A-Z2-7]{55}$/),
      /** The factory's project id, a u64 as a decimal string. */
      projectId: z.string().regex(/^(0|[1-9][0-9]*)$/),
      builder: z.string().regex(/^G[A-Z2-7]{55}$/),
    }),
    /** canonicalHash of each input as the pipeline read it. */
    inputs: z.strictObject({
      listing: hex64,
      builderRecord: hex64,
      vaultTerms: hex64,
    }),
    /** 0 to 100, higher is riskier. */
    score: z.number().int().min(0).max(100),
    band: z.enum(RISK_BANDS),
    factors: z.array(RiskFactorSchema).max(12),
    engine: z.strictObject({
      /** The model that wrote the factors, e.g. "gemma4:12b". */
      model: z.string().min(1).max(100),
      /** The prompt and scoring rules' version, bumped when either changes. */
      rules: z.number().int().min(1),
    }),
    /** Epoch seconds. */
    generatedAt: z.number().int().positive(),
  })
  .refine((report) => report.band === bandForScore(report.score), {
    message: "band does not match score",
    path: ["band"],
  });
export type RiskReport = z.infer<typeof RiskReportSchema>;

/**
 * Check a report and put it in its hashed form: factors in a fixed order, so
 * the order the model happened to list them in does not change the hash.
 */
export function normaliseRiskReport(report: unknown): RiskReport {
  const parsed = RiskReportSchema.parse(report);
  const factors = [...parsed.factors].sort(
    (a, b) =>
      RISK_INPUTS.indexOf(a.input) - RISK_INPUTS.indexOf(b.input) ||
      compare(a.code, b.code) ||
      compare(a.detail, b.detail),
  );
  return { ...parsed, factors };
}

/** The bytes that are hashed, and the form the report is stored and served in. */
export function serialiseRiskReport(report: unknown): string {
  return canonicalJson(normaliseRiskReport(report));
}

/** The report's SHA-256, 64 hex characters: the value anchored on the ledger. */
export function riskReportHash(report: unknown): string {
  return canonicalHash(normaliseRiskReport(report));
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
