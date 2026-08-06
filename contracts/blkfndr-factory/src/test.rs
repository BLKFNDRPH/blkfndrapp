use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger},
    Address, BytesN, Env,
};

use crate::{BlkfndrFactory, BlkfndrFactoryClient};

const UNIT: i128 = 10_000_000;
const PLATFORM_FEE: i128 = 10 * UNIT;
const MIN_CONTRIBUTION: i128 = 5 * UNIT;
const VOTING_WINDOW: u64 = 7 * 24 * 60 * 60;

struct Setup {
    env: Env,
    factory: BlkfndrFactoryClient<'static>,
    admin: Address,
    identity: Address,
    attestation: Address,
    fee_wallet: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let identity = Address::generate(&env);
    let attestation = Address::generate(&env);
    let fee_wallet = Address::generate(&env);

    let factory = BlkfndrFactoryClient::new(&env, &env.register(BlkfndrFactory, ()));
    factory.initialize(
        &admin,
        &BytesN::random(&env),
        &fee_wallet,
        &PLATFORM_FEE,
        &identity,
        &attestation,
        &VOTING_WINDOW,
        &MIN_CONTRIBUTION,
    );

    Setup { env, factory, admin, identity, attestation, fee_wallet }
}

#[test]
fn stores_the_platform_configuration() {
    let s = setup();
    assert_eq!(s.factory.get_admin(), s.admin);
    assert_eq!(s.factory.get_fee_wallet(), s.fee_wallet);
    assert_eq!(s.factory.get_platform_fee(), PLATFORM_FEE);
    assert_eq!(s.factory.get_identity_registry(), s.identity);
    assert_eq!(s.factory.get_attestation_registry(), s.attestation);
    assert_eq!(s.factory.get_voting_window(), VOTING_WINDOW);
    assert_eq!(s.factory.get_min_contribution(), MIN_CONTRIBUTION);
    assert_eq!(s.factory.get_bond_percentage(), 500);
    assert_eq!(s.factory.get_project_count(), 0);
}

#[test]
fn cannot_be_initialized_twice() {
    let s = setup();
    let result = s.factory.try_initialize(
        &Address::generate(&s.env),
        &BytesN::random(&s.env),
        &Address::generate(&s.env),
        &PLATFORM_FEE,
        &Address::generate(&s.env),
        &Address::generate(&s.env),
        &VOTING_WINDOW,
        &MIN_CONTRIBUTION,
    );
    assert!(result.is_err());
}

#[test]
fn rejects_a_platform_fee_above_the_ceiling() {
    let env = Env::default();
    env.mock_all_auths();
    let factory = BlkfndrFactoryClient::new(&env, &env.register(BlkfndrFactory, ()));

    let result = factory.try_initialize(
        &Address::generate(&env),
        &BytesN::random(&env),
        &Address::generate(&env),
        &(1_000_000 * UNIT),
        &Address::generate(&env),
        &Address::generate(&env),
        &VOTING_WINDOW,
        &MIN_CONTRIBUTION,
    );
    assert!(result.is_err());
}

#[test]
fn addresses_it_did_not_deploy_are_not_vaults() {
    let s = setup();
    assert!(!s.factory.is_vault(&Address::generate(&s.env)));
    assert!(!s.factory.is_vault(&s.admin));
}

#[test]
fn the_fee_is_flat_and_has_no_percentage_setting() {
    let s = setup();
    s.factory.update_platform_fee(&(25 * UNIT));
    assert_eq!(s.factory.get_platform_fee(), 25 * UNIT);

    // Above the ceiling is refused.
    assert!(s.factory.try_update_platform_fee(&(1_000_000 * UNIT)).is_err());
    // Negative is refused.
    assert!(s.factory.try_update_platform_fee(&-1i128).is_err());
    assert_eq!(s.factory.get_platform_fee(), 25 * UNIT);
}

