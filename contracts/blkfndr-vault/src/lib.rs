#![no_std]
// Contract entrypoints are an ABI: their parameters are the wire format, and
// bundling them into structs to satisfy an argument-count lint would only move
// the same fields behind a type that every caller must then construct.
#![allow(clippy::too_many_arguments)]

//! BLKFNDR bonded funding vault.
//!
//! One vault per project. Contributions pool here, the builder's performance
//! bond is locked here at construction, and milestone tranches are released
//! only when contributors themselves vote to release them.
//!
//! Release authority is contribution-weighted and lives entirely in this
//! contract. There is no approval module, no appointed signer, no admin key and
//! no platform role anywhere in the path that moves money:
//!
//!   * one vote unit per unit contributed, recorded at deposit;
//!   * a single wallet's effective weight is capped at 20% of the total raise;
//!   * a release needs more than half of all contributors' effective weight —
//!     the capped total, so the bar can always be reached when everyone votes;
//!   * and at least three distinct approving wallets, or every contributor when
//!     there are fewer than three — so no wallet releases alone over anyone,
//!     and a project with one or two backers can still release;
//!   * each milestone opens a fixed voting window, set at project creation;
//!   * a window that closes below threshold fails the milestone — contributor
//!     silence returns money, it never releases it.
//!
//! The platform fee is a flat amount charged once to the builder at creation.
//! Contributor funds are never touched by it.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Env, String, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized            = 1,
    InvalidStatus            = 2,
    InsufficientFunds        = 4,
    GoalAlreadyReached       = 5,
    InvalidConfiguration     = 6,
    FundingDeadlinePassed    = 7,
    NoFundsToRefund          = 9,
    AlreadyInitialized       = 10,
    NotInitialized           = 11,
    KYCInvalid               = 12,
    MilestoneNotFound        = 13,
    MilestoneAlreadyReleased = 14,
    VotingNotOpen            = 15,
    VotingAlreadyOpen        = 16,
    VotingClosed             = 17,
    AlreadyVoted             = 18,
    NotAContributor          = 19,
    ThresholdNotMet          = 20,
    ThresholdMet             = 21,
    VotingWindowNotElapsed   = 22,
    MilestoneFailed          = 23,
    BelowMinimumContribution = 24,
    NotStalled               = 25,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

/// Basis-point denominator.
const BPS: i128 = 10_000;
/// No single wallet may wield more than 20% of the raise, however much it put in.
const WEIGHT_CAP_BPS: i128 = 2_000;
/// A release needs more than 50% of the total effective (capped) weight.
const RELEASE_THRESHOLD_BPS: i128 = 5_000;
/// A release needs at least this many distinct approving wallets, or every
/// contributor when there are fewer.
const MIN_APPROVING_WALLETS: u32 = 3;
/// How many of the largest balances the vault tracks to compute the capped
/// total. Only a wallet holding more than the cap loses weight to it, and at
/// most four can: five balances each above a fifth of the raise would sum to
/// more than the raise. So the excess over the cap always lies within the
/// four largest balances.
const LARGEST_TRACKED: u32 = 4;
/// Ceiling on any paged read, so a caller cannot ask for a page large enough
/// to exceed the resource budget.
const MAX_PAGE: u32 = 100;
/// Ceiling on the milestone count. `release_milestone` scans every milestone and
/// `write_attestation` loops them, both re-serialising the whole `ProjectInfo`,
/// so an unbounded list could make a vault impossible to settle. A builder with
/// more phases than this splits the project.
const MAX_MILESTONES: u32 = 20;
/// How long a funded vault may sit without the builder opening the next
/// milestone vote before anyone may reclaim it for its contributors. A funded
/// vault advances only on a builder action no one else can take, so without a
/// timeout an abandoned project would strand contributor funds forever.
const BUILDER_STALL_WINDOW: u64 = 90 * 24 * 60 * 60; // 90 days

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultState {
    Raising   = 0,
    Funded    = 1,
    Active    = 2,
    Failed    = 3,
    Refunding = 4,
    Completed = 5,
}

/// Milestone as supplied at creation.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MilestoneInput {
    pub id:     u32,
    pub amount: i128,
}

