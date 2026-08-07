#![no_std]

//! Platform treasury: where listing fees pool, and how they are released.
//!
//! Listing fees used to go straight to one wallet at project creation. This
//! contract becomes that wallet, so fees accumulate here instead, and are paid
//! out to shareholders only when the shareholders themselves vote to close a
//! cycle. Nobody — including whoever deployed it — can move money out on their
//! own signature.
//!
//! Nothing in blkfndr-vault or blkfndr-factory changed to make this work. The
//! factory's `update_fee_wallet` takes an `Address`, and on Soroban an address
//! is a contract as readily as an account, so pointing fees here is one call.
//!
//! ## Shareholders are their own list
//!
//! Not the admin roster. Shares are explicit basis points that must total
//! exactly 10 000, and adding an operational admin — someone who reviews KYC —
//! must never silently dilute anyone's earnings. Who runs the platform and who
//! owns a share of it are different questions, and conflating them means every
//! hiring decision is also a financial one.
//!
//! ## Why cycles snapshot
//!
//! A cycle records the payable amount and every shareholder's share at the
//! moment it opens. Without that, changing the register mid-vote would rewrite
//! who earned what after the earning happened: someone could be diluted for
//! work already done, or write themselves in just before a release. The
//! snapshot means a cycle pays out exactly what the register said when it
//! started, whatever happens to the register afterwards.
//!
//! ## Why claims are pulled, not pushed
//!
//! A release marks a cycle payable; each shareholder then claims. Paying
//! everyone in one transaction would let a single recipient that cannot receive
//! the token — a contract that panics, a missing trustline — revert the whole
//! distribution and strand everyone else's money behind their problem.
//!
//! ## One token per cycle
//!
//! The fee is charged in each project's own token, so this contract can hold
//! several at once. A cycle names its token and settles only that balance,
//! because splitting "the total value" across tokens would need a price oracle,
//! and an oracle in the path that moves money is exactly what this platform is
//! built to avoid.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, IntoVal, Symbol, Vec,
};

const BPS_TOTAL: i128 = 10_000;

/// More than half the shares, mirroring the release threshold in the project
/// vault. Deliberately not a headcount: this is the shareholders' own money,
/// and someone holding two thirds of it should not be outvoted on its timing by
/// two holders of five per cent.
const APPROVAL_THRESHOLD_BPS: i128 = 5_000;

/// Seconds a vote stays open. A cycle that nobody finishes voting on expires
/// and can be reopened, rather than pinning the balance forever.
const DEFAULT_VOTE_WINDOW: u64 = 7 * 24 * 60 * 60;

/// Bounds the register so iteration stays cheap and predictable.
const MAX_SHAREHOLDERS: u32 = 20;

const LEDGER_BUMP: u32 = 120_960; // ~7 days of ledgers
const LEDGER_LIFETIME: u32 = 17_280;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized       = 1,
    AlreadyInitialized  = 10,
    NotInitialized      = 11,

    NotAShareholder     = 20,
    SharesMustTotalBps  = 21,
    TooManyShareholders = 22,
    DuplicateShareholder = 23,
    ZeroShare           = 24,

    NoCycleOpen         = 30,
    CycleAlreadyOpen    = 31,
    NothingToRelease    = 32,
    AlreadyVoted        = 33,
    VotingClosed        = 34,
    ThresholdNotMet     = 35,
    ThresholdAlreadyMet = 36,
    NotPayable          = 37,
    AlreadyClaimed      = 38,

    NoProposalOpen      = 40,
    ProposalAlreadyOpen = 41,
    FeeOutOfRange       = 42,
}

