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

// ========== ON-CHAIN PROJECT FUNCTIONS ==========

const getOnChainProjects = async (): Promise<Project[]> => {
  try {
    const { Client } = await import("@/packages/blkfndr_v2/src");
    const { Networks } = await import("@stellar/stellar-sdk");
    const { CONTRACT_ID, SOROBAN_RPC_URL } = await import("./stellar");

    const client = new Client({
      contractId: CONTRACT_ID!,
      rpcUrl: SOROBAN_RPC_URL!,
      networkPassphrase: Networks.TESTNET,
    });

    const tx = await client.get_all_projects();
    const simulation = (await tx.simulate()) as any;

    let rawProjects: any[] = [];
    if (simulation.result !== undefined) {
      rawProjects = simulation.result;
    } else if (simulation.returnValue !== undefined) {
      rawProjects = simulation.returnValue;
    }

    if (!rawProjects || !rawProjects.length) return [];

    // Collect all creator addresses upfront for a single batched DB query
    const creatorAddresses = rawProjects
      .map((p: any) => p.creator)
      .filter(Boolean);
    let userMap: Record<string, any> = {};
    try {
      const { UserModel } = await getDb();
      const users = await UserModel.find({
        stellarPublicKey: {
          $in: creatorAddresses,
        },
      }).lean();

      userMap = Object.fromEntries(
        users.flatMap((u: any) => {
          const entries = [];
          if (u.stellarPublicKey)
            entries.push([u.stellarPublicKey, u]);
          return entries;
        }),
      );
    } catch (e) {
      console.error("MongoDB batch lookup failed:", e);
    }

    const projects = rawProjects.map((p: any) => {
      const creatorStr = p.creator;
      const user = creatorStr ? userMap[creatorStr] : undefined;
      const creatorName = user?.name ?? p.creator;
      const creatorAvatar =
        user?.creatorAvatar ?? `https://i.pravatar.cc/150?u=${p.creator}`;
      const creatorUid = user?.uid;

      const currency = normalizeCurrency(p.currency_type);
      const timestampMs = Number(p.created_at) * 1000;

      return {
        id: p.id.toString(),
        title: p.title,
        tagline: p.tagline,
        description: p.description,
        category: p.category,
        fundingGoal: rawToHuman(p.goal, currency),
        currentFunding: rawToHuman(p.raised_amount, currency),
        fundingGoalRaw: p.goal.toString(),
        currentFundingRaw: p.raised_amount.toString(),
        imageUrl: getIPFSGatewayUrl(p.blob_id),
        creator: creatorName,
        creatorAvatar,
        creatorAddress: p.creator,
        status: normalizeStatus(p.status),
        featured: false,
        createdAt: !isNaN(timestampMs)
          ? new Date(timestampMs).toISOString()
          : null,
        creatorId: creatorUid,
        fundingDeadline: Number(p.funding_deadline) * 1000,
        isPublic: p.status !== 0,
        currencyType: currency,
      } as Project;
    });

    return projects.filter((p): p is Project => p !== null);
  } catch (error) {
    console.error("Error fetching on-chain projects:", error);
    return [];
  }
};

