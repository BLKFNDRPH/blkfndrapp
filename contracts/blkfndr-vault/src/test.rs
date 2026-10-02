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
    setup_full(goal, bond, platform_fee, MIN_CONTRIBUTION)
}

fn setup_full(goal: i128, bond: i128, platform_fee: i128, min_contribution: i128) -> Setup {
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

    let registry_id = env.register(AttestationRegistry, (admin.clone(),));
    let registry = AttestationRegistryClient::new(&env, &registry_id);
    registry.add_factory(&factory_id);

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
        min_contribution,
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

    // Capped total: 60 + 50 + 50 = 160, so a release needs more than 80.
    let (approved, required, open) = s.vault.get_milestone_vote(&1u32);
    assert!(open);
    assert_eq!(approved, 60 * UNIT, "capped at 20% of the raise");
    assert_eq!(required, 80 * UNIT + 1);
    assert!(approved < required);

    let alone = s.vault.try_release_milestone(&1u32);
    assert!(alone.is_err(), "60% of the money must not be 60% of the vote");

    // With one ally the whale clears the weight (60 + 50 = 110 > 80) but is
    // still one wallet short of three.
    s.vault.approve_milestone(&s.alice, &1u32);
    let (approved, required, _) = s.vault.get_milestone_vote(&1u32);
    assert!(approved >= required);
    assert_eq!(s.vault.get_milestone_wallets(&1u32), (2, 3));
    let pair = s.vault.try_release_milestone(&1u32);
    assert!(pair.is_err(), "two wallets never carry over a third");

    // Only the third wallet carries it.
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.release_milestone(&1u32);
    assert!(s.vault.get_info().milestones.get(0).unwrap().released);
}

/// With every wallet at the cap, two wallets clear the weight bar on their own,
/// so it is the three-wallet floor, not arithmetic, that holds them back.
#[test]
fn release_requires_at_least_three_distinct_wallets() {
    let s = setup();
    fund_evenly(&s); // three at 100 each, each capped to 60

    s.vault.open_milestone_vote(&1u32);
    // Capped total 180, so the weight bar is more than 90.
    let (_, required, _) = s.vault.get_milestone_vote(&1u32);
    assert_eq!(required, 90 * UNIT + 1);

    s.vault.approve_milestone(&s.alice, &1u32);
    assert!(s.vault.try_release_milestone(&1u32).is_err(), "one wallet: 60");

    s.vault.approve_milestone(&s.bob, &1u32);
    let (approved, required, _) = s.vault.get_milestone_vote(&1u32);
    assert!(approved >= required, "120 clears the weight");
    assert_eq!(s.vault.get_milestone_wallets(&1u32), (2, 3));
    assert!(s.vault.try_release_milestone(&1u32).is_err(), "two wallets: 120");

    s.vault.approve_milestone(&s.carol, &1u32);
    s.vault.release_milestone(&1u32); // three wallets
}

/// The threshold carries on its own: a release does not wait for the last
/// backer once more than half the capped total, from three wallets, is behind
/// it.
#[test]
fn a_capped_majority_carries_without_every_backer() {
    let s = setup();
    let dave = Address::generate(&s.env);
    s.minter.mint(&dave, &(1_000 * UNIT));

    s.vault.contribute(&s.alice, &(100 * UNIT));
    s.vault.contribute(&s.bob, &(100 * UNIT));
    s.vault.contribute(&s.carol, &(75 * UNIT));
    s.vault.contribute(&dave, &(25 * UNIT));

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&s.carol, &1u32);

    // Capped total 60 + 60 + 60 + 25 = 205; 180 > 102.5, with dave silent.
    s.vault.release_milestone(&1u32);
    assert!(s.vault.get_info().milestones.get(0).unwrap().released);
}

// ── Concentrated raises ────────────────────────────────────────────────────
//
// Measured against the raw raise, a capped wallet's excess is weight nobody
// can ever cast: a sole backer counts for 20% of a >50% bar, two for 40% at
// most, so their milestones could only lapse and forfeit the bond of a builder
// who delivered. The bar is measured against the capped total instead, and the
// three-wallet floor (or every backer, when there are fewer) keeps that lower
// bar from letting one or two wallets outvote anyone.

