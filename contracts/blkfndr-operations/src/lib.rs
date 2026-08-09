#![no_std]

//! Operations Vault: where the platform's gas budget is held, and how it is spent.
//!
//! The moderation side of the platform runs on gas, not on funds. A KYC attestor
//! signs attestations from a platform-managed wallet; that wallet needs a little
//! XLM to pay fees, and nothing more. This contract is where that gas budget
//! pools, funded (in a later phase) by an automatic monthly cut of the fee
//! treasury, and spent only when the owners vote to release some of it.
//!
//! It is deliberately not the fee treasury. That contract distributes earnings to
//! shareholders by their shares; this one holds operating cash and pays it out to
//! a destination the owners name — topping up the account that funds managed
//! wallets, say. Conflating the two would mean every gas top-up competed with a
//! dividend, and a bug in one could drain the other.
//!
//! ## Why releases are votes, not a signature
//!
//! Nobody — including whoever deployed it — can move money out on their own
//! signature. A release is a proposal the owners vote on, carried by two of them
//! in three (by headcount), and then executed by anyone. So the gas budget is
//! spent the same way the platform's fees are: by agreement, on the record, with
//! no single key that empties it.
//!
//! ## Why there are no shares here
//!
//! A release goes to one destination in full, not split across owners, so there
//! is no register of basis points to keep totalling ten thousand. Owners are just
//! the voters. Adding or removing one is itself a vote — `SetOwners` — so the set
//! that decides how money moves can only be changed the same way the money is.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, Vec,
};

/// Two of three owners, by headcount, rounded up: two of three, three of four,
/// four of five. The same rule the fee treasury uses, and for the same reason —
/// it is a rule about people, not about who holds the largest stake.
const APPROVAL_NUMERATOR: u32 = 2;
const APPROVAL_DENOMINATOR: u32 = 3;

/// Seconds a vote stays open. A proposal nobody finishes voting on expires and
/// can be replaced, rather than pinning the vault forever.
const DEFAULT_VOTE_WINDOW: u64 = 7 * 24 * 60 * 60;

/// Bounds the owner set so iteration and the threshold stay cheap and predictable.
const MAX_OWNERS: u32 = 20;

const LEDGER_BUMP: u32 = 120_960; // ~7 days of ledgers
const LEDGER_LIFETIME: u32 = 17_280;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 10,
    NotInitialized = 11,

    NotAnOwner = 20,
    TooManyOwners = 21,
    DuplicateOwner = 22,
    NoOwners = 23,

    NoProposalOpen = 40,
    ProposalAlreadyOpen = 41,
    AlreadyVoted = 42,
    VotingClosed = 43,
    ThresholdNotMet = 44,
    ThresholdAlreadyMet = 45,

    InvalidAmount = 50,
    InsufficientFunds = 51,
}

/// The terms of a spend: how much of which token goes where.
#[contracttype]
#[derive(Clone)]
pub struct ReleaseTerms {
    pub token: Address,
    pub amount: i128,
    pub to: Address,
}

/// What a carried proposal does.
#[contracttype]
#[derive(Clone)]
pub enum GovernedAction {
    /// Pay operating funds out to a destination the owners name.
    Release(ReleaseTerms),
    /// Replace the owner set — the voters. The only way to add or remove one, so
    /// the body that decides how money moves is changed the same way money is.
    SetOwners(Vec<Address>),
    /// Change how long a vote stays open.
    SetVotingWindow(u64),
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u32,
    pub action: GovernedAction,
    /// The owner set as it stood when the proposal opened. A vote is decided
    /// against this snapshot, so changing the owners mid-vote cannot move the
    /// threshold or the electorate under an in-flight proposal.
    pub owners: Vec<Address>,
    pub opened_at: u64,
    pub closes_at: u64,
    pub approvals: u32,
}

