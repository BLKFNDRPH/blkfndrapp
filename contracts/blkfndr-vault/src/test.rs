#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, String, Vec,
};

use crate::{
    BlkfndrVault, BlkfndrVaultClient, MilestoneInput, VaultInitConfig, VaultState,
};
use blkfndr_attestation::{
    AttestationRegistry, AttestationRegistryClient, Outcome as RegistryOutcome,
};

// ── Test doubles ───────────────────────────────────────────────────────────

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

/// Reports a fixed allow-list, standing in for the real factory's vault registry.
#[contract]
pub struct MockFactory;

const VAULTS: soroban_sdk::Symbol = soroban_sdk::symbol_short!("VAULTS");

#[contractimpl]
impl MockFactory {
    pub fn set_vaults(env: Env, vaults: Vec<Address>) {
        env.storage().instance().set(&VAULTS, &vaults);
    }

    pub fn is_vault(env: Env, address: Address) -> bool {
        let vaults: Vec<Address> =
            env.storage().instance().get(&VAULTS).unwrap_or_else(|| Vec::new(&env));
        for i in 0..vaults.len() {
            if vaults.get(i).unwrap() == address {
                return true;
            }
        }
        false
    }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

/// 7 decimals, as Stellar assets carry.
const UNIT: i128 = 10_000_000;
const MIN_CONTRIBUTION: i128 = 5 * UNIT; // $5, the SOW entry point
const GOAL: i128 = 300 * UNIT;
const BOND: i128 = 15 * UNIT; // 5% of goal
const PLATFORM_FEE: i128 = 10 * UNIT; // flat, charged once to the builder
const VOTING_WINDOW: u64 = 7 * 24 * 60 * 60; // 7 days
const DEADLINE: u64 = 30 * 24 * 60 * 60;

struct Setup {
    env: Env,
    vault: BlkfndrVaultClient<'static>,
    registry: AttestationRegistryClient<'static>,
    token: TokenClient<'static>,
    minter: StellarAssetClient<'static>,
    vault_address: Address,
    builder: Address,
    fee_wallet: Address,
    alice: Address,
    bob: Address,
    carol: Address,
}

fn setup() -> Setup {
    setup_with(GOAL, BOND, PLATFORM_FEE)
}

fn setup_with(goal: i128, bond: i128, platform_fee: i128) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let builder = Address::generate(&env);
    let fee_wallet = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    let issuer = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(issuer.clone());
    let token = TokenClient::new(&env, &asset.address());
    let minter = StellarAssetClient::new(&env, &asset.address());

    minter.mint(&builder, &(bond + platform_fee));
    minter.mint(&alice, &(1_000 * UNIT));
    minter.mint(&bob, &(1_000 * UNIT));
    minter.mint(&carol, &(1_000 * UNIT));

    let identity_id = env.register(MockIdentity, ());
    MockIdentityClient::new(&env, &identity_id).set_approved(&builder, &true);

    let vault_address = env.register(BlkfndrVault, ());

    let factory_id = env.register(MockFactory, ());
    let mut vaults = Vec::new(&env);
    vaults.push_back(vault_address.clone());
    MockFactoryClient::new(&env, &factory_id).set_vaults(&vaults);

    let registry_id = env.register(AttestationRegistry, ());
    let registry = AttestationRegistryClient::new(&env, &registry_id);
    registry.initialize(&admin, &factory_id);

    let vault = BlkfndrVaultClient::new(&env, &vault_address);

    let mut milestones = Vec::new(&env);
    milestones.push_back(MilestoneInput { id: 1, amount: goal / 3 });
    milestones.push_back(MilestoneInput { id: 2, amount: goal / 3 });
    milestones.push_back(MilestoneInput { id: 3, amount: goal - 2 * (goal / 3) });

    vault.initialize(&VaultInitConfig {
        project_id: 42,
        creator: builder.clone(),
        token: asset.address(),
        goal,
        deadline: env.ledger().timestamp() + DEADLINE,
        bond_amount: bond,
        identity_registry: identity_id,
        attestation_registry: registry_id,
        factory: factory_id,
        fee_wallet_address: fee_wallet.clone(),
        platform_fee,
        voting_window_secs: VOTING_WINDOW,
        min_contribution: MIN_CONTRIBUTION,
        milestones,
        metadata_cid: String::from_str(&env, "bafytestcid"),
    });

    Setup {
        env, vault, registry, token, minter, vault_address,
        builder, fee_wallet, alice, bob, carol,
    }
}

