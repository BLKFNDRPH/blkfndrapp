#![no_std]

//! Platform administrator roster.
//!
//! This is the on-chain answer to a single question: who is a platform admin?
//! The application reads it to decide who sees the admin console and to mirror
//! the result into Supabase `app_metadata`, where RLS policies can act on it.
//!
//! It holds no funds and gates nothing that moves money. Milestone release is
//! decided by contributors, weighted by contribution, inside blkfndr-vault; no
//! address listed here can release a tranche, block a refund, or touch a
//! vault's balance.
//!
//! It replaces blkfndr-approval, which carried milestone and slash approval
//! machinery that became dead the moment release moved into the vault. That
//! machinery was not merely unused: `remove_signer` never purged a removed
//! signer's recorded approvals, so their vote kept counting, and lowering the
//! threshold could retroactively approve a pending milestone. Deleting the
//! feature removes the whole class of bug rather than patching two instances
//! of it.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized      = 1,
    // 10 was AlreadyInitialized; the constructor makes re-init impossible, so
    // the guard and its code are gone. Reserved gap for ABI stability.
    NotInitialized     = 11,
    AlreadyAnAdmin     = 12,
    NotAnAdmin         = 13,
    /// The owner may not remove themselves, which would leave the roster with
    /// nobody able to change it.
    WouldOrphanRoster  = 14,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

#[contracttype]
pub enum DataKey {
    /// The account that may add and remove admins.
    Owner,
    Admins,
}

#[inline]
fn load_owner(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Owner)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn load_admins(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Admins)
        .unwrap_or_else(|| Vec::new(env))
}

fn require_owner(env: &Env) -> Address {
    let owner = load_owner(env);
    owner.require_auth();
    owner
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

fn index_of(admins: &Vec<Address>, target: &Address) -> Option<u32> {
    admins.first_index_of(target)
}

#[contract]
pub struct AdminRegistry;

#[contractimpl]
impl AdminRegistry {
    /// Bind the roster to an owner, who becomes its first admin — atomically at
    /// deploy.
    ///
    /// A constructor runs inside the deploy transaction, so a
    /// deployed-but-unconfigured registry can never be claimed by whoever
    /// notices it first. `owner` must authorise the deploy.
    pub fn __constructor(env: Env, owner: Address) {
        owner.require_auth();

        let mut admins = Vec::new(&env);
        admins.push_back(owner.clone());

        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Admins, &admins);
        extend_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("ADMIN"), symbol_short!("INIT")), owner);
    }

    pub fn add_admin(env: Env, account: Address) {
        extend_instance_ttl(&env);
        require_owner(&env);

        let mut admins = load_admins(&env);
        if index_of(&admins, &account).is_some() {
            panic_with_error!(&env, Error::AlreadyAnAdmin);
        }

        admins.push_back(account.clone());
        env.storage().instance().set(&DataKey::Admins, &admins);

        env.events()
            .publish((symbol_short!("ADMIN"), symbol_short!("ADDED")), account);
    }

    pub fn remove_admin(env: Env, account: Address) {
        extend_instance_ttl(&env);
        let owner = require_owner(&env);

        // Removing the owner would leave a roster nobody can change, since only
        // the owner may edit it.
        if account == owner {
            panic_with_error!(&env, Error::WouldOrphanRoster);
        }

        let mut admins = load_admins(&env);
        match index_of(&admins, &account) {
            Some(i) => {
                admins.remove(i);
                env.storage().instance().set(&DataKey::Admins, &admins);
            }
            None => panic_with_error!(&env, Error::NotAnAdmin),
        }

        env.events()
            .publish((symbol_short!("ADMIN"), symbol_short!("REMOVED")), account);
    }

    /// Hand the roster to a new owner, who is added as an admin if not already.
    pub fn transfer_ownership(env: Env, new_owner: Address) {
        extend_instance_ttl(&env);
        require_owner(&env);

        let mut admins = load_admins(&env);
        if index_of(&admins, &new_owner).is_none() {
            admins.push_back(new_owner.clone());
            env.storage().instance().set(&DataKey::Admins, &admins);
        }
        env.storage().instance().set(&DataKey::Owner, &new_owner);

        env.events().publish(
            (symbol_short!("ADMIN"), symbol_short!("OWNER_TX")),
            new_owner,
        );
    }

    // ── QUERIES ────────────────────────────────────────────────────────────

    pub fn is_admin(env: Env, account: Address) -> bool {
        index_of(&load_admins(&env), &account).is_some()
    }

    pub fn get_admins(env: Env) -> Vec<Address> {
        load_admins(&env)
    }

    pub fn get_owner(env: Env) -> Address {
        load_owner(&env)
    }

    pub fn admin_count(env: Env) -> u32 {
        load_admins(&env).len()
    }
}

#[cfg(test)]
mod test;
