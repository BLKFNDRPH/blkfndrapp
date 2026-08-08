"use server";

import {
  listFeatureRequests,
  submitFeatureRequest,
  toggleUpvote,
  decideFeatureRequest,
  respondToFeatureRequest,
  type FeatureStatus,
} from "@/lib/data/feature-requests";
import { authFailure } from "@/lib/auth/guards";

/**
 * Every exported async function in a "use server" file is a public HTTP endpoint
 * reachable by action id whether or not a component calls it. These wrappers add
 * no authorization of their own — requireCaller, requireAdmin, RLS and the
 * consensus trigger all run underneath — they only turn a thrown AuthError into
 * something renderable.
 */

function fail(error: unknown, fallback: string) {
  return (
    authFailure(error) ?? {
      success: false as const,
      error: error instanceof Error ? error.message : fallback,
    }
  );
}

export async function getFeatureRequestsAction() {
  try {
    return { success: true as const, requests: await listFeatureRequests() };
  } catch (error) {
    return fail(error, "Could not load the roadmap.");
  }
}

export async function submitFeatureRequestAction(title: string, body: string) {
  try {
    await submitFeatureRequest(title, body);
    return { success: true as const, requests: await listFeatureRequests() };
  } catch (error) {
    return fail(error, "Could not submit your request.");
  }
}

export async function toggleUpvoteAction(requestId: string, upvote: boolean) {
  try {
    await toggleUpvote(requestId, upvote);
    return { success: true as const, requests: await listFeatureRequests() };
  } catch (error) {
    return fail(error, "Could not record your vote.");
  }
}

export async function decideFeatureRequestAction(requestId: string, approve: boolean) {
  try {
    await decideFeatureRequest(requestId, approve);
    return { success: true as const, requests: await listFeatureRequests() };
  } catch (error) {
    return fail(error, "Could not record your decision.");
  }
}

export async function respondToFeatureRequestAction(
  requestId: string,
  response: string,
  status?: FeatureStatus,
) {
  try {
    await respondToFeatureRequest(requestId, response, status);
    return { success: true as const, requests: await listFeatureRequests() };
  } catch (error) {
    return fail(error, "Could not update the request.");
  }
}