/// Fund to goal with three equal backers — the shape the vote is designed for.
fn fund_evenly(s: &Setup) {
    s.vault.contribute(&s.alice, &(100 * UNIT));
    s.vault.contribute(&s.bob, &(100 * UNIT));
    s.vault.contribute(&s.carol, &(100 * UNIT));
}

fn advance(env: &Env, seconds: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + seconds);
}

// ── Bond is locked at creation ─────────────────────────────────────────────

#[test]
fn bond_is_locked_at_creation_and_fee_is_flat() {
    let s = setup();

    // Vault holds exactly the bond; the flat fee went to the platform wallet.
    assert_eq!(s.token.balance(&s.vault_address), BOND);
    assert_eq!(s.token.balance(&s.fee_wallet), PLATFORM_FEE);
    assert_eq!(s.token.balance(&s.builder), 0);

    let info = s.vault.get_info();
    assert!(info.bond_posted, "bond must be posted as part of construction");
    assert_eq!(info.bond_amount, BOND);
    assert_eq!(info.platform_fee, PLATFORM_FEE);
    assert_eq!(s.vault.get_state(), VaultState::Raising);
}

#[test]
fn a_builder_who_cannot_fund_the_bond_gets_no_vault() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let builder = Address::generate(&env);
    let issuer = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(issuer);
    // Deliberately not minting anything to the builder.

    let identity_id = env.register(MockIdentity, ());
    MockIdentityClient::new(&env, &identity_id).set_approved(&builder, &true);

    let vault_address = env.register(BlkfndrVault, ());
    let vault = BlkfndrVaultClient::new(&env, &vault_address);

    let mut milestones = Vec::new(&env);
    milestones.push_back(MilestoneInput { id: 1, amount: GOAL });

    let result = vault.try_initialize(&VaultInitConfig {
        project_id: 1,
        creator: builder.clone(),
        token: asset.address(),
        goal: GOAL,
        deadline: env.ledger().timestamp() + DEADLINE,
        bond_amount: BOND,
        identity_registry: identity_id,
        attestation_registry: Address::generate(&env),
        factory: Address::generate(&env),
        fee_wallet_address: Address::generate(&env),
        platform_fee: PLATFORM_FEE,
        voting_window_secs: VOTING_WINDOW,
        min_contribution: MIN_CONTRIBUTION,
        milestones,
        metadata_cid: String::from_str(&env, "cid"),
    });

    assert!(result.is_err(), "no bond, no vault — there is no unbonded path");
}

#[test]
fn rejects_a_builder_without_kyc() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let builder = Address::generate(&env);
    let issuer = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(issuer.clone());
    StellarAssetClient::new(&env, &asset.address()).mint(&builder, &(BOND + PLATFORM_FEE));

    let identity_id = env.register(MockIdentity, ()); // nobody approved
    let vault = BlkfndrVaultClient::new(&env, &env.register(BlkfndrVault, ()));

    let mut milestones = Vec::new(&env);
    milestones.push_back(MilestoneInput { id: 1, amount: GOAL });

    let result = vault.try_initialize(&VaultInitConfig {
        project_id: 1,
        creator: builder,
        token: asset.address(),
        goal: GOAL,
        deadline: env.ledger().timestamp() + DEADLINE,
        bond_amount: BOND,
        identity_registry: identity_id,
        attestation_registry: Address::generate(&env),
        factory: Address::generate(&env),
        fee_wallet_address: Address::generate(&env),
        platform_fee: PLATFORM_FEE,
        voting_window_secs: VOTING_WINDOW,
        min_contribution: MIN_CONTRIBUTION,
        milestones,
        metadata_cid: String::from_str(&env, "cid"),
    });

    assert!(result.is_err());
}

#[test]
fn rejects_milestones_that_do_not_sum_to_the_goal() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let builder = Address::generate(&env);
    let issuer = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(issuer);
    StellarAssetClient::new(&env, &asset.address()).mint(&builder, &(BOND + PLATFORM_FEE));

    let identity_id = env.register(MockIdentity, ());
    MockIdentityClient::new(&env, &identity_id).set_approved(&builder, &true);
    let vault = BlkfndrVaultClient::new(&env, &env.register(BlkfndrVault, ()));

    let mut milestones = Vec::new(&env);
    milestones.push_back(MilestoneInput { id: 1, amount: GOAL / 2 });

    let result = vault.try_initialize(&VaultInitConfig {
        project_id: 1,
        creator: builder,
        token: asset.address(),
        goal: GOAL,
        deadline: env.ledger().timestamp() + DEADLINE,
        bond_amount: BOND,
        identity_registry: identity_id,
        attestation_registry: Address::generate(&env),
        factory: Address::generate(&env),
        fee_wallet_address: Address::generate(&env),
        platform_fee: PLATFORM_FEE,
        voting_window_secs: VOTING_WINDOW,
        min_contribution: MIN_CONTRIBUTION,
        milestones,
        metadata_cid: String::from_str(&env, "cid"),
    });

    assert!(result.is_err());
}

