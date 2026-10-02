"use server";

import {
  improveListingQuality,
  type ImproveListingQualityInput,
  type ImproveListingQualityOutput,
} from "@/ai/flows/improve-listing-quality";
import { requireCaller, requireAdmin, requireWalletOwnerOrAdmin, authFailure } from "@/lib/auth/guards";
import { setMilestoneProof, getProjectByVault } from "@/lib/data/projects";
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
import { readVaultState } from "@/lib/vault-state";

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

const MILESTONE_NOT_FOUND =
  "We couldn't find this milestone in the project's records. Refresh the project and try again.";

export async function submitMilestoneProof(
  vaultAddress: string,
  milestoneId: number,
  proof: string,
) {
  try {
    // Public endpoint: the arguments are whatever the request carried.
    if (typeof vaultAddress !== "string" || typeof proof !== "string" || !Number.isInteger(milestoneId)) {
      return { success: false, error: "That proof request was malformed." };
    }

    // The vault itself, not the indexer's copy of it, which can lag: it names
    // the builder, and it is the current answer to whether this milestone can
    // still take proof. A failed read and a missing vault look the same here.
    const vault = await readVaultState(vaultAddress);
    if (!vault) {
      return { success: false, error: "We couldn't read this project's vault from the network. Try again in a moment." };
    }

    // Only the project's builder may submit delivery evidence for it.
    await requireWalletOwnerOrAdmin(vault.creator);

    // Proof is accepted exactly when the project dialog offers it: while the
    // vault is paying out milestones, for a milestone that has neither been
    // paid out nor failed. Past that point the proof is the record of what
    // stakeholders voted on, so it stays as it was.
    const milestone = vault.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return { success: false, error: MILESTONE_NOT_FOUND };
    if (milestone.released) {
      return { success: false, error: "This milestone has been paid out, so its proof can no longer be changed." };
    }
    if (milestone.failed) {
      return { success: false, error: "This milestone has failed, so its proof can no longer be changed." };
    }
    // A failed milestone marks only itself; the vault closing ends the rest.
    if (vault.status !== "funded" && vault.status !== "active") {
      return {
        success: false,
        error:
          vault.status === "raising" || vault.status === "pending"
            ? "Proof can be added once this project reaches its goal."
            : "This project's vault has closed, so its proof can no longer be changed.",
      };
    }

    const ok = await setMilestoneProof(vaultAddress, milestoneId, proof);
    if (!ok) return { success: false, error: MILESTONE_NOT_FOUND };

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

// `notify` is intentionally NOT re-exported as an action. It is a no-auth
// service-role insert, so exposing it would let anyone send any user an
// arbitrary notification (in-app phishing). It must stay internal to the
// server-only data layer.
