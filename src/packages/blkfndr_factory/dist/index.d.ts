import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, u64, i128 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const Errors: {
    1: {
        message: string;
    };
    10: {
        message: string;
    };
    11: {
        message: string;
    };
};
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
export type DataKey = {
    tag: "Admin";
    values: void;
} | {
    tag: "VaultWasmHash";
    values: void;
} | {
    tag: "ProjectVaultMap";
    values: readonly [u64];
} | {
    tag: "ProjectCounter";
    values: void;
} | {
    tag: "FeeWalletAddress";
    values: void;
} | {
    tag: "FeePercentage";
    values: void;
} | {
    tag: "MinBondPercentage";
    values: void;
};
export interface Client {
    /**
     * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Initialize the factory with an admin address, vault contract WASM hash, platform fee wallet, and platform fee percentage.
     */
    initialize: ({ admin, vault_wasm_hash, fee_wallet, fee_percentage }: {
        admin: string;
        vault_wasm_hash: Buffer;
        fee_wallet: string;
        fee_percentage: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a create_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Deploy and initialize a new project vault contract instance.
     */
    create_vault: ({ config }: {
        config: CreateVaultConfig;
    }, options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Retrieve the registered vault address for the given project ID.
     */
    get_vault: ({ project_id }: {
        project_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a update_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Update the registered vault contract WASM hash.
     */
    update_wasm_hash: ({ new_hash }: {
        new_hash: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Update the platform fee payout destination address.
     */
    update_fee_wallet: ({ new_fee_wallet }: {
        new_fee_wallet: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_fee_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Update the platform fee percentage (safety ceiling of 10.0% / 1000 bps).
     */
    update_fee_percentage: ({ new_percentage }: {
        new_percentage: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_bond_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Update the minimum performance bond percentage (basis points, e.g. 500 = 5.00%).
     */
    update_bond_percentage: ({ new_percentage }: {
        new_percentage: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a get_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_fee_wallet: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a get_fee_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_fee_percentage: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
    /**
     * Construct and simulate a get_bond_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_bond_percentage: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions & Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
    }): Promise<AssembledTransaction<T>>;
    constructor(options: ContractClientOptions);
    readonly fromJSON: {
        initialize: (json: string) => AssembledTransaction<null>;
        create_vault: (json: string) => AssembledTransaction<string>;
        get_vault: (json: string) => AssembledTransaction<string>;
        update_wasm_hash: (json: string) => AssembledTransaction<null>;
        update_fee_wallet: (json: string) => AssembledTransaction<null>;
        update_fee_percentage: (json: string) => AssembledTransaction<null>;
        update_bond_percentage: (json: string) => AssembledTransaction<null>;
        get_admin: (json: string) => AssembledTransaction<string>;
        get_fee_wallet: (json: string) => AssembledTransaction<string>;
        get_fee_percentage: (json: string) => AssembledTransaction<bigint>;
        get_bond_percentage: (json: string) => AssembledTransaction<bigint>;
    };
}