const getOnChainProjectById = async (
  projectId: string,
): Promise<Project | undefined> => {
  try {
    let projectIdBigInt: bigint;
    try {
      projectIdBigInt = BigInt(projectId);
    } catch {
      return undefined;
    }

    const { Client } = await import("@/packages/blkfndr_v2/src");
    const { Networks } = await import("@stellar/stellar-sdk");
    const { CONTRACT_ID, SOROBAN_RPC_URL } = await import("./stellar");

    const client = new Client({
      contractId: CONTRACT_ID!,
      rpcUrl: SOROBAN_RPC_URL!,
      networkPassphrase: Networks.TESTNET,
    });

    const tx = await client.get_project({ project_id: projectIdBigInt });
    const simulation = (await tx.simulate()) as any;

    let p: any = null;
    if (simulation.result !== undefined) {
      p = simulation.result;
    } else if (simulation.returnValue !== undefined) {
      p = simulation.returnValue;
    }

    if (!p) return undefined;

    let creatorName = p.creator;
    let creatorAvatar = `https://i.pravatar.cc/150?u=${p.creator}`;
    let creatorUid: string | undefined;

    try {
      const user = await getUserByCreatorId(p.creator, "stellarPublicKey");
      if (user) {
        creatorName = user.name;
        creatorAvatar = user.creatorAvatar;
        creatorUid = user.uid;
      }
    } catch (e) {
      console.error("MongoDB lookup failed for creator:", e);
    }

    const currency = normalizeCurrency(p.currency_type);
    const timestampMs = Number(p.created_at) * 1000;

    return {
      id: p.id.toString(),
      title: p.title,
      tagline: p.tagline,
      description: p.description,
      category: p.category,
      fundingGoal: rawToHuman(p.goal, currency),
      currentFunding: rawToHuman(p.raised_amount, currency),
      fundingGoalRaw: p.goal.toString(),
      currentFundingRaw: p.raised_amount.toString(),
      imageUrl: getIPFSGatewayUrl(p.blob_id),
      creator: creatorName,
      creatorAvatar,
      creatorAddress: p.creator,
      status: normalizeStatus(p.status),
      featured: false,
      createdAt: !isNaN(timestampMs)
        ? new Date(timestampMs).toISOString()
        : null,
      creatorId: creatorUid ?? p.creator,
      fundingDeadline: Number(p.funding_deadline) * 1000,
      isPublic: p.status !== 0,
      currencyType: currency,
    };
  } catch (error) {
    console.error(`Error fetching on-chain project ID ${projectId}:`, error);
    return undefined;
  }
};

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

export const dismissNotification = async (notificationId: string) => {
  try {
    const { NotificationModel } = await getDb();
    await NotificationModel.findByIdAndDelete(notificationId);
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

export const markNotificationsAsRead = async (notificationIds: string[]) => {
  if (notificationIds.length === 0) return;
  try {
    const { NotificationModel } = await getDb();
    await NotificationModel.updateMany(
      { _id: { $in: notificationIds } },
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
  if (!userAddress)
    return {
      isMainAdmin: false,
      isMultiSigAdmin: false,
      hasAdminAccess: false,
    };
  try {
    const { Client: FactoryClient } = await import("@/packages/blkfndr_factory/src");
    const { Client: ApprovalClient } = await import("@/packages/blkfndr_approval/src");
    const { Networks } = await import("@stellar/stellar-sdk");
    const { SOROBAN_RPC_URL } = await import("./stellar");

    const factoryContractId = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID;
    const approvalContractId = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID;

    if (!factoryContractId || !approvalContractId) {
      console.warn("Factory or Approval contract ID is missing in isUserAdmin");
      return {
        isMainAdmin: false,
        isMultiSigAdmin: false,
        hasAdminAccess: false,
      };
    }

    const factoryClient = new FactoryClient({
      contractId: factoryContractId,
      rpcUrl: SOROBAN_RPC_URL!,
      networkPassphrase: Networks.TESTNET,
    });
    const adminTx = await factoryClient.get_admin();
    const adminSim = await adminTx.simulate();
    const contractAdmin = adminSim.result;

    const isMainAdmin = contractAdmin === userAddress;

    const approvalClient = new ApprovalClient({
      contractId: approvalContractId,
      rpcUrl: SOROBAN_RPC_URL!,
      networkPassphrase: Networks.TESTNET,
    });
    const signersTx = await approvalClient.get_signers();
    const signersSim = await signersTx.simulate();
    const multiSigAdmins: string[] = signersSim.result || [];

    const isMultiSigAdmin = multiSigAdmins.includes(userAddress);

    return {
      isMainAdmin,
      isMultiSigAdmin,
      hasAdminAccess: isMainAdmin || isMultiSigAdmin,
    };
  } catch (err) {
    console.error("Failed to query platform settings from contract:", err);
  }
  return {
    isMainAdmin: false,
    isMultiSigAdmin: false,
    hasAdminAccess: false,
  };
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
