import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireCaller } from "@/lib/supabase/auth";

/**
 * Listings that need the owners' agreement before the platform carries them.
 *
 * Most projects need none: a project exists when its vault is deployed, and no
 * admin decides whether it may. This is the exception — a listing an owner has
 * flagged, which stays hidden from the public until two thirds of the owners
 * agree to publish it.
 *
 * The threshold is deliberately the same one the treasury uses to release money.
 * A platform where moving funds needs two-to-one but publishing needs a simple
 * majority invites the question of which number is the real one.
 *
 * Every rule here is enforced in Postgres — the tally, the threshold, the state
 * transition, and the rule that a vote may only be cast in your own name. These
 * functions produce readable errors and nothing more; a caller who skipped them
 * entirely would still be refused by RLS and the trigger.
 */

export type ApprovalState = "pending" | "approved" | "rejected";

export interface Consensus {
  approvals: number;
  rejections: number;
  /** Owners who can actually vote — those who have signed in at least once. */
  owners: number;
  needed: number;
  carried: boolean;
}

export interface ProjectModeration {
  projectId: string;
  state: ApprovalState;
  flaggedAt: string;
  decidedAt: string | null;
  reason: string;
  consensus: Consensus | null;
  /** How the caller voted, if they have. */
  myVote: boolean | null;
}

/** Flag a listing as needing owner consensus before it goes public. */
export async function flagForConsensus(projectId: string, reason = "") {
  const caller = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("project_moderation").insert({
    project_id: projectId,
    flagged_by: caller.userId,
    reason: reason.trim().slice(0, 500),
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error("That listing is already under review.");
    }
    throw new Error(`Could not flag the listing: ${error.message}`);
  }
}

/**
 * Cast your vote on a flagged listing.
 *
 * Upserted rather than inserted, so an owner may change their mind while the
 * decision is still open. The database decides when it is no longer open: the
 * trigger writes `approved` or `rejected` the moment either side reaches two
 * thirds, and a settled row is not reopened by a later vote.
 */
export async function voteOnProject(projectId: string, approve: boolean) {
  const caller = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_approval_votes")
    .upsert(
      { project_id: projectId, voter_id: caller.userId, approve },
      { onConflict: "project_id,voter_id" },
    );

  if (error) throw new Error(`Could not record your vote: ${error.message}`);
}

/** Stop requiring consensus. The listing becomes public on the next read. */
export async function clearModeration(projectId: string) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_moderation")
    .delete()
    .eq("project_id", projectId);

  if (error) throw new Error(`Could not clear the review: ${error.message}`);
}

/**
 * The review state of one listing.
 *
 * Readable by anyone, because a visitor who cannot see a listing is better told
 * that it is under review than shown nothing at all. The tally is admin-only —
 * `project_consensus` is not granted to anon — so a non-admin learns that a
 * decision is pending without learning how the owners are voting.
 */
export async function getModeration(
  projectId: string,
): Promise<ProjectModeration | null> {
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("project_moderation")
    .select("project_id, state, flagged_at, decided_at, reason")
    .eq("project_id", projectId)
    .maybeSingle();

  if (!row) return null;

  let consensus: Consensus | null = null;
  let myVote: boolean | null = null;

  try {
    const caller = await requireCaller();

    const { data: tally } = await supabase.rpc("project_consensus", {
      pid: projectId,
    });
    const first = Array.isArray(tally) ? tally[0] : null;
    if (first) {
      consensus = {
        approvals: first.approvals,
        rejections: first.rejections,
        owners: first.owners,
        needed: first.needed,
        carried: first.carried,
      };
    }

    const { data: vote } = await supabase
      .from("project_approval_votes")
      .select("approve")
      .eq("project_id", projectId)
      .eq("voter_id", caller.userId)
      .maybeSingle();
    myVote = vote?.approve ?? null;
  } catch {
    // Not signed in, or not an admin. The state above is public; the tally is
    // not, and its absence is the correct answer rather than an error.
  }

  return {
    projectId: row.project_id,
    state: row.state,
    flaggedAt: row.flagged_at,
    decidedAt: row.decided_at,
    reason: row.reason,
    consensus,
    myVote,
  };
}

/** Every listing currently awaiting a decision, for the admin console. */
export async function listPendingReviews(): Promise<ProjectModeration[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_moderation")
    .select("project_id")
    .eq("state", "pending")
    .order("flagged_at", { ascending: true });

  if (error) throw new Error(`Could not load reviews: ${error.message}`);

  const reviews = await Promise.all(
    (data ?? []).map((r) => getModeration(r.project_id)),
  );
  return reviews.filter((r): r is ProjectModeration => r !== null);
}
