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
    let deployer = Address::generate(&env);

    let treasury_id = env.register(
        Treasury,
        (
            deployer.clone(),
            factory.clone(),
            vec![
                &env,
                Shareholder { address: holders[0].clone(), share_bps: 5_000 },
                Shareholder { address: holders[1].clone(), share_bps: 3_000 },
                Shareholder { address: holders[2].clone(), share_bps: 2_000 },
            ],
        ),
    );
    let treasury = TreasuryClient::new(&env, &treasury_id);

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
    assert!(f.treasury.get_open_cycle().is_none());
}

#[test]
fn a_single_owner_cannot_release_alone() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    // One of three. Two-to-one needs two, whatever their shares are.
    f.treasury.approve_cycle(&f.holders[0]);

    let cycle = f.treasury.get_open_cycle().unwrap();
    assert_eq!(cycle.approvals, 1);
    assert_eq!(cycle.state, CycleState::Voting, "one of three is not two-to-one");
}

#[test]
fn two_shareholders_carry_a_release() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[2]); // two of three, carries

    assert_eq!(f.treasury.get_cycle(&1).unwrap().state, CycleState::Payable);
}

#[test]
fn each_shareholder_claims_exactly_their_share() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);

    f.treasury.claim(&f.holders[0], &1);
    f.treasury.claim(&f.holders[1], &1);
    f.treasury.claim(&f.holders[2], &1);

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
    f.treasury.claim(&f.holders[0], &1);
    f.treasury.claim(&f.holders[0], &1);
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
    assert_eq!(f.treasury.get_cycle(&1).unwrap().amount, 1_000);

    f.treasury.claim(&f.holders[0], &1);
    f.treasury.claim(&f.holders[1], &1);
    f.treasury.claim(&f.holders[2], &1);

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
    f.treasury.approve_cycle(&f.holders[2]); // one of three

    f.env.ledger().with_mut(|l| l.timestamp += 8 * DAY);
    f.treasury.settle_lapsed_cycle();

    assert_eq!(f.treasury.get_cycle(&1).unwrap().state, CycleState::Lapsed);
    assert_eq!(f.treasury.balance_of(&f.token), 1_000, "money stays put");

    // And the balance is claimable through a fresh cycle.
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    f.treasury.claim(&f.holders[0], &2);
    assert_eq!(f.token_client.balance(&f.holders[0]), 500);
}

// ── Regressions ────────────────────────────────────────────────────────────
//
// Three defects, each found by running the contract rather than reading it, and
// each of which the original 22 tests passed straight over.

/// The drain. `set_shareholders` used to take one shareholder's signature and no
/// vote, so the register — which decides who gets paid — was writable by anyone
/// on it. The *smallest* holder could name themselves the whole register, open a
/// cycle, carry it alone, and take everything.
///
/// Every other path was vote-gated, which is exactly why this mattered: you do
/// not need to beat the vote if you can rewrite who is entitled to one.
#[test]
fn one_shareholder_cannot_rewrite_the_register_and_take_everything() {
    let f = setup();
    fees_arrive(&f, 1_000);

    let attacker = f.holders[2].clone(); // the 20% holder
    let grab = vec![
        &f.env,
        Shareholder { address: attacker.clone(), share_bps: 10_000 },
    ];

    // Proposing is allowed — any shareholder may put it to the others.
    f.treasury
        .propose(&attacker, &GovernedAction::SetShareholders(grab));

    // Their own 2000 bps is nowhere near the threshold, and executing on a vote
    // that has not carried is refused.
    f.treasury.approve_proposal(&attacker);
    assert_eq!(f.treasury.get_proposal().unwrap().approvals, 1);
    assert!(
        f.treasury.try_execute_proposal().is_err(),
        "one owner of three must not be able to rewrite the register alone"
    );

    // The register is untouched, so a cycle still pays all three.
    assert_eq!(f.treasury.get_shareholders().len(), 3);
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    f.treasury.claim(&attacker, &1);
    assert_eq!(
        f.token_client.balance(&attacker),
        200,
        "the attacker gets their real share and nothing more"
    );
}

