#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Env,
};

const DAY: u64 = 24 * 60 * 60;

struct Fixture {
    env: Env,
    treasury: TreasuryClient<'static>,
    token: Address,
    token_admin: StellarAssetClient<'static>,
    token_client: TokenClient<'static>,
    holders: [Address; 3],
    factory: Address,
}

/// Three shareholders at 50/30/20. With a >50% threshold that means the
/// majority holder alone is not enough — 5000 is not more than 5000 — so every
/// release needs at least two of them.
fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer.clone());
    let token = sac.address();

    let holders = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let factory = Address::generate(&env);

    let treasury_id = env.register(Treasury, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);

    treasury.initialize(
        &factory,
        &vec![
            &env,
            Shareholder { address: holders[0].clone(), share_bps: 5_000 },
            Shareholder { address: holders[1].clone(), share_bps: 3_000 },
            Shareholder { address: holders[2].clone(), share_bps: 2_000 },
        ],
    );

    Fixture {
        token_admin: StellarAssetClient::new(&env, &token),
        token_client: TokenClient::new(&env, &token),
        env,
        treasury,
        token,
        holders,
        factory,
    }
}

/// Simulate listing fees arriving: the factory's vault transfers them here.
fn fees_arrive(f: &Fixture, amount: i128) {
    f.token_admin
        .mint(&f.treasury.address, &amount);
}

#[test]
fn fees_accumulate_until_a_cycle_is_opened() {
    let f = setup();
    fees_arrive(&f, 1_000);
    assert_eq!(f.treasury.balance_of(&f.token), 1_000);
    assert!(f.treasury.get_cycle().is_none());
}

#[test]
fn a_majority_shareholder_cannot_release_alone() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    // 5000 bps is exactly half, and the threshold is MORE than half.
    f.treasury.approve_cycle(&f.holders[0]);

    let cycle = f.treasury.get_cycle().unwrap();
    assert_eq!(cycle.approved_bps, 5_000);
    assert_eq!(cycle.state, CycleState::Voting, "half is not a majority");
}

#[test]
fn two_shareholders_carry_a_release() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[2]); // 5000 + 2000 = 7000

    assert_eq!(f.treasury.get_cycle().unwrap().state, CycleState::Payable);
}

#[test]
fn each_shareholder_claims_exactly_their_share() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);

    f.treasury.claim(&f.holders[0]);
    f.treasury.claim(&f.holders[1]);
    f.treasury.claim(&f.holders[2]);

    assert_eq!(f.token_client.balance(&f.holders[0]), 500);
    assert_eq!(f.token_client.balance(&f.holders[1]), 300);
    assert_eq!(f.token_client.balance(&f.holders[2]), 200);
    assert_eq!(f.treasury.balance_of(&f.token), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #38)")] // AlreadyClaimed
fn a_shareholder_cannot_claim_twice() {
    let f = setup();
    fees_arrive(&f, 1_000);
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    f.treasury.claim(&f.holders[0]);
    f.treasury.claim(&f.holders[0]);
}

#[test]
#[should_panic(expected = "Error(Contract, #33)")] // AlreadyVoted
fn a_shareholder_cannot_vote_twice() {
    let f = setup();
    fees_arrive(&f, 1_000);
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[0]);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // NotAShareholder
fn a_stranger_cannot_vote() {
    let f = setup();
    fees_arrive(&f, 1_000);
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&Address::generate(&f.env));
}

#[test]
fn fees_arriving_mid_vote_belong_to_the_next_cycle() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    fees_arrive(&f, 500); // a project is created while the vote runs

    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);

    // The cycle settles the 1000 it snapshotted, not the 1500 now held.
    assert_eq!(f.treasury.get_cycle().unwrap().amount, 1_000);

    f.treasury.claim(&f.holders[0]);
    f.treasury.claim(&f.holders[1]);
    f.treasury.claim(&f.holders[2]);

    assert_eq!(f.token_client.balance(&f.holders[0]), 500);
    assert_eq!(
        f.treasury.balance_of(&f.token),
        500,
        "the later fee stays for the next cycle"
    );
}

