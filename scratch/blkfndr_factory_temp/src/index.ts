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
  11: {message:"NotInitialized"}
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


export interface CreateVaultConfig {
  approval_module: string;
  bond_amount: i128;
  creator: string;
  deadline: u64;
  goal: i128;
  identity_registry: string;
  metadata_cid: string;
  milestones: Array<Milestone>;
  token: string;
}

export type DataKey = {tag: "Admin", values: void} | {tag: "VaultWasmHash", values: void} | {tag: "ProjectVaultMap", values: readonly [u64]} | {tag: "ProjectCounter", values: void} | {tag: "FeeWalletAddress", values: void} | {tag: "FeePercentage", values: void} | {tag: "MinBondPercentage", values: void};

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the factory with an admin address, vault contract WASM hash, platform fee wallet, and platform fee percentage.
   */
  initialize: ({admin, vault_wasm_hash, fee_wallet, fee_percentage}: {admin: string, vault_wasm_hash: Buffer, fee_wallet: string, fee_percentage: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy and initialize a new project vault contract instance.
   */
  create_vault: ({config}: {config: CreateVaultConfig}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieve the registered vault address for the given project ID.
   */
  get_vault: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a update_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the registered vault contract WASM hash.
   */
  update_wasm_hash: ({new_hash}: {new_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the platform fee payout destination address.
   */
  update_fee_wallet: ({new_fee_wallet}: {new_fee_wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_fee_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the platform fee percentage (safety ceiling of 10.0% / 1000 bps).
   */
  update_fee_percentage: ({new_percentage}: {new_percentage: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_bond_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the minimum performance bond percentage (basis points, e.g. 500 = 5.00%).
   */
  update_bond_percentage: ({new_percentage}: {new_percentage: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_wallet: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_fee_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_percentage: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_bond_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_bond_percentage: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAAwAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAACU1pbGVzdG9uZQAAAAAAAAMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAACaWQAAAAAAAQAAAAAAAAACHJlbGVhc2VkAAAAAQ==",
        "AAAAAQAAAAAAAAAAAAAAD1ZhdWx0SW5pdENvbmZpZwAAAAANAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAD2FwcHJvdmFsX21vZHVsZQAAAAATAAAAAAAAAAtib25kX2Ftb3VudAAAAAALAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAOZmVlX3BlcmNlbnRhZ2UAAAAAAAYAAAAAAAAAEmZlZV93YWxsZXRfYWRkcmVzcwAAAAAAEwAAAAAAAAAEZ29hbAAAAAsAAAAAAAAAEWlkZW50aXR5X3JlZ2lzdHJ5AAAAAAAAEwAAAAAAAAAMbWV0YWRhdGFfY2lkAAAAEAAAAAAAAAAKbWlsZXN0b25lcwAAAAAD6gAAB9AAAAAJTWlsZXN0b25lAAAAAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAAV0b2tlbgAAAAAAABM=",
        "AAAAAQAAAAAAAAAAAAAAEUNyZWF0ZVZhdWx0Q29uZmlnAAAAAAAACQAAAAAAAAAPYXBwcm92YWxfbW9kdWxlAAAAABMAAAAAAAAAC2JvbmRfYW1vdW50AAAAAAsAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAARnb2FsAAAACwAAAAAAAAARaWRlbnRpdHlfcmVnaXN0cnkAAAAAAAATAAAAAAAAAAxtZXRhZGF0YV9jaWQAAAAQAAAAAAAAAAptaWxlc3RvbmVzAAAAAAPqAAAH0AAAAAlNaWxlc3RvbmUAAAAAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAANVmF1bHRXYXNtSGFzaAAAAAAAAAEAAAAAAAAAD1Byb2plY3RWYXVsdE1hcAAAAAABAAAABgAAAAAAAAAAAAAADlByb2plY3RDb3VudGVyAAAAAAAAAAAAAAAAABBGZWVXYWxsZXRBZGRyZXNzAAAAAAAAAAAAAAANRmVlUGVyY2VudGFnZQAAAAAAAAAAAAAAAAAAEU1pbkJvbmRQZXJjZW50YWdlAAAA",
        "AAAAAAAAAHlJbml0aWFsaXplIHRoZSBmYWN0b3J5IHdpdGggYW4gYWRtaW4gYWRkcmVzcywgdmF1bHQgY29udHJhY3QgV0FTTSBoYXNoLCBwbGF0Zm9ybSBmZWUgd2FsbGV0LCBhbmQgcGxhdGZvcm0gZmVlIHBlcmNlbnRhZ2UuAAAAAAAACmluaXRpYWxpemUAAAAAAAQAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAPdmF1bHRfd2FzbV9oYXNoAAAAA+4AAAAgAAAAAAAAAApmZWVfd2FsbGV0AAAAAAATAAAAAAAAAA5mZWVfcGVyY2VudGFnZQAAAAAABgAAAAA=",
        "AAAAAAAAADxEZXBsb3kgYW5kIGluaXRpYWxpemUgYSBuZXcgcHJvamVjdCB2YXVsdCBjb250cmFjdCBpbnN0YW5jZS4AAAAMY3JlYXRlX3ZhdWx0AAAAAQAAAAAAAAAGY29uZmlnAAAAAAfQAAAAEUNyZWF0ZVZhdWx0Q29uZmlnAAAAAAAAAQAAABM=",
        "AAAAAAAAAD9SZXRyaWV2ZSB0aGUgcmVnaXN0ZXJlZCB2YXVsdCBhZGRyZXNzIGZvciB0aGUgZ2l2ZW4gcHJvamVjdCBJRC4AAAAACWdldF92YXVsdAAAAAAAAAEAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAABAAAAEw==",
        "AAAAAAAAAC9VcGRhdGUgdGhlIHJlZ2lzdGVyZWQgdmF1bHQgY29udHJhY3QgV0FTTSBoYXNoLgAAAAAQdXBkYXRlX3dhc21faGFzaAAAAAEAAAAAAAAACG5ld19oYXNoAAAD7gAAACAAAAAA",
        "AAAAAAAAADNVcGRhdGUgdGhlIHBsYXRmb3JtIGZlZSBwYXlvdXQgZGVzdGluYXRpb24gYWRkcmVzcy4AAAAAEXVwZGF0ZV9mZWVfd2FsbGV0AAAAAAAAAQAAAAAAAAAObmV3X2ZlZV93YWxsZXQAAAAAABMAAAAA",
        "AAAAAAAAAEhVcGRhdGUgdGhlIHBsYXRmb3JtIGZlZSBwZXJjZW50YWdlIChzYWZldHkgY2VpbGluZyBvZiAxMC4wJSAvIDEwMDAgYnBzKS4AAAAVdXBkYXRlX2ZlZV9wZXJjZW50YWdlAAAAAAAAAQAAAAAAAAAObmV3X3BlcmNlbnRhZ2UAAAAAAAYAAAAA",
        "AAAAAAAAAFBVcGRhdGUgdGhlIG1pbmltdW0gcGVyZm9ybWFuY2UgYm9uZCBwZXJjZW50YWdlIChiYXNpcyBwb2ludHMsIGUuZy4gNTAwID0gNS4wMCUpLgAAABZ1cGRhdGVfYm9uZF9wZXJjZW50YWdlAAAAAAABAAAAAAAAAA5uZXdfcGVyY2VudGFnZQAAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAOZ2V0X2ZlZV93YWxsZXQAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAASZ2V0X2ZlZV9wZXJjZW50YWdlAAAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAATZ2V0X2JvbmRfcGVyY2VudGFnZQAAAAAAAAAAAQAAAAY=" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        create_vault: this.txFromJSON<string>,
        get_vault: this.txFromJSON<string>,
        update_wasm_hash: this.txFromJSON<null>,
        update_fee_wallet: this.txFromJSON<null>,
        update_fee_percentage: this.txFromJSON<null>,
        update_bond_percentage: this.txFromJSON<null>,
        get_admin: this.txFromJSON<string>,
        get_fee_wallet: this.txFromJSON<string>,
        get_fee_percentage: this.txFromJSON<u64>,
        get_bond_percentage: this.txFromJSON<u64>
  }
}