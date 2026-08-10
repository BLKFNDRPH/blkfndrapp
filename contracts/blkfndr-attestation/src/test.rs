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
    factory_id: Address,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let vault = Address::generate(&env);
    let builder = Address::generate(&env);

    let factory_id = env.register(MockFactory, ());
    let mut vaults = Vec::new(&env);
    vaults.push_back(vault.clone());
    MockFactoryClient::new(&env, &factory_id).set_vaults(&vaults);

    // Construct trusting no factory, then grant trust — the same two steps the
    // deploy runs, and what lets the factory take this registry's address in its
    // own constructor without a cycle.
    let registry_id = env.register(AttestationRegistry, (admin.clone(),));
    let registry = AttestationRegistryClient::new(&env, &registry_id);
    registry.add_factory(&factory_id);

    Setup { env, registry, vault, builder, factory_id, admin }
}

/// Register `n` fresh vaults on a factory's allow-list and return them. A vault
/// closes exactly once, so a builder with several projects has several vaults.
fn vaults_on(env: &Env, factory: &Address, n: u32) -> Vec<Address> {
    let mut out = Vec::new(env);
    for _ in 0..n {
        out.push_back(Address::generate(env));
    }
    MockFactoryClient::new(env, factory).set_vaults(&out);
    out
}

fn one_vault(env: &Env, factory: &Address) -> Address {
    vaults_on(env, factory, 1).get(0).unwrap()
}

#[test]
fn records_a_completed_project() {
    let s = setup();

    s.registry.attest(
        &s.vault, &s.factory_id, &s.builder, &7u64,
        &Outcome::Completed, &10_000_000_000i128, &500_000_000i128, &3u32, &3u32,
    );

    let record = s.registry.get_record(&s.vault);
    assert_eq!(record.builder, s.builder);
    assert_eq!(record.vault, s.vault);
    assert_eq!(record.project_id, 7);
    assert_eq!(record.outcome, Outcome::Completed);
    assert_eq!(record.total_raised, 10_000_000_000);
    assert_eq!(record.bond_posted, 500_000_000);
    assert_eq!(record.milestones_approved, 3);
    assert!(s.registry.has_record(&s.vault));
}

#[test]
fn builds_a_portable_history_across_projects() {
    let s = setup();
    let vaults = vaults_on(&s.env, &s.factory_id, 3);
    let (v1, v2, v3) = (
        vaults.get(0).unwrap(),
        vaults.get(1).unwrap(),
        vaults.get(2).unwrap(),
    );

    s.registry.attest(&v1, &s.factory_id, &s.builder, &1u64, &Outcome::Completed, &100i128, &10i128, &2u32, &2u32);
    s.registry.attest(&v2, &s.factory_id, &s.builder, &2u64, &Outcome::FailedWithForfeiture, &200i128, &20i128, &3u32, &1u32);
    s.registry.attest(&v3, &s.factory_id, &s.builder, &3u64, &Outcome::FailedToFund, &0i128, &30i128, &2u32, &0u32);

    assert_eq!(s.registry.get_builder_vaults(&s.builder).len(), 3);
    assert_eq!(s.registry.get_builder_history(&s.builder, &0u32, &100u32).len(), 3);
    assert_eq!(s.registry.get_builder_summary(&s.builder), (1, 1, 1));
}

#[test]
fn a_second_builder_has_a_separate_history() {
    let s = setup();
    let other = Address::generate(&s.env);
    let vaults = vaults_on(&s.env, &s.factory_id, 2);
    let (v1, v2) = (vaults.get(0).unwrap(), vaults.get(1).unwrap());

    s.registry.attest(&v1, &s.factory_id, &s.builder, &1u64, &Outcome::Completed, &100i128, &10i128, &1u32, &1u32);
    s.registry.attest(&v2, &s.factory_id, &other, &2u64, &Outcome::FailedWithForfeiture, &200i128, &20i128, &1u32, &0u32);

    assert_eq!(s.registry.get_builder_vaults(&s.builder).len(), 1);
    assert_eq!(s.registry.get_builder_vaults(&other).len(), 1);
    assert_eq!(s.registry.get_builder_summary(&s.builder), (1, 0, 0));
    assert_eq!(s.registry.get_builder_summary(&other), (0, 1, 0));
}

/// A vault closes once, and its record cannot be overwritten. No update or
/// delete entrypoint exists to try instead.
#[test]
fn a_record_cannot_be_overwritten() {
    let s = setup();

    s.registry.attest(&s.vault, &s.factory_id, &s.builder, &1u64, &Outcome::FailedWithForfeiture, &100i128, &10i128, &2u32, &0u32);

    let retry = s.registry.try_attest(
        &s.vault, &s.factory_id, &s.builder, &1u64,
        &Outcome::Completed, &100i128, &10i128, &2u32, &2u32,
    );
    assert!(retry.is_err(), "rewriting a closed record must fail");

    let record = s.registry.get_record(&s.vault);
    assert_eq!(record.outcome, Outcome::FailedWithForfeiture);
    assert_eq!(record.milestones_approved, 0);
}

#[test]
fn rejects_writes_from_contracts_the_factory_does_not_know() {
    let s = setup();
    let impostor = Address::generate(&s.env);

    let result = s.registry.try_attest(
        &impostor, &s.factory_id, &s.builder, &99u64,
        &Outcome::Completed, &1_000i128, &10i128, &1u32, &1u32,
    );
    assert!(result.is_err(), "only factory-deployed vaults may attest");
    assert!(!s.registry.has_record(&impostor));
}

