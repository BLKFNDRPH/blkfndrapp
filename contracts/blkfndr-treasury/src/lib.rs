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
    Address, BytesN, Env, IntoVal, Symbol, Vec,
};

const BPS_TOTAL: i128 = 10_000;

/// Two thirds of the owners, by headcount, rounded up: two of three, three of
/// four, four of five.
///
/// Headcount rather than share weight, which is the reverse of how this started.
/// Weighting by share made a majority holder's agreement necessary for anything
/// to move — and once owners hold equal shares, a share-weighted threshold and a
/// headcount threshold say the same thing right up until someone's share is
/// adjusted, at which point the weighted rule quietly hands one person a veto.
/// The owners asked for two-to-one, which is a rule about people.
const APPROVAL_NUMERATOR: u32 = 2;
const APPROVAL_DENOMINATOR: u32 = 3;

/// Seconds a vote stays open. A cycle that nobody finishes voting on expires
/// and can be reopened, rather than pinning the balance forever.
const DEFAULT_VOTE_WINDOW: u64 = 7 * 24 * 60 * 60;

/// Shortest gap between two successful releases.
///
/// Thirty days rather than a calendar month, because a calendar month is not a
/// fixed quantity and the ledger has no calendar: "monthly" would otherwise mean
/// 28 days in February and 31 in March, and the difference would have to be
/// reimplemented identically everywhere it was checked.
///
/// Measured from the last release that actually carried, not from the last
/// attempt. A vote that lapses costs nobody a month.
const MIN_RELEASE_INTERVAL: u64 = 30 * 24 * 60 * 60;

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
    ReleaseTooSoon      = 39,

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
    /// How many owners have approved. The rule is two-to-one by headcount, so
    /// this is the number that decides, not the share weight beside it.
    pub approvals: u32,
    pub state: CycleState,
}

/// What a carried proposal does.
///
/// An enum rather than a fee-only entrypoint, because this contract can be the
/// factory's admin and the factory has eight admin-gated functions. Reaching
/// only one of them would strand the other seven — including `update_wasm_hash`,
/// which is how vaults are upgraded, and `transfer_admin`, which is the only
/// way to hand control back. A treasury that can take factory admin but never
/// return it is a trap, so `TransferAdmin` is here from the start.
#[contracttype]
#[derive(Clone)]
pub enum GovernedAction {
    /// Change the flat listing fee, in stroops.
    SetFee(i128),
    /// Hand factory admin to someone else — the escape hatch. A vote can always
    /// return control to a human, so pointing factory admin at this contract is
    /// reversible rather than permanent.
    TransferAdmin(Address),
    /// Replace the shareholder register.
    ///
    /// This is here, behind a vote, because the alternative was catastrophic.
    /// `set_shareholders` used to need one shareholder's signature and no vote,
    /// which made the register the drain: the *smallest* holder could rewrite it
    /// to name themselves at 100%, open a cycle, carry it alone, and claim the
    /// lot. Three transactions, one key, and the other partners get nothing.
    ///
    /// Everything else in this contract was carefully vote-gated, so the register
    /// being a single-signature write meant the whole design could be bypassed by
    /// changing who "everyone" is before asking them.
    SetShareholders(Vec<Shareholder>),
    /// Change the performance bond, in basis points of the raise.
    ///
    /// The bond is what a builder forfeits by missing a milestone, so it is the
    /// number that decides how much a promise costs to break. Raising it makes
    /// listing more expensive and failure more painful; lowering it does the
    /// reverse. Either direction is a policy change, which is why it is here
    /// rather than on one admin's signature.
    SetBondBps(u64),
    /// Point new vaults at a different wasm — how the vault contract is upgraded.
    ///
    /// The most powerful action in this enum by some distance: it decides the
    /// code every future vault runs. Existing vaults keep the code they were
    /// deployed with, so this is not a retroactive rewrite, but a vote here
    /// chooses what every builder after it is trusting.
    SetWasmHash(BytesN<32>),
    /// Send listing fees somewhere else — including to a replacement treasury.
    ///
    /// Necessary rather than optional. Once this contract is the factory's admin
    /// it is the only thing that can repoint fees, so without this a treasury
    /// that needed replacing could never hand over its own income.
    SetFeeWallet(Address),
    /// Change which registry vouches for builder identity.
    SetIdentityRegistry(Address),
    /// Change how long contributors have to vote on a milestone.
    SetVotingWindow(u64),
    /// Change the smallest contribution a vault will accept.
    SetMinContribution(i128),
    /// Replace the owners, splitting the treasury equally between them.
    ///
    /// The ordinary way to add or remove an owner. Owners hold equal shares by
    /// default, so naming the people is enough and nobody has to compute basis
    /// points that must land on exactly 10 000. SetShareholders above remains
    /// for the deliberate exception — an unequal split the owners have voted for.
    ///
    /// Adding an owner dilutes the existing ones, which is the intended meaning:
    /// owners own the platform, so admitting one is a financial decision. Staff
    /// who need console access without a share are a separate role entirely and
    /// never appear here.
    SetOwners(Vec<Address>),
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u32,
    pub action: GovernedAction,
    pub roster: Vec<Shareholder>,
    pub opened_at: u64,
    pub closes_at: u64,
    pub approvals: u32,
}

