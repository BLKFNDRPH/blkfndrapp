#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype, contractclient,
    panic_with_error, symbol_short, Address, Env, BytesN, Vec, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized      = 1,
    AlreadyInitialized = 10,
    NotInitialized     = 11,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

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
pub struct CreateVaultConfig {
    pub creator:            Address,
    pub token:              Address,
    pub goal:               i128,    
    pub deadline:           u64,
    pub bond_amount:        i128,    
    pub approval_module:    Address,
    pub identity_registry:  Address,
    pub milestones:         Vec<Milestone>,
    pub metadata_cid:       String,
}

#[contracttype]
pub enum DataKey {
    Admin,
    VaultWasmHash,
    ProjectVaultMap(u64),
    ProjectCounter,
    FeeWalletAddress,
    FeePercentage,
    MinBondPercentage,
}

#[contractclient(name = "BlkfndrVaultClient")]
pub trait BlkfndrVaultTrait {
    fn initialize(
        env: Env,
        config: VaultInitConfig,
    );
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
fn load_wasm_hash(env: &Env) -> BytesN<32> {
    env.storage()
        .instance()
        .get(&DataKey::VaultWasmHash)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn load_fee_wallet(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::FeeWalletAddress)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn load_fee_percentage(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::FeePercentage)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn load_bond_percentage(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::MinBondPercentage)
        .unwrap_or(500) // Default to 5.00% (500 bps)
}

fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

// VAULT FACTORY

#[contract]
pub struct BlkfndrFactory;

#[contractimpl]
impl BlkfndrFactory {

    // SETUP

    /// Initialize the factory with an admin address, vault contract WASM hash, platform fee wallet, and platform fee percentage.
    pub fn initialize(env: Env, admin: Address, vault_wasm_hash: BytesN<32>, fee_wallet: Address, fee_percentage: u64) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        if fee_percentage > 1000 {
            panic!("Fee percentage exceeds 10% platform safety cap");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VaultWasmHash, &vault_wasm_hash);
        env.storage().instance().set(&DataKey::ProjectCounter, &0u64);
        env.storage().instance().set(&DataKey::FeeWalletAddress, &fee_wallet);
        env.storage().instance().set(&DataKey::FeePercentage, &fee_percentage);
        extend_instance_ttl(&env);
    }

    // VAULT DEPLOYMENT

    /// Deploy and initialize a new project vault contract instance.
    pub fn create_vault(
        env:    Env,
        config: CreateVaultConfig,
    ) -> Address {
        extend_instance_ttl(&env);
        config.creator.require_auth();

        let min_bond_pct = load_bond_percentage(&env);
        let min_bond = (config.goal * min_bond_pct as i128) / 10000;
        if config.bond_amount < min_bond {
            panic!("Bond amount is below the minimum required bond percentage");
        }

        let mut counter: u64 = env.storage().instance().get(&DataKey::ProjectCounter).unwrap_or(0);
        counter = counter.checked_add(1).unwrap();
        env.storage().instance().set(&DataKey::ProjectCounter, &counter);

        let wasm_hash = load_wasm_hash(&env);

        let mut salt_bytes = soroban_sdk::Bytes::new(&env);
        for b in counter.to_be_bytes().iter() {
            salt_bytes.push_back(*b);
        }
        let salt = env.crypto().sha256(&salt_bytes);

        let vault_address = env.deployer().with_current_contract(salt).deploy(wasm_hash);

        let vault_client = BlkfndrVaultClient::new(&env, &vault_address);
        let admin = load_admin(&env);
        let fee_wallet = load_fee_wallet(&env);
        let fee_percentage = load_fee_percentage(&env);
        let vault_config = VaultInitConfig {
            project_id: counter,
            creator: config.creator.clone(),
            token: config.token,
            goal: config.goal,
            deadline: config.deadline,
            bond_amount: config.bond_amount,
            approval_module: config.approval_module,
            identity_registry: config.identity_registry,
            fee_wallet_address: fee_wallet,
            fee_percentage: fee_percentage,
            milestones: config.milestones,
            metadata_cid: config.metadata_cid.clone(),
            admin,
        };
        vault_client.initialize(&vault_config);

        let map_key = DataKey::ProjectVaultMap(counter);
        env.storage().persistent().set(&map_key, &vault_address);
        env.storage().persistent().extend_ttl(&map_key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("DEPLOY")),
            (counter, vault_address.clone(), config.creator, config.metadata_cid),
        );

        vault_address
    }

    /// Retrieve the registered vault address for the given project ID.
    pub fn get_vault(env: Env, project_id: u64) -> Address {
        let map_key = DataKey::ProjectVaultMap(project_id);
        env.storage()
            .persistent()
            .get(&map_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    // ADMIN GOVERNANCE

    /// Update the registered vault contract WASM hash.
    pub fn update_wasm_hash(env: Env, new_hash: BytesN<32>) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::VaultWasmHash, &new_hash);

        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("UPGRADE")),
            (admin, new_hash),
        );
    }

    /// Update the platform fee payout destination address.
    pub fn update_fee_wallet(env: Env, new_fee_wallet: Address) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::FeeWalletAddress, &new_fee_wallet);

        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("WALLET")),
            (admin, new_fee_wallet),
        );
    }

    /// Update the platform fee percentage (safety ceiling of 10.0% / 1000 bps).
    pub fn update_fee_percentage(env: Env, new_percentage: u64) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        if new_percentage > 1000 {
            panic!("Fee percentage exceeds 10% platform safety cap");
        }

        env.storage().instance().set(&DataKey::FeePercentage, &new_percentage);

        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("PERCENT")),
            (admin, new_percentage),
        );
    }

    /// Update the minimum performance bond percentage 
    pub fn update_bond_percentage(env: Env, new_percentage: u64) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        if new_percentage > 10000 {
            panic!("Bond percentage cannot exceed 100%");
        }

        env.storage().instance().set(&DataKey::MinBondPercentage, &new_percentage);

        env.events().publish(
            (symbol_short!("FACTORY"), symbol_short!("BOND_PCT")),
            (admin, new_percentage),
        );
    }

    // GETTERS

    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    pub fn get_fee_wallet(env: Env) -> Address {
        load_fee_wallet(&env)
    }

    pub fn get_fee_percentage(env: Env) -> u64 {
        load_fee_percentage(&env)
    }

    pub fn get_bond_percentage(env: Env) -> u64 {
        load_bond_percentage(&env)
    }
}

#[cfg(test)]
mod test;
