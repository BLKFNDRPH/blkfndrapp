import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u64 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const Errors: {
    0: {
        message: string;
    };
    1: {
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
    15: {
        message: string;
    };
    16: {
        message: string;
    };
    17: {
        message: string;
    };
    18: {
        message: string;
    };
    19: {
        message: string;
    };
    20: {
        message: string;
    };
    21: {
        message: string;
    };
    22: {
        message: string;
    };
    23: {
        message: string;
    };
    24: {
        message: string;
    };
};
export type DataKey = {
    tag: "Platform";
    values: void;
} | {
    tag: "Project";
    values: readonly [u64];
} | {
    tag: "Proposal";
    values: readonly [u64];
} | {
    tag: "Receipt";
    values: readonly [u64];
} | {
    tag: "ReceiptCounter";
    values: void;
} | {
    tag: "ProjectCounter";
    values: void;
} | {
    tag: "ProposalCounter";
    values: void;
} | {
    tag: "TokenAddress";
    values: readonly [CurrencyType];
} | {
    tag: "UserInvestments";
    values: readonly [string];
} | {
    tag: "ProjectFees";
    values: readonly [u64];
};
export interface Project {
    blob_id: string;
    category: string;
    created_at: u64;
    creator: string;
    currency_type: CurrencyType;
    description: string;
    funding_deadline: u64;
    goal: u64;
    has_pending_withdrawal: boolean;
    id: u64;
    raised_amount: u64;
    status: ProjectStatus;
    tagline: string;
    title: string;
}
export interface Platform {
    admin: string;
    fee_percentage: u64;
    fee_wallet_address: string;
    multi_sig_admins: Array<string>;
    total_fees_collected: u64;
    bond_percentage?: u64;
}
export declare enum CurrencyType {
    XLM = 0,
    USDC = 1,
    USDT = 2,
    WBTC = 3,
    WETH = 4
}
export interface AdminProposal {
    amount: u64;
    approvals: Array<string>;
    executed: boolean;
    project_id: u64;
    proposal_id: u64;
    proposer: string;
}
export declare enum ProjectStatus {
    Hidden = 0,
    Pending = 1,
    Rejected = 2,
    Approved = 3,
    Funded = 4,
    Completed = 5,
    Expired = 6
}
export interface InvestmentReceipt {
    amount: u64;
    fee_paid: u64;
    investment_date: u64;
    investment_id: u64;
    investor: string;
    project_id: u64;
    share_percentage: u64;
}
export interface Client {
    /**
     * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    initialize: ({ admin, fee_wallet_address, fee_percentage }: {
        admin: string;
        fee_wallet_address: string;
        fee_percentage: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a update_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Update platform fee percentage (max 1000 bps = 10%).
     */
    update_fee: ({ new_fee_bps }: {
        new_fee_bps: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a claim_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Claim raised funds after project is fully funded. Status transitions to Completed.
     */
    claim_funds: ({ project_id }: {
        project_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Get full project details.
     */
    get_project: ({ project_id }: {
        project_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Project>>;
    /**
     * Construct and simulate a fund_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    fund_project: ({ investor, project_id, amount, currency_type }: {
        investor: string;
        project_id: u64;
        amount: u64;
        currency_type: CurrencyType;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a create_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    create_project: ({ creator, title, tagline, description, category, goal, blob_id, currency_type, funding_deadline }: {
        creator: string;
        title: string;
        tagline: string;
        description: string;
        category: string;
        goal: u64;
        blob_id: string;
        currency_type: CurrencyType;
        funding_deadline: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
    /**
     * Construct and simulate a register_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    register_token: ({ currency_type, token_address }: {
        currency_type: CurrencyType;
        token_address: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a reject_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Admin rejects a pending project, changing status to Rejected.
     */
    reject_project: ({ project_id }: {
        project_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Transfer primary admin role.
     */
    transfer_admin: ({ new_admin }: {
        new_admin: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a approve_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Admin approves a pending project, changing status to Approved.
     */
    approve_project: ({ project_id }: {
        project_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a refund_investor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Refund investor if project expires without reaching goal.
     */
    refund_investor: ({ project_id, investor }: {
        project_id: u64;
        investor: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a vote_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Multi-sig Admin votes to approve a withdrawal proposal.
     */
    vote_withdrawal: ({ voter, proposal_id }: {
        voter: string;
        proposal_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_all_projects transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * List all projects.
     */
    get_all_projects: (options?: MethodOptions) => Promise<AssembledTransaction<Array<Project>>>;
    /**
     * Construct and simulate a get_platform_info transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Get platform configuration.
     */
    get_platform_info: (options?: MethodOptions) => Promise<AssembledTransaction<Platform>>;
    /**
     * Construct and simulate a update_fee_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Update platform fee wallet address.
     */
    update_fee_wallet: ({ new_fee_wallet }: {
        new_fee_wallet: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a donate_to_platform transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Donate directly to the platform.
     */
    donate_to_platform: ({ donor, amount, currency_type, message }: {
        donor: string;
        amount: u64;
        currency_type: CurrencyType;
        message: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a execute_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Execute withdrawal after threshold of approvals met. Transfers funds to project creator.
     */
    execute_withdrawal: ({ executor, proposal_id }: {
        executor: string;
        proposal_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a propose_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Multi-sig Admin creates a withdrawal proposal for a funded project.
     */
    propose_withdrawal: ({ proposer, project_id, amount }: {
        proposer: string;
        project_id: u64;
        amount: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
    /**
     * Construct and simulate a add_multi_sig_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Add a new multi-sig admin.
     */
    add_multi_sig_admin: ({ address }: {
        address: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_user_investments transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Get all investments for an address.
     */
    get_user_investments: ({ address }: {
        address: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Array<InvestmentReceipt>>>;
    /**
     * Construct and simulate a get_pending_proposals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * List all pending admin proposals.
     */
    get_pending_proposals: (options?: MethodOptions) => Promise<AssembledTransaction<Array<AdminProposal>>>;
    /**
     * Construct and simulate a update_project_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Admin updates project status manually, enforcing strict status transition guards.
     */
    update_project_status: ({ project_id, new_status }: {
        project_id: u64;
        new_status: ProjectStatus;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_investment_receipt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Get investment receipt details.
     */
    get_investment_receipt: ({ investment_id }: {
        investment_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<InvestmentReceipt>>;
    /**
     * Construct and simulate a get_projects_by_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Filter projects by status.
     */
    get_projects_by_status: ({ status }: {
        status: ProjectStatus;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Array<Project>>>;
    /**
     * Construct and simulate a remove_multi_sig_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Remove a multi-sig admin.
     */
    remove_multi_sig_admin: ({ address }: {
        address: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
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
        update_fee: (json: string) => AssembledTransaction<null>;
        claim_funds: (json: string) => AssembledTransaction<null>;
        get_project: (json: string) => AssembledTransaction<Project>;
        fund_project: (json: string) => AssembledTransaction<null>;
        create_project: (json: string) => AssembledTransaction<bigint>;
        register_token: (json: string) => AssembledTransaction<null>;
        reject_project: (json: string) => AssembledTransaction<null>;
        transfer_admin: (json: string) => AssembledTransaction<null>;
        approve_project: (json: string) => AssembledTransaction<null>;
        refund_investor: (json: string) => AssembledTransaction<null>;
        vote_withdrawal: (json: string) => AssembledTransaction<null>;
        get_all_projects: (json: string) => AssembledTransaction<Project[]>;
        get_platform_info: (json: string) => AssembledTransaction<Platform>;
        update_fee_wallet: (json: string) => AssembledTransaction<null>;
        donate_to_platform: (json: string) => AssembledTransaction<null>;
        execute_withdrawal: (json: string) => AssembledTransaction<null>;
        propose_withdrawal: (json: string) => AssembledTransaction<bigint>;
        add_multi_sig_admin: (json: string) => AssembledTransaction<null>;
        get_user_investments: (json: string) => AssembledTransaction<InvestmentReceipt[]>;
        get_pending_proposals: (json: string) => AssembledTransaction<AdminProposal[]>;
        update_project_status: (json: string) => AssembledTransaction<null>;
        get_investment_receipt: (json: string) => AssembledTransaction<InvestmentReceipt>;
        get_projects_by_status: (json: string) => AssembledTransaction<Project[]>;
        remove_multi_sig_admin: (json: string) => AssembledTransaction<null>;
    };
}
