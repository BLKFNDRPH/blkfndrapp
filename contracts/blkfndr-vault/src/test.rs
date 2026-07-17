#[cfg(test)]
mod tests {
    use soroban_sdk::{
        contract, contractimpl, testutils::{Address as _, Ledger}, token::{StellarAssetClient, TokenClient}, Address, Env, Vec, String
    };
    use crate::{BlkfndrVault, BlkfndrVaultClient, Milestone, VaultState, VaultInitConfig};

    // MOCK CONSTRUCTS

    /// Configurable mock: reads "approve" flag from instance storage.
    /// Set to `true` for approve-all, `false` for reject-all.
    #[contract]
    pub struct MockApprovalModule;

    #[contractimpl]
    impl MockApprovalModule {
        pub fn is_approved(env: Env, _project_id: u64, _milestone_id: u32) -> bool {
            env.storage().instance().get::<_, bool>(&"approve").unwrap_or(true)
        }
        pub fn is_slash_approved(env: Env, _project_id: u64) -> bool {
            env.storage().instance().get::<_, bool>(&"approve").unwrap_or(true)
        }
    }

    #[contract]
    pub struct MockIdentityRegistry;

    #[contractimpl]
    impl MockIdentityRegistry {
        pub fn is_kyc_approved(env: Env, address: Address) -> bool {
            let creator = env.storage().instance().get::<_, Address>(&"creator").unwrap();
            creator == address
        }
    }

    // TEST SETUP
    struct Setup {
        env: Env,
        client: BlkfndrVaultClient<'static>,
        creator: Address,
        investor: Address,
        fee_wallet: Address,
        token_id: Address,
        token_client: TokenClient<'static>,
        token_admin_client: StellarAssetClient<'static>,
        approval_module: Address,
        identity_registry: Address,
        admin: Address,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(BlkfndrVault, ());
        let client = BlkfndrVaultClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let investor = Address::generate(&env);
        let fee_wallet = Address::generate(&env);
        let admin = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_admin_client = StellarAssetClient::new(&env, &token_contract.address());
        let token_client = TokenClient::new(&env, &token_contract.address());

        token_admin_client.mint(&creator, &100_000_000);
        token_admin_client.mint(&investor, &100_000_000);

        let approval_id = env.register(MockApprovalModule, ());
        let identity_id = env.register(MockIdentityRegistry, ());

        env.as_contract(&identity_id, || {
            env.storage().instance().set(&"creator", &creator);
        });

        Setup {
            env,
            client,
            creator,
            investor,
            fee_wallet,
            token_id: token_contract.address(),
            token_client,
            token_admin_client,
            approval_module: approval_id,
            identity_registry: identity_id,
            admin,
        }
    }

    /// Helper: create a standard VaultInitConfig for reuse across tests.
    fn make_config(s: &Setup, goal: i128, bond: i128, milestones: Vec<Milestone>) -> VaultInitConfig {
        VaultInitConfig {
            project_id: 1,
            creator: s.creator.clone(),
            token: s.token_id.clone(),
            goal,
            deadline: 1000,
            bond_amount: bond,
            approval_module: s.approval_module.clone(),
            identity_registry: s.identity_registry.clone(),
            fee_wallet_address: s.fee_wallet.clone(),
            fee_percentage: 300, // 3%
            milestones,
            metadata_cid: String::from_str(&s.env, "test_cid"),
            admin: s.admin.clone(),
        }
    }