#[contracttype]
pub enum DataKey {
    Owners,
    VoteWindow,
    Proposal,
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

/// Whether `approvals` owners out of `total` meets the two-thirds rule.
///
/// Multiplied rather than divided, so the rounding is exact and upward without a
/// ceiling function: 2 of 3 gives 6 >= 6 and carries, 2 of 4 gives 6 >= 8 and
/// does not. Integer division would round 2/3 of 4 down to 2 and let half the
/// owners release the money.
fn carried(approvals: u32, total: u32) -> bool {
    (approvals as u64) * (APPROVAL_DENOMINATOR as u64)
        >= (total as u64) * (APPROVAL_NUMERATOR as u64)
}

/// Validate an owner set: bounded, non-empty, no duplicates. There are no shares
/// to total, so this is only about who — not how much.
fn validate_owners(env: &Env, owners: &Vec<Address>) {
    if owners.is_empty() {
        panic_with_error!(env, Error::NoOwners);
    }
    if owners.len() > MAX_OWNERS {
        panic_with_error!(env, Error::TooManyOwners);
    }
    for i in 0..owners.len() {
        let a = owners.get(i).unwrap();
        for j in (i + 1)..owners.len() {
            if owners.get(j).unwrap() == a {
                panic_with_error!(env, Error::DuplicateOwner);
            }
        }
    }
}

fn is_owner_in(owners: &Vec<Address>, who: &Address) -> bool {
    for i in 0..owners.len() {
        if &owners.get(i).unwrap() == who {
            return true;
        }
    }
    false
}

#[contract]
pub struct Operations;

#[contractimpl]
impl Operations {
    /// Configure the vault with its owners — the voters.
    ///
    /// `deployer` must sign, for the same reason the fee treasury demands it: a
    /// vault sitting deployed and unconfigured for even one ledger could be
    /// claimed by whoever calls this first, naming themselves the only owner.
    /// Deploy and initialize are separate transactions, so that window is real.
    pub fn initialize(env: Env, deployer: Address, owners: Vec<Address>) {
        deployer.require_auth();

        if env.storage().instance().has(&DataKey::Owners) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        validate_owners(&env, &owners);

        env.storage().instance().set(&DataKey::Owners, &owners);
        env.storage()
            .instance()
            .set(&DataKey::VoteWindow, &DEFAULT_VOTE_WINDOW);
        env.storage().instance().set(&DataKey::NextProposalId, &1u32);
        bump(&env);

        env.events().publish(
            (symbol_short!("OPSVAULT"), symbol_short!("INIT")),
            owners.len(),
        );
    }

