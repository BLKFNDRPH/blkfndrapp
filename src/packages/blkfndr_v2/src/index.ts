import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  0: {message:"NotAdmin"},
  1: {message:"NotMultiSig"},
  3: {message:"ProjectNotApproved"},
  4: {message:"InsufficientFunds"},
  5: {message:"GoalAlreadyReached"},
  6: {message:"InvalidPercentage"},
  7: {message:"NotProjectCreator"},
  8: {message:"ProjectNotFunded"},
  9: {message:"InvalidStatus"},
  10: {message:"InvalidCurrency"},
  11: {message:"ProjectHasFunds"},
  12: {message:"ProjectAlreadyFunded"},
  13: {message:"NotAuthorized"},
  14: {message:"AlreadyVoted"},
  15: {message:"InsufficientApprovals"},
  16: {message:"FundingDeadlinePassed"},
  17: {message:"ProjectMismatch"},
  18: {message:"NoFundsToRefund"},
  19: {message:"ProposalAlreadyExists"},
  20: {message:"IncorrectFee"},
  21: {message:"InvalidFee"},
  22: {message:"NotInitialized"},
  23: {message:"ProjectNotFound"},
  24: {message:"AlreadyInitialized"}
}

export type DataKey = {tag: "Platform", values: void} | {tag: "Project", values: readonly [u64]} | {tag: "Proposal", values: readonly [u64]} | {tag: "Receipt", values: readonly [u64]} | {tag: "ReceiptCounter", values: void} | {tag: "ProjectCounter", values: void} | {tag: "ProposalCounter", values: void} | {tag: "TokenAddress", values: readonly [CurrencyType]} | {tag: "UserInvestments", values: readonly [string]} | {tag: "ProjectFees", values: readonly [u64]};


export interface Project {
  blob_id: string;
  category: string;
  created_at: u64;
  creator: string;
  currency_type: CurrencyType;
  description: string;
  funding_deadline: u64;
  goal: u64;
  has_pending_withdrawal: boolean;
  id: u64;
  raised_amount: u64;
  status: ProjectStatus;
  tagline: string;
  title: string;
}


export interface Platform {
  admin: string;
  fee_percentage: u64;
  fee_wallet_address: string;
  multi_sig_admins: Array<string>;
  total_fees_collected: u64;
  bond_percentage?: u64;
}

export enum CurrencyType {
  XLM = 0,
  USDC = 1,
  USDT = 2,
  WBTC = 3,
  WETH = 4,
}


export interface AdminProposal {
  amount: u64;
  approvals: Array<string>;
  executed: boolean;
  project_id: u64;
  proposal_id: u64;
  proposer: string;
}

export enum ProjectStatus {
  Hidden = 0,
  Pending = 1,
  Rejected = 2,
  Approved = 3,
  Funded = 4,
  Completed = 5,
  Expired = 6,
}


