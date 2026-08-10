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
  2: {message:"NotInitialized"},
  3: {message:"NotAVault"},
  4: {message:"AlreadyAttested"},
  5: {message:"RecordNotFound"},
  6: {message:"InvalidRecord"},
  7: {message:"UntrustedFactory"},
  8: {message:"FactoryAlreadyTrusted"},
  9: {message:"TooManyFactories"},
  10: {message:"FactoryNotTrusted"}
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

export type DataKey = {tag: "Admin", values: void} | {tag: "Factories", values: void} | {tag: "Record", values: readonly [string]} | {tag: "BuilderVaults", values: readonly [string]};

export interface Client {
  /**
   * Construct and simulate a add_factory transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Trust an additional factory, so a platform upgrade keeps writing into
   * the same history. Reversible with disable_factory.
   */
  add_factory: ({factory}: {factory: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a disable_factory transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Stop trusting a factory: its vaults may no longer write new records.
   * 
   * Safe, and here for containment. No read path consults the trusted set —
   * get_record, has_record and the builder history all read records directly
   * — so disabling a factory stops only its future writes; every record its
   * vaults already wrote stays intact and readable. Without this a compromised
   * factory key (which can point new vaults at malicious wasm) could mint
   * false records forever with no way to revoke it.
   */
  disable_factory: ({factory}: {factory: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
  get_record: ({vault}: {vault: string}, options?: MethodOptions) => Promise<AssembledTransaction<Attestation>>

  /**
   * Construct and simulate a has_record transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_record: ({vault}: {vault: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_builder_vaults transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every vault this builder has closed, in the order they closed. The
   * records themselves — read via get_builder_history — carry the project ids.
   */
  get_builder_vaults: ({builder}: {builder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

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
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin}: {admin: string},
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
    return ContractClient.deploy({admin}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAIAAAAAAAAACU5vdEFWYXVsdAAAAAAAAAMAAAAAAAAAD0FscmVhZHlBdHRlc3RlZAAAAAAEAAAAAAAAAA5SZWNvcmROb3RGb3VuZAAAAAAABQAAAAAAAAANSW52YWxpZFJlY29yZAAAAAAAAAYAAAAAAAAAEFVudHJ1c3RlZEZhY3RvcnkAAAAHAAAAAAAAABVGYWN0b3J5QWxyZWFkeVRydXN0ZWQAAAAAAAAIAAAAAAAAABBUb29NYW55RmFjdG9yaWVzAAAACQAAAAAAAAARRmFjdG9yeU5vdFRydXN0ZWQAAAAAAAAK",
        "AAAAAwAAABRIb3cgYSBwcm9qZWN0IGVuZGVkLgAAAAAAAAAHT3V0Y29tZQAAAAADAAAAOkV2ZXJ5IG1pbGVzdG9uZSB3YXMgYXBwcm92ZWQgYnkgY29udHJpYnV0b3JzIGFuZCByZWxlYXNlZC4AAAAAAAlDb21wbGV0ZWQAAAAAAAAAAAAAR0EgbWlsZXN0b25lIGZhaWxlZDsgdGhlIHBlcmZvcm1hbmNlIGJvbmQgd2FzIGZvcmZlaXRlZCB0byBjb250cmlidXRvcnMuAAAAABRGYWlsZWRXaXRoRm9yZmVpdHVyZQAAAAEAAACJVGhlIGZ1bmRpbmcgZ29hbCB3YXMgbmV2ZXIgbWV0OyBjb250cmlidXRpb25zIHdlcmUgcmV0dXJuZWQgYW5kIHRoZSBib25kCndlbnQgYmFjayB0byB0aGUgYnVpbGRlci4gTm8gZmF1bHQgYXR0YWNoZXMgdG8gdGhlIGJ1aWxkZXIgaGVyZS4AAAAAAAAMRmFpbGVkVG9GdW5kAAAAAg==",
        "AAAAAQAAAC5UaGUgcGVybWFuZW50IHJlY29yZCBvZiBvbmUgcHJvamVjdCdzIG91dGNvbWUuAAAAAAAAAAAAC0F0dGVzdGF0aW9uAAAAAAkAAAAAAAAAC2JvbmRfcG9zdGVkAAAAAAsAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAAAAAAJY2xvc2VkX2F0AAAAAAAABgAAAAAAAAATbWlsZXN0b25lc19hcHByb3ZlZAAAAAAEAAAAAAAAABBtaWxlc3RvbmVzX3RvdGFsAAAABAAAAAAAAAAHb3V0Y29tZQAAAAfQAAAAB091dGNvbWUAAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAAx0b3RhbF9yYWlzZWQAAAALAAAAAAAAAAV2YXVsdAAAAAAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAAAAAAmTWF5IGFkZCBhbmQgZGlzYWJsZSB0cnVzdGVkIGZhY3Rvcmllcy4AAAAAAAVBZG1pbgAAAAAAAAAAAAE/RmFjdG9yaWVzIHdob3NlIHZhdWx0cyBhcmUgcGVybWl0dGVkIHRvIHdyaXRlLgoKQSBzZXQgcmF0aGVyIHRoYW4gYSBzaW5nbGUgYWRkcmVzcyBzbyB0aGF0IGEgZmFjdG9yeSB1cGdyYWRlIGRvZXMgbm90Cm9ycGhhbiB0aGUgaGlzdG9yeTogbmV3IHZhdWx0cyBjb21lIGZyb20gYSBuZXcgZmFjdG9yeSwgYW5kIGlmIHRoaXMKcmVnaXN0cnkgY291bGQgb25seSBldmVyIHRydXN0IHRoZSBvcmlnaW5hbCBvbmUsIGEgc2Vjb25kIHJlZ2lzdHJ5IHdvdWxkCmJlIG5lZWRlZCBhbmQgYSBidWlsZGVyJ3MgcmVjb3JkIHdvdWxkIHNwbGl0IGFjcm9zcyB0aGUgdHdvLgAAAAAJRmFjdG9yaWVzAAAAAAAAAQAAAXNBdHRlc3RhdGlvbiBmb3IgYSBnaXZlbiB2YXVsdC4KCktleWVkIGJ5IHRoZSB2YXVsdCdzIGFkZHJlc3Mg4oCUIGdsb2JhbGx5IHVuaXF1ZSDigJQgcmF0aGVyIHRoYW4gYnkgcHJvamVjdAppZC4gUHJvamVjdCBpZHMgcmVzdGFydCBhdCAxIGluIGV2ZXJ5IGZhY3RvcnksIHNvIGtleWluZyByZWNvcmRzIGJ5IHRoZW0KY29sbGlkZXMgdGhlIG1vbWVudCBhIHNlY29uZCBmYWN0b3J5IGlzIHRydXN0ZWQ6IHRoZSBuZXcgZmFjdG9yeSdzCnByb2plY3QgMSB3b3VsZCBjbGFzaCB3aXRoIHRoZSBvcmlnaW5hbCdzLCBhbmQgdGhlIGNvbGxpZGluZyB2YXVsdCBjb3VsZApuZXZlciB3cml0ZSBpdHMgcmVjb3JkLCBhbmQgc28gY291bGQgbmV2ZXIgc2V0dGxlLgAAAAAGUmVjb3JkAAAAAAABAAAAEwAAAAEAAACCRXZlcnkgdmF1bHQgYSBidWlsZGVyIGhhcyBjbG9zZWQuIFZhdWx0cywgbm90IHByb2plY3QgaWRzLCBmb3IgdGhlIHNhbWUKdW5pcXVlbmVzcyByZWFzb247IGVhY2ggcmVjb3JkIGNhcnJpZXMgaXRzIG93biBwcm9qZWN0IGlkLgAAAAAADUJ1aWxkZXJWYXVsdHMAAAAAAAABAAAAEw==",
        "AAAAAAAAAi9CaW5kIHRoZSByZWdpc3RyeSB0byBpdHMgYWRtaW4sIGF0b21pY2FsbHkgYXQgZGVwbG95LgoKQSBjb25zdHJ1Y3RvciBydW5zIGluc2lkZSB0aGUgZGVwbG95IHRyYW5zYWN0aW9uLCBzbyB0aGUgcmVnaXN0cnkgaXMKbmV2ZXIgZGVwbG95ZWQtYnV0LXVuY29uZmlndXJlZCBmb3IgYSBmaXJzdCBjYWxsZXIgdG8gc2VpemUuIEl0IHRydXN0cwpubyBmYWN0b3J5IHlldDogdGhlIGRlcGxveWVyIHdpcmVzIHRoYXQgaW4gaW1tZWRpYXRlbHkgYWZ0ZXJ3YXJkcyB3aXRoCmBhZGRfZmFjdG9yeWAsIGFuIGFkbWluLWdhdGVkIGNhbGwuIFNwbGl0dGluZyB0aGUgZmFjdG9yeSBvdXQgb2YKY29uc3RydWN0aW9uIGlzIGFsc28gd2hhdCBicmVha3MgdGhlIGZhY3Rvcnk8LT5hdHRlc3RhdGlvbiBjeWNsZSDigJQgdGhlCmZhY3RvcnkgdGFrZXMgdGhpcyByZWdpc3RyeSdzIGFkZHJlc3MgaW4gaXRzIG93biBjb25zdHJ1Y3Rvciwgc28gdGhpcwpvbmUgY2Fubm90IGluIHR1cm4gZGVtYW5kIHRoZSBmYWN0b3J5J3MgYXQgZGVwbG95LiBgYWRtaW5gIG11c3QKYXV0aG9yaXNlIHRoZSBkZXBsb3kuAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAAHhUcnVzdCBhbiBhZGRpdGlvbmFsIGZhY3RvcnksIHNvIGEgcGxhdGZvcm0gdXBncmFkZSBrZWVwcyB3cml0aW5nIGludG8KdGhlIHNhbWUgaGlzdG9yeS4gUmV2ZXJzaWJsZSB3aXRoIGRpc2FibGVfZmFjdG9yeS4AAAALYWRkX2ZhY3RvcnkAAAAAAQAAAAAAAAAHZmFjdG9yeQAAAAATAAAAAA==",
        "AAAAAAAAAeNTdG9wIHRydXN0aW5nIGEgZmFjdG9yeTogaXRzIHZhdWx0cyBtYXkgbm8gbG9uZ2VyIHdyaXRlIG5ldyByZWNvcmRzLgoKU2FmZSwgYW5kIGhlcmUgZm9yIGNvbnRhaW5tZW50LiBObyByZWFkIHBhdGggY29uc3VsdHMgdGhlIHRydXN0ZWQgc2V0IOKAlApnZXRfcmVjb3JkLCBoYXNfcmVjb3JkIGFuZCB0aGUgYnVpbGRlciBoaXN0b3J5IGFsbCByZWFkIHJlY29yZHMgZGlyZWN0bHkK4oCUIHNvIGRpc2FibGluZyBhIGZhY3Rvcnkgc3RvcHMgb25seSBpdHMgZnV0dXJlIHdyaXRlczsgZXZlcnkgcmVjb3JkIGl0cwp2YXVsdHMgYWxyZWFkeSB3cm90ZSBzdGF5cyBpbnRhY3QgYW5kIHJlYWRhYmxlLiBXaXRob3V0IHRoaXMgYSBjb21wcm9taXNlZApmYWN0b3J5IGtleSAod2hpY2ggY2FuIHBvaW50IG5ldyB2YXVsdHMgYXQgbWFsaWNpb3VzIHdhc20pIGNvdWxkIG1pbnQKZmFsc2UgcmVjb3JkcyBmb3JldmVyIHdpdGggbm8gd2F5IHRvIHJldm9rZSBpdC4AAAAAD2Rpc2FibGVfZmFjdG9yeQAAAAABAAAAAAAAAAdmYWN0b3J5AAAAABMAAAAA",
        "AAAAAAAAAAAAAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAALZXcml0ZSBhIHByb2plY3QncyBjbG9zaW5nIHJlY29yZC4gQ2FsbGFibGUgb25seSBieSBhIHZhdWx0IHRoZSB0cnVzdGVkCmZhY3RvcnkgZGVwbG95ZWQsIGFuZCBvbmx5IG9uY2UgcGVyIHByb2plY3QuCgpEZWxpYmVyYXRlbHkgYWJzZW50OiBhbnkgd2F5IHRvIGFtZW5kIG9yIHJlbW92ZSB3aGF0IHRoaXMgd3JpdGVzLgAAAAAABmF0dGVzdAAAAAAACQAAAAAAAAAFdmF1bHQAAAAAAAATAAAAAAAAAAdmYWN0b3J5AAAAABMAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAHb3V0Y29tZQAAAAfQAAAAB091dGNvbWUAAAAAAAAAAAx0b3RhbF9yYWlzZWQAAAALAAAAAAAAAAtib25kX3Bvc3RlZAAAAAALAAAAAAAAABBtaWxlc3RvbmVzX3RvdGFsAAAABAAAAAAAAAATbWlsZXN0b25lc19hcHByb3ZlZAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAKZ2V0X3JlY29yZAAAAAAAAQAAAAAAAAAFdmF1bHQAAAAAAAATAAAAAQAAB9AAAAALQXR0ZXN0YXRpb24A",
        "AAAAAAAAAAAAAAAKaGFzX3JlY29yZAAAAAAAAQAAAAAAAAAFdmF1bHQAAAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAJFFdmVyeSB2YXVsdCB0aGlzIGJ1aWxkZXIgaGFzIGNsb3NlZCwgaW4gdGhlIG9yZGVyIHRoZXkgY2xvc2VkLiBUaGUKcmVjb3JkcyB0aGVtc2VsdmVzIOKAlCByZWFkIHZpYSBnZXRfYnVpbGRlcl9oaXN0b3J5IOKAlCBjYXJyeSB0aGUgcHJvamVjdCBpZHMuAAAAAAAAEmdldF9idWlsZGVyX3ZhdWx0cwAAAAAAAQAAAAAAAAAHYnVpbGRlcgAAAAATAAAAAQAAA+oAAAAT",
        "AAAAAAAAAXBBIHBhZ2Ugb2YgYSBidWlsZGVyJ3MgaGlzdG9yeS4gVGhpcyBpcyB3aGF0IGEgZ3JhbnQgcHJvZ3JhbW1lLCBsZW5kZXIsCm9yIGxhdW5jaHBhZCByZWFkcyB0byBkZWNpZGUgd2hldGhlciB0byB0YWtlIHNvbWVvbmUgb24uCgpQYWdlZCByYXRoZXIgdGhhbiB3aG9sZTogYSBidWlsZGVyJ3MgcmVjb3JkIG9ubHkgZXZlciBncm93cywgc28gYSBjYWxsCnRoYXQgbWF0ZXJpYWxpc2VzIGFsbCBvZiBpdCB3b3VsZCBldmVudHVhbGx5IGV4Y2VlZCB0aGUgcmVzb3VyY2UgYnVkZ2V0CmFuZCBmYWlsIGZvciBleGFjdGx5IHRoZSBidWlsZGVycyB3aXRoIHRoZSBsb25nZXN0IHRyYWNrIHJlY29yZC4KYGxpbWl0YCBpcyBjbGFtcGVkIHRvIE1BWF9QQUdFLgAAABNnZXRfYnVpbGRlcl9oaXN0b3J5AAAAAAMAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAAAAAAGb2Zmc2V0AAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6gAAB9AAAAALQXR0ZXN0YXRpb24A",
        "AAAAAAAAAFBDb21wYWN0IHJlcHV0YXRpb24gc3VtbWFyeTogKGNvbXBsZXRlZCwgZmFpbGVkX3dpdGhfZm9yZmVpdHVyZSwgZmFpbGVkX3RvX2Z1bmQpLgAAABNnZXRfYnVpbGRlcl9zdW1tYXJ5AAAAAAEAAAAAAAAAB2J1aWxkZXIAAAAAEwAAAAEAAAPtAAAAAwAAAAQAAAAEAAAABA==",
        "AAAAAAAAAAAAAAANZ2V0X2ZhY3RvcmllcwAAAAAAAAAAAAABAAAD6gAAABM=",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAASaXNfZmFjdG9yeV90cnVzdGVkAAAAAAABAAAAAAAAAAdmYWN0b3J5AAAAABMAAAABAAAAAQ==" ]),
      options
    )
  }
  public readonly fromJSON = {
    add_factory: this.txFromJSON<null>,
        disable_factory: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        attest: this.txFromJSON<null>,
        get_record: this.txFromJSON<Attestation>,
        has_record: this.txFromJSON<boolean>,
        get_builder_vaults: this.txFromJSON<Array<string>>,
        get_builder_history: this.txFromJSON<Array<Attestation>>,
        get_builder_summary: this.txFromJSON<readonly [u32, u32, u32]>,
        get_factories: this.txFromJSON<Array<string>>,
        get_admin: this.txFromJSON<string>,
        is_factory_trusted: this.txFromJSON<boolean>
  }
}