#[contracttype]
#[derive(Clone)]
pub struct Shareholder {
    pub address: Address,
    /// Basis points of every release. All shares must total exactly 10 000.
    pub share_bps: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CycleState {
    /// Open for voting.
    Voting = 0,
    /// Threshold carried; shareholders may claim.
    Payable = 1,
    /// The window closed short. Nothing is paid; the balance rolls into the
    /// next cycle rather than being stranded.
    Lapsed = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct Cycle {
    pub id: u32,
    pub token: Address,
    /// The contract's balance of `token` when the cycle opened. Fees arriving
    /// afterwards belong to the next cycle, so a vote settles a fixed sum
    /// rather than a moving one.
    pub amount: i128,
    /// The register as it stood at open. A cycle pays what was agreed when it
    /// started, whatever the register does later.
    pub roster: Vec<Shareholder>,
    pub opened_at: u64,
    pub closes_at: u64,
    pub approved_bps: i128,
    pub state: CycleState,
}

/// What a carried proposal does to the factory.
///
/// An enum rather than a fee-only entrypoint, because this contract can be the
/// factory's admin and the factory has eight admin-gated functions. Reaching
/// only one of them would strand the other seven — including `update_wasm_hash`,
/// which is how vaults are upgraded, and `transfer_admin`, which is the only
/// way to hand control back. A treasury that can take factory admin but never
/// return it is a trap, so `TransferAdmin` is here from the start.
#[contracttype]
#[derive(Clone)]
pub enum FactoryAction {
    /// Change the flat listing fee, in stroops.
    SetFee(i128),
    /// Hand factory admin to someone else — the escape hatch. A vote can always
    /// return control to a human, so pointing factory admin at this contract is
    /// reversible rather than permanent.
    TransferAdmin(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct FactoryProposal {
    pub id: u32,
    pub action: FactoryAction,
    pub roster: Vec<Shareholder>,
    pub opened_at: u64,
    pub closes_at: u64,
    pub approved_bps: i128,
}

#[contracttype]
pub enum DataKey {
    Factory,
    Shareholders,
    VoteWindow,
    NextCycleId,
    Cycle,
    /// (cycle_id, voter) -> voted
    CycleVote(u32, Address),
    /// (cycle_id, shareholder) -> claimed
    Claimed(u32, Address),
    FactoryProposal,
    NextProposalId,
    /// (proposal_id, voter) -> voted
    ProposalVote(u32, Address),
}

fn bump(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_LIFETIME, LEDGER_BUMP);
}

fn load<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey) -> T {
    env.storage()
        .instance()
        .get(key)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

/// Validate a register: bounded, no duplicates, no zero shares, totalling
/// exactly 10 000. Rejecting a register that does not total the whole means a
/// release can never leave an unallocated remainder nobody can claim.
fn validate_roster(env: &Env, roster: &Vec<Shareholder>) {
    if roster.is_empty() || roster.len() > MAX_SHAREHOLDERS {
        panic_with_error!(env, Error::TooManyShareholders);
    }

    let mut total: i128 = 0;
    for i in 0..roster.len() {
        let entry = roster.get(i).unwrap();
        if entry.share_bps == 0 {
            panic_with_error!(env, Error::ZeroShare);
        }
        for j in (i + 1)..roster.len() {
            if roster.get(j).unwrap().address == entry.address {
                panic_with_error!(env, Error::DuplicateShareholder);
            }
        }
        total += entry.share_bps as i128;
    }

    if total != BPS_TOTAL {
        panic_with_error!(env, Error::SharesMustTotalBps);
    }
}

fn share_of(roster: &Vec<Shareholder>, who: &Address) -> Option<u32> {
    for i in 0..roster.len() {
        let entry = roster.get(i).unwrap();
        if &entry.address == who {
            return Some(entry.share_bps);
        }
    }
    None
}

fn carried(approved_bps: i128) -> bool {
    approved_bps * BPS_TOTAL > BPS_TOTAL * APPROVAL_THRESHOLD_BPS
}

#[contract]
pub struct Treasury;

#[contractimpl]
impl Treasury {
    /// Configure the treasury. `factory` is the contract whose fee this
    /// treasury may change; it must set this contract as its admin for that to
    /// work, which is a separate deliberate act.
    pub fn initialize(env: Env, factory: Address, shareholders: Vec<Shareholder>) {
        if env.storage().instance().has(&DataKey::Shareholders) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        validate_roster(&env, &shareholders);

        env.storage().instance().set(&DataKey::Factory, &factory);
        env.storage()
            .instance()
            .set(&DataKey::Shareholders, &shareholders);
        env.storage()
            .instance()
            .set(&DataKey::VoteWindow, &DEFAULT_VOTE_WINDOW);
        env.storage().instance().set(&DataKey::NextCycleId, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &1u32);
        bump(&env);

        env.events().publish(
            (symbol_short!("TREASURY"), symbol_short!("INIT")),
            (factory, shareholders.len()),
        );
    }

    // ── Cycles ─────────────────────────────────────────────────────────────

    /// Open a cycle over the treasury's current balance of `token`.
    ///
    /// Any shareholder may open one. There is no privileged proposer, because a
    /// proposer who could refuse to act would be able to withhold everyone
    /// else's earnings indefinitely.
    pub fn open_cycle(env: Env, opener: Address, token: Address) {
        bump(&env);
        opener.require_auth();

        let roster: Vec<Shareholder> = load(&env, &DataKey::Shareholders);
        if share_of(&roster, &opener).is_none() {
            panic_with_error!(&env, Error::NotAShareholder);
        }

        if let Some(existing) = env.storage().instance().get::<_, Cycle>(&DataKey::Cycle) {
            // A lapsed or fully-settled cycle may be replaced; a live one may not.
            if existing.state == CycleState::Voting
                && env.ledger().timestamp() < existing.closes_at
            {
                panic_with_error!(&env, Error::CycleAlreadyOpen);
            }
            if existing.state == CycleState::Payable {
                panic_with_error!(&env, Error::CycleAlreadyOpen);
            }
        }

        let balance = token::Client::new(&env, &token).balance(&env.current_contract_address());
        if balance <= 0 {
            panic_with_error!(&env, Error::NothingToRelease);
        }

        let id: u32 = load(&env, &DataKey::NextCycleId);
        let window: u64 = load(&env, &DataKey::VoteWindow);
        let now = env.ledger().timestamp();

        let cycle = Cycle {
            id,
            token: token.clone(),
            amount: balance,
            roster,
            opened_at: now,
            closes_at: now + window,
            approved_bps: 0,
            state: CycleState::Voting,
        };

        env.storage().instance().set(&DataKey::Cycle, &cycle);
        env.storage().instance().set(&DataKey::NextCycleId, &(id + 1));

        env.events().publish(
            (symbol_short!("CYCLE"), symbol_short!("OPEN")),
            (id, token, balance, cycle.closes_at),
        );
    }

    /// Approve the open cycle. One vote per shareholder, weighted by share.
    pub fn approve_cycle(env: Env, voter: Address) {
        bump(&env);
        voter.require_auth();

        let mut cycle: Cycle = env
            .storage()
            .instance()
            .get(&DataKey::Cycle)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoCycleOpen));

        if cycle.state != CycleState::Voting {
            panic_with_error!(&env, Error::VotingClosed);
        }
        if env.ledger().timestamp() >= cycle.closes_at {
            panic_with_error!(&env, Error::VotingClosed);
        }

        // Against the snapshot, not the live register: a cycle pays what was
        // agreed when it opened.
        let share = share_of(&cycle.roster, &voter)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotAShareholder));

