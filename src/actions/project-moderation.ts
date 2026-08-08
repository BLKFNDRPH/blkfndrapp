"use server";

import {
  flagForConsensus,
  voteOnProject,
  clearModeration,
  getModeration,
  listPendingReviews,
} from "@/lib/data/project-moderation";
import { authFailure } from "@/lib/auth/guards";

/**
 * Every exported async function in a "use server" file is a public HTTP endpoint
 * reachable by action id whether or not a component calls it. These wrappers add
 * no authorization of their own — requireAdmin, RLS and the consensus trigger
 * all run underneath — they only turn a thrown AuthError into something
 * renderable.
 */

function fail(error: unknown, fallback: string) {
  return (
    authFailure(error) ?? {
      success: false as const,
      error: error instanceof Error ? error.message : fallback,
    }
  );
}

export async function flagProjectAction(projectId: string, reason?: string) {
  try {
    await flagForConsensus(projectId, reason ?? "");
    return { success: true as const, moderation: await getModeration(projectId) };
  } catch (error) {
    return fail(error, "Could not flag the listing.");
  }
}

export async function voteOnProjectAction(projectId: string, approve: boolean) {
  try {
    await voteOnProject(projectId, approve);
    return { success: true as const, moderation: await getModeration(projectId) };
  } catch (error) {
    return fail(error, "Could not record your vote.");
  }
}

export async function clearModerationAction(projectId: string) {
  try {
    await clearModeration(projectId);
    return { success: true as const };
  } catch (error) {
    return fail(error, "Could not clear the review.");
  }
}

export async function getModerationAction(projectId: string) {
  try {
    return { success: true as const, moderation: await getModeration(projectId) };
  } catch (error) {
    return fail(error, "Could not load the review state.");
  }
}

export async function getPendingReviewsAction() {
  try {
    return { success: true as const, reviews: await listPendingReviews() };
  } catch (error) {
    return fail(error, "Could not load pending reviews.");
  }
}