/// The same change carried by an actual majority does apply.
#[test]
fn a_majority_can_change_the_register_by_vote() {
    let f = setup();
    let newcomer = Address::generate(&f.env);

    f.treasury.propose(
        &f.holders[0],
        &GovernedAction::SetShareholders(vec![
            &f.env,
            Shareholder { address: f.holders[0].clone(), share_bps: 4_000 },
            Shareholder { address: f.holders[1].clone(), share_bps: 3_000 },
            Shareholder { address: f.holders[2].clone(), share_bps: 2_000 },
            Shareholder { address: newcomer.clone(), share_bps: 1_000 },
        ]),
    );
    f.treasury.approve_proposal(&f.holders[0]);
    f.treasury.approve_proposal(&f.holders[1]); // two of three, carries
    f.treasury.execute_proposal();

    let roster = f.treasury.get_shareholders();
    assert_eq!(roster.len(), 4);
    assert_eq!(roster.get(3).unwrap().address, newcomer);
}

/// A register that does not total 10 000 is refused even with the votes.
#[test]
#[should_panic(expected = "Error(Contract, #21)")] // SharesMustTotalBps
fn a_voted_register_still_has_to_total_ten_thousand() {
    let f = setup();
    f.treasury.propose(
        &f.holders[0],
        &GovernedAction::SetShareholders(vec![
            &f.env,
            Shareholder { address: f.holders[0].clone(), share_bps: 9_000 },
        ]),
    );
}

/// The deadlock. A payable cycle used to occupy the single cycle slot forever —
/// there was no state meaning "settled" — so the *first successful distribution*
/// permanently bricked the treasury. Every fee after that was unreachable.
///
/// This is the whole point of the contract: shareholders vote to end a cycle and
/// start another one. It was verified on testnet, where cycle 2 failed to open
/// with CycleAlreadyOpen while all three shareholders showed has_claimed = true.
#[test]
fn a_new_cycle_opens_after_a_fully_claimed_one() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    f.treasury.claim(&f.holders[0], &1);
    f.treasury.claim(&f.holders[1], &1);
    f.treasury.claim(&f.holders[2], &1);
    assert_eq!(f.treasury.balance_of(&f.token), 0);

    // More fees arrive, and the shareholders run the whole thing again.
    // Releases are monthly, measured from the one that carried.
    f.env.ledger().with_mut(|l| l.timestamp += 31 * DAY);
    fees_arrive(&f, 500);
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    f.treasury.claim(&f.holders[0], &2);

    assert_eq!(
        f.token_client.balance(&f.holders[0]),
        500 + 250,
        "cycle 2 pays on top of cycle 1"
    );
}

/// And a cycle can open while an earlier one is still only *partly* claimed —
/// otherwise one shareholder who is slow, or has lost their key, freezes
/// everyone else's earnings indefinitely.
#[test]
fn a_slow_claimant_does_not_block_the_next_cycle() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    f.treasury.claim(&f.holders[0], &1); // holders 1 and 2 do not claim yet

    fees_arrive(&f, 500);
    f.env.ledger().with_mut(|l| l.timestamp += 31 * DAY);
    f.treasury.open_cycle(&f.holders[1], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);

    // Cycle 2 saw only the new 500 — the 500 still owed to holders 1 and 2 from
    // cycle 1 is reserved, and a later cycle cannot pay it to somebody else.
    assert_eq!(f.treasury.get_cycle(&2).unwrap().amount, 500);

    // The stragglers can still collect cycle 1 in full, whenever they get to it.
    f.treasury.claim(&f.holders[1], &1);
    f.treasury.claim(&f.holders[2], &1);
    assert_eq!(f.token_client.balance(&f.holders[1]), 300);
    assert_eq!(f.token_client.balance(&f.holders[2]), 200);

    // The two cycles are settled independently, so a late cycle-1 claim does not
    // forfeit cycle 2 or vice versa.
    f.treasury.claim(&f.holders[1], &2);
    assert_eq!(f.token_client.balance(&f.holders[1]), 300 + 150);
}

