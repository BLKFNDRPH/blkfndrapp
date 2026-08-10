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
  11: {message:"NotInitialized"},
  12: {message:"BondBelowMinimum"},
  13: {message:"InvalidConfiguration"},
  14: {message:"VaultNotFound"}
}


export interface MilestoneInput {
  amount: i128;
  id: u32;
}


/**
 * What the vault is constructed with. Every platform address here comes from
 * factory storage, never from the caller.
 */
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
  platform_fee: i128;
  project_id: u64;
  token: string;
  voting_window_secs: u64;
}


/**
 * What a builder supplies. Deliberately has no field for the identity or
 * attestation registry.
 */
export interface CreateVaultConfig {
  bond_amount: i128;
  creator: string;
  deadline: u64;
  goal: i128;
  metadata_cid: string;
  milestones: Array<MilestoneInput>;
  token: string;
}

export type DataKey = {tag: "Admin", values: void} | {tag: "VaultWasmHash", values: void} | {tag: "ProjectVaultMap", values: readonly [u64]} | {tag: "ProjectCounter", values: void} | {tag: "FeeWalletAddress", values: void} | {tag: "PlatformFee", values: void} | {tag: "MinBondPercentage", values: void} | {tag: "IdentityRegistry", values: void} | {tag: "AttestationRegistry", values: void} | {tag: "VotingWindowSecs", values: void} | {tag: "MinContribution", values: void} | {tag: "IsVault", values: readonly [string]};