#[contracttype]
pub enum DataKey {
    Factory,
    Shareholders,
    VoteWindow,
    NextCycleId,
    /// cycle_id -> Cycle. Keyed, not a single slot: a payable cycle that some
    /// shareholder has not got round to claiming must not block the next one.
    Cycle(u32),
    /// The cycle currently being voted on, if any. Cleared the moment voting
    /// ends, whichever way it went.
    OpenCycleId,
    /// token -> the sum still owed to shareholders of payable cycles. A new
    /// cycle may only take the balance *above* this, so nobody's unclaimed
    /// share can be swept into a later cycle and paid to somebody else.
    Reserved(Address),
    /// cycle_id -> how many shareholders have claimed.
    ClaimCount(u32),
    /// When a cycle last carried. Releases are monthly, and this is the clock.
    LastReleaseAt,
    /// (cycle_id, voter) -> voted
    CycleVote(u32, Address),
    /// (cycle_id, shareholder) -> claimed
    Claimed(u32, Address),
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

/// Whether `approvals` owners out of `total` meets the two-thirds rule.
///
/// Multiplied rather than divided, so the rounding is exact and upward without a
/// ceiling function: 2 of 3 gives 6 >= 6 and carries, 2 of 4 gives 6 >= 8 and
/// does not. Integer division would round 2/3 of 4 down to 2 and let half the
/// owners release the money.
/// Invoke a one-argument admin function on the factory.
///
/// Symbol::new rather than symbol_short!, because the latter caps at nine
/// characters and every one of these names is longer.
fn call_factory(env: &Env, method: &str, arg: soroban_sdk::Val) {
    let factory: Address = load(env, &DataKey::Factory);
    env.invoke_contract::<()>(
        &factory,
        &Symbol::new(env, method),
        soroban_sdk::vec![env, arg],
    );
}

fn carried(approvals: u32, total: u32) -> bool {
    (approvals as u64) * (APPROVAL_DENOMINATOR as u64)
        >= (total as u64) * (APPROVAL_NUMERATOR as u64)
}

/// An equal register over `owners`, totalling exactly 10 000.
///
/// Ten thousand does not divide by three, so equality cannot be exact. The
/// remainder goes one basis point at a time to the earliest owners rather than
/// being dropped, because validate_roster requires the total to be the whole and
/// a register summing to 9 999 would leave a basis point nobody could ever claim.
fn equal_shares(env: &Env, owners: &Vec<Address>) -> Vec<Shareholder> {
    let n = owners.len();
    if n == 0 || n > MAX_SHAREHOLDERS {
        panic_with_error!(env, Error::TooManyShareholders);
    }

    let base = BPS_TOTAL as u32 / n;
    let remainder = BPS_TOTAL as u32 % n;

    let mut register = Vec::new(env);
    for i in 0..n {
        register.push_back(Shareholder {
            address: owners.get(i).unwrap(),
            share_bps: base + if i < remainder { 1 } else { 0 },
        });
    }
    register
}

#[contract]
pub struct Treasury;

#[contractimpl]
impl Treasury {
    /// Configure the treasury. `factory` is the contract whose fee this
    /// treasury may change; it must set this contract as its admin for that to
    /// work, which is a separate deliberate act.
    ///
    /// `deployer` must sign. Without that signature this is a land grab: a
    /// treasury sitting deployed and unconfigured for even one ledger can be
    /// claimed by whoever calls this first, naming themselves the entire
    /// register. Deploy and initialize are separate transactions, so that
    /// window is real rather than theoretical.
    pub fn initialize(
        env: Env,
        deployer: Address,
        factory: Address,
        shareholders: Vec<Shareholder>,
    ) {
        deployer.require_auth();

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

    /// Open a cycle over the treasury's *unreserved* balance of `token`.
    ///
    /// Any shareholder may open one. There is no privileged proposer, because a
    /// proposer who could refuse to act would be able to withhold everyone
    /// else's earnings indefinitely.
    ///
    /// Only a cycle still being voted on blocks a new one. A payable cycle does
    /// not: its money is reserved, so a later cycle cannot reach it, and there
    /// is no reason to make everyone wait for the last shareholder to get round
    /// to claiming. An earlier design blocked on payable and deadlocked the
    /// contract the moment a cycle was fully claimed — the state stayed payable
    /// forever and no further cycle could ever open.
    pub fn open_cycle(env: Env, opener: Address, token: Address) {
        bump(&env);
        opener.require_auth();

        let roster: Vec<Shareholder> = load(&env, &DataKey::Shareholders);
        if share_of(&roster, &opener).is_none() {
            panic_with_error!(&env, Error::NotAShareholder);
        }

        if let Some(open_id) = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::OpenCycleId)
        {
            let open_cycle: Cycle = env
                .storage()
                .persistent()
                .get(&DataKey::Cycle(open_id))
                .unwrap_or_else(|| panic_with_error!(&env, Error::NoCycleOpen));

            // Still live: one vote at a time, so the roster snapshot and the
            // reserved amount stay unambiguous.
            if open_cycle.state == CycleState::Voting
                && env.ledger().timestamp() < open_cycle.closes_at
            {
                panic_with_error!(&env, Error::CycleAlreadyOpen);
            }
            // Closed short but never settled. Settling is permissionless and
            // must happen first, so the outcome is recorded rather than skipped.
            if open_cycle.state == CycleState::Voting {
                panic_with_error!(&env, Error::VotingClosed);
            }
        }

        // Monthly, measured from the last release that carried. Checked at open
        // rather than at approval so the owners find out before spending a
        // voting window, and so a cycle cannot be opened early and held until
        // the clock catches up.
        if let Some(last) = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::LastReleaseAt)
        {
            if env.ledger().timestamp() < last + MIN_RELEASE_INTERVAL {
                panic_with_error!(&env, Error::ReleaseTooSoon);
            }
        }

