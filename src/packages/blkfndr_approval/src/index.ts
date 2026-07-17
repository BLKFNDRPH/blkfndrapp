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
  10: {message:"AlreadyInitialized"},
  11: {message:"NotInitialized"},
  12: {message:"InvalidThreshold"},
  13: {message:"NotASigner"},
  14: {message:"AlreadyApproved"},
  15: {message:"SignerAlreadyExists"},
  16: {message:"SignerNotFound"},
  17: {message:"ThresholdExceedsSigners"}
}

export type DataKey = {tag: "Admin", values: void} | {tag: "Signers", values: void} | {tag: "Threshold", values: void} | {tag: "MilestoneApproval", values: readonly [u64, u32]} | {tag: "SlashApproval", values: readonly [u64]};

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the approval module with an admin, list of signers, and threshold.
   */
  initialize: ({admin, signers, threshold}: {admin: string, signers: Array<string>, threshold: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a approve_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a signer's approval for a milestone in a project.
   */
  approve_milestone: ({signer, project_id, milestone_id}: {signer: string, project_id: u64, milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_approved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if a milestone has reached the required threshold of approvals.
   */
  is_approved: ({project_id, milestone_id}: {project_id: u64, milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a approve_slash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a signer's approval to slash a project's performance bond.
   */
  approve_slash: ({signer, project_id}: {signer: string, project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_slash_approved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if a slash request has reached the required threshold of approvals.
   */
  is_slash_approved: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a add_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add a new signer to the authorized multisig set.
   */
  add_signer: ({new_signer}: {new_signer: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a remove_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a signer from the authorized multisig set.
   */
  remove_signer: ({signer}: {signer: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_threshold transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the multisig threshold required for approval.
   */
  update_threshold: ({new_threshold}: {new_threshold: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_signers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_signers: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_threshold transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_threshold: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_milestone_approvals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_milestone_approvals: ({project_id, milestone_id}: {project_id: u64, milestone_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_slash_approvals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_slash_approvals: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAAEEludmFsaWRUaHJlc2hvbGQAAAAMAAAAAAAAAApOb3RBU2lnbmVyAAAAAAANAAAAAAAAAA9BbHJlYWR5QXBwcm92ZWQAAAAADgAAAAAAAAATU2lnbmVyQWxyZWFkeUV4aXN0cwAAAAAPAAAAAAAAAA5TaWduZXJOb3RGb3VuZAAAAAAAEAAAAAAAAAAXVGhyZXNob2xkRXhjZWVkc1NpZ25lcnMAAAAAEQ==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAHU2lnbmVycwAAAAAAAAAAAAAAAAlUaHJlc2hvbGQAAAAAAAABAAAAAAAAABFNaWxlc3RvbmVBcHByb3ZhbAAAAAAAAAIAAAAGAAAABAAAAAEAAAAAAAAADVNsYXNoQXBwcm92YWwAAAAAAAABAAAABg==",
        "AAAAAAAAAE1Jbml0aWFsaXplIHRoZSBhcHByb3ZhbCBtb2R1bGUgd2l0aCBhbiBhZG1pbiwgbGlzdCBvZiBzaWduZXJzLCBhbmQgdGhyZXNob2xkLgAAAAAAAAppbml0aWFsaXplAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB3NpZ25lcnMAAAAD6gAAABMAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAAA",
        "AAAAAAAAADhSZWNvcmQgYSBzaWduZXIncyBhcHByb3ZhbCBmb3IgYSBtaWxlc3RvbmUgaW4gYSBwcm9qZWN0LgAAABFhcHByb3ZlX21pbGVzdG9uZQAAAAAAAAMAAAAAAAAABnNpZ25lcgAAAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAMbWlsZXN0b25lX2lkAAAABAAAAAA=",
        "AAAAAAAAAEVDaGVjayBpZiBhIG1pbGVzdG9uZSBoYXMgcmVhY2hlZCB0aGUgcmVxdWlyZWQgdGhyZXNob2xkIG9mIGFwcHJvdmFscy4AAAAAAAALaXNfYXBwcm92ZWQAAAAAAgAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAMbWlsZXN0b25lX2lkAAAABAAAAAEAAAAB",
        "AAAAAAAAAEFSZWNvcmQgYSBzaWduZXIncyBhcHByb3ZhbCB0byBzbGFzaCBhIHByb2plY3QncyBwZXJmb3JtYW5jZSBib25kLgAAAAAAAA1hcHByb3ZlX3NsYXNoAAAAAAAAAgAAAAAAAAAGc2lnbmVyAAAAAAATAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAA==",
        "AAAAAAAAAElDaGVjayBpZiBhIHNsYXNoIHJlcXVlc3QgaGFzIHJlYWNoZWQgdGhlIHJlcXVpcmVkIHRocmVzaG9sZCBvZiBhcHByb3ZhbHMuAAAAAAAAEWlzX3NsYXNoX2FwcHJvdmVkAAAAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAEAAAAB",
        "AAAAAAAAADBBZGQgYSBuZXcgc2lnbmVyIHRvIHRoZSBhdXRob3JpemVkIG11bHRpc2lnIHNldC4AAAAKYWRkX3NpZ25lcgAAAAAAAQAAAAAAAAAKbmV3X3NpZ25lcgAAAAAAEwAAAAA=",
        "AAAAAAAAADFSZW1vdmUgYSBzaWduZXIgZnJvbSB0aGUgYXV0aG9yaXplZCBtdWx0aXNpZyBzZXQuAAAAAAAADXJlbW92ZV9zaWduZXIAAAAAAAABAAAAAAAAAAZzaWduZXIAAAAAABMAAAAA",
        "AAAAAAAAADRVcGRhdGUgdGhlIG11bHRpc2lnIHRocmVzaG9sZCByZXF1aXJlZCBmb3IgYXBwcm92YWwuAAAAEHVwZGF0ZV90aHJlc2hvbGQAAAABAAAAAAAAAA1uZXdfdGhyZXNob2xkAAAAAAAABAAAAAA=",
        "AAAAAAAAAAAAAAALZ2V0X3NpZ25lcnMAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAAAAAAANZ2V0X3RocmVzaG9sZAAAAAAAAAAAAAABAAAABA==",
        "AAAAAAAAAAAAAAAXZ2V0X21pbGVzdG9uZV9hcHByb3ZhbHMAAAAAAgAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAMbWlsZXN0b25lX2lkAAAABAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAAAAAAATZ2V0X3NsYXNoX2FwcHJvdmFscwAAAAABAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAQAAA+oAAAAT" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        approve_milestone: this.txFromJSON<null>,
        is_approved: this.txFromJSON<boolean>,
        approve_slash: this.txFromJSON<null>,
        is_slash_approved: this.txFromJSON<boolean>,
        add_signer: this.txFromJSON<null>,
        remove_signer: this.txFromJSON<null>,
        update_threshold: this.txFromJSON<null>,
        get_signers: this.txFromJSON<Array<string>>,
        get_threshold: this.txFromJSON<u32>,
        get_milestone_approvals: this.txFromJSON<Array<string>>,
        get_slash_approvals: this.txFromJSON<Array<string>>
  }
}