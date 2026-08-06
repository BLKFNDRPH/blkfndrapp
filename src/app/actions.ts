"use server";

import { improveListingQuality, type ImproveListingQualityInput, type ImproveListingQualityOutput } from "@/ai/flows/improve-listing-quality";
import { revalidatePath } from 'next/cache';
import { getProjects as getAllProjects, dismissAllNotifications, getUserByCreatorId } from '@/lib/data';
import { getSession } from "@/lib/auth/session";
import {
  requireSession,
  requireAdmin,
  requireWalletOwnerOrAdmin,
  authFailure,
} from "@/lib/auth/guards";
import { readVaultState, getVaultCreator } from "@/lib/vault-state";

// Every export in this file is a public HTTP endpoint. Each one guards itself.

export async function runImproveListingQuality(input: ImproveListingQualityInput): Promise<ImproveListingQualityOutput | null> {
  // Billable model call — signed-in callers only.
  try {
    await requireSession();
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
  return await getAllProjects();
}

export async function clearNotificationsAction(address: string) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return { success: false };
    }

    const user = await getUserByCreatorId(address, "stellarPublicKey");
    if (user && user.uid === session.user.uid) {
      await dismissAllNotifications(user.uid);

      // This tells Next.js to delete the old cache for the layout/page
      // and fetch the fresh "0 notifications" state from the DB
      revalidatePath("/", "layout");

      return { success: true };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * Cache off-chain listing metadata for a freshly deployed vault.
 * Only the vault's on-chain creator (or an admin) may write it.
 */
export async function saveProjectMetadataCacheByVault(vaultAddress: string, metadata: any) {
  if (!vaultAddress) {
    return { success: false, error: "vaultAddress is required" };
  }

  try {
    const creator = await getVaultCreator(vaultAddress);
    if (!creator) {
      return { success: false, error: "Vault not found on-chain" };
    }
    await requireWalletOwnerOrAdmin(creator);
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  try {
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: ProjectCache } = await import("@/lib/models/ProjectCache");

    const goalStroops = metadata.fundingGoalRaw || "0";
    const fundingGoal = Number(metadata.fundingGoal || 100);

    const updateDoc: any = {
      projectId: "temp_" + vaultAddress,
      vaultAddress,
      title: metadata.title || "Project",
      tagline: metadata.tagline || "",
      description: metadata.description || "",
      category: metadata.category || "Blockchain",
      imageUrl: metadata.imageUrl || "",
      creator: metadata.creator || "",
      creatorAddress: metadata.creator || "",
      status: "pending",
      fundingDeadline: Number(metadata.fundingDeadline || Date.now() + 30 * 24 * 3600 * 1000),
      fundingGoal: fundingGoal,
      fundingGoalRaw: String(goalStroops),
      currencyType: metadata.currencyType || "USDC",
      bondAmount: Number(metadata.bondAmount || 0),
      milestones: (metadata.milestones || []).map((m: any) => ({
        id: Number(m.id),
        amount: Number(m.amount),
        released: false,
        title: m.title || "",
        description: m.description || "",
      })),
      createdAtOnChain: new Date(),
    };

    if (metadata.metadataCid) {
      updateDoc.metadataCid = metadata.metadataCid;
    }

    await ProjectCache.findOneAndUpdate(
      { vaultAddress },
      { $set: updateDoc },
      { upsert: true, new: true }
    );
    return { success: true };
  } catch (error: any) {
    console.error("Failed to save project metadata cache:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

/**
 * Refresh a project's cached funding figures from the ledger.
 *
 * Takes no financial data from the caller — the server reads the vault itself,
 * so a browser cannot post fabricated funding totals or milestone flags. Safe
 * to call unauthenticated because every value written is sourced on-chain.
 */
export async function updateProjectStatusFromChain(vaultAddress: string) {
  if (!vaultAddress) {
    return { success: false, error: "vaultAddress is required" };
  }

  try {
    const onChain = await readVaultState(vaultAddress);
    if (!onChain) {
      return { success: false, error: "Vault not readable on-chain" };
    }

    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: ProjectCache } = await import("@/lib/models/ProjectCache");

    const existing = await ProjectCache.findOne({ vaultAddress }).lean() as any;
    if (!existing) {
      return { success: false, error: "Project not found" };
    }

    // Milestone titles and descriptions are off-chain copy; amounts and the
    // released flag come from the ledger.
    const existingMap = new Map<number, any>(
      (existing.milestones || []).map((m: any) => [m.id, m])
    );
    const mergedMilestones = onChain.milestones.map((m) => {
      const ext = existingMap.get(m.id);
      return {
        id: m.id,
        amount: m.amount,
        released: m.released,
        title: ext?.title || `Milestone ${m.id}`,
        description: ext?.description || "",
        proof: ext?.proof || "",
      };
    });

    await ProjectCache.findOneAndUpdate(
      { vaultAddress },
      {
        $set: {
          currentFunding: onChain.currentFunding,
          currentFundingRaw: onChain.currentFundingRaw,
          bondPosted: onChain.bondPosted,
          bondAmount: onChain.bondAmount,
          releasedTotal: onChain.releasedTotal,
          milestones: mergedMilestones,
          status: onChain.status,
        },
      },
      { new: true }
    );
    return { success: true };
  } catch (error: any) {
    console.error("Failed to update project status:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

export async function submitKycRequest(
  address: string,
  data: {
    fullName: string;
    email: string;
    documentType: string;
    documentImage: string;
    idNumber: string;
    dob: string;
    expiryDate: string;
    residentialAddress: string;
    consentFlag: boolean;
  }
) {
  // You may only file KYC against a wallet you have proven you control.
  try {
    await requireWalletOwnerOrAdmin(address);
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  try {
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: KycRequest } = await import("@/lib/models/KycRequest");
    const crypto = await import("crypto");

    const detailsString = JSON.stringify({
      fullName: data.fullName,
      email: data.email,
      documentType: data.documentType,
      documentImage: data.documentImage,
      idNumber: data.idNumber,
      dob: data.dob,
      expiryDate: data.expiryDate,
      residentialAddress: data.residentialAddress,
      consentFlag: data.consentFlag,
    });
    const detailsHash = crypto.createHash("sha256").update(detailsString).digest("hex");

    await KycRequest.findOneAndUpdate(
      { address },
      {
        $set: {
          fullName: data.fullName,
          email: data.email,
          documentType: data.documentType,
          documentImage: data.documentImage,
          detailsHash,
          status: "pending",
          idNumber: data.idNumber,
          dob: new Date(data.dob),
          expiryDate: new Date(data.expiryDate),
          residentialAddress: data.residentialAddress,
          consentFlag: data.consentFlag,
        },
      },
      { upsert: true, new: true }
    );
    return { success: true };
  } catch (error: any) {
    console.error("Failed to submit KYC request:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

/**
 * Admin-only. Returns identity documents for every applicant.
 */
export async function getKycRequests() {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  try {
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: KycRequest } = await import("@/lib/models/KycRequest");

    const list = await KycRequest.find({}).lean();
    return {
      success: true,
      requests: JSON.parse(JSON.stringify(list)),
    };
  } catch (error: any) {
    console.error("Failed to get KYC requests:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

export async function getKycRequestByAddress(address: string) {
  let isAdmin = false;
  try {
    ({ isAdmin } = await requireWalletOwnerOrAdmin(address));
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  try {
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: KycRequest } = await import("@/lib/models/KycRequest");

    const doc = await KycRequest.findOne({ address }).lean() as any;
    if (!doc) {
      return { success: true, request: null };
    }

    // The applicant gets status only. Re-serving their own ID number, date of
    // birth, home address, and document scan back to the browser puts that data
    // one XSS away from exfiltration for no product benefit.
    const request = isAdmin
      ? JSON.parse(JSON.stringify(doc))
      : {
          address: doc.address,
          status: doc.status,
          rejectionReason: doc.rejectionReason ?? "",
          documentType: doc.documentType,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        };

    return { success: true, request };
  } catch (error: any) {
    console.error("Failed to get KYC request status:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

export async function updateKycRequestStatus(
  address: string,
  status: "approved" | "rejected",
  rejectionReason?: string
) {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  if (status !== "approved" && status !== "rejected") {
    return { success: false, error: "Invalid status" };
  }

  try {
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: KycRequest } = await import("@/lib/models/KycRequest");

    const updated = await KycRequest.findOneAndUpdate(
      { address },
      {
        $set: {
          status,
          rejectionReason: status === "rejected" ? (rejectionReason || "") : "",
        },
      },
      { new: true }
    );
    if (!updated) {
      return { success: false, error: "KYC request not found" };
    }
    return { success: true };
  } catch (error: any) {
    console.error("Failed to update KYC request status:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

/**
 * Admin-only. The scheduled path is POST /api/indexer with INDEXER_SECRET;
 * this exists for manual reconciliation from the admin UI.
 */
export async function triggerIndexerSync() {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  try {
    const { runIndexer } = await import("@/lib/event-indexer");
    const result = await runIndexer();
    return { success: true, result };
  } catch (error: any) {
    console.error("Failed to trigger indexer sync:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

export async function submitMilestoneProof(
  vaultAddress: string,
  milestoneId: number,
  proof: string
) {
  if (!vaultAddress) {
    return { success: false, error: "vaultAddress is required" };
  }

  // Only the project's builder may submit delivery proof for it.
  try {
    const creator = await getVaultCreator(vaultAddress);
    if (!creator) {
      return { success: false, error: "Vault not found on-chain" };
    }
    await requireWalletOwnerOrAdmin(creator);
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  try {
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: ProjectCache } = await import("@/lib/models/ProjectCache");

    const result = await ProjectCache.findOneAndUpdate(
      { vaultAddress, "milestones.id": milestoneId },
      { $set: { "milestones.$.proof": proof } },
      { new: true }
    );
    if (!result) {
      return { success: false, error: "Project or Milestone not found" };
    }

    // Create notifications for admins and creator
    try {
      const project = result;
      const { createNotification, getUserByCreatorId: getCreator } = await import("@/lib/data");
      const { default: UserModel } = await import("@/lib/models/User");

      // Notify all admin users
      const admins = await UserModel.find({ role: "admin" }).lean();
      const projectTitle = project.title || `Project ${project.projectId}`;
      for (const admin of admins) {
        await createNotification(
          admin.uid,
          "New Milestone Proof Submitted",
          `A delivery proof for Milestone #${milestoneId} of "${projectTitle}" has been submitted and is awaiting contributor approval.`,
          null,
          project.projectId
        );
      }

      // Notify the creator
      const creatorKey = project.creator || project.creatorAddress;
      if (creatorKey) {
        const creator = await getCreator(creatorKey, "stellarPublicKey");
        if (creator) {
          await createNotification(
            creator.uid,
            "Proof Submission Confirmed",
            `Your delivery proof for Milestone #${milestoneId} of "${projectTitle}" has been logged and is awaiting contributor approval.`,
            null,
            project.projectId
          );
        }
      }
    } catch (notifErr) {
      console.error("Failed to create proof submission notifications:", notifErr);
      // Don't fail the main operation for notification errors
    }

    return { success: true };
  } catch (error: any) {
    console.error("Failed to submit milestone proof:", error);
    return { success: false, error: error?.message || String(error) };
  }
}
