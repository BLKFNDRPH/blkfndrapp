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
    ops: OperationsClient<'static>,
    token: Address,
    token_admin: StellarAssetClient<'static>,
    token_client: TokenClient<'static>,
    owners: [Address; 3],
}

/// Three owners. Two-to-one by headcount means a single owner is never enough —
/// any release needs at least two of the three to agree.
fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer.clone());
    let token = sac.address();

    let owners = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let deployer = Address::generate(&env);

    let ops_id = env.register(
        Operations,
        (
            deployer.clone(),
            vec![&env, owners[0].clone(), owners[1].clone(), owners[2].clone()],
        ),
    );
    let ops = OperationsClient::new(&env, &ops_id);

    Fixture {
        token_admin: StellarAssetClient::new(&env, &token),
        token_client: TokenClient::new(&env, &token),
        env,
        ops,
        token,
        owners,
    }
}

/// Simulate the monthly cut arriving from the fee treasury: a transfer lands here.
fn fund(f: &Fixture, amount: i128) {
    f.token_admin.mint(&f.ops.address, &amount);
}

fn release(f: &Fixture, to: &Address, amount: i128) -> GovernedAction {
    GovernedAction::Release(ReleaseTerms {
        token: f.token.clone(),
        amount,
        to: to.clone(),
    })
}

#[test]
fn funds_accumulate_until_released() {
    let f = setup();
    fund(&f, 1_000);
    assert_eq!(f.ops.balance_of(&f.token), 1_000);
    assert!(f.ops.get_proposal().is_none());
}

#[test]
fn owners_are_recorded() {
    let f = setup();
    assert_eq!(f.ops.get_owners().len(), 3);
    assert!(f.ops.is_owner(&f.owners[0]));
    assert!(!f.ops.is_owner(&Address::generate(&f.env)));
}

// A constructor cannot be invoked twice — the vault is configured inside the
// deploy transaction and exposes no initialize entrypoint afterward — so the old
// "cannot_initialize_twice" case is now guaranteed by construction, and its
// validation happens at register (deploy) time.

#[test]
#[should_panic(expected = "Error(Contract, #22)")] // DuplicateOwner
fn duplicate_owner_rejected_at_construction() {
    let env = Env::default();
    env.mock_all_auths();
    let a = Address::generate(&env);
    env.register(
        Operations,
        (Address::generate(&env), vec![&env, a.clone(), a.clone()]),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")] // NoOwners
fn empty_owner_set_rejected_at_construction() {
    let env = Env::default();
    env.mock_all_auths();
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    env.register(Operations, (Address::generate(&env), empty));
}

#[test]
fn two_of_three_carries_and_releases() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);

    f.ops.propose(&f.owners[0], &release(&f, &dest, 400));
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);
    f.ops.execute();

    assert_eq!(f.token_client.balance(&dest), 400);
    assert_eq!(f.ops.balance_of(&f.token), 600);
    // The proposal is consumed once applied.
    assert!(f.ops.get_proposal().is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #44)")] // ThresholdNotMet
fn a_single_owner_cannot_release_alone() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);

    f.ops.propose(&f.owners[0], &release(&f, &dest, 400));
    f.ops.approve(&f.owners[0]);
    // One of three does not carry; executing must refuse.
    f.ops.execute();
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // NotAnOwner
fn a_stranger_cannot_propose() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&Address::generate(&f.env), &release(&f, &dest, 100));
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // NotAnOwner
fn a_stranger_cannot_approve() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 100));
    f.ops.approve(&Address::generate(&f.env));
}

#[test]
#[should_panic(expected = "Error(Contract, #42)")] // AlreadyVoted
fn an_owner_cannot_vote_twice() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 100));
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[0]);
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")] // VotingClosed
fn cannot_approve_after_the_window() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 100));
    f.env.ledger().with_mut(|l| l.timestamp += 8 * DAY);
    f.ops.approve(&f.owners[0]);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")] // ProposalAlreadyOpen
