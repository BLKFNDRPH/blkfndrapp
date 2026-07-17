#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{StellarAssetClient, TokenClient},
        Address, Env, String,
    };
    use crate::{
        supermajority, CrowdfundingContract,
        CrowdfundingContractClient, CurrencyType, ProjectStatus,
    };

    // SETUP FIXTURES

    struct Setup {
        env: Env,
        client: CrowdfundingContractClient<'static>,
        admin: Address,
        wallet: Address,
        creator: Address,
        investor: Address,
        token_id: Address,
        _token_admin_client: StellarAssetClient<'static>,
        token_client: TokenClient<'static>,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register(CrowdfundingContract, ());
        let client = CrowdfundingContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let creator = Address::generate(&env);
        let investor = Address::generate(&env);
        
        // Setup mock USDC token
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_admin_client = StellarAssetClient::new(&env, &token_contract.address());
        let token_client = TokenClient::new(&env, &token_contract.address());

        // Mint initial funds to investor (100,000,000 stroops)
        token_admin_client.mint(&investor, &100_000_000);

        Setup {
            env, client, admin, wallet, creator, investor,
            token_id: token_contract.address(),
            _token_admin_client: token_admin_client, token_client,
        }
    }

    // PLATFORM & ADMIN LOGIC TESTS

    #[test]
    fn test_initialize_and_getters() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300);
        
        let platform = s.client.get_platform_info();
        assert_eq!(platform.admin, s.admin);
        assert_eq!(platform.fee_percentage, 300);
    }

    #[test]
    fn test_admin_setters() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300);

        s.client.update_fee(&500);
        assert_eq!(s.client.get_platform_info().fee_percentage, 500);

        let new_wallet = Address::generate(&s.env);
        s.client.update_fee_wallet(&new_wallet);
        assert_eq!(s.client.get_platform_info().fee_wallet_address, new_wallet);
    }

    #[test]
    fn test_multisig_admin_management() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300);
        
        let msig1 = Address::generate(&s.env);
        let msig2 = Address::generate(&s.env);

        s.client.add_multi_sig_admin(&msig1);
        s.client.add_multi_sig_admin(&msig2);
        assert_eq!(s.client.get_platform_info().multi_sig_admins.len(), 3); 

        s.client.remove_multi_sig_admin(&msig1);
        assert_eq!(s.client.get_platform_info().multi_sig_admins.len(), 2);
    }

    // PROJECT CREATION & LIFECYCLE TESTS

    #[test]
    fn test_project_lifecycle() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300);
        s.client.register_token(&CurrencyType::USDC, &s.token_id);
        
        let proj_id = s.client.create_project(
            &s.creator,
            &String::from_str(&s.env, "Test Project"),
            &String::from_str(&s.env, "A great idea"),
            &String::from_str(&s.env, "Detailed description"),
            &String::from_str(&s.env, "Tech"),
            &10_000_000,
            &String::from_str(&s.env, "ipfs://blob"),
            &CurrencyType::USDC,
            &100_000
        );
        
        let p = s.client.get_project(&proj_id);
        assert_eq!(p.title, String::from_str(&s.env, "Test Project"));
        assert_eq!(p.status as u32, ProjectStatus::Pending as u32);

        // Approve project
        s.client.approve_project(&proj_id);
        assert_eq!(s.client.get_project(&proj_id).status as u32, ProjectStatus::Approved as u32);
    }

    // FUNDING & RECEIPTS TESTS

    #[test]
    fn test_fund_project_and_receipts() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300); // 3% fee
        s.client.register_token(&CurrencyType::USDC, &s.token_id);
        
        let proj_id = s.client.create_project(
            &s.creator,
            &String::from_str(&s.env, "Test Project"),
            &String::from_str(&s.env, "A great idea"),
            &String::from_str(&s.env, "Detailed description"),
            &String::from_str(&s.env, "Tech"),
            &10_000_000,
            &String::from_str(&s.env, "ipfs://blob"),
            &CurrencyType::USDC,
            &100_000
        );
        s.client.approve_project(&proj_id);

        let fund_amount = 5_000_000;
        s.client.fund_project(&s.investor, &proj_id, &fund_amount, &CurrencyType::USDC);

        let p = s.client.get_project(&proj_id);
        // Under addition model: raised_amount tracks base contribution exactly
        assert_eq!(p.raised_amount, 5_000_000);
        
        let receipt = s.client.get_investment_receipt(&1);
        assert_eq!(receipt.investor, s.investor);
        assert_eq!(receipt.amount, 5_000_000);
        assert_eq!(receipt.fee_paid, 150_000); // 3% of 5,000,000 paid as addition
    }

    // WITHDRAWAL & MULTISIG TESTS

    #[test]
    fn test_multisig_withdrawal_flow() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300);
        s.client.register_token(&CurrencyType::USDC, &s.token_id);
        
        let msig2 = Address::generate(&s.env);
        s.client.add_multi_sig_admin(&msig2);

        let proj_id = s.client.create_project(
            &s.creator,
            &String::from_str(&s.env, "Test Project"),
            &String::from_str(&s.env, "A great idea"),
            &String::from_str(&s.env, "Detailed description"),
            &String::from_str(&s.env, "Tech"),
            &10_000_000,
            &String::from_str(&s.env, "ipfs://blob"),
            &CurrencyType::USDC,
            &100_000
        );
        s.client.approve_project(&proj_id);

        // Fully fund the project to trigger Status::Funded
        s.client.fund_project(&s.investor, &proj_id, &10_000_000, &CurrencyType::USDC);
        assert_eq!(s.client.get_project(&proj_id).status as u32, ProjectStatus::Funded as u32);

        // Admin proposes withdrawal
        let prop_id = s.client.propose_withdrawal(&s.admin, &proj_id, &10_000_000);
        assert!(s.client.get_project(&proj_id).has_pending_withdrawal);

        // vote
        s.client.vote_withdrawal(&msig2, &prop_id);

        // Execute
        s.client.execute_withdrawal(&s.admin, &prop_id);
        
        let p = s.client.get_project(&proj_id);
        assert_eq!(p.status as u32, ProjectStatus::Completed as u32);
        assert_eq!(s.token_client.balance(&s.creator), 10_000_000); 
    }


    // EXPIRATION & REFUND TESTS

    #[test]
    fn test_expired_refund_flow() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300);
        s.client.register_token(&CurrencyType::USDC, &s.token_id);
        
        let deadline = 1000; 
        let proj_id = s.client.create_project(
            &s.creator,
            &String::from_str(&s.env, "Test Project"),
            &String::from_str(&s.env, "A great idea"),
            &String::from_str(&s.env, "Detailed description"),
            &String::from_str(&s.env, "Tech"),
            &10_000_000,
            &String::from_str(&s.env, "ipfs://blob"),
            &CurrencyType::USDC,
            &deadline
        );
        s.client.approve_project(&proj_id);

        s.env.ledger().with_mut(|l| l.timestamp = 500);
        s.client.fund_project(&s.investor, &proj_id, &5_000_000, &CurrencyType::USDC);
        
        let initial_investor_balance = s.token_client.balance(&s.investor);

        // Fast forward past deadline
        s.env.ledger().with_mut(|l| l.timestamp = 2000);
        
        // Process refund
        s.client.refund_investor(&proj_id, &s.investor);
        
        let p = s.client.get_project(&proj_id);
        assert_eq!(p.raised_amount, 0);
        // Refund base amount (5,000,000) + fee (150,000)
        assert_eq!(s.token_client.balance(&s.investor), initial_investor_balance + 5_150_000);
    }

    // PLATFORM DIRECT DONATION TESTS

    #[test]
    fn test_donation_flow() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300);
        s.client.register_token(&CurrencyType::USDC, &s.token_id);

        let donate_amount = 2_000_000;
        s.client.donate_to_platform(
            &s.investor,
            &donate_amount,
            &CurrencyType::USDC,
            &String::from_str(&s.env, "Support the builders")
        );

        let platform = s.client.get_platform_info();
        assert_eq!(platform.total_fees_collected, donate_amount);
        assert_eq!(s.token_client.balance(&s.wallet), donate_amount as i128);
    }

    // MATH HELPERS TESTS

    #[test]
    fn test_supermajority_calculation() {
        assert_eq!(supermajority(1), 1);
        assert_eq!(supermajority(2), 2);
        assert_eq!(supermajority(3), 2);
        assert_eq!(supermajority(4), 3);
        assert_eq!(supermajority(5), 4);
    }


    #[test]
    fn test_platform_fees_escrow_and_withdrawal_flow() {
        let s = setup();
        s.client.initialize(&s.admin, &s.wallet, &300); // 3% fee
        s.client.register_token(&CurrencyType::USDC, &s.token_id);

        let msig2 = Address::generate(&s.env);
        s.client.add_multi_sig_admin(&msig2);

        let proj_id = s.client.create_project(
            &s.creator,
            &String::from_str(&s.env, "Test Project"),
            &String::from_str(&s.env, "A great idea"),
            &String::from_str(&s.env, "Detailed description"),
            &String::from_str(&s.env, "Tech"),
            &10_000_000,
            &String::from_str(&s.env, "ipfs://blob"),
            &CurrencyType::USDC,
            &100_000
        );
        s.client.approve_project(&proj_id);

        // Fully fund the project
        s.client.fund_project(&s.investor, &proj_id, &10_000_000, &CurrencyType::USDC);

        // Verify fee wallet has 0 balance immediately
        assert_eq!(s.token_client.balance(&s.wallet), 0);

        // Propose withdrawal of 4,000,000 (40%)
        let prop_id = s.client.propose_withdrawal(&s.admin, &proj_id, &4_000_000);
        s.client.vote_withdrawal(&msig2, &prop_id);

        // Execute withdrawal
        s.client.execute_withdrawal(&s.admin, &prop_id);

        // Verify creator gets 4,000,000
        assert_eq!(s.token_client.balance(&s.creator), 4_000_000);

        // Verify fee wallet gets proportional fee of 120,000 (3% of 4,000,000)
        assert_eq!(s.token_client.balance(&s.wallet), 120_000);
        assert_eq!(s.client.get_platform_info().total_fees_collected, 120_000);

        // Propose withdrawal of remaining 6,000,000 (60%)
        let prop_id2 = s.client.propose_withdrawal(&s.admin, &proj_id, &6_000_000);
        s.client.vote_withdrawal(&msig2, &prop_id2);

        // Execute withdrawal
        s.client.execute_withdrawal(&s.admin, &prop_id2);

        // Verify creator gets total 10,000,000
        assert_eq!(s.token_client.balance(&s.creator), 10_000_000);

        // Verify fee wallet gets remaining fee of 180,000 (total 300,000)
        assert_eq!(s.token_client.balance(&s.wallet), 300_000);
        assert_eq!(s.client.get_platform_info().total_fees_collected, 300_000);
    }
}