export interface InvestmentReceipt {
  amount: u64;
  fee_paid: u64;
  investment_date: u64;
  investment_id: u64;
  investor: string;
  project_id: u64;
  share_percentage: u64;
}

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, fee_wallet_address, fee_percentage}: {admin: string, fee_wallet_address: string, fee_percentage: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update platform fee percentage (max 1000 bps = 10%).
   */
  update_fee: ({new_fee_bps}: {new_fee_bps: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a claim_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Claim raised funds after project is fully funded. Status transitions to Completed.
   */
  claim_funds: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get full project details.
   */
  get_project: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Project>>

  /**
   * Construct and simulate a fund_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  fund_project: ({investor, project_id, amount, currency_type}: {investor: string, project_id: u64, amount: u64, currency_type: CurrencyType}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_project: ({creator, title, tagline, description, category, goal, blob_id, currency_type, funding_deadline}: {creator: string, title: string, tagline: string, description: string, category: string, goal: u64, blob_id: string, currency_type: CurrencyType, funding_deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a register_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register_token: ({currency_type, token_address}: {currency_type: CurrencyType, token_address: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a reject_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin rejects a pending project, changing status to Rejected.
   */
  reject_project: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer primary admin role.
   */
  transfer_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a approve_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin approves a pending project, changing status to Approved.
   */
  approve_project: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a refund_investor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Refund investor if project expires without reaching goal.
   */
  refund_investor: ({project_id, investor}: {project_id: u64, investor: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a vote_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Multi-sig Admin votes to approve a withdrawal proposal.
   */
  vote_withdrawal: ({voter, proposal_id}: {voter: string, proposal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_all_projects transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * List all projects.
   */
  get_all_projects: (options?: MethodOptions) => Promise<AssembledTransaction<Array<Project>>>

  /**
   * Construct and simulate a get_platform_info transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get platform configuration.
   */
  get_platform_info: (options?: MethodOptions) => Promise<AssembledTransaction<Platform>>

  /**
   * Construct and simulate a update_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update platform fee wallet address.
   */
  update_fee_wallet: ({new_fee_wallet}: {new_fee_wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a donate_to_platform transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Donate directly to the platform.
   */
  donate_to_platform: ({donor, amount, currency_type, message}: {donor: string, amount: u64, currency_type: CurrencyType, message: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a execute_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Execute withdrawal after threshold of approvals met. Transfers funds to project creator.
   */
  execute_withdrawal: ({executor, proposal_id}: {executor: string, proposal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a propose_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Multi-sig Admin creates a withdrawal proposal for a funded project.
   */
  propose_withdrawal: ({proposer, project_id, amount}: {proposer: string, project_id: u64, amount: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a add_multi_sig_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add a new multi-sig admin.
   */
  add_multi_sig_admin: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_user_investments transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get all investments for an address.
   */
  get_user_investments: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<InvestmentReceipt>>>

  /**
   * Construct and simulate a get_pending_proposals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * List all pending admin proposals.
   */
  get_pending_proposals: (options?: MethodOptions) => Promise<AssembledTransaction<Array<AdminProposal>>>

  /**
   * Construct and simulate a update_project_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin updates project status manually, enforcing strict status transition guards.
   */
  update_project_status: ({project_id, new_status}: {project_id: u64, new_status: ProjectStatus}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_investment_receipt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get investment receipt details.
   */
  get_investment_receipt: ({investment_id}: {investment_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<InvestmentReceipt>>

  /**
   * Construct and simulate a get_projects_by_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Filter projects by status.
   */
  get_projects_by_status: ({status}: {status: ProjectStatus}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Project>>>

  /**
   * Construct and simulate a remove_multi_sig_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a multi-sig admin.
   */
  remove_multi_sig_admin: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAGAAAAAAAAAAITm90QWRtaW4AAAAAAAAAAAAAAAtOb3RNdWx0aVNpZwAAAAABAAAAAAAAABJQcm9qZWN0Tm90QXBwcm92ZWQAAAAAAAMAAAAAAAAAEUluc3VmZmljaWVudEZ1bmRzAAAAAAAABAAAAAAAAAASR29hbEFscmVhZHlSZWFjaGVkAAAAAAAFAAAAAAAAABFJbnZhbGlkUGVyY2VudGFnZQAAAAAAAAYAAAAAAAAAEU5vdFByb2plY3RDcmVhdG9yAAAAAAAABwAAAAAAAAAQUHJvamVjdE5vdEZ1bmRlZAAAAAgAAAAAAAAADUludmFsaWRTdGF0dXMAAAAAAAAJAAAAAAAAAA9JbnZhbGlkQ3VycmVuY3kAAAAACgAAAAAAAAAPUHJvamVjdEhhc0Z1bmRzAAAAAAsAAAAAAAAAFFByb2plY3RBbHJlYWR5RnVuZGVkAAAADAAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAA0AAAAAAAAADEFscmVhZHlWb3RlZAAAAA4AAAAAAAAAFUluc3VmZmljaWVudEFwcHJvdmFscwAAAAAAAA8AAAAAAAAAFUZ1bmRpbmdEZWFkbGluZVBhc3NlZAAAAAAAABAAAAAAAAAAD1Byb2plY3RNaXNtYXRjaAAAAAARAAAAAAAAAA9Ob0Z1bmRzVG9SZWZ1bmQAAAAAEgAAAAAAAAAVUHJvcG9zYWxBbHJlYWR5RXhpc3RzAAAAAAAAEwAAAAAAAAAMSW5jb3JyZWN0RmVlAAAAFAAAAAAAAAAKSW52YWxpZEZlZQAAAAAAFQAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAABYAAAAAAAAAD1Byb2plY3ROb3RGb3VuZAAAAAAXAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAABg=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACgAAAAAAAAAAAAAACFBsYXRmb3JtAAAAAQAAAAAAAAAHUHJvamVjdAAAAAABAAAABgAAAAEAAAAAAAAACFByb3Bvc2FsAAAAAQAAAAYAAAABAAAAAAAAAAdSZWNlaXB0AAAAAAEAAAAGAAAAAAAAAAAAAAAOUmVjZWlwdENvdW50ZXIAAAAAAAAAAAAAAAAADlByb2plY3RDb3VudGVyAAAAAAAAAAAAAAAAAA9Qcm9wb3NhbENvdW50ZXIAAAAAAQAAAAAAAAAMVG9rZW5BZGRyZXNzAAAAAQAAB9AAAAAMQ3VycmVuY3lUeXBlAAAAAQAAAAAAAAAPVXNlckludmVzdG1lbnRzAAAAAAEAAAATAAAAAQAAAAAAAAALUHJvamVjdEZlZXMAAAAAAQAAAAY=",
        "AAAAAQAAAAAAAAAAAAAAB1Byb2plY3QAAAAADgAAAAAAAAAHYmxvYl9pZAAAAAAQAAAAAAAAAAhjYXRlZ29yeQAAABAAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAANY3VycmVuY3lfdHlwZQAAAAAAB9AAAAAMQ3VycmVuY3lUeXBlAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAABBmdW5kaW5nX2RlYWRsaW5lAAAABgAAAAAAAAAEZ29hbAAAAAYAAAAAAAAAFmhhc19wZW5kaW5nX3dpdGhkcmF3YWwAAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAA1yYWlzZWRfYW1vdW50AAAAAAAABgAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADVByb2plY3RTdGF0dXMAAAAAAAAAAAAAB3RhZ2xpbmUAAAAAEAAAAAAAAAAFdGl0bGUAAAAAAAAQ",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAABJmZWVfd2FsbGV0X2FkZHJlc3MAAAAAABMAAAAAAAAADmZlZV9wZXJjZW50YWdlAAAAAAAGAAAAAA==",
        "AAAAAAAAADRVcGRhdGUgcGxhdGZvcm0gZmVlIHBlcmNlbnRhZ2UgKG1heCAxMDAwIGJwcyA9IDEwJSkuAAAACnVwZGF0ZV9mZWUAAAAAAAEAAAAAAAAAC25ld19mZWVfYnBzAAAAAAYAAAAA",
        "AAAAAQAAAAAAAAAAAAAACFBsYXRmb3JtAAAABQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA5mZWVfcGVyY2VudGFnZQAAAAAABgAAAAAAAAASZmVlX3dhbGxldF9hZGRyZXNzAAAAAAATAAAAAAAAABBtdWx0aV9zaWdfYWRtaW5zAAAD6gAAABMAAAAAAAAAFHRvdGFsX2ZlZXNfY29sbGVjdGVkAAAABg==",
        "AAAAAAAAAFJDbGFpbSByYWlzZWQgZnVuZHMgYWZ0ZXIgcHJvamVjdCBpcyBmdWxseSBmdW5kZWQuIFN0YXR1cyB0cmFuc2l0aW9ucyB0byBDb21wbGV0ZWQuAAAAAAALY2xhaW1fZnVuZHMAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAA=",
        "AAAAAAAAABlHZXQgZnVsbCBwcm9qZWN0IGRldGFpbHMuAAAAAAAAC2dldF9wcm9qZWN0AAAAAAEAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAABAAAH0AAAAAdQcm9qZWN0AA==",
        "AAAAAAAAAAAAAAAMZnVuZF9wcm9qZWN0AAAABAAAAAAAAAAIaW52ZXN0b3IAAAATAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAYAAAAAAAAADWN1cnJlbmN5X3R5cGUAAAAAAAfQAAAADEN1cnJlbmN5VHlwZQAAAAA=",
        "AAAAAAAAAAAAAAAOY3JlYXRlX3Byb2plY3QAAAAAAAkAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAd0YWdsaW5lAAAAABAAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAACGNhdGVnb3J5AAAAEAAAAAAAAAAEZ29hbAAAAAYAAAAAAAAAB2Jsb2JfaWQAAAAAEAAAAAAAAAANY3VycmVuY3lfdHlwZQAAAAAAB9AAAAAMQ3VycmVuY3lUeXBlAAAAAAAAABBmdW5kaW5nX2RlYWRsaW5lAAAABgAAAAEAAAAG",
        "AAAAAAAAAAAAAAAOcmVnaXN0ZXJfdG9rZW4AAAAAAAIAAAAAAAAADWN1cnJlbmN5X3R5cGUAAAAAAAfQAAAADEN1cnJlbmN5VHlwZQAAAAAAAAANdG9rZW5fYWRkcmVzcwAAAAAAABMAAAAA",
        "AAAAAAAAAD1BZG1pbiByZWplY3RzIGEgcGVuZGluZyBwcm9qZWN0LCBjaGFuZ2luZyBzdGF0dXMgdG8gUmVqZWN0ZWQuAAAAAAAADnJlamVjdF9wcm9qZWN0AAAAAAABAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAA==",
        "AAAAAAAAABxUcmFuc2ZlciBwcmltYXJ5IGFkbWluIHJvbGUuAAAADnRyYW5zZmVyX2FkbWluAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAwAAAAAAAAAAAAAADEN1cnJlbmN5VHlwZQAAAAUAAAAAAAAAA1hMTQAAAAAAAAAAAAAAAARVU0RDAAAAAQAAAAAAAAAEVVNEVAAAAAIAAAAAAAAABFdCVEMAAAADAAAAAAAAAARXRVRIAAAABA==",
        "AAAAAAAAAD5BZG1pbiBhcHByb3ZlcyBhIHBlbmRpbmcgcHJvamVjdCwgY2hhbmdpbmcgc3RhdHVzIHRvIEFwcHJvdmVkLgAAAAAAD2FwcHJvdmVfcHJvamVjdAAAAAABAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAA==",
        "AAAAAAAAADlSZWZ1bmQgaW52ZXN0b3IgaWYgcHJvamVjdCBleHBpcmVzIHdpdGhvdXQgcmVhY2hpbmcgZ29hbC4AAAAAAAAPcmVmdW5kX2ludmVzdG9yAAAAAAIAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAAAAAACGludmVzdG9yAAAAEwAAAAA=",
        "AAAAAAAAADdNdWx0aS1zaWcgQWRtaW4gdm90ZXMgdG8gYXBwcm92ZSBhIHdpdGhkcmF3YWwgcHJvcG9zYWwuAAAAAA92b3RlX3dpdGhkcmF3YWwAAAAAAgAAAAAAAAAFdm90ZXIAAAAAAAATAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAA==",
        "AAAAAQAAAAAAAAAAAAAADUFkbWluUHJvcG9zYWwAAAAAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAYAAAAAAAAACWFwcHJvdmFscwAAAAAAA+oAAAATAAAAAAAAAAhleGVjdXRlZAAAAAEAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAACHByb3Bvc2VyAAAAEw==",
        "AAAAAwAAAAAAAAAAAAAADVByb2plY3RTdGF0dXMAAAAAAAAHAAAAAAAAAAZIaWRkZW4AAAAAAAAAAAAAAAAAB1BlbmRpbmcAAAAAAQAAAAAAAAAIUmVqZWN0ZWQAAAACAAAAAAAAAAhBcHByb3ZlZAAAAAMAAAAAAAAABkZ1bmRlZAAAAAAABAAAAAAAAAAJQ29tcGxldGVkAAAAAAAABQAAAAAAAAAHRXhwaXJlZAAAAAAG",
        "AAAAAAAAABJMaXN0IGFsbCBwcm9qZWN0cy4AAAAAABBnZXRfYWxsX3Byb2plY3RzAAAAAAAAAAEAAAPqAAAH0AAAAAdQcm9qZWN0AA==",
        "AAAAAAAAABtHZXQgcGxhdGZvcm0gY29uZmlndXJhdGlvbi4AAAAAEWdldF9wbGF0Zm9ybV9pbmZvAAAAAAAAAAAAAAEAAAfQAAAACFBsYXRmb3Jt",
        "AAAAAAAAACNVcGRhdGUgcGxhdGZvcm0gZmVlIHdhbGxldCBhZGRyZXNzLgAAAAARdXBkYXRlX2ZlZV93YWxsZXQAAAAAAAABAAAAAAAAAA5uZXdfZmVlX3dhbGxldAAAAAAAEwAAAAA=",
        "AAAAAAAAACBEb25hdGUgZGlyZWN0bHkgdG8gdGhlIHBsYXRmb3JtLgAAABJkb25hdGVfdG9fcGxhdGZvcm0AAAAAAAQAAAAAAAAABWRvbm9yAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAAGAAAAAAAAAA1jdXJyZW5jeV90eXBlAAAAAAAH0AAAAAxDdXJyZW5jeVR5cGUAAAAAAAAAB21lc3NhZ2UAAAAAEAAAAAA=",
        "AAAAAAAAAFhFeGVjdXRlIHdpdGhkcmF3YWwgYWZ0ZXIgdGhyZXNob2xkIG9mIGFwcHJvdmFscyBtZXQuIFRyYW5zZmVycyBmdW5kcyB0byBwcm9qZWN0IGNyZWF0b3IuAAAAEmV4ZWN1dGVfd2l0aGRyYXdhbAAAAAAAAgAAAAAAAAAIZXhlY3V0b3IAAAATAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAA==",
        "AAAAAAAAAENNdWx0aS1zaWcgQWRtaW4gY3JlYXRlcyBhIHdpdGhkcmF3YWwgcHJvcG9zYWwgZm9yIGEgZnVuZGVkIHByb2plY3QuAAAAABJwcm9wb3NlX3dpdGhkcmF3YWwAAAAAAAMAAAAAAAAACHByb3Bvc2VyAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAGYW1vdW50AAAAAAAGAAAAAQAAAAY=",
        "AAAAAAAAABpBZGQgYSBuZXcgbXVsdGktc2lnIGFkbWluLgAAAAAAE2FkZF9tdWx0aV9zaWdfYWRtaW4AAAAAAQAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAA==",
        "AAAAAQAAAAAAAAAAAAAAEUludmVzdG1lbnRSZWNlaXB0AAAAAAAABwAAAAAAAAAGYW1vdW50AAAAAAAGAAAAAAAAAAhmZWVfcGFpZAAAAAYAAAAAAAAAD2ludmVzdG1lbnRfZGF0ZQAAAAAGAAAAAAAAAA1pbnZlc3RtZW50X2lkAAAAAAAABgAAAAAAAAAIaW52ZXN0b3IAAAATAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAABBzaGFyZV9wZXJjZW50YWdlAAAABg==",
        "AAAAAAAAACNHZXQgYWxsIGludmVzdG1lbnRzIGZvciBhbiBhZGRyZXNzLgAAAAAUZ2V0X3VzZXJfaW52ZXN0bWVudHMAAAABAAAAAAAAAAdhZGRyZXNzAAAAABMAAAABAAAD6gAAB9AAAAARSW52ZXN0bWVudFJlY2VpcHQAAAA=",
        "AAAAAAAAACFMaXN0IGFsbCBwZW5kaW5nIGFkbWluIHByb3Bvc2Fscy4AAAAAAAAVZ2V0X3BlbmRpbmdfcHJvcG9zYWxzAAAAAAAAAAAAAAEAAAPqAAAH0AAAAA1BZG1pblByb3Bvc2FsAAAA",
        "AAAAAAAAAFFBZG1pbiB1cGRhdGVzIHByb2plY3Qgc3RhdHVzIG1hbnVhbGx5LCBlbmZvcmNpbmcgc3RyaWN0IHN0YXR1cyB0cmFuc2l0aW9uIGd1YXJkcy4AAAAAAAAVdXBkYXRlX3Byb2plY3Rfc3RhdHVzAAAAAAAAAgAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAKbmV3X3N0YXR1cwAAAAAH0AAAAA1Qcm9qZWN0U3RhdHVzAAAAAAAAAA==",
        "AAAAAAAAAB9HZXQgaW52ZXN0bWVudCByZWNlaXB0IGRldGFpbHMuAAAAABZnZXRfaW52ZXN0bWVudF9yZWNlaXB0AAAAAAABAAAAAAAAAA1pbnZlc3RtZW50X2lkAAAAAAAABgAAAAEAAAfQAAAAEUludmVzdG1lbnRSZWNlaXB0AAAA",
        "AAAAAAAAABpGaWx0ZXIgcHJvamVjdHMgYnkgc3RhdHVzLgAAAAAAFmdldF9wcm9qZWN0c19ieV9zdGF0dXMAAAAAAAEAAAAAAAAABnN0YXR1cwAAAAAH0AAAAA1Qcm9qZWN0U3RhdHVzAAAAAAAAAQAAA+oAAAfQAAAAB1Byb2plY3QA",
        "AAAAAAAAABlSZW1vdmUgYSBtdWx0aS1zaWcgYWRtaW4uAAAAAAAAFnJlbW92ZV9tdWx0aV9zaWdfYWRtaW4AAAAAAAEAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        update_fee: this.txFromJSON<null>,
        claim_funds: this.txFromJSON<null>,
        get_project: this.txFromJSON<Project>,
        fund_project: this.txFromJSON<null>,
        create_project: this.txFromJSON<u64>,
        register_token: this.txFromJSON<null>,
        reject_project: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        approve_project: this.txFromJSON<null>,
        refund_investor: this.txFromJSON<null>,
        vote_withdrawal: this.txFromJSON<null>,
        get_all_projects: this.txFromJSON<Array<Project>>,
        get_platform_info: this.txFromJSON<Platform>,
        update_fee_wallet: this.txFromJSON<null>,
        donate_to_platform: this.txFromJSON<null>,
        execute_withdrawal: this.txFromJSON<null>,
        propose_withdrawal: this.txFromJSON<u64>,
        add_multi_sig_admin: this.txFromJSON<null>,
        get_user_investments: this.txFromJSON<Array<InvestmentReceipt>>,
        get_pending_proposals: this.txFromJSON<Array<AdminProposal>>,
        update_project_status: this.txFromJSON<null>,
        get_investment_receipt: this.txFromJSON<InvestmentReceipt>,
        get_projects_by_status: this.txFromJSON<Array<Project>>,
        remove_multi_sig_admin: this.txFromJSON<null>
  }
}