// ── Contribution ───────────────────────────────────────────────────────────

#[test]
fn contributions_are_recorded_whole_with_no_fee_deducted() {
    let s = setup();
    s.vault.contribute(&s.alice, &(100 * UNIT));

    // The contributor's whole deposit is credited and held.
    assert_eq!(s.vault.get_balance(&s.alice), 100 * UNIT);
    assert_eq!(s.vault.get_info().raised_amount, 100 * UNIT);
    assert_eq!(s.token.balance(&s.vault_address), BOND + 100 * UNIT);
    // Platform took nothing beyond the flat creation fee.
    assert_eq!(s.token.balance(&s.fee_wallet), PLATFORM_FEE);
}

#[test]
fn enforces_the_five_dollar_minimum() {
    let s = setup();
    let too_small = s.vault.try_contribute(&s.alice, &(4 * UNIT));
    assert!(too_small.is_err());

    s.vault.contribute(&s.alice, &MIN_CONTRIBUTION);
    assert_eq!(s.vault.get_balance(&s.alice), MIN_CONTRIBUTION);
}

#[test]
fn reaching_the_goal_closes_the_raise() {
    let s = setup();
    fund_evenly(&s);

    assert_eq!(s.vault.get_state(), VaultState::Funded);
    assert_eq!(s.vault.get_info().raised_amount, GOAL);

    let after_close = s.vault.try_contribute(&s.alice, &MIN_CONTRIBUTION);
    assert!(after_close.is_err(), "raise is closed once the goal is met");
}

#[test]
fn rejects_contributions_after_the_deadline() {
    let s = setup();
    advance(&s.env, DEADLINE + 1);
    let result = s.vault.try_contribute(&s.alice, &(100 * UNIT));
    assert!(result.is_err());
}

// ── Voting weight and the 20% cap ──────────────────────────────────────────

#[test]
fn voting_weight_is_one_unit_per_unit_contributed() {
    let s = setup();
    s.vault.contribute(&s.alice, &(50 * UNIT));
    s.vault.contribute(&s.bob, &(50 * UNIT));
    s.vault.contribute(&s.carol, &(200 * UNIT));

    // raised = 300, cap = 20% = 60.
    assert_eq!(s.vault.get_voting_weight(&s.alice), 50 * UNIT);
    assert_eq!(s.vault.get_voting_weight(&s.bob), 50 * UNIT);
    // Carol put in 200 but counts for 60.
    assert_eq!(s.vault.get_voting_weight(&s.carol), 60 * UNIT);
}

/// The SOW's central claim about the vote: a dominant contributor cannot
/// release on their own.
#[test]
fn a_majority_contributor_cannot_release_alone() {
    let s = setup();
    s.vault.contribute(&s.carol, &(200 * UNIT)); // two thirds of the raise
    s.vault.contribute(&s.alice, &(50 * UNIT));
    s.vault.contribute(&s.bob, &(50 * UNIT));

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.carol, &1u32);

    let (approved, required, open) = s.vault.get_milestone_vote(&1u32);
    assert!(open);
    assert_eq!(approved, 60 * UNIT, "capped at 20% of the raise");
    assert!(approved < required);

    let alone = s.vault.try_release_milestone(&1u32);
    assert!(alone.is_err(), "60% of the money must not be 60% of the vote");

    // Even with one ally the whale is short: 60 + 50 = 110, needs > 150.
    s.vault.approve_milestone(&s.alice, &1u32);
    let pair = s.vault.try_release_milestone(&1u32);
    assert!(pair.is_err());

    // Only the third wallet carries it: 60 + 50 + 50 = 160 > 150.
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.release_milestone(&1u32);
    assert!(s.vault.get_info().milestones.get(0).unwrap().released);
}

