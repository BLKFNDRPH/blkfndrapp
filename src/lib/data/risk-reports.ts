import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectByVault } from "@/lib/data/projects";

/**
 * Public reads of stored risk reports.
 *
 * The table is server-only, so reads go through the service client; what the
 * caller may see is decided here instead, by the listing: a report is served
 * only when the caller can see the listing for its vault (RLS on projects,
 * through getProjectByVault with the caller's session). A hidden listing's
 * report answers as if it did not exist.
 */

export interface StoredRiskReport {
  hash: string;
  vault: string;
  projectId: string;
  score: number;
  band: string;
  generatedAt: string;
  /** The canonical bytes, exactly as hashed. */
  json: string;
  anchor: { contract: string; seq: number; tx: string; anchoredAt: string } | null;
}

const COLUMNS =
  "report_hash, vault_address, project_id, score, band, generated_at, report_json, anchor_contract, anchor_seq, anchor_tx, anchored_at";

type Row = {
  report_hash: string;
  vault_address: string;
  project_id: string;
  score: number;
  band: string;
  generated_at: string;
  report_json: string;
  anchor_contract: string | null;
  anchor_seq: number | null;
  anchor_tx: string | null;
  anchored_at: string | null;
};

function toStored(row: Row): StoredRiskReport {
  return {
    hash: row.report_hash,
    vault: row.vault_address,
    projectId: row.project_id,
    score: row.score,
    band: row.band,
    generatedAt: row.generated_at,
    json: row.report_json,
    anchor:
      row.anchor_tx && row.anchor_contract && row.anchor_seq !== null && row.anchored_at
        ? { contract: row.anchor_contract, seq: row.anchor_seq, tx: row.anchor_tx, anchoredAt: row.anchored_at }
        : null,
  };
}

async function visible(vault: string): Promise<boolean> {
  return (await getProjectByVault(vault)) !== undefined;
}

export async function getRiskReportByHash(hash: string): Promise<StoredRiskReport | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const { data, error } = await createAdminClient()
    .from("risk_reports")
    .select(COLUMNS)
    .eq("report_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`Could not read risk report: ${error.message}`);
  if (!data || !(await visible(data.vault_address))) return null;
  return toStored(data);
}

/** A vault's reports, newest first; null when the caller cannot see the listing. */
export async function getRiskReportsForVault(vault: string, limit = 20): Promise<StoredRiskReport[] | null> {
  if (!/^C[A-Z2-7]{55}$/.test(vault) || !(await visible(vault))) return null;
  const { data, error } = await createAdminClient()
    .from("risk_reports")
    .select(COLUMNS)
    .eq("vault_address", vault)
    .order("generated_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(`Could not read risk reports: ${error.message}`);
  return (data ?? []).map(toStored);
}