fn one_proposal_at_a_time() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 100));
    f.ops.propose(&f.owners[1], &release(&f, &dest, 200));
}

#[test]
fn an_expired_proposal_can_be_replaced() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 100));
    // Let it lapse, then a fresh one takes its place.
    f.env.ledger().with_mut(|l| l.timestamp += 8 * DAY);
    f.ops.propose(&f.owners[1], &release(&f, &dest, 250));

    let p = f.ops.get_proposal().unwrap();
    assert_eq!(p.approvals, 0);
    assert_eq!(p.id, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #50)")] // InvalidAmount
fn a_zero_release_is_rejected() {
    let f = setup();
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 0));
}

#[test]
#[should_panic(expected = "Error(Contract, #51)")] // InsufficientFunds
fn cannot_release_more_than_the_balance() {
    let f = setup();
    fund(&f, 100);
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 500));
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);
    f.ops.execute();
}

#[test]
fn owners_can_be_changed_by_vote() {
    let f = setup();
    let newcomer = Address::generate(&f.env);

    // Replace the three owners with a set that swaps owner[2] for a newcomer.
    let next = vec![
        &f.env,
        f.owners[0].clone(),
        f.owners[1].clone(),
        newcomer.clone(),
    ];
    f.ops.propose(&f.owners[0], &GovernedAction::SetOwners(next));
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);
    f.ops.execute();

    assert!(f.ops.is_owner(&newcomer));
    assert!(!f.ops.is_owner(&f.owners[2]));

    // The newcomer can now vote; the removed owner cannot.
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&newcomer, &release(&f, &dest, 100));
    f.ops.approve(&newcomer);
    f.ops.approve(&f.owners[0]);
    f.ops.execute();
    assert_eq!(f.token_client.balance(&dest), 100);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // NotAnOwner
fn a_removed_owner_can_no_longer_vote() {
    let f = setup();
    let next = vec![&f.env, f.owners[0].clone(), f.owners[1].clone()];
    f.ops.propose(&f.owners[0], &GovernedAction::SetOwners(next));
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);
    f.ops.execute();

    // owners[2] is gone. Any vote from them is refused.
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 100));
    f.ops.approve(&f.owners[2]);
}

#[test]
fn the_voting_window_can_be_changed_by_vote() {
    let f = setup();
    assert_eq!(f.ops.vote_window(), 7 * DAY);

    f.ops
        .propose(&f.owners[0], &GovernedAction::SetVotingWindow(3 * DAY));
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);
    f.ops.execute();

    assert_eq!(f.ops.vote_window(), 3 * DAY);
}

#[test]
fn execution_is_permissionless() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);

    f.ops.propose(&f.owners[0], &release(&f, &dest, 400));
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);
    // No owner gate on execute: the carried vote is the authority, so anyone can
    // push the button. (mock_all_auths is on, so this only proves no owner check
    // in the contract path — which is the point.)
    f.ops.execute();
    assert_eq!(f.token_client.balance(&dest), 400);
}

/// Four owners: two-thirds by headcount needs three, not two. This is the case
/// integer division would get wrong — 2/3 of 4 truncates to 2 — so it is worth a
/// test of its own.
#[test]
fn two_of_four_does_not_carry_but_three_does() {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = sac.address();
    let token_admin = StellarAssetClient::new(&env, &token);
    let token_client = TokenClient::new(&env, &token);

    let owners = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let ops = OperationsClient::new(
        &env,
        &env.register(
            Operations,
            (
                Address::generate(&env),
                vec![
                    &env,
                    owners[0].clone(),
                    owners[1].clone(),
                    owners[2].clone(),
                    owners[3].clone(),
                ],
            ),
        ),
    );
    token_admin.mint(&ops.address, &1_000);
    let dest = Address::generate(&env);

    ops.propose(
        &owners[0],
        &GovernedAction::Release(ReleaseTerms {
            token: token.clone(),
            amount: 400,
            to: dest.clone(),
        }),
    );
    ops.approve(&owners[0]);
    ops.approve(&owners[1]);

    // Two of four is not enough: the proposal has not carried.
    assert!(ops.get_proposal().unwrap().approvals == 2);
    let three = ops.try_execute();
    assert!(three.is_err()); // ThresholdNotMet

    ops.approve(&owners[2]);
    ops.execute();
    assert_eq!(token_client.balance(&dest), 400);
}

