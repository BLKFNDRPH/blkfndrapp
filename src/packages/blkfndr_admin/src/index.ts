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
  12: {message:"AlreadyAnAdmin"},
  13: {message:"NotAnAdmin"},
  /**
   * The owner may not remove themselves, which would leave the roster with
   * nobody able to change it.
   */
  14: {message:"WouldOrphanRoster"}
}

export type DataKey = {tag: "Owner", values: void} | {tag: "Admins", values: void};

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Bind the roster to an owner, who becomes its first admin.
   * 
   * `owner` must authorise, so a deployed-but-unconfigured registry cannot
   * be claimed by whoever notices it first.
   */
  initialize: ({owner}: {owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a add_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_admin: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a remove_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_admin: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Hand the roster to a new owner, who is added as an admin if not already.
   */
  transfer_ownership: ({new_owner}: {new_owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_admin: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_admins transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admins: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_owner: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a admin_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABgAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAADkFscmVhZHlBbkFkbWluAAAAAAAMAAAAAAAAAApOb3RBbkFkbWluAAAAAAANAAAAYFRoZSBvd25lciBtYXkgbm90IHJlbW92ZSB0aGVtc2VsdmVzLCB3aGljaCB3b3VsZCBsZWF2ZSB0aGUgcm9zdGVyIHdpdGgKbm9ib2R5IGFibGUgdG8gY2hhbmdlIGl0LgAAABFXb3VsZE9ycGhhblJvc3RlcgAAAAAAAA4=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAAAAAArVGhlIGFjY291bnQgdGhhdCBtYXkgYWRkIGFuZCByZW1vdmUgYWRtaW5zLgAAAAAFT3duZXIAAAAAAAAAAAAAAAAAAAZBZG1pbnMAAA==",
        "AAAAAAAAAKlCaW5kIHRoZSByb3N0ZXIgdG8gYW4gb3duZXIsIHdobyBiZWNvbWVzIGl0cyBmaXJzdCBhZG1pbi4KCmBvd25lcmAgbXVzdCBhdXRob3Jpc2UsIHNvIGEgZGVwbG95ZWQtYnV0LXVuY29uZmlndXJlZCByZWdpc3RyeSBjYW5ub3QKYmUgY2xhaW1lZCBieSB3aG9ldmVyIG5vdGljZXMgaXQgZmlyc3QuAAAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAJYWRkX2FkbWluAAAAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAMcmVtb3ZlX2FkbWluAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
        "AAAAAAAAAEhIYW5kIHRoZSByb3N0ZXIgdG8gYSBuZXcgb3duZXIsIHdobyBpcyBhZGRlZCBhcyBhbiBhZG1pbiBpZiBub3QgYWxyZWFkeS4AAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAABAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAIaXNfYWRtaW4AAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAAKZ2V0X2FkbWlucwAAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAAAAAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAALYWRtaW5fY291bnQAAAAAAAAAAAEAAAAE" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        add_admin: this.txFromJSON<null>,
        remove_admin: this.txFromJSON<null>,
        transfer_ownership: this.txFromJSON<null>,
        is_admin: this.txFromJSON<boolean>,
        get_admins: this.txFromJSON<Array<string>>,
        get_owner: this.txFromJSON<string>,
        admin_count: this.txFromJSON<u32>
  }
}