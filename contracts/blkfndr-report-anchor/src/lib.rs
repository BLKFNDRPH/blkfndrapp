#![no_std]

//! Risk report anchor registry.
//!
//! A risk report is written off-chain, for one vault. This registry holds the
//! SHA-256 of each report's canonical bytes, in the order they were published,
//! so anyone holding a report can prove it is the one the platform published
//! and when. The report itself, and the risk band inside it, stay off-chain:
//! the hash commits to both, and a model's judgement about a named builder is
//! not something to make permanent and readable out of context.
//!
//! Append-only is structural, not a matter of access control: there is no
//! entrypoint that updates or deletes an anchor. A re-run of the analysis adds
//! the next entry in the vault's history; it replaces nothing.
//!
//! Only an attestor on the roster may write. The roster is the admin's to
//! change, and removing an attestor stops its future writes only: no read
//! consults the roster, so everything it anchored stays readable.
//!
//! The vault is not checked against a factory. The attestor is already trusted
//! to say which vault a report is about, and binding this registry to one
//! factory would orphan the history at the next factory upgrade.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized        = 1,
    NotAnAttestor         = 2,
    AttestorAlreadyListed = 3,
    AttestorNotListed     = 4,
    TooManyAttestors      = 5,
    HashAlreadyAnchored   = 6,
    AnchorNotFound        = 7,
    UnknownSchemaVersion  = 8,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days
/// Ceiling on any paged read, so a caller cannot ask for a page large enough
/// to exceed the resource budget.
const MAX_PAGE: u32 = 100;
/// The roster is read on every write, so it stays small.
const MAX_ATTESTORS: u32 = 16;

/// One published report.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Anchor {
    pub vault:          Address,
    /// Position in this vault's history, from 0.
    pub seq:            u32,
    /// SHA-256 of the report's canonical bytes.
    pub report_hash:    BytesN<32>,
    /// The report schema's number, so a verifier knows how to read the report.
    pub schema_version: u32,
    pub attestor:       Address,
    /// Close time of the ledger the anchor was written in.
    pub anchored_at:    u64,
}

#[contracttype]
pub enum DataKey {
    /// May change the attestor roster.
    Admin,
    /// Addresses permitted to anchor.
    Attestors,
    /// How many anchors a vault has. Absent means none.
    Count(Address),
    /// A vault's anchor at a position.
    Anchor(Address, u32),
    /// Where a hash was anchored: (vault, seq). What makes a hash anchorable
    /// once, and lets a verifier start from the report alone.
    Hash(BytesN<32>),
}

fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn load_attestors(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Attestors)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

fn count_of(env: &Env, vault: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::Count(vault.clone()))
        .unwrap_or(0)
}