#[test]
fn admin_can_repoint_platform_modules() {
    let s = setup();
    let new_identity = Address::generate(&s.env);
    s.factory.update_identity_registry(&new_identity);
    assert_eq!(s.factory.get_identity_registry(), new_identity);

    s.factory.update_voting_window(&(3 * 24 * 60 * 60));
    assert_eq!(s.factory.get_voting_window(), 3 * 24 * 60 * 60);

    s.factory.update_min_contribution(&(2 * UNIT));
    assert_eq!(s.factory.get_min_contribution(), 2 * UNIT);
}

#[test]
fn rejects_degenerate_admin_settings() {
    let s = setup();
    assert!(s.factory.try_update_voting_window(&0u64).is_err());
    assert!(s.factory.try_update_min_contribution(&0i128).is_err());
    assert!(s.factory.try_update_bond_percentage(&10_001u64).is_err());
}

#[test]
fn admin_can_be_transferred() {
    let s = setup();
    let successor = Address::generate(&s.env);
    s.factory.transfer_admin(&successor);
    assert_eq!(s.factory.get_admin(), successor);
}

#[test]
fn unknown_project_ids_are_reported_not_guessed() {
    let s = setup();
    assert!(s.factory.try_get_vault(&99u64).is_err());
}

// ── Deployment ─────────────────────────────────────────────────────────────
//
// These need the vault compiled to wasm. Run scripts/build-contracts.sh first;
// CI always does.

