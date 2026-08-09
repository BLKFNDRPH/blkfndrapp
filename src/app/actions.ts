"use server";

import { revalidatePath } from "next/cache";
import {
  improveListingQuality,
  type ImproveListingQualityInput,
  type ImproveListingQualityOutput,
} from "@/ai/flows/improve-listing-quality";
import { requireCaller, requireAdmin, requireWalletOwnerOrAdmin, authFailure } from "@/lib/auth/guards";
import { getProjects as listProjects, setMilestoneProof, getProjectByVault } from "@/lib/data/projects";
import { dismissAll } from "@/lib/data/notifications";
import { notifyAdmins } from "@/lib/data/notifications";
import {
  submitOwnKyc,
  getOwnSubmission,
  listSubmissionsForReview,
  getSubmissionForReview,
  decideSubmission,
  attestSubmission,
  revokeSubmissionAttestation,
  myManagedAttestor,
} from "@/lib/data/kyc";
import { getVaultCreator } from "@/lib/vault-state";

// Every export here is a public HTTP endpoint. Each one guards itself, and the
// database confines what it can reach even if one forgets.

export async function runImproveListingQuality(
  input: ImproveListingQualityInput,
): Promise<ImproveListingQualityOutput | null> {
  // Billable model call — signed-in callers only.
  try {
    await requireCaller();
  } catch {
    return null;
  }

  try {
    return await improveListingQuality(input);
  } catch (error) {
    console.error("AI analysis failed:", error);
    return null;
  }
}

export async function getProjects() {
  return listProjects();
}

export async function clearNotificationsAction() {
  try {
    await dismissAll();
    revalidatePath("/", "layout");
    return { success: true as const };
  } catch {
    return { success: false };
  }
}

// ── KYC ────────────────────────────────────────────────────────────────────

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends unknown ? T : never))
  | { success: false; error: string };

export async function submitKycRequest(
  input: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await submitOwnKyc(input);
    return { success: true as const };
  } catch (error) {
    return (
      authFailure(error) ?? {
        success: false,
        error: error instanceof Error ? error.message : "Could not submit.",
      }
    );
  }
}

export async function getMyKycStatus(): Promise<ActionResult<{ request: Awaited<ReturnType<typeof getOwnSubmission>> }>> {
  try {
    return { success: true, request: await getOwnSubmission() };
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Could not read status." };
  }
}

export async function getKycRequests(
  status?: "pending" | "approved" | "rejected",
): Promise<ActionResult<{ requests: Awaited<ReturnType<typeof listSubmissionsForReview>> }>> {
  try {
    return { success: true, requests: await listSubmissionsForReview(status) };
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Could not list submissions." };
  }
}

export async function getKycSubmission(submissionId: string) {
  try {
    return { success: true, request: await getSubmissionForReview(submissionId) };
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Could not read submission." };
  }
}

export async function updateKycRequestStatus(
  submissionId: string,
  status: "approved" | "rejected",
  rejectionReason?: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await decideSubmission(submissionId, status, rejectionReason);
    return { success: true as const };
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Could not record decision." };
  }
}

/**
 * Approve and attest a submission with the reviewer's managed key — the
 * walletless path. The server signs the on-chain attestation; the reviewer never
 * connects Freighter. Returns the address attested so the panel can refresh.
 */
export async function attestKycAction(
  submissionId: string,
): Promise<{ success: true; address: string } | { success: false; error: string }> {
  try {
    const { address } = await attestSubmission(submissionId);
    return { success: true as const, address };
  } catch (error) {
    return (
      authFailure(error) ?? {
        success: false,
        error: error instanceof Error ? error.message : "Could not attest submission.",
      }
    );
  }
}

/** Revoke a submission's attestation with the reviewer's managed key. */
export async function revokeKycAction(
  submissionId: string,
): Promise<{ success: true; address: string } | { success: false; error: string }> {
  try {
    const { address } = await revokeSubmissionAttestation(submissionId);
    return { success: true as const, address };
  } catch (error) {
    return (
      authFailure(error) ?? {
        success: false,
        error: error instanceof Error ? error.message : "Could not revoke attestation.",
      }
    );
  }
}

/** The managed attestor wallet the platform holds for the caller, or null. Lets
 *  the review queue offer walletless attestation only to those who have one. */
export async function getMyManagedAttestorAction(): Promise<{ managedWallet: string | null }> {
  try {
    return { managedWallet: await myManagedAttestor() };
  } catch {
    return { managedWallet: null };
  }
}

// ── Indexer ────────────────────────────────────────────────────────────────

/**
 * Admin-only. The scheduled path is POST /api/indexer with INDEXER_SECRET;
 * this exists for manual reconciliation from the console.
 */
export async function triggerIndexerSync() {
  try {
    await requireAdmin();
    const { runIndexer } = await import("@/lib/event-indexer");
    return { success: true, result: await runIndexer() };
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Indexer run failed." };
  }
}

// ── Milestones ─────────────────────────────────────────────────────────────

export async function submitMilestoneProof(
  vaultAddress: string,
  milestoneId: number,
  proof: string,
) {
  try {
    // Only the project's builder may submit delivery evidence for it.
    const creator = await getVaultCreator(vaultAddress);
    if (!creator) return { success: false, error: "Vault not found on-chain" };
    await requireWalletOwnerOrAdmin(creator);

    const ok = await setMilestoneProof(vaultAddress, milestoneId, proof);
    if (!ok) return { success: false, error: "Project or milestone not found" };

    const project = await getProjectByVault(vaultAddress);
    const title = project?.title ?? vaultAddress;

    await notifyAdmins(
      "New milestone proof submitted",
      `Delivery proof for milestone #${milestoneId} of "${title}" is awaiting contributor review.`,
    );

    return { success: true as const };
  } catch (error) {
    return (
      authFailure(error) ?? {
        success: false,
        error: error instanceof Error ? error.message : "Could not submit proof.",
      }
    );
  }
}

// `notify` is intentionally NOT re-exported as an action — see the note in
// src/actions/notifications.ts. It is a no-auth service-role insert and must
// stay internal to the server-only data layer.
