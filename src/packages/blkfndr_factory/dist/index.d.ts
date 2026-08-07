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
    12: {
        message: string;
    };
    13: {
        message: string;
    };
    14: {
        message: string;
    };
};
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
    tag: "PlatformFee";
    values: void;
} | {
    tag: "MinBondPercentage";
    values: void;
} | {
    tag: "IdentityRegistry";
    values: void;
} | {
    tag: "AttestationRegistry";
    values: void;
} | {
    tag: "VotingWindowSecs";
    values: void;
} | {
    tag: "MinContribution";
    values: void;
} | {
    tag: "IsVault";
    values: readonly [string];
};
export interface Client {
    /**
     * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Configure the factory. `admin` must authorise, so a deployed but
     * unconfigured factory cannot be claimed by whoever spots it first.
     */
    initialize: ({ admin, vault_wasm_hash, fee_wallet, platform_fee, identity_registry, attestation_registry, voting_window_secs, min_contribution }: {
        admin: string;
        vault_wasm_hash: Buffer;
        fee_wallet: string;
        platform_fee: i128;
        identity_registry: string;
        attestation_registry: string;
        voting_window_secs: u64;
        min_contribution: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a create_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Deploy a vault for a project and lock the builder's bond in the same
     * transaction.
     */
    create_vault: ({ config }: {
        config: CreateVaultConfig;
    }, options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a is_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Whether this factory deployed the given address. The attestation
     * registry calls this to decide whether a record is genuine.
     */
    is_vault: ({ address }: {
        address: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
    /**
     * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_vault: ({ project_id }: {
        project_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a update_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_wasm_hash: ({ new_hash }: {
        new_hash: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_fee_wallet: ({ new_fee_wallet }: {
        new_fee_wallet: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_platform_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Set the flat listing fee, in stroops. There is deliberately no
     * percentage-of-funds setting to reach for.
     */
    update_platform_fee: ({ new_fee }: {
        new_fee: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_bond_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_bond_percentage: ({ new_percentage }: {
        new_percentage: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_identity_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_identity_registry: ({ new_registry }: {
        new_registry: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_voting_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_voting_window: ({ new_window_secs }: {
        new_window_secs: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_min_contribution transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_min_contribution: ({ new_minimum }: {
        new_minimum: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    transfer_admin: ({ new_admin }: {
        new_admin: string;
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
     * Construct and simulate a get_platform_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_platform_fee: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a get_bond_percentage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_bond_percentage: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
    /**
     * Construct and simulate a get_identity_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_identity_registry: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a get_attestation_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_attestation_registry: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a get_voting_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_voting_window: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
    /**
     * Construct and simulate a get_min_contribution transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_min_contribution: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a get_project_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_project_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
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
        is_vault: (json: string) => AssembledTransaction<boolean>;
        get_vault: (json: string) => AssembledTransaction<string>;
        update_wasm_hash: (json: string) => AssembledTransaction<null>;
        update_fee_wallet: (json: string) => AssembledTransaction<null>;
        update_platform_fee: (json: string) => AssembledTransaction<null>;
        update_bond_percentage: (json: string) => AssembledTransaction<null>;
        update_identity_registry: (json: string) => AssembledTransaction<null>;
        update_voting_window: (json: string) => AssembledTransaction<null>;
        update_min_contribution: (json: string) => AssembledTransaction<null>;
        transfer_admin: (json: string) => AssembledTransaction<null>;
        get_admin: (json: string) => AssembledTransaction<string>;
        get_fee_wallet: (json: string) => AssembledTransaction<string>;
        get_platform_fee: (json: string) => AssembledTransaction<bigint>;
        get_bond_percentage: (json: string) => AssembledTransaction<bigint>;
        get_identity_registry: (json: string) => AssembledTransaction<string>;
        get_attestation_registry: (json: string) => AssembledTransaction<string>;
        get_voting_window: (json: string) => AssembledTransaction<bigint>;
        get_min_contribution: (json: string) => AssembledTransaction<bigint>;
        get_project_count: (json: string) => AssembledTransaction<bigint>;
    };
}
