#![no_std]

//! Builder completion attestation registry.
//!
//! Every vault writes exactly one record here when it closes, successfully or
//! otherwise. The result is a permanent, portable accountability history keyed
//! by builder address that other contracts can read directly.
//!
//! Immutability is structural, not a matter of access control: this contract
//! exposes no entrypoint that updates or deletes a record, and `attest` refuses
//! to overwrite one that already exists. There is nothing an admin — or anyone
//! else — can call to rewrite history.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized     = 2,
    NotAVault          = 3,
    AlreadyAttested    = 4,
    RecordNotFound     = 5,
    InvalidRecord      = 6,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

/// How a project ended.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Outcome {
    /// Every milestone was approved by contributors and released.
    Completed = 0,
    /// A milestone failed; the performance bond was forfeited to contributors.
    FailedWithForfeiture = 1,
    /// The funding goal was never met; contributions were returned and the bond
    /// went back to the builder. No fault attaches to the builder here.
    FailedToFund = 2,
}

/// The permanent record of one project's outcome.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Attestation {
    pub builder:             Address,
    pub vault:               Address,
    pub project_id:          u64,
    pub outcome:             Outcome,
    pub total_raised:        i128,
    pub bond_posted:         i128,
    pub milestones_total:    u32,
    pub milestones_approved: u32,
    pub closed_at:           u64,
}

#[contracttype]
pub enum DataKey {
    /// The factory whose vaults are permitted to write.
    Factory,
    /// Attestation for a given project id.
    Record(u64),
    /// Every project id a builder has closed.
    BuilderProjects(Address),
}

/// Read-side of the factory: lets this registry confirm that a caller claiming
/// to be a vault was genuinely deployed by the factory we trust.
#[contractclient(name = "FactoryClient")]
pub trait FactoryTrait {
    fn is_vault(env: Env, address: Address) -> bool;
}

#[inline]
fn load_factory(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Factory)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

#[contract]
pub struct AttestationRegistry;

#[contractimpl]
impl AttestationRegistry {
    /// Bind the registry to the factory whose vaults may write records.
    ///
    /// `admin` must authorize, so the binding cannot be front-run by whoever
    /// notices the deployed-but-uninitialized contract first.
    pub fn initialize(env: Env, admin: Address, factory: Address) {
        if env.storage().instance().has(&DataKey::Factory) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Factory, &factory);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("ATTEST"), symbol_short!("INIT")),
            factory,
        );
    }

    /// Write a project's closing record. Callable only by a vault the trusted
    /// factory deployed, and only once per project.
    ///
    /// Deliberately absent: any way to amend or remove what this writes.
    pub fn attest(
        env:                 Env,
        vault:               Address,
        builder:             Address,
        project_id:          u64,
        outcome:             Outcome,
        total_raised:        i128,
        bond_posted:         i128,
        milestones_total:    u32,
        milestones_approved: u32,
    ) {
        extend_instance_ttl(&env);

        // The vault authorizes its own call, and the factory confirms the vault
        // is one of its own. Either check alone would be insufficient: the first
        // lets any contract self-authorize, the second lets anyone name a real
        // vault address they do not control.
        vault.require_auth();

        let factory = load_factory(&env);
        let factory_client = FactoryClient::new(&env, &factory);
        if !factory_client.is_vault(&vault) {
            panic_with_error!(&env, Error::NotAVault);
        }

        if total_raised < 0 || bond_posted < 0 || milestones_approved > milestones_total {
            panic_with_error!(&env, Error::InvalidRecord);
        }

        let key = DataKey::Record(project_id);
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyAttested);
        }

        let record = Attestation {
            builder: builder.clone(),
            vault,
            project_id,
            outcome,
            total_raised,
            bond_posted,
            milestones_total,
            milestones_approved,
            closed_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        let index_key = DataKey::BuilderProjects(builder.clone());
        let mut projects: Vec<u64> = env
            .storage()
            .persistent()
            .get(&index_key)
            .unwrap_or_else(|| Vec::new(&env));
        projects.push_back(project_id);
        env.storage().persistent().set(&index_key, &projects);
        env.storage()
            .persistent()
            .extend_ttl(&index_key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        env.events().publish(
            (symbol_short!("ATTEST"), symbol_short!("RECORDED")),
            (
                builder,
                project_id,
                outcome as u32,
                total_raised,
                bond_posted,
                milestones_approved,
                record.closed_at,
            ),
        );
    }

    // QUERIES

    pub fn get_record(env: Env, project_id: u64) -> Attestation {
        env.storage()
            .persistent()
            .get(&DataKey::Record(project_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RecordNotFound))
    }

    pub fn has_record(env: Env, project_id: u64) -> bool {
        env.storage().persistent().has(&DataKey::Record(project_id))
    }

    /// Every project id this builder has closed, in the order they closed.
    pub fn get_builder_projects(env: Env, builder: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::BuilderProjects(builder))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Full history for a builder. This is what a grant programme, lender, or
    /// launchpad reads to decide whether to take someone on.
    pub fn get_builder_history(env: Env, builder: Address) -> Vec<Attestation> {
        let ids = Self::get_builder_projects(env.clone(), builder);
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            if let Some(record) = env.storage().persistent().get::<DataKey, Attestation>(&DataKey::Record(id)) {
                out.push_back(record);
            }
        }
        out
    }

    /// Compact reputation summary: (completed, failed_with_forfeiture, failed_to_fund).
    pub fn get_builder_summary(env: Env, builder: Address) -> (u32, u32, u32) {
        let history = Self::get_builder_history(env, builder);
        let mut completed = 0u32;
        let mut forfeited = 0u32;
        let mut unfunded = 0u32;
        for record in history.iter() {
            match record.outcome {
                Outcome::Completed => completed += 1,
                Outcome::FailedWithForfeiture => forfeited += 1,
                Outcome::FailedToFund => unfunded += 1,
            }
        }
        (completed, forfeited, unfunded)
    }

    pub fn get_factory(env: Env) -> Address {
        load_factory(&env)
    }
}

#[cfg(test)]
mod test;
