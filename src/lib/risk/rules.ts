/**
 * The risk score: fixed rules over the three inputs, plus at most a few
 * findings from a model reading the listing text.
 *
 * The rules carry the score. A model can name a concern in the listing, but
 * each finding it adds moves the score by a fixed, small amount, so a model
 * that misreads a listing cannot swing a vault from "low" to "high" on its own.
 * Every point in the score is traceable to one factor in the report.
 *
 * Bump RULES_VERSION when a rule, a weight or the model prompt changes: it is
 * written into every report as `engine.rules`, so a reader can tell which
 * reports were scored the same way.
 *
 * Self-contained so node --test can load it.
 */

import type { BuilderRecord } from "../builder-record.ts";
import type { ListingInputV1, VaultTermsV1 } from "./inputs.ts";
import type { RiskFactor } from "./report.ts";

export const RULES_VERSION = 1;

/** Where every vault starts before any factor moves it. */
export const BASE_SCORE = 30;

/** How far one model finding moves the score, and how many are counted. */
export const MODEL_FACTOR_WEIGHT = 5;
export const MODEL_FACTOR_MAX = 3;

/** The report schema's limit on factors. */
export const MAX_FACTORS = 12;

/** A listing finding from the model, before it becomes a report factor. */
export interface ModelFinding {
  code: string;
  effect: "raises" | "lowers";
  detail: string;
}

export interface ScoredFactor extends RiskFactor {
  /** Signed points this factor added. Not in the report: the report has the total. */
  points: number;
}

export interface RiskScore {
  score: number;
  factors: RiskFactor[];
  /** The same factors with their points, for logs and tests. */
  scored: ScoredFactor[];
}

export function scoreRisk(input: {
  listing: ListingInputV1;
  builderRecord: BuilderRecord;
  vaultTerms: VaultTermsV1;
  modelFindings?: readonly ModelFinding[];
}): RiskScore {
  const rules: ScoredFactor[] = [
    ...builderRecordFactors(input.builderRecord),
    ...vaultTermsFactors(input.vaultTerms),
    ...listingFactors(input.listing),
  ];
  // A report holds at most MAX_FACTORS; the rules' own factors always fit
  // (at most 12), and model findings take whatever room is left.
  const room = Math.max(0, MAX_FACTORS - rules.length);
  const scored = [...rules, ...modelFactors(input.modelFindings ?? []).slice(0, room)];
  const total = scored.reduce((n, f) => n + f.points, BASE_SCORE);
  const score = Math.max(0, Math.min(100, total));
  return {
    score,
    factors: scored.map(({ code, input, effect, detail }) => ({ code, input, effect, detail })),
    scored,
  };
}

function factor(
  input: RiskFactor["input"],
  code: string,
  points: number,
  detail: string,
): ScoredFactor {
  return { code, input, effect: points >= 0 ? "raises" : "lowers", detail, points };
}

export function builderRecordFactors(record: BuilderRecord): ScoredFactor[] {
  const out: ScoredFactor[] = [];
  const s = record.summary;
  if (s.closed === 0) {
    out.push(factor("builder-record", "first-vault", 15, "This builder has not closed a vault on BLKFNDR before."));
  }
  if (s.completed > 0) {
    const points = -Math.min(20, 10 * s.completed);
    out.push(
      factor(
        "builder-record",
        "completed-vaults",
        points,
        `This builder has completed ${s.completed} vault${s.completed === 1 ? "" : "s"}, every stage released.`,
      ),
    );
  }
  if (s.failedWithForfeiture > 0) {
    out.push(
      factor(
        "builder-record",
        "forfeited-deposit",
        Math.min(40, 25 * s.failedWithForfeiture),
        `This builder lost the deposit on ${s.failedWithForfeiture} earlier vault${s.failedWithForfeiture === 1 ? "" : "s"} after a stage failed.`,
      ),
    );
  }
  if (s.failedToFund > 0) {
    out.push(
      factor(
        "builder-record",
        "missed-goal",
        Math.min(10, 5 * s.failedToFund),
        `${s.failedToFund} earlier vault${s.failedToFund === 1 ? "" : "s"} by this builder did not reach its goal.`,
      ),
    );
  }
  // The vault being scored is one of the open ones.
  if (s.open >= 3) {
    out.push(
      factor("builder-record", "many-open-vaults", 10, `This builder has ${s.open} vaults open at once.`),
    );
  }
  if (s.milestonesTotal > 0 && s.milestonesApproved < s.milestonesTotal) {
    const missed = s.milestonesTotal - s.milestonesApproved;
    out.push(
      factor(
        "builder-record",
        "missed-stages",
        Math.min(15, 5 * missed),
        `Backers did not approve ${missed} of ${s.milestonesTotal} stages in this builder's closed vaults.`,
      ),
    );
  }
  return out;
}

