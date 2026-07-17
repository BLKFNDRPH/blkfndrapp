#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype,
    panic_with_error, symbol_short,
    token, Address, Env, String, Vec,
};

// ERROR CODES

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAdmin              = 0,
    NotMultiSig           = 1,
    ProjectNotApproved    = 3,
    InsufficientFunds     = 4,
    GoalAlreadyReached    = 5,
    InvalidPercentage     = 6,
    NotProjectCreator     = 7,
    ProjectNotFunded      = 8,
    InvalidStatus         = 9,
    InvalidCurrency       = 10,
    ProjectHasFunds       = 11,
    ProjectAlreadyFunded  = 12,
    NotAuthorized         = 13,
    AlreadyVoted          = 14,
    InsufficientApprovals = 15,
    FundingDeadlinePassed = 16,
    ProjectMismatch       = 17,
    NoFundsToRefund       = 18,
    ProposalAlreadyExists = 19,
    IncorrectFee          = 20,
    InvalidFee            = 21,
    NotInitialized        = 22,
    ProjectNotFound       = 23,
    AlreadyInitialized    = 24,
}

//CONSTANTS

const BASIS_POINTS: u64          = 10_000;
const MAX_FEE_PERCENTAGE: u64    = 1_000; 
const LEDGERS_TO_LIVE: u32 = 518_400;