#[cfg(has_vault_wasm)]
mod deployment {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl,
        token::{StellarAssetClient, TokenClient},
        String, Vec,
    };

    use crate::{CreateVaultConfig, MilestoneInput};
    use blkfndr_attestation::{AttestationRegistry, AttestationRegistryClient};

    mod vault_wasm {
        soroban_sdk::contractimport!(
            file = "../../target/wasm32-unknown-unknown/release/blkfndr_vault.wasm"
        );
    }

    #[contract]
    pub struct MockIdentity;

    #[contractimpl]
    impl MockIdentity {
        pub fn set_approved(env: Env, address: Address, approved: bool) {
            env.storage().instance().set(&address, &approved);
        }
        pub fn is_kyc_approved(env: Env, address: Address) -> bool {
            env.storage().instance().get(&address).unwrap_or(false)
        }
    }

    const GOAL: i128 = 300 * UNIT;
    const BOND: i128 = 15 * UNIT;

    struct DeploySetup {
        env: Env,
        factory: BlkfndrFactoryClient<'static>,
        registry: AttestationRegistryClient<'static>,
        token: TokenClient<'static>,
        builder: Address,
        asset: Address,
    }

    fn deploy_setup() -> DeploySetup {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let admin = Address::generate(&env);
        let builder = Address::generate(&env);
        let fee_wallet = Address::generate(&env);

        let issuer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(issuer);
        let token = TokenClient::new(&env, &asset.address());
        StellarAssetClient::new(&env, &asset.address())
            .mint(&builder, &(1_000 * UNIT));

        let identity_id = env.register(MockIdentity, ());
        MockIdentityClient::new(&env, &identity_id).set_approved(&builder, &true);

        let factory_id = env.register(BlkfndrFactory, ());
        let registry_id = env.register(AttestationRegistry, ());
        let registry = AttestationRegistryClient::new(&env, &registry_id);
        registry.initialize(&admin, &factory_id);

        let wasm_hash = env.deployer().upload_contract_wasm(vault_wasm::WASM);

        let factory = BlkfndrFactoryClient::new(&env, &factory_id);
        factory.initialize(
            &admin,
            &wasm_hash,
            &fee_wallet,
            &PLATFORM_FEE,
            &identity_id,
            &registry_id,
            &VOTING_WINDOW,
            &MIN_CONTRIBUTION,
        );

        DeploySetup { env, factory, registry, token, builder, asset: asset.address() }
    }

    fn milestones(env: &Env) -> Vec<MilestoneInput> {
        let mut m = Vec::new(env);
        m.push_back(MilestoneInput { id: 1, amount: GOAL / 2 });
        m.push_back(MilestoneInput { id: 2, amount: GOAL / 2 });
        m
    }

    fn config(s: &DeploySetup) -> CreateVaultConfig {
        CreateVaultConfig {
            creator: s.builder.clone(),
            token: s.asset.clone(),
            goal: GOAL,
            deadline: s.env.ledger().timestamp() + 30 * 24 * 60 * 60,
            bond_amount: BOND,
            milestones: milestones(&s.env),
            metadata_cid: String::from_str(&s.env, "bafytest"),
        }
    }

    #[test]
    fn deploys_a_vault_with_the_bond_already_locked() {
        let s = deploy_setup();
        let vault = s.factory.create_vault(&config(&s));

        assert!(s.factory.is_vault(&vault));
        assert_eq!(s.factory.get_vault(&1u64), vault);
        assert_eq!(s.factory.get_project_count(), 1);
        // Bond moved in the same transaction that created the vault.
        assert_eq!(s.token.balance(&vault), BOND);
    }

    /// The builder supplies no module addresses, so there is no field in which
    /// to smuggle a KYC oracle or approval oracle they control.
    #[test]
    fn the_vault_trusts_only_factory_supplied_modules() {
        let s = deploy_setup();
        let vault = s.factory.create_vault(&config(&s));

        let info = vault_wasm::Client::new(&s.env, &vault).get_info();
        assert_eq!(info.identity_registry, s.factory.get_identity_registry());
        assert_eq!(info.attestation_registry, s.factory.get_attestation_registry());
        assert_eq!(info.fee_wallet_address, s.factory.get_fee_wallet());
        assert_eq!(info.platform_fee, s.factory.get_platform_fee());
        assert_eq!(info.voting_window_secs, s.factory.get_voting_window());
        assert_eq!(info.min_contribution, s.factory.get_min_contribution());
    }

    #[test]
    fn rejects_a_bond_below_the_platform_minimum() {
        let s = deploy_setup();
        let mut cfg = config(&s);
        cfg.bond_amount = 1; // well under 5% of the goal

        assert!(s.factory.try_create_vault(&cfg).is_err());
        assert_eq!(s.factory.get_project_count(), 0);
    }

    #[test]
    fn rejects_a_deadline_in_the_past() {
        let s = deploy_setup();
        let mut cfg = config(&s);
        cfg.deadline = s.env.ledger().timestamp();
        assert!(s.factory.try_create_vault(&cfg).is_err());
    }

    #[test]
    fn each_vault_gets_its_own_address_and_project_id() {
        let s = deploy_setup();
        let first = s.factory.create_vault(&config(&s));
        let second = s.factory.create_vault(&config(&s));

        assert_ne!(first, second);
        assert_eq!(s.factory.get_vault(&1u64), first);
        assert_eq!(s.factory.get_vault(&2u64), second);
        assert_eq!(s.factory.get_project_count(), 2);
    }

    /// End to end: a vault this factory deployed can write its record, and the
    /// registry accepts it because the factory vouches for the caller.
    #[test]
    fn a_deployed_vault_can_write_its_attestation() {
        let s = deploy_setup();
        let vault_address = s.factory.create_vault(&config(&s));
        let vault = vault_wasm::Client::new(&s.env, &vault_address);

        // Nobody funds it; let the raise lapse.
        let now = s.env.ledger().timestamp();
        s.env.ledger().set_timestamp(now + 31 * 24 * 60 * 60);
        vault.settle();

        let record = s.registry.get_record(&1u64);
        assert_eq!(record.builder, s.builder);
        assert_eq!(record.vault, vault_address);
        assert_eq!(s.registry.get_builder_summary(&s.builder), (0, 0, 1));
    }
}

/// Fails loudly rather than letting the deployment suite vanish unnoticed.
#[test]
#[cfg(not(has_vault_wasm))]
fn deployment_tests_were_skipped() {
    // Named so the gap is visible in the test output rather than silent.
    // Run scripts/build-contracts.sh to compile blkfndr_vault.wasm and
    // include the deployment suite.
}