/// Milestone as tracked by the vault.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id:              u32,
    pub amount:          i128,
    pub released:        bool,
    pub failed:          bool,
    /// Unix seconds the voting window opened; 0 when it has not opened.
    pub vote_opens_at:   u64,
    /// Running sum of the effective weight behind this milestone.
    pub approved_weight: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultInitConfig {
    pub project_id:           u64,
    pub creator:              Address,
    pub token:                Address,
    pub goal:                 i128,
    pub deadline:             u64,
    pub bond_amount:          i128,
    pub identity_registry:    Address,
    pub attestation_registry: Address,
    pub factory:              Address,
    pub fee_wallet_address:   Address,
    /// Flat, charged once to the builder at creation. Never a percentage, and
    /// never taken from contributor funds.
    pub platform_fee:         i128,
    /// Seconds a milestone vote stays open once the builder opens it.
    pub voting_window_secs:   u64,
    pub min_contribution:     i128,
    pub milestones:           Vec<MilestoneInput>,
    pub metadata_cid:         String,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProjectInfo {
    pub project_id:           u64,
    pub creator:              Address,
    pub token:                Address,
    pub goal:                 i128,
    pub raised_amount:        i128,
    pub deadline:             u64,
    pub bond_amount:          i128,
    pub bond_posted:          bool,
    pub bond_returned:        bool,
    pub identity_registry:    Address,
    pub attestation_registry: Address,
    pub factory:              Address,
    pub fee_wallet_address:   Address,
    pub platform_fee:         i128,
    pub voting_window_secs:   u64,
    pub min_contribution:     i128,
    pub milestones:           Vec<Milestone>,
    pub released_total:       i128,
    /// Contributions not yet refunded. Counts down as claims are made, so the
    /// contract can tell when it is serving the final claimant and sweep the
    /// rounding dust to them instead of stranding it.
    pub unclaimed_contributions: i128,
    pub metadata_cid:         String,
    pub attested:             bool,
}

#[contracttype]
pub enum DataKey {
    State,
    Info,
    ContributorBalance(Address),
    Contributors,
    /// Whether a contributor has voted on a given milestone.
    Vote(u32, Address),
    /// Unix seconds of the last builder progress: set when the raise is funded
    /// and on each release. `settle_stalled` measures the abandonment window
    /// against this.
    LastActivity,
    /// The `LARGEST_TRACKED` largest contributor balances, unordered. Enough
    /// to compute the capped total without walking every contributor.
    Largest,
    /// Number of distinct contributors.
    ContributorCount,
    /// Number of distinct contributors who have approved a given milestone.
    Approvals(u32),
}

#[contractclient(name = "IdentityRegistryClient")]
pub trait IdentityRegistryTrait {
    fn is_kyc_approved(env: Env, address: Address) -> bool;
}

/// Mirrors blkfndr-attestation's outcome enum across the contract boundary.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Outcome {
    Completed            = 0,
    FailedWithForfeiture = 1,
    FailedToFund         = 2,
}

#[contractclient(name = "AttestationClient")]
pub trait AttestationTrait {
    fn attest(
        env:                 Env,
        vault:               Address,
        factory:             Address,
        builder:             Address,
        project_id:          u64,
        outcome:             Outcome,
        total_raised:        i128,
        bond_posted:         i128,
        milestones_total:    u32,
        milestones_approved: u32,
    );
}

// ── STORAGE ────────────────────────────────────────────────────────────────

