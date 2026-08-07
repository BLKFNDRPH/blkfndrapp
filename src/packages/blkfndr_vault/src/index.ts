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
  1: {message:"NotAuthorized"},
  2: {message:"InvalidStatus"},
  4: {message:"InsufficientFunds"},
  5: {message:"GoalAlreadyReached"},
  6: {message:"InvalidConfiguration"},
  7: {message:"FundingDeadlinePassed"},
  9: {message:"NoFundsToRefund"},
  10: {message:"AlreadyInitialized"},
  11: {message:"NotInitialized"},
  12: {message:"KYCInvalid"},
  13: {message:"MilestoneNotFound"},
  14: {message:"MilestoneAlreadyReleased"},
  15: {message:"VotingNotOpen"},
  16: {message:"VotingAlreadyOpen"},
  17: {message:"VotingClosed"},
  18: {message:"AlreadyVoted"},
  19: {message:"NotAContributor"},
  20: {message:"ThresholdNotMet"},
  21: {message:"ThresholdMet"},
  22: {message:"VotingWindowNotElapsed"},
  23: {message:"MilestoneFailed"},
  24: {message:"BelowMinimumContribution"}
}

export enum VaultState {
  Raising = 0,
  Funded = 1,
  Active = 2,
  Failed = 3,
  Refunding = 4,
  Completed = 5,
}


/**
 * Milestone as supplied at creation.
 */
export interface MilestoneInput {
  amount: i128;
  id: u32;
}


/**
 * Milestone as tracked by the vault.
 */
export interface Milestone {
  amount: i128;
  /**
 * Running sum of the effective weight behind this milestone.
 */
approved_weight: i128;
  failed: boolean;
  id: u32;
  released: boolean;
  /**
 * Unix seconds the voting window opened; 0 when it has not opened.
 */
vote_opens_at: u64;
}


export interface VaultInitConfig {
  attestation_registry: string;
  bond_amount: i128;
  creator: string;
  deadline: u64;
  factory: string;
  fee_wallet_address: string;
  goal: i128;
  identity_registry: string;
  metadata_cid: string;
  milestones: Array<MilestoneInput>;
  min_contribution: i128;
  /**
 * Flat, charged once to the builder at creation. Never a percentage, and
 * never taken from contributor funds.
 */
platform_fee: i128;
  project_id: u64;
  token: string;
  /**
 * Seconds a milestone vote stays open once the builder opens it.
 */
voting_window_secs: u64;
}


export interface ProjectInfo {
  attestation_registry: string;
  attested: boolean;
  bond_amount: i128;
  bond_posted: boolean;
  bond_returned: boolean;
  creator: string;
  deadline: u64;
  factory: string;
  fee_wallet_address: string;
  goal: i128;
  identity_registry: string;
  metadata_cid: string;
  milestones: Array<Milestone>;
  min_contribution: i128;
  platform_fee: i128;
  project_id: u64;
  raised_amount: i128;
  released_total: i128;
  token: string;
  /**
 * Contributions not yet refunded. Counts down as claims are made, so the
 * contract can tell when it is serving the final claimant and sweep the
 * rounding dust to them instead of stranding it.
 */
unclaimed_contributions: i128;
  voting_window_secs: u64;
}

export type DataKey = {tag: "State", values: void} | {tag: "Info", values: void} | {tag: "ContributorBalance", values: readonly [string]} | {tag: "Contributors", values: void} | {tag: "Vote", values: readonly [u32, string]};

/**
 * Mirrors blkfndr-attestation's outcome enum across the contract boundary.
 */
