//! TEMPORARY design-validation harness for the proposed revenue vault.
//! Test-only; delete after the design review. Not part of the shipped contract.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RevError {
    InvalidConfiguration = 6,
    AlreadyInitialized   = 10,
    NotInitialized       = 11,
    AlreadyVoted         = 18,
    NotAShareholder      = 19,
    NothingToDistribute  = 25,
    NothingToClaim       = 26,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days
const BPS: i128 = 10_000;
/// A close needs more than 50% of the shares behind it.
const CLOSE_THRESHOLD_BPS: u32 = 5_000;
/// Bounds the close loop and keeps the roster inside one instance entry.
const MAX_SHAREHOLDERS: u32 = 10;

#[contracttype]
#[derive(Clone, Debug)]
pub struct Shareholder {
    pub address:   Address,
    pub share_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RevenueInfo {
    pub owner:        Address,
    pub token:        Address,
    pub shareholders: Vec<Shareholder>,
    pub cycle:        u32,
    pub pot:          i128,
    pub total_owed:   i128,
    pub approved_bps: u32,
    pub required_bps: u32,
}

#[contracttype]
pub enum RevKey {
    Owner,
    Token,
    Shareholders,
    /// Yes-votes for the CURRENT cycle. Cleared on close and on roster change.
    Voters,
    Cycle,
    TotalOwed,
    Owed(Address),
}

// ── STORAGE ────────────────────────────────────────────────────────────────

fn load_owner(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&RevKey::Owner)
        .unwrap_or_else(|| panic_with_error!(env, RevError::NotInitialized))
}

fn load_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&RevKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, RevError::NotInitialized))
}

fn load_shareholders(env: &Env) -> Vec<Shareholder> {
    env.storage()
        .instance()
        .get(&RevKey::Shareholders)
        .unwrap_or_else(|| panic_with_error!(env, RevError::NotInitialized))
}

fn load_voters(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&RevKey::Voters)
        .unwrap_or_else(|| Vec::new(env))
}

fn load_total_owed(env: &Env) -> i128 {
    env.storage().instance().get(&RevKey::TotalOwed).unwrap_or(0)
}