export interface Client {
  /**
   * Construct and simulate a create_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy a vault for a project and lock the builder's bond in the same
   * transaction.
   */
  create_vault: ({config}: {config: CreateVaultConfig}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a is_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether this factory deployed the given address. The attestation
   * registry calls this to decide whether a record is genuine.
   */
  is_vault: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_vault: ({project_id}: {project_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a update_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_wasm_hash: ({new_hash}: {new_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_fee_wallet: ({new_fee_wallet}: {new_fee_wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_platform_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the flat listing fee, in stroops. There is deliberately no
   * percentage-of-funds setting to reach for.
   */
  update_platform_fee: ({new_fee}: {new_fee: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_bond_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_bond_percentage: ({new_percentage}: {new_percentage: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_identity_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_identity_registry: ({new_registry}: {new_registry: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_voting_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_voting_window: ({new_window_secs}: {new_window_secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_min_contribution transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_min_contribution: ({new_minimum}: {new_minimum: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_wallet: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_platform_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_platform_fee: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_bond_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_bond_percentage: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_identity_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_identity_registry: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_attestation_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_attestation_registry: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_voting_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_voting_window: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_min_contribution transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_min_contribution: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_project_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_project_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, vault_wasm_hash, fee_wallet, platform_fee, identity_registry, attestation_registry, voting_window_secs, min_contribution}: {admin: string, vault_wasm_hash: Buffer, fee_wallet: string, platform_fee: i128, identity_registry: string, attestation_registry: string, voting_window_secs: u64, min_contribution: i128},
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
    return ContractClient.deploy({admin, vault_wasm_hash, fee_wallet, platform_fee, identity_registry, attestation_registry, voting_window_secs, min_contribution}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABQAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAALAAAAAAAAABBCb25kQmVsb3dNaW5pbXVtAAAADAAAAAAAAAAUSW52YWxpZENvbmZpZ3VyYXRpb24AAAANAAAAAAAAAA1WYXVsdE5vdEZvdW5kAAAAAAAADg==",
        "AAAAAQAAAAAAAAAAAAAADk1pbGVzdG9uZUlucHV0AAAAAAACAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAmlkAAAAAAAE",
        "AAAAAQAAAHJXaGF0IHRoZSB2YXVsdCBpcyBjb25zdHJ1Y3RlZCB3aXRoLiBFdmVyeSBwbGF0Zm9ybSBhZGRyZXNzIGhlcmUgY29tZXMgZnJvbQpmYWN0b3J5IHN0b3JhZ2UsIG5ldmVyIGZyb20gdGhlIGNhbGxlci4AAAAAAAAAAAAPVmF1bHRJbml0Q29uZmlnAAAAAA8AAAAAAAAAFGF0dGVzdGF0aW9uX3JlZ2lzdHJ5AAAAEwAAAAAAAAALYm9uZF9hbW91bnQAAAAACwAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAAB2ZhY3RvcnkAAAAAEwAAAAAAAAASZmVlX3dhbGxldF9hZGRyZXNzAAAAAAATAAAAAAAAAARnb2FsAAAACwAAAAAAAAARaWRlbnRpdHlfcmVnaXN0cnkAAAAAAAATAAAAAAAAAAxtZXRhZGF0YV9jaWQAAAAQAAAAAAAAAAptaWxlc3RvbmVzAAAAAAPqAAAH0AAAAA5NaWxlc3RvbmVJbnB1dAAAAAAAAAAAABBtaW5fY29udHJpYnV0aW9uAAAACwAAAAAAAAAMcGxhdGZvcm1fZmVlAAAACwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAABJ2b3Rpbmdfd2luZG93X3NlY3MAAAAAAAY=",
        "AAAAAQAAAFxXaGF0IGEgYnVpbGRlciBzdXBwbGllcy4gRGVsaWJlcmF0ZWx5IGhhcyBubyBmaWVsZCBmb3IgdGhlIGlkZW50aXR5IG9yCmF0dGVzdGF0aW9uIHJlZ2lzdHJ5LgAAAAAAAAARQ3JlYXRlVmF1bHRDb25maWcAAAAAAAAHAAAAAAAAAAtib25kX2Ftb3VudAAAAAALAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAEZ29hbAAAAAsAAAAAAAAADG1ldGFkYXRhX2NpZAAAABAAAAAAAAAACm1pbGVzdG9uZXMAAAAAA+oAAAfQAAAADk1pbGVzdG9uZUlucHV0AAAAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAANVmF1bHRXYXNtSGFzaAAAAAAAAAEAAAAAAAAAD1Byb2plY3RWYXVsdE1hcAAAAAABAAAABgAAAAAAAAAAAAAADlByb2plY3RDb3VudGVyAAAAAAAAAAAAAAAAABBGZWVXYWxsZXRBZGRyZXNzAAAAAAAAADFGbGF0IGZlZSBjaGFyZ2VkIG9uY2UgdG8gdGhlIGJ1aWxkZXIsIGluIHN0cm9vcHMuAAAAAAAAC1BsYXRmb3JtRmVlAAAAAAAAAAAAAAAAEU1pbkJvbmRQZXJjZW50YWdlAAAAAAAAAAAAAAAAAAAQSWRlbnRpdHlSZWdpc3RyeQAAAAAAAAAAAAAAE0F0dGVzdGF0aW9uUmVnaXN0cnkAAAAAAAAAAAAAAAAQVm90aW5nV2luZG93U2VjcwAAAAAAAAAAAAAAD01pbkNvbnRyaWJ1dGlvbgAAAAABAAAAMk1hcmtzIGFuIGFkZHJlc3MgYXMgYSB2YXVsdCB0aGlzIGZhY3RvcnkgZGVwbG95ZWQuAAAAAAAHSXNWYXVsdAAAAAABAAAAEw==",
        "AAAAAAAAAeBDb25maWd1cmUgdGhlIGZhY3RvcnksIGF0b21pY2FsbHkgYXQgZGVwbG95LgoKQSBjb25zdHJ1Y3RvciBydW5zIGluc2lkZSB0aGUgZGVwbG95IHRyYW5zYWN0aW9uLCBzbyBhCmRlcGxveWVkLWJ1dC11bmNvbmZpZ3VyZWQgZmFjdG9yeSBjYW4gbmV2ZXIgYmUgY2xhaW1lZCBieSB3aG9ldmVyIHNwb3RzCml0IGZpcnN0IGFuZCBuYW1lZCB3aXRoIGl0cyBvd24gYWRtaW4sIGZlZSB3YWxsZXQgYW5kIHRydXN0ZWQKcmVnaXN0cmllcy4gSXQgdGFrZXMgdGhlIGlkZW50aXR5IGFuZCBhdHRlc3RhdGlvbiByZWdpc3RyeSBhZGRyZXNzZXMKaGVyZSwgd2hpY2ggaXMgd2h5IGJvdGggbXVzdCBiZSBkZXBsb3llZCBmaXJzdDsgdGhlIGF0dGVzdGF0aW9uIHJlZ2lzdHJ5CmlzIHRoZW4gdG9sZCB0byB0cnVzdCB0aGlzIGZhY3Rvcnkgd2l0aCBhIHBvc3QtZGVwbG95IGBhZGRfZmFjdG9yeWAuCmBhZG1pbmAgbXVzdCBhdXRob3Jpc2UgdGhlIGRlcGxveS4AAAANX19jb25zdHJ1Y3RvcgAAAAAAAAgAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAPdmF1bHRfd2FzbV9oYXNoAAAAA+4AAAAgAAAAAAAAAApmZWVfd2FsbGV0AAAAAAATAAAAAAAAAAxwbGF0Zm9ybV9mZWUAAAALAAAAAAAAABFpZGVudGl0eV9yZWdpc3RyeQAAAAAAABMAAAAAAAAAFGF0dGVzdGF0aW9uX3JlZ2lzdHJ5AAAAEwAAAAAAAAASdm90aW5nX3dpbmRvd19zZWNzAAAAAAAGAAAAAAAAABBtaW5fY29udHJpYnV0aW9uAAAACwAAAAA=",
        "AAAAAAAAAFFEZXBsb3kgYSB2YXVsdCBmb3IgYSBwcm9qZWN0IGFuZCBsb2NrIHRoZSBidWlsZGVyJ3MgYm9uZCBpbiB0aGUgc2FtZQp0cmFuc2FjdGlvbi4AAAAAAAAMY3JlYXRlX3ZhdWx0AAAAAQAAAAAAAAAGY29uZmlnAAAAAAfQAAAAEUNyZWF0ZVZhdWx0Q29uZmlnAAAAAAAAAQAAABM=",
        "AAAAAAAAAHtXaGV0aGVyIHRoaXMgZmFjdG9yeSBkZXBsb3llZCB0aGUgZ2l2ZW4gYWRkcmVzcy4gVGhlIGF0dGVzdGF0aW9uCnJlZ2lzdHJ5IGNhbGxzIHRoaXMgdG8gZGVjaWRlIHdoZXRoZXIgYSByZWNvcmQgaXMgZ2VudWluZS4AAAAACGlzX3ZhdWx0AAAAAQAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAJZ2V0X3ZhdWx0AAAAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAEAAAAT",
        "AAAAAAAAAAAAAAAQdXBkYXRlX3dhc21faGFzaAAAAAEAAAAAAAAACG5ld19oYXNoAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAARdXBkYXRlX2ZlZV93YWxsZXQAAAAAAAABAAAAAAAAAA5uZXdfZmVlX3dhbGxldAAAAAAAEwAAAAA=",
        "AAAAAAAAAGhTZXQgdGhlIGZsYXQgbGlzdGluZyBmZWUsIGluIHN0cm9vcHMuIFRoZXJlIGlzIGRlbGliZXJhdGVseSBubwpwZXJjZW50YWdlLW9mLWZ1bmRzIHNldHRpbmcgdG8gcmVhY2ggZm9yLgAAABN1cGRhdGVfcGxhdGZvcm1fZmVlAAAAAAEAAAAAAAAAB25ld19mZWUAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAAWdXBkYXRlX2JvbmRfcGVyY2VudGFnZQAAAAAAAQAAAAAAAAAObmV3X3BlcmNlbnRhZ2UAAAAAAAYAAAAA",
        "AAAAAAAAAAAAAAAYdXBkYXRlX2lkZW50aXR5X3JlZ2lzdHJ5AAAAAQAAAAAAAAAMbmV3X3JlZ2lzdHJ5AAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAUdXBkYXRlX3ZvdGluZ193aW5kb3cAAAABAAAAAAAAAA9uZXdfd2luZG93X3NlY3MAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAXdXBkYXRlX21pbl9jb250cmlidXRpb24AAAAAAQAAAAAAAAALbmV3X21pbmltdW0AAAAACwAAAAA=",
        "AAAAAAAAAAAAAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAOZ2V0X2ZlZV93YWxsZXQAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAQZ2V0X3BsYXRmb3JtX2ZlZQAAAAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAATZ2V0X2JvbmRfcGVyY2VudGFnZQAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAAVZ2V0X2lkZW50aXR5X3JlZ2lzdHJ5AAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAYZ2V0X2F0dGVzdGF0aW9uX3JlZ2lzdHJ5AAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAARZ2V0X3ZvdGluZ193aW5kb3cAAAAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAAUZ2V0X21pbl9jb250cmlidXRpb24AAAAAAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAARZ2V0X3Byb2plY3RfY291bnQAAAAAAAAAAAAAAQAAAAY=" ]),
      options
    )
  }
  public readonly fromJSON = {
    create_vault: this.txFromJSON<string>,
        is_vault: this.txFromJSON<boolean>,
        get_vault: this.txFromJSON<string>,
        update_wasm_hash: this.txFromJSON<null>,
        update_fee_wallet: this.txFromJSON<null>,
        update_platform_fee: this.txFromJSON<null>,
        update_bond_percentage: this.txFromJSON<null>,
        update_identity_registry: this.txFromJSON<null>,
        update_voting_window: this.txFromJSON<null>,
        update_min_contribution: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        get_admin: this.txFromJSON<string>,
        get_fee_wallet: this.txFromJSON<string>,
        get_platform_fee: this.txFromJSON<i128>,
        get_bond_percentage: this.txFromJSON<u64>,
        get_identity_registry: this.txFromJSON<string>,
        get_attestation_registry: this.txFromJSON<string>,
        get_voting_window: this.txFromJSON<u64>,
        get_min_contribution: this.txFromJSON<i128>,
        get_project_count: this.txFromJSON<u64>
  }
}