#[inline]
fn load_state(env: &Env) -> VaultState {
    env.storage()
        .instance()
        .get(&DataKey::State)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn save_state(env: &Env, state: VaultState) {
    env.storage().instance().set(&DataKey::State, &state);
}

#[inline]
fn load_info(env: &Env) -> ProjectInfo {
    env.storage()
        .instance()
        .get(&DataKey::Info)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

#[inline]
fn save_info(env: &Env, info: &ProjectInfo) {
    env.storage().instance().set(&DataKey::Info, info);
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

// ── VOTING ARITHMETIC ──────────────────────────────────────────────────────

/// The most any one wallet may count for, whatever it contributed.
///
/// The cap is a fifth of the raise, not of the capped total, so it is fixed once
/// the raise closes and a contributor's weight cannot shift under a vote.
///
/// Never below one base unit: a raise under five units would otherwise floor
/// the cap to zero, zeroing every weight so that not even a unanimous vote
/// could carry. At most four balances still exceed it, since five balances of
/// at least `cap + 1` would sum to more than the raise.
fn weight_cap(raised_amount: i128) -> i128 {
    let cap = raised_amount
        .checked_mul(WEIGHT_CAP_BPS)
        .unwrap()
        .checked_div(BPS)
        .unwrap();
    if cap < 1 {
        1
    } else {
        cap
    }
}

fn effective_weight(contribution: i128, raised_amount: i128) -> i128 {
    let cap = weight_cap(raised_amount);
    if contribution < cap {
        contribution
    } else {
        cap
    }
}

/// Sum of every contributor's effective weight: what the whole vault would
/// count for if everyone voted.
///
/// The release threshold is measured against this rather than against the raw
/// raise. Measured against the raise, a capped wallet's excess is weight nobody
/// can ever cast, so a concentrated raise could not clear >50% even with every
/// vote in: a sole contributor counts for 20%, two for 40% at most. Every such
/// milestone would lapse and forfeit the bond of a builder who delivered.
///
/// Only the tracked largest balances can exceed the cap (see
/// `LARGEST_TRACKED`), so the capped total is the raise less their excess.
fn total_weight(env: &Env, raised_amount: i128) -> i128 {
    let cap = weight_cap(raised_amount);
    let largest: Vec<(Address, i128)> = env
        .storage()
        .instance()
        .get(&DataKey::Largest)
        .unwrap_or_else(|| Vec::new(env));

    let mut total = raised_amount;
    for (_, balance) in largest.iter() {
        if balance > cap {
            total = total.checked_sub(balance.checked_sub(cap).unwrap()).unwrap();
        }
    }
    total
}

/// True when the weight behind a milestone exceeds 50% of the capped total.
fn threshold_met(approved_weight: i128, total_weight: i128) -> bool {
    if total_weight <= 0 {
        return false;
    }
    approved_weight.checked_mul(BPS).unwrap()
        > total_weight.checked_mul(RELEASE_THRESHOLD_BPS).unwrap()
}

/// Smallest weight that clears `threshold_met`.
fn required_weight(total_weight: i128) -> i128 {
    total_weight
        .checked_mul(RELEASE_THRESHOLD_BPS)
        .unwrap()
        .checked_div(BPS)
        .unwrap()
        .checked_add(1)
        .unwrap()
}

/// Distinct approving wallets a release needs: three, or every contributor
/// when there are fewer than three.
///
/// Measuring the threshold against the capped total lowers the bar whenever
/// someone is capped, which on its own would let two wallets — or one holding
/// most of the raise — outvote the rest. This floor keeps a release from ever
/// being carried over a dissenting contributor by fewer than three wallets.
fn required_wallets(env: &Env) -> u32 {
    let contributors: u32 = env
        .storage()
        .instance()
        .get(&DataKey::ContributorCount)
        .unwrap_or(0);
    if contributors < MIN_APPROVING_WALLETS {
        contributors
    } else {
        MIN_APPROVING_WALLETS
    }
}

fn approvals(env: &Env, milestone_id: u32) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::Approvals(milestone_id))
        .unwrap_or(0)
}

/// Whether a milestone's vote has carried: more than half the capped total
/// behind it, from at least `required_wallets` distinct contributors.
///
/// Contributions close when the goal is met and refunds open only once the
/// vault has left Funded/Active, so the raise, the balances and the capped
/// total are all fixed while a vote runs.
fn carried(env: &Env, milestone: &Milestone, raised_amount: i128) -> bool {
    threshold_met(milestone.approved_weight, total_weight(env, raised_amount))
        && approvals(env, milestone.id) >= required_wallets(env)
}

/// Keep `DataKey::Largest` holding the `LARGEST_TRACKED` largest balances after
/// `contributor`'s balance rises to `balance`.
///
/// Balances only grow while the raise is open, and only the contributing
/// wallet's changes, so it is the only one that can enter the set: update it
/// in place, add it while there is room, or let it displace the smallest
/// tracked balance it now exceeds.
fn track_largest(env: &Env, contributor: &Address, balance: i128) {
    let mut largest: Vec<(Address, i128)> = env
        .storage()
        .instance()
        .get(&DataKey::Largest)
        .unwrap_or_else(|| Vec::new(env));

    let mut smallest = 0u32;
    for i in 0..largest.len() {
        let (holder, held) = largest.get(i).unwrap();
        if holder == *contributor {
            largest.set(i, (holder, balance));
            env.storage().instance().set(&DataKey::Largest, &largest);
            return;
        }
        if held < largest.get(smallest).unwrap().1 {
            smallest = i;
        }
    }

    if largest.len() < LARGEST_TRACKED {
        largest.push_back((contributor.clone(), balance));
    } else if balance > largest.get(smallest).unwrap().1 {
        largest.set(smallest, (contributor.clone(), balance));
    } else {
        return;
    }
    env.storage().instance().set(&DataKey::Largest, &largest);
}

// ── LIFECYCLE ──────────────────────────────────────────────────────────────

/// What the vault's state *should* be right now, without writing anything.
///
/// Kept free of side effects so that `get_state` and `get_info` are true reads.
/// The previous design moved tokens from inside a getter, which meant a
/// simulated read produced a transfer in its footprint.
fn effective_state(env: &Env) -> VaultState {
    let state = load_state(env);
    if state != VaultState::Raising {
        return state;
    }

    let info = load_info(env);
    if env.ledger().timestamp() < info.deadline {
        return VaultState::Raising;
    }

    if info.raised_amount >= info.goal {
        VaultState::Funded
    } else {
        VaultState::Failed
    }
}

/// Persist any pending lifecycle transition. Every mutating entrypoint runs
/// this first so it sees a current state.
fn sync_state(env: &Env) -> VaultState {
    let stored = load_state(env);
    let current = effective_state(env);
    if current == stored {
        return stored;
    }

    save_state(env, current);
    let info = load_info(env);

    match current {
        VaultState::Funded => {
            // Start the abandonment clock: the builder must now open the first
            // milestone vote, and settle_stalled measures inactivity from here.
            env.storage()
                .instance()
                .set(&DataKey::LastActivity, &env.ledger().timestamp());
            env.events().publish(
                (symbol_short!("VAULT"), symbol_short!("FUNDED")),
                (info.project_id, info.raised_amount),
            );
        }
        VaultState::Failed => {
            env.events().publish(
                (symbol_short!("VAULT"), symbol_short!("FAILED")),
                (info.project_id, info.raised_amount),
            );
        }
        _ => {}
    }

    current
}

/// Write this project's permanent record. Runs once; later calls are no-ops.
fn write_attestation(env: &Env, info: &mut ProjectInfo, outcome: Outcome) {
    if info.attested {
        return;
    }

    let mut approved = 0u32;
    for i in 0..info.milestones.len() {
        if info.milestones.get(i).unwrap().released {
            approved += 1;
        }
    }

    let client = AttestationClient::new(env, &info.attestation_registry);
    client.attest(
        &env.current_contract_address(),
        // Name the factory that deployed us. The registry checks both that it
        // trusts that factory and that the factory claims this vault.
        &info.factory,
        &info.creator,
        &info.project_id,
        &outcome,
        &info.raised_amount,
        &info.bond_amount,
        &info.milestones.len(),
        &approved,
    );

    info.attested = true;
}

// ── CONTRACT ───────────────────────────────────────────────────────────────

#[contract]
pub struct BlkfndrVault;

#[contractimpl]
impl BlkfndrVault {
    /// Construct the vault and lock the builder's bond in the same call.
    ///
    /// The bond is not a later step the builder can skip — the transfer happens
    /// here, so a vault either exists with its bond locked or does not exist.
    pub fn initialize(env: Env, config: VaultInitConfig) {
        if env.storage().instance().has(&DataKey::State) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        // The factory authorises its own call. Without this an observer could
        // initialise a deployed-but-unconfigured vault with a config of their
        // choosing.
        config.factory.require_auth();
        // And the builder authorises theirs, because this call is about to take
        // their bond and the flat fee out of their account.
        config.creator.require_auth();

        if config.goal <= 0
            || config.bond_amount < 0
            || config.platform_fee < 0
            || config.min_contribution <= 0
            || config.voting_window_secs == 0
            || config.milestones.is_empty()
            || config.milestones.len() > MAX_MILESTONES
            || config.deadline <= env.ledger().timestamp()
        {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }

        let kyc_client = IdentityRegistryClient::new(&env, &config.identity_registry);
        if !kyc_client.is_kyc_approved(&config.creator) {
            panic_with_error!(&env, Error::KYCInvalid);
        }

        // Milestone tranches must account for the whole goal, and ids must be
        // unique or a vote could be recorded against the wrong tranche.
        let mut sum: i128 = 0;
        let mut milestones = Vec::new(&env);
        for i in 0..config.milestones.len() {
            let input = config.milestones.get(i).unwrap();
            if input.amount <= 0 {
                panic_with_error!(&env, Error::InvalidConfiguration);
            }
            for j in 0..i {
                if config.milestones.get(j).unwrap().id == input.id {
                    panic_with_error!(&env, Error::InvalidConfiguration);
                }
            }
            sum = sum.checked_add(input.amount).unwrap();
            milestones.push_back(Milestone {
                id: input.id,
                amount: input.amount,
                released: false,
                failed: false,
                vote_opens_at: 0,
                approved_weight: 0,
            });
        }
        if sum != config.goal {
            panic_with_error!(&env, Error::InvalidConfiguration);
        }

        let info = ProjectInfo {
            project_id:           config.project_id,
            creator:              config.creator.clone(),
            token:                config.token.clone(),
            goal:                 config.goal,
            raised_amount:        0,
            deadline:             config.deadline,
            bond_amount:          config.bond_amount,
            bond_posted:          true,
            bond_returned:        false,
            identity_registry:    config.identity_registry,
            attestation_registry: config.attestation_registry,
            factory:              config.factory,
            fee_wallet_address:   config.fee_wallet_address.clone(),
            platform_fee:         config.platform_fee,
            voting_window_secs:   config.voting_window_secs,
            min_contribution:     config.min_contribution,
            milestones,
            released_total:       0,
            unclaimed_contributions: 0,
            metadata_cid:         config.metadata_cid.clone(),
            attested:             false,
        };

        save_info(&env, &info);
        save_state(&env, VaultState::Raising);
        extend_instance_ttl(&env);

        let token_client = token::Client::new(&env, &config.token);

        if config.bond_amount > 0 {
            token_client.transfer(
                &config.creator,
                &env.current_contract_address(),
                &config.bond_amount,
            );
        }

        // Flat listing fee, from the builder, once. Contributor money is never
        // its source, which is what lets the platform say it takes no
        // percentage of funds and holds no discretion over them.
        if config.platform_fee > 0 {
            token_client.transfer(
                &config.creator,
                &config.fee_wallet_address,
                &config.platform_fee,
            );
        }

        env.events().publish(
            (symbol_short!("VAULT"), symbol_short!("INIT")),
            (config.project_id, config.metadata_cid),
        );
        env.events().publish(
            (symbol_short!("BOND"), symbol_short!("POSTED")),
            (config.project_id, config.bond_amount),
        );
    }

    // ── RAISE ──────────────────────────────────────────────────────────────

    /// Back the project. The amount contributed is also the voting weight it
    /// carries, before the per-wallet cap is applied.
    pub fn contribute(env: Env, contributor: Address, amount: i128) {
        extend_instance_ttl(&env);
        if sync_state(&env) != VaultState::Raising {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut info = load_info(&env);

        if env.ledger().timestamp() >= info.deadline {
            panic_with_error!(&env, Error::FundingDeadlinePassed);
        }
        if amount < info.min_contribution {
            panic_with_error!(&env, Error::BelowMinimumContribution);
        }
        if info.raised_amount.checked_add(amount).unwrap() > info.goal {
            panic_with_error!(&env, Error::GoalAlreadyReached);
        }

        contributor.require_auth();

        let bal_key = DataKey::ContributorBalance(contributor.clone());
        let current: i128 = env.storage().persistent().get(&bal_key).unwrap_or(0);
        let updated = current.checked_add(amount).unwrap();
        env.storage().persistent().set(&bal_key, &updated);
        env.storage()
            .persistent()
            .extend_ttl(&bal_key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        track_largest(&env, &contributor, updated);

        if current == 0 {
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::ContributorCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::ContributorCount, &(count + 1));

            let list_key = DataKey::Contributors;
            let mut list: Vec<Address> = env
                .storage()
                .persistent()
                .get(&list_key)
                .unwrap_or_else(|| Vec::new(&env));
            list.push_back(contributor.clone());
            env.storage().persistent().set(&list_key, &list);
            env.storage()
                .persistent()
                .extend_ttl(&list_key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
        }

        info.raised_amount = info.raised_amount.checked_add(amount).unwrap();
        info.unclaimed_contributions = info
            .unclaimed_contributions
            .checked_add(amount)
            .unwrap();
        let goal_reached = info.raised_amount >= info.goal;
        save_info(&env, &info);

        // No fee is deducted: the contributor's whole deposit is theirs to
        // reclaim and to vote with.
        let token_client = token::Client::new(&env, &info.token);
        token_client.transfer(&contributor, &env.current_contract_address(), &amount);

        if goal_reached {
            save_state(&env, VaultState::Funded);
            // Start the abandonment clock the moment the raise closes early, the
            // same as the deadline-reached path in sync_state. settle_stalled
            // measures builder inactivity from here.
            env.storage()
                .instance()
                .set(&DataKey::LastActivity, &env.ledger().timestamp());
            env.events().publish(
                (symbol_short!("VAULT"), symbol_short!("FUNDED")),
                (info.project_id, info.raised_amount),
            );
        }

        env.events().publish(
            (symbol_short!("DEPOSIT"), symbol_short!("CONTRIB")),
            (info.project_id, contributor, amount, info.raised_amount),
        );
    }

    /// Persist a pending lifecycle transition. Permissionless — anyone may
    /// settle a vault whose deadline has passed.
    pub fn settle(env: Env) -> VaultState {
        extend_instance_ttl(&env);
        let state = sync_state(&env);

        if state == VaultState::Failed {
            // Nobody funded the project; that is not a builder default, so the
            // bond goes back and the record says so.
            let mut info = load_info(&env);
            write_attestation(&env, &mut info, Outcome::FailedToFund);
            save_info(&env, &info);
        }

        state
    }

    /// Return the bond to the builder after a project failed to reach its goal.
    /// Permissionless: the builder should not need anyone's cooperation.
    pub fn return_bond(env: Env) {
        extend_instance_ttl(&env);
        if sync_state(&env) != VaultState::Failed {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut info = load_info(&env);
        if info.bond_returned || info.bond_amount == 0 {
            panic_with_error!(&env, Error::NoFundsToRefund);
        }

        // Persist bond_returned before the external attestation call and the
        // transfer (checks-effects-interactions). A re-entrant attestation
        // registry then reads bond_returned == true from storage and cannot
        // drive a second payout.
        info.bond_returned = true;
        save_info(&env, &info);
        write_attestation(&env, &mut info, Outcome::FailedToFund);
        save_info(&env, &info);

        let token_client = token::Client::new(&env, &info.token);
        token_client.transfer(
            &env.current_contract_address(),
            &info.creator,
            &info.bond_amount,
        );

        env.events().publish(
            (symbol_short!("BOND"), symbol_short!("RETURNED")),
            (info.project_id, info.bond_amount),
        );
    }

    // ── MILESTONE VOTING ───────────────────────────────────────────────────

    /// Open the contributor vote on a milestone. Only the builder may start the
    /// clock, and only once per milestone.
    pub fn open_milestone_vote(env: Env, milestone_id: u32) {
        extend_instance_ttl(&env);
        let state = sync_state(&env);
        if state != VaultState::Funded && state != VaultState::Active {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut info = load_info(&env);
        info.creator.require_auth();

        let index = Self::milestone_index(&env, &info, milestone_id);
        let mut milestone = info.milestones.get(index).unwrap();

        if milestone.released {
            panic_with_error!(&env, Error::MilestoneAlreadyReleased);
        }
        if milestone.failed {
            panic_with_error!(&env, Error::MilestoneFailed);
        }
        if milestone.vote_opens_at != 0 {
            panic_with_error!(&env, Error::VotingAlreadyOpen);
        }

        let now = env.ledger().timestamp();
        milestone.vote_opens_at = now;
        info.milestones.set(index, milestone);
        save_info(&env, &info);

        env.events().publish(
            (symbol_short!("MILESTN"), symbol_short!("VOTEOPEN")),
            (
                info.project_id,
                milestone_id,
                now,
                now + info.voting_window_secs,
            ),
        );
    }

    /// Vote to release a milestone. Weight is the amount contributed, capped at
    /// 20% of the total raise, and each vote also counts toward the three-wallet
    /// floor.
    pub fn approve_milestone(env: Env, contributor: Address, milestone_id: u32) {
        extend_instance_ttl(&env);
        let state = sync_state(&env);
        if state != VaultState::Funded && state != VaultState::Active {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        contributor.require_auth();

        let mut info = load_info(&env);
        let index = Self::milestone_index(&env, &info, milestone_id);
        let mut milestone = info.milestones.get(index).unwrap();

        if milestone.released {
            panic_with_error!(&env, Error::MilestoneAlreadyReleased);
        }
        if milestone.failed {
            panic_with_error!(&env, Error::MilestoneFailed);
        }
        if milestone.vote_opens_at == 0 {
            panic_with_error!(&env, Error::VotingNotOpen);
        }
        if env.ledger().timestamp() >= milestone.vote_opens_at + info.voting_window_secs {
            panic_with_error!(&env, Error::VotingClosed);
        }

        let contribution: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ContributorBalance(contributor.clone()))
            .unwrap_or(0);
        if contribution <= 0 {
            panic_with_error!(&env, Error::NotAContributor);
        }

        let vote_key = DataKey::Vote(milestone_id, contributor.clone());
        if env.storage().persistent().has(&vote_key) {
            panic_with_error!(&env, Error::AlreadyVoted);
        }
        env.storage().persistent().set(&vote_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&vote_key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        // Contributions close when the goal is met, so the raise total is fixed
        // for the whole voting period and weights cannot shift under a vote.
        let weight = effective_weight(contribution, info.raised_amount);
        milestone.approved_weight = milestone.approved_weight.checked_add(weight).unwrap();
        let running = milestone.approved_weight;
        // AlreadyVoted above makes this a count of distinct wallets.
        env.storage().instance().set(
            &DataKey::Approvals(milestone_id),
            &(approvals(&env, milestone_id) + 1),
        );
        info.milestones.set(index, milestone);
        save_info(&env, &info);

        env.events().publish(
            (symbol_short!("MILESTN"), symbol_short!("APPROVE")),
            (info.project_id, milestone_id, contributor, weight, running),
        );
    }

    /// Release a milestone tranche to the builder. Permissionless: once
    /// contributors have carried the vote, nobody can withhold execution.
    pub fn release_milestone(env: Env, milestone_id: u32) {
        extend_instance_ttl(&env);
        let state = sync_state(&env);
        if state != VaultState::Funded && state != VaultState::Active {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut info = load_info(&env);
        let index = Self::milestone_index(&env, &info, milestone_id);
        let mut milestone = info.milestones.get(index).unwrap();

        if milestone.released {
            panic_with_error!(&env, Error::MilestoneAlreadyReleased);
        }
        if milestone.failed {
            panic_with_error!(&env, Error::MilestoneFailed);
        }
        if milestone.vote_opens_at == 0 {
            panic_with_error!(&env, Error::VotingNotOpen);
        }
        if !carried(&env, &milestone, info.raised_amount) {
            panic_with_error!(&env, Error::ThresholdNotMet);
        }

        let tranche = milestone.amount;
        milestone.released = true;
        info.milestones.set(index, milestone);
        info.released_total = info.released_total.checked_add(tranche).unwrap();

        let mut all_released = true;
        for i in 0..info.milestones.len() {
            if !info.milestones.get(i).unwrap().released {
                all_released = false;
                break;
            }
        }

        let next_state = if all_released {
            VaultState::Completed
        } else {
            VaultState::Active
        };
        save_state(&env, next_state);
        // Builder made progress — reset the abandonment clock for the next
        // milestone. Harmless once Completed.
        env.storage()
            .instance()
            .set(&DataKey::LastActivity, &env.ledger().timestamp());

        let token_client = token::Client::new(&env, &info.token);

        if all_released {
            info.bond_returned = true;
            write_attestation(&env, &mut info, Outcome::Completed);
        }
        save_info(&env, &info);

        token_client.transfer(&env.current_contract_address(), &info.creator, &tranche);

        if all_released && info.bond_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &info.creator,
                &info.bond_amount,
            );
            env.events().publish(
                (symbol_short!("BOND"), symbol_short!("RETURNED")),
                (info.project_id, info.bond_amount),
            );
        }

        env.events().publish(
            (symbol_short!("MILESTN"), symbol_short!("RELEASE")),
            (
                info.project_id,
                milestone_id,
                tranche,
                info.released_total,
            ),
        );
    }

    /// Settle a milestone whose voting window closed below threshold.
    ///
    /// Permissionless and fail-closed: contributor inactivity fails the
    /// milestone rather than defaulting to paying the builder. The bond is
    /// forfeited and becomes claimable pro-rata alongside the remaining
    /// contributions.
    pub fn settle_lapsed_milestone(env: Env, milestone_id: u32) {
        extend_instance_ttl(&env);
        let state = sync_state(&env);
        if state != VaultState::Funded && state != VaultState::Active {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let mut info = load_info(&env);
        let index = Self::milestone_index(&env, &info, milestone_id);
        let mut milestone = info.milestones.get(index).unwrap();

        if milestone.released {
            panic_with_error!(&env, Error::MilestoneAlreadyReleased);
        }
        if milestone.failed {
            panic_with_error!(&env, Error::MilestoneFailed);
        }
        if milestone.vote_opens_at == 0 {
            panic_with_error!(&env, Error::VotingNotOpen);
        }
        if env.ledger().timestamp() < milestone.vote_opens_at + info.voting_window_secs {
            panic_with_error!(&env, Error::VotingWindowNotElapsed);
        }
        // A window that carried is a release waiting to happen, not a failure —
        // whoever wants it can still call release_milestone.
        if carried(&env, &milestone, info.raised_amount) {
            panic_with_error!(&env, Error::ThresholdMet);
        }

        milestone.failed = true;
        let approved_weight = milestone.approved_weight;
        info.milestones.set(index, milestone);

        write_attestation(&env, &mut info, Outcome::FailedWithForfeiture);
        save_info(&env, &info);
        save_state(&env, VaultState::Refunding);

        env.events().publish(
            (symbol_short!("MILESTN"), symbol_short!("FAILED")),
            (
                info.project_id,
                milestone_id,
                approved_weight,
                info.raised_amount,
            ),
        );
        env.events().publish(
            (symbol_short!("BOND"), symbol_short!("SLASHED")),
            (info.project_id, info.bond_amount),
        );
    }

    /// Reclaim an abandoned funded project for its contributors.
    ///
    /// Permissionless recovery. A funded vault advances only when the builder
    /// opens a milestone vote — something no one else can do — so a builder who
    /// opens none (a lost key, or spite) would otherwise strand contributor
    /// funds forever: every path to `Refunding` requires a vote to have been
    /// opened. After `BUILDER_STALL_WINDOW` of inactivity since funding, or since
    /// the last release, anyone may fail the project. The bond is forfeited,
    /// exactly as a lapsed milestone forfeits it, and contributors reclaim their
    /// principal through `claim_refund`.
    pub fn settle_stalled(env: Env) {
        extend_instance_ttl(&env);
        let state = sync_state(&env);
        if state != VaultState::Funded && state != VaultState::Active {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        let last_activity: u64 = env
            .storage()
            .instance()
            .get(&DataKey::LastActivity)
            .unwrap_or(0);
        if last_activity == 0
            || env.ledger().timestamp() < last_activity + BUILDER_STALL_WINDOW
        {
            panic_with_error!(&env, Error::NotStalled);
        }

        let mut info = load_info(&env);

        // If a milestone vote is open and still inside its window, the builder is
        // active — this is not abandonment. A window that has already elapsed is
        // settle_lapsed_milestone's job, not this one.
        for i in 0..info.milestones.len() {
            let m = info.milestones.get(i).unwrap();
            if !m.released
                && !m.failed
                && m.vote_opens_at != 0
                && env.ledger().timestamp() < m.vote_opens_at + info.voting_window_secs
            {
                panic_with_error!(&env, Error::VotingAlreadyOpen);
            }
        }

        // Nor is a milestone contributors carried: it is a release waiting to
        // happen that anyone can execute. Failing it would forfeit the bond of a
        // builder whose work was approved — and opening a vote does not reset the
        // stall clock, so a dissenting contributor could race the release.
        for i in 0..info.milestones.len() {
            let m = info.milestones.get(i).unwrap();
            if !m.released
                && !m.failed
                && m.vote_opens_at != 0
                && carried(&env, &m, info.raised_amount)
            {
                panic_with_error!(&env, Error::ThresholdMet);
            }
        }

        // Fail the first still-open milestone. A vault with every milestone
        // released is Completed, not Funded/Active, so one always exists here.
        for i in 0..info.milestones.len() {
            let mut m = info.milestones.get(i).unwrap();
            if !m.released && !m.failed {
                m.failed = true;
                info.milestones.set(i, m);
                break;
            }
        }

        // Move to Refunding before the external attestation call (CEI). No funds
        // move here — refunds are pulled separately via claim_refund — but the
        // ordering keeps a re-entrant registry from finding a still-fundable
        // vault.
        save_state(&env, VaultState::Refunding);
        write_attestation(&env, &mut info, Outcome::FailedWithForfeiture);
        save_info(&env, &info);

        env.events().publish(
            (symbol_short!("VAULT"), symbol_short!("STALLED")),
            (info.project_id, last_activity),
        );
        env.events().publish(
            (symbol_short!("BOND"), symbol_short!("SLASHED")),
            (info.project_id, info.bond_amount),
        );
    }

    // ── REFUNDS ────────────────────────────────────────────────────────────

    /// Claim a refund. Available when the project failed to fund, and when a
    /// milestone failed — in which case the claim includes a pro-rata share of
    /// the forfeited bond.
    pub fn claim_refund(env: Env, contributor: Address) {
        extend_instance_ttl(&env);
        let state = sync_state(&env);
        if state != VaultState::Failed && state != VaultState::Refunding {
            panic_with_error!(&env, Error::InvalidStatus);
        }

        contributor.require_auth();

        let mut info = load_info(&env);
        let bal_key = DataKey::ContributorBalance(contributor.clone());
        let contribution: i128 = env.storage().persistent().get(&bal_key).unwrap_or(0);
        if contribution <= 0 {
            panic_with_error!(&env, Error::NoFundsToRefund);
        }

        env.storage().persistent().remove(&bal_key);

        info.unclaimed_contributions = info
            .unclaimed_contributions
            .checked_sub(contribution)
            .unwrap();
        let is_last_claimant = info.unclaimed_contributions == 0;

        let mut refund_total = if state == VaultState::Failed {
            // Goal never met, nothing was ever released: principal back, whole.
            contribution
        } else {
            // Whatever tranches were already released are gone to the builder;
            // contributors share what is left plus the forfeited bond.
            let remaining = info
                .raised_amount
                .checked_sub(info.released_total)
                .unwrap();

            let contrib_share = contribution
                .checked_mul(remaining)
                .unwrap()
                .checked_div(info.raised_amount)
                .unwrap();

            let bond_share = contribution
                .checked_mul(info.bond_amount)
                .unwrap()
                .checked_div(info.raised_amount)
                .unwrap();

            contrib_share.checked_add(bond_share).unwrap()
        };

        let token_client = token::Client::new(&env, &info.token);

        // Pro-rata division truncates, so each claim leaves a stroop or two
        // behind. Left alone that dust accumulates in the vault with no
        // entrypoint able to reclaim it, so the last claimant sweeps whatever
        // remains.
        //
        // Only in Refunding. In Failed the vault is still holding the builder's
        // bond, which is theirs and is claimed separately through return_bond —
        // sweeping there would hand a contributor the builder's stake.
        if is_last_claimant && state == VaultState::Refunding {
            let vault_balance = token_client.balance(&env.current_contract_address());
            if vault_balance > refund_total {
                refund_total = vault_balance;
            }
            info.bond_returned = true;
        }

        save_info(&env, &info);

        token_client.transfer(
            &env.current_contract_address(),
            &contributor,
            &refund_total,
        );

        env.events().publish(
            (symbol_short!("DEPOSIT"), symbol_short!("REFUND")),
            (info.project_id, contributor, refund_total),
        );
    }

    // ── QUERIES ────────────────────────────────────────────────────────────

    /// Current lifecycle state. A true read: writes nothing, moves nothing.
    pub fn get_state(env: Env) -> VaultState {
        effective_state(&env)
    }

    pub fn get_info(env: Env) -> ProjectInfo {
        load_info(&env)
    }

    pub fn get_balance(env: Env, contributor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::ContributorBalance(contributor))
            .unwrap_or(0)
    }

    /// A page of contributors.
    ///
    /// Paged rather than whole: a popular project accumulates contributors
    /// without limit, and a call that materialises all of them eventually
    /// exceeds the resource budget and starts failing — at which point the
    /// entrypoint is useless exactly when the project is most active.
    /// `limit` is clamped to MAX_PAGE.
    pub fn get_contributors(env: Env, offset: u32, limit: u32) -> Vec<Address> {
        let all: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Contributors)
            .unwrap_or_else(|| Vec::new(&env));

        let capped = if limit == 0 || limit > MAX_PAGE { MAX_PAGE } else { limit };
        let mut page = Vec::new(&env);
        let mut i = offset;
        while i < all.len() && page.len() < capped {
            page.push_back(all.get(i).unwrap());
            i += 1;
        }
        page
    }

    /// Total contributors, so a caller can page without guessing.
    pub fn contributor_count(env: Env) -> u32 {
        let all: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Contributors)
            .unwrap_or_else(|| Vec::new(&env));
        all.len()
    }

    /// The voting weight this wallet would carry, after the 20% cap.
    pub fn get_voting_weight(env: Env, contributor: Address) -> i128 {
        let info = load_info(&env);
        let contribution = Self::get_balance(env, contributor);
        if contribution <= 0 {
            return 0;
        }
        effective_weight(contribution, info.raised_amount)
    }

    pub fn has_voted(env: Env, milestone_id: u32, contributor: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Vote(milestone_id, contributor))
    }

    /// Weight behind a milestone, the weight a release needs, and whether the
    /// window is still open. A release also needs `get_milestone_wallets`'
    /// distinct approvals.
    pub fn get_milestone_vote(env: Env, milestone_id: u32) -> (i128, i128, bool) {
        let info = load_info(&env);
        let index = Self::milestone_index(&env, &info, milestone_id);
        let milestone = info.milestones.get(index).unwrap();

        let required = required_weight(total_weight(&env, info.raised_amount));

        let open = milestone.vote_opens_at != 0
            && env.ledger().timestamp() < milestone.vote_opens_at + info.voting_window_secs;

        (milestone.approved_weight, required, open)
    }

    /// Distinct wallets that have approved a milestone, and how many a release
    /// needs: three, or every contributor when there are fewer.
    pub fn get_milestone_wallets(env: Env, milestone_id: u32) -> (u32, u32) {
        let info = load_info(&env);
        // Reject an unknown id rather than report zero approvals for it.
        Self::milestone_index(&env, &info, milestone_id);
        (approvals(&env, milestone_id), required_wallets(&env))
    }

    fn milestone_index(env: &Env, info: &ProjectInfo, milestone_id: u32) -> u32 {
        for i in 0..info.milestones.len() {
            if info.milestones.get(i).unwrap().id == milestone_id {
                return i;
            }
        }
        panic_with_error!(env, Error::MilestoneNotFound)
    }
}


#[cfg(test)]
mod test;
