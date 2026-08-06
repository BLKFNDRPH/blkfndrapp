#![no_std]
// Contract entrypoints are an ABI: their parameters are the wire format, and
// bundling them into structs to satisfy an argument-count lint would only move
// the same fields behind a type that every caller must then construct.
#![allow(clippy::too_many_arguments)]

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
    UntrustedFactory   = 7,
    FactoryAlreadyTrusted = 8,
    TooManyFactories   = 9,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days
/// Ceiling on any paged read, so a caller cannot ask for a page large enough
/// to exceed the resource budget.
const MAX_PAGE: u32 = 100;

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

/// A registry cannot trust an unbounded number of factories without the
/// membership check becoming a resource problem.
const MAX_FACTORIES: u32 = 16;

#[contracttype]
pub enum DataKey {
    /// May add trusted factories. Deliberately cannot remove one.
    Admin,
    /// Factories whose vaults are permitted to write.
    ///
    /// A set rather than a single address so that a factory upgrade does not
    /// orphan the history: new vaults come from a new factory, and if this
    /// registry could only ever trust the original one, a second registry would
    /// be needed and a builder's record would split across the two. A record
    /// that fragments on every platform upgrade is not portable, which is the
    /// whole point of it.
    Factories,
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
fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn load_factories(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Factories)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn is_trusted_factory(env: &Env, candidate: &Address) -> bool {
    load_factories(env).first_index_of(candidate).is_some()
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
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();

        let mut factories = Vec::new(&env);
        factories.push_back(factory.clone());

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Factories, &factories);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("ATTEST"), symbol_short!("INIT")),
            factory,
        );
    }

    /// Trust an additional factory, so a platform upgrade keeps writing into
    /// the same history.
    ///
    /// Append-only by design. There is no counterpart that removes a factory,
    /// because doing so would orphan every record its vaults had already
    /// written — an admin could quietly erase a builder's history without
    /// touching a single record.
    pub fn add_factory(env: Env, factory: Address) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        let mut factories = load_factories(&env);
        if factories.first_index_of(&factory).is_some() {
            panic_with_error!(&env, Error::FactoryAlreadyTrusted);
        }
        if factories.len() >= MAX_FACTORIES {
            panic_with_error!(&env, Error::TooManyFactories);
        }

        factories.push_back(factory.clone());
        env.storage().instance().set(&DataKey::Factories, &factories);

        env.events().publish(
            (symbol_short!("ATTEST"), symbol_short!("FACTORY")),
            factory,
        );
    }

    pub fn transfer_admin(env: Env, new_admin: Address) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (symbol_short!("ATTEST"), symbol_short!("ADMIN_TX")),
            new_admin,
        );
    }

    /// Write a project's closing record. Callable only by a vault the trusted
    /// factory deployed, and only once per project.
    ///
    /// Deliberately absent: any way to amend or remove what this writes.
    pub fn attest(
        env:                 Env,
        vault:               Address,
        factory:             Address,
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

        // The vault names the factory that deployed it, and both halves are
        // checked: that we trust that factory at all, and that the factory
        // confirms this vault is one of its own. Naming an untrusted factory
        // fails the first check; naming a trusted one you do not belong to
        // fails the second.
        if !is_trusted_factory(&env, &factory) {
            panic_with_error!(&env, Error::UntrustedFactory);
        }
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

    /// A page of a builder's history. This is what a grant programme, lender,
    /// or launchpad reads to decide whether to take someone on.
    ///
    /// Paged rather than whole: a builder's record only ever grows, so a call
    /// that materialises all of it would eventually exceed the resource budget
    /// and fail for exactly the builders with the longest track record.
    /// `limit` is clamped to MAX_PAGE.
    pub fn get_builder_history(
        env: Env,
        builder: Address,
        offset: u32,
        limit: u32,
    ) -> Vec<Attestation> {
        let ids = Self::get_builder_projects(env.clone(), builder);
        let capped = if limit == 0 || limit > MAX_PAGE { MAX_PAGE } else { limit };

        let mut out = Vec::new(&env);
        let mut i = offset;
        while i < ids.len() && out.len() < capped {
            let id = ids.get(i).unwrap();
            if let Some(record) = env
                .storage()
                .persistent()
                .get::<DataKey, Attestation>(&DataKey::Record(id))
            {
                out.push_back(record);
            }
            i += 1;
        }
        out
    }

    /// Compact reputation summary: (completed, failed_with_forfeiture, failed_to_fund).
    pub fn get_builder_summary(env: Env, builder: Address) -> (u32, u32, u32) {
        // Pages through rather than taking one slice, so the counts stay correct
        // for a builder with more projects than a single page holds.
        let ids = Self::get_builder_projects(env.clone(), builder);
        let mut completed = 0u32;
        let mut forfeited = 0u32;
        let mut unfunded = 0u32;

        // Reads records directly rather than going through the paged history,
        // so the counts stay correct for a builder with more projects than a
        // single page holds.
        for id in ids.iter() {
            if let Some(record) = env
                .storage()
                .persistent()
                .get::<DataKey, Attestation>(&DataKey::Record(id))
            {
                match record.outcome {
                    Outcome::Completed => completed += 1,
                    Outcome::FailedWithForfeiture => forfeited += 1,
                    Outcome::FailedToFund => unfunded += 1,
                }
            }
        }
        (completed, forfeited, unfunded)
    }

    pub fn get_factories(env: Env) -> Vec<Address> {
        load_factories(&env)
    }

    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    pub fn is_factory_trusted(env: Env, factory: Address) -> bool {
        is_trusted_factory(&env, &factory)
    }
}

#[cfg(test)]
mod test;