#[test]
fn rejects_incoherent_records() {
    let s = setup();

    // More milestones approved than exist.
    let bad = s.registry.try_attest(
        &s.vault, &s.factory_id, &s.builder, &1u64,
        &Outcome::Completed, &100i128, &10i128, &2u32, &5u32,
    );
    assert!(bad.is_err());

    // Negative raise.
    let negative = s.registry.try_attest(
        &s.vault, &s.factory_id, &s.builder, &2u64,
        &Outcome::Completed, &-1i128, &10i128, &1u32, &1u32,
    );
    assert!(negative.is_err());
}

/// Construction is a `__constructor` now: it runs inside the deploy
/// transaction, so there is no deployed-but-unconfigured window and no second
/// `initialize` to re-bind the registry with. What must still hold is that
/// construction demands the admin's signature.
#[test]
#[should_panic] // admin.require_auth() fails without the admin's signature
fn construction_requires_the_admins_signature() {
    let env = Env::default(); // deliberately no mock_all_auths
    env.register(AttestationRegistry, (Address::generate(&env),));
}

#[test]
fn unknown_record_reads_are_reported_not_guessed() {
    let s = setup();
    let unknown = Address::generate(&s.env);
    assert!(!s.registry.has_record(&unknown));
    assert!(s.registry.try_get_record(&unknown).is_err());
    assert_eq!(s.registry.get_builder_vaults(&s.builder).len(), 0);
    assert_eq!(s.registry.get_builder_summary(&s.builder), (0, 0, 0));
}

// ── Factory trust ──────────────────────────────────────────────────────────

#[test]
fn naming_an_untrusted_factory_is_refused() {
    let s = setup();

    // A second factory that genuinely vouches for the vault, but which this
    // registry has never been told to trust.
    let rogue_id = s.env.register(MockFactory, ());
    let mut vaults = Vec::new(&s.env);
    vaults.push_back(s.vault.clone());
    MockFactoryClient::new(&s.env, &rogue_id).set_vaults(&vaults);

    let result = s.registry.try_attest(
        &s.vault, &rogue_id, &s.builder, &1u64,
        &Outcome::Completed, &100i128, &10i128, &1u32, &1u32,
    );
    assert!(result.is_err(), "vouching for yourself is not enough");
    assert!(!s.registry.has_record(&s.vault));
}

/// The collision H-07 fixes: a second factory restarts its project ids at 1, so
/// its first vault shares a project_id with the original factory's first. Records
/// are keyed by vault, so the two coexist — where keying by project_id used to
/// hit AlreadyAttested and leave the second vault unable to record (and so unable
/// to settle).
#[test]
fn a_second_factory_with_a_colliding_project_id_still_records() {
    let s = setup();

    s.registry.attest(&s.vault, &s.factory_id, &s.builder, &1u64,
        &Outcome::Completed, &100i128, &10i128, &1u32, &1u32);

    let next_factory = s.env.register(MockFactory, ());
    let next_vault = one_vault(&s.env, &next_factory);
    s.registry.add_factory(&next_factory);
    assert!(s.registry.is_factory_trusted(&next_factory));

    // Same project_id (1), a different vault — this used to revert.
    s.registry.attest(&next_vault, &next_factory, &s.builder, &1u64,
        &Outcome::Completed, &200i128, &20i128, &1u32, &1u32);

    assert!(s.registry.has_record(&s.vault));
    assert!(s.registry.has_record(&next_vault));
    assert_eq!(s.registry.get_builder_vaults(&s.builder).len(), 2);
    assert_eq!(s.registry.get_builder_summary(&s.builder), (2, 0, 0));
}

#[test]
fn a_factory_cannot_be_trusted_twice() {
    let s = setup();
    assert!(s.registry.try_add_factory(&s.factory_id).is_err());
    assert_eq!(s.registry.get_factories().len(), 1);
}

/// M-04: a compromised factory can be de-authorized. Its future writes stop;
/// every record its vaults already wrote stays readable, because no read
/// consults the trusted set.
#[test]
fn a_disabled_factory_can_no_longer_attest_but_its_records_remain() {
    let s = setup();

    s.registry.attest(&s.vault, &s.factory_id, &s.builder, &1u64,
        &Outcome::FailedWithForfeiture, &100i128, &10i128, &2u32, &0u32);

    // A second factory is trusted and writes a record.
    let next_factory = s.env.register(MockFactory, ());
    let next_vault = one_vault(&s.env, &next_factory);
    s.registry.add_factory(&next_factory);
    s.registry.attest(&next_vault, &next_factory, &s.builder, &2u64,
        &Outcome::Completed, &200i128, &20i128, &1u32, &1u32);

    // Now disable it.
    s.registry.disable_factory(&next_factory);
    assert!(!s.registry.is_factory_trusted(&next_factory));
    assert!(s.registry.is_factory_trusted(&s.factory_id), "disabling one leaves the other");

    // Its vaults can no longer write.
    let later_vault = one_vault(&s.env, &next_factory);
    let refused = s.registry.try_attest(&later_vault, &next_factory, &s.builder, &3u64,
        &Outcome::Completed, &50i128, &5i128, &1u32, &1u32);
    assert!(refused.is_err(), "a disabled factory's vaults cannot attest");

    // But both existing records stay intact and readable.
    assert_eq!(s.registry.get_record(&s.vault).outcome, Outcome::FailedWithForfeiture);
    assert_eq!(s.registry.get_record(&next_vault).outcome, Outcome::Completed);
    assert_eq!(s.registry.get_builder_summary(&s.builder), (1, 1, 0));
}

#[test]
fn disabling_an_untrusted_factory_is_refused() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert!(s.registry.try_disable_factory(&stranger).is_err());
}

#[test]
fn the_admin_can_be_handed_over() {
    let s = setup();
    assert_eq!(s.registry.get_admin(), s.admin);

    let successor = Address::generate(&s.env);
    s.registry.transfer_admin(&successor);
    assert_eq!(s.registry.get_admin(), successor);
}
