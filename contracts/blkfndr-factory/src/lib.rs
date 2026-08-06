#![no_std]
// Contract entrypoints are an ABI: their parameters are the wire format, and
// bundling them into structs to satisfy an argument-count lint would only move
// the same fields behind a type that every caller must then construct.
#![allow(clippy::too_many_arguments)]

//! Deploys and registers BLKFNDR bonded vaults.
//!
//! The factory is the sole source of the platform-level addresses a vault
//! trusts — the identity registry and the attestation registry. Taking those
//! from the caller, as an earlier version did, let a builder deploy a vault
//! wired to contracts they controlled: KYC that always passes, and later an
//! approval oracle that always says yes. Anything a contributor relies on for
//! protection is pinned here, alongside the fee wallet and fee that were
//! already handled this way.
//!
//! The factory has no role in moving money. It cannot release a tranche, block
//! a refund, or touch a vault's balance.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, BytesN, Env, String, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized        = 1,
    AlreadyInitialized   = 10,
    NotInitialized       = 11,
    BondBelowMinimum     = 12,
    InvalidConfiguration = 13,
    VaultNotFound        = 14,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

/// Platform-wide ceiling on the flat listing fee, in stroops. Ten thousand
/// units at 7 decimals. A flat fee cannot scale with the raise by
/// construction, but a bound keeps a compromised admin from setting an
/// absurd one.
const MAX_PLATFORM_FEE: i128 = 10_000 * 10_000_000;

#[contracttype]
#[derive(Clone, Debug)]
pub struct MilestoneInput {
    pub id:     u32,
    pub amount: i128,
}

/// What the vault is constructed with. Every platform address here comes from
/// factory storage, never from the caller.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultInitConfig {
    pub project_id:           u64,
    pub creator:              Address,
    pub token:                Address,
    pub goal:                 i128,
    pub deadline:             u64,
    pub bond_amount:          i128,
    pub identity_registry:    Address,
    pub attestation_registry: Address,
    pub factory:              Address,
    pub fee_wallet_address:   Address,
    pub platform_fee:         i128,
    pub voting_window_secs:   u64,
    pub min_contribution:     i128,
    pub milestones:           Vec<MilestoneInput>,
    pub metadata_cid:         String,
}

/// What a builder supplies. Deliberately has no field for the identity or
/// attestation registry.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CreateVaultConfig {
    pub creator:      Address,
    pub token:        Address,
    pub goal:         i128,
    pub deadline:     u64,
    pub bond_amount:  i128,
    pub milestones:   Vec<MilestoneInput>,
    pub metadata_cid: String,
}

#[contracttype]
pub enum DataKey {
    Admin,
    VaultWasmHash,
    ProjectVaultMap(u64),
    ProjectCounter,
    FeeWalletAddress,
    /// Flat fee charged once to the builder, in stroops.
    PlatformFee,
    MinBondPercentage,
    IdentityRegistry,
    AttestationRegistry,
    VotingWindowSecs,
    MinContribution,
    /// Marks an address as a vault this factory deployed.
    IsVault(Address),
}

#[contractclient(name = "BlkfndrVaultClient")]
pub trait BlkfndrVaultTrait {
    fn initialize(env: Env, config: VaultInitConfig);
}

// ── HELPERS ────────────────────────────────────────────────────────────────

#[inline]
fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn require_admin(env: &Env) -> Address {
    let admin = load_admin(env);
    admin.require_auth();
    admin
}