/// One backer, one vote: the whole tranche moves.
#[test]
fn a_sole_backer_releases_with_one_vote() {
    let s = setup();
    s.vault.contribute(&s.alice, &GOAL);
    assert_eq!(s.vault.get_state(), VaultState::Funded);

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);

    // Capped total is alice's 60, so the bar is more than 30 — from one wallet.
    let (approved, required, _) = s.vault.get_milestone_vote(&1u32);
    assert_eq!(approved, 60 * UNIT);
    assert_eq!(required, 30 * UNIT + 1);
    assert_eq!(s.vault.get_milestone_wallets(&1u32), (1, 1));

    let builder_start = s.token.balance(&s.builder);
    s.vault.release_milestone(&1u32);
    for id in 2u32..=3u32 {
        s.vault.open_milestone_vote(&id);
        s.vault.approve_milestone(&s.alice, &id);
        s.vault.release_milestone(&id);
    }

    assert_eq!(s.vault.get_state(), VaultState::Completed);
    assert_eq!(s.token.balance(&s.builder), builder_start + GOAL + BOND);
    assert_eq!(s.token.balance(&s.vault_address), 0);
}

/// Silence still fails closed.
#[test]
fn a_sole_backer_who_does_not_vote_still_fails_the_milestone() {
    let s = setup();
    s.vault.contribute(&s.alice, &GOAL);

    s.vault.open_milestone_vote(&1u32);
    assert!(s.vault.try_release_milestone(&1u32).is_err());

    advance(&s.env, VOTING_WINDOW + 1);
    s.vault.settle_lapsed_milestone(&1u32);
    assert_eq!(s.vault.get_state(), VaultState::Refunding);

    // The backer gets their money back plus the whole forfeited bond.
    let before = s.token.balance(&s.alice);
    s.vault.claim_refund(&s.alice);
    assert_eq!(s.token.balance(&s.alice) - before, GOAL + BOND);
}

#[test]
fn a_sole_backers_approval_cannot_be_settled_as_lapsed() {
    let s = setup();
    s.vault.contribute(&s.alice, &GOAL);

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);

    advance(&s.env, VOTING_WINDOW + 1);
    let sabotage = s.vault.try_settle_lapsed_milestone(&1u32);
    assert!(sabotage.is_err(), "an approved milestone stays approved after the window");

    s.vault.release_milestone(&1u32);
}

/// Two backers release by both approving — and the larger one, though it
/// clears the weight alone, still cannot override the smaller.
#[test]
fn two_backers_release_when_both_approve() {
    let s = setup();
    s.vault.contribute(&s.alice, &(250 * UNIT));
    s.vault.contribute(&s.bob, &(50 * UNIT));

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);

    // Capped total 60 + 50 = 110; alice's 60 clears 55 on weight alone.
    let (approved, required, _) = s.vault.get_milestone_vote(&1u32);
    assert!(approved >= required);
    assert_eq!(s.vault.get_milestone_wallets(&1u32), (1, 2));
    assert!(
        s.vault.try_release_milestone(&1u32).is_err(),
        "83% of the money still cannot override the other backer"
    );

    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.release_milestone(&1u32);
    assert!(s.vault.get_info().milestones.get(0).unwrap().released);
}

/// A backer who tops up is still one wallet: a sole backer who contributed
/// twice releases on their own vote. Counting each deposit would make them two
/// contributors and their own approval one short — the same deadlock again.
#[test]
fn a_backer_who_tops_up_is_still_one_wallet() {
    let s = setup();
    s.vault.contribute(&s.alice, &(100 * UNIT));
    s.vault.contribute(&s.alice, &(200 * UNIT));
    assert_eq!(s.vault.get_state(), VaultState::Funded);

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    assert_eq!(s.vault.get_milestone_wallets(&1u32), (1, 1));
    s.vault.release_milestone(&1u32);
}