    // EXISTING TESTS 
    #[test]
    fn test_initialize_and_validation() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 4_000_000, released: false });
        milestones.push_back(Milestone { id: 2, amount: 6_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        let info = s.client.get_info();
        assert_eq!(info.project_id, 1);
        assert_eq!(info.goal, 10_000_000i128);
        assert_eq!(s.client.get_state() as u32, VaultState::Raising as u32);
    }

    #[test]
    fn test_kyc_fails_initialization() {
        let s = setup();
        let unkyc_address = Address::generate(&s.env);

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let mut config = make_config(&s, 10_000_000, 2_000_000, milestones);
        config.creator = unkyc_address;

        let result = s.client.try_initialize(&config);
        assert!(result.is_err());
    }

    #[test]
    fn test_milestones_sum_invalid() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 5_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);

        let result = s.client.try_initialize(&config);
        assert!(result.is_err());
    }

    #[test]
    fn test_contribute_and_post_bond() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.post_bond();
        assert!(s.client.get_info().bond_posted);
        assert_eq!(s.token_client.balance(&s.client.address), 2_000_000);

        s.client.contribute(&s.investor, &10_000_000);
        assert_eq!(s.client.get_info().raised_amount, 10_000_000i128);
        assert_eq!(s.client.get_balance(&s.investor), 10_000_000i128);
        // Vault holds: bond(2M) + contribution(10M) + fee(300K) = 12.3M
        assert_eq!(s.token_client.balance(&s.client.address), 12_300_000);
    }

    #[test]
    fn test_milestone_releases() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 4_000_000, released: false });
        milestones.push_back(Milestone { id: 2, amount: 6_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.post_bond();
        s.client.contribute(&s.investor, &10_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();
        assert_eq!(s.client.get_state() as u32, VaultState::Funded as u32);

        // Release milestone 1: creator gets 4M (no fee deduction — FEE-1 fix)
        s.client.release_milestone(&1);
        assert_eq!(s.client.get_state() as u32, VaultState::Active as u32);
        // Creator started at 100M, posted 2M bond → 98M, now +4M = 102M
        assert_eq!(s.token_client.balance(&s.creator), 102_000_000);
        // Fee wallet gets milestone pro-rata fee on release (4M * 3% = 120,000)
        assert_eq!(s.token_client.balance(&s.fee_wallet), 120_000);

        // Release milestone 2: creator gets 6M + 2M bond returned = +8M → 110M
        s.client.release_milestone(&2);
        assert_eq!(s.client.get_state() as u32, VaultState::Completed as u32);
        assert_eq!(s.token_client.balance(&s.creator), 110_000_000);
    }

    #[test]
    fn test_expired_refund() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.contribute(&s.investor, &5_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();
        assert_eq!(s.client.get_state() as u32, VaultState::Failed as u32);

        // Failed state: full refund (contribution + fee)
        s.client.claim_refund(&s.investor);
        // Investor started at 100M, contributed 5M + 150K fee = 94.85M, refund = 5.15M → 100M
        assert_eq!(s.token_client.balance(&s.investor), 100_000_000);
    }

    #[test]
    fn test_slash_bond_refund() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.post_bond();
        s.client.contribute(&s.investor, &10_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();

        s.client.slash_bond();
        assert_eq!(s.client.get_state() as u32, VaultState::Refunding as u32);

        // Refunding with NO milestones released:
        // remaining_contributions = 10M - 0 = 10M
        // total_fees = 10M * 300 / 10000 = 300K
        // contrib_share = (10M * 10M) / 10M = 10M
        // fee_share = (10M * 300K) / 10M = 300K
        // slash_share = (10M * 2M) / 10M = 2M
        // total = 10M + 300K + 2M = 12.3M
        s.client.claim_refund(&s.investor);
        // Vault had 12.3M, investor gets all 12.3M back.
        // Investor started at 100M, paid 10.3M (10M + 300K fee), gets 12.3M → 102M
        assert_eq!(s.token_client.balance(&s.investor), 102_000_000);
    }

    // NEW TESTS 
    #[test]
    fn test_contribute_after_deadline() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        // Set time past deadline
        s.env.ledger().with_mut(|l| l.timestamp = 2000);

        let result = s.client.try_contribute(&s.investor, &5_000_000);
        assert!(result.is_err());
    }

    #[test]
    fn test_double_contribution() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.contribute(&s.investor, &3_000_000);
        assert_eq!(s.client.get_balance(&s.investor), 3_000_000i128);

        s.client.contribute(&s.investor, &4_000_000);
        // Balance should be cumulative
        assert_eq!(s.client.get_balance(&s.investor), 7_000_000i128);
        assert_eq!(s.client.get_info().raised_amount, 7_000_000i128);
    }

    #[test]
    fn test_release_unapproved_milestone() {
        let s = setup();

        // Register a rejecting approval module by setting flag to false
        let reject_approval_id = s.env.register(MockApprovalModule, ());
        s.env.as_contract(&reject_approval_id, || {
            s.env.storage().instance().set(&"approve", &false);
        });

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let mut config = make_config(&s, 10_000_000, 2_000_000, milestones);
        config.approval_module = reject_approval_id;

        s.client.initialize(&config);
        s.client.post_bond();
        s.client.contribute(&s.investor, &10_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();

        // Attempt to release — should fail because approval returns false
        let result = s.client.try_release_milestone(&1);
        assert!(result.is_err());
    }

    #[test]
    fn test_double_release_milestone() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 4_000_000, released: false });
        milestones.push_back(Milestone { id: 2, amount: 6_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);
        s.client.post_bond();
        s.client.contribute(&s.investor, &10_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();

        s.client.release_milestone(&1);

        // Double release should fail
        let result = s.client.try_release_milestone(&1);
        assert!(result.is_err());
    }

    #[test]
    fn test_claim_refund_no_contribution() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.contribute(&s.investor, &5_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();

        // Someone who never contributed tries to claim
        let stranger = Address::generate(&s.env);
        let result = s.client.try_claim_refund(&stranger);
        assert!(result.is_err());
    }

    #[test]
    fn test_slash_from_active_partial_release() {
        // BOND-2 regression test: slash after 1 of 2 milestones released.
        // Vault has already paid out some funds — refund must use remaining pool.
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 4_000_000, released: false });
        milestones.push_back(Milestone { id: 2, amount: 6_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);
        s.client.post_bond();
        s.client.contribute(&s.investor, &10_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();

        // Release milestone 1 (4M to creator)
        s.client.release_milestone(&1);
        assert_eq!(s.client.get_state() as u32, VaultState::Active as u32);

        // Vault balance after milestone 1:
        // Started: 2M(bond) + 10M(contrib) + 300K(fees) = 12.3M
        // Released: 4M to creator + 120K fee to fee wallet = 4.12M
        // Remaining: 8.18M
        assert_eq!(s.token_client.balance(&s.client.address), 8_180_000);

        // Now slash bond from Active state
        s.client.slash_bond();
        assert_eq!(s.client.get_state() as u32, VaultState::Refunding as u32);

        // Refund calculation:
        // remaining_contributions = 10M - 4M = 6M
        // remaining_fees = 6M * 3% = 180K
        // contrib_share = (10M * 6M) / 10M = 6M
        // fee_share = (10M * 180K) / 10M = 180K
        // slash_share = (10M * 2M) / 10M = 2M
        // total = 6M + 180K + 2M = 8.18M (exactly matches vault balance!)
        s.client.claim_refund(&s.investor);
        assert_eq!(s.token_client.balance(&s.client.address), 0);

        // Investor: started 100M, paid 10.3M, gets back 8.18M → 97.88M
        assert_eq!(s.token_client.balance(&s.investor), 97_880_000);
    }

    #[test]
    fn test_finalize_before_deadline() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        // Don't advance time — deadline is 1000, current is 0
        let result = s.client.try_finalize_raise();
        assert!(result.is_err());
    }

    #[test]
    fn test_multi_contributor_prorata_refund() {
        let s = setup();

        let investor2 = Address::generate(&s.env);
        s.token_admin_client.mint(&investor2, &100_000_000);

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 4_000_000, released: false });
        milestones.push_back(Milestone { id: 2, amount: 6_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.post_bond();

        // Investor 1 contributes 4M, Investor 2 contributes 6M
        s.client.contribute(&s.investor, &4_000_000);
        s.client.contribute(&investor2, &6_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();

        // Release milestone 1 (4M to creator)
        s.client.release_milestone(&1);

        // Slash bond
        s.client.slash_bond();

        // Investor 1 refund (contributed 4M out of 10M = 40%):
        // remaining = 10M - 4M = 6M → 40% = 2.4M
        // remaining fees = 180K → 40% = 72K
        // bond = 2M → 40% = 800K
        // total = 2.4M + 72K + 800K = 3.272M
        s.client.claim_refund(&s.investor);
        // Investor started 100M, paid 4M + 120K fee = 95.88M, gets 3.272M → 99.152M
        assert_eq!(s.token_client.balance(&s.investor), 99_152_000);

        // Investor 2 refund (contributed 6M out of 10M = 60%):
        // remaining = 6M → 60% = 3.6M
        // remaining fees = 180K → 60% = 108K
        // bond = 2M → 60% = 1.2M
        // total = 3.6M + 108K + 1.2M = 4.908M
        s.client.claim_refund(&investor2);
        // Investor2 started 100M, paid 6M + 180K = 93.82M, gets 4.908M → 98.728M
        assert_eq!(s.token_client.balance(&investor2), 98_728_000);

        // Vault should be empty (or near-zero from rounding)
        assert_eq!(s.token_client.balance(&s.client.address), 0);
    }

    #[test]
    fn test_reinitialize_guard() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        // Second init should fail
        let mut milestones2 = Vec::new(&s.env);
        milestones2.push_back(Milestone { id: 1, amount: 10_000_000, released: false });
        let config2 = make_config(&s, 10_000_000, 2_000_000, milestones2);
        let result = s.client.try_initialize(&config2);
        assert!(result.is_err());
    }

    #[test]
    fn test_bond_returned_on_failed_with_bond_posted() {
        // Edge case: bond posted but goal not met → bond should be returned
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.post_bond();
        // Creator: 100M - 2M bond = 98M
        assert_eq!(s.token_client.balance(&s.creator), 98_000_000);

        // Contribute less than goal
        s.client.contribute(&s.investor, &5_000_000);

        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        s.client.finalize_raise();
        assert_eq!(s.client.get_state() as u32, VaultState::Failed as u32);

        // Bond should have been returned to creator on finalize
        assert_eq!(s.token_client.balance(&s.creator), 100_000_000);

        // Investor still gets full refund
        s.client.claim_refund(&s.investor);
        assert_eq!(s.token_client.balance(&s.investor), 100_000_000);
    }

    #[test]
    fn test_milestone_strictly_positive() {
        let s = setup();

        // 1. Create config with zero milestone amount
        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 0, released: false });
        milestones.push_back(Milestone { id: 2, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        let result = s.client.try_initialize(&config);
        assert!(result.is_err()); // Milestone id 1 is 0, should panic/fail

        // 2. Create config with negative milestone amount
        let mut milestones2 = Vec::new(&s.env);
        milestones2.push_back(Milestone { id: 1, amount: -1_000_000, released: false });
        milestones2.push_back(Milestone { id: 2, amount: 11_000_000, released: false });

        let config2 = make_config(&s, 10_000_000, 2_000_000, milestones2);
        let result2 = s.client.try_initialize(&config2);
        assert!(result2.is_err()); // Milestone id 1 is negative, should panic/fail
    }

    #[test]
    fn test_manual_finalize_by_stranger_succeeds() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.post_bond();
        s.client.contribute(&s.investor, &10_000_000);

        let stranger = Address::generate(&s.env);
        s.client.finalize_funding(&stranger);

        assert_eq!(s.client.get_state() as u32, VaultState::Funded as u32);
    }

    #[test]
    fn test_manual_finalize_unmet_goal_fails() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.contribute(&s.investor, &5_000_000);

        let stranger = Address::generate(&s.env);
        let result = s.client.try_finalize_funding(&stranger);
        assert!(result.is_err());
    }

    #[test]
    fn test_lazy_resolve_on_get_info() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.post_bond();
        s.client.contribute(&s.investor, &10_000_000);

        // Advance time past deadline
        s.env.ledger().with_mut(|l| l.timestamp = 2000);

        // Trigger lazy evaluation by getting info
        let info = s.client.get_info();
        assert_eq!(info.raised_amount, 10_000_000);

        // State should now be Funded
        assert_eq!(s.client.get_state() as u32, VaultState::Funded as u32);
    }

    #[test]
    fn test_lazy_resolve_on_claim_refund() {
        let s = setup();

        let mut milestones = Vec::new(&s.env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000, released: false });

        let config = make_config(&s, 10_000_000, 2_000_000, milestones);
        s.client.initialize(&config);

        s.client.contribute(&s.investor, &5_000_000);

        // Advance time past deadline
        s.env.ledger().with_mut(|l| l.timestamp = 2000);

        // Claim refund directly without calling finalize_raise
        s.client.claim_refund(&s.investor);

        // Verify investor got full refund (started 100M, paid 5M + 150K fee = 94.85M, got 5.15M back -> 100M)
        assert_eq!(s.token_client.balance(&s.investor), 100_000_000);
        assert_eq!(s.client.get_state() as u32, VaultState::Failed as u32);
    }
}