#[inline]
fn load_or_fail<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &DataKey,
) -> T {
    env.storage()
        .instance()
        .get(key)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

// ── FACTORY ────────────────────────────────────────────────────────────────

#[contract]
pub struct BlkfndrFactory;

#[contractimpl]
impl BlkfndrFactory {
    /// Configure the factory. `admin` must authorise, so a deployed but
    /// unconfigured factory cannot be claimed by whoever spots it first.
    pub fn initialize(
        env:                  Env,
        admin:                Address,
        vault_wasm_hash:      BytesN<32>,
        fee_wallet:           Address,
        platform_fee:         i128,
        identity_registry:    Address,
        attestation_registry: Address,
        voting_window_secs:   u64,
        min_contribution:     i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();

        if !(0..=MAX_PLATFORM_FEE).contains(&platform_fee)
            || voting_window_secs == 0
            || min_contribution <= 0
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }

        let storage = env.storage().instance();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::VaultWasmHash, &vault_wasm_hash);
        storage.set(&DataKey::ProjectCounter, &0u64);
        storage.set(&DataKey::FeeWalletAddress, &fee_wallet);
        storage.set(&DataKey::PlatformFee, &platform_fee);
        storage.set(&DataKey::IdentityRegistry, &identity_registry);
        storage.set(&DataKey::AttestationRegistry, &attestation_registry);
        storage.set(&DataKey::VotingWindowSecs, &voting_window_secs);
        storage.set(&DataKey::MinContribution, &min_contribution);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("INIT")),
            (admin, platform_fee),
        );
    }

    /// Deploy a vault for a project and lock the builder's bond in the same
    /// transaction.
    pub fn create_vault(env: Env, config: CreateVaultConfig) -> Address {
        extend_instance_ttl(&env);
        config.creator.require_auth();

        if config.goal <= 0 || config.milestones.is_empty() {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        if config.deadline <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }

        let min_bond_pct: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MinBondPercentage)
            .unwrap_or(500); // 5.00%
        let min_bond = config
            .goal
            .checked_mul(min_bond_pct as i128)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        if config.bond_amount < min_bond {
            panic_with_error!(&env, Error::BondBelowMinimum);
        }

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProjectCounter)
            .unwrap_or(0);
        counter = counter.checked_add(1).unwrap();
        env.storage()
            .instance()
            .set(&DataKey::ProjectCounter, &counter);

        let wasm_hash: BytesN<32> = load_or_fail(&env, &DataKey::VaultWasmHash);

        let mut salt_bytes = soroban_sdk::Bytes::new(&env);
        for b in counter.to_be_bytes().iter() {
            salt_bytes.push_back(*b);
        }
        let salt = env.crypto().sha256(&salt_bytes);

        let vault_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());

        // Registered before initialize so the vault can write its attestation
        // later: the registry asks us whether the caller is one of ours.
        env.storage()
            .persistent()
            .set(&DataKey::IsVault(vault_address.clone()), &true);
        env.storage().persistent().extend_ttl(
            &DataKey::IsVault(vault_address.clone()),
            LEDGERS_TO_LIVE,
            LEDGERS_TO_LIVE,
        );

        let vault_config = VaultInitConfig {
            project_id:           counter,
            creator:              config.creator.clone(),
            token:                config.token,
            goal:                 config.goal,
            deadline:             config.deadline,
            bond_amount:          config.bond_amount,
            // Platform-controlled, every one of them.
            identity_registry:    load_or_fail(&env, &DataKey::IdentityRegistry),
            attestation_registry: load_or_fail(&env, &DataKey::AttestationRegistry),
            factory:              env.current_contract_address(),
            fee_wallet_address:   load_or_fail(&env, &DataKey::FeeWalletAddress),
            platform_fee:         load_or_fail(&env, &DataKey::PlatformFee),
            voting_window_secs:   load_or_fail(&env, &DataKey::VotingWindowSecs),
            min_contribution:     load_or_fail(&env, &DataKey::MinContribution),
            milestones:           config.milestones,
            metadata_cid:         config.metadata_cid.clone(),
        };

        BlkfndrVaultClient::new(&env, &vault_address).initialize(&vault_config);

        let map_key = DataKey::ProjectVaultMap(counter);
        env.storage().persistent().set(&map_key, &vault_address);
        env.storage()
            .persistent()
            .extend_ttl(&map_key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("DEPLOY")),
            (
                counter,
                vault_address.clone(),
                config.creator,
                config.metadata_cid,
            ),
        );

        vault_address
    }

    /// Whether this factory deployed the given address. The attestation
    /// registry calls this to decide whether a record is genuine.
    pub fn is_vault(env: Env, address: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::IsVault(address))
            .unwrap_or(false)
    }

    pub fn get_vault(env: Env, project_id: u64) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::ProjectVaultMap(project_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::VaultNotFound))
    }

    // ── ADMIN ──────────────────────────────────────────────────────────────
    //
    // These affect vaults deployed from here on. A vault's configuration is
    // fixed at construction, so no admin action can change the terms a
    // contributor already backed.

    pub fn update_wasm_hash(env: Env, new_hash: BytesN<32>) {
        extend_instance_ttl(&env);
        let admin = require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::VaultWasmHash, &new_hash);
        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("UPGRADE")),
            (admin, new_hash),
        );
    }

    pub fn update_fee_wallet(env: Env, new_fee_wallet: Address) {
        extend_instance_ttl(&env);
        let admin = require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::FeeWalletAddress, &new_fee_wallet);
        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("WALLET")),
            (admin, new_fee_wallet),
        );
    }

    /// Set the flat listing fee, in stroops. There is deliberately no
    /// percentage-of-funds setting to reach for.
    pub fn update_platform_fee(env: Env, new_fee: i128) {
        extend_instance_ttl(&env);
        let admin = require_admin(&env);
        if !(0..=MAX_PLATFORM_FEE).contains(&new_fee) {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        env.storage().instance().set(&DataKey::PlatformFee, &new_fee);
        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("FEE")),
            (admin, new_fee),
        );
    }

    pub fn update_bond_percentage(env: Env, new_percentage: u64) {
        extend_instance_ttl(&env);
        let admin = require_admin(&env);
        if new_percentage > 10_000 {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        env.storage()
            .instance()
            .set(&DataKey::MinBondPercentage, &new_percentage);
        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("BOND_PCT")),
            (admin, new_percentage),
        );
    }

    pub fn update_identity_registry(env: Env, new_registry: Address) {
        extend_instance_ttl(&env);
        let admin = require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::IdentityRegistry, &new_registry);
        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("IDENTITY")),
            (admin, new_registry),
        );
    }

    pub fn update_voting_window(env: Env, new_window_secs: u64) {
        extend_instance_ttl(&env);
        let admin = require_admin(&env);
        if new_window_secs == 0 {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        env.storage()
            .instance()
            .set(&DataKey::VotingWindowSecs, &new_window_secs);
        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("VOTEWIN")),
            (admin, new_window_secs),
        );
    }

    pub fn update_min_contribution(env: Env, new_minimum: i128) {
        extend_instance_ttl(&env);
        let admin = require_admin(&env);
        if new_minimum <= 0 {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }
        env.storage()
            .instance()
            .set(&DataKey::MinContribution, &new_minimum);
        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("MINCONTR")),
            (admin, new_minimum),
        );
    }

    pub fn transfer_admin(env: Env, new_admin: Address) {
        extend_instance_ttl(&env);
        require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("ADMIN_TX")),
            new_admin,
        );
    }

    // ── GETTERS ────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    pub fn get_fee_wallet(env: Env) -> Address {
        load_or_fail(&env, &DataKey::FeeWalletAddress)
    }

    pub fn get_platform_fee(env: Env) -> i128 {
        load_or_fail(&env, &DataKey::PlatformFee)
    }

    pub fn get_bond_percentage(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MinBondPercentage)
            .unwrap_or(500)
    }

    pub fn get_identity_registry(env: Env) -> Address {
        load_or_fail(&env, &DataKey::IdentityRegistry)
    }

    pub fn get_attestation_registry(env: Env) -> Address {
        load_or_fail(&env, &DataKey::AttestationRegistry)
    }

    pub fn get_voting_window(env: Env) -> u64 {
        load_or_fail(&env, &DataKey::VotingWindowSecs)
    }

    pub fn get_min_contribution(env: Env) -> i128 {
        load_or_fail(&env, &DataKey::MinContribution)
    }

    pub fn get_project_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProjectCounter)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
