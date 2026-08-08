import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireCaller } from "@/lib/supabase/auth";

/**
 * The community roadmap.
 *
 * Two signals that are deliberately never combined:
 *
 *   upvotes      — how many people want this
 *   owner votes  — whether the platform will build it
 *
 * A request with a hundred upvotes and no owner vote is still undecided, and one
 * with none can still be accepted. Auto-accepting on popularity would hand the
 * roadmap to whoever can organise the most accounts, and would leave no way to
 * decline something popular and unbuildable. What upvotes buy is that the owners
 * cannot claim not to have known.
 *
 * The owner threshold is the same two-thirds used to release the fee treasury
 * and to approve a flagged listing — one SQL definition, called from all three,
 * so the numbers cannot drift apart.
 */

const TitleSchema = z.string().trim().min(3, "Give it a short title.").max(160);
const BodySchema = z.string().trim().max(5000);

export type FeatureStatus = "open" | "planned" | "declined" | "shipped";

export interface FeatureRequest {
  id: string;
  title: string;
  body: string;
  status: FeatureStatus;
  response: string;
  createdAt: string;
  decidedAt: string | null;
  upvotes: number;
  /** Whether the caller has upvoted. Null when signed out. */
  hasUpvoted: boolean | null;
  /** Owner tally. Null unless the caller is an owner. */
  consensus: {
    approvals: number;
    rejections: number;
    owners: number;
    needed: number;
    carried: boolean;
  } | null;
  myDecision: boolean | null;
  mine: boolean;
}

/** The board. Readable signed out — a roadmap nobody can read is not a roadmap. */
export async function listFeatureRequests(): Promise<FeatureRequest[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("feature_requests")
    .select("id, title, body, status, response, created_at, decided_at, submitted_by")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Could not load feature requests: ${error.message}`);

  const { data: votes } = await supabase
    .from("feature_request_votes")
    .select("request_id, voter_id");

  let callerId: string | null = null;
  let isOwner = false;
  try {
    callerId = (await requireCaller()).userId;
    try {
      await requireAdmin();
      isOwner = true;
    } catch {
      // Signed in but not an owner. The tally stays hidden, which is the point:
      // the board shows what was decided, not how each owner voted.
    }
  } catch {
    // Signed out. Upvote counts are public; whether *you* voted is not a
    // question that has an answer.
  }

  return Promise.all(
    (data ?? []).map(async (r) => {
      const rowVotes = (votes ?? []).filter((v) => v.request_id === r.id);

      let consensus: FeatureRequest["consensus"] = null;
      let myDecision: boolean | null = null;

      if (isOwner) {
        const { data: tally } = await supabase.rpc("feature_request_consensus", {
          rid: r.id,
        });
        const first = Array.isArray(tally) ? tally[0] : null;
        if (first) consensus = first;

        const { data: mine } = await supabase
          .from("feature_request_decisions")
          .select("approve")
          .eq("request_id", r.id)
          .eq("voter_id", callerId!)
          .maybeSingle();
        myDecision = mine?.approve ?? null;
      }

      return {
        id: r.id,
        title: r.title,
        body: r.body,
        status: r.status,
        response: r.response,
        createdAt: r.created_at,
        decidedAt: r.decided_at,
        upvotes: rowVotes.length,
        hasUpvoted: callerId ? rowVotes.some((v) => v.voter_id === callerId) : null,
        consensus,
        myDecision,
        mine: callerId === r.submitted_by,
      };
    }),
  );
}

export async function submitFeatureRequest(title: string, body: string) {
  const caller = await requireCaller();
  const supabase = await createClient();

  const { error } = await supabase.from("feature_requests").insert({
    title: TitleSchema.parse(title),
    body: BodySchema.parse(body),
    submitted_by: caller.userId,
  });

  if (error) throw new Error(`Could not submit the request: ${error.message}`);
}

/** Add or withdraw your upvote. One per person — the primary key is the rule. */
export async function toggleUpvote(requestId: string, upvote: boolean) {
  const caller = await requireCaller();
  const supabase = await createClient();

  const { error } = upvote
    ? await supabase
        .from("feature_request_votes")
        .upsert(
          { request_id: requestId, voter_id: caller.userId },
          { onConflict: "request_id,voter_id" },
        )
    : await supabase
        .from("feature_request_votes")
        .delete()
        .eq("request_id", requestId)
        .eq("voter_id", caller.userId);

  if (error) throw new Error(`Could not record your vote: ${error.message}`);
}

/**
 * An owner's decision. Two thirds moves the request to planned or declined.
 *
 * Upserted, so an owner may change their mind while it is still open — and the
 * database decides when it stops being open, not this function.
 */
export async function decideFeatureRequest(requestId: string, approve: boolean) {
  const caller = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("feature_request_decisions")
    .upsert(
      { request_id: requestId, voter_id: caller.userId, approve },
      { onConflict: "request_id,voter_id" },
    );

  if (error) throw new Error(`Could not record your decision: ${error.message}`);
}

/** Mark a planned request as shipped, or leave a note explaining a decline. */
export async function respondToFeatureRequest(
  requestId: string,
  response: string,
  status?: FeatureStatus,
) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("feature_requests")
    .update({
      response: response.trim().slice(0, 2000),
      ...(status ? { status } : {}),
    })
    .eq("id", requestId);

  if (error) throw new Error(`Could not update the request: ${error.message}`);
}