/// A raise under five base units floors a fifth of it to zero. The cap is held
/// at one unit, so every backer still has weight and a unanimous vote carries.
#[test]
fn a_tiny_raise_still_releases_when_every_backer_approves() {
    let s = setup_full(4, BOND, PLATFORM_FEE, 1);
    s.vault.contribute(&s.alice, &3);
    s.vault.contribute(&s.bob, &1);

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    assert!(s.vault.try_release_milestone(&1u32).is_err(), "bob has not approved");
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.release_milestone(&1u32);
}

/// A raise concentrated enough that the capped weights could not clear half
/// the raise even all together: 60 + 50 + 40 = 150, not more than 150. Measured
/// against the raise this vault could never release anything.
#[test]
fn a_concentrated_raise_releases_when_every_backer_approves() {
    let s = setup();
    s.vault.contribute(&s.carol, &(210 * UNIT));
    s.vault.contribute(&s.alice, &(50 * UNIT));
    s.vault.contribute(&s.bob, &(40 * UNIT));

    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.carol, &1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    assert!(s.vault.try_release_milestone(&1u32).is_err(), "bob has not approved");

    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.release_milestone(&1u32);
}

/// The case the capped total exists for: one wallet holds most of the raise and
/// the rest is spread thin. Measured against the raise, the whale's 60 plus
/// every other backer's 45 is 105 of a needed 151 — unreachable, so one silent
/// small backer used to doom the project. Now the whale and two others carry
/// it, and the whale with one other still cannot.
#[test]
fn a_concentrated_raise_carries_without_its_last_backer() {
    let s = setup();
    let dave = Address::generate(&s.env);
    s.minter.mint(&dave, &(1_000 * UNIT));

    s.vault.contribute(&s.carol, &(255 * UNIT)); // 85% of the raise
    s.vault.contribute(&s.alice, &(15 * UNIT));
    s.vault.contribute(&s.bob, &(15 * UNIT));
    s.vault.contribute(&dave, &(15 * UNIT));

    s.vault.open_milestone_vote(&1u32);
    // Capped total 60 + 15 + 15 + 15 = 105, so the bar is more than 52.5.
    let (_, required, _) = s.vault.get_milestone_vote(&1u32);
    assert_eq!(required, 52 * UNIT + 5_000_001);

    s.vault.approve_milestone(&s.carol, &1u32);
    assert!(s.vault.try_release_milestone(&1u32).is_err(), "the whale alone");

    s.vault.approve_milestone(&s.alice, &1u32);
    assert!(
        s.vault.try_release_milestone(&1u32).is_err(),
        "the whale and one other: 75 clears the weight, but only two wallets"
    );

    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.release_milestone(&1u32); // 90 > 52.5 from three wallets; dave silent
}

/// The capped total is computed from the four largest balances only. A wallet
/// that starts small, is pushed out of the tracked set, and then grows past the
/// cap must displace the smallest tracked balance — or its excess would go
/// uncounted and the bar would sit too high.
#[test]
fn a_late_whale_is_counted_in_the_capped_total() {
    let s = setup_with(1_000 * UNIT, BOND, PLATFORM_FEE);
    let others: [Address; 3] = [
        Address::generate(&s.env),
        Address::generate(&s.env),
        Address::generate(&s.env),
    ];
    for who in others.iter() {
        s.minter.mint(who, &(1_000 * UNIT));
    }

    // Fill the tracked set with four, then add a fifth, smaller, wallet.
    s.vault.contribute(&s.alice, &(50 * UNIT));
    s.vault.contribute(&s.bob, &(60 * UNIT));
    s.vault.contribute(&s.carol, &(70 * UNIT));
    s.vault.contribute(&others[0], &(80 * UNIT));
    s.vault.contribute(&others[1], &(10 * UNIT));
    // Now it grows past everyone, and a sixth tops the raise up to the goal.
    s.vault.contribute(&others[1], &(600 * UNIT));
    s.vault.contribute(&others[2], &(130 * UNIT));

    // Raise 1000, cap 200. Only the 610 balance is over the cap: capped total
    // = 1000 - 410 = 590, so the bar is more than 295.
    s.vault.open_milestone_vote(&1u32);
    let (_, required, _) = s.vault.get_milestone_vote(&1u32);
    assert_eq!(required, 295 * UNIT + 1);
}