#[test]
fn a_lapsed_cycle_pays_nobody_and_strands_nothing() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[2]); // 2000 only

    f.env.ledger().with_mut(|l| l.timestamp += 8 * DAY);
    f.treasury.settle_lapsed_cycle();

    assert_eq!(f.treasury.get_cycle().unwrap().state, CycleState::Lapsed);
    assert_eq!(f.treasury.balance_of(&f.token), 1_000, "money stays put");

    // And the balance is claimable through a fresh cycle.
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    f.treasury.claim(&f.holders[0]);
    assert_eq!(f.token_client.balance(&f.holders[0]), 500);
}

#[test]
#[should_panic(expected = "Error(Contract, #31)")] // CycleAlreadyOpen
fn the_register_cannot_change_while_a_cycle_is_live() {
    let f = setup();
    fees_arrive(&f, 1_000);
    f.treasury.open_cycle(&f.holders[0], &f.token);

    // Rewriting shares mid-vote is how someone gets diluted after earning.
    f.treasury.set_shareholders(
        &f.holders[0],
        &vec![
            &f.env,
            Shareholder { address: f.holders[0].clone(), share_bps: 10_000 },
        ],
    );
}

#[test]
fn a_cycle_pays_the_snapshot_even_if_the_register_changes_after() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);

    // Everyone claims what the register said at open.
    f.treasury.claim(&f.holders[2]);
    assert_eq!(f.token_client.balance(&f.holders[2]), 200);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")] // SharesMustTotalBps
fn shares_must_total_exactly_ten_thousand() {
    let env = Env::default();
    env.mock_all_auths();
    let treasury = TreasuryClient::new(&env, &env.register(Treasury, ()));
    treasury.initialize(
        &Address::generate(&env),
        &vec![
            &env,
            Shareholder { address: Address::generate(&env), share_bps: 6_000 },
            Shareholder { address: Address::generate(&env), share_bps: 3_000 },
        ],
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")] // DuplicateShareholder
fn a_shareholder_cannot_be_listed_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let who = Address::generate(&env);
    let treasury = TreasuryClient::new(&env, &env.register(Treasury, ()));
    treasury.initialize(
        &Address::generate(&env),
        &vec![
            &env,
            Shareholder { address: who.clone(), share_bps: 5_000 },
            Shareholder { address: who, share_bps: 5_000 },
        ],
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #32)")] // NothingToRelease
fn a_cycle_cannot_open_over_an_empty_balance() {
    let f = setup();
    f.treasury.open_cycle(&f.holders[0], &f.token);
}

// ── Fee governance ─────────────────────────────────────────────────────────

#[test]
fn a_fee_change_needs_more_than_half_the_shares() {
    let f = setup();

    f.treasury.propose_fee(&f.holders[0], &50_000_000);
    f.treasury.approve_fee(&f.holders[0]); // 5000, exactly half

    let proposal = f.treasury.get_fee_proposal().unwrap();
    assert_eq!(proposal.approved_bps, 5_000);
    assert_eq!(proposal.new_fee, 50_000_000);

    f.treasury.approve_fee(&f.holders[2]); // 7000, carried
    assert_eq!(f.treasury.get_fee_proposal().unwrap().approved_bps, 7_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #35)")] // ThresholdNotMet
fn a_fee_change_cannot_be_applied_before_the_vote_carries() {
    let f = setup();
    f.treasury.propose_fee(&f.holders[0], &50_000_000);
    f.treasury.approve_fee(&f.holders[0]); // half only
    f.treasury.execute_fee();
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // NotAShareholder
fn a_stranger_cannot_propose_a_fee() {
    let f = setup();
    f.treasury.propose_fee(&Address::generate(&f.env), &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #42)")] // FeeOutOfRange
fn a_negative_fee_is_refused() {
    let f = setup();
    f.treasury.propose_fee(&f.holders[0], &-1);
}

#[test]
fn the_treasury_holds_several_tokens_and_settles_them_separately() {
    let f = setup();

    let issuer_b = Address::generate(&f.env);
    let sac_b = f.env.register_stellar_asset_contract_v2(issuer_b);
    let token_b = sac_b.address();
    StellarAssetClient::new(&f.env, &token_b).mint(&f.treasury.address, &400);

    fees_arrive(&f, 1_000);

    // A cycle over token A leaves token B untouched.
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    f.treasury.claim(&f.holders[0]);

    assert_eq!(f.token_client.balance(&f.holders[0]), 500);
    assert_eq!(f.treasury.balance_of(&token_b), 400, "other token untouched");
}
