
"use server";

import { improveListingQuality, type ImproveListingQualityInput, type ImproveListingQualityOutput } from "@/ai/flows/improve-listing-quality";
import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { getProjects as getAllProjects, dismissAllNotifications, getUserByCreatorId } from '@/lib/data';
import { getSession } from "@/lib/auth/session";
import type { Project } from "@/lib/types";

const projectSchema = z.object({
  title: z.string(),
  tagline: z.string(),
  description: z.string(),
  category: z.string(),
  fundingGoal: z.number(),
  creatorAvatar: z.string(),
});

type CreateListingInput = z.infer<typeof projectSchema> & {
  creator: string;
  recipient: string; // Stellar address
  imageUrl: string;
  creatorId: string;
};


export async function runImproveListingQuality(input: ImproveListingQualityInput): Promise<ImproveListingQualityOutput | null> {
  try {
    const result = await improveListingQuality(input);
    return result;
  } catch (error) {
    console.error("AI analysis failed:", error);
    return null;
  }
}

export async function uploadImage(url: string): Promise<{ url: string } | { error: string }> {
  // This function is now only a fallback for a case that shouldn't happen
  try {
    if (!url.startsWith('data:image') && !url.startsWith('http')) {
      return { error: 'Invalid image URL. Must be a data URL or a standard web link.' };
    }
    return { url: url };
  } catch (error) {
    console.error("Mock upload exception:", error);
    return { error: 'An unexpected error occurred during mock image upload.' };
  }
}

export async function createListing(data: CreateListingInput) {
  // This action now directly adds to the database via the data layer
  // This will fail as addProject no longer supports non-on-chain creation.
  // Kept for structural integrity but should not be called.
  console.error("createListing action was called, but it's only supported for on-chain operations now.");
  return { success: false, error: "This action is deprecated for non-on-chain operations." };
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
  } catch (e) {
    return { success: false };
  }
}

export async function saveProjectMetadataCacheByVault(vaultAddress: string, metadata: any) {
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

export async function updateProjectStatusFromChain(
  vaultAddress: string,
  data: {
    currentFunding: number;
    currentFundingRaw: string;
    bondPosted: boolean;
    bondAmount: number;
    releasedTotal: number;
    milestones: { id: number; amount: number; released: boolean }[];
    status: string;
  }
) {
  try {
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: ProjectCache } = await import("@/lib/models/ProjectCache");

    const existing = await ProjectCache.findOne({ vaultAddress }).lean() as any;
    let mergedMilestones = data.milestones;
    if (existing && existing.milestones) {
      const existingMap = new Map(existing.milestones.map((m: any) => [m.id, m]));
      mergedMilestones = data.milestones.map((m: any) => {
        const ext = existingMap.get(m.id) as any;
        return {
          id: m.id,
          amount: m.amount,
          released: m.released,
          title: ext?.title || `Milestone ${m.id}`,
          description: ext?.description || "",
          proof: ext?.proof || "",
        };
      });
    }

    let dbStatus = data.status;
    if (dbStatus === "raising" && !data.bondPosted) {
      dbStatus = "pending";
    }

    const updateDoc: any = {
      currentFunding: data.currentFunding,
      currentFundingRaw: data.currentFundingRaw,
      bondPosted: data.bondPosted,
      bondAmount: data.bondAmount,
      releasedTotal: data.releasedTotal,
      milestones: mergedMilestones,
      status: dbStatus,
    };

    await ProjectCache.findOneAndUpdate(
      { vaultAddress },
      { $set: updateDoc },
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

export async function getKycRequests() {
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
  try {
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: KycRequest } = await import("@/lib/models/KycRequest");

    const doc = await KycRequest.findOne({ address }).lean();
    return {
      success: true,
      request: doc ? JSON.parse(JSON.stringify(doc)) : null,
    };
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
    const { connectToDatabase } = await import("@/lib/mongodb");
    await connectToDatabase();
    const { default: KycRequest } = await import("@/lib/models/KycRequest");

    await KycRequest.findOneAndUpdate(
      { address },
      {
        $set: {
          status,
          rejectionReason: status === "rejected" ? (rejectionReason || "") : "",
        },
      }
    );
    return { success: true };
  } catch (error: any) {
    console.error("Failed to update KYC request status:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

export async function triggerIndexerSync() {
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
          `A delivery proof for Milestone #${milestoneId} of "${projectTitle}" has been submitted and is awaiting multi-sig verification.`,
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
            `Your delivery proof for Milestone #${milestoneId} of "${projectTitle}" has been logged and is awaiting multi-sig verification.`,
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