#[test]
#[should_panic(expected = "Error(Contract, #40)")] // NoProposalOpen
fn nothing_to_execute_without_a_proposal() {
    let f = setup();
    f.ops.execute();
}

#[test]
#[should_panic(expected = "Error(Contract, #45)")] // ThresholdAlreadyMet
fn cannot_keep_voting_after_it_carries() {
    let f = setup();
    fund(&f, 1_000);
    let dest = Address::generate(&f.env);
    f.ops.propose(&f.owners[0], &release(&f, &dest, 100));
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);
    // Already carried; a third vote has nothing to add and is refused.
    f.ops.approve(&f.owners[2]);
}

// ── Batch releases (the monthly gas top-up) ─────────────────────────────────

#[test]
fn a_batch_funds_every_destination_in_one_vote() {
    let f = setup();
    fund(&f, 1_000);
    let a = Address::generate(&f.env);
    let b = Address::generate(&f.env);

    let batch = GovernedAction::ReleaseMany(vec![
        &f.env,
        ReleaseTerms { token: f.token.clone(), amount: 300, to: a.clone() },
        ReleaseTerms { token: f.token.clone(), amount: 200, to: b.clone() },
    ]);
    f.ops.propose(&f.owners[0], &batch);
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);
    f.ops.execute();

    assert_eq!(f.token_client.balance(&a), 300);
    assert_eq!(f.token_client.balance(&b), 200);
    assert_eq!(f.ops.balance_of(&f.token), 500);
    assert!(f.ops.get_proposal().is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #52)")] // InvalidBatch
fn an_empty_batch_is_rejected() {
    let f = setup();
    let empty: Vec<ReleaseTerms> = vec![&f.env];
    f.ops.propose(&f.owners[0], &GovernedAction::ReleaseMany(empty));
}

#[test]
#[should_panic(expected = "Error(Contract, #50)")] // InvalidAmount
fn a_batch_with_a_zero_entry_is_rejected() {
    let f = setup();
    let dest = Address::generate(&f.env);
    let batch = GovernedAction::ReleaseMany(vec![
        &f.env,
        ReleaseTerms { token: f.token.clone(), amount: 100, to: dest.clone() },
        ReleaseTerms { token: f.token.clone(), amount: 0, to: dest.clone() },
    ]);
    f.ops.propose(&f.owners[0], &batch);
}

#[test]
fn a_batch_beyond_the_balance_pays_no_one() {
    let f = setup();
    fund(&f, 400);
    let a = Address::generate(&f.env);
    let b = Address::generate(&f.env);

    // 300 + 300 = 600 > 400: the second transfer cannot be covered, so the whole
    // execution reverts and the first is rolled back too.
    let batch = GovernedAction::ReleaseMany(vec![
        &f.env,
        ReleaseTerms { token: f.token.clone(), amount: 300, to: a.clone() },
        ReleaseTerms { token: f.token.clone(), amount: 300, to: b.clone() },
    ]);
    f.ops.propose(&f.owners[0], &batch);
    f.ops.approve(&f.owners[0]);
    f.ops.approve(&f.owners[1]);

    assert!(f.ops.try_execute().is_err()); // InsufficientFunds
    assert_eq!(f.token_client.balance(&a), 0);
    assert_eq!(f.token_client.balance(&b), 0);
    assert_eq!(f.ops.balance_of(&f.token), 400);
}
