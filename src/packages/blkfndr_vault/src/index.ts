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
  3: {message:"ProjectNotFunded"},
  4: {message:"InsufficientFunds"},
  5: {message:"GoalAlreadyReached"},
  6: {message:"InvalidPercentage"},
  7: {message:"FundingDeadlinePassed"},
  9: {message:"NoFundsToRefund"},
  10: {message:"AlreadyInitialized"},
  11: {message:"NotInitialized"},
  12: {message:"KYCInvalid"},
  13: {message:"MilestoneNotFound"},
  14: {message:"MilestoneAlreadyReleased"}
}

export enum VaultState {
  Raising = 0,
  Funded = 1,
  Active = 2,
  Failed = 3,
  Refunding = 4,
  Completed = 5,
}


export interface Milestone {
  amount: i128;
  id: u32;
  released: boolean;
}


export interface VaultInitConfig {
  admin: string;
  approval_module: string;
  bond_amount: i128;
  creator: string;
  deadline: u64;
  fee_percentage: u64;
  fee_wallet_address: string;
  goal: i128;
  identity_registry: string;
  metadata_cid: string;
  milestones: Array<Milestone>;
  project_id: u64;
  token: string;
}


export interface ProjectInfo {
  admin: string;
  approval_module: string;
  bond_amount: i128;
  bond_posted: boolean;
  creator: string;
  deadline: u64;
  fee_percentage: u64;
  fee_wallet_address: string;
  goal: i128;
  identity_registry: string;
  metadata_cid: string;
  milestones: Array<Milestone>;
  project_id: u64;
  raised_amount: i128;
  released_total: i128;
  token: string;
}