/// With every wallet at the cap, arithmetic forces at least three of them.
#[test]
fn release_requires_at_least_three_distinct_wallets() {
    let s = setup();
    fund_evenly(&s); // three at 100 each, each capped to 60

    s.vault.open_milestone_vote(&1u32);

    s.vault.approve_milestone(&s.alice, &1u32);
    assert!(s.vault.try_release_milestone(&1u32).is_err(), "one wallet: 60");

    s.vault.approve_milestone(&s.bob, &1u32);
    assert!(s.vault.try_release_milestone(&1u32).is_err(), "two wallets: 120");

    s.vault.approve_milestone(&s.carol, &1u32);
    s.vault.release_milestone(&1u32); // three wallets: 180 > 150
}

#[test]
fn a_contributor_votes_once_per_milestone() {
    let s = setup();
    fund_evenly(&s);
    s.vault.open_milestone_vote(&1u32);

    s.vault.approve_milestone(&s.alice, &1u32);
    assert!(s.vault.has_voted(&1u32, &s.alice));

    let again = s.vault.try_approve_milestone(&s.alice, &1u32);
    assert!(again.is_err());
}

#[test]
fn non_contributors_have_no_vote() {
    let s = setup();
    fund_evenly(&s);
    s.vault.open_milestone_vote(&1u32);

    let stranger = Address::generate(&s.env);
    let result = s.vault.try_approve_milestone(&stranger, &1u32);
    assert!(result.is_err());
}

#[test]
fn votes_are_rejected_before_the_window_opens_and_after_it_closes() {
    let s = setup();
    fund_evenly(&s);

    let early = s.vault.try_approve_milestone(&s.alice, &1u32);
    assert!(early.is_err(), "no vote before the builder opens the window");

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);

    advance(&s.env, VOTING_WINDOW + 1);
    let late = s.vault.try_approve_milestone(&s.bob, &1u32);
    assert!(late.is_err(), "no vote after the window closes");
}

#[test]
fn only_the_builder_opens_a_window_and_only_once() {
    let s = setup();
    fund_evenly(&s);

    s.vault.open_milestone_vote(&1u32);
    let twice = s.vault.try_open_milestone_vote(&1u32);
    assert!(twice.is_err());
}

// ── Release ────────────────────────────────────────────────────────────────

#[test]
fn releasing_every_milestone_completes_the_project_and_returns_the_bond() {
    let s = setup();
    fund_evenly(&s);

    let builder_start = s.token.balance(&s.builder);

    for id in 1u32..=3u32 {
        s.vault.open_milestone_vote(&id);
        s.vault.approve_milestone(&s.alice, &id);
        s.vault.approve_milestone(&s.bob, &id);
        s.vault.approve_milestone(&s.carol, &id);
        s.vault.release_milestone(&id);
    }

    assert_eq!(s.vault.get_state(), VaultState::Completed);
    // Builder received the whole raise plus their bond back.
    assert_eq!(s.token.balance(&s.builder), builder_start + GOAL + BOND);
    assert_eq!(s.token.balance(&s.vault_address), 0, "vault fully drained");
}

#[test]
fn release_is_permissionless_once_contributors_have_voted() {
    let s = setup();
    fund_evenly(&s);
    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&s.carol, &1u32);

    // No signer, no admin, no builder involvement: the call carries itself.
    s.vault.release_milestone(&1u32);
    assert_eq!(s.vault.get_state(), VaultState::Active);
}

#[test]
fn a_milestone_cannot_be_released_twice() {
    let s = setup();
    fund_evenly(&s);
    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&s.carol, &1u32);
    s.vault.release_milestone(&1u32);

    assert!(s.vault.try_release_milestone(&1u32).is_err());
}

// ── Fail-closed ────────────────────────────────────────────────────────────

#[test]
fn a_window_that_closes_below_threshold_fails_the_milestone() {
    let s = setup();
    fund_evenly(&s);

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32); // 60 of the 150 needed

    // Nobody else votes.
    advance(&s.env, VOTING_WINDOW + 1);
    s.vault.settle_lapsed_milestone(&1u32);

    assert_eq!(s.vault.get_state(), VaultState::Refunding);
    assert!(s.vault.get_info().milestones.get(0).unwrap().failed);
}

#[test]
fn silence_never_releases_funds() {
    let s = setup();
    fund_evenly(&s);
    s.vault.open_milestone_vote(&1u32);

    // Not a single vote cast.
    advance(&s.env, VOTING_WINDOW + 1);
    s.vault.settle_lapsed_milestone(&1u32);

    assert_eq!(s.vault.get_state(), VaultState::Refunding);
    assert_eq!(s.token.balance(&s.builder), 0, "builder received nothing");
}