fn set_persistent<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, value: &V) {
    env.storage().persistent().set(key, value);
    env.storage()
        .persistent()
        .extend_ttl(key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

#[contract]
pub struct ReportAnchorRegistry;

#[contractimpl]
impl ReportAnchorRegistry {
    /// Bind the registry to its admin, atomically at deploy, so it is never
    /// deployed-but-unconfigured for a first caller to seize. The roster starts
    /// empty: the deployer adds the attestor straight afterwards. `admin` must
    /// authorise the deploy.
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();

        let attestors: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Attestors, &attestors);
        extend_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("ANCHOR"), symbol_short!("INIT")), admin);
    }

    /// Let an address anchor reports.
    pub fn add_attestor(env: Env, attestor: Address) {
        extend_instance_ttl(&env);
        load_admin(&env).require_auth();

        let mut attestors = load_attestors(&env);
        if attestors.first_index_of(&attestor).is_some() {
            panic_with_error!(&env, Error::AttestorAlreadyListed);
        }
        if attestors.len() >= MAX_ATTESTORS {
            panic_with_error!(&env, Error::TooManyAttestors);
        }
        attestors.push_back(attestor.clone());
        env.storage().instance().set(&DataKey::Attestors, &attestors);

        env.events()
            .publish((symbol_short!("ANCHOR"), symbol_short!("ATT_ADD")), attestor);
    }

    /// Stop an address anchoring. What it already anchored stays as it is:
    /// this is how a key is rotated or a leaked one contained, not a way to
    /// withdraw a report.
    pub fn remove_attestor(env: Env, attestor: Address) {
        extend_instance_ttl(&env);
        load_admin(&env).require_auth();

        let attestors = load_attestors(&env);
        if attestors.first_index_of(&attestor).is_none() {
            panic_with_error!(&env, Error::AttestorNotListed);
        }
        let mut kept = Vec::new(&env);
        for a in attestors.iter() {
            if a != attestor {
                kept.push_back(a);
            }
        }
        env.storage().instance().set(&DataKey::Attestors, &kept);

        env.events()
            .publish((symbol_short!("ANCHOR"), symbol_short!("ATT_DEL")), attestor);
    }

    pub fn transfer_admin(env: Env, new_admin: Address) {
        extend_instance_ttl(&env);
        load_admin(&env).require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events()
            .publish((symbol_short!("ANCHOR"), symbol_short!("ADMIN_TX")), new_admin);
    }

    /// Publish a report's hash as the next entry in a vault's history, and
    /// return its position.
    ///
    /// Deliberately absent: any way to amend or remove what this writes.
    pub fn anchor(
        env:            Env,
        attestor:       Address,
        vault:          Address,
        report_hash:    BytesN<32>,
        schema_version: u32,
    ) -> u32 {
        extend_instance_ttl(&env);

        // Both halves: the attestor signed this call, and the admin listed it.
        // The first alone lets anyone anchor under their own name; the second
        // alone lets anyone name an attestor they do not control.
        attestor.require_auth();
        if load_attestors(&env).first_index_of(&attestor).is_none() {
            panic_with_error!(&env, Error::NotAnAttestor);
        }

        if schema_version == 0 {
            panic_with_error!(&env, Error::UnknownSchemaVersion);
        }

        // A hash is anchored once, anywhere. A report names its vault, so the
        // same hash under a second vault could only be a mistake, and a replay
        // under the same one would pad its history.
        let hash_key = DataKey::Hash(report_hash.clone());
        if env.storage().persistent().has(&hash_key) {
            panic_with_error!(&env, Error::HashAlreadyAnchored);
        }

        let seq = count_of(&env, &vault);
        let record = Anchor {
            vault: vault.clone(),
            seq,
            report_hash: report_hash.clone(),
            schema_version,
            attestor: attestor.clone(),
            anchored_at: env.ledger().timestamp(),
        };

        set_persistent(&env, &DataKey::Anchor(vault.clone(), seq), &record);
        set_persistent(&env, &hash_key, &(vault.clone(), seq));
        set_persistent(&env, &DataKey::Count(vault.clone()), &(seq + 1));

        // The vault is a topic, so an indexer can ask getEvents for one
        // vault's anchors without scanning everyone's.
        env.events().publish(
            (symbol_short!("ANCHOR"), symbol_short!("RECORDED"), vault),
            (seq, report_hash, schema_version, attestor, record.anchored_at),
        );

        seq
    }

    // QUERIES

    /// The newest anchor for a vault: the report a project page shows.
    pub fn get_latest(env: Env, vault: Address) -> Option<Anchor> {
        let count = count_of(&env, &vault);
        if count == 0 {
            return None;
        }
        env.storage().persistent().get(&DataKey::Anchor(vault, count - 1))
    }

    pub fn get_anchor(env: Env, vault: Address, seq: u32) -> Anchor {
        env.storage()
            .persistent()
            .get(&DataKey::Anchor(vault, seq))
            .unwrap_or_else(|| panic_with_error!(&env, Error::AnchorNotFound))
    }

    pub fn get_count(env: Env, vault: Address) -> u32 {
        count_of(&env, &vault)
    }

    /// A page of a vault's anchors, oldest first. Paged because a history only
    /// grows; `limit` is clamped to MAX_PAGE, and 0 means MAX_PAGE.
    pub fn get_history(env: Env, vault: Address, offset: u32, limit: u32) -> Vec<Anchor> {
        let count = count_of(&env, &vault);
        let capped = if limit == 0 || limit > MAX_PAGE { MAX_PAGE } else { limit };

        let mut out = Vec::new(&env);
        let mut seq = offset;
        while seq < count && out.len() < capped {
            if let Some(record) = env
                .storage()
                .persistent()
                .get::<DataKey, Anchor>(&DataKey::Anchor(vault.clone(), seq))
            {
                out.push_back(record);
            }
            seq += 1;
        }
        out
    }

    /// The anchor for a report hash, if it was ever published: how someone
    /// holding only a report checks it.
    pub fn find(env: Env, report_hash: BytesN<32>) -> Option<Anchor> {
        let (vault, seq): (Address, u32) =
            env.storage().persistent().get(&DataKey::Hash(report_hash))?;
        env.storage().persistent().get(&DataKey::Anchor(vault, seq))
    }

    pub fn get_attestors(env: Env) -> Vec<Address> {
        load_attestors(&env)
    }

    pub fn is_attestor(env: Env, address: Address) -> bool {
        load_attestors(&env).first_index_of(&address).is_some()
    }

    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }
}

#[cfg(test)]
mod test;
