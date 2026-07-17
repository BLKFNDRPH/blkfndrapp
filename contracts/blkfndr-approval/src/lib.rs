#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype,
    panic_with_error, symbol_short, Address, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized        = 1,
    AlreadyInitialized   = 10,
    NotInitialized       = 11,
    InvalidThreshold     = 12,
    NotASigner           = 13,
    AlreadyApproved      = 14,
    SignerAlreadyExists   = 15,
    SignerNotFound        = 16,
    ThresholdExceedsSigners = 17,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

#[contracttype]
pub enum DataKey {
    Admin,
    Signers,
    Threshold,
    MilestoneApproval(u64, u32),
    SlashApproval(u64),
}

// HELPERS

#[inline]
fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn load_signers(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Signers)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn load_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::Threshold)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

fn is_signer(env: &Env, addr: &Address) -> bool {
    let signers = load_signers(env);
    for i in 0..signers.len() {
        if signers.get(i).unwrap() == *addr {
            return true;
        }
    }
    false
}

fn has_approved(approvals: &Vec<Address>, addr: &Address) -> bool {
    for i in 0..approvals.len() {
        if approvals.get(i).unwrap() == *addr {
            return true;
        }
    }
    false
}

// MULTISIG APPROVAL

#[contract]
pub struct MultisigApproval;

#[contractimpl]
impl MultisigApproval {

    // SETUP

    /// Initialize the approval module with an admin, list of signers, and threshold.
    pub fn initialize(env: Env, admin: Address, signers: Vec<Address>, threshold: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        if threshold == 0 || threshold > signers.len() {
            panic_with_error!(&env, Error::InvalidThreshold);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("APPROVAL"), symbol_short!("INIT")),
            (admin, threshold, signers.len()),
        );
    }

    // MILESTONE APPROVAL

    /// Record a signer's approval for a milestone in a project.
    pub fn approve_milestone(env: Env, signer: Address, project_id: u64, milestone_id: u32) {
        extend_instance_ttl(&env);
        signer.require_auth();

        if !is_signer(&env, &signer) {
            panic_with_error!(&env, Error::NotASigner);
        }

        let key = DataKey::MilestoneApproval(project_id, milestone_id);
        let mut approvals: Vec<Address> = env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        if has_approved(&approvals, &signer) {
            panic_with_error!(&env, Error::AlreadyApproved);
        }

        approvals.push_back(signer.clone());
        env.storage().persistent().set(&key, &approvals);
        env.storage().persistent().extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        env.events().publish(
            (symbol_short!("APPROVAL"), symbol_short!("MILE")),
            (project_id, milestone_id, signer, approvals.len()),
        );
    }

    /// Check if a milestone has reached the required threshold of approvals.
    pub fn is_approved(env: Env, project_id: u64, milestone_id: u32) -> bool {
        let threshold = load_threshold(&env);
        let key = DataKey::MilestoneApproval(project_id, milestone_id);
        let approvals: Vec<Address> = env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        approvals.len() >= threshold
    }

    // SLASH APPROVAL

    /// Record a signer's approval to slash a project's performance bond.
    pub fn approve_slash(env: Env, signer: Address, project_id: u64) {
        extend_instance_ttl(&env);
        signer.require_auth();

        if !is_signer(&env, &signer) {
            panic_with_error!(&env, Error::NotASigner);
        }

        let key = DataKey::SlashApproval(project_id);
        let mut approvals: Vec<Address> = env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        if has_approved(&approvals, &signer) {
            panic_with_error!(&env, Error::AlreadyApproved);
        }

        approvals.push_back(signer.clone());
        env.storage().persistent().set(&key, &approvals);
        env.storage().persistent().extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        env.events().publish(
            (symbol_short!("APPROVAL"), symbol_short!("SLASH")),
            (project_id, signer, approvals.len()),
        );
    }

    /// Check if a slash request has reached the required threshold of approvals.
    pub fn is_slash_approved(env: Env, project_id: u64) -> bool {
        let threshold = load_threshold(&env);
        let key = DataKey::SlashApproval(project_id);
        let approvals: Vec<Address> = env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        approvals.len() >= threshold
    }

    // SIGNER MANAGEMENT

    /// Add a new signer to the authorized multisig set.
    pub fn add_signer(env: Env, new_signer: Address) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        let mut signers = load_signers(&env);

        for i in 0..signers.len() {
            if signers.get(i).unwrap() == new_signer {
                panic_with_error!(&env, Error::SignerAlreadyExists);
            }
        }

        signers.push_back(new_signer.clone());
        env.storage().instance().set(&DataKey::Signers, &signers);

        env.events().publish(
            (symbol_short!("APPROVAL"), symbol_short!("ADD_SIG")),
            new_signer,
        );
    }

    /// Remove a signer from the authorized multisig set.
    pub fn remove_signer(env: Env, signer: Address) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        let signers = load_signers(&env);
        let threshold = load_threshold(&env);

        let mut found = false;
        let mut new_signers = Vec::new(&env);

        for i in 0..signers.len() {
            let s = signers.get(i).unwrap();
            if s == signer {
                found = true;
            } else {
                new_signers.push_back(s);
            }
        }

        if !found {
            panic_with_error!(&env, Error::SignerNotFound);
        }

        if new_signers.len() < threshold {
            panic_with_error!(&env, Error::ThresholdExceedsSigners);
        }

        env.storage().instance().set(&DataKey::Signers, &new_signers);

        env.events().publish(
            (symbol_short!("APPROVAL"), symbol_short!("RM_SIG")),
            signer,
        );
    }

    /// Update the multisig threshold required for approval.
    pub fn update_threshold(env: Env, new_threshold: u32) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        let signers = load_signers(&env);
        if new_threshold == 0 || new_threshold > signers.len() {
            panic_with_error!(&env, Error::InvalidThreshold);
        }

        env.storage().instance().set(&DataKey::Threshold, &new_threshold);

        env.events().publish(
            (symbol_short!("APPROVAL"), symbol_short!("THRESH")),
            new_threshold,
        );
    }

    // GETTERS
    pub fn get_signers(env: Env) -> Vec<Address> {
        load_signers(&env)
    }

    pub fn get_threshold(env: Env) -> u32 {
        load_threshold(&env)
    }

    pub fn get_milestone_approvals(env: Env, project_id: u64, milestone_id: u32) -> Vec<Address> {
        let key = DataKey::MilestoneApproval(project_id, milestone_id);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_slash_approvals(env: Env, project_id: u64) -> Vec<Address> {
        let key = DataKey::SlashApproval(project_id);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env))
    }
}

#[cfg(test)]
mod test;