// ENUMS

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProjectStatus {
    Hidden    = 0,
    Pending   = 1,
    Rejected  = 2,
    Approved  = 3,
    Funded    = 4,
    Completed = 5,
    Expired   = 6,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CurrencyType {
    XLM  = 0,
    USDC = 1,
    USDT = 2,
    WBTC = 3,
    WETH = 4,
}

#[contracttype]
pub enum DataKey {
    Platform,
    Project(u64),
    Proposal(u64),
    Receipt(u64),
    ReceiptCounter,
    ProjectCounter,
    ProposalCounter,
    TokenAddress(CurrencyType),
    UserInvestments(Address), 
    ProjectFees(u64),
}

// DATA STRUCTURES

#[contracttype]
#[derive(Clone, Debug)]
pub struct Project {
    pub id:                     u64,
    pub title:                  String,
    pub tagline:                String,
    pub description:            String,
    pub category:               String,
    pub goal:                   u64,
    pub blob_id:                String,
    pub creator:                Address,
    pub status:                 ProjectStatus,
    pub raised_amount:          u64,
    pub currency_type:          CurrencyType,
    pub created_at:             u64,
    pub funding_deadline:       u64,
    pub has_pending_withdrawal: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Platform {
    pub admin:                  Address,
    pub multi_sig_admins:       Vec<Address>,
    pub fee_wallet_address:     Address,
    pub fee_percentage:         u64,
    pub total_fees_collected:   u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct InvestmentReceipt {
    pub investment_id:    u64,
    pub investor:         Address,
    pub project_id:       u64,
    pub amount:           u64,
    pub share_percentage: u64,
    pub fee_paid:         u64,
    pub investment_date:  u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminProposal {
    pub proposal_id:    u64,
    pub proposer:       Address,
    pub project_id:     u64,
    pub amount:         u64,
    pub approvals:      Vec<Address>,
    pub executed:       bool,
}

// STORAGE HELPERS

#[inline]
fn load_platform(env: &Env) -> Platform {
    env.storage()
        .instance()
        .get(&DataKey::Platform)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn save_platform(env: &Env, p: &Platform) {
    env.storage().instance().set(&DataKey::Platform, p);
}

fn load_project(env: &Env, id: u64) -> Project {
    let k = DataKey::Project(id);
    let proj: Project = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| panic_with_error!(env, Error::ProjectNotFound));
    env.storage()
        .persistent()
        .extend_ttl(&k, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
    proj
}

fn save_project(env: &Env, proj: &Project) {
    let k = DataKey::Project(proj.id);
    env.storage().persistent().set(&k, proj);
    env.storage()
        .persistent()
        .extend_ttl(&k, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

fn load_project_fees(env: &Env, id: u64) -> u64 {
    let k = DataKey::ProjectFees(id);
    if env.storage().persistent().has(&k) {
        let fees = env.storage().persistent().get(&k).unwrap();
        env.storage().persistent().extend_ttl(&k, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
        fees
    } else {
        0u64
    }
}

fn save_project_fees(env: &Env, id: u64, fees: u64) {
    let k = DataKey::ProjectFees(id);
    env.storage().persistent().set(&k, &fees);
    env.storage().persistent().extend_ttl(&k, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

fn load_proposal(env: &Env, proposal_id: u64) -> AdminProposal {
    let k = DataKey::Proposal(proposal_id);
    let p: AdminProposal = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| panic_with_error!(env, Error::ProjectNotFunded));
    env.storage()
        .persistent()
        .extend_ttl(&k, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
    p
}

fn load_receipt(env: &Env, id: u64) -> InvestmentReceipt {
    let k = DataKey::Receipt(id);
    let r: InvestmentReceipt = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotAuthorized));
    env.storage()
        .persistent()
        .extend_ttl(&k, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
    r
}

fn get_token_address(env: &Env, currency_type: CurrencyType) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TokenAddress(currency_type))
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidCurrency))
}

// LOGIC HELPERS

fn supermajority(n: u64) -> u64 {
    if n <= 2 {
        return n;
    }
    (2 * n + 2) / 3
}

fn is_multisig(platform: &Platform, addr: &Address) -> bool {
    for i in 0..platform.multi_sig_admins.len() {
        if &platform.multi_sig_admins.get(i).unwrap() == addr {
            return true;
        }
    }
    false
}

fn already_voted(proposal: &AdminProposal, addr: &Address) -> bool {
    for i in 0..proposal.approvals.len() {
        if &proposal.approvals.get(i).unwrap() == addr {
            return true;
        }
    }
    false
}

fn validate_status_transition(old_status: ProjectStatus, new_status: ProjectStatus) -> bool {
    match (old_status, new_status) {
        (ProjectStatus::Hidden, ProjectStatus::Pending) => true,
        (ProjectStatus::Pending, ProjectStatus::Approved) => true,
        (ProjectStatus::Pending, ProjectStatus::Rejected) => true,
        (ProjectStatus::Rejected, ProjectStatus::Pending) => true,
        (ProjectStatus::Approved, ProjectStatus::Funded) => true,
        (ProjectStatus::Approved, ProjectStatus::Expired) => true,
        (ProjectStatus::Approved, ProjectStatus::Hidden) => true,
        (ProjectStatus::Funded, ProjectStatus::Completed) => true,
        _ => false,
    }
}

// CONTRACT DEFINITION

#[contract]
pub struct CrowdfundingContract;

#[contractimpl]
impl CrowdfundingContract {

    pub fn initialize(
        env:                Env,
        admin:              Address,
        fee_wallet_address: Address,
        fee_percentage:     u64,
    ) {
        if env.storage().instance().has(&DataKey::Platform) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        admin.require_auth();

        if fee_percentage > MAX_FEE_PERCENTAGE {
            panic_with_error!(&env, Error::InvalidPercentage);
        }

        let mut multi_sig_admins = Vec::new(&env);
        multi_sig_admins.push_back(admin.clone());

        let platform = Platform {
            admin,
            multi_sig_admins,
            fee_wallet_address,
            fee_percentage,
            total_fees_collected: 0,
        };

        env.storage().instance().set(&DataKey::Platform, &platform);
        env.storage().instance().set(&DataKey::ProjectCounter, &0u64);
        env.storage().instance().set(&DataKey::ProposalCounter, &0u64);
        env.storage().instance().set(&DataKey::ReceiptCounter, &0u64);

        env.events().publish(
            (symbol_short!("PLATFORM"), symbol_short!("INIT")),
            platform.admin,
        );
    }

    pub fn register_token(
        env:           Env,
        currency_type: CurrencyType,
        token_address: Address,
    ) {
        let platform = load_platform(&env);
        platform.admin.require_auth();

        env.storage().instance().set(&DataKey::TokenAddress(currency_type), &token_address);
    }

    // PROJECT MANAGEMENT

    pub fn create_project(
        env:              Env,
        creator:          Address,
        title:            String,
        tagline:          String,
        description:      String,
        category:         String,
        goal:             u64,
        blob_id:          String,
        currency_type:    CurrencyType,
        funding_deadline: u64,
    ) -> u64 {
        creator.require_auth();

        if goal == 0 {
            panic_with_error!(&env, Error::InvalidFee);
        }

        let now = env.ledger().timestamp();
        if funding_deadline <= now {
            panic_with_error!(&env, Error::FundingDeadlinePassed);
        }

        if !env.storage().instance().has(&DataKey::TokenAddress(currency_type)) {
            panic_with_error!(&env, Error::InvalidCurrency);
        }

        let mut counter: u64 = env.storage().instance().get(&DataKey::ProjectCounter).unwrap_or(0);
        counter = counter.checked_add(1).unwrap();
        env.storage().instance().set(&DataKey::ProjectCounter, &counter);

        let project = Project {
            id:                     counter,
            title:                  title.clone(),
            tagline,
            description,
            category,
            goal,
            blob_id,
            creator:                creator.clone(),
            status:                 ProjectStatus::Pending,
            raised_amount:          0,
            currency_type,
            created_at:             now,
            funding_deadline,
            has_pending_withdrawal: false,
        };

        save_project(&env, &project);

        env.events().publish(
            (symbol_short!("PROJECT"), symbol_short!("CREATED")),
            (counter, creator, title, goal, currency_type as u32),
        );

        counter
    }

    /// Admin approves a pending project, changing status to Approved.
    pub fn approve_project(env: Env, project_id: u64) {
        let platform = load_platform(&env);
        platform.admin.require_auth();

        let mut project = load_project(&env, project_id);
        if project.status != ProjectStatus::Pending {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        project.status = ProjectStatus::Approved;
        save_project(&env, &project);

        env.events().publish(
            (symbol_short!("PROJECT"), symbol_short!("APPROVED")),
            project_id,
        );
    }

    /// Admin rejects a pending project, changing status to Rejected.
    pub fn reject_project(env: Env, project_id: u64) {
        let platform = load_platform(&env);
        platform.admin.require_auth();

        let mut project = load_project(&env, project_id);
        if project.status != ProjectStatus::Pending {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        project.status = ProjectStatus::Rejected;
        save_project(&env, &project);

        env.events().publish(
            (symbol_short!("PROJECT"), symbol_short!("REJECTED")),
            project_id,
        );
    }

    /// Admin updates project status manually, enforcing strict status transition guards.
    pub fn update_project_status(env: Env, project_id: u64, new_status: ProjectStatus) {
        let platform = load_platform(&env);
        platform.admin.require_auth();

        let mut project = load_project(&env, project_id);
        if !validate_status_transition(project.status, new_status) {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let old_status = project.status;
        project.status = new_status;
        save_project(&env, &project);

        env.events().publish(
            (symbol_short!("STATUS"), symbol_short!("CHANGED")),
            (project_id, old_status as u32, new_status as u32),
        );
    }

    // FUNDING MECHANISM
    pub fn fund_project(
        env:           Env,
        investor:      Address,
        project_id:    u64,
        amount:        u64,
        currency_type: CurrencyType,
    ) {
        investor.require_auth();

        let platform = load_platform(&env);
        let mut project  = load_project(&env, project_id);

        if project.status != ProjectStatus::Approved {
            panic_with_error!(&env, Error::ProjectNotApproved);
        }

        if currency_type != project.currency_type {
            panic_with_error!(&env, Error::InvalidCurrency);
        }

        let now = env.ledger().timestamp();
        if now > project.funding_deadline {
            panic_with_error!(&env, Error::FundingDeadlinePassed);
        }

        if amount == 0 {
            panic_with_error!(&env, Error::InsufficientFunds);
        }

        let fee_paid = amount
            .checked_mul(platform.fee_percentage)
            .unwrap()
            .checked_div(BASIS_POINTS)
            .unwrap();

        let total_amount = amount.checked_add(fee_paid).unwrap();

        let token_address = get_token_address(&env, currency_type);
        let token = token::Client::new(&env, &token_address);

        // Transfer total amount from investor to contract
        token.transfer(&investor, &env.current_contract_address(), &(total_amount as i128));

        // Store fee in contract escrow 
        if fee_paid > 0 {
            let mut accrued_fees = load_project_fees(&env, project_id);
            accrued_fees = accrued_fees.checked_add(fee_paid).unwrap();
            save_project_fees(&env, project_id, accrued_fees);
        }

        // Update project stats with base amount
        project.raised_amount = project.raised_amount.checked_add(amount).unwrap();

        // Increment and mint receipt
        let mut receipt_counter: u64 = env.storage().instance().get(&DataKey::ReceiptCounter).unwrap_or(0);
        receipt_counter = receipt_counter.checked_add(1).unwrap();
        env.storage().instance().set(&DataKey::ReceiptCounter, &receipt_counter);

        let share_percentage = (amount.checked_mul(BASIS_POINTS).unwrap())
            .checked_div(project.goal)
            .unwrap_or(0);

        let receipt = InvestmentReceipt {
            investment_id:    receipt_counter,
            investor:         investor.clone(),
            project_id,
            amount,
            share_percentage,
            fee_paid,
            investment_date:  now,
        };

        env.storage().persistent().set(&DataKey::Receipt(receipt_counter), &receipt);

        // Track receipt on investor
        let user_key = DataKey::UserInvestments(investor.clone());
        let mut user_receipts: Vec<u64> = env
            .storage()
            .persistent()
            .get(&user_key)
            .unwrap_or_else(|| Vec::new(&env));
        user_receipts.push_back(receipt_counter);
        env.storage().persistent().set(&user_key, &user_receipts);

        if project.raised_amount >= project.goal {
            project.status = ProjectStatus::Funded;
        }

        save_project(&env, &project);

        env.events().publish(
            (symbol_short!("RECEIPT"), symbol_short!("MINTED")),
            (receipt_counter, investor, project_id, amount),
        );
    }


    /// Refund investor if project expires without reaching goal.
    pub fn refund_investor(
        env:        Env,
        project_id: u64,
        investor:   Address,
    ) {
        investor.require_auth();

        let mut project = load_project(&env, project_id);
        
        let now = env.ledger().timestamp();
        if project.status != ProjectStatus::Expired && (now > project.funding_deadline && project.raised_amount < project.goal) {
            project.status = ProjectStatus::Expired;
        }

        if project.status != ProjectStatus::Expired {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let user_key = DataKey::UserInvestments(investor.clone());
        let user_receipt_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&user_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut refund_amount: u64 = 0;
        let mut refund_fee: u64 = 0;
        let mut remaining_ids: Vec<u64> = Vec::new(&env);

        for receipt_id in user_receipt_ids.iter() {
            let r_key = DataKey::Receipt(receipt_id);
            if env.storage().persistent().has(&r_key) {
                let receipt: InvestmentReceipt = env.storage().persistent().get(&r_key).unwrap();
                if receipt.project_id == project_id {
                    refund_amount = refund_amount.checked_add(receipt.amount).unwrap();
                    refund_fee = refund_fee.checked_add(receipt.fee_paid).unwrap();
                    env.storage().persistent().remove(&r_key);
                } else {
                    remaining_ids.push_back(receipt_id);
                }
            }
        }

        let total_refund = refund_amount.checked_add(refund_fee).unwrap();
        if total_refund == 0 {
            panic_with_error!(&env, Error::NoFundsToRefund);
        }

        if project.raised_amount < refund_amount {
            panic_with_error!(&env, Error::InsufficientFunds);
        }

        project.raised_amount = project.raised_amount.checked_sub(refund_amount).unwrap();
        save_project(&env, &project);

        if refund_fee > 0 {
            let mut accrued_fees = load_project_fees(&env, project_id);
            accrued_fees = accrued_fees.checked_sub(refund_fee).unwrap();
            if accrued_fees == 0 {
                env.storage().persistent().remove(&DataKey::ProjectFees(project_id));
            } else {
                save_project_fees(&env, project_id, accrued_fees);
            }
        }

        if remaining_ids.len() == 0 {
            env.storage().persistent().remove(&user_key);
        } else {
            env.storage().persistent().set(&user_key, &remaining_ids);
        }

        let token_address = get_token_address(&env, project.currency_type);
        let token = token::Client::new(&env, &token_address);
        token.transfer(
            &env.current_contract_address(),
            &investor,
            &(total_refund as i128),
        );

        env.events().publish(
            (symbol_short!("PROJECT"), symbol_short!("REFUNDED")),
            (project_id, investor, total_refund),
        );
    }

    // ADMIN GOVERNANCE
    /// Multi-sig Admin creates a withdrawal proposal for a funded project.
    pub fn propose_withdrawal(
        env:        Env,
        proposer:   Address,
        project_id: u64,
        amount:     u64,
    ) -> u64 {
        let platform = load_platform(&env);
        if !is_multisig(&platform, &proposer) {
            panic_with_error!(&env, Error::NotMultiSig);
        }
        proposer.require_auth();

        let mut project = load_project(&env, project_id);
        if project.status != ProjectStatus::Funded {
            panic_with_error!(&env, Error::ProjectNotFunded);
        }

        if amount > project.raised_amount {
            panic_with_error!(&env, Error::InsufficientFunds);
        }

        if project.has_pending_withdrawal {
            panic_with_error!(&env, Error::ProposalAlreadyExists);
        }

        let mut counter: u64 = env.storage().instance().get(&DataKey::ProposalCounter).unwrap_or(0);
        counter = counter.checked_add(1).unwrap();
        env.storage().instance().set(&DataKey::ProposalCounter, &counter);

        let mut approvals = Vec::new(&env);
        approvals.push_back(proposer.clone());

        let proposal = AdminProposal {
            proposal_id: counter,
            proposer,
            project_id,
            amount,
            approvals,
            executed:    false,
        };

        env.storage().persistent().set(&DataKey::Proposal(counter), &proposal);

        project.has_pending_withdrawal = true;
        save_project(&env, &project);

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("CREATED")),
            (counter, project_id, amount),
        );

        counter
    }

    /// Multi-sig Admin votes to approve a withdrawal proposal.
    pub fn vote_withdrawal(env: Env, voter: Address, proposal_id: u64) {
        let platform = load_platform(&env);
        if !is_multisig(&platform, &voter) {
            panic_with_error!(&env, Error::NotMultiSig);
        }
        voter.require_auth();

        let mut proposal = load_proposal(&env, proposal_id);
        if proposal.executed {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        if already_voted(&proposal, &voter) {
            panic_with_error!(&env, Error::AlreadyVoted);
        }

        proposal.approvals.push_back(voter);
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("APPROVED")),
            proposal_id,
        );
    }

    /// Execute withdrawal after threshold of approvals met. Transfers funds to project creator.
    pub fn execute_withdrawal(env: Env, executor: Address, proposal_id: u64) {
        let mut platform = load_platform(&env);
        if !is_multisig(&platform, &executor) {
            panic_with_error!(&env, Error::NotMultiSig);
        }
        executor.require_auth();

        let mut proposal = load_proposal(&env, proposal_id);
        if proposal.executed {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut project = load_project(&env, proposal.project_id);
        if project.status != ProjectStatus::Funded {
            panic_with_error!(&env, Error::ProjectNotFunded);
        }

        let n = platform.multi_sig_admins.len() as u64;
        let required_votes = supermajority(n);

        if (proposal.approvals.len() as u64) < required_votes {
            panic_with_error!(&env, Error::InsufficientApprovals);
        }

        if proposal.amount > project.raised_amount {
            panic_with_error!(&env, Error::InsufficientFunds);
        }

        let accrued_fees = load_project_fees(&env, proposal.project_id);
        let total_raised = project.raised_amount;

        let fee_to_release = if accrued_fees > 0 && total_raised > 0 {
            if proposal.amount == total_raised {
                accrued_fees
            } else {
                ((proposal.amount as u128)
                    .checked_mul(accrued_fees as u128)
                    .unwrap()
                    .checked_div(total_raised as u128)
                    .unwrap()) as u64
            }
        } else {
            0
        };

        proposal.executed = true;
        project.raised_amount = project.raised_amount.checked_sub(proposal.amount).unwrap();
        project.has_pending_withdrawal = false;

        if project.raised_amount == 0 {
            project.status = ProjectStatus::Completed;
        }

        save_project(&env, &project);
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        let token_address = get_token_address(&env, project.currency_type);
        let token = token::Client::new(&env, &token_address);

        // Transfer platform fee if any
        if fee_to_release > 0 {
            token.transfer(
                &env.current_contract_address(),
                &platform.fee_wallet_address,
                &(fee_to_release as i128),
            );
            platform.total_fees_collected = platform.total_fees_collected.checked_add(fee_to_release).unwrap();
            save_platform(&env, &platform);

            let remaining_fees = accrued_fees.checked_sub(fee_to_release).unwrap();
            if remaining_fees == 0 {
                env.storage().persistent().remove(&DataKey::ProjectFees(proposal.project_id));
            } else {
                save_project_fees(&env, proposal.project_id, remaining_fees);
            }
        }

        // Transfer proposed withdrawal amount to creator
        token.transfer(
            &env.current_contract_address(),
            &project.creator,
            &(proposal.amount as i128),
        );

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("EXECUTED")),
            (proposal_id, proposal.project_id, proposal.amount),
        );
    }

    /// Update platform fee percentage (max 1000 bps = 10%).
    pub fn update_fee(env: Env, new_fee_bps: u64) {
        let mut platform = load_platform(&env);
        platform.admin.require_auth();

        if new_fee_bps > MAX_FEE_PERCENTAGE {
            panic_with_error!(&env, Error::InvalidFee);
        }

        platform.fee_percentage = new_fee_bps;
        save_platform(&env, &platform);

        env.events().publish(
            (symbol_short!("PLATFORM"), symbol_short!("FEE")),
            new_fee_bps,
        );
    }

    /// Add a new multi-sig admin.
    pub fn add_multi_sig_admin(env: Env, address: Address) {
        let mut platform = load_platform(&env);
        platform.admin.require_auth();

        if is_multisig(&platform, &address) {
            panic_with_error!(&env, Error::NotAuthorized);
        }

        platform.multi_sig_admins.push_back(address.clone());
        save_platform(&env, &platform);

        env.events().publish(
            (symbol_short!("PLATFORM"), symbol_short!("MSIG_ADD")),
            address,
        );
    }

    /// Remove a multi-sig admin.
    pub fn remove_multi_sig_admin(env: Env, address: Address) {
        let mut platform = load_platform(&env);
        platform.admin.require_auth();

        let mut found = false;
        let mut idx = 0;
        for i in 0..platform.multi_sig_admins.len() {
            if platform.multi_sig_admins.get(i).unwrap() == address {
                found = true;
                idx = i;
                break;
            }
        }

        if !found {
            panic_with_error!(&env, Error::NotMultiSig);
        }

        platform.multi_sig_admins.remove(idx);
        save_platform(&env, &platform);

        env.events().publish(
            (symbol_short!("PLATFORM"), symbol_short!("MSIG_RM")),
            address,
        );
    }

    /// Transfer primary admin role.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let mut platform = load_platform(&env);
        platform.admin.require_auth();

        platform.admin = new_admin.clone();
        save_platform(&env, &platform);

        env.events().publish(
            (symbol_short!("PLATFORM"), symbol_short!("ADMIN_TX")),
            new_admin,
        );
    }

    /// Update platform fee wallet address.
    pub fn update_fee_wallet(env: Env, new_fee_wallet: Address) {
        let mut platform = load_platform(&env);
        platform.admin.require_auth();

        platform.fee_wallet_address = new_fee_wallet.clone();
        save_platform(&env, &platform);

        env.events().publish(
            (symbol_short!("PLATFORM"), symbol_short!("FEE_WALL")),
            new_fee_wallet,
        );
    }

    /// Donate directly to the platform.
    pub fn donate_to_platform(
        env:           Env,
        donor:         Address,
        amount:        u64,
        currency_type: CurrencyType,
        message:       String,
    ) {
        donor.require_auth();

        if amount == 0 {
            panic_with_error!(&env, Error::InsufficientFunds);
        }

        let mut platform = load_platform(&env);
        let token_address = get_token_address(&env, currency_type);
        let token = token::Client::new(&env, &token_address);

        // Transfer funds from donor to fee wallet address
        token.transfer(&donor, &platform.fee_wallet_address, &(amount as i128));

        // Increment total fees/donations collected
        platform.total_fees_collected = platform.total_fees_collected.checked_add(amount).unwrap();
        save_platform(&env, &platform);

        env.events().publish(
            (symbol_short!("PLATFORM"), symbol_short!("DONATION")),
            (donor, amount, currency_type as u32, message),
        );
    }

    // QUERIES (READ-ONLY)

    /// Get full project details.
    pub fn get_project(env: Env, project_id: u64) -> Project {
        load_project(&env, project_id)
    }

    /// List all projects.
    pub fn get_all_projects(env: Env) -> Vec<Project> {
        let counter = env.storage().instance().get(&DataKey::ProjectCounter).unwrap_or(0u64);
        let mut list = Vec::new(&env);
        for id in 1..=counter {
            let k = DataKey::Project(id);
            if env.storage().persistent().has(&k) {
                let proj: Project = env.storage().persistent().get(&k).unwrap();
                list.push_back(proj);
            }
        }
        list
    }

    /// Filter projects by status.
    pub fn get_projects_by_status(env: Env, status: ProjectStatus) -> Vec<Project> {
        let counter = env.storage().instance().get(&DataKey::ProjectCounter).unwrap_or(0u64);
        let mut list = Vec::new(&env);
        for id in 1..=counter {
            let k = DataKey::Project(id);
            if env.storage().persistent().has(&k) {
                let proj: Project = env.storage().persistent().get(&k).unwrap();
                if proj.status == status {
                    list.push_back(proj);
                }
            }
        }
        list
    }

    /// Get platform configuration.
    pub fn get_platform_info(env: Env) -> Platform {
        load_platform(&env)
    }

    /// Get investment receipt details.
    pub fn get_investment_receipt(env: Env, investment_id: u64) -> InvestmentReceipt {
        load_receipt(&env, investment_id)
    }

    /// Get all investments for an address.
    pub fn get_user_investments(env: Env, address: Address) -> Vec<InvestmentReceipt> {
        let user_key = DataKey::UserInvestments(address);
        let receipt_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&user_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut list = Vec::new(&env);
        for id in receipt_ids.iter() {
            let r_key = DataKey::Receipt(id);
            if env.storage().persistent().has(&r_key) {
                let receipt: InvestmentReceipt = env.storage().persistent().get(&r_key).unwrap();
                list.push_back(receipt);
            }
        }
        list
    }

    /// List all pending admin proposals.
    pub fn get_pending_proposals(env: Env) -> Vec<AdminProposal> {
        let counter = env.storage().instance().get(&DataKey::ProposalCounter).unwrap_or(0u64);
        let mut list = Vec::new(&env);
        for id in 1..=counter {
            let k = DataKey::Proposal(id);
            if env.storage().persistent().has(&k) {
                let prop: AdminProposal = env.storage().persistent().get(&k).unwrap();
                if !prop.executed {
                    list.push_back(prop);
                }
            }
        }
        list
    }
}

#[cfg(test)]
mod test;