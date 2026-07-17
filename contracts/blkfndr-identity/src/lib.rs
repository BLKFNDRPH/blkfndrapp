#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype,
    panic_with_error, symbol_short, Address, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized      = 1,
    AlreadyInitialized = 10,
    NotInitialized     = 11,
    AlreadyAttested    = 12,
    NotAttested        = 13,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

#[contracttype]
pub enum DataKey {
    Admin,
    Attestation(Address),
}

// HELPERS

#[inline]
fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

// IDENTITY REGISTRY

#[contract]
pub struct IdentityRegistry;

#[contractimpl]
impl IdentityRegistry {

    // SETUP

    /// Initialize the registry with an admin address.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("INIT")),
            admin,
        );
    }

    // ATTESTATION MANAGEMENT

    /// Record a KYC attestation hash for an address.
    pub fn attest(env: Env, address: Address, kyc_hash: BytesN<32>) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        let key = DataKey::Attestation(address.clone());

        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyAttested);
        }

        env.storage().persistent().set(&key, &kyc_hash);
        env.storage().persistent().extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("ATTEST")),
            (address, kyc_hash),
        );
    }

    /// Revoke a KYC attestation for an address.
    pub fn revoke(env: Env, address: Address) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        let key = DataKey::Attestation(address.clone());

        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::NotAttested);
        }

        env.storage().persistent().remove(&key);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("REVOKE")),
            address,
        );
    }

    // QUERIES

    /// Check if the address has a valid KYC attestation on file.
    pub fn is_kyc_approved(env: Env, address: Address) -> bool {
        let key = DataKey::Attestation(address);
        env.storage().persistent().has(&key)
    }

    /// Retrieve the KYC attestation hash for the given address.
    pub fn get_attestation(env: Env, address: Address) -> BytesN<32> {
        let key = DataKey::Attestation(address);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotAttested))
    }
}

#[cfg(test)]
mod test;
