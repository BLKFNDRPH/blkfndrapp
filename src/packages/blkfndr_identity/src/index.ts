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
  12: {message:"AlreadyAttested"},
  13: {message:"NotAttested"},
  14: {message:"NotAnAttestor"},
  15: {message:"AlreadyAnAttestor"}
}

export type DataKey = {tag: "Attestor", values: readonly [string]} | {tag: "Admin", values: void} | {tag: "Attestation", values: readonly [string]};

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the registry with an admin address.
   * 
   * `admin` must authorise: without it, a deployed-but-unconfigured registry
   * belongs to whoever calls this first, and whoever holds it decides who
   * counts as KYC-approved.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a add_attestor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Authorise an address to attest. Admin only.
   */
  add_attestor: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a remove_attestor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Withdraw the authorisation. Admin only.
   * 
   * Attestations already written stay written. Someone leaving should not
   * silently un-verify everyone they ever approved — that would turn a
   * personnel change into a platform-wide identity outage.
   */
  remove_attestor: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_attestor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_attestor: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a attest transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a KYC attestation hash for an address.
   */
  attest: ({attestor, address, kyc_hash}: {attestor: string, address: string, kyc_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a revoke transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Revoke a KYC attestation for an address.
   */
  revoke: ({attestor, address}: {attestor: string, address: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Hand the registry to a new admin.
   * 
   * Without this the admin set at initialization would be permanent, and a
   * lost or compromised key would mean no further KYC attestation was
   * possible for the life of the contract — recoverable only by redeploying
   * and re-attesting every user.
   */
  transfer_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The account that may attest and revoke.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a is_kyc_approved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if the address has a valid KYC attestation on file.
   */
  is_kyc_approved: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieve the KYC attestation hash for the given address.
   */
  get_attestation: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABwAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAAD0FscmVhZHlBdHRlc3RlZAAAAAAMAAAAAAAAAAtOb3RBdHRlc3RlZAAAAAANAAAAAAAAAA1Ob3RBbkF0dGVzdG9yAAAAAAAADgAAAAAAAAARQWxyZWFkeUFuQXR0ZXN0b3IAAAAAAAAP",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAnYWRkcmVzcyAtPiBtYXkgYXR0ZXN0LiBBYnNlbnQgbWVhbnMgbm8uAAAAAAhBdHRlc3RvcgAAAAEAAAATAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAABAAAAAAAAAAtBdHRlc3RhdGlvbgAAAAABAAAAEw==",
        "AAAAAAAAANZJbml0aWFsaXplIHRoZSByZWdpc3RyeSB3aXRoIGFuIGFkbWluIGFkZHJlc3MuCgpgYWRtaW5gIG11c3QgYXV0aG9yaXNlOiB3aXRob3V0IGl0LCBhIGRlcGxveWVkLWJ1dC11bmNvbmZpZ3VyZWQgcmVnaXN0cnkKYmVsb25ncyB0byB3aG9ldmVyIGNhbGxzIHRoaXMgZmlyc3QsIGFuZCB3aG9ldmVyIGhvbGRzIGl0IGRlY2lkZXMgd2hvCmNvdW50cyBhcyBLWUMtYXBwcm92ZWQuAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAACtBdXRob3Jpc2UgYW4gYWRkcmVzcyB0byBhdHRlc3QuIEFkbWluIG9ubHkuAAAAAAxhZGRfYXR0ZXN0b3IAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAAA",
        "AAAAAAAAAOpXaXRoZHJhdyB0aGUgYXV0aG9yaXNhdGlvbi4gQWRtaW4gb25seS4KCkF0dGVzdGF0aW9ucyBhbHJlYWR5IHdyaXR0ZW4gc3RheSB3cml0dGVuLiBTb21lb25lIGxlYXZpbmcgc2hvdWxkIG5vdApzaWxlbnRseSB1bi12ZXJpZnkgZXZlcnlvbmUgdGhleSBldmVyIGFwcHJvdmVkIOKAlCB0aGF0IHdvdWxkIHR1cm4gYQpwZXJzb25uZWwgY2hhbmdlIGludG8gYSBwbGF0Zm9ybS13aWRlIGlkZW50aXR5IG91dGFnZS4AAAAAAA9yZW1vdmVfYXR0ZXN0b3IAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAALaXNfYXR0ZXN0b3IAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAC1SZWNvcmQgYSBLWUMgYXR0ZXN0YXRpb24gaGFzaCBmb3IgYW4gYWRkcmVzcy4AAAAAAAAGYXR0ZXN0AAAAAAADAAAAAAAAAAhhdHRlc3RvcgAAABMAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAIa3ljX2hhc2gAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAChSZXZva2UgYSBLWUMgYXR0ZXN0YXRpb24gZm9yIGFuIGFkZHJlc3MuAAAABnJldm9rZQAAAAAAAgAAAAAAAAAIYXR0ZXN0b3IAAAATAAAAAAAAAAdhZGRyZXNzAAAAABMAAAAA",
        "AAAAAAAAARJIYW5kIHRoZSByZWdpc3RyeSB0byBhIG5ldyBhZG1pbi4KCldpdGhvdXQgdGhpcyB0aGUgYWRtaW4gc2V0IGF0IGluaXRpYWxpemF0aW9uIHdvdWxkIGJlIHBlcm1hbmVudCwgYW5kIGEKbG9zdCBvciBjb21wcm9taXNlZCBrZXkgd291bGQgbWVhbiBubyBmdXJ0aGVyIEtZQyBhdHRlc3RhdGlvbiB3YXMKcG9zc2libGUgZm9yIHRoZSBsaWZlIG9mIHRoZSBjb250cmFjdCDigJQgcmVjb3ZlcmFibGUgb25seSBieSByZWRlcGxveWluZwphbmQgcmUtYXR0ZXN0aW5nIGV2ZXJ5IHVzZXIuAAAAAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAACdUaGUgYWNjb3VudCB0aGF0IG1heSBhdHRlc3QgYW5kIHJldm9rZS4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAADlDaGVjayBpZiB0aGUgYWRkcmVzcyBoYXMgYSB2YWxpZCBLWUMgYXR0ZXN0YXRpb24gb24gZmlsZS4AAAAAAAAPaXNfa3ljX2FwcHJvdmVkAAAAAAEAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAEAAAAB",
        "AAAAAAAAADhSZXRyaWV2ZSB0aGUgS1lDIGF0dGVzdGF0aW9uIGhhc2ggZm9yIHRoZSBnaXZlbiBhZGRyZXNzLgAAAA9nZXRfYXR0ZXN0YXRpb24AAAAAAQAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAQAAA+4AAAAg" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        add_attestor: this.txFromJSON<null>,
        remove_attestor: this.txFromJSON<null>,
        is_attestor: this.txFromJSON<boolean>,
        attest: this.txFromJSON<null>,
        revoke: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        get_admin: this.txFromJSON<string>,
        is_kyc_approved: this.txFromJSON<boolean>,
        get_attestation: this.txFromJSON<Buffer>
  }
}