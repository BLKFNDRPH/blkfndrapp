/**
 * Unified server-side data layer.
 * Mongoose imports are dynamic so this file is safe to import from both
 * client and server components. MongoDB calls only execute on the server
 * (inside API routes / Server Actions).
 *
 * Client components should import from lib/data.client.ts instead.
 */

import type { Project, User, FundReceipt } from "./types";
import { getIPFSGatewayUrl } from "./pinata-client";

// ========== HELPERS ==========

// Normalize currency_type from on-chain string/number to our typed union.
const normalizeCurrency = (
  raw: number | string | undefined,
): "XLM" | "USDC" | "USDT" | "WBTC" | "WETH" => {
  if (typeof raw === "number") {
    switch (raw) {
      case 0: return "XLM";
      case 1: return "USDC";
      case 2: return "USDT";
      case 3: return "WBTC";
      case 4: return "WETH";
    }
  }
  const upper = String(raw ?? "").toUpperCase();
  if (upper === "USDC") return "USDC";
  if (upper === "USDT") return "USDT";
  if (upper === "WBTC") return "WBTC";
  if (upper === "WETH") return "WETH";
  return "XLM";
};

/**
 * Decimal places per currency for converting raw on-chain amounts to
 * human-readable values. Stellar assets generally use 7 decimals.
 */
const COIN_DECIMALS: Record<"XLM" | "USDC" | "USDT" | "WBTC" | "WETH", number> = {
  XLM: 7,
  USDC: 7,
  USDT: 7,
  WBTC: 7,
  WETH: 7,
};

const rawToHuman = (
  raw: string | number | bigint,
  currency: "XLM" | "USDC" | "USDT" | "WBTC" | "WETH",
): number => {
  const decimals = COIN_DECIMALS[currency];
  return Number(raw) / Math.pow(10, decimals);
};

const normalizeStatus = (
  status: number,
): "hidden" | "pending" | "rejected" | "approved" | "funded" | "completed" | "expired" => {
  switch (status) {
    case 0: return "hidden";
    case 1: return "pending";
    case 2: return "rejected";
    case 3: return "approved";
    case 4: return "funded";
    case 5: return "completed";
    case 6: return "expired";
    default: return "pending";
  }
};

// ========== DB HELPERS ==========

async function getDb() {
  const { connectToDatabase } = await import("./mongodb");
  await connectToDatabase();
  const { default: UserModel } = await import("./models/User");
  const { default: NotificationModel } = await import("./models/Notification");
  const { default: ClaimRequestModel } = await import("./models/ClaimRequest");
  const { default: ProjectCache } = await import("./models/ProjectCache");
  const { default: KycRequest } = await import("./models/KycRequest");
  return { UserModel, NotificationModel, ClaimRequestModel, ProjectCache, KycRequest };
}

// Project data comes from the indexer cache and per-vault reads, not from a
// single global contract. The two functions that used to live here read the
// retired monolithic crowdfunding contract and had no callers.

// ========== UNIFIED DATA LAYER ==========