    /// Propose a governed action: a release, a change of owners, or a change of
    /// the voting window. The proposer must be an owner.
    pub fn propose(env: Env, proposer: Address, action: GovernedAction) {
        bump(&env);
        proposer.require_auth();

        // Reject a malformed action now, before a week of voting on something
        // that cannot execute.
        match &action {
            GovernedAction::Release(terms) => {
                if terms.amount <= 0 {
                    panic_with_error!(&env, Error::InvalidAmount);
                }
            }
            GovernedAction::SetOwners(next) => validate_owners(&env, next),
            GovernedAction::SetVotingWindow(_) => {}
        }

        let owners: Vec<Address> = load(&env, &DataKey::Owners);
        if !is_owner_in(&owners, &proposer) {
            panic_with_error!(&env, Error::NotAnOwner);
        }

        // One proposal at a time. A still-open, not-yet-carried proposal blocks a
        // new one; an expired or already-carried one does not, so a stalled vote
        // never wedges the vault.
        if let Some(open) = env.storage().instance().get::<_, Proposal>(&DataKey::Proposal) {
            if env.ledger().timestamp() < open.closes_at
                && !carried(open.approvals, open.owners.len())
            {
                panic_with_error!(&env, Error::ProposalAlreadyOpen);
            }
        }

        let id: u32 = load(&env, &DataKey::NextProposalId);
        let window: u64 = load(&env, &DataKey::VoteWindow);
        let now = env.ledger().timestamp();

        let proposal = Proposal {
            id,
            action,
            owners,
            opened_at: now,
            closes_at: now + window,
            approvals: 0,
        };

        env.storage().instance().set(&DataKey::Proposal, &proposal);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &(id + 1));

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("OPEN")),
            (id, proposal.closes_at),
        );
    }

    /// Approve the open proposal. One vote per owner, decided against the owner
    /// snapshot the proposal took when it opened.
    pub fn approve(env: Env, voter: Address) {
        bump(&env);
        voter.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoProposalOpen));

        if env.ledger().timestamp() >= proposal.closes_at {
            panic_with_error!(&env, Error::VotingClosed);
        }
        if carried(proposal.approvals, proposal.owners.len()) {
            panic_with_error!(&env, Error::ThresholdAlreadyMet);
        }
        if !is_owner_in(&proposal.owners, &voter) {
            panic_with_error!(&env, Error::NotAnOwner);
        }

        let key = DataKey::ProposalVote(proposal.id, voter.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyVoted);
        }
        env.storage().persistent().set(&key, &true);

        proposal.approvals += 1;
        let id = proposal.id;
        let approved = proposal.approvals;
        env.storage().instance().set(&DataKey::Proposal, &proposal);

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("APPROVE")),
            (id, voter, approved),
        );
    }

    /// Apply a carried proposal.
    ///
    /// Permissionless once the vote has carried: executing it should not depend on
    /// the goodwill of whoever proposed it. A release moves the vault's own
    /// balance, which the contract authorises for itself — no owner key signs the
    /// transfer, the carried vote is the authority.
    pub fn execute(env: Env) {
        bump(&env);

        let proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoProposalOpen));

        if !carried(proposal.approvals, proposal.owners.len()) {
            panic_with_error!(&env, Error::ThresholdNotMet);
        }

        match &proposal.action {
            GovernedAction::Release(terms) => {
                let client = token::Client::new(&env, &terms.token);
                let balance = client.balance(&env.current_contract_address());
                if balance < terms.amount {
                    panic_with_error!(&env, Error::InsufficientFunds);
                }
                client.transfer(&env.current_contract_address(), &terms.to, &terms.amount);

                env.events().publish(
                    (symbol_short!("OPSVAULT"), symbol_short!("RELEASE")),
                    (terms.token.clone(), terms.to.clone(), terms.amount),
                );
            }
            GovernedAction::SetOwners(next) => {
                // Revalidated at execution as well as at proposal: cheap, and this
                // is the one piece of state that decides who may move the money.
                validate_owners(&env, next);
                env.storage().instance().set(&DataKey::Owners, next);

                env.events().publish(
                    (symbol_short!("OWNERS"), symbol_short!("SET")),
                    next.len(),
                );
            }
            GovernedAction::SetVotingWindow(secs) => {
                env.storage().instance().set(&DataKey::VoteWindow, secs);

                env.events().publish(
                    (symbol_short!("OPSVAULT"), symbol_short!("WINDOW")),
                    *secs,
                );
            }
        }

        env.storage().instance().remove(&DataKey::Proposal);

        env.events().publish(
            (symbol_short!("PROPOSAL"), symbol_short!("APPLIED")),
            proposal.id,
        );
    }

    // ── Reads ──────────────────────────────────────────────────────────────

    pub fn get_owners(env: Env) -> Vec<Address> {
        load(&env, &DataKey::Owners)
    }

    pub fn is_owner(env: Env, who: Address) -> bool {
        let owners: Vec<Address> = load(&env, &DataKey::Owners);
        is_owner_in(&owners, &who)
    }

    pub fn get_proposal(env: Env) -> Option<Proposal> {
        env.storage().instance().get(&DataKey::Proposal)
    }

    pub fn vote_window(env: Env) -> u64 {
        load(&env, &DataKey::VoteWindow)
    }

    pub fn balance_of(env: Env, token: Address) -> i128 {
        token::Client::new(&env, &token).balance(&env.current_contract_address())
    }
}

mod test;
