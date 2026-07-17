#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype, contractclient,
    panic_with_error, symbol_short, token, Address, Env, Vec, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized         = 1,
    InvalidStatus         = 2,
    ProjectNotFunded      = 3,
    InsufficientFunds     = 4,
    GoalAlreadyReached    = 5,
    InvalidPercentage     = 6,
    FundingDeadlinePassed = 7,
    NoFundsToRefund       = 9,
    AlreadyInitialized    = 10,
    NotInitialized        = 11,
    KYCInvalid            = 12,
    MilestoneNotFound     = 13,
    MilestoneAlreadyReleased = 14,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultState {
    Raising = 0,
    Funded = 1,
    Active = 2,
    Failed = 3,
    Refunding = 4,
    Completed = 5,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id: u32,
    pub amount: i128,   
    pub released: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultInitConfig {
    pub project_id:         u64,
    pub creator:            Address,
    pub token:              Address,
    pub goal:               i128,   
    pub deadline:           u64,
    pub bond_amount:        i128,   
    pub approval_module:    Address,
    pub identity_registry:  Address,
    pub fee_wallet_address: Address,
    pub fee_percentage:     u64,     
    pub milestones:         Vec<Milestone>,
    pub metadata_cid:       String,
    pub admin:              Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProjectInfo {
    pub project_id:        u64,
    pub creator:           Address,
    pub token:             Address,
    pub goal:              i128,    
    pub raised_amount:     i128,    
    pub deadline:          u64,
    pub bond_amount:       i128,     
    pub bond_posted:       bool,
    pub approval_module:   Address,
    pub identity_registry: Address,
    pub milestones:        Vec<Milestone>,
    pub released_total:    i128,    
    pub fee_wallet_address: Address,
    pub fee_percentage:     u64,    
    pub metadata_cid:       String,
    pub admin:             Address,
}

#[contracttype]
pub enum DataKey {
    State,
    Info,
    ContributorBalance(Address),
    Contributors,
}

#[contractclient(name = "ApprovalModuleClient")]
pub trait ApprovalModuleTrait {
    fn is_approved(env: Env, project_id: u64, milestone_id: u32) -> bool;
    fn is_slash_approved(env: Env, project_id: u64) -> bool;
}

#[contractclient(name = "IdentityRegistryClient")]
pub trait IdentityRegistryTrait {
    fn is_kyc_approved(env: Env, address: Address) -> bool;
}

// HELPERS

#[inline]
fn load_state(env: &Env) -> VaultState {
    env.storage()
        .instance()
        .get(&DataKey::State)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn save_state(env: &Env, state: VaultState) {
    env.storage().instance().set(&DataKey::State, &state);
}

#[inline]
fn load_info(env: &Env) -> ProjectInfo {
    env.storage()
        .instance()
        .get(&DataKey::Info)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn save_info(env: &Env, info: &ProjectInfo) {
    env.storage().instance().set(&DataKey::Info, info);
}

fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

fn contributor_count(env: &Env) -> u32 {
    let list_key = DataKey::Contributors;
    let list: Vec<Address> = env.storage()
        .persistent()
        .get(&list_key)
        .unwrap_or_else(|| Vec::new(env));
    list.len()
}

fn resolve_status(env: &Env) -> VaultState {
    let state = load_state(env);
    if state != VaultState::Raising {
        return state;
    }

    let info = load_info(env);
    let now = env.ledger().timestamp();
    if now >= info.deadline {
        let next_state = if info.raised_amount >= info.goal && info.bond_posted {
            VaultState::Funded
        } else {
            VaultState::Failed
        };

        save_state(env, next_state);

        if next_state == VaultState::Funded {
            env.events().publish(
                (symbol_short!("VAULT"), symbol_short!("FUNDED")),
                (info.project_id, info.raised_amount),
            );
        } else {
            if info.bond_posted && info.bond_amount > 0 {
                let token_client = token::Client::new(env, &info.token);
                token_client.transfer(
                    &env.current_contract_address(),
                    &info.creator,
                    &info.bond_amount,
                );
                env.events().publish(
                    (symbol_short!("BOND"), symbol_short!("RETURNED")),
                    (info.project_id, info.bond_amount),
                );
            }

            env.events().publish(
                (symbol_short!("VAULT"), symbol_short!("FAILED")),
                (info.project_id, info.raised_amount),
            );
        }
        next_state
    } else {
        state
    }
}

// BLKFNDR VAULT

#[contract]
pub struct BlkfndrVault;

#[contractimpl]
impl BlkfndrVault {

    // SETUP

    /// Initialize the vault contract instance with config parameters.
    pub fn initialize(env: Env, config: VaultInitConfig) {
        if env.storage().instance().has(&DataKey::State) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        let kyc_client = IdentityRegistryClient::new(&env, &config.identity_registry);
        if !kyc_client.is_kyc_approved(&config.creator) {
            panic_with_error!(&env, Error::KYCInvalid);
        }

        let mut sum: i128 = 0;
        for i in 0..config.milestones.len() {
            let milestone = config.milestones.get(i).unwrap();
            if milestone.amount <= 0 {
                panic!("Milestone amount must be strictly positive");
            }
            sum = sum.checked_add(milestone.amount).unwrap();
        }
        if sum != config.goal {
            panic_with_error!(&env, Error::InvalidPercentage);
        }

        let info = ProjectInfo {
            project_id: config.project_id,
            creator: config.creator,
            token: config.token,
            goal: config.goal,
            raised_amount: 0,
            deadline: config.deadline,
            bond_amount: config.bond_amount,
            bond_posted: false,
            approval_module: config.approval_module,
            identity_registry: config.identity_registry,
            milestones: config.milestones,
            released_total: 0,
            fee_wallet_address: config.fee_wallet_address,
            fee_percentage: config.fee_percentage,
            metadata_cid: config.metadata_cid.clone(),
            admin: config.admin,
        };

        save_info(&env, &info);
        save_state(&env, VaultState::Raising);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("VAULT"), symbol_short!("INIT")),
            (config.project_id, config.metadata_cid),
        );
    }

    // BOND

    /// Deposit the creator performance bond into the vault.
    pub fn post_bond(env: Env) {
        extend_instance_ttl(&env);
        let state = resolve_status(&env);
        if state != VaultState::Raising {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut info = load_info(&env);
        if info.bond_posted {
            panic_with_error!(&env, Error::GoalAlreadyReached);
        }

        info.creator.require_auth();

        info.bond_posted = true;
        save_info(&env, &info);

        let token_client = token::Client::new(&env, &info.token);
        token_client.transfer(
            &info.creator,
            &env.current_contract_address(),
            &info.bond_amount,
        );

        env.events().publish(
            (symbol_short!("BOND"), symbol_short!("POSTED")),
            (info.project_id, info.bond_amount),
        );
    }

    // RAISE

    /// Record a contribution deposit and charge platform fee.
    pub fn contribute(env: Env, contributor: Address, amount: i128) {
        extend_instance_ttl(&env);
        let state = resolve_status(&env);
        if state != VaultState::Raising {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut info = load_info(&env);
        let now = env.ledger().timestamp();
        if now >= info.deadline {
            panic_with_error!(&env, Error::FundingDeadlinePassed);
        }

        if info.raised_amount >= info.goal || info.raised_amount.checked_add(amount).unwrap() > info.goal {
            panic_with_error!(&env, Error::GoalAlreadyReached);
        }

        contributor.require_auth();

        let fee = amount
            .checked_mul(info.fee_percentage as i128)
            .unwrap()
            .checked_div(10000)
            .unwrap();

        let total = amount.checked_add(fee).unwrap();

        let bal_key = DataKey::ContributorBalance(contributor.clone());
        let mut current_bal: i128 = env.storage().persistent().get(&bal_key).unwrap_or(0);
        current_bal = current_bal.checked_add(amount).unwrap();
        env.storage().persistent().set(&bal_key, &current_bal);
        env.storage().persistent().extend_ttl(&bal_key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        let list_key = DataKey::Contributors;
        let mut list: Vec<Address> = env.storage().persistent().get(&list_key).unwrap_or_else(|| Vec::new(&env));
        let mut exists = false;
        for i in 0..list.len() {
            if list.get(i).unwrap() == contributor {
                exists = true;
                break;
            }
        }
        if !exists {
            list.push_back(contributor.clone());
            env.storage().persistent().set(&list_key, &list);
            env.storage().persistent().extend_ttl(&list_key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
        }

        info.raised_amount = info.raised_amount.checked_add(amount).unwrap();
        save_info(&env, &info);

        let token_client = token::Client::new(&env, &info.token);
        token_client.transfer(
            &contributor,
            &env.current_contract_address(),
            &total,
        );

        env.events().publish(
            (symbol_short!("DEPOSIT"), symbol_short!("CONTRIB")),
            (info.project_id, contributor, amount, info.raised_amount),
        );
    }

    /// Evaluate raising progress and change status to Funded or Failed.
    pub fn finalize_raise(env: Env) {
        extend_instance_ttl(&env);
        let state = load_state(&env);
        if state != VaultState::Raising {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let info = load_info(&env);
        let now = env.ledger().timestamp();
        if now < info.deadline {
            panic_with_error!(&env, Error::NotAuthorized);
        }

        resolve_status(&env);
    }

    /// Manually finalize raising progress early if the goal is met.
    pub fn finalize_funding(env: Env, finalizer: Address) {
        extend_instance_ttl(&env);
        let state = resolve_status(&env);
        if state != VaultState::Raising {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let info = load_info(&env);
        if info.raised_amount < info.goal {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        save_state(&env, VaultState::Funded);

        env.events().publish(
            (symbol_short!("VAULT"), symbol_short!("FUNDED")),
            (info.project_id, info.raised_amount, finalizer),
        );
    }

    // RELEASE

    /// Release milestone tranche amount to creator if approved.
    pub fn release_milestone(env: Env, milestone_id: u32) {
        extend_instance_ttl(&env);
        let state = load_state(&env);
        if state != VaultState::Funded && state != VaultState::Active {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut info = load_info(&env);

        let app_client = ApprovalModuleClient::new(&env, &info.approval_module);
        if !app_client.is_approved(&info.project_id, &milestone_id) {
            panic_with_error!(&env, Error::NotAuthorized);
        }

        let mut found = false;
        let mut updated_milestones = Vec::new(&env);
        let mut tranche_amount: i128 = 0;

        for i in 0..info.milestones.len() {
            let mut m = info.milestones.get(i).unwrap();
            if m.id == milestone_id {
                found = true;
                if m.released {
                    panic_with_error!(&env, Error::MilestoneAlreadyReleased);
                }
                m.released = true;
                tranche_amount = m.amount;
            }
            updated_milestones.push_back(m);
        }

        if !found {
            panic_with_error!(&env, Error::MilestoneNotFound);
        }

        info.milestones = updated_milestones;
        info.released_total = info.released_total.checked_add(tranche_amount).unwrap();

        let next_state = if info.released_total >= info.goal {
            VaultState::Completed
        } else {
            VaultState::Active
        };

        save_state(&env, next_state);
        save_info(&env, &info);

        let token_client = token::Client::new(&env, &info.token);

        token_client.transfer(
            &env.current_contract_address(),
            &info.creator,
            &tranche_amount,
        );

        let fee = tranche_amount
            .checked_mul(info.fee_percentage as i128)
            .unwrap()
            .checked_div(10000)
            .unwrap();

        if fee > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &info.fee_wallet_address,
                &fee,
            );
        }

        if next_state == VaultState::Completed {
            token_client.transfer(
                &env.current_contract_address(),
                &info.creator,
                &info.bond_amount,
            );

            env.events().publish(
                (symbol_short!("BOND"), symbol_short!("RETURNED")),
                (info.project_id, info.bond_amount),
            );
        }

        env.events().publish(
            (symbol_short!("MILESTN"), symbol_short!("RELEASE")),
            (info.project_id, milestone_id, tranche_amount, info.released_total),
        );
    }

    // FAILURE & REFUND

    /// Transition contract to refunding state on default.
    pub fn slash_bond(env: Env) {
        extend_instance_ttl(&env);
        let state = load_state(&env);
        if state != VaultState::Funded && state != VaultState::Active {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let info = load_info(&env);
        let app_client = ApprovalModuleClient::new(&env, &info.approval_module);
        if !app_client.is_slash_approved(&info.project_id) {
            panic_with_error!(&env, Error::NotAuthorized);
        }

        save_state(&env, VaultState::Refunding);

        let recipients = contributor_count(&env);
        env.events().publish(
            (symbol_short!("BOND"), symbol_short!("SLASHED")),
            (info.project_id, info.bond_amount, recipients),
        );
    }

    /// Claim refund of contribution share.
    pub fn claim_refund(env: Env, contributor: Address) {
        extend_instance_ttl(&env);
        let state = resolve_status(&env);
        if state != VaultState::Failed && state != VaultState::Refunding {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        contributor.require_auth();

        let info = load_info(&env);
        let bal_key = DataKey::ContributorBalance(contributor.clone());
        let contribution: i128 = env.storage().persistent().get(&bal_key).unwrap_or(0);
        if contribution == 0 {
            panic_with_error!(&env, Error::NoFundsToRefund);
        }

        env.storage().persistent().remove(&bal_key);

        let fee = contribution
            .checked_mul(info.fee_percentage as i128)
            .unwrap()
            .checked_div(10000)
            .unwrap();

        let refund_total = if state == VaultState::Failed {
            contribution.checked_add(fee).unwrap()
        } else {
            let remaining_contributions = info.raised_amount
                .checked_sub(info.released_total)
                .unwrap();

            let remaining_fees = remaining_contributions
                .checked_mul(info.fee_percentage as i128)
                .unwrap()
                .checked_div(10000)
                .unwrap();

            let contrib_share = if info.raised_amount > 0 {
                contribution
                    .checked_mul(remaining_contributions).unwrap()
                    .checked_div(info.raised_amount).unwrap()
            } else {
                0
            };

            let fee_share = if info.raised_amount > 0 {
                contribution
                    .checked_mul(remaining_fees).unwrap()
                    .checked_div(info.raised_amount).unwrap()
            } else {
                0
            };

            let slash_share = if info.raised_amount > 0 {
                contribution
                    .checked_mul(info.bond_amount).unwrap()
                    .checked_div(info.raised_amount).unwrap()
            } else {
                0
            };

            contrib_share
                .checked_add(fee_share).unwrap()
                .checked_add(slash_share).unwrap()
        };

        let token_client = token::Client::new(&env, &info.token);
        token_client.transfer(
            &env.current_contract_address(),
            &contributor,
            &refund_total,
        );

        env.events().publish(
            (symbol_short!("DEPOSIT"), symbol_short!("REFUND")),
            (info.project_id, contributor, refund_total),
        );
    }

    // GETTERS

    /// Get current vault lifecycle state.
    pub fn get_state(env: Env) -> VaultState {
        resolve_status(&env)
    }

    /// Get project vault configuration and stats.
    pub fn get_info(env: Env) -> ProjectInfo {
        resolve_status(&env);
        load_info(&env)
    }

    /// Get contribution balance of a backer.
    pub fn get_balance(env: Env, contributor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::ContributorBalance(contributor))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