export const getProjects = async (): Promise<Project[]> => {
  try {
    const { ProjectCache } = await getDb();
    const docs = await ProjectCache.find({}).lean();
    if (!docs || docs.length === 0) {
      return [];
    }

    const validDocs = docs.filter((d: any) => d.vaultAddress);
    if (validDocs.length === 0) {
      return [];
    }

    const creatorAddresses = Array.from(new Set(validDocs.map((d: any) => d.creator).filter(Boolean)));
    let kycMap: Record<string, string> = {};
    let userMap: Record<string, any> = {};
    try {
      const { UserModel, KycRequest } = await getDb();
      if (KycRequest) {
        const requests = await KycRequest.find({ address: { $in: creatorAddresses } }).lean();
        kycMap = Object.fromEntries(requests.map((r: any) => [r.address, r.fullName]));
      }
      if (UserModel) {
        const users = await UserModel.find({ stellarPublicKey: { $in: creatorAddresses } }).lean();
        userMap = Object.fromEntries(users.map((u: any) => [u.stellarPublicKey, u]));
      }
    } catch (err) {
      console.error("Failed to load creator names or user avatars:", err);
    }

    return validDocs.map((doc: any) => {
      const user = userMap[doc.creator];
      return {
        id: doc.projectId,
        title: doc.title,
        tagline: doc.tagline,
        description: doc.description,
        category: doc.category,
        fundingGoal: doc.fundingGoal,
        currentFunding: doc.currentFunding,
        fundingGoalRaw: doc.fundingGoalRaw,
        currentFundingRaw: doc.currentFundingRaw,
        imageUrl: doc.imageUrl,
        creator: doc.creator,
        creatorName: kycMap[doc.creator] || user?.name || doc.creator,
        creatorAddress: doc.creatorAddress,
        creatorAvatar: user?.creatorAvatar || doc.creatorAvatar || `https://i.pravatar.cc/150?u=${doc.creator}`,
        status: doc.status,
        featured: doc.featured,
        createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        fundingDeadline: doc.fundingDeadline,
        isPublic: doc.isPublic,
        currencyType: doc.currencyType,
        vaultAddress: doc.vaultAddress,
        bondAmount: doc.bondAmount,
        bondPosted: doc.bondPosted,
        releasedTotal: doc.releasedTotal,
        milestones: (doc.milestones || []).map((m: any) => ({
          id: Number(m.id),
          amount: Number(m.amount),
          released: Boolean(m.released),
          title: m.title || "",
          description: m.description || "",
          proof: m.proof || "",
        })),
        metadataCid: doc.metadataCid,
      } as any;
    });
  } catch (error) {
    console.error("Error fetching projects from cache:", error);
    return [];
  }
};

export const getProjectById = async (
  id: string,
): Promise<Project | undefined> => {
  try {
    const { ProjectCache, KycRequest, UserModel } = await getDb();
    const doc = await ProjectCache.findOne({ projectId: id }).lean() as any;
    if (!doc || !doc.vaultAddress) {
      return undefined;
    }

    let creatorName = doc.creator;
    let creatorAvatar = doc.creatorAvatar || `https://i.pravatar.cc/150?u=${doc.creator}`;

    try {
      let kyc: any = null;
      if (KycRequest) {
        kyc = await KycRequest.findOne({ address: doc.creator }).lean();
        if (kyc && kyc.fullName) {
          creatorName = kyc.fullName;
        }
      }
      if (UserModel) {
        const user = await UserModel.findOne({ stellarPublicKey: doc.creator }).lean();
        if (user) {
          if (!kyc || !kyc.fullName) {
            creatorName = user.name;
          }
          creatorAvatar = user.creatorAvatar || creatorAvatar;
        }
      }
    } catch (err) {
      console.error("Failed to load creator user or kyc request:", err);
    }

    return {
      id: doc.projectId,
      title: doc.title,
      tagline: doc.tagline,
      description: doc.description,
      category: doc.category,
      fundingGoal: doc.fundingGoal,
      currentFunding: doc.currentFunding,
      fundingGoalRaw: doc.fundingGoalRaw,
      currentFundingRaw: doc.currentFundingRaw,
      imageUrl: doc.imageUrl,
      creator: doc.creator,
      creatorName: creatorName,
      creatorAddress: doc.creatorAddress,
      creatorAvatar: creatorAvatar,
      status: doc.status,
      featured: doc.featured,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
      fundingDeadline: doc.fundingDeadline,
      isPublic: doc.isPublic,
      currencyType: doc.currencyType,
      vaultAddress: doc.vaultAddress,
      bondAmount: doc.bondAmount,
      bondPosted: doc.bondPosted,
      releasedTotal: doc.releasedTotal,
      milestones: (doc.milestones || []).map((m: any) => ({
        id: Number(m.id),
        amount: Number(m.amount),
        released: Boolean(m.released),
        title: m.title || "",
        description: m.description || "",
        proof: m.proof || "",
      })),
      metadataCid: doc.metadataCid,
    } as Project;
  } catch (error) {
    console.error(`Error fetching project ${id} from cache:`, error);
    return undefined;
  }
};