#[test]
fn a_lapsed_window_cannot_be_settled_early() {
    let s = setup();
    fund_evenly(&s);
    s.vault.open_milestone_vote(&1u32);

    let early = s.vault.try_settle_lapsed_milestone(&1u32);
    assert!(early.is_err(), "the window has not elapsed yet");
}

#[test]
fn a_window_that_met_threshold_cannot_be_declared_failed() {
    let s = setup();
    fund_evenly(&s);
    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&s.carol, &1u32);

    advance(&s.env, VOTING_WINDOW + 1);
    let sabotage = s.vault.try_settle_lapsed_milestone(&1u32);
    assert!(sabotage.is_err(), "a passed vote stays passed after the window");

    // And it can still be executed.
    s.vault.release_milestone(&1u32);
}

// ── Bond forfeiture ────────────────────────────────────────────────────────

#[test]
fn forfeited_bond_is_distributed_pro_rata_with_the_remaining_balance() {
    let s = setup();
    fund_evenly(&s); // 100 each, raised 300

    // First milestone passes and pays out 100 to the builder.
    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&s.carol, &1u32);
    s.vault.release_milestone(&1u32);
    assert_eq!(s.token.balance(&s.builder), 100 * UNIT);

    // Second stalls.
    s.vault.open_milestone_vote(&2u32);
    advance(&s.env, VOTING_WINDOW + 1);
    s.vault.settle_lapsed_milestone(&2u32);

    // Vault holds 200 of contributions plus the 15 forfeited bond.
    assert_eq!(s.token.balance(&s.vault_address), 200 * UNIT + BOND);

    // Each backer holds a third: 200/3 of principal + 15/3 of the bond.
    let expected = (100 * UNIT * (200 * UNIT) / (300 * UNIT)) + (100 * UNIT * BOND / (300 * UNIT));

    for backer in [&s.alice, &s.bob, &s.carol] {
        let before = s.token.balance(backer);
        s.vault.claim_refund(backer);
        assert_eq!(s.token.balance(backer) - before, expected);
    }

    // Builder keeps only the released tranche; the bond is gone.
    assert_eq!(s.token.balance(&s.builder), 100 * UNIT);
    // Nothing but rounding dust remains.
    assert!(s.token.balance(&s.vault_address) < 10);
}

#[test]
fn a_backer_claims_once() {
    let s = setup();
    fund_evenly(&s);
    s.vault.open_milestone_vote(&1u32);
    advance(&s.env, VOTING_WINDOW + 1);
    s.vault.settle_lapsed_milestone(&1u32);

    s.vault.claim_refund(&s.alice);
    assert!(s.vault.try_claim_refund(&s.alice).is_err());
}

// ── Failure to fund ────────────────────────────────────────────────────────

#[test]
fn an_unfunded_project_returns_principal_and_the_builders_bond() {
    let s = setup();
    s.vault.contribute(&s.alice, &(100 * UNIT));
    s.vault.contribute(&s.bob, &(50 * UNIT));

    advance(&s.env, DEADLINE + 1);
    assert_eq!(s.vault.get_state(), VaultState::Failed);

    s.vault.claim_refund(&s.alice);
    s.vault.claim_refund(&s.bob);
    s.vault.return_bond();

    // Everyone whole: no fee was ever taken from contributions, and the builder
    // is not penalised for a raise that simply did not fill.
    assert_eq!(s.token.balance(&s.alice), 1_000 * UNIT);
    assert_eq!(s.token.balance(&s.bob), 1_000 * UNIT);
    assert_eq!(s.token.balance(&s.builder), BOND);
    assert_eq!(s.token.balance(&s.vault_address), 0);
}

#[test]
fn refunds_are_unavailable_while_a_project_is_still_live() {
    let s = setup();
    fund_evenly(&s);
    let result = s.vault.try_claim_refund(&s.alice);
    assert!(result.is_err());
}

// ── Attestation ────────────────────────────────────────────────────────────

