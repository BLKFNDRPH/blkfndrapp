#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, Address, Env, Vec,
};

use crate::{AttestationRegistry, AttestationRegistryClient, Outcome};

/// Stand-in for the real factory: reports a fixed allow-list of vaults.
#[contract]
pub struct MockFactory;

const VAULTS: soroban_sdk::Symbol = soroban_sdk::symbol_short!("VAULTS");

#[contractimpl]
impl MockFactory {
    pub fn set_vaults(env: Env, vaults: Vec<Address>) {
        env.storage().instance().set(&VAULTS, &vaults);
    }

    pub fn is_vault(env: Env, address: Address) -> bool {
        let vaults: Vec<Address> = env
            .storage()
            .instance()
            .get(&VAULTS)
            .unwrap_or_else(|| Vec::new(&env));
        for i in 0..vaults.len() {
            if vaults.get(i).unwrap() == address {
                return true;
            }
        }
        false
    }
}

struct Setup {
    env: Env,
    registry: AttestationRegistryClient<'static>,
    vault: Address,
    builder: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let vault = Address::generate(&env);
    let builder = Address::generate(&env);

    let factory_id = env.register(MockFactory, ());
    let factory_client = MockFactoryClient::new(&env, &factory_id);
    let mut vaults = Vec::new(&env);
    vaults.push_back(vault.clone());
    factory_client.set_vaults(&vaults);

    let registry_id = env.register(AttestationRegistry, ());
    let registry = AttestationRegistryClient::new(&env, &registry_id);
    registry.initialize(&admin, &factory_id);

    Setup { env, registry, vault, builder }
}

#[test]
fn records_a_completed_project() {
    let s = setup();

    s.registry.attest(
        &s.vault,
        &s.builder,
        &7u64,
        &Outcome::Completed,
        &1_000_0000000i128,
        &50_0000000i128,
        &3u32,
        &3u32,
    );

    let record = s.registry.get_record(&7u64);
    assert_eq!(record.builder, s.builder);
    assert_eq!(record.project_id, 7);
    assert_eq!(record.outcome, Outcome::Completed);
    assert_eq!(record.total_raised, 1_000_0000000);
    assert_eq!(record.bond_posted, 50_0000000);
    assert_eq!(record.milestones_approved, 3);
    assert!(s.registry.has_record(&7u64));
}

#[test]
fn builds_a_portable_history_across_projects() {
    let s = setup();

    s.registry.attest(&s.vault, &s.builder, &1u64, &Outcome::Completed, &100i128, &10i128, &2u32, &2u32);
    s.registry.attest(&s.vault, &s.builder, &2u64, &Outcome::FailedWithForfeiture, &200i128, &20i128, &3u32, &1u32);
    s.registry.attest(&s.vault, &s.builder, &3u64, &Outcome::FailedToFund, &0i128, &30i128, &2u32, &0u32);

    let ids = s.registry.get_builder_projects(&s.builder);
    assert_eq!(ids.len(), 3);

    let history = s.registry.get_builder_history(&s.builder);
    assert_eq!(history.len(), 3);

    let (completed, forfeited, unfunded) = s.registry.get_builder_summary(&s.builder);
    assert_eq!(completed, 1);
    assert_eq!(forfeited, 1);
    assert_eq!(unfunded, 1);
}

#[test]
fn a_second_builder_has_a_separate_history() {
    let s = setup();
    let other = Address::generate(&s.env);

    s.registry.attest(&s.vault, &s.builder, &1u64, &Outcome::Completed, &100i128, &10i128, &1u32, &1u32);
    s.registry.attest(&s.vault, &other, &2u64, &Outcome::FailedWithForfeiture, &200i128, &20i128, &1u32, &0u32);

    assert_eq!(s.registry.get_builder_projects(&s.builder).len(), 1);
    assert_eq!(s.registry.get_builder_projects(&other).len(), 1);
    assert_eq!(s.registry.get_builder_summary(&s.builder), (1, 0, 0));
    assert_eq!(s.registry.get_builder_summary(&other), (0, 1, 0));
}

/// The immutability claim in the SOW rests on this: a record cannot be
/// overwritten, and no update or delete entrypoint exists to try instead.
#[test]
fn a_record_cannot_be_overwritten() {
    let s = setup();

    s.registry.attest(&s.vault, &s.builder, &1u64, &Outcome::FailedWithForfeiture, &100i128, &10i128, &2u32, &0u32);

    let retry = s.registry.try_attest(
        &s.vault,
        &s.builder,
        &1u64,
        &Outcome::Completed,
        &100i128,
        &10i128,
        &2u32,
        &2u32,
    );
    assert!(retry.is_err(), "rewriting a closed record must fail");

    // The original stands.
    let record = s.registry.get_record(&1u64);
    assert_eq!(record.outcome, Outcome::FailedWithForfeiture);
    assert_eq!(record.milestones_approved, 0);
}

#[test]
fn rejects_writes_from_contracts_the_factory_does_not_know() {
    let s = setup();
    let impostor = Address::generate(&s.env);

    let result = s.registry.try_attest(
        &impostor,
        &s.builder,
        &99u64,
        &Outcome::Completed,
        &1_000i128,
        &10i128,
        &1u32,
        &1u32,
    );
    assert!(result.is_err(), "only factory-deployed vaults may attest");
    assert!(!s.registry.has_record(&99u64));
}

#[test]
fn rejects_incoherent_records() {
    let s = setup();

    // More milestones approved than exist.
    let bad = s.registry.try_attest(
        &s.vault,
        &s.builder,
        &1u64,
        &Outcome::Completed,
        &100i128,
        &10i128,
        &2u32,
        &5u32,
    );
    assert!(bad.is_err());

    // Negative raise.
    let negative = s.registry.try_attest(
        &s.vault,
        &s.builder,
        &2u64,
        &Outcome::Completed,
        &-1i128,
        &10i128,
        &1u32,
        &1u32,
    );
    assert!(negative.is_err());
}

#[test]
fn cannot_be_initialized_twice() {
    let s = setup();
    let hijacker = Address::generate(&s.env);
    let other_factory = Address::generate(&s.env);

    let result = s.registry.try_initialize(&hijacker, &other_factory);
    assert!(result.is_err(), "re-binding the factory must fail");
}

#[test]
fn unknown_record_reads_are_reported_not_guessed() {
    let s = setup();
    assert!(!s.registry.has_record(&42u64));
    assert!(s.registry.try_get_record(&42u64).is_err());
    assert_eq!(s.registry.get_builder_projects(&s.builder).len(), 0);
    assert_eq!(s.registry.get_builder_summary(&s.builder), (0, 0, 0));
}