/// Up to four wallets can exceed the cap, and every one of them must come off
/// the capped total. Four whales at 240 of a 1000 raise (cap 200) plus 40:
/// capped total 4 * 200 + 40 = 840, so the bar is more than 420 — and two
/// whales with the small backer (440, three wallets) carry it. Tracking only
/// three would leave a whale's 40 excess in, putting the bar above 440.
#[test]
fn a_fourth_capped_wallet_is_counted_in_the_capped_total() {
    let s = setup_with(1_000 * UNIT, BOND, PLATFORM_FEE);
    let dave = Address::generate(&s.env);
    let erin = Address::generate(&s.env);
    s.minter.mint(&dave, &(1_000 * UNIT));
    s.minter.mint(&erin, &(1_000 * UNIT));

    s.vault.contribute(&s.alice, &(240 * UNIT));
    s.vault.contribute(&s.bob, &(240 * UNIT));
    s.vault.contribute(&s.carol, &(240 * UNIT));
    s.vault.contribute(&dave, &(240 * UNIT));
    s.vault.contribute(&erin, &(40 * UNIT));

    s.vault.open_milestone_vote(&1u32);
    let (_, required, _) = s.vault.get_milestone_vote(&1u32);
    assert_eq!(required, 420 * UNIT + 1);

    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&erin, &1u32);
    s.vault.release_milestone(&1u32); // 440 > 420 from three wallets
}