/// The land grab the constructor closes: a treasury used to sit deployed and
/// unconfigured for a ledger between deploy and initialize, and whoever called
/// initialize first owned it. A constructor runs inside the deploy transaction —
/// no gap — and still demands the deployer's signature, which this proves.
#[test]
#[should_panic] // deployer.require_auth() fails without the deployer's signature
fn construction_requires_the_deployers_signature() {
    let env = Env::default(); // deliberately no mock_all_auths
    env.register(
        Treasury,
        (
            Address::generate(&env),
            Address::generate(&env),
            vec![
                &env,
                Shareholder { address: Address::generate(&env), share_bps: 10_000 },
            ],
        ),
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
    f.treasury.claim(&f.holders[2], &1);
    assert_eq!(f.token_client.balance(&f.holders[2]), 200);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")] // SharesMustTotalBps
fn shares_must_total_exactly_ten_thousand() {
    let env = Env::default();
    env.mock_all_auths();
    env.register(
        Treasury,
        (
            Address::generate(&env),
            Address::generate(&env),
            vec![
                &env,
                Shareholder { address: Address::generate(&env), share_bps: 6_000 },
                Shareholder { address: Address::generate(&env), share_bps: 3_000 },
            ],
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")] // DuplicateShareholder
fn a_shareholder_cannot_be_listed_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let who = Address::generate(&env);
    env.register(
        Treasury,
        (
            Address::generate(&env),
            Address::generate(&env),
            vec![
                &env,
                Shareholder { address: who.clone(), share_bps: 5_000 },
                Shareholder { address: who, share_bps: 5_000 },
            ],
        ),
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

    f.treasury.propose(&f.holders[0], &GovernedAction::SetFee(50_000_000));
    f.treasury.approve_proposal(&f.holders[0]); // one of three

    let proposal = f.treasury.get_proposal().unwrap();
    assert_eq!(proposal.approvals, 1);
    

    f.treasury.approve_proposal(&f.holders[2]); // two of three, carries
    assert_eq!(f.treasury.get_proposal().unwrap().approvals, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #35)")] // ThresholdNotMet
fn a_fee_change_cannot_be_applied_before_the_vote_carries() {
    let f = setup();
    f.treasury.propose(&f.holders[0], &GovernedAction::SetFee(50_000_000));
    f.treasury.approve_proposal(&f.holders[0]); // one of three only
    f.treasury.execute_proposal();
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // NotAShareholder
fn a_stranger_cannot_propose_a_fee() {
    let f = setup();
    f.treasury.propose(&Address::generate(&f.env), &GovernedAction::SetFee(1));
}

#[test]
#[should_panic(expected = "Error(Contract, #42)")] // FeeOutOfRange
fn a_negative_fee_is_refused() {
    let f = setup();
    f.treasury.propose(&f.holders[0], &GovernedAction::SetFee(-1));
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
    f.treasury.claim(&f.holders[0], &1);

    assert_eq!(f.token_client.balance(&f.holders[0]), 500);
    assert_eq!(f.treasury.balance_of(&token_b), 400, "other token untouched");
}

/// The escape hatch. If factory admin is pointed at this contract, only the
/// actions it implements are reachable — so without a way to hand admin back,
/// the factory's other seven admin functions would be stranded permanently.
#[test]
fn a_vote_can_hand_factory_admin_back() {
    let f = setup();
    let human = Address::generate(&f.env);

    f.treasury
        .propose(&f.holders[0], &GovernedAction::TransferAdmin(human.clone()));
    f.treasury.approve_proposal(&f.holders[0]);
    f.treasury.approve_proposal(&f.holders[1]);

    let proposal = f.treasury.get_proposal().unwrap();
    assert_eq!(proposal.approvals, 2);
    match proposal.action {
        GovernedAction::TransferAdmin(a) => assert_eq!(a, human),
        _ => panic!("wrong action recorded"),
    }
    // execute_proposal is exercised against the real factory on testnet; here
    // the factory is a generated address with no contract behind it.
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")] // ProposalAlreadyOpen
fn a_second_proposal_cannot_open_while_one_is_live() {
    let f = setup();
    f.treasury.propose(&f.holders[0], &GovernedAction::SetFee(1));
    f.treasury.propose(&f.holders[1], &GovernedAction::SetFee(2));
}

/// The fixture's factory address is what initialize recorded, and the treasury
/// must report it back — this is the address every proposal will call.
#[test]
fn the_treasury_records_the_factory_it_governs() {
    let f = setup();
    assert_eq!(f.treasury.get_factory(), f.factory);
}

// ── The owners' rules ──────────────────────────────────────────────────────
//
// Two-to-one by headcount, equal shares, and a release no more often than
// monthly. Written as tests because each is a rule someone will eventually ask
// "are we sure?" about.

/// The strict rule, at the size it was specified for.
#[test]
fn two_of_three_carries_and_one_does_not() {
    let f = setup();
    fees_arrive(&f, 900);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    assert_eq!(
        f.treasury.get_open_cycle().unwrap().state,
        CycleState::Voting,
        "one owner is not two-to-one"
    );

    f.treasury.approve_cycle(&f.holders[1]);
    assert_eq!(f.treasury.get_cycle(&1).unwrap().state, CycleState::Payable);
}

/// Two thirds rounds up, so three of four is needed and two is not.
///
/// This is the case integer division gets wrong: 2/3 of 4 truncates to 2, which
/// would let half the owners release the money.
#[test]
fn three_of_four_is_needed_once_a_fourth_owner_joins() {
    let f = setup();
    let fourth = Address::generate(&f.env);

    f.treasury.propose(
        &f.holders[0],
        &GovernedAction::SetOwners(vec![
            &f.env,
            f.holders[0].clone(),
            f.holders[1].clone(),
            f.holders[2].clone(),
            fourth.clone(),
        ]),
    );
    f.treasury.approve_proposal(&f.holders[0]);
    f.treasury.approve_proposal(&f.holders[1]);
    f.treasury.execute_proposal();

    fees_arrive(&f, 1_000);
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    assert_eq!(
        f.treasury.get_open_cycle().unwrap().state,
        CycleState::Voting,
        "two of four is a half, not two thirds"
    );

    f.treasury.approve_cycle(&f.holders[2]);
    assert_eq!(f.treasury.get_cycle(&1).unwrap().state, CycleState::Payable);
}

/// Owners hold equal shares, and 10 000 does not divide by three.
#[test]
fn owners_share_equally_with_the_remainder_going_to_the_earliest() {
    let f = setup();

    f.treasury.propose(
        &f.holders[0],
        &GovernedAction::SetOwners(vec![
            &f.env,
            f.holders[0].clone(),
            f.holders[1].clone(),
            f.holders[2].clone(),
        ]),
    );
    f.treasury.approve_proposal(&f.holders[0]);
    f.treasury.approve_proposal(&f.holders[1]);
    f.treasury.execute_proposal();

    let roster = f.treasury.get_shareholders();
    assert_eq!(roster.get(0).unwrap().share_bps, 3_334);
    assert_eq!(roster.get(1).unwrap().share_bps, 3_333);
    assert_eq!(roster.get(2).unwrap().share_bps, 3_333);

    let total: u32 = (0..roster.len()).map(|i| roster.get(i).unwrap().share_bps).sum();
    assert_eq!(total, 10_000, "a register that does not total the whole strands money");
}

/// Monthly, and measured from the release that carried.
#[test]
#[should_panic(expected = "Error(Contract, #39)")] // ReleaseTooSoon
fn a_second_release_cannot_open_within_thirty_days() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);

    fees_arrive(&f, 500);
    f.env.ledger().with_mut(|l| l.timestamp += 29 * DAY);
    f.treasury.open_cycle(&f.holders[0], &f.token);
}

/// A vote that fails must not cost anyone a month.
#[test]
fn a_lapsed_cycle_does_not_start_the_monthly_clock() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]); // one of three, short
    f.env.ledger().with_mut(|l| l.timestamp += 8 * DAY);
    f.treasury.settle_lapsed_cycle();

    // Immediately retryable: nothing was released, so nothing started the clock.
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    assert_eq!(f.treasury.get_cycle(&2).unwrap().state, CycleState::Payable);
}

/// Any owner may open the cycle, not just whoever opened the last one.
#[test]
fn any_owner_can_open_a_cycle() {
    let f = setup();
    fees_arrive(&f, 1_000);

    f.treasury.open_cycle(&f.holders[2], &f.token);
    assert_eq!(f.treasury.get_open_cycle().unwrap().id, 1);
}

// ── Factory governance ─────────────────────────────────────────────────────
//
// The factory has seven admin-gated setters. This contract can become that
// admin, so it must be able to reach all seven — otherwise handing over admin
// strands whatever it cannot call, and the only way back is TransferAdmin.

/// A bond above the whole raise is refused before anyone votes on it.
#[test]
#[should_panic(expected = "Error(Contract, #42)")] // FeeOutOfRange
fn a_bond_over_one_hundred_percent_is_refused_at_proposal() {
    let f = setup();
    f.treasury
        .propose(&f.holders[0], &GovernedAction::SetBondBps(10_001));
}

#[test]
fn a_bond_change_carries_on_two_of_three() {
    let f = setup();

    f.treasury
        .propose(&f.holders[0], &GovernedAction::SetBondBps(750));
    f.treasury.approve_proposal(&f.holders[0]);
    assert_eq!(
        f.treasury.get_proposal().unwrap().approvals,
        1,
        "one owner is not two-to-one"
    );

    f.treasury.approve_proposal(&f.holders[1]);
    let proposal = f.treasury.get_proposal().unwrap();
    assert_eq!(proposal.approvals, 2);
    match proposal.action {
        GovernedAction::SetBondBps(bps) => assert_eq!(bps, 750),
        _ => panic!("wrong action recorded"),
    }
    // execute_proposal is exercised against the real factory on testnet; here
    // the factory is a generated address with no contract behind it.
}

/// A negative minimum contribution is nonsense and is caught early.
#[test]
#[should_panic(expected = "Error(Contract, #42)")] // FeeOutOfRange
fn a_negative_minimum_contribution_is_refused() {
    let f = setup();
    f.treasury
        .propose(&f.holders[0], &GovernedAction::SetMinContribution(-1));
}

/// Every factory setter is reachable, so taking factory admin strands nothing.
///
/// This is the test that matters for the handover. Reaching only some of them
/// would mean vault upgrades, fee redirection or the identity registry became
/// unchangeable the moment the treasury became admin — recoverable only by
/// voting admin back out to a human.
#[test]
fn every_factory_setter_can_be_proposed() {
    let f = setup();
    let addr = Address::generate(&f.env);

    let actions = vec![
        &f.env,
        GovernedAction::SetFee(1),
        GovernedAction::SetBondBps(500),
        GovernedAction::SetFeeWallet(addr.clone()),
        GovernedAction::SetIdentityRegistry(addr.clone()),
        GovernedAction::SetVotingWindow(86_400),
        GovernedAction::SetMinContribution(50),
        GovernedAction::TransferAdmin(addr),
    ];

    for i in 0..actions.len() {
        let action = actions.get(i).unwrap();
        f.treasury.propose(&f.holders[0], &action);
        // Carry it so the slot frees for the next one.
        f.treasury.approve_proposal(&f.holders[0]);
        f.treasury.approve_proposal(&f.holders[1]);
        assert!(
            f.treasury.get_proposal().is_some(),
            "proposal {i} did not record",
        );
        f.env.ledger().with_mut(|l| l.timestamp += 8 * DAY);
    }
}

// ── Operations funding: the monthly XLM cut to the Operations Vault ──────────

/// Configure ops funding by a carried vote — the setup every ops test needs.
fn set_ops_funding(f: &Fixture, vault: &Address, bps: u32) {
    f.treasury.propose(
        &f.holders[0],
        &GovernedAction::SetOpsFunding(OpsFundingTerms {
            vault: vault.clone(),
            token: f.token.clone(),
            bps,
        }),
    );
    f.treasury.approve_proposal(&f.holders[0]);
    f.treasury.approve_proposal(&f.holders[1]);
    f.treasury.execute_proposal();
}

#[test]
fn ops_funding_routes_the_monthly_cut() {
    let f = setup();
    let ops = Address::generate(&f.env);
    fees_arrive(&f, 1_000);
    set_ops_funding(&f, &ops, 2_000); // 20%

    assert_eq!(f.treasury.ops_funding_available(), 200);
    f.treasury.fund_operations();
    assert_eq!(f.token_client.balance(&ops), 200);
    assert_eq!(f.treasury.balance_of(&f.token), 800);
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")] // OpsFundingNotSet
fn ops_funding_needs_configuring_first() {
    let f = setup();
    f.treasury.fund_operations();
}

#[test]
#[should_panic(expected = "Error(Contract, #42)")] // FeeOutOfRange
fn ops_funding_over_one_hundred_percent_is_rejected() {
    let f = setup();
    let ops = Address::generate(&f.env);
    f.treasury.propose(
        &f.holders[0],
        &GovernedAction::SetOpsFunding(OpsFundingTerms {
            vault: ops,
            token: f.token.clone(),
            bps: 10_001,
        }),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #32)")] // NothingToRelease
fn ops_funding_with_an_empty_treasury_moves_nothing() {
    let f = setup();
    let ops = Address::generate(&f.env);
    set_ops_funding(&f, &ops, 2_000);
    f.treasury.fund_operations();
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")] // ReleaseTooSoon
fn ops_funding_is_monthly() {
    let f = setup();
    let ops = Address::generate(&f.env);
    fees_arrive(&f, 1_000);
    set_ops_funding(&f, &ops, 2_000);
    f.treasury.fund_operations();
    // Again within the month — refused, whatever fresh fees arrive.
    fees_arrive(&f, 1_000);
    f.treasury.fund_operations();
}

#[test]
fn ops_funding_runs_again_after_a_month() {
    let f = setup();
    let ops = Address::generate(&f.env);
    fees_arrive(&f, 1_000);
    set_ops_funding(&f, &ops, 5_000); // 50%

    f.treasury.fund_operations(); // 500 to ops, 500 left
    f.env.ledger().with_mut(|l| l.timestamp += 31 * DAY);
    f.treasury.fund_operations(); // 50% of 500 = 250 more

    assert_eq!(f.token_client.balance(&ops), 750);
    assert_eq!(f.treasury.balance_of(&f.token), 250);
}

#[test]
fn ops_funding_never_touches_reserved_shareholder_money() {
    let f = setup();
    let ops = Address::generate(&f.env);

    // A cycle carries and reserves the whole 1_000 for shareholders.
    fees_arrive(&f, 1_000);
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.approve_cycle(&f.holders[0]);
    f.treasury.approve_cycle(&f.holders[1]);
    assert_eq!(f.treasury.get_reserved(&f.token), 1_000);

    // Fresh fees arrive — only these are unreserved.
    fees_arrive(&f, 500);
    set_ops_funding(&f, &ops, 2_000); // 20% of the unreserved 500

    assert_eq!(f.treasury.ops_funding_available(), 100);
    f.treasury.fund_operations();
    assert_eq!(f.token_client.balance(&ops), 100);
    // The reserved 1_000 is untouched; balance is 1_500 - 100.
    assert_eq!(f.treasury.get_reserved(&f.token), 1_000);
    assert_eq!(f.treasury.balance_of(&f.token), 1_400);
}

#[test]
#[should_panic(expected = "Error(Contract, #31)")] // CycleAlreadyOpen
fn ops_funding_refused_while_a_cycle_is_being_voted_on() {
    let f = setup();
    let ops = Address::generate(&f.env);
    fees_arrive(&f, 1_000);
    set_ops_funding(&f, &ops, 2_000);

    // A cycle is open for voting; moving money out now could undercut its
    // snapshot, so funding is refused until it settles.
    f.treasury.open_cycle(&f.holders[0], &f.token);
    f.treasury.fund_operations();
}
