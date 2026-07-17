import {Address} from '@stellar/stellar-sdk';

    /**
 * Error Enum: Error
 */
export const Error = {
  0 : { message: "NotAdmin" },
  1 : { message: "NotMultiSig" },
  3 : { message: "ProjectNotApproved" },
  4 : { message: "InsufficientFunds" },
  5 : { message: "GoalAlreadyReached" },
  6 : { message: "InvalidPercentage" },
  7 : { message: "NotProjectCreator" },
  8 : { message: "ProjectNotFunded" },
  9 : { message: "InvalidStatus" },
  10 : { message: "InvalidCurrency" },
  11 : { message: "ProjectHasFunds" },
  12 : { message: "ProjectAlreadyFunded" },
  13 : { message: "NotAuthorized" },
  14 : { message: "AlreadyVoted" },
  15 : { message: "InsufficientApprovals" },
  16 : { message: "FundingDeadlinePassed" },
  17 : { message: "ProjectMismatch" },
  18 : { message: "NoFundsToRefund" },
  19 : { message: "ProposalAlreadyExists" },
  20 : { message: "IncorrectFee" },
  21 : { message: "InvalidFee" },
  22 : { message: "NotInitialized" },
  23 : { message: "ProjectNotFound" },
  24 : { message: "AlreadyInitialized" }
}

/**
 * Enum: Status
 */
export enum Status {
  /**
   * Enum Case: Hidden
   */
  Hidden = 0,
  /**
   * Enum Case: Pending
   */
  Pending = 1,
  /**
   * Enum Case: Rejected
   */
  Rejected = 2,
  /**
   * Enum Case: Approved
   */
  Approved = 3,
  /**
   * Enum Case: Funded
   */
  Funded = 4,
  /**
   * Enum Case: Completed
   */
  Completed = 5,
  /**
   * Enum Case: Expired
   */
  Expired = 6
}

/**
 * Union: DataKey
 */
 export type DataKey =
  { tag: "Platform"; values: void } |
  { tag: "Project"; values: readonly [bigint] } |
  { tag: "Proposal"; values: readonly [bigint] } |
  { tag: "Receipt"; values: readonly [bigint] } |
  { tag: "ReceiptCounter"; values: void };

/**
 * Struct: ShareRules
 */
export interface ShareRules {
  description: string;
  max_percentage: bigint;
  min_percentage: bigint;
}

/**
 * Struct: ProjectData
 */
export interface ProjectData {
  balance: bigint;
  blob_id: string;
  category: string;
  created_at: bigint;
  creator: string;
  currency_label: string;
  currency_token: string;
  description: string;
  funding_deadline: bigint;
  goal: bigint;
  has_pending_withdrawal: boolean;
  project_id: bigint;
  raised_amount: bigint;
  status: Status;
  tagline: string;
  title: string;
  token_id: bigint;
}

/**
 * Struct: ReceiptData
 */
export interface ReceiptData {
  amount: bigint;
  currency_label: string;
  fee_paid: bigint;
  image_url: string;
  investment_date: bigint;
  investor: string;
  project_id: bigint;
  project_title: string;
  receipt_id: bigint;
  share_percentage: bigint;
}

/**
 * Struct: PlatformData
 */
export interface PlatformData {
  admin: string;
  fee_percentage: bigint;
  fee_wallet_address: string;
  fee_wallet_email: string;
  multi_sig_admins: Array<string>;
  project_counter: bigint;
  share_rules: ShareRules;
  total_fees_collected: bigint;
}

/**
 * Struct: ProposalData
 */
export interface ProposalData {
  approvals: Array<string>;
  is_executed: boolean;
  project_id: bigint;
  required_votes: bigint;
}

/**
 * Struct: CreateProjectInput
 */
export interface CreateProjectInput {
  blob_id: string;
  category: string;
  currency_label: string;
  currency_token: string;
  description: string;
  funding_deadline: bigint;
  goal: bigint;
  is_public: boolean;
  tagline: string;
  title: string;
}
    