/// Cross-check the tracked capped total against a direct sum over every
/// contributor, for a spread of deterministic contribution orders. Every seed
/// puts one to three wallets over the cap; four is covered above.
#[test]
fn the_capped_total_matches_a_direct_sum() {
    extern crate std;
    let mut concentrated = 0;
    for seed in 1u64..=5 {
        let goal = 2_000 * UNIT;
        let s = setup_with(goal, BOND, PLATFORM_FEE);
        let mut wallets: std::vec::Vec<Address> = std::vec::Vec::new();
        for _ in 0..7 {
            let w = Address::generate(&s.env);
            s.minter.mint(&w, &(10_000 * UNIT));
            wallets.push(w);
        }

        // A small LCG drives who contributes and how much, skewed so that one
        // or two wallets often end up over the cap.
        let mut x = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        let mut raised: i128 = 0;
        while raised < goal {
            x = x
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let who = ((x >> 33) % 7) as usize;
            let big = (x >> 20) % 4 == 0;
            let units = if big { 100 + ((x >> 40) % 400) } else { 5 + ((x >> 45) % 40) };
            let remaining = goal - raised;
            let mut amount = core::cmp::min(units as i128 * UNIT, remaining);
            // Never leave a remainder below the minimum, which nobody could pay.
            if remaining - amount < MIN_CONTRIBUTION {
                amount = remaining;
            }
            s.vault.contribute(&wallets[who], &amount);
            raised += amount;
        }
        assert_eq!(s.vault.get_state(), VaultState::Funded);

        let cap = raised * 2_000 / 10_000;
        let mut direct: i128 = 0;
        for w in wallets.iter() {
            let b = s.vault.get_balance(w);
            direct += if b < cap { b } else { cap };
        }
        if direct < raised {
            concentrated += 1;
        }

        s.vault.open_milestone_vote(&1u32);
        let (_, required, _) = s.vault.get_milestone_vote(&1u32);
        assert_eq!(required, direct * 5_000 / 10_000 + 1, "seed {}", seed);
    }
    assert_eq!(concentrated, 5, "every seed puts a wallet over the cap");
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
    s.vault.approve_milestone(&s.alice, &1u32); // 60 of the 91 needed, one wallet of three

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

/// A window that cleared the weight but not the wallet floor did not carry, so
/// it lapses like any other — otherwise the milestone could neither be released
/// nor failed, and contributor funds would sit locked.
#[test]
fn a_window_short_of_the_wallet_floor_lapses() {
    let s = setup();
    fund_evenly(&s); // capped total 180, bar more than 90
    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32); // 120 clears the weight, two wallets
    assert!(s.vault.try_release_milestone(&1u32).is_err(), "two wallets do not carry");

    advance(&s.env, VOTING_WINDOW + 1);
    s.vault.settle_lapsed_milestone(&1u32);
    assert_eq!(s.vault.get_state(), VaultState::Refunding);
    assert!(s.vault.get_info().milestones.get(0).unwrap().failed);
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

    // The first two get exactly their share.
    for backer in [&s.alice, &s.bob] {
        let before = s.token.balance(backer);
        s.vault.claim_refund(backer);
        assert_eq!(s.token.balance(backer) - before, expected);
    }

    // The last claimant also sweeps the rounding dust, so nothing is stranded.
    let before = s.token.balance(&s.carol);
    s.vault.claim_refund(&s.carol);
    let last_payout = s.token.balance(&s.carol) - before;
    assert!(
        last_payout >= expected,
        "the final claimant must not be shortchanged"
    );

    // Builder keeps only the released tranche; the bond is gone.
    assert_eq!(s.token.balance(&s.builder), 100 * UNIT);
    // Fully drained — not "almost", which is what truncation used to leave.
    assert_eq!(
        s.token.balance(&s.vault_address),
        0,
        "no dust may be stranded in the vault"
    );
    // And the whole pot is accounted for.
    assert_eq!(2 * expected + last_payout, 200 * UNIT + BOND);
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

    let record = s.registry.get_record(&s.vault_address);
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

    let record = s.registry.get_record(&s.vault_address);
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

    let record = s.registry.get_record(&s.vault_address);
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

    let first = s.registry.get_record(&s.vault_address);
    assert_eq!(first.outcome, RegistryOutcome::FailedWithForfeiture);

    // Draining the vault afterwards must not rewrite history.
    s.vault.claim_refund(&s.alice);
    s.vault.settle();

    let after = s.registry.get_record(&s.vault_address);
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

// ── Paged reads ────────────────────────────────────────────────────────────

#[test]
fn contributors_are_paged_rather_than_returned_whole() {
    let s = setup();
    fund_evenly(&s);

    assert_eq!(s.vault.contributor_count(), 3);

    let first = s.vault.get_contributors(&0u32, &2u32);
    assert_eq!(first.len(), 2);

    let second = s.vault.get_contributors(&2u32, &2u32);
    assert_eq!(second.len(), 1, "final page is short, not wrapped");

    let past_end = s.vault.get_contributors(&99u32, &10u32);
    assert_eq!(past_end.len(), 0, "reading past the end is empty, not an error");
}

#[test]
fn an_oversized_page_request_is_clamped() {
    let s = setup();
    fund_evenly(&s);

    // A caller asking for a page big enough to blow the resource budget gets a
    // capped page instead of a failed call.
    let huge = s.vault.get_contributors(&0u32, &1_000_000u32);
    assert_eq!(huge.len(), 3);

    // Zero means "use the default", not "return nothing".
    let zero = s.vault.get_contributors(&0u32, &0u32);
    assert_eq!(zero.len(), 3);
}

// ── Abandonment recovery ────────────────────────────────────────────────────
//
// A funded vault advances only when the builder opens the next milestone vote —
// an action no one else can take. settle_stalled is the permissionless escape
// hatch so an abandoned project cannot strand contributor funds forever.

const STALL_WINDOW: u64 = 90 * 24 * 60 * 60; // mirrors BUILDER_STALL_WINDOW

#[test]
fn an_abandoned_funded_vault_can_be_reclaimed_for_contributors() {
    let s = setup();
    fund_evenly(&s); // early-closes to Funded; the abandonment clock starts here
    assert_eq!(s.vault.get_state(), VaultState::Funded);

    // Builder opens no vote. Before the window elapses, nobody can force it.
    advance(&s.env, STALL_WINDOW - 1);
    assert!(
        s.vault.try_settle_stalled().is_err(),
        "cannot reclaim before the stall window elapses"
    );

    // Past the window, anyone may fail the project and free the funds.
    advance(&s.env, 2);
    s.vault.settle_stalled();
    assert_eq!(s.vault.get_state(), VaultState::Refunding);

    // Nothing was ever released, so the builder keeps nothing and the bond is
    // forfeited: each backer reclaims principal plus a third of the bond.
    let expected = 100 * UNIT + (100 * UNIT * BOND / (300 * UNIT));
    let before = s.token.balance(&s.alice);
    s.vault.claim_refund(&s.alice);
    assert_eq!(s.token.balance(&s.alice) - before, expected);
    assert_eq!(s.token.balance(&s.builder), 0, "an abandoning builder keeps nothing");
}

#[test]
fn releasing_a_milestone_resets_the_stall_clock() {
    let s = setup();
    fund_evenly(&s);

    // A month in, the builder releases the first milestone.
    advance(&s.env, 30 * 24 * 60 * 60);
    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&s.carol, &1u32);
    s.vault.release_milestone(&1u32);
    assert_eq!(s.vault.get_state(), VaultState::Active);

    // 65 days later: 95 from funding, but only 65 from the release. Measured from
    // funding this would be stalled; measured from the last release it is not —
    // which is the point of the reset.
    advance(&s.env, 65 * 24 * 60 * 60);
    assert!(
        s.vault.try_settle_stalled().is_err(),
        "each release resets the abandonment clock"
    );

    // Genuinely idle past the window (in the Active state), it is reclaimable.
    advance(&s.env, STALL_WINDOW);
    s.vault.settle_stalled();
    assert_eq!(s.vault.get_state(), VaultState::Refunding);
}