#[test]
fn completion_writes_a_permanent_builder_record() {
    let s = setup();
    fund_evenly(&s);

    for id in 1u32..=3u32 {
        s.vault.open_milestone_vote(&id);
        s.vault.approve_milestone(&s.alice, &id);
        s.vault.approve_milestone(&s.bob, &id);
        s.vault.approve_milestone(&s.carol, &id);
        s.vault.release_milestone(&id);
    }

    let record = s.registry.get_record(&42u64);
    assert_eq!(record.builder, s.builder);
    assert_eq!(record.outcome, RegistryOutcome::Completed);
    assert_eq!(record.total_raised, GOAL);
    assert_eq!(record.bond_posted, BOND);
    assert_eq!(record.milestones_total, 3);
    assert_eq!(record.milestones_approved, 3);

    assert_eq!(s.registry.get_builder_summary(&s.builder), (1, 0, 0));
}

#[test]
fn forfeiture_writes_a_record_against_the_builder() {
    let s = setup();
    fund_evenly(&s);

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&s.carol, &1u32);
    s.vault.release_milestone(&1u32);

    s.vault.open_milestone_vote(&2u32);
    advance(&s.env, VOTING_WINDOW + 1);
    s.vault.settle_lapsed_milestone(&2u32);

    let record = s.registry.get_record(&42u64);
    assert_eq!(record.outcome, RegistryOutcome::FailedWithForfeiture);
    assert_eq!(record.milestones_approved, 1, "one of three delivered");
    assert_eq!(s.registry.get_builder_summary(&s.builder), (0, 1, 0));
}

#[test]
fn failing_to_fund_is_recorded_without_blaming_the_builder() {
    let s = setup();
    s.vault.contribute(&s.alice, &(50 * UNIT));

    advance(&s.env, DEADLINE + 1);
    s.vault.settle();

    let record = s.registry.get_record(&42u64);
    assert_eq!(record.outcome, RegistryOutcome::FailedToFund);
    assert_eq!(record.milestones_approved, 0);
    // Counted separately from a forfeiture, because it is not a default.
    assert_eq!(s.registry.get_builder_summary(&s.builder), (0, 0, 1));
}

#[test]
fn a_projects_record_is_written_once_and_never_amended() {
    let s = setup();
    fund_evenly(&s);

    s.vault.open_milestone_vote(&1u32);
    advance(&s.env, VOTING_WINDOW + 1);
    s.vault.settle_lapsed_milestone(&1u32);

    let first = s.registry.get_record(&42u64);
    assert_eq!(first.outcome, RegistryOutcome::FailedWithForfeiture);

    // Draining the vault afterwards must not rewrite history.
    s.vault.claim_refund(&s.alice);
    s.vault.settle();

    let after = s.registry.get_record(&42u64);
    assert_eq!(after.outcome, RegistryOutcome::FailedWithForfeiture);
    assert_eq!(after.closed_at, first.closed_at);
}

// ── Reads are reads ────────────────────────────────────────────────────────

#[test]
fn queries_do_not_mutate_state_or_move_tokens() {
    let s = setup();
    s.vault.contribute(&s.alice, &(100 * UNIT));
    advance(&s.env, DEADLINE + 1);

    let vault_balance = s.token.balance(&s.vault_address);
    let builder_balance = s.token.balance(&s.builder);

    // The deadline has passed, so this reports Failed — but reporting it must
    // not itself return the bond or write anything.
    assert_eq!(s.vault.get_state(), VaultState::Failed);
    assert_eq!(s.vault.get_state(), VaultState::Failed);
    let _ = s.vault.get_info();

    assert_eq!(s.token.balance(&s.vault_address), vault_balance);
    assert_eq!(s.token.balance(&s.builder), builder_balance);
    assert!(!s.vault.get_info().bond_returned);
}

#[test]
fn cannot_be_initialized_twice() {
    let s = setup();
    let mut milestones = Vec::new(&s.env);
    milestones.push_back(MilestoneInput { id: 1, amount: GOAL });

    let result = s.vault.try_initialize(&VaultInitConfig {
        project_id: 999,
        creator: s.alice.clone(),
        token: s.token.address.clone(),
        goal: GOAL,
        deadline: s.env.ledger().timestamp() + DEADLINE,
        bond_amount: 0,
        identity_registry: Address::generate(&s.env),
        attestation_registry: Address::generate(&s.env),
        factory: Address::generate(&s.env),
        fee_wallet_address: Address::generate(&s.env),
        platform_fee: 0,
        voting_window_secs: VOTING_WINDOW,
        min_contribution: MIN_CONTRIBUTION,
        milestones,
        metadata_cid: String::from_str(&s.env, "cid"),
    });

    assert!(result.is_err());
    let _ = s.minter; // fixture completeness
}
