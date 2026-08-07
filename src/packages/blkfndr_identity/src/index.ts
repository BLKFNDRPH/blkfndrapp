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
  13: {message:"NotAttested"}
}

export type DataKey = {tag: "Admin", values: void} | {tag: "Attestation", values: readonly [string]};

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
   * Construct and simulate a attest transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a KYC attestation hash for an address.
   */
  attest: ({address, kyc_hash}: {address: string, kyc_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a revoke transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Revoke a KYC attestation for an address.
   */
  revoke: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABQAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAAD0FscmVhZHlBdHRlc3RlZAAAAAAMAAAAAAAAAAtOb3RBdHRlc3RlZAAAAAAN",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAAAAAAAAAAABUFkbWluAAAAAAAAAQAAAAAAAAALQXR0ZXN0YXRpb24AAAAAAQAAABM=",
        "AAAAAAAAANZJbml0aWFsaXplIHRoZSByZWdpc3RyeSB3aXRoIGFuIGFkbWluIGFkZHJlc3MuCgpgYWRtaW5gIG11c3QgYXV0aG9yaXNlOiB3aXRob3V0IGl0LCBhIGRlcGxveWVkLWJ1dC11bmNvbmZpZ3VyZWQgcmVnaXN0cnkKYmVsb25ncyB0byB3aG9ldmVyIGNhbGxzIHRoaXMgZmlyc3QsIGFuZCB3aG9ldmVyIGhvbGRzIGl0IGRlY2lkZXMgd2hvCmNvdW50cyBhcyBLWUMtYXBwcm92ZWQuAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAAC1SZWNvcmQgYSBLWUMgYXR0ZXN0YXRpb24gaGFzaCBmb3IgYW4gYWRkcmVzcy4AAAAAAAAGYXR0ZXN0AAAAAAACAAAAAAAAAAdhZGRyZXNzAAAAABMAAAAAAAAACGt5Y19oYXNoAAAD7gAAACAAAAAA",
        "AAAAAAAAAChSZXZva2UgYSBLWUMgYXR0ZXN0YXRpb24gZm9yIGFuIGFkZHJlc3MuAAAABnJldm9rZQAAAAAAAQAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAA==",
        "AAAAAAAAARJIYW5kIHRoZSByZWdpc3RyeSB0byBhIG5ldyBhZG1pbi4KCldpdGhvdXQgdGhpcyB0aGUgYWRtaW4gc2V0IGF0IGluaXRpYWxpemF0aW9uIHdvdWxkIGJlIHBlcm1hbmVudCwgYW5kIGEKbG9zdCBvciBjb21wcm9taXNlZCBrZXkgd291bGQgbWVhbiBubyBmdXJ0aGVyIEtZQyBhdHRlc3RhdGlvbiB3YXMKcG9zc2libGUgZm9yIHRoZSBsaWZlIG9mIHRoZSBjb250cmFjdCDigJQgcmVjb3ZlcmFibGUgb25seSBieSByZWRlcGxveWluZwphbmQgcmUtYXR0ZXN0aW5nIGV2ZXJ5IHVzZXIuAAAAAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAACdUaGUgYWNjb3VudCB0aGF0IG1heSBhdHRlc3QgYW5kIHJldm9rZS4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAADlDaGVjayBpZiB0aGUgYWRkcmVzcyBoYXMgYSB2YWxpZCBLWUMgYXR0ZXN0YXRpb24gb24gZmlsZS4AAAAAAAAPaXNfa3ljX2FwcHJvdmVkAAAAAAEAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAEAAAAB",
        "AAAAAAAAADhSZXRyaWV2ZSB0aGUgS1lDIGF0dGVzdGF0aW9uIGhhc2ggZm9yIHRoZSBnaXZlbiBhZGRyZXNzLgAAAA9nZXRfYXR0ZXN0YXRpb24AAAAAAQAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAQAAA+4AAAAg" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        attest: this.txFromJSON<null>,
        revoke: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        get_admin: this.txFromJSON<string>,
        is_kyc_approved: this.txFromJSON<boolean>,
        get_attestation: this.txFromJSON<Buffer>
  }
}