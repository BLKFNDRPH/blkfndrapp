"use server";

import {
  createClaimRequest as dbCreateClaimRequest,
  getClaimRequests as dbGetClaimRequests,
  deleteClaimRequest as dbDeleteClaimRequest
} from "@/lib/data";
import { getSession } from "@/lib/auth/session";

export async function createClaimRequest(projectId: string, requestedBy: string) {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return dbCreateClaimRequest(projectId, requestedBy);
}

export async function getClaimRequests() {
  const session = await getSession();
  if (!session?.user) {
    return [];
  }
  return dbGetClaimRequests();
}

export async function deleteClaimRequest(projectId: string) {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return dbDeleteClaimRequest(projectId);
}