export const addProject = async (): Promise<never> => {
  throw new Error("Project creation must be done via an on-chain transaction.");
};

// ========== USER FUNCTIONS ==========

/**
 * Look up a user by wallet address or uid.
 *
 * addressField options:
 *   "stellarPublicKey"   — Stellar wallet public key (default)
 *   "uid"                — NextAuth session uid
 */
export async function getUserByCreatorId(
  address: string,
  addressField:
    | "stellarPublicKey"
    | "uid" = "stellarPublicKey",
): Promise<User | null> {
  if (!address) return null;
  try {
    const { UserModel } = await getDb();
    let doc: any = null;

    if (addressField === "uid") {
      doc = await UserModel.findOne({ uid: address }).lean();
    } else {
      doc = await UserModel.findOne({ stellarPublicKey: address }).lean();
    }

    if (!doc) return null;
    return { uid: doc.uid, ...doc } as User;
  } catch (error) {
    console.error("Error fetching user by creatorId:", error);
    return null;
  }
}

// ========== NOTIFICATION FUNCTIONS ==========

export const createNotification = async (
  userId: string,
  title: string,
  caption: string,
  url: string | null = null,
  objectId: string | null = null,
) => {
  if (!userId) return;
  try {
    const { NotificationModel } = await getDb();
    await NotificationModel.create({
      userId,
      title,
      caption,
      timestamp: Date.now(),
      isRead: false,
      url,
      object: objectId,
    });
  } catch (error) {
    console.error("Error creating notification:", error);
  }
};

// `userId` is required on the notification mutators so the ownership filter
// travels with the query and cannot be dropped at a call site.
export const dismissNotification = async (notificationId: string, userId: string) => {
  if (!notificationId || !userId) return;
  try {
    const { NotificationModel } = await getDb();
    await NotificationModel.deleteOne({ _id: notificationId, userId });
  } catch (error) {
    console.error("Error dismissing notification:", error);
  }
};

export const dismissAllNotifications = async (userId: string) => {
  if (!userId) return;
  try {
    const { NotificationModel } = await getDb();
    // Ensure we are matching the correct user and only unread ones
    await NotificationModel.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true } },
    );
  } catch (error) {
    console.error("Error dismissing all notifications:", error);
    throw error;
  }
};

export const markNotificationsAsRead = async (notificationIds: string[], userId: string) => {
  if (notificationIds.length === 0 || !userId) return;
  try {
    const { NotificationModel } = await getDb();
    await NotificationModel.updateMany(
      { _id: { $in: notificationIds }, userId },
      { $set: { isRead: true } },
    );
  } catch (error) {
    console.error("Error marking notifications as read:", error);
  }
};

// ========== PLATFORM & ADMIN FUNCTIONS ==========

export const getShareRules = async () => null;
export const getAdminActivityLog = async () => [];

export const isUserAdmin = async (userAddress: string) => {
  const denied = {
    isMainAdmin: false,
    isMultiSigAdmin: false,
    hasAdminAccess: false,
  };

  if (!userAddress) return denied;

  try {
    const { adminClient, simulate } = await import('./stellar-clients');

    // One source of truth. This used to consult the factory admin *and* the
    // approval module's signer list — two lists that could disagree, neither of
    // which was the roster the app actually meant. The admin registry is now
    // the single on-chain answer.
    //
    // Being on it grants access to the admin console. It grants nothing on
    // chain: no address here can release a milestone, block a refund, or move
    // a vault's balance.
    const isAdmin = await simulate(
      () => adminClient().is_admin({ account: userAddress }),
      `is_admin(${userAddress})`,
    );

    if (isAdmin !== true) return denied;

    // isMultiSigAdmin is retained for callers that still branch on it; the
    // distinction between a 'main' and a 'multisig' admin no longer exists.
    return { isMainAdmin: true, isMultiSigAdmin: true, hasAdminAccess: true };
  } catch (err) {
    console.error('Failed to read the admin roster:', err);
    // Fail closed: an unreachable RPC is not an admin.
    return denied;
  }
};

