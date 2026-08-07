import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller } from "@/lib/supabase/auth";
import type { Project } from "@/lib/types";
import type { Enums, TablesInsert } from "@/lib/supabase/database.types";

/**
 * Project data access. Replaces the Mongo `projectcaches` collection.
 *
 * Everything here mirrors on-chain vault state, so writes go through the
 * service-role client and only from code that read the ledger first. Nothing
 * reachable with a browser key can write a funding total — the grants make that
 * structural rather than a convention.
 */

const PROJECT_COLUMNS = `
  id, project_id, vault_address, title, tagline, description, category,
  image_url, metadata_cid, creator_address, creator_display, creator_avatar_url,
  funding_goal_raw, current_funding_raw, bond_amount_raw, released_total_raw,
  funding_goal, current_funding, bond_amount, released_total,
  status, currency, bond_posted, featured, is_public,
  funding_deadline, created_on_chain_at, last_updated_ledger,
  project_milestones ( milestone_id, amount, amount_raw, released, title, description, proof )
`;

type Row = Record<string, any>;

function toProject(row: Row): Project {
  const milestones = (row.project_milestones ?? [])
    .map((m: Row) => ({
      id: Number(m.milestone_id),
      amount: Number(m.amount),
      released: Boolean(m.released),
      title: m.title ?? "",
      description: m.description ?? "",
      proof: m.proof ?? "",
    }))
    .sort((a: { id: number }, b: { id: number }) => a.id - b.id);

  return {
    id: row.project_id,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    fundingGoal: Number(row.funding_goal),
    currentFunding: Number(row.current_funding),
    fundingGoalRaw: String(row.funding_goal_raw),
    currentFundingRaw: String(row.current_funding_raw),
    imageUrl: row.image_url,
    creator: row.creator_address,
    creatorName: row.creator_display || row.creator_address,
    creatorAddress: row.creator_address,
    creatorAvatar:
      row.creator_avatar_url || `https://i.pravatar.cc/150?u=${row.creator_address}`,
    status: row.status,
    featured: row.featured,
    createdAt: row.created_on_chain_at,
    // The UI works in epoch milliseconds; the column is a timestamp.
    fundingDeadline: new Date(row.funding_deadline).getTime(),
    isPublic: row.is_public,
    currencyType: row.currency,
    vaultAddress: row.vault_address,
    bondAmount: Number(row.bond_amount),
    bondPosted: row.bond_posted,
    releasedTotal: Number(row.released_total),
    milestones,
    metadataCid: row.metadata_cid,
  } as unknown as Project;
}

/** Public listings. Readable signed out — RLS filters to is_public. */
export async function getProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .order("created_on_chain_at", { ascending: false });

  if (error) {
    console.error("Could not load projects:", error.message);
    return [];
  }
  return (data ?? []).map(toProject);
}

export async function getProjectById(projectId: string): Promise<Project | undefined> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !data) return undefined;
  return toProject(data);
}

export async function getProjectByVault(vaultAddress: string): Promise<Project | undefined> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("vault_address", vaultAddress)
    .maybeSingle();

  if (error || !data) return undefined;
  return toProject(data);
}

export async function resolveProjectIdByVault(vaultAddress: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("project_id")
    .eq("vault_address", vaultAddress)
    .maybeSingle();
  return data?.project_id ?? null;
}

/**
 * Upsert a project from indexed on-chain state. Service-role only — every
 * field here is ledger-derived and must never originate in a browser.
 */
export async function upsertProjectFromChain(row: {
  projectId: string;
  vaultAddress: string;
  creatorAddress: string;
  title?: string;
  tagline?: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  metadataCid?: string;
  fundingGoalRaw: string;
  currentFundingRaw?: string;
  bondAmountRaw?: string;
  releasedTotalRaw?: string;
  status?: Enums<"project_status">;
  currency?: Enums<"currency_type">;
  bondPosted?: boolean;
  fundingDeadline: Date;
  createdOnChainAt: Date;
  lastUpdatedLedger?: number;
}) {
  const admin = createAdminClient();

  // Built as a typed value first: the conditional spreads below defeat the
  // excess-property check when written inline.
  const patch: TablesInsert<"projects"> = {
    project_id: row.projectId,
    vault_address: row.vaultAddress,
    creator_address: row.creatorAddress,
    funding_goal_raw: row.fundingGoalRaw,
    funding_deadline: row.fundingDeadline.toISOString(),
    created_on_chain_at: row.createdOnChainAt.toISOString(),
    // Required by the schema. A DEPLOY event carries no title, so a project is
    // listed under its id until the IPFS metadata resolves.
    title: row.title ?? `Project #${row.projectId}`,
  };
  if (row.title !== undefined) patch.title = row.title;
  if (row.tagline !== undefined) patch.tagline = row.tagline;
  if (row.description !== undefined) patch.description = row.description;
  if (row.category !== undefined) patch.category = row.category;
  if (row.imageUrl !== undefined) patch.image_url = row.imageUrl;
  if (row.metadataCid !== undefined) patch.metadata_cid = row.metadataCid;
  if (row.currentFundingRaw !== undefined) patch.current_funding_raw = row.currentFundingRaw;
  if (row.bondAmountRaw !== undefined) patch.bond_amount_raw = row.bondAmountRaw;
  if (row.releasedTotalRaw !== undefined) patch.released_total_raw = row.releasedTotalRaw;
  if (row.status !== undefined) patch.status = row.status;
  if (row.currency !== undefined) patch.currency = row.currency;
  if (row.bondPosted !== undefined) patch.bond_posted = row.bondPosted;
  if (row.lastUpdatedLedger !== undefined) patch.last_updated_ledger = row.lastUpdatedLedger;

  const { data, error } = await admin
    .from("projects")
    .upsert(
      patch,
      { onConflict: "vault_address" },
    )
    .select("id")
    .single();

  if (error) throw new Error(`Could not upsert project: ${error.message}`);
  return data.id as string;
}

export async function upsertMilestones(
  projectRowId: string,
  milestones: Array<{
    milestoneId: number;
    amountRaw: string;
    released: boolean;
    title?: string;
    description?: string;
  }>,
) {
  if (milestones.length === 0) return;

  const admin = createAdminClient();
  const { error } = await admin.from("project_milestones").upsert(
    milestones.map((m) => ({
      project_id: projectRowId,
      milestone_id: m.milestoneId,
      amount_raw: m.amountRaw,
      released: m.released,
      ...(m.title !== undefined ? { title: m.title } : {}),
      ...(m.description !== undefined ? { description: m.description } : {}),
    })),
    // Titles and descriptions are off-chain copy; a chain-driven refresh must
    // not blank them, so only the supplied fields are written.
    { onConflict: "project_id,milestone_id" },
  );

  if (error) throw new Error(`Could not upsert milestones: ${error.message}`);
}

/** Delivery evidence for a milestone. Off-chain by nature; the builder writes it. */
export async function setMilestoneProof(
  vaultAddress: string,
  milestoneId: number,
  proof: string,
) {
  await requireCaller();

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("vault_address", vaultAddress)
    .maybeSingle();

  if (!project) return false;

  const { error } = await admin
    .from("project_milestones")
    .update({ proof: proof.slice(0, 4000) })
    .eq("project_id", project.id)
    .eq("milestone_id", milestoneId);

  if (error) throw new Error(`Could not save milestone proof: ${error.message}`);
  return true;
}