        let key = DataKey::CycleVote(cycle.id, voter.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyVoted);
        }
        env.storage().persistent().set(&key, &true);

        cycle.approved_bps += share as i128;
        let reached = carried(cycle.approved_bps);
        if reached {
            cycle.state = CycleState::Payable;
        }

        let id = cycle.id;
        let approved = cycle.approved_bps;
        env.storage().instance().set(&DataKey::Cycle, &cycle);

        env.events().publish(
            (symbol_short!("CYCLE"), symbol_short!("APPROVE")),
            (id, voter, share, approved),
        );
        if reached {
            env.events()
                .publish((symbol_short!("CYCLE"), symbol_short!("PAYABLE")), (id, approved));
        }
    }

    /// Mark a cycle that closed below threshold as lapsed.
    ///
    /// Permissionless, and it pays nobody. The balance simply stays here and is
    /// picked up by the next cycle, so an unfinished vote delays a payout
    /// rather than destroying it.
    pub fn settle_lapsed_cycle(env: Env) {
        bump(&env);

        let mut cycle: Cycle = env
            .storage()
            .instance()
            .get(&DataKey::Cycle)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoCycleOpen));

        if cycle.state != CycleState::Voting {
            panic_with_error!(&env, Error::VotingClosed);
        }
        if env.ledger().timestamp() < cycle.closes_at {
            panic_with_error!(&env, Error::VotingClosed);
        }
        if carried(cycle.approved_bps) {
            panic_with_error!(&env, Error::ThresholdAlreadyMet);
        }

        cycle.state = CycleState::Lapsed;
        let id = cycle.id;
        env.storage().instance().set(&DataKey::Cycle, &cycle);

        env.events()
            .publish((symbol_short!("CYCLE"), symbol_short!("LAPSED")), id);
    }

    /// Claim your share of a payable cycle.
    ///
    /// Pulled rather than pushed, so one recipient that cannot receive the
    /// token cannot strand everyone else's money behind their problem.
    pub fn claim(env: Env, shareholder: Address) {
        bump(&env);
        shareholder.require_auth();

        let cycle: Cycle = env
            .storage()
            .instance()
            .get(&DataKey::Cycle)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoCycleOpen));

        if cycle.state != CycleState::Payable {
            panic_with_error!(&env, Error::NotPayable);
        }

        let share = share_of(&cycle.roster, &shareholder)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotAShareholder));

        let key = DataKey::Claimed(cycle.id, shareholder.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }
        env.storage().persistent().set(&key, &true);

        // Integer division truncates, so the shares can sum to slightly less
        // than the total. The remainder stays in the contract and is swept into
        // the next cycle rather than being written off.
        let payout = cycle
            .amount
            .checked_mul(share as i128)
            .unwrap()
            .checked_div(BPS_TOTAL)
            .unwrap();

        if payout > 0 {
            token::Client::new(&env, &cycle.token).transfer(
                &env.current_contract_address(),
                &shareholder,
                &payout,
            );
        }

        env.events().publish(
            (symbol_short!("CYCLE"), symbol_short!("CLAIM")),
            (cycle.id, shareholder, payout),
        );
    }

    // ── Fee governance ─────────────────────────────────────────────────────

    /// Propose an action on the factory.
    ///
    /// The fee stays a flat amount. SOW v4 states a flat-fee model three times
    /// and frames it as a Philippine SEC/BSP constraint — "BLKFNDR charges flat
    /// fees, never takes a percentage of funds" — so what a vote adjusts is the
    /// amount, not the shape.
    pub fn propose(env: Env, proposer: Address, action: FactoryAction) {
        bump(&env);
        proposer.require_auth();

        if let FactoryAction::SetFee(fee) = &action {
            if *fee < 0 {
                panic_with_error!(&env, Error::FeeOutOfRange);
            }
        }

        let roster: Vec<Shareholder> = load(&env, &DataKey::Shareholders);
        if share_of(&roster, &proposer).is_none() {
            panic_with_error!(&env, Error::NotAShareholder);
        }

        if let Some(open) = env
            .storage()
            .instance()
            .get::<_, FactoryProposal>(&DataKey::FactoryProposal)
        {
            if env.ledger().timestamp() < open.closes_at && !carried(open.approved_bps) {
                panic_with_error!(&env, Error::ProposalAlreadyOpen);
            }
        }

        let id: u32 = load(&env, &DataKey::NextProposalId);
        let window: u64 = load(&env, &DataKey::VoteWindow);
        let now = env.ledger().timestamp();

        let proposal = FactoryProposal {
            id,
            action,
            roster,
            opened_at: now,
            closes_at: now + window,
            approved_bps: 0,
        };

        env.storage()
            .instance()
            .set(&DataKey::FactoryProposal, &proposal);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &(id + 1));

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("OPEN")),
            (id, proposal.closes_at),
        );
    }

    pub fn approve_proposal(env: Env, voter: Address) {
        bump(&env);
        voter.require_auth();

        let mut proposal: FactoryProposal = env
            .storage()
            .instance()
            .get(&DataKey::FactoryProposal)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoProposalOpen));

        if env.ledger().timestamp() >= proposal.closes_at {
            panic_with_error!(&env, Error::VotingClosed);
        }
        if carried(proposal.approved_bps) {
            panic_with_error!(&env, Error::ThresholdAlreadyMet);
        }

        let share = share_of(&proposal.roster, &voter)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotAShareholder));

        let key = DataKey::ProposalVote(proposal.id, voter.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyVoted);
        }
        env.storage().persistent().set(&key, &true);

        proposal.approved_bps += share as i128;
        let id = proposal.id;
        let approved = proposal.approved_bps;
        env.storage()
            .instance()
            .set(&DataKey::FactoryProposal, &proposal);

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("APPROVE")),
            (id, voter, share, approved),
        );
    }

    /// Apply a carried proposal to the factory.
    ///
    /// Permissionless once the vote has carried: execution should not depend on
    /// the goodwill of whoever proposed it. This contract must be the factory's
    /// admin for the call to authorise.
    pub fn execute_proposal(env: Env) {
        bump(&env);

        let proposal: FactoryProposal = env
            .storage()
            .instance()
            .get(&DataKey::FactoryProposal)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoProposalOpen));

        if !carried(proposal.approved_bps) {
            panic_with_error!(&env, Error::ThresholdNotMet);
        }

        let factory: Address = load(&env, &DataKey::Factory);

        // Symbol::new, not symbol_short!: the latter caps at nine characters and
        // these names are longer.
        match &proposal.action {
            FactoryAction::SetFee(fee) => {
                env.invoke_contract::<()>(
                    &factory,
                    &Symbol::new(&env, "update_platform_fee"),
                    soroban_sdk::vec![&env, fee.into_val(&env)],
                );
            }
            FactoryAction::TransferAdmin(new_admin) => {
                env.invoke_contract::<()>(
                    &factory,
                    &Symbol::new(&env, "transfer_admin"),
                    soroban_sdk::vec![&env, new_admin.into_val(&env)],
                );
            }
        }

        env.storage().instance().remove(&DataKey::FactoryProposal);

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("APPLIED")),
            proposal.id,
        );
    }

    // ── Register ───────────────────────────────────────────────────────────

    /// Replace the shareholder register.
    ///
    /// Requires a carried cycle vote to have settled first — the register may
    /// not change while a cycle is being voted on, because a cycle in flight
    /// has already snapshotted who is owed what and changing the live register
    /// mid-vote is how someone gets diluted after the earning.
    pub fn set_shareholders(env: Env, caller: Address, shareholders: Vec<Shareholder>) {
        bump(&env);
        caller.require_auth();

        let current: Vec<Shareholder> = load(&env, &DataKey::Shareholders);
        if share_of(&current, &caller).is_none() {
            panic_with_error!(&env, Error::NotAShareholder);
        }

        if let Some(cycle) = env.storage().instance().get::<_, Cycle>(&DataKey::Cycle) {
            if cycle.state == CycleState::Voting || cycle.state == CycleState::Payable {
                panic_with_error!(&env, Error::CycleAlreadyOpen);
            }
        }

        validate_roster(&env, &shareholders);
        env.storage()
            .instance()
            .set(&DataKey::Shareholders, &shareholders);

        env.events().publish(
            (symbol_short!("SHARES"), symbol_short!("SET")),
            (caller, shareholders.len()),
        );
    }

    // ── Reads ──────────────────────────────────────────────────────────────

    pub fn get_shareholders(env: Env) -> Vec<Shareholder> {
        load(&env, &DataKey::Shareholders)
    }

    pub fn get_cycle(env: Env) -> Option<Cycle> {
        env.storage().instance().get(&DataKey::Cycle)
    }

    pub fn get_proposal(env: Env) -> Option<FactoryProposal> {
        env.storage().instance().get(&DataKey::FactoryProposal)
    }

    pub fn get_factory(env: Env) -> Address {
        load(&env, &DataKey::Factory)
    }

    pub fn has_claimed(env: Env, cycle_id: u32, shareholder: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Claimed(cycle_id, shareholder))
    }

    pub fn balance_of(env: Env, token: Address) -> i128 {
        token::Client::new(&env, &token).balance(&env.current_contract_address())
    }
}

mod test;
