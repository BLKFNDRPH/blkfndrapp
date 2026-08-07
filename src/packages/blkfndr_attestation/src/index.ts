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
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"NotAVault"},
  4: {message:"AlreadyAttested"},
  5: {message:"RecordNotFound"},
  6: {message:"InvalidRecord"},
  7: {message:"UntrustedFactory"},
  8: {message:"FactoryAlreadyTrusted"},
  9: {message:"TooManyFactories"}
}

/**
 * How a project ended.
 */
export enum Outcome {
  Completed = 0,
  FailedWithForfeiture = 1,
  FailedToFund = 2,
}


/**
 * The permanent record of one project's outcome.
 */
export interface Attestation {
  bond_posted: i128;
  builder: string;
  closed_at: u64;
  milestones_approved: u32;
  milestones_total: u32;
  outcome: Outcome;
  project_id: u64;
  total_raised: i128;
  vault: string;
}

export type DataKey = {tag: "Admin", values: void} | {tag: "Factories", values: void} | {tag: "Record", values: readonly [u64]} | {tag: "BuilderProjects", values: readonly [string]};

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Bind the registry to the factory whose vaults may write records.
   * 
   * `admin` must authorize, so the binding cannot be front-run by whoever
   * notices the deployed-but-uninitialized contract first.
   */
  initialize: ({admin, factory}: {admin: string, factory: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a add_factory transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Trust an additional factory, so a platform upgrade keeps writing into
   * the same history.
   * 
   * Append-only by design. There is no counterpart that removes a factory,
   * because doing so would orphan every record its vaults had already
   * written — an admin could quietly erase a builder's history without
   * touching a single record.
   */
  add_factory: ({factory}: {factory: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a attest transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Write a project's closing record. Callable only by a vault the trusted
   * factory deployed, and only once per project.
   * 
   * Deliberately absent: any way to amend or remove what this writes.
   */
  attest: ({vault, factory, builder, project_id, outcome, total_raised, bond_posted, milestones_total, milestones_approved}: {vault: string, factory: string, builder: string, project_id: u64, outcome: Outcome, total_raised: i128, bond_posted: i128, milestones_total: u32, milestones_approved: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_record transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_record: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Attestation>>

  /**
   * Construct and simulate a has_record transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_record: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_builder_projects transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every project id this builder has closed, in the order they closed.
   */
  get_builder_projects: ({builder}: {builder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a get_builder_history transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A page of a builder's history. This is what a grant programme, lender,
   * or launchpad reads to decide whether to take someone on.
   * 
   * Paged rather than whole: a builder's record only ever grows, so a call
   * that materialises all of it would eventually exceed the resource budget
   * and fail for exactly the builders with the longest track record.
   * `limit` is clamped to MAX_PAGE.
   */
  get_builder_history: ({builder, offset, limit}: {builder: string, offset: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Attestation>>>

  /**
   * Construct and simulate a get_builder_summary transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Compact reputation summary: (completed, failed_with_forfeiture, failed_to_fund).
   */
  get_builder_summary: ({builder}: {builder: string}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [u32, u32, u32]>>

  /**
   * Construct and simulate a get_factories transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_factories: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a is_factory_trusted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_factory_trusted: ({factory}: {factory: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAJTm90QVZhdWx0AAAAAAAAAwAAAAAAAAAPQWxyZWFkeUF0dGVzdGVkAAAAAAQAAAAAAAAADlJlY29yZE5vdEZvdW5kAAAAAAAFAAAAAAAAAA1JbnZhbGlkUmVjb3JkAAAAAAAABgAAAAAAAAAQVW50cnVzdGVkRmFjdG9yeQAAAAcAAAAAAAAAFUZhY3RvcnlBbHJlYWR5VHJ1c3RlZAAAAAAAAAgAAAAAAAAAEFRvb01hbnlGYWN0b3JpZXMAAAAJ",
        "AAAAAwAAABRIb3cgYSBwcm9qZWN0IGVuZGVkLgAAAAAAAAAHT3V0Y29tZQAAAAADAAAAOkV2ZXJ5IG1pbGVzdG9uZSB3YXMgYXBwcm92ZWQgYnkgY29udHJpYnV0b3JzIGFuZCByZWxlYXNlZC4AAAAAAAlDb21wbGV0ZWQAAAAAAAAAAAAAR0EgbWlsZXN0b25lIGZhaWxlZDsgdGhlIHBlcmZvcm1hbmNlIGJvbmQgd2FzIGZvcmZlaXRlZCB0byBjb250cmlidXRvcnMuAAAAABRGYWlsZWRXaXRoRm9yZmVpdHVyZQAAAAEAAACJVGhlIGZ1bmRpbmcgZ29hbCB3YXMgbmV2ZXIgbWV0OyBjb250cmlidXRpb25zIHdlcmUgcmV0dXJuZWQgYW5kIHRoZSBib25kCndlbnQgYmFjayB0byB0aGUgYnVpbGRlci4gTm8gZmF1bHQgYXR0YWNoZXMgdG8gdGhlIGJ1aWxkZXIgaGVyZS4AAAAAAAAMRmFpbGVkVG9GdW5kAAAAAg==",
        "AAAAAQAAAC5UaGUgcGVybWFuZW50IHJlY29yZCBvZiBvbmUgcHJvamVjdCdzIG91dGNvbWUuAAAAAAAAAAAAC0F0dGVzdGF0aW9uAAAAAAkAAAAAAAAAC2JvbmRfcG9zdGVkAAAAAAsAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAAAAAAJY2xvc2VkX2F0AAAAAAAABgAAAAAAAAATbWlsZXN0b25lc19hcHByb3ZlZAAAAAAEAAAAAAAAABBtaWxlc3RvbmVzX3RvdGFsAAAABAAAAAAAAAAHb3V0Y29tZQAAAAfQAAAAB091dGNvbWUAAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAAx0b3RhbF9yYWlzZWQAAAALAAAAAAAAAAV2YXVsdAAAAAAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAAAAAA6TWF5IGFkZCB0cnVzdGVkIGZhY3Rvcmllcy4gRGVsaWJlcmF0ZWx5IGNhbm5vdCByZW1vdmUgb25lLgAAAAAABUFkbWluAAAAAAAAAAAAAaJGYWN0b3JpZXMgd2hvc2UgdmF1bHRzIGFyZSBwZXJtaXR0ZWQgdG8gd3JpdGUuCgpBIHNldCByYXRoZXIgdGhhbiBhIHNpbmdsZSBhZGRyZXNzIHNvIHRoYXQgYSBmYWN0b3J5IHVwZ3JhZGUgZG9lcyBub3QKb3JwaGFuIHRoZSBoaXN0b3J5OiBuZXcgdmF1bHRzIGNvbWUgZnJvbSBhIG5ldyBmYWN0b3J5LCBhbmQgaWYgdGhpcwpyZWdpc3RyeSBjb3VsZCBvbmx5IGV2ZXIgdHJ1c3QgdGhlIG9yaWdpbmFsIG9uZSwgYSBzZWNvbmQgcmVnaXN0cnkgd291bGQKYmUgbmVlZGVkIGFuZCBhIGJ1aWxkZXIncyByZWNvcmQgd291bGQgc3BsaXQgYWNyb3NzIHRoZSB0d28uIEEgcmVjb3JkCnRoYXQgZnJhZ21lbnRzIG9uIGV2ZXJ5IHBsYXRmb3JtIHVwZ3JhZGUgaXMgbm90IHBvcnRhYmxlLCB3aGljaCBpcyB0aGUKd2hvbGUgcG9pbnQgb2YgaXQuAAAAAAAJRmFjdG9yaWVzAAAAAAAAAQAAACNBdHRlc3RhdGlvbiBmb3IgYSBnaXZlbiBwcm9qZWN0IGlkLgAAAAAGUmVjb3JkAAAAAAABAAAABgAAAAEAAAAmRXZlcnkgcHJvamVjdCBpZCBhIGJ1aWxkZXIgaGFzIGNsb3NlZC4AAAAAAA9CdWlsZGVyUHJvamVjdHMAAAAAAQAAABM=",
        "AAAAAAAAAL5CaW5kIHRoZSByZWdpc3RyeSB0byB0aGUgZmFjdG9yeSB3aG9zZSB2YXVsdHMgbWF5IHdyaXRlIHJlY29yZHMuCgpgYWRtaW5gIG11c3QgYXV0aG9yaXplLCBzbyB0aGUgYmluZGluZyBjYW5ub3QgYmUgZnJvbnQtcnVuIGJ5IHdob2V2ZXIKbm90aWNlcyB0aGUgZGVwbG95ZWQtYnV0LXVuaW5pdGlhbGl6ZWQgY29udHJhY3QgZmlyc3QuAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdmYWN0b3J5AAAAABMAAAAA",
        "AAAAAAAAAUBUcnVzdCBhbiBhZGRpdGlvbmFsIGZhY3RvcnksIHNvIGEgcGxhdGZvcm0gdXBncmFkZSBrZWVwcyB3cml0aW5nIGludG8KdGhlIHNhbWUgaGlzdG9yeS4KCkFwcGVuZC1vbmx5IGJ5IGRlc2lnbi4gVGhlcmUgaXMgbm8gY291bnRlcnBhcnQgdGhhdCByZW1vdmVzIGEgZmFjdG9yeSwKYmVjYXVzZSBkb2luZyBzbyB3b3VsZCBvcnBoYW4gZXZlcnkgcmVjb3JkIGl0cyB2YXVsdHMgaGFkIGFscmVhZHkKd3JpdHRlbiDigJQgYW4gYWRtaW4gY291bGQgcXVpZXRseSBlcmFzZSBhIGJ1aWxkZXIncyBoaXN0b3J5IHdpdGhvdXQKdG91Y2hpbmcgYSBzaW5nbGUgcmVjb3JkLgAAAAthZGRfZmFjdG9yeQAAAAABAAAAAAAAAAdmYWN0b3J5AAAAABMAAAAA",
        "AAAAAAAAAAAAAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAALZXcml0ZSBhIHByb2plY3QncyBjbG9zaW5nIHJlY29yZC4gQ2FsbGFibGUgb25seSBieSBhIHZhdWx0IHRoZSB0cnVzdGVkCmZhY3RvcnkgZGVwbG95ZWQsIGFuZCBvbmx5IG9uY2UgcGVyIHByb2plY3QuCgpEZWxpYmVyYXRlbHkgYWJzZW50OiBhbnkgd2F5IHRvIGFtZW5kIG9yIHJlbW92ZSB3aGF0IHRoaXMgd3JpdGVzLgAAAAAABmF0dGVzdAAAAAAACQAAAAAAAAAFdmF1bHQAAAAAAAATAAAAAAAAAAdmYWN0b3J5AAAAABMAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAHb3V0Y29tZQAAAAfQAAAAB091dGNvbWUAAAAAAAAAAAx0b3RhbF9yYWlzZWQAAAALAAAAAAAAAAtib25kX3Bvc3RlZAAAAAALAAAAAAAAABBtaWxlc3RvbmVzX3RvdGFsAAAABAAAAAAAAAATbWlsZXN0b25lc19hcHByb3ZlZAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAKZ2V0X3JlY29yZAAAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAEAAAfQAAAAC0F0dGVzdGF0aW9uAA==",
        "AAAAAAAAAAAAAAAKaGFzX3JlY29yZAAAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAEAAAAB",
        "AAAAAAAAAENFdmVyeSBwcm9qZWN0IGlkIHRoaXMgYnVpbGRlciBoYXMgY2xvc2VkLCBpbiB0aGUgb3JkZXIgdGhleSBjbG9zZWQuAAAAABRnZXRfYnVpbGRlcl9wcm9qZWN0cwAAAAEAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAEAAAPqAAAABg==",
        "AAAAAAAAAXBBIHBhZ2Ugb2YgYSBidWlsZGVyJ3MgaGlzdG9yeS4gVGhpcyBpcyB3aGF0IGEgZ3JhbnQgcHJvZ3JhbW1lLCBsZW5kZXIsCm9yIGxhdW5jaHBhZCByZWFkcyB0byBkZWNpZGUgd2hldGhlciB0byB0YWtlIHNvbWVvbmUgb24uCgpQYWdlZCByYXRoZXIgdGhhbiB3aG9sZTogYSBidWlsZGVyJ3MgcmVjb3JkIG9ubHkgZXZlciBncm93cywgc28gYSBjYWxsCnRoYXQgbWF0ZXJpYWxpc2VzIGFsbCBvZiBpdCB3b3VsZCBldmVudHVhbGx5IGV4Y2VlZCB0aGUgcmVzb3VyY2UgYnVkZ2V0CmFuZCBmYWlsIGZvciBleGFjdGx5IHRoZSBidWlsZGVycyB3aXRoIHRoZSBsb25nZXN0IHRyYWNrIHJlY29yZC4KYGxpbWl0YCBpcyBjbGFtcGVkIHRvIE1BWF9QQUdFLgAAABNnZXRfYnVpbGRlcl9oaXN0b3J5AAAAAAMAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAAAAAAGb2Zmc2V0AAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6gAAB9AAAAALQXR0ZXN0YXRpb24A",
        "AAAAAAAAAFBDb21wYWN0IHJlcHV0YXRpb24gc3VtbWFyeTogKGNvbXBsZXRlZCwgZmFpbGVkX3dpdGhfZm9yZmVpdHVyZSwgZmFpbGVkX3RvX2Z1bmQpLgAAABNnZXRfYnVpbGRlcl9zdW1tYXJ5AAAAAAEAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAEAAAPtAAAAAwAAAAQAAAAEAAAABA==",
        "AAAAAAAAAAAAAAANZ2V0X2ZhY3RvcmllcwAAAAAAAAAAAAABAAAD6gAAABM=",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAASaXNfZmFjdG9yeV90cnVzdGVkAAAAAAABAAAAAAAAAAdmYWN0b3J5AAAAABMAAAABAAAAAQ==" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        add_factory: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        attest: this.txFromJSON<null>,
        get_record: this.txFromJSON<Attestation>,
        has_record: this.txFromJSON<boolean>,
        get_builder_projects: this.txFromJSON<Array<u64>>,
        get_builder_history: this.txFromJSON<Array<Attestation>>,
        get_builder_summary: this.txFromJSON<readonly [u32, u32, u32]>,
        get_factories: this.txFromJSON<Array<string>>,
        get_admin: this.txFromJSON<string>,
        is_factory_trusted: this.txFromJSON<boolean>
  }
}