/** Basis points of `part` in `whole`, rounded down; 0 when whole is 0. */
export function bps(part: string, whole: string): number {
  const w = BigInt(whole);
  if (w <= 0n) return 0;
  return Number((BigInt(part) * 10_000n) / w);
}

export function vaultTermsFactors(terms: VaultTermsV1): ScoredFactor[] {
  const out: ScoredFactor[] = [];
  const bondBps = bps(terms.bondRaw, terms.goalRaw);
  if (bondBps >= 1_000) {
    out.push(
      factor(
        "vault-terms",
        "large-deposit",
        -10,
        `The builder's deposit is ${formatPercent(bondBps)} of the goal, and is lost if a stage fails.`,
      ),
    );
  } else if (bondBps < 500) {
    out.push(
      factor(
        "vault-terms",
        "small-deposit",
        10,
        `The builder's deposit is ${formatPercent(bondBps)} of the goal, below the usual 5%.`,
      ),
    );
  }
  if (!terms.bondPosted) {
    out.push(factor("vault-terms", "deposit-not-posted", 10, "The builder has not posted the deposit yet."));
  }
  const stages = terms.milestones.length;
  if (stages <= 1) {
    out.push(
      factor("vault-terms", "single-stage", 15, "All of the money is released in one stage, after one vote."),
    );
  } else if (stages >= 4) {
    out.push(
      factor(
        "vault-terms",
        "many-stages",
        -5,
        `The money is released in ${stages} stages, each after its own vote.`,
      ),
    );
  }
  const first = terms.milestones[0];
  if (stages > 1 && first && bps(first.amountRaw, terms.goalRaw) > 5_000) {
    out.push(
      factor(
        "vault-terms",
        "front-loaded",
        10,
        `The first stage releases ${formatPercent(bps(first.amountRaw, terms.goalRaw))} of the goal.`,
      ),
    );
  }
  return out;
}

export function listingFactors(listing: ListingInputV1): ScoredFactor[] {
  const out: ScoredFactor[] = [];
  if (listing.description.length < 300) {
    out.push(
      factor("listing", "thin-description", 10, "The listing says little about what the money is for."),
    );
  }
  if (!listing.location) {
    out.push(factor("listing", "no-location", 5, "The listing does not say where the work happens."));
  }
  if (!listing.hasImage) {
    out.push(factor("listing", "no-image", 5, "The listing has no picture of the project."));
  }
  return out;
}

const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Keep the first MODEL_FACTOR_MAX well-formed findings, each worth a fixed
 * MODEL_FACTOR_WEIGHT. Codes are prefixed "model-" so they cannot collide with,
 * or pass for, a rule's factor.
 */
export function modelFactors(findings: readonly ModelFinding[]): ScoredFactor[] {
  const out: ScoredFactor[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (out.length >= MODEL_FACTOR_MAX) break;
    const code = `model-${f.code}`.slice(0, 64).replace(/-+$/, "");
    const detail = f.detail.trim().slice(0, 280);
    if (!CODE.test(code) || !detail || seen.has(code)) continue;
    if (f.effect !== "raises" && f.effect !== "lowers") continue;
    seen.add(code);
    out.push(
      factor("listing", code, f.effect === "raises" ? MODEL_FACTOR_WEIGHT : -MODEL_FACTOR_WEIGHT, detail),
    );
  }
  return out;
}

function formatPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const frac = basisPoints % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}