#[test]
fn an_open_vote_is_not_abandonment() {
    let s = setup();
    fund_evenly(&s);

    // Just before the window closes, the builder opens a vote — they are active.
    advance(&s.env, STALL_WINDOW - 10);
    s.vault.open_milestone_vote(&1u32);

    // Even now past the funding-anchored window, an open and unelapsed vote
    // blocks the stall path; the lapse path governs an open vote, not this one.
    advance(&s.env, 20);
    assert!(
        s.vault.try_settle_stalled().is_err(),
        "an open, unelapsed vote is not abandonment"
    );
}

/// A milestone contributors carried is a release waiting to happen, not
/// abandonment. Opening a vote does not reset the stall clock, so without this
/// a dissenting contributor could fail an approved milestone — and forfeit the
/// builder's bond — in the first ledger after its window closed.
#[test]
fn a_carried_vote_cannot_be_stalled_out() {
    let s = setup();
    fund_evenly(&s);
    advance(&s.env, STALL_WINDOW - 10);
    s.vault.open_milestone_vote(&1u32);
    s.vault.approve_milestone(&s.alice, &1u32);
    s.vault.approve_milestone(&s.bob, &1u32);
    s.vault.approve_milestone(&s.carol, &1u32);

    advance(&s.env, VOTING_WINDOW + 1);
    assert!(s.vault.try_settle_stalled().is_err(), "the vote carried");
    s.vault.release_milestone(&1u32);
}

#[test]
fn rejects_more_milestones_than_the_cap() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let builder = Address::generate(&env);
    let issuer = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(issuer.clone());
    StellarAssetClient::new(&env, &asset.address()).mint(&builder, &(BOND + PLATFORM_FEE));

    let identity_id = env.register(MockIdentity, ());
    MockIdentityClient::new(&env, &identity_id).set_approved(&builder, &true);
    let vault = BlkfndrVaultClient::new(&env, &env.register(BlkfndrVault, ()));

    // 21 milestones — one past MAX_MILESTONES — summing to the goal, so the only
    // thing wrong is the count.
    let mut milestones = Vec::new(&env);
    for i in 0..21u32 {
        milestones.push_back(MilestoneInput { id: i + 1, amount: UNIT });
    }

    let result = vault.try_initialize(&VaultInitConfig {
        project_id: 1,
        creator: builder.clone(),
        token: asset.address(),
        goal: 21 * UNIT,
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

    assert!(result.is_err(), "a milestone list past the cap is rejected");
}