export enum Outcome {
  Completed = 0,
  FailedWithForfeiture = 1,
  FailedToFund = 2,
}

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Construct the vault and lock the builder's bond in the same call.
   * 
   * The bond is not a later step the builder can skip — the transfer happens
   * here, so a vault either exists with its bond locked or does not exist.
   */
  initialize: ({config}: {config: VaultInitConfig}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a contribute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Back the project. The amount contributed is also the voting weight it
   * carries, before the per-wallet cap is applied.
   */
  contribute: ({contributor, amount}: {contributor: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Persist a pending lifecycle transition. Permissionless — anyone may
   * settle a vault whose deadline has passed.
   */
  settle: (options?: MethodOptions) => Promise<AssembledTransaction<VaultState>>

  /**
   * Construct and simulate a return_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the bond to the builder after a project failed to reach its goal.
   * Permissionless: the builder should not need anyone's cooperation.
   */
  return_bond: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a open_milestone_vote transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Open the contributor vote on a milestone. Only the builder may start the
   * clock, and only once per milestone.
   */
  open_milestone_vote: ({milestone_id}: {milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a approve_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Vote to release a milestone. Weight is the amount contributed, capped at
   * 20% of the total raise.
   */
  approve_milestone: ({contributor, milestone_id}: {contributor: string, milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a release_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Release a milestone tranche to the builder. Permissionless: once
   * contributors have carried the vote, nobody can withhold execution.
   */
  release_milestone: ({milestone_id}: {milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a settle_lapsed_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settle a milestone whose voting window closed below threshold.
   * 
   * Permissionless and fail-closed: contributor inactivity fails the
   * milestone rather than defaulting to paying the builder. The bond is
   * forfeited and becomes claimable pro-rata alongside the remaining
   * contributions.
   */
  settle_lapsed_milestone: ({milestone_id}: {milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a claim_refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Claim a refund. Available when the project failed to fund, and when a
   * milestone failed — in which case the claim includes a pro-rata share of
   * the forfeited bond.
   */
  claim_refund: ({contributor}: {contributor: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Current lifecycle state. A true read: writes nothing, moves nothing.
   */
  get_state: (options?: MethodOptions) => Promise<AssembledTransaction<VaultState>>

  /**
   * Construct and simulate a get_info transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_info: (options?: MethodOptions) => Promise<AssembledTransaction<ProjectInfo>>

  /**
   * Construct and simulate a get_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_balance: ({contributor}: {contributor: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_contributors transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A page of contributors.
   * 
   * Paged rather than whole: a popular project accumulates contributors
   * without limit, and a call that materialises all of them eventually
   * exceeds the resource budget and starts failing — at which point the
   * entrypoint is useless exactly when the project is most active.
   * `limit` is clamped to MAX_PAGE.
   */
  get_contributors: ({offset, limit}: {offset: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a contributor_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total contributors, so a caller can page without guessing.
   */
  contributor_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_voting_weight transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The voting weight this wallet would carry, after the 20% cap.
   */
  get_voting_weight: ({contributor}: {contributor: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a has_voted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_voted: ({milestone_id, contributor}: {milestone_id: u32, contributor: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_milestone_vote transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Weight behind a milestone, the weight a release needs, and whether the
   * window is still open.
   */
  get_milestone_vote: ({milestone_id}: {milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [i128, i128, boolean]>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFgAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAADUludmFsaWRTdGF0dXMAAAAAAAACAAAAAAAAABFJbnN1ZmZpY2llbnRGdW5kcwAAAAAAAAQAAAAAAAAAEkdvYWxBbHJlYWR5UmVhY2hlZAAAAAAABQAAAAAAAAAUSW52YWxpZENvbmZpZ3VyYXRpb24AAAAGAAAAAAAAABVGdW5kaW5nRGVhZGxpbmVQYXNzZWQAAAAAAAAHAAAAAAAAAA9Ob0Z1bmRzVG9SZWZ1bmQAAAAACQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAAKAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAACwAAAAAAAAAKS1lDSW52YWxpZAAAAAAADAAAAAAAAAARTWlsZXN0b25lTm90Rm91bmQAAAAAAAANAAAAAAAAABhNaWxlc3RvbmVBbHJlYWR5UmVsZWFzZWQAAAAOAAAAAAAAAA1Wb3RpbmdOb3RPcGVuAAAAAAAADwAAAAAAAAARVm90aW5nQWxyZWFkeU9wZW4AAAAAAAAQAAAAAAAAAAxWb3RpbmdDbG9zZWQAAAARAAAAAAAAAAxBbHJlYWR5Vm90ZWQAAAASAAAAAAAAAA9Ob3RBQ29udHJpYnV0b3IAAAAAEwAAAAAAAAAPVGhyZXNob2xkTm90TWV0AAAAABQAAAAAAAAADFRocmVzaG9sZE1ldAAAABUAAAAAAAAAFlZvdGluZ1dpbmRvd05vdEVsYXBzZWQAAAAAABYAAAAAAAAAD01pbGVzdG9uZUZhaWxlZAAAAAAXAAAAAAAAABhCZWxvd01pbmltdW1Db250cmlidXRpb24AAAAY",
        "AAAAAwAAAAAAAAAAAAAAClZhdWx0U3RhdGUAAAAAAAYAAAAAAAAAB1JhaXNpbmcAAAAAAAAAAAAAAAAGRnVuZGVkAAAAAAABAAAAAAAAAAZBY3RpdmUAAAAAAAIAAAAAAAAABkZhaWxlZAAAAAAAAwAAAAAAAAAJUmVmdW5kaW5nAAAAAAAABAAAAAAAAAAJQ29tcGxldGVkAAAAAAAABQ==",
        "AAAAAQAAACJNaWxlc3RvbmUgYXMgc3VwcGxpZWQgYXQgY3JlYXRpb24uAAAAAAAAAAAADk1pbGVzdG9uZUlucHV0AAAAAAACAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAmlkAAAAAAAE",
        "AAAAAQAAACJNaWxlc3RvbmUgYXMgdHJhY2tlZCBieSB0aGUgdmF1bHQuAAAAAAAAAAAACU1pbGVzdG9uZQAAAAAAAAYAAAAAAAAABmFtb3VudAAAAAAACwAAADpSdW5uaW5nIHN1bSBvZiB0aGUgZWZmZWN0aXZlIHdlaWdodCBiZWhpbmQgdGhpcyBtaWxlc3RvbmUuAAAAAAAPYXBwcm92ZWRfd2VpZ2h0AAAAAAsAAAAAAAAABmZhaWxlZAAAAAAAAQAAAAAAAAACaWQAAAAAAAQAAAAAAAAACHJlbGVhc2VkAAAAAQAAAEBVbml4IHNlY29uZHMgdGhlIHZvdGluZyB3aW5kb3cgb3BlbmVkOyAwIHdoZW4gaXQgaGFzIG5vdCBvcGVuZWQuAAAADXZvdGVfb3BlbnNfYXQAAAAAAAAG",
        "AAAAAQAAAAAAAAAAAAAAD1ZhdWx0SW5pdENvbmZpZwAAAAAPAAAAAAAAABRhdHRlc3RhdGlvbl9yZWdpc3RyeQAAABMAAAAAAAAAC2JvbmRfYW1vdW50AAAAAAsAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAAdmYWN0b3J5AAAAABMAAAAAAAAAEmZlZV93YWxsZXRfYWRkcmVzcwAAAAAAEwAAAAAAAAAEZ29hbAAAAAsAAAAAAAAAEWlkZW50aXR5X3JlZ2lzdHJ5AAAAAAAAEwAAAAAAAAAMbWV0YWRhdGFfY2lkAAAAEAAAAAAAAAAKbWlsZXN0b25lcwAAAAAD6gAAB9AAAAAOTWlsZXN0b25lSW5wdXQAAAAAAAAAAAAQbWluX2NvbnRyaWJ1dGlvbgAAAAsAAABqRmxhdCwgY2hhcmdlZCBvbmNlIHRvIHRoZSBidWlsZGVyIGF0IGNyZWF0aW9uLiBOZXZlciBhIHBlcmNlbnRhZ2UsIGFuZApuZXZlciB0YWtlbiBmcm9tIGNvbnRyaWJ1dG9yIGZ1bmRzLgAAAAAADHBsYXRmb3JtX2ZlZQAAAAsAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAAAAAABXRva2VuAAAAAAAAEwAAAD5TZWNvbmRzIGEgbWlsZXN0b25lIHZvdGUgc3RheXMgb3BlbiBvbmNlIHRoZSBidWlsZGVyIG9wZW5zIGl0LgAAAAAAEnZvdGluZ193aW5kb3dfc2VjcwAAAAAABg==",
        "AAAAAQAAAAAAAAAAAAAAC1Byb2plY3RJbmZvAAAAABUAAAAAAAAAFGF0dGVzdGF0aW9uX3JlZ2lzdHJ5AAAAEwAAAAAAAAAIYXR0ZXN0ZWQAAAABAAAAAAAAAAtib25kX2Ftb3VudAAAAAALAAAAAAAAAAtib25kX3Bvc3RlZAAAAAABAAAAAAAAAA1ib25kX3JldHVybmVkAAAAAAAAAQAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAAB2ZhY3RvcnkAAAAAEwAAAAAAAAASZmVlX3dhbGxldF9hZGRyZXNzAAAAAAATAAAAAAAAAARnb2FsAAAACwAAAAAAAAARaWRlbnRpdHlfcmVnaXN0cnkAAAAAAAATAAAAAAAAAAxtZXRhZGF0YV9jaWQAAAAQAAAAAAAAAAptaWxlc3RvbmVzAAAAAAPqAAAH0AAAAAlNaWxlc3RvbmUAAAAAAAAAAAAAEG1pbl9jb250cmlidXRpb24AAAALAAAAAAAAAAxwbGF0Zm9ybV9mZWUAAAALAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAA1yYWlzZWRfYW1vdW50AAAAAAAACwAAAAAAAAAOcmVsZWFzZWRfdG90YWwAAAAAAAsAAAAAAAAABXRva2VuAAAAAAAAEwAAALtDb250cmlidXRpb25zIG5vdCB5ZXQgcmVmdW5kZWQuIENvdW50cyBkb3duIGFzIGNsYWltcyBhcmUgbWFkZSwgc28gdGhlCmNvbnRyYWN0IGNhbiB0ZWxsIHdoZW4gaXQgaXMgc2VydmluZyB0aGUgZmluYWwgY2xhaW1hbnQgYW5kIHN3ZWVwIHRoZQpyb3VuZGluZyBkdXN0IHRvIHRoZW0gaW5zdGVhZCBvZiBzdHJhbmRpbmcgaXQuAAAAABd1bmNsYWltZWRfY29udHJpYnV0aW9ucwAAAAALAAAAAAAAABJ2b3Rpbmdfd2luZG93X3NlY3MAAAAAAAY=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAABVN0YXRlAAAAAAAAAAAAAAAAAAAESW5mbwAAAAEAAAAAAAAAEkNvbnRyaWJ1dG9yQmFsYW5jZQAAAAAAAQAAABMAAAAAAAAAAAAAAAxDb250cmlidXRvcnMAAAABAAAANVdoZXRoZXIgYSBjb250cmlidXRvciBoYXMgdm90ZWQgb24gYSBnaXZlbiBtaWxlc3RvbmUuAAAAAAAABFZvdGUAAAACAAAABAAAABM=",
        "AAAAAwAAAEhNaXJyb3JzIGJsa2ZuZHItYXR0ZXN0YXRpb24ncyBvdXRjb21lIGVudW0gYWNyb3NzIHRoZSBjb250cmFjdCBib3VuZGFyeS4AAAAAAAAAB091dGNvbWUAAAAAAwAAAAAAAAAJQ29tcGxldGVkAAAAAAAAAAAAAAAAAAAURmFpbGVkV2l0aEZvcmZlaXR1cmUAAAABAAAAAAAAAAxGYWlsZWRUb0Z1bmQAAAAC",
        "AAAAAAAAANRDb25zdHJ1Y3QgdGhlIHZhdWx0IGFuZCBsb2NrIHRoZSBidWlsZGVyJ3MgYm9uZCBpbiB0aGUgc2FtZSBjYWxsLgoKVGhlIGJvbmQgaXMgbm90IGEgbGF0ZXIgc3RlcCB0aGUgYnVpbGRlciBjYW4gc2tpcCDigJQgdGhlIHRyYW5zZmVyIGhhcHBlbnMKaGVyZSwgc28gYSB2YXVsdCBlaXRoZXIgZXhpc3RzIHdpdGggaXRzIGJvbmQgbG9ja2VkIG9yIGRvZXMgbm90IGV4aXN0LgAAAAppbml0aWFsaXplAAAAAAABAAAAAAAAAAZjb25maWcAAAAAB9AAAAAPVmF1bHRJbml0Q29uZmlnAAAAAAA=",
        "AAAAAAAAAHRCYWNrIHRoZSBwcm9qZWN0LiBUaGUgYW1vdW50IGNvbnRyaWJ1dGVkIGlzIGFsc28gdGhlIHZvdGluZyB3ZWlnaHQgaXQKY2FycmllcywgYmVmb3JlIHRoZSBwZXItd2FsbGV0IGNhcCBpcyBhcHBsaWVkLgAAAApjb250cmlidXRlAAAAAAACAAAAAAAAAAtjb250cmlidXRvcgAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAG9QZXJzaXN0IGEgcGVuZGluZyBsaWZlY3ljbGUgdHJhbnNpdGlvbi4gUGVybWlzc2lvbmxlc3Mg4oCUIGFueW9uZSBtYXkKc2V0dGxlIGEgdmF1bHQgd2hvc2UgZGVhZGxpbmUgaGFzIHBhc3NlZC4AAAAABnNldHRsZQAAAAAAAAAAAAEAAAfQAAAAClZhdWx0U3RhdGUAAA==",
        "AAAAAAAAAIpSZXR1cm4gdGhlIGJvbmQgdG8gdGhlIGJ1aWxkZXIgYWZ0ZXIgYSBwcm9qZWN0IGZhaWxlZCB0byByZWFjaCBpdHMgZ29hbC4KUGVybWlzc2lvbmxlc3M6IHRoZSBidWlsZGVyIHNob3VsZCBub3QgbmVlZCBhbnlvbmUncyBjb29wZXJhdGlvbi4AAAAAAAtyZXR1cm5fYm9uZAAAAAAAAAAAAA==",
        "AAAAAAAAAGxPcGVuIHRoZSBjb250cmlidXRvciB2b3RlIG9uIGEgbWlsZXN0b25lLiBPbmx5IHRoZSBidWlsZGVyIG1heSBzdGFydCB0aGUKY2xvY2ssIGFuZCBvbmx5IG9uY2UgcGVyIG1pbGVzdG9uZS4AAAATb3Blbl9taWxlc3RvbmVfdm90ZQAAAAABAAAAAAAAAAxtaWxlc3RvbmVfaWQAAAAEAAAAAA==",
        "AAAAAAAAAGBWb3RlIHRvIHJlbGVhc2UgYSBtaWxlc3RvbmUuIFdlaWdodCBpcyB0aGUgYW1vdW50IGNvbnRyaWJ1dGVkLCBjYXBwZWQgYXQKMjAlIG9mIHRoZSB0b3RhbCByYWlzZS4AAAARYXBwcm92ZV9taWxlc3RvbmUAAAAAAAACAAAAAAAAAAtjb250cmlidXRvcgAAAAATAAAAAAAAAAxtaWxlc3RvbmVfaWQAAAAEAAAAAA==",
        "AAAAAAAAAINSZWxlYXNlIGEgbWlsZXN0b25lIHRyYW5jaGUgdG8gdGhlIGJ1aWxkZXIuIFBlcm1pc3Npb25sZXNzOiBvbmNlCmNvbnRyaWJ1dG9ycyBoYXZlIGNhcnJpZWQgdGhlIHZvdGUsIG5vYm9keSBjYW4gd2l0aGhvbGQgZXhlY3V0aW9uLgAAAAARcmVsZWFzZV9taWxlc3RvbmUAAAAAAAABAAAAAAAAAAxtaWxlc3RvbmVfaWQAAAAEAAAAAA==",
        "AAAAAAAAARRTZXR0bGUgYSBtaWxlc3RvbmUgd2hvc2Ugdm90aW5nIHdpbmRvdyBjbG9zZWQgYmVsb3cgdGhyZXNob2xkLgoKUGVybWlzc2lvbmxlc3MgYW5kIGZhaWwtY2xvc2VkOiBjb250cmlidXRvciBpbmFjdGl2aXR5IGZhaWxzIHRoZQptaWxlc3RvbmUgcmF0aGVyIHRoYW4gZGVmYXVsdGluZyB0byBwYXlpbmcgdGhlIGJ1aWxkZXIuIFRoZSBib25kIGlzCmZvcmZlaXRlZCBhbmQgYmVjb21lcyBjbGFpbWFibGUgcHJvLXJhdGEgYWxvbmdzaWRlIHRoZSByZW1haW5pbmcKY29udHJpYnV0aW9ucy4AAAAXc2V0dGxlX2xhcHNlZF9taWxlc3RvbmUAAAAAAQAAAAAAAAAMbWlsZXN0b25lX2lkAAAABAAAAAA=",
        "AAAAAAAAAKNDbGFpbSBhIHJlZnVuZC4gQXZhaWxhYmxlIHdoZW4gdGhlIHByb2plY3QgZmFpbGVkIHRvIGZ1bmQsIGFuZCB3aGVuIGEKbWlsZXN0b25lIGZhaWxlZCDigJQgaW4gd2hpY2ggY2FzZSB0aGUgY2xhaW0gaW5jbHVkZXMgYSBwcm8tcmF0YSBzaGFyZSBvZgp0aGUgZm9yZmVpdGVkIGJvbmQuAAAAAAxjbGFpbV9yZWZ1bmQAAAABAAAAAAAAAAtjb250cmlidXRvcgAAAAATAAAAAA==",
        "AAAAAAAAAERDdXJyZW50IGxpZmVjeWNsZSBzdGF0ZS4gQSB0cnVlIHJlYWQ6IHdyaXRlcyBub3RoaW5nLCBtb3ZlcyBub3RoaW5nLgAAAAlnZXRfc3RhdGUAAAAAAAAAAAAAAQAAB9AAAAAKVmF1bHRTdGF0ZQAA",
        "AAAAAAAAAAAAAAAIZ2V0X2luZm8AAAAAAAAAAQAAB9AAAAALUHJvamVjdEluZm8A",
        "AAAAAAAAAAAAAAALZ2V0X2JhbGFuY2UAAAAAAQAAAAAAAAALY29udHJpYnV0b3IAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAURBIHBhZ2Ugb2YgY29udHJpYnV0b3JzLgoKUGFnZWQgcmF0aGVyIHRoYW4gd2hvbGU6IGEgcG9wdWxhciBwcm9qZWN0IGFjY3VtdWxhdGVzIGNvbnRyaWJ1dG9ycwp3aXRob3V0IGxpbWl0LCBhbmQgYSBjYWxsIHRoYXQgbWF0ZXJpYWxpc2VzIGFsbCBvZiB0aGVtIGV2ZW50dWFsbHkKZXhjZWVkcyB0aGUgcmVzb3VyY2UgYnVkZ2V0IGFuZCBzdGFydHMgZmFpbGluZyDigJQgYXQgd2hpY2ggcG9pbnQgdGhlCmVudHJ5cG9pbnQgaXMgdXNlbGVzcyBleGFjdGx5IHdoZW4gdGhlIHByb2plY3QgaXMgbW9zdCBhY3RpdmUuCmBsaW1pdGAgaXMgY2xhbXBlZCB0byBNQVhfUEFHRS4AAAAQZ2V0X2NvbnRyaWJ1dG9ycwAAAAIAAAAAAAAABm9mZnNldAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAAT",
        "AAAAAAAAADpUb3RhbCBjb250cmlidXRvcnMsIHNvIGEgY2FsbGVyIGNhbiBwYWdlIHdpdGhvdXQgZ3Vlc3NpbmcuAAAAAAARY29udHJpYnV0b3JfY291bnQAAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAD1UaGUgdm90aW5nIHdlaWdodCB0aGlzIHdhbGxldCB3b3VsZCBjYXJyeSwgYWZ0ZXIgdGhlIDIwJSBjYXAuAAAAAAAAEWdldF92b3Rpbmdfd2VpZ2h0AAAAAAAAAQAAAAAAAAALY29udHJpYnV0b3IAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAJaGFzX3ZvdGVkAAAAAAAAAgAAAAAAAAAMbWlsZXN0b25lX2lkAAAABAAAAAAAAAALY29udHJpYnV0b3IAAAAAEwAAAAEAAAAB",
        "AAAAAAAAAFxXZWlnaHQgYmVoaW5kIGEgbWlsZXN0b25lLCB0aGUgd2VpZ2h0IGEgcmVsZWFzZSBuZWVkcywgYW5kIHdoZXRoZXIgdGhlCndpbmRvdyBpcyBzdGlsbCBvcGVuLgAAABJnZXRfbWlsZXN0b25lX3ZvdGUAAAAAAAEAAAAAAAAADG1pbGVzdG9uZV9pZAAAAAQAAAABAAAD7QAAAAMAAAALAAAACwAAAAE=" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        contribute: this.txFromJSON<null>,
        settle: this.txFromJSON<VaultState>,
        return_bond: this.txFromJSON<null>,
        open_milestone_vote: this.txFromJSON<null>,
        approve_milestone: this.txFromJSON<null>,
        release_milestone: this.txFromJSON<null>,
        settle_lapsed_milestone: this.txFromJSON<null>,
        claim_refund: this.txFromJSON<null>,
        get_state: this.txFromJSON<VaultState>,
        get_info: this.txFromJSON<ProjectInfo>,
        get_balance: this.txFromJSON<i128>,
        get_contributors: this.txFromJSON<Array<string>>,
        contributor_count: this.txFromJSON<u32>,
        get_voting_weight: this.txFromJSON<i128>,
        has_voted: this.txFromJSON<boolean>,
        get_milestone_vote: this.txFromJSON<readonly [i128, i128, boolean]>
  }
}