export type DataKey = {tag: "State", values: void} | {tag: "Info", values: void} | {tag: "ContributorBalance", values: readonly [string]} | {tag: "Contributors", values: void};

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the vault contract instance with config parameters.
   */
  initialize: ({config}: {config: VaultInitConfig}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a post_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deposit the creator performance bond into the vault.
   */
  post_bond: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a contribute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a contribution deposit and charge platform fee.
   */
  contribute: ({contributor, amount}: {contributor: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a finalize_raise transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Evaluate raising progress and change status to Funded or Failed.
   */
  finalize_raise: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a release_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Release milestone tranche amount to creator if approved.
   */
  release_milestone: ({milestone_id}: {milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a slash_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transition contract to refunding state on default.
   */
  slash_bond: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a claim_refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Claim refund of contribution share.
   */
  claim_refund: ({contributor}: {contributor: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get current vault lifecycle state.
   */
  get_state: (options?: MethodOptions) => Promise<AssembledTransaction<VaultState>>

  /**
   * Construct and simulate a get_info transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get project vault configuration and stats.
   */
  get_info: (options?: MethodOptions) => Promise<AssembledTransaction<ProjectInfo>>

  /**
   * Construct and simulate a get_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get contribution balance of a backer.
   */
  get_balance: ({contributor}: {contributor: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADQAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAADUludmFsaWRTdGF0dXMAAAAAAAACAAAAAAAAABBQcm9qZWN0Tm90RnVuZGVkAAAAAwAAAAAAAAARSW5zdWZmaWNpZW50RnVuZHMAAAAAAAAEAAAAAAAAABJHb2FsQWxyZWFkeVJlYWNoZWQAAAAAAAUAAAAAAAAAEUludmFsaWRQZXJjZW50YWdlAAAAAAAABgAAAAAAAAAVRnVuZGluZ0RlYWRsaW5lUGFzc2VkAAAAAAAABwAAAAAAAAAPTm9GdW5kc1RvUmVmdW5kAAAAAAkAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAACktZQ0ludmFsaWQAAAAAAAwAAAAAAAAAEU1pbGVzdG9uZU5vdEZvdW5kAAAAAAAADQAAAAAAAAAYTWlsZXN0b25lQWxyZWFkeVJlbGVhc2VkAAAADg==",
        "AAAAAwAAAAAAAAAAAAAAClZhdWx0U3RhdGUAAAAAAAYAAAAAAAAAB1JhaXNpbmcAAAAAAAAAAAAAAAAGRnVuZGVkAAAAAAABAAAAAAAAAAZBY3RpdmUAAAAAAAIAAAAAAAAABkZhaWxlZAAAAAAAAwAAAAAAAAAJUmVmdW5kaW5nAAAAAAAABAAAAAAAAAAJQ29tcGxldGVkAAAAAAAABQ==",
        "AAAAAQAAAAAAAAAAAAAACU1pbGVzdG9uZQAAAAAAAAMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAACaWQAAAAAAAQAAAAAAAAACHJlbGVhc2VkAAAAAQ==",
        "AAAAAQAAAAAAAAAAAAAAD1ZhdWx0SW5pdENvbmZpZwAAAAANAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAD2FwcHJvdmFsX21vZHVsZQAAAAATAAAAAAAAAAtib25kX2Ftb3VudAAAAAALAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAOZmVlX3BlcmNlbnRhZ2UAAAAAAAYAAAAAAAAAEmZlZV93YWxsZXRfYWRkcmVzcwAAAAAAEwAAAAAAAAAEZ29hbAAAAAsAAAAAAAAAEWlkZW50aXR5X3JlZ2lzdHJ5AAAAAAAAEwAAAAAAAAAMbWV0YWRhdGFfY2lkAAAAEAAAAAAAAAAKbWlsZXN0b25lcwAAAAAD6gAAB9AAAAAJTWlsZXN0b25lAAAAAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAAV0b2tlbgAAAAAAABM=",
        "AAAAAQAAAAAAAAAAAAAAC1Byb2plY3RJbmZvAAAAABAAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAPYXBwcm92YWxfbW9kdWxlAAAAABMAAAAAAAAAC2JvbmRfYW1vdW50AAAAAAsAAAAAAAAAC2JvbmRfcG9zdGVkAAAAAAEAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAA5mZWVfcGVyY2VudGFnZQAAAAAABgAAAAAAAAASZmVlX3dhbGxldF9hZGRyZXNzAAAAAAATAAAAAAAAAARnb2FsAAAACwAAAAAAAAARaWRlbnRpdHlfcmVnaXN0cnkAAAAAAAATAAAAAAAAAAxtZXRhZGF0YV9jaWQAAAAQAAAAAAAAAAptaWxlc3RvbmVzAAAAAAPqAAAH0AAAAAlNaWxlc3RvbmUAAAAAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAAAAAADXJhaXNlZF9hbW91bnQAAAAAAAALAAAAAAAAAA5yZWxlYXNlZF90b3RhbAAAAAAACwAAAAAAAAAFdG9rZW4AAAAAAAAT",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAAAAAAAAAAABVN0YXRlAAAAAAAAAAAAAAAAAAAESW5mbwAAAAEAAAAAAAAAEkNvbnRyaWJ1dG9yQmFsYW5jZQAAAAAAAQAAABMAAAAAAAAAAAAAAAxDb250cmlidXRvcnM=",
        "AAAAAAAAAD5Jbml0aWFsaXplIHRoZSB2YXVsdCBjb250cmFjdCBpbnN0YW5jZSB3aXRoIGNvbmZpZyBwYXJhbWV0ZXJzLgAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA9WYXVsdEluaXRDb25maWcAAAAAAA==",
        "AAAAAAAAADREZXBvc2l0IHRoZSBjcmVhdG9yIHBlcmZvcm1hbmNlIGJvbmQgaW50byB0aGUgdmF1bHQuAAAACXBvc3RfYm9uZAAAAAAAAAAAAAAA",
        "AAAAAAAAADZSZWNvcmQgYSBjb250cmlidXRpb24gZGVwb3NpdCBhbmQgY2hhcmdlIHBsYXRmb3JtIGZlZS4AAAAAAApjb250cmlidXRlAAAAAAACAAAAAAAAAAtjb250cmlidXRvcgAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAEBFdmFsdWF0ZSByYWlzaW5nIHByb2dyZXNzIGFuZCBjaGFuZ2Ugc3RhdHVzIHRvIEZ1bmRlZCBvciBGYWlsZWQuAAAADmZpbmFsaXplX3JhaXNlAAAAAAAAAAAAAA==",
        "AAAAAAAAADhSZWxlYXNlIG1pbGVzdG9uZSB0cmFuY2hlIGFtb3VudCB0byBjcmVhdG9yIGlmIGFwcHJvdmVkLgAAABFyZWxlYXNlX21pbGVzdG9uZQAAAAAAAAEAAAAAAAAADG1pbGVzdG9uZV9pZAAAAAQAAAAA",
        "AAAAAAAAADJUcmFuc2l0aW9uIGNvbnRyYWN0IHRvIHJlZnVuZGluZyBzdGF0ZSBvbiBkZWZhdWx0LgAAAAAACnNsYXNoX2JvbmQAAAAAAAAAAAAA",
        "AAAAAAAAACNDbGFpbSByZWZ1bmQgb2YgY29udHJpYnV0aW9uIHNoYXJlLgAAAAAMY2xhaW1fcmVmdW5kAAAAAQAAAAAAAAALY29udHJpYnV0b3IAAAAAEwAAAAA=",
        "AAAAAAAAACJHZXQgY3VycmVudCB2YXVsdCBsaWZlY3ljbGUgc3RhdGUuAAAAAAAJZ2V0X3N0YXRlAAAAAAAAAAAAAAEAAAfQAAAAClZhdWx0U3RhdGUAAA==",
        "AAAAAAAAACpHZXQgcHJvamVjdCB2YXVsdCBjb25maWd1cmF0aW9uIGFuZCBzdGF0cy4AAAAAAAhnZXRfaW5mbwAAAAAAAAABAAAH0AAAAAtQcm9qZWN0SW5mbwA=",
        "AAAAAAAAACVHZXQgY29udHJpYnV0aW9uIGJhbGFuY2Ugb2YgYSBiYWNrZXIuAAAAAAAAC2dldF9iYWxhbmNlAAAAAAEAAAAAAAAAC2NvbnRyaWJ1dG9yAAAAABMAAAABAAAACw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        post_bond: this.txFromJSON<null>,
        contribute: this.txFromJSON<null>,
        finalize_raise: this.txFromJSON<null>,
        release_milestone: this.txFromJSON<null>,
        slash_bond: this.txFromJSON<null>,
        claim_refund: this.txFromJSON<null>,
        get_state: this.txFromJSON<VaultState>,
        get_info: this.txFromJSON<ProjectInfo>,
        get_balance: this.txFromJSON<i128>
  }
}