fn load_cycle(env: &Env) -> u32 {
    env.storage().instance().get(&RevKey::Cycle).unwrap_or(0)
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

fn require_owner(env: &Env) -> Address {
    let owner = load_owner(env);
    owner.require_auth();
    owner
}

// ── ARITHMETIC ─────────────────────────────────────────────────────────────

/// What a close would distribute right now: the contract's balance minus money
/// already crystallised to somebody. Without the subtraction an unclaimed
/// credit would be handed out a second time on the next close.
fn pot(env: &Env, token_address: &Address) -> i128 {
    let balance = token::Client::new(env, token_address).balance(&env.current_contract_address());
    balance.checked_sub(load_total_owed(env)).unwrap()
}

fn share_of(holders: &Vec<Shareholder>, who: &Address) -> u32 {
    for i in 0..holders.len() {
        let h = holders.get(i).unwrap();
        if &h.address == who {
            return h.share_bps;
        }
    }
    0
}

fn approved_bps(env: &Env, holders: &Vec<Shareholder>) -> u32 {
    let voters = load_voters(env);
    let mut total: u32 = 0;
    for i in 0..voters.len() {
        total += share_of(holders, &voters.get(i).unwrap());
    }
    total
}

fn validate_roster(env: &Env, holders: &Vec<Shareholder>) {
    if holders.is_empty() || holders.len() > MAX_SHAREHOLDERS {
        panic_with_error!(env, RevError::InvalidConfiguration);
    }
    let mut sum: u32 = 0;
    for i in 0..holders.len() {
        let h = holders.get(i).unwrap();
        if h.share_bps == 0 {
            panic_with_error!(env, RevError::InvalidConfiguration);
        }
        for j in 0..i {
            if holders.get(j).unwrap().address == h.address {
                panic_with_error!(env, RevError::InvalidConfiguration);
            }
        }
        sum += h.share_bps;
    }
    if sum != BPS as u32 {
        panic_with_error!(env, RevError::InvalidConfiguration);
    }
}

// ── CONTRACT ───────────────────────────────────────────────────────────────

#[contract]
pub struct BlkfndrRevenue;

#[contractimpl]
impl BlkfndrRevenue {
    pub fn initialize(env: Env, owner: Address, token: Address, shareholders: Vec<Shareholder>) {
        if env.storage().instance().has(&RevKey::Owner) {
            panic_with_error!(&env, RevError::AlreadyInitialized);
        }
        owner.require_auth();
        validate_roster(&env, &shareholders);

        let storage = env.storage().instance();
        storage.set(&RevKey::Owner, &owner);
        storage.set(&RevKey::Token, &token);
        storage.set(&RevKey::Shareholders, &shareholders);
        storage.set(&RevKey::Voters, &Vec::<Address>::new(&env));
        storage.set(&RevKey::Cycle, &1u32);
        storage.set(&RevKey::TotalOwed, &0i128);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("REVENUE"), symbol_short!("INIT")),
            (owner, token),
        );
    }

    /// Vote to close the current cycle. Crossing the threshold closes it in the
    /// same call — no window, no timer, no separate close step.
    pub fn approve_close(env: Env, shareholder: Address) {
        extend_instance_ttl(&env);
        shareholder.require_auth();

        let holders = load_shareholders(&env);
        let weight = share_of(&holders, &shareholder);
        if weight == 0 {
            panic_with_error!(&env, RevError::NotAShareholder);
        }

        let mut voters = load_voters(&env);
        if voters.first_index_of(&shareholder).is_some() {
            panic_with_error!(&env, RevError::AlreadyVoted);
        }
        voters.push_back(shareholder.clone());
        env.storage().instance().set(&RevKey::Voters, &voters);

        let tally = approved_bps(&env, &holders);
        let cycle = load_cycle(&env);

        env.events().publish(
            (symbol_short!("REVENUE"), symbol_short!("VOTE")),
            (cycle, shareholder, weight, tally),
        );

        if tally > CLOSE_THRESHOLD_BPS {
            Self::close(&env, &holders, cycle);
        }
    }

    /// Crystallise the pot into per-address credits. Internal: reachable only
    /// through a vote that crossed the threshold.
    fn close(env: &Env, holders: &Vec<Shareholder>, cycle: u32) {
        let token_address = load_token(env);
        let available = pot(env, &token_address);
        if available <= 0 {
            panic_with_error!(env, RevError::NothingToDistribute);
        }

        let mut distributed: i128 = 0;
        for i in 0..holders.len() {
            let h = holders.get(i).unwrap();
            // Truncating division on a non-negative pot floors every share, so
            // the sum can never exceed what the vault holds.
            let amount = available
                .checked_mul(h.share_bps as i128)
                .unwrap()
                .checked_div(BPS)
                .unwrap();
            if amount <= 0 {
                continue;
            }
            let key = RevKey::Owed(h.address.clone());
            let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&key, &current.checked_add(amount).unwrap());
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
            distributed = distributed.checked_add(amount).unwrap();
        }

        let storage = env.storage().instance();
        storage.set(
            &RevKey::TotalOwed,
            &load_total_owed(env).checked_add(distributed).unwrap(),
        );
        // Fresh cycle: votes reset, and the truncation remainder stays in the
        // pot as the opening balance of the next cycle.
        storage.set(&RevKey::Voters, &Vec::<Address>::new(env));
        storage.set(&RevKey::Cycle, &cycle.checked_add(1).unwrap());

        env.events().publish(
            (symbol_short!("REVENUE"), symbol_short!("CLOSED")),
            (cycle, available, distributed, available - distributed),
        );
    }

    /// Pull everything crystallised to this address, from any cycle.
    pub fn claim(env: Env, shareholder: Address) {
        extend_instance_ttl(&env);
        shareholder.require_auth();

        let key = RevKey::Owed(shareholder.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount <= 0 {
            panic_with_error!(&env, RevError::NothingToClaim);
        }

        // Credit is cleared before the token is called. The token is external
        // code; it must never observe a state that still owes this address.
        env.storage().persistent().remove(&key);
        env.storage().instance().set(
            &RevKey::TotalOwed,
            &load_total_owed(&env).checked_sub(amount).unwrap(),
        );

        let token_address = load_token(&env);
        token::Client::new(&env, &token_address).transfer(
            &env.current_contract_address(),
            &shareholder,
            &amount,
        );

        env.events().publish(
            (symbol_short!("REVENUE"), symbol_short!("CLAIM")),
            (shareholder, amount),
        );
    }

    /// Replace the roster. Owner only, and never touches crystallised credit.
    pub fn set_shareholders(env: Env, shareholders: Vec<Shareholder>) {
        extend_instance_ttl(&env);
        let owner = require_owner(&env);
        validate_roster(&env, &shareholders);

        let storage = env.storage().instance();
        storage.set(&RevKey::Shareholders, &shareholders);
        // Votes were cast under the old weights. Carrying them over is the bug
        // blkfndr-approval shipped: a roster edit silently re-scored a live
        // vote. Clear them.
        storage.set(&RevKey::Voters, &Vec::<Address>::new(&env));

        env.events().publish(
            (symbol_short!("REVENUE"), symbol_short!("ROSTER")),
            (owner, shareholders.len()),
        );
    }

    pub fn transfer_ownership(env: Env, new_owner: Address) {
        extend_instance_ttl(&env);
        require_owner(&env);
        env.storage().instance().set(&RevKey::Owner, &new_owner);
        env.events().publish(
            (symbol_short!("REVENUE"), symbol_short!("OWNER_TX")),
            new_owner,
        );
    }

    // ── QUERIES (true reads: write nothing, move nothing) ──────────────────

    pub fn get_info(env: Env) -> RevenueInfo {
        let holders = load_shareholders(&env);
        let token_address = load_token(&env);
        RevenueInfo {
            owner:        load_owner(&env),
            token:        token_address.clone(),
            approved_bps: approved_bps(&env, &holders),
            required_bps: CLOSE_THRESHOLD_BPS + 1,
            shareholders: holders,
            cycle:        load_cycle(&env),
            pot:          pot(&env, &token_address),
            total_owed:   load_total_owed(&env),
        }
    }

    pub fn get_owed(env: Env, shareholder: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&RevKey::Owed(shareholder))
            .unwrap_or(0)
    }

    pub fn has_voted(env: Env, shareholder: Address) -> bool {
        load_voters(&env).first_index_of(&shareholder).is_some()
    }
}

