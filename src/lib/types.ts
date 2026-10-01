export type Project = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  category: string;
  fundingGoal: number;
  currentFunding: number;
  fundingGoalRaw?: string;
  currentFundingRaw?: string;
  imageUrl: string;
  creator: string;
  creatorAddress?: string;
  /** The linked profile's display name, or the address when none is linked. */
  creatorName?: string;
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
  featured?: boolean;
  createdAt?: string | null;
  creatorId?: string;
  fundingDeadline?: number;
  isPublic?: boolean;
  currencyType?: "USDC" | "USDT" | "XLM" | "WBTC" | "WETH";
  vaultAddress?: string;
  bondAmount?: number;
  bondPosted?: boolean;
  releasedTotal?: number;
  milestones?: {
    id: number;
    amount: number;
    released: boolean;
    title?: string;
    description?: string;
    proof?: string;
  }[];
  metadataCid?: string;
  /** Creator-supplied place description. A claim about location, not proof. */
  location?: string;
  /** Present only as a pair, enforced by a check constraint on the table. */
  locationLat?: number | null;
  locationLng?: number | null;
  /**
   * A platform hide or lock, or null for the ordinary unrestricted project.
   * Only ever present for a viewer who can see the project at all — RLS makes
   * the restriction exactly as visible as the listing it restricts.
   */
  restriction?: ProjectRestriction | null;
};

/**
 * Platform-level controls on a project. Neither touches the vault: the contract
 * has no pause switch, so these govern what this platform lists and which
 * transactions its interface will build.
 *
 *   hidden — off explore, search, the home page and direct links. Its builder,
 *            its stakeholders and the console still see it.
 *   locked — no new stakes, no opening milestone votes, no milestone proof.
 *            Refunds, stakeholder votes and carried releases are untouched.
 */
export type ProjectRestriction = {
  hidden: boolean;
  hiddenAt: string | null;
  hiddenReason: string;
  locked: boolean;
  lockedAt: string | null;
  lockedReason: string;
};

export type User = {
  uid: string;
  name: string;
  email: string;
  avatarUrl: string;
  creatorAvatar: string;
  role: "user" | "admin";
  wallet: "connected" | "disconnected";
  stellarPublicKey?: string;
};

// Re-exported, not restated. This was a second copy of the union and it had
// already drifted out of sync with the one that decides which token address a
// vault is built against.
export type { Currency } from "./currencies";

export type WebState = "static" | "functional" | "on-chain";

/**
 * InvestmentReceipt — Soulbound Token (SBT) minted on-chain when an investor
 * funds a project. Non-transferable; burnable only by the investor.
 */
export type FundReceipt = {
  fund_id: string;
  contributor: string;
  project_id: string;
  project_title: string;
  image_url: string;
  amount: string;
  usdc_amount: string;
  share_percentage: string;
  fee_paid: string;
  fund_date: number;
  timestamp?: string;
  currency_type?: string;
};

export type InvestmentReceipt = FundReceipt;
export type Investment = FundReceipt;

export type Notification = {
  id: string;
  userId: string;
  title: string;
  caption: string;
  timestamp: number;
  isRead: boolean;
  url?: string | null;
  object?: string | null;
};
