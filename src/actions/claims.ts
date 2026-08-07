"use server";

import {
  createClaimRequest as create,
  listClaimRequests,
  deleteClaimRequest as remove,
} from "@/lib/data/platform";

export async function createClaimRequest(projectId: string, vaultAddress: string) {
  return create(projectId, vaultAddress);
}

export async function getClaimRequests() {
  try {
    return await listClaimRequests();
  } catch {
    // Non-admins get an empty list rather than an error page.
    return [];
  }
}

export async function deleteClaimRequest(projectId: string) {
  return remove(projectId);
}