        // Reserved money belongs to shareholders of earlier cycles who have not
        // claimed yet. Excluding it is what stops a new cycle from paying their
        // share to somebody else.
        let balance = token::Client::new(&env, &token).balance(&env.current_contract_address());
        let reserved: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserved(token.clone()))
            .unwrap_or(0);
        let available = balance - reserved;

        if available <= 0 {
            panic_with_error!(&env, Error::NothingToRelease);
        }

        let id: u32 = load(&env, &DataKey::NextCycleId);
        let window: u64 = load(&env, &DataKey::VoteWindow);
        let now = env.ledger().timestamp();

        let cycle = Cycle {
            id,
            token: token.clone(),
            amount: available,
            roster,
            opened_at: now,
            closes_at: now + window,
            approvals: 0,
            state: CycleState::Voting,
        };

        env.storage().persistent().set(&DataKey::Cycle(id), &cycle);
        env.storage().instance().set(&DataKey::OpenCycleId, &id);
        env.storage().instance().set(&DataKey::NextCycleId, &(id + 1));

        env.events().publish(
            (symbol_short!("CYCLE"), symbol_short!("OPEN")),
            (id, token, available, cycle.closes_at),
        );
    }

    /// Approve the open cycle. One vote per shareholder, weighted by share.
    pub fn approve_cycle(env: Env, voter: Address) {
        bump(&env);
        voter.require_auth();

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::OpenCycleId)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoCycleOpen));

        let mut cycle: Cycle = env
            .storage()
            .persistent()
            .get(&DataKey::Cycle(id))
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

        // Membership is what the vote needs; the share is read only to confirm
        // the voter is on the register the cycle snapshotted.
        let _ = share;
        cycle.approvals += 1;
        let reached = carried(cycle.approvals, cycle.roster.len());
        if reached {
            cycle.state = CycleState::Payable;

            // Reserve the whole amount now. Until every share is claimed this
            // money is spoken for, and a later cycle must not be able to see it.
            let reserved: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Reserved(cycle.token.clone()))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::Reserved(cycle.token.clone()),
                &(reserved + cycle.amount),
            );

            // The clock starts here, not at open: a cycle that lapses costs
            // nobody a month, and the next attempt can begin immediately.
            env.storage()
                .instance()
                .set(&DataKey::LastReleaseAt, &env.ledger().timestamp());

            // The vote is over, so this cycle no longer blocks the next one.
            env.storage().instance().remove(&DataKey::OpenCycleId);
        }

        let approved = cycle.approvals;
        env.storage().persistent().set(&DataKey::Cycle(id), &cycle);

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
    /// Permissionless, and it pays nobody. Nothing was reserved, so the balance
    /// simply stays here and is picked up by the next cycle: an unfinished vote
    /// delays a payout rather than destroying it.
    pub fn settle_lapsed_cycle(env: Env) {
        bump(&env);

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::OpenCycleId)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoCycleOpen));

        let mut cycle: Cycle = env
            .storage()
            .persistent()
            .get(&DataKey::Cycle(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoCycleOpen));

        if cycle.state != CycleState::Voting {
            panic_with_error!(&env, Error::VotingClosed);
        }
        if env.ledger().timestamp() < cycle.closes_at {
            panic_with_error!(&env, Error::VotingClosed);
        }
        if carried(cycle.approvals, cycle.roster.len()) {
            panic_with_error!(&env, Error::ThresholdAlreadyMet);
        }

        cycle.state = CycleState::Lapsed;
        env.storage().persistent().set(&DataKey::Cycle(id), &cycle);
        env.storage().instance().remove(&DataKey::OpenCycleId);

        env.events()
            .publish((symbol_short!("CYCLE"), symbol_short!("LAPSED")), id);
    }

    /// Claim your share of a payable cycle.
    ///
    /// Named by cycle id, because several may be payable at once: a shareholder
    /// who is slow to claim never blocks the next cycle, and never loses what
    /// they are owed from an earlier one.
    ///
    /// Pulled rather than pushed, so one recipient that cannot receive the token
    /// cannot strand everyone else's money behind their problem.
    pub fn claim(env: Env, shareholder: Address, cycle_id: u32) {
        bump(&env);
        shareholder.require_auth();

        let cycle: Cycle = env
            .storage()
            .persistent()
            .get(&DataKey::Cycle(cycle_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoCycleOpen));

        if cycle.state != CycleState::Payable {
            panic_with_error!(&env, Error::NotPayable);
        }

        let share = share_of(&cycle.roster, &shareholder)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotAShareholder));

        let key = DataKey::Claimed(cycle_id, shareholder.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }
        env.storage().persistent().set(&key, &true);

        // Integer division truncates, so the shares can sum to slightly less
        // than the total. The remainder stays reserved against this cycle and is
        // released back to the pool by the final claimant below.
        let payout = cycle
            .amount
            .checked_mul(share as i128)
            .unwrap()
            .checked_div(BPS_TOTAL)
            .unwrap();

        // Release exactly this claimant's portion of the reservation.
        let reserved: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserved(cycle.token.clone()))
            .unwrap_or(0);

        let claims = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::ClaimCount(cycle_id))
            .unwrap_or(0)
            + 1;
        env.storage()
            .persistent()
            .set(&DataKey::ClaimCount(cycle_id), &claims);

        // The last claimant also frees the truncation remainder, so it returns
        // to the unreserved pool instead of being reserved against a cycle that
        // is finished with.
        let release = if claims == cycle.roster.len() {
            let mut distributed: i128 = 0;
            for i in 0..cycle.roster.len() {
                let entry = cycle.roster.get(i).unwrap();
                distributed += cycle
                    .amount
                    .checked_mul(entry.share_bps as i128)
                    .unwrap()
                    .checked_div(BPS_TOTAL)
                    .unwrap();
            }
            // Everything this cycle reserved, including what truncation left over.
            cycle.amount - (distributed - payout)
        } else {
            payout
        };

        env.storage().persistent().set(
            &DataKey::Reserved(cycle.token.clone()),
            &(reserved - release),
        );

        if payout > 0 {
            token::Client::new(&env, &cycle.token).transfer(
                &env.current_contract_address(),
                &shareholder,
                &payout,
            );
        }

        env.events().publish(
            (symbol_short!("CYCLE"), symbol_short!("CLAIM")),
            (cycle_id, shareholder, payout),
        );
    }


    // ── Fee governance ─────────────────────────────────────────────────────

    /// Propose a governed action: the listing fee, factory admin, or the
    /// shareholder register.
    ///
    /// The fee stays a flat amount. SOW v4 states a flat-fee model three times
    /// and frames it as a Philippine SEC/BSP constraint — "BLKFNDR charges flat
    /// fees, never takes a percentage of funds" — so what a vote adjusts is the
    /// amount, not the shape.
    pub fn propose(env: Env, proposer: Address, action: GovernedAction) {
        bump(&env);
        proposer.require_auth();

        // Reject a malformed action now rather than after a week of voting, so
        // shareholders never spend a window on something that cannot execute.
        match &action {
            GovernedAction::SetFee(fee) => {
                if *fee < 0 {
                    panic_with_error!(&env, Error::FeeOutOfRange);
                }
            }
            GovernedAction::SetShareholders(next) => validate_roster(&env, next),
            GovernedAction::SetOwners(owners) => {
                validate_roster(&env, &equal_shares(&env, owners));
            }
            // A bond above the whole raise would make listing impossible, and
            // the factory would reject it anyway — caught here so the owners
            // find out before spending a voting window rather than after.
            GovernedAction::SetBondBps(bps) => {
                if *bps > BPS_TOTAL as u64 {
                    panic_with_error!(&env, Error::FeeOutOfRange);
                }
            }
            GovernedAction::SetMinContribution(min) => {
                if *min < 0 {
                    panic_with_error!(&env, Error::FeeOutOfRange);
                }
            }
            GovernedAction::TransferAdmin(_)
            | GovernedAction::SetWasmHash(_)
            | GovernedAction::SetFeeWallet(_)
            | GovernedAction::SetIdentityRegistry(_)
            | GovernedAction::SetVotingWindow(_) => {}
        }

        let roster: Vec<Shareholder> = load(&env, &DataKey::Shareholders);
        if share_of(&roster, &proposer).is_none() {
            panic_with_error!(&env, Error::NotAShareholder);
        }

        if let Some(open) = env
            .storage()
            .instance()
            .get::<_, Proposal>(&DataKey::Proposal)
        {
            if env.ledger().timestamp() < open.closes_at
                && !carried(open.approvals, open.roster.len())
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
            roster,
            opened_at: now,
            closes_at: now + window,
            approvals: 0,
        };

        env.storage()
            .instance()
            .set(&DataKey::Proposal, &proposal);
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

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoProposalOpen));

        if env.ledger().timestamp() >= proposal.closes_at {
            panic_with_error!(&env, Error::VotingClosed);
        }
        if carried(proposal.approvals, proposal.roster.len()) {
            panic_with_error!(&env, Error::ThresholdAlreadyMet);
        }

        let share = share_of(&proposal.roster, &voter)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotAShareholder));

        let key = DataKey::ProposalVote(proposal.id, voter.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyVoted);
        }
        env.storage().persistent().set(&key, &true);

        let _ = share;
        proposal.approvals += 1;
        let id = proposal.id;
        let approved = proposal.approvals;
        env.storage()
            .instance()
            .set(&DataKey::Proposal, &proposal);

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

        let proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoProposalOpen));

        if !carried(proposal.approvals, proposal.roster.len()) {
            panic_with_error!(&env, Error::ThresholdNotMet);
        }

        // Symbol::new, not symbol_short!: the latter caps at nine characters and
        // these names are longer.
        match &proposal.action {
            GovernedAction::SetFee(fee) => {
                call_factory(&env, "update_platform_fee", fee.into_val(&env));
            }
            GovernedAction::TransferAdmin(new_admin) => {
                call_factory(&env, "transfer_admin", new_admin.into_val(&env));
            }
            GovernedAction::SetBondBps(bps) => {
                call_factory(&env, "update_bond_percentage", bps.into_val(&env));
            }
            GovernedAction::SetWasmHash(hash) => {
                call_factory(&env, "update_wasm_hash", hash.into_val(&env));
            }
            GovernedAction::SetFeeWallet(wallet) => {
                call_factory(&env, "update_fee_wallet", wallet.into_val(&env));
            }
            GovernedAction::SetIdentityRegistry(registry) => {
                call_factory(&env, "update_identity_registry", registry.into_val(&env));
            }
            GovernedAction::SetVotingWindow(secs) => {
                call_factory(&env, "update_voting_window", secs.into_val(&env));
            }
            GovernedAction::SetMinContribution(min) => {
                call_factory(&env, "update_min_contribution", min.into_val(&env));
            }
            GovernedAction::SetOwners(owners) => {
                let register = equal_shares(&env, owners);
                validate_roster(&env, &register);
                env.storage()
                    .instance()
                    .set(&DataKey::Shareholders, &register);

                env.events().publish(
                    (symbol_short!("OWNERS"), symbol_short!("SET")),
                    register.len(),
                );
            }
            GovernedAction::SetShareholders(next) => {
                // Revalidated at execution, not just at proposal: cheap, and the
                // register is the one piece of state that decides who gets paid.
                validate_roster(&env, next);
                env.storage().instance().set(&DataKey::Shareholders, next);

                env.events().publish(
                    (symbol_short!("SHARES"), symbol_short!("SET")),
                    next.len(),
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

    /// When the next cycle may open. Zero if none has ever carried.
    pub fn next_release_at(env: Env) -> u64 {
        env.storage()
            .instance()
            .get::<_, u64>(&DataKey::LastReleaseAt)
            .map(|last| last + MIN_RELEASE_INTERVAL)
            .unwrap_or(0)
    }

    pub fn get_shareholders(env: Env) -> Vec<Shareholder> {
        load(&env, &DataKey::Shareholders)
    }

    pub fn get_cycle(env: Env, cycle_id: u32) -> Option<Cycle> {
        env.storage().persistent().get(&DataKey::Cycle(cycle_id))
    }

    /// The cycle currently being voted on, if any.
    pub fn get_open_cycle(env: Env) -> Option<Cycle> {
        let id: u32 = env.storage().instance().get(&DataKey::OpenCycleId)?;
        env.storage().persistent().get(&DataKey::Cycle(id))
    }

    /// What is still owed to shareholders of payable cycles, and so cannot be
    /// taken by a new one.
    pub fn get_reserved(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Reserved(token))
            .unwrap_or(0)
    }

    /// What a cycle opened right now would settle.
    pub fn get_available(env: Env, token: Address) -> i128 {
        let balance = token::Client::new(&env, &token).balance(&env.current_contract_address());
        let reserved: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserved(token))
            .unwrap_or(0);
        balance - reserved
    }

    pub fn get_proposal(env: Env) -> Option<Proposal> {
        env.storage().instance().get(&DataKey::Proposal)
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