// ── TESTS ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod proto_test {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{StellarAssetClient, TokenClient},
    };

    const UNIT: i128 = 10_000_000; // 7 decimals, as Stellar assets carry
    const FEE: i128 = 10 * UNIT; // the live flat platform fee, 100_000_000 stroops

    struct Setup {
        env: Env,
        rev: BlkfndrRevenueClient<'static>,
        rev_address: Address,
        token: TokenClient<'static>,
        minter: StellarAssetClient<'static>,
        owner: Address,
        a: Address,
        b: Address,
        c: Address,
        outsider: Address,
    }

    fn holders(env: &Env, entries: &[(&Address, u32)]) -> Vec<Shareholder> {
        let mut v = Vec::new(env);
        for (addr, bps) in entries {
            v.push_back(Shareholder {
                address:   (*addr).clone(),
                share_bps: *bps,
            });
        }
        v
    }

    fn setup_with(splits: &[u32]) -> Setup {
        let env = Env::default();
        env.mock_all_auths();

        let owner = Address::generate(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        let outsider = Address::generate(&env);

        let issuer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(issuer);
        let token = TokenClient::new(&env, &asset.address());
        let minter = StellarAssetClient::new(&env, &asset.address());

        let rev_address = env.register(BlkfndrRevenue, ());
        let rev = BlkfndrRevenueClient::new(&env, &rev_address);

        let all = [a.clone(), b.clone(), c.clone()];
        let mut roster = Vec::new(&env);
        for (i, bps) in splits.iter().enumerate() {
            roster.push_back(Shareholder {
                address:   all[i].clone(),
                share_bps: *bps,
            });
        }
        rev.initialize(&owner, &asset.address(), &roster);

        Setup { env, rev, rev_address, token, minter, owner, a, b, c, outsider }
    }

    /// Three shareholders, 50 / 30 / 20.
    fn setup3() -> Setup {
        setup_with(&[5_000, 3_000, 2_000])
    }

    /// Two shareholders, 50 / 50.
    fn setup2() -> Setup {
        setup_with(&[5_000, 5_000])
    }

    /// Pay a platform fee exactly the way blkfndr-vault::initialize does:
    /// a plain token transfer to the fee wallet address. No deposit entrypoint.
    fn pay_fees(s: &Setup, count: i128) {
        let payer = Address::generate(&s.env);
        s.minter.mint(&payer, &(FEE * count));
        s.token.transfer(&payer, &s.rev_address, &(FEE * count));
    }

    fn pay_raw(s: &Setup, amount: i128) {
        let payer = Address::generate(&s.env);
        s.minter.mint(&payer, &amount);
        s.token.transfer(&payer, &s.rev_address, &amount);
    }

    // ── Fees arrive with no entrypoint at all ──────────────────────────────

    #[test]
    fn fees_accrue_by_plain_transfer_with_no_deposit_entrypoint() {
        let s = setup3();
        assert_eq!(s.rev.get_info().pot, 0);

        pay_fees(&s, 3);

        // Nothing was called on the revenue vault. The pot is simply its balance.
        assert_eq!(s.rev.get_info().pot, 3 * FEE);
        assert_eq!(s.token.balance(&s.rev_address), 3 * FEE);
    }

    // ── Threshold ──────────────────────────────────────────────────────────

    #[test]
    fn a_half_share_cannot_close_alone() {
        let s = setup3();
        pay_fees(&s, 1);

        s.rev.approve_close(&s.a); // exactly 5_000 bps — not MORE than half
        let info = s.rev.get_info();
        assert_eq!(info.approved_bps, 5_000);
        assert_eq!(info.required_bps, 5_001);
        assert_eq!(info.cycle, 1, "cycle must still be open");
        assert_eq!(info.pot, FEE, "nothing crystallised");
        assert_eq!(s.rev.get_owed(&s.a), 0);
    }

    #[test]
    fn crossing_the_threshold_closes_in_the_same_call() {
        let s = setup3();
        pay_fees(&s, 1);

        s.rev.approve_close(&s.a); // 5_000
        s.rev.approve_close(&s.c); // +2_000 = 7_000 > 5_000

        let info = s.rev.get_info();
        assert_eq!(info.cycle, 2, "closed and rolled to the next cycle");
        assert_eq!(info.approved_bps, 0, "votes reset");
        assert_eq!(info.pot, 0);

        // 50 / 30 / 20 of 100_000_000 stroops.
        assert_eq!(s.rev.get_owed(&s.a), 50_000_000);
        assert_eq!(s.rev.get_owed(&s.b), 30_000_000);
        assert_eq!(s.rev.get_owed(&s.c), 20_000_000);
        assert_eq!(info.total_owed, FEE);

        // A shareholder who never voted is still paid their share.
        assert!(!s.rev.has_voted(&s.b));
    }

    #[test]
    fn fifty_fifty_partners_must_agree() {
        let s = setup2();
        pay_fees(&s, 1);

        s.rev.approve_close(&s.a);
        assert_eq!(s.rev.get_info().cycle, 1, "one half is not a majority");

        s.rev.approve_close(&s.b);
        assert_eq!(s.rev.get_info().cycle, 2);
        assert_eq!(s.rev.get_owed(&s.a), FEE / 2);
        assert_eq!(s.rev.get_owed(&s.b), FEE / 2);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #19)")] // NotAShareholder
    fn outsiders_have_no_vote() {
        let s = setup3();
        pay_fees(&s, 1);
        s.rev.approve_close(&s.outsider);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #19)")]
    fn the_owner_is_not_automatically_a_shareholder() {
        let s = setup3();
        pay_fees(&s, 1);
        s.rev.approve_close(&s.owner);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #18)")] // AlreadyVoted
    fn a_shareholder_votes_once_per_cycle() {
        let s = setup3();
        pay_fees(&s, 1);
        s.rev.approve_close(&s.b);
        s.rev.approve_close(&s.b);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #25)")] // NothingToDistribute
    fn an_empty_cycle_cannot_be_closed() {
        let s = setup3();
        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.c); // crosses threshold on an empty pot
    }

    // ── The money ──────────────────────────────────────────────────────────

    #[test]
    fn claims_conserve_every_stroop_that_came_in() {
        let s = setup3();
        pay_fees(&s, 7);
        let paid_in = 7 * FEE;

        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.b);

        s.rev.claim(&s.a);
        s.rev.claim(&s.b);
        s.rev.claim(&s.c);

        let out = s.token.balance(&s.a) + s.token.balance(&s.b) + s.token.balance(&s.c);
        let left = s.token.balance(&s.rev_address);
        assert_eq!(out + left, paid_in, "no stroop created or destroyed");
        assert_eq!(s.rev.get_info().total_owed, 0);
        assert_eq!(left, 0, "50/30/20 of this pot divides exactly");
    }

    #[test]
    fn truncation_remainder_rolls_into_the_next_cycle() {
        // 3334 / 3333 / 3333 over a pot that does not divide evenly.
        let s = setup_with(&[3_334, 3_333, 3_333]);
        let odd_pot: i128 = 100_000_007;
        pay_raw(&s, odd_pot);

        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.b);

        let owed_total = s.rev.get_owed(&s.a) + s.rev.get_owed(&s.b) + s.rev.get_owed(&s.c);
        let remainder = odd_pot - owed_total;

        // Every share floors, so the vault never promises more than it holds,
        // and the shortfall is under one stroop per shareholder.
        assert!(owed_total <= odd_pot, "cannot over-promise");
        assert!(remainder >= 0 && remainder < 3, "remainder must be < n");

        // The leftover is not stranded: it is the opening balance of cycle 2.
        assert_eq!(s.rev.get_info().pot, remainder);
        assert_eq!(s.rev.get_info().total_owed, owed_total);
        assert_eq!(s.rev.get_info().cycle, 2);
    }

    #[test]
    fn unclaimed_credit_is_never_distributed_twice() {
        let s = setup3();
        pay_fees(&s, 1);

        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.b); // cycle 1 closes, nobody claims

        assert_eq!(s.rev.get_info().pot, 0, "balance is all spoken for");
        assert_eq!(s.token.balance(&s.rev_address), FEE);

        pay_fees(&s, 1); // a second fee arrives

        let info = s.rev.get_info();
        assert_eq!(info.pot, FEE, "only the NEW fee is distributable");
        assert_eq!(s.token.balance(&s.rev_address), 2 * FEE);

        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.b);

        // Two cycles of the same fee: each shareholder is owed exactly double.
        assert_eq!(s.rev.get_owed(&s.a), 2 * 50_000_000);
        assert_eq!(s.rev.get_owed(&s.b), 2 * 30_000_000);
        assert_eq!(s.rev.get_owed(&s.c), 2 * 20_000_000);
        assert_eq!(s.rev.get_info().total_owed, 2 * FEE);

        s.rev.claim(&s.a);
        s.rev.claim(&s.b);
        s.rev.claim(&s.c);
        assert_eq!(s.token.balance(&s.rev_address), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #26)")] // NothingToClaim
    fn claiming_twice_pays_once() {
        let s = setup3();
        pay_fees(&s, 1);
        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.b);

        s.rev.claim(&s.a);
        assert_eq!(s.token.balance(&s.a), 50_000_000);
        s.rev.claim(&s.a);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #26)")]
    fn an_outsider_has_nothing_to_claim() {
        let s = setup3();
        pay_fees(&s, 1);
        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.b);
        s.rev.claim(&s.outsider);
    }

    // ── Roster changes ─────────────────────────────────────────────────────

    #[test]
    fn a_roster_change_clears_the_live_vote() {
        let s = setup3();
        pay_fees(&s, 1);

        s.rev.approve_close(&s.a); // 5_000 banked
        assert_eq!(s.rev.get_info().approved_bps, 5_000);

        // Owner re-weights. The old vote was cast under the old weights.
        let new_roster = holders(&s.env, &[(&s.a, 8_000), (&s.b, 2_000)]);
        s.rev.set_shareholders(&new_roster);

        let info = s.rev.get_info();
        assert_eq!(info.approved_bps, 0, "stale votes must not be re-scored");
        assert!(!s.rev.has_voted(&s.a));
        assert_eq!(info.cycle, 1, "no close happened");
        assert_eq!(info.pot, FEE);
    }

    #[test]
    fn a_removed_shareholder_keeps_what_was_already_crystallised() {
        let s = setup3();
        pay_fees(&s, 1);

        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.b);
        assert_eq!(s.rev.get_owed(&s.c), 20_000_000);

        // c is dropped from the roster before claiming.
        let new_roster = holders(&s.env, &[(&s.a, 6_000), (&s.b, 4_000)]);
        s.rev.set_shareholders(&new_roster);

        assert_eq!(s.rev.get_owed(&s.c), 20_000_000, "earned is earned");
        s.rev.claim(&s.c);
        assert_eq!(s.token.balance(&s.c), 20_000_000);
    }

    #[test]
    fn a_new_shareholder_gets_no_claim_on_past_cycles() {
        let s = setup3();
        pay_fees(&s, 1);
        s.rev.approve_close(&s.a);
        s.rev.approve_close(&s.b); // cycle 1 crystallised without the outsider

        let new_roster = holders(
            &s.env,
            &[(&s.a, 4_000), (&s.b, 3_000), (&s.c, 2_000), (&s.outsider, 1_000)],
        );
        s.rev.set_shareholders(&new_roster);

        assert_eq!(s.rev.get_owed(&s.outsider), 0, "no retroactive share");
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")] // InvalidConfiguration
    fn shares_must_sum_to_one_whole() {
        let s = setup3();
        s.rev
            .set_shareholders(&holders(&s.env, &[(&s.a, 5_000), (&s.b, 4_000)]));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn a_duplicated_address_is_rejected() {
        let s = setup3();
        s.rev
            .set_shareholders(&holders(&s.env, &[(&s.a, 5_000), (&s.a, 5_000)]));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn a_zero_share_is_rejected() {
        let s = setup3();
        s.rev
            .set_shareholders(&holders(&s.env, &[(&s.a, 10_000), (&s.b, 0)]));
    }

    // ── Wind-down ──────────────────────────────────────────────────────────

    #[test]
    fn a_sole_shareholder_drains_the_vault_exactly() {
        let s = setup3();
        let odd: i128 = 123_456_789;
        pay_raw(&s, odd);

        // 10_000 bps of the pot floors to the whole pot: no remainder, no dust.
        s.rev.set_shareholders(&holders(&s.env, &[(&s.a, 10_000)]));
        s.rev.approve_close(&s.a);
        s.rev.claim(&s.a);

        assert_eq!(s.token.balance(&s.rev_address), 0, "drains to the stroop");
        assert_eq!(s.token.balance(&s.a), odd);
    }

    // ── Reads stay reads ───────────────────────────────────────────────────

    #[test]
    fn queries_move_no_money_and_change_no_state() {
        let s = setup3();
        pay_fees(&s, 2);
        s.rev.approve_close(&s.a);

        let before = s.token.balance(&s.rev_address);
        let cycle_before = s.rev.get_info().cycle;
        let bps_before = s.rev.get_info().approved_bps;

        for _ in 0..3 {
            s.rev.get_info();
            s.rev.get_owed(&s.a);
            s.rev.has_voted(&s.b);
        }

        assert_eq!(s.token.balance(&s.rev_address), before);
        assert_eq!(s.rev.get_info().cycle, cycle_before);
        assert_eq!(s.rev.get_info().approved_bps, bps_before);
    }

    // ── Why the funding vault's 20% cap must NOT be copied ──────────────────

    /// blkfndr-vault caps one wallet at 20% of the raise and needs >50% to
    /// release. Right for a large, adversarial contributor set. Reproduced
    /// verbatim on a 2-5 person roster it locks the vault forever.
    #[test]
    fn the_funding_vaults_weight_cap_would_deadlock_this_roster() {
        // The exact arithmetic from blkfndr-vault::weight_cap / threshold_met.
        fn capped(share: i128, total: i128) -> i128 {
            let cap = total * 2_000 / 10_000; // WEIGHT_CAP_BPS
            if share < cap { share } else { cap }
        }
        fn met(weight: i128, total: i128) -> bool {
            weight * 10_000 > total * 5_000 // RELEASE_THRESHOLD_BPS
        }

        let total = 10_000i128;

        // Two partners, 50/50, both voting: capped to 20% each.
        let two = capped(5_000, total) + capped(5_000, total);
        assert_eq!(two, 4_000);
        assert!(!met(two, total), "a 2-person vault could NEVER close a cycle");

        // Three partners, all voting: exactly 60%, so unanimity becomes
        // mandatory and any single absence is a permanent freeze.
        let three = capped(4_000, total) + capped(3_500, total) + capped(2_500, total);
        assert_eq!(three, 6_000);
        assert!(met(three, total));
        let three_minus_one = capped(4_000, total) + capped(3_500, total);
        assert!(!met(three_minus_one, total), "any absence freezes it");

        // Uncapped share weighting, which is what this design uses, behaves.
        assert!(5_000 + 2_000 > 5_000, "50% + 20% closes the cycle");
    }
}

// ── END TO END AGAINST THE REAL, UNMODIFIED FUNDING VAULT ──────────────────
//
// The claim under test: pointing the factory's fee wallet at a revenue vault
// CONTRACT requires no change to blkfndr-vault or blkfndr-factory, because the
// fee is a plain token transfer to an Address and Address covers contracts.

#[cfg(test)]
mod e2e {
    use super::*;
    use crate::{BlkfndrVault, BlkfndrVaultClient, MilestoneInput, VaultInitConfig};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{StellarAssetClient, TokenClient},
        String,
    };

    const UNIT: i128 = 10_000_000;
    const GOAL: i128 = 300 * UNIT;
    const BOND: i128 = 15 * UNIT;
    const PLATFORM_FEE: i128 = 10 * UNIT; // get_platform_fee = 100_000_000 stroops

    #[contract]
    pub struct KycAlwaysYes;

    #[contractimpl]
    impl KycAlwaysYes {
        pub fn is_kyc_approved(_env: Env, _address: Address) -> bool {
            true
        }
    }

    #[test]
    fn the_real_vault_pays_its_flat_fee_into_a_revenue_vault_contract() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let issuer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(issuer);
        let token = TokenClient::new(&env, &asset.address());
        let minter = StellarAssetClient::new(&env, &asset.address());

        // Three platform shareholders, 50 / 30 / 20.
        let owner = Address::generate(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);

        let revenue_address = env.register(BlkfndrRevenue, ());
        let revenue = BlkfndrRevenueClient::new(&env, &revenue_address);
        let mut roster = Vec::new(&env);
        for (addr, bps) in [(&a, 5_000u32), (&b, 3_000), (&c, 2_000)] {
            roster.push_back(Shareholder { address: addr.clone(), share_bps: bps });
        }
        revenue.initialize(&owner, &asset.address(), &roster);

        let identity = env.register(KycAlwaysYes, ());
        let factory = Address::generate(&env);
        let attestation = Address::generate(&env);

        // Two builders create two projects. THE FEE WALLET IS THE REVENUE
        // VAULT CONTRACT — the only thing that changed is one Address.
        for project_id in 1..=2u64 {
            let builder = Address::generate(&env);
            minter.mint(&builder, &(BOND + PLATFORM_FEE));

            let vault_address = env.register(BlkfndrVault, ());
            let vault = BlkfndrVaultClient::new(&env, &vault_address);

            let mut milestones = Vec::new(&env);
            milestones.push_back(MilestoneInput { id: 1, amount: GOAL / 3 });
            milestones.push_back(MilestoneInput { id: 2, amount: GOAL / 3 });
            milestones.push_back(MilestoneInput {
                id:     3,
                amount: GOAL - 2 * (GOAL / 3),
            });

            vault.initialize(&VaultInitConfig {
                project_id,
                creator: builder.clone(),
                token: asset.address(),
                goal: GOAL,
                deadline: env.ledger().timestamp() + 30 * 24 * 60 * 60,
                bond_amount: BOND,
                identity_registry: identity.clone(),
                attestation_registry: attestation.clone(),
                factory: factory.clone(),
                fee_wallet_address: revenue_address.clone(),
                platform_fee: PLATFORM_FEE,
                voting_window_secs: 7 * 24 * 60 * 60,
                min_contribution: 5 * UNIT,
                milestones,
                metadata_cid: String::from_str(&env, "bafytestcid"),
            });

            assert_eq!(token.balance(&builder), 0, "builder paid bond and fee");
        }

        // Two flat fees landed in the revenue vault with no call made to it.
        assert_eq!(token.balance(&revenue_address), 2 * PLATFORM_FEE);
        assert_eq!(revenue.get_info().pot, 2 * PLATFORM_FEE);
        assert_eq!(revenue.get_info().cycle, 1);

        // Shareholders close the cycle and take their shares.
        revenue.approve_close(&a); // 5_000 — not enough alone
        assert_eq!(revenue.get_info().cycle, 1);
        revenue.approve_close(&c); // +2_000 = 7_000 > 5_000

        assert_eq!(revenue.get_info().cycle, 2);
        assert_eq!(revenue.get_owed(&a), 100_000_000);
        assert_eq!(revenue.get_owed(&b), 60_000_000);
        assert_eq!(revenue.get_owed(&c), 40_000_000);

        revenue.claim(&a);
        revenue.claim(&b);
        revenue.claim(&c);

        assert_eq!(token.balance(&a), 100_000_000);
        assert_eq!(token.balance(&b), 60_000_000);
        assert_eq!(token.balance(&c), 40_000_000);
        assert_eq!(token.balance(&revenue_address), 0);
        assert_eq!(revenue.get_info().total_owed, 0);
    }

    /// The fee token is whatever the BUILDER chose in CreateVaultConfig, not a
    /// platform constant. A revenue vault pinned to one token can only ever
    /// distribute that token; fees paid in anything else are unreachable.
    #[test]
    fn a_fee_paid_in_a_foreign_token_never_joins_the_pot() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let issuer = Address::generate(&env);
        let canonical = env.register_stellar_asset_contract_v2(issuer.clone());
        let canonical_token = TokenClient::new(&env, &canonical.address());

        // A token of the builder's own choosing.
        let foreign = env.register_stellar_asset_contract_v2(issuer);
        let foreign_token = TokenClient::new(&env, &foreign.address());
        let foreign_minter = StellarAssetClient::new(&env, &foreign.address());

        let owner = Address::generate(&env);
        let a = Address::generate(&env);
        let revenue_address = env.register(BlkfndrRevenue, ());
        let revenue = BlkfndrRevenueClient::new(&env, &revenue_address);
        let mut roster = Vec::new(&env);
        roster.push_back(Shareholder { address: a.clone(), share_bps: 10_000 });
        // Pinned to the canonical asset.
        revenue.initialize(&owner, &canonical.address(), &roster);

        let identity = env.register(KycAlwaysYes, ());
        let builder = Address::generate(&env);
        foreign_minter.mint(&builder, &(BOND + PLATFORM_FEE));

        let vault_address = env.register(BlkfndrVault, ());
        let vault = BlkfndrVaultClient::new(&env, &vault_address);
        let mut milestones = Vec::new(&env);
        milestones.push_back(MilestoneInput { id: 1, amount: GOAL });

        vault.initialize(&VaultInitConfig {
            project_id: 7,
            creator: builder.clone(),
            token: foreign.address(), // builder-supplied
            goal: GOAL,
            deadline: env.ledger().timestamp() + 30 * 24 * 60 * 60,
            bond_amount: BOND,
            identity_registry: identity,
            attestation_registry: Address::generate(&env),
            factory: Address::generate(&env),
            fee_wallet_address: revenue_address.clone(),
            platform_fee: PLATFORM_FEE,
            voting_window_secs: 7 * 24 * 60 * 60,
            min_contribution: 5 * UNIT,
            milestones,
            metadata_cid: String::from_str(&env, "bafytestcid"),
        });

        // The fee really did land — in the wrong asset.
        assert_eq!(foreign_token.balance(&revenue_address), PLATFORM_FEE);
        assert_eq!(canonical_token.balance(&revenue_address), 0);

        // The revenue vault sees nothing to distribute, and cannot be tricked
        // into calling the builder's token contract.
        assert_eq!(revenue.get_info().pot, 0);
        assert_eq!(
            revenue.try_approve_close(&a).err(),
            Some(Ok(soroban_sdk::Error::from_contract_error(25))), // NothingToDistribute
        );
    }
}
