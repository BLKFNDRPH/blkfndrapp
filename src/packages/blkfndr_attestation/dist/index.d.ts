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
    2: {
        message: string;
    };
    3: {
        message: string;
    };
    4: {
        message: string;
    };
    5: {
        message: string;
    };
    6: {
        message: string;
    };
    7: {
        message: string;
    };
    8: {
        message: string;
    };
    9: {
        message: string;
    };
};
/**
 * How a project ended.
 */
export declare enum Outcome {
    Completed = 0,
    FailedWithForfeiture = 1,
    FailedToFund = 2
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
export type DataKey = {
    tag: "Admin";
    values: void;
} | {
    tag: "Factories";
    values: void;
} | {
    tag: "Record";
    values: readonly [u64];
} | {
    tag: "BuilderProjects";
    values: readonly [string];
};
export interface Client {
    /**
     * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Bind the registry to the factory whose vaults may write records.
     *
     * `admin` must authorize, so the binding cannot be front-run by whoever
     * notices the deployed-but-uninitialized contract first.
     */
    initialize: ({ admin, factory }: {
        admin: string;
        factory: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
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
    add_factory: ({ factory }: {
        factory: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    transfer_admin: ({ new_admin }: {
        new_admin: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a attest transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Write a project's closing record. Callable only by a vault the trusted
     * factory deployed, and only once per project.
     *
     * Deliberately absent: any way to amend or remove what this writes.
     */
    attest: ({ vault, factory, builder, project_id, outcome, total_raised, bond_posted, milestones_total, milestones_approved }: {
        vault: string;
        factory: string;
        builder: string;
        project_id: u64;
        outcome: Outcome;
        total_raised: i128;
        bond_posted: i128;
        milestones_total: u32;
        milestones_approved: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_record transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_record: ({ project_id }: {
        project_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Attestation>>;
    /**
     * Construct and simulate a has_record transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    has_record: ({ project_id }: {
        project_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
    /**
     * Construct and simulate a get_builder_projects transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Every project id this builder has closed, in the order they closed.
     */
    get_builder_projects: ({ builder }: {
        builder: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>;
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
    get_builder_history: ({ builder, offset, limit }: {
        builder: string;
        offset: u32;
        limit: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Array<Attestation>>>;
    /**
     * Construct and simulate a get_builder_summary transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Compact reputation summary: (completed, failed_with_forfeiture, failed_to_fund).
     */
    get_builder_summary: ({ builder }: {
        builder: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<readonly [u32, u32, u32]>>;
    /**
     * Construct and simulate a get_factories transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_factories: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>;
    /**
     * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a is_factory_trusted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    is_factory_trusted: ({ factory }: {
        factory: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
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
        add_factory: (json: string) => AssembledTransaction<null>;
        transfer_admin: (json: string) => AssembledTransaction<null>;
        attest: (json: string) => AssembledTransaction<null>;
        get_record: (json: string) => AssembledTransaction<Attestation>;
        has_record: (json: string) => AssembledTransaction<boolean>;
        get_builder_projects: (json: string) => AssembledTransaction<bigint[]>;
        get_builder_history: (json: string) => AssembledTransaction<Attestation[]>;
        get_builder_summary: (json: string) => AssembledTransaction<readonly [number, number, number]>;
        get_factories: (json: string) => AssembledTransaction<string[]>;
        get_admin: (json: string) => AssembledTransaction<string>;
        is_factory_trusted: (json: string) => AssembledTransaction<boolean>;
    };
}
