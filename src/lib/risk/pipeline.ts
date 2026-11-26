import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getProjects } from "@/lib/data/projects";
import { getBuilderRecord } from "@/lib/data/builder-record";
import { simulate, vaultClient } from "@/lib/stellar-clients";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import type { BuilderRecord } from "@/lib/builder-record";
import { listingInput, vaultTermsInput, type VaultInfoSource } from "@/lib/risk/inputs";
import { buildRiskReport, RULES_ONLY } from "@/lib/risk/build";
import { askModel } from "@/lib/risk/model";
import { RISK_REPORT_SCHEMA_VERSION } from "@/lib/risk/report";
import { RULES_VERSION } from "@/lib/risk/rules";
import { anchorReport, anchorUnavailable } from "@/lib/risk/anchor";

/**
 * The risk pipeline (Sprint 2, item 1.2): for each listed vault, read its three
 * inputs, score them, store the report, and anchor its hash.
 *
 * A vault whose three inputs, rules version and model are unchanged since its
 * latest report is skipped, so a scheduled run writes nothing new until a
 * listing, a builder's record or a vault's terms change. `force` writes a new
 * report anyway.
 *
 * Anchoring is a second step over every stored report that has no anchor yet,
 * so a report stored while the registry was unreachable is anchored next run.
 */

export interface RiskRunOptions {
  dryRun?: boolean;
  /** Only this vault. */
  vault?: string;
  force?: boolean;
  /** Skip the anchor step. */
  noAnchor?: boolean;
}

export interface RiskRunVault {
  vault: string;
  projectId: string;
  outcome: "written" | "unchanged" | "error" | "would-write";
  hash?: string;
  score?: number;
  band?: string;
  model?: string;
  detail?: string;
}

export interface RiskRunResult {
  checked: number;
  written: number;
  anchored: number;
  anchorSkipped: string | null;
  vaults: RiskRunVault[];
  anchorErrors: { hash: string; error: string }[];
}

export async function runRiskPipeline(opts: RiskRunOptions = {}): Promise<RiskRunResult> {
  const admin = createAdminClient();
  const network = IS_PRACTICE_NETWORK ? "testnet" : "mainnet";

  const listings = (await getProjects(admin)).filter(
    (p) => p.vaultAddress && (!opts.vault || p.vaultAddress === opts.vault),
  );

  const records = new Map<string, BuilderRecord | null>();
  const vaults: RiskRunVault[] = [];

  for (const listing of listings) {
    const vault = listing.vaultAddress!;
    const row: RiskRunVault = { vault, projectId: listing.id, outcome: "error" };
    vaults.push(row);
    try {
      const info = (await simulate(
        () => vaultClient(vault).get_info(),
        "get_info",
      )) as VaultInfoSource | null;
      if (!info) throw new Error("The vault did not answer get_info");
      const terms = vaultTermsInput(vault, info);

      if (!records.has(terms.creator)) {
        records.set(terms.creator, await getBuilderRecord(terms.creator, admin));
      }
      const record = records.get(terms.creator);
      // Null is "could not read", never "no history": score nothing rather
      // than score a builder as new.
      if (!record) throw new Error(`Could not read the builder record for ${terms.creator}`);

      const listingIn = listingInput(listing);

      let model: string | null = null;
      let findings: Awaited<ReturnType<typeof askModel>> = null;
      try {
        findings = await askModel(listingIn);
        model = findings?.model ?? null;
      } catch (error) {
        // The report says rules-only, which is true of it. The run says why.
        row.detail = `Model unavailable, rules only: ${String(error).slice(0, 200)}`;
      }

      const built = buildRiskReport({
        network,
        listing: listingIn,
        builderRecord: record,
        vaultTerms: terms,
        modelFindings: findings?.findings ?? [],
        model,
        generatedAt: Math.floor(Date.now() / 1000),
      });
      Object.assign(row, {
        hash: built.hash,
        score: built.report.score,
        band: built.report.band,
        model: built.report.engine.model,
      });

      if (!opts.force) {
        const { data: latest, error } = await admin
          .from("risk_reports")
          .select("listing_hash, builder_record_hash, vault_terms_hash, rules_version, report_json")
          .eq("vault_address", vault)
          .order("generated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`Could not read the latest report: ${error.message}`);
        if (
          latest &&
          latest.listing_hash === built.inputHashes.listing &&
          latest.builder_record_hash === built.inputHashes.builderRecord &&
          latest.vault_terms_hash === built.inputHashes.vaultTerms &&
          latest.rules_version === RULES_VERSION &&
          (JSON.parse(latest.report_json).engine?.model ?? RULES_ONLY) === built.report.engine.model
        ) {
          row.outcome = "unchanged";
          continue;
        }
      }

      if (opts.dryRun) {
        row.outcome = "would-write";
        continue;
      }

      const { error } = await admin.from("risk_reports").insert({
        vault_address: vault,
        project_id: built.report.subject.projectId,
        report_hash: built.hash,
        report_json: built.json,
        schema_version: RISK_REPORT_SCHEMA_VERSION,
        rules_version: RULES_VERSION,
        score: built.report.score,
        band: built.report.band,
        listing_hash: built.inputHashes.listing,
        builder_record_hash: built.inputHashes.builderRecord,
        vault_terms_hash: built.inputHashes.vaultTerms,
        generated_at: new Date(built.report.generatedAt * 1000).toISOString(),
      });
      if (error) throw new Error(`Could not store the report: ${error.message}`);
      row.outcome = "written";
    } catch (error) {
      row.outcome = "error";
      row.detail = String(error).slice(0, 300);
    }
  }

  const result: RiskRunResult = {
    checked: vaults.length,
    written: vaults.filter((v) => v.outcome === "written").length,
    anchored: 0,
    anchorSkipped: opts.noAnchor ? "noAnchor" : opts.dryRun ? "dryRun" : anchorUnavailable(),
    vaults,
    anchorErrors: [],
  };
  if (result.anchorSkipped) return result;

  let pending = admin
    .from("risk_reports")
    .select("id, vault_address, report_hash")
    .is("anchor_tx", null)
    .order("id", { ascending: true })
    .limit(100);
  if (opts.vault) pending = pending.eq("vault_address", opts.vault);
  const { data: unanchored, error } = await pending;
  if (error) throw new Error(`Could not list unanchored reports: ${error.message}`);

  for (const r of unanchored ?? []) {
    try {
      const anchor = await anchorReport(r.vault_address, r.report_hash);
      const { error: updateError } = await admin
        .from("risk_reports")
        .update({
          anchor_contract: anchor.contract,
          anchor_seq: anchor.seq,
          anchor_tx: anchor.tx,
          anchored_at: new Date(anchor.anchoredAt * 1000).toISOString(),
        })
        .eq("id", r.id);
      if (updateError) throw new Error(`Anchored in ${anchor.tx} but not recorded: ${updateError.message}`);
      result.anchored++;
    } catch (e) {
      result.anchorErrors.push({ hash: r.report_hash, error: String(e).slice(0, 300) });
    }
  }
  return result;
}
