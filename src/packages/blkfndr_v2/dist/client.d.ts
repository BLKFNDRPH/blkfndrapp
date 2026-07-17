import { Project, CurrencyType, Platform, InvestmentReceipt, AdminProposal, ProjectStatus } from "./types.js";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import { Address } from "@stellar/stellar-sdk";
export interface Client {
    initialize({ admin, fee_wallet_address, fee_percentage, }: {
        admin: string | Address;
        fee_wallet_address: string | Address;
        fee_percentage: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Update platform fee percentage (max 1000 bps = 10%).
     */
    update_fee({ new_fee_bps }: {
        new_fee_bps: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Claim raised funds after project is fully funded. Status transitions to Completed.
     */
    claim_funds({ project_id }: {
        project_id: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Get full project details.
     */
    get_project({ project_id }: {
        project_id: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<Project>>;
    fund_project({ investor, project_id, amount, currency_type, }: {
        investor: string | Address;
        project_id: bigint;
        amount: bigint;
        currency_type: CurrencyType;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    create_project({ creator, title, tagline, description, category, goal, blob_id, currency_type, funding_deadline, }: {
        creator: string | Address;
        title: string;
        tagline: string;
        description: string;
        category: string;
        goal: bigint;
        blob_id: string;
        currency_type: CurrencyType;
        funding_deadline: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
    register_token({ currency_type, token_address, }: {
        currency_type: CurrencyType;
        token_address: string | Address;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Admin rejects a pending project, changing status to Rejected.
     */
    reject_project({ project_id }: {
        project_id: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Transfer primary admin role.
     */
    transfer_admin({ new_admin }: {
        new_admin: string | Address;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Admin approves a pending project, changing status to Approved.
     */
    approve_project({ project_id }: {
        project_id: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Refund investor if project expires without reaching goal.
     */
    refund_investor({ project_id, investor, }: {
        project_id: bigint;
        investor: string | Address;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Multi-sig Admin votes to approve a withdrawal proposal.
     */
    vote_withdrawal({ voter, proposal_id }: {
        voter: string | Address;
        proposal_id: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * List all projects.
     */
    get_all_projects(options?: MethodOptions): Promise<AssembledTransaction<Array<Project>>>;
    /**
     * Get platform configuration.
     */
    get_platform_info(options?: MethodOptions): Promise<AssembledTransaction<Platform>>;
    /**
     * Execute withdrawal after threshold of approvals met. Transfers funds to project creator.
     */
    execute_withdrawal({ executor, proposal_id, }: {
        executor: string | Address;
        proposal_id: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Multi-sig Admin creates a withdrawal proposal for a funded project.
     */
    propose_withdrawal({ proposer, project_id, amount, }: {
        proposer: string | Address;
        project_id: bigint;
        amount: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
    /**
     * Add a new multi-sig admin.
     */
    add_multi_sig_admin({ address }: {
        address: string | Address;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Get all investments for an address.
     */
    get_user_investments({ address }: {
        address: string | Address;
    }, options?: MethodOptions): Promise<AssembledTransaction<Array<InvestmentReceipt>>>;
    /**
     * List all pending admin proposals.
     */
    get_pending_proposals(options?: MethodOptions): Promise<AssembledTransaction<Array<AdminProposal>>>;
    /**
     * Admin updates project status manually, enforcing strict status transition guards.
     */
    update_project_status({ project_id, new_status, }: {
        project_id: bigint;
        new_status: ProjectStatus;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
    /**
     * Get investment receipt details.
     */
    get_investment_receipt({ investment_id }: {
        investment_id: bigint;
    }, options?: MethodOptions): Promise<AssembledTransaction<InvestmentReceipt>>;
    /**
     * Filter projects by status.
     */
    get_projects_by_status({ status }: {
        status: ProjectStatus;
    }, options?: MethodOptions): Promise<AssembledTransaction<Array<Project>>>;
    /**
     * Remove a multi-sig admin.
     */
    remove_multi_sig_admin({ address }: {
        address: string | Address;
    }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    constructor(options: ContractClientOptions);
    static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, "contractId"> & {
        wasmHash: Buffer | string;
        salt?: Buffer | Uint8Array;
        format?: "hex" | "base64";
        address?: string;
    }): Promise<AssembledTransaction<T>>;
    readonly fromJSON: {
        initialize: (json: string) => AssembledTransaction<void>;
        update_fee: (json: string) => AssembledTransaction<void>;
        claim_funds: (json: string) => AssembledTransaction<void>;
        get_project: (json: string) => AssembledTransaction<Project>;
        fund_project: (json: string) => AssembledTransaction<void>;
        create_project: (json: string) => AssembledTransaction<bigint>;
        register_token: (json: string) => AssembledTransaction<void>;
        reject_project: (json: string) => AssembledTransaction<void>;
        transfer_admin: (json: string) => AssembledTransaction<void>;
        approve_project: (json: string) => AssembledTransaction<void>;
        refund_investor: (json: string) => AssembledTransaction<void>;
        vote_withdrawal: (json: string) => AssembledTransaction<void>;
        get_all_projects: (json: string) => AssembledTransaction<Project[]>;
        get_platform_info: (json: string) => AssembledTransaction<Platform>;
        execute_withdrawal: (json: string) => AssembledTransaction<void>;
        propose_withdrawal: (json: string) => AssembledTransaction<bigint>;
        add_multi_sig_admin: (json: string) => AssembledTransaction<void>;
        get_user_investments: (json: string) => AssembledTransaction<InvestmentReceipt[]>;
        get_pending_proposals: (json: string) => AssembledTransaction<AdminProposal[]>;
        update_project_status: (json: string) => AssembledTransaction<void>;
        get_investment_receipt: (json: string) => AssembledTransaction<InvestmentReceipt>;
        get_projects_by_status: (json: string) => AssembledTransaction<Project[]>;
        remove_multi_sig_admin: (json: string) => AssembledTransaction<void>;
    };
}