// ========== CLAIM REQUEST FUNCTIONS ==========

export const createClaimRequest = async (projectId: string, requestedBy: string) => {
  if (!projectId || !requestedBy) return;
  try {
    const { ClaimRequestModel } = await getDb();
    await ClaimRequestModel.findOneAndUpdate(
      { projectId },
      { requestedBy },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error("Error creating claim request:", error);
  }
};

export const getClaimRequests = async (): Promise<string[]> => {
  try {
    const { ClaimRequestModel } = await getDb();
    const docs = await ClaimRequestModel.find({}).lean();
    return docs.map((doc: any) => doc.projectId);
  } catch (error) {
    console.error("Error fetching claim requests:", error);
    return [];
  }
};

export const deleteClaimRequest = async (projectId: string) => {
  if (!projectId) return;
  try {
    const { ClaimRequestModel } = await getDb();
    await ClaimRequestModel.findOneAndDelete({ projectId });
  } catch (error) {
    console.error("Error deleting claim request:", error);
  }
};

export async function getUserFundsFromDb(address: string): Promise<FundReceipt[]> {
  const { ProjectCache } = await getDb();
  const { default: EventLog } = await import("./models/EventLog");
  
  const logs = await EventLog.find({
    topic1: "DEPOSIT",
    topic2: "CONTRIB",
    data: { $regex: address, $options: "i" }
  }).lean();
  
  const receipts: FundReceipt[] = [];
  
  for (const log of logs) {
    try {
      const parsed = JSON.parse(log.data);
      if (Array.isArray(parsed) && parsed.length >= 3) {
        const [projectIdVal, contributor, amountVal] = parsed;
        if (contributor.toLowerCase() !== address.toLowerCase()) {
          continue;
        }
        
        const projectId = String(projectIdVal);
        const project = await ProjectCache.findOne({ projectId }).lean();
        
        receipts.push({
          fund_id: log.eventId,
          contributor: contributor,
          project_id: projectId,
          project_title: project?.title || `Campaign #${projectId}`,
          image_url: project?.imageUrl || "",
          amount: String(amountVal),
          usdc_amount: String(amountVal),
          share_percentage: "0",
          fee_paid: String((BigInt(amountVal) * BigInt(3)) / BigInt(100)),
          fund_date: Math.floor(new Date(log.ledgerClosedAt || (log as any).createdAt).getTime() / 1000),
          currency_type: project?.currencyType || "USDC",
        });
      }
    } catch (e) {
      console.warn("Failed to parse log data inside getUserFundsFromDb:", e);
    }
  }
  
  return receipts;
}

export async function getAllFundReceiptsFromDb(): Promise<FundReceipt[]> {
  const { ProjectCache } = await getDb();
  const { default: EventLog } = await import("./models/EventLog");
  
  const logs = await EventLog.find({
    topic1: "DEPOSIT",
    topic2: "CONTRIB",
  }).lean();
  
  const receipts: FundReceipt[] = [];
  
  for (const log of logs) {
    try {
      const parsed = JSON.parse(log.data);
      if (Array.isArray(parsed) && parsed.length >= 3) {
        const [projectIdVal, contributor, amountVal] = parsed;
        const projectId = String(projectIdVal);
        const project = await ProjectCache.findOne({ projectId }).lean();
        
        receipts.push({
          fund_id: log.eventId,
          contributor: contributor,
          project_id: projectId,
          project_title: project?.title || `Campaign #${projectId}`,
          image_url: project?.imageUrl || "",
          amount: String(amountVal),
          usdc_amount: String(amountVal),
          share_percentage: "0",
          fee_paid: String((BigInt(amountVal) * BigInt(3)) / BigInt(100)),
          fund_date: Math.floor(new Date(log.ledgerClosedAt || (log as any).createdAt).getTime() / 1000),
          currency_type: project?.currencyType || "USDC",
        });
      }
    } catch (e) {
      console.warn("Failed to parse log data inside getAllFundReceiptsFromDb:", e);
    }
  }
  
  return receipts;
}
