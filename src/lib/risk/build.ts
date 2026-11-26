/**
 * Put one risk report together from its three inputs.
 *
 * Pure: the reads (listing, builder record, vault terms) and the model call
 * happen before this, in src/lib/risk/pipeline.ts. Given the same inputs,
 * findings and time, this returns the same report and the same hash.
 *
 * Self-contained so node --test can load it.
 */

import { canonicalHash } from "../canonical-json.ts";
import type { BuilderRecord } from "../builder-record.ts";
import type { ListingInputV1, VaultTermsV1 } from "./inputs.ts";
import {
  RISK_REPORT_SCHEMA,
  bandForScore,
  normaliseRiskReport,
  riskReportHash,
  serialiseRiskReport,
  type RiskReport,
} from "./report.ts";
import { RULES_VERSION, scoreRisk, type ModelFinding } from "./rules.ts";

/** Written as engine.model when no model was asked. */
export const RULES_ONLY = "rules-only";

export interface BuiltRiskReport {
  report: RiskReport;
  /** The canonical bytes: what is stored, served, and hashed. */
  json: string;
  /** SHA-256 of `json`, 64 hex characters: what is anchored. */
  hash: string;
  inputHashes: RiskReport["inputs"];
}

export function buildRiskReport(input: {
  network: "testnet" | "mainnet";
  listing: ListingInputV1;
  builderRecord: BuilderRecord;
  vaultTerms: VaultTermsV1;
  modelFindings?: readonly ModelFinding[];
  /** The model that wrote the findings, or null for rules only. */
  model: string | null;
  /** Epoch seconds. */
  generatedAt: number;
}): BuiltRiskReport {
  const { listing, builderRecord, vaultTerms } = input;
  if (builderRecord.builder !== vaultTerms.creator) {
    throw new Error(
      `Builder record is for ${builderRecord.builder}, but vault ${vaultTerms.vault} was created by ${vaultTerms.creator}`,
    );
  }
  if (listing.projectId !== vaultTerms.projectId) {
    throw new Error(
      `Listing is project ${listing.projectId}, but vault ${vaultTerms.vault} is project ${vaultTerms.projectId}`,
    );
  }

  const inputHashes = {
    listing: canonicalHash(listing),
    builderRecord: canonicalHash(builderRecord),
    vaultTerms: canonicalHash(vaultTerms),
  };
  const { score, factors } = scoreRisk({
    listing,
    builderRecord,
    vaultTerms,
    modelFindings: input.model ? input.modelFindings : [],
  });

  const report = normaliseRiskReport({
    schema: RISK_REPORT_SCHEMA,
    subject: {
      network: input.network,
      vault: vaultTerms.vault,
      projectId: vaultTerms.projectId,
      builder: vaultTerms.creator,
    },
    inputs: inputHashes,
    score,
    band: bandForScore(score),
    factors,
    engine: { model: input.model ?? RULES_ONLY, rules: RULES_VERSION },
    generatedAt: input.generatedAt,
  });

  return {
    report,
    json: serialiseRiskReport(report),
    hash: riskReportHash(report),
    inputHashes,
  };
}
