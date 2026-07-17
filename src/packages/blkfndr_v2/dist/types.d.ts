/**
* Error Enum: Error
*/
export declare const Error: {
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
/**
 * Union: DataKey
 */
export type DataKey = {
    tag: "Platform";
    values: void;
} | {
    tag: "Project";
    values: readonly [bigint];
} | {
    tag: "Proposal";
    values: readonly [bigint];
} | {
    tag: "Receipt";
    values: readonly [bigint];
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
};
/**
 * Struct: Project
 */
export interface Project {
    blob_id: string;
    category: string;
    created_at: bigint;
    creator: string;
    currency_type: CurrencyType;
    description: string;
    funding_deadline: bigint;
    goal: bigint;
    has_pending_withdrawal: boolean;
    id: bigint;
    raised_amount: bigint;
    status: ProjectStatus;
    tagline: string;
    title: string;
}
/**
 * Struct: Platform
 */
export interface Platform {
    admin: string;
    fee_percentage: bigint;
    fee_wallet_address: string;
    multi_sig_admins: Array<string>;
    total_fees_collected: bigint;
}
/**
 * Enum: CurrencyType
 */
export declare enum CurrencyType {
    /**
     * Enum Case: XLM
     */
    XLM = 0,
    /**
     * Enum Case: USDC
     */
    USDC = 1,
    /**
     * Enum Case: USDT
     */
    USDT = 2,
    /**
     * Enum Case: WBTC
     */
    WBTC = 3,
    /**
     * Enum Case: WETH
     */
    WETH = 4
}
/**
 * Struct: AdminProposal
 */
export interface AdminProposal {
    amount: bigint;
    approvals: Array<string>;
    executed: boolean;
    project_id: bigint;
    proposal_id: bigint;
    proposer: string;
}
/**
 * Enum: ProjectStatus
 */
export declare enum ProjectStatus {
    /**
     * Enum Case: Hidden
     */
    Hidden = 0,
    /**
     * Enum Case: Pending
     */
    Pending = 1,
    /**
     * Enum Case: Rejected
     */
    Rejected = 2,
    /**
     * Enum Case: Approved
     */
    Approved = 3,
    /**
     * Enum Case: Funded
     */
    Funded = 4,
    /**
     * Enum Case: Completed
     */
    Completed = 5,
    /**
     * Enum Case: Expired
     */
    Expired = 6
}
/**
 * Struct: InvestmentReceipt
 */
export interface InvestmentReceipt {
    amount: bigint;
    fee_paid: bigint;
    investment_date: bigint;
    investment_id: bigint;
    investor: string;
    project_id: bigint;
    share_percentage: bigint;
}
