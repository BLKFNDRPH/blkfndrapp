/**
* Error Enum: Error
*/
export const Error = {
    0: { message: "NotAdmin" },
    1: { message: "NotMultiSig" },
    3: { message: "ProjectNotApproved" },
    4: { message: "InsufficientFunds" },
    5: { message: "GoalAlreadyReached" },
    6: { message: "InvalidPercentage" },
    7: { message: "NotProjectCreator" },
    8: { message: "ProjectNotFunded" },
    9: { message: "InvalidStatus" },
    10: { message: "InvalidCurrency" },
    11: { message: "ProjectHasFunds" },
    12: { message: "ProjectAlreadyFunded" },
    13: { message: "NotAuthorized" },
    14: { message: "AlreadyVoted" },
    15: { message: "InsufficientApprovals" },
    16: { message: "FundingDeadlinePassed" },
    17: { message: "ProjectMismatch" },
    18: { message: "NoFundsToRefund" },
    19: { message: "ProposalAlreadyExists" },
    20: { message: "IncorrectFee" },
    21: { message: "InvalidFee" },
    22: { message: "NotInitialized" },
    23: { message: "ProjectNotFound" },
    24: { message: "AlreadyInitialized" }
};
/**
 * Enum: CurrencyType
 */
export var CurrencyType;
(function (CurrencyType) {
    /**
     * Enum Case: XLM
     */
    CurrencyType[CurrencyType["XLM"] = 0] = "XLM";
    /**
     * Enum Case: USDC
     */
    CurrencyType[CurrencyType["USDC"] = 1] = "USDC";
    /**
     * Enum Case: USDT
     */
    CurrencyType[CurrencyType["USDT"] = 2] = "USDT";
    /**
     * Enum Case: WBTC
     */
    CurrencyType[CurrencyType["WBTC"] = 3] = "WBTC";
    /**
     * Enum Case: WETH
     */
    CurrencyType[CurrencyType["WETH"] = 4] = "WETH";
})(CurrencyType || (CurrencyType = {}));
/**
 * Enum: ProjectStatus
 */
export var ProjectStatus;
(function (ProjectStatus) {
    /**
     * Enum Case: Hidden
     */
    ProjectStatus[ProjectStatus["Hidden"] = 0] = "Hidden";
    /**
     * Enum Case: Pending
     */
    ProjectStatus[ProjectStatus["Pending"] = 1] = "Pending";
    /**
     * Enum Case: Rejected
     */
    ProjectStatus[ProjectStatus["Rejected"] = 2] = "Rejected";
    /**
     * Enum Case: Approved
     */
    ProjectStatus[ProjectStatus["Approved"] = 3] = "Approved";
    /**
     * Enum Case: Funded
     */
    ProjectStatus[ProjectStatus["Funded"] = 4] = "Funded";
    /**
     * Enum Case: Completed
     */
    ProjectStatus[ProjectStatus["Completed"] = 5] = "Completed";
    /**
     * Enum Case: Expired
     */
    ProjectStatus[ProjectStatus["Expired"] = 6] = "Expired";
})(ProjectStatus || (ProjectStatus = {}));
