import mongoose, { Schema, Document, Model } from "mongoose";

export interface IMilestone {
  id: number;
  amount: number;
  released: boolean;
  title?: string;
  description?: string;
  proof?: string;
}

export interface IProjectCache extends Document {
  projectId: string; // e.g., "1"
  vaultAddress: string;
  title: string;
  tagline: string;
  description: string;
  category: string;
  fundingGoal: number;
  currentFunding: number;
  fundingGoalRaw: string;
  currentFundingRaw: string;
  imageUrl: string;
  creator: string;
  creatorAddress: string;
  creatorAvatar: string;
  status:
    | "pending"
    | "approved"
    | "funded"
    | "rejected"
    | "featured"
    | "hidden"
    | "completed"
    | "expired"
    | "failed"
    | "refunding"
    | "raising"
    | "active";
  featured: boolean;
  fundingDeadline: number;
  isPublic: boolean;
  currencyType: "USDC" | "USDT" | "XLM" | "WBTC" | "WETH";
  bondAmount: number;
  bondPosted: boolean;
  releasedTotal: number;
  milestones: IMilestone[];
  createdAtOnChain: Date;
  metadataCid: string;
  lastUpdatedLedger: number;
}

const MilestoneSchema = new Schema<IMilestone>({
  id: { type: Number, required: true },
  amount: { type: Number, required: true },
  released: { type: Boolean, default: false },
  title: { type: String, default: "" },
  description: { type: String, default: "" },
  proof: { type: String, default: "" },
}, { _id: false });

const ProjectCacheSchema = new Schema<IProjectCache>(
  {
    projectId: { type: String, required: true, unique: true, index: true },
    vaultAddress: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    tagline: { type: String, default: "" },
    description: { type: String, default: "" },
    category: { type: String, default: "General" },
    fundingGoal: { type: Number, required: true },
    currentFunding: { type: Number, default: 0 },
    fundingGoalRaw: { type: String, required: true },
    currentFundingRaw: { type: String, default: "0" },
    imageUrl: { type: String, default: "" },
    creator: { type: String, default: "" },
    creatorAddress: { type: String, required: true, index: true },
    creatorAvatar: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "funded",
        "rejected",
        "featured",
        "hidden",
        "completed",
        "expired",
        "failed",
        "refunding",
        "raising",
        "active",
      ],
      default: "pending",
    },
    featured: { type: Boolean, default: false },
    fundingDeadline: { type: Number, required: true },
    isPublic: { type: Boolean, default: true },
    currencyType: {
      type: String,
      enum: ["USDC", "USDT", "XLM", "WBTC", "WETH"],
      default: "USDC",
    },
    bondAmount: { type: Number, default: 0 },
    bondPosted: { type: Boolean, default: false },
    releasedTotal: { type: Number, default: 0 },
    milestones: { type: [MilestoneSchema], default: [] },
    createdAtOnChain: { type: Date, required: true },
    metadataCid: { type: String, default: "" },
    lastUpdatedLedger: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const ProjectCache: Model<IProjectCache> =
  mongoose.models.ProjectCache ||
  mongoose.model<IProjectCache>("ProjectCache", ProjectCacheSchema);

export default ProjectCache;
