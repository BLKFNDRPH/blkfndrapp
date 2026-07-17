#[cfg(test)]
mod tests {
    use soroban_sdk::{
        contract, contractimpl, testutils::Address as _, Address, Env, Vec, BytesN, String
    };
    use crate::{BlkfndrFactory, BlkfndrFactoryClient, Milestone, CreateVaultConfig};

    // MOCK CONSTRUCTS FOR VAULT INITIALIZE DEPENDENCIES

    #[contract]
    pub struct MockApprovalModule;

    #[contractimpl]
    impl MockApprovalModule {
        pub fn is_approved(_env: Env, _project_id: u64, _milestone_id: u32) -> bool {
            true
        }
        pub fn is_slash_approved(_env: Env, _project_id: u64) -> bool {
            true
        }
    }

    #[contract]
    pub struct MockIdentityRegistry;

    #[contractimpl]
    impl MockIdentityRegistry {
        pub fn is_kyc_approved(_env: Env, _address: Address) -> bool {
            true
        }
    }

    // Load the vault WASM bytes
    const VAULT_WASM: &[u8] = include_bytes!("../../../target/wasm32-unknown-unknown/release/blkfndr_vault.wasm");

    /// Helper: standard CreateVaultConfig for reuse.
    fn make_create_config(
        env: &Env,
        creator: &Address,
        token: &Address,
        approval_id: &Address,
        identity_id: &Address,
    ) -> CreateVaultConfig {
        let mut milestones = Vec::new(env);
        milestones.push_back(Milestone { id: 1, amount: 10_000_000i128, released: false });

        CreateVaultConfig {
            creator: creator.clone(),
            token: token.clone(),
            goal: 10_000_000i128,
            deadline: 1000u64,
            bond_amount: 2_000_000i128,
            approval_module: approval_id.clone(),
            identity_registry: identity_id.clone(),
            milestones,
            metadata_cid: String::from_str(env, "test_cid"),
        }
    }

    // EXISTING TEST 
    #[test]
    fn test_factory_deployment_and_registry() {
        let env = Env::default();
        env.mock_all_auths();

        let factory_id = env.register(BlkfndrFactory, ());
        let factory_client = BlkfndrFactoryClient::new(&env, &factory_id);

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let token = Address::generate(&env);
        let fee_wallet = Address::generate(&env);

        let approval_id = env.register(MockApprovalModule, ());
        let identity_id = env.register(MockIdentityRegistry, ());

        // Upload vault WASM to get hash
        let vault_wasm_hash = env.deployer().upload_contract_wasm(VAULT_WASM);

        // Initialize factory
        factory_client.initialize(&admin, &vault_wasm_hash, &fee_wallet, &300u64);

        // Create a vault
        let config = make_create_config(&env, &creator, &token, &approval_id, &identity_id);
        let vault_address = factory_client.create_vault(&config);

        // Verify lookup maps project 1 to the deployed vault address
        let registered_vault = factory_client.get_vault(&1);
        assert_eq!(vault_address, registered_vault);
    }

    // NEW TESTS
    #[test]
    fn test_multiple_vault_deployments() {
        let env = Env::default();
        env.mock_all_auths();

        let factory_id = env.register(BlkfndrFactory, ());
        let factory_client = BlkfndrFactoryClient::new(&env, &factory_id);

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let token = Address::generate(&env);
        let fee_wallet = Address::generate(&env);

        let approval_id = env.register(MockApprovalModule, ());
        let identity_id = env.register(MockIdentityRegistry, ());

        let vault_wasm_hash = env.deployer().upload_contract_wasm(VAULT_WASM);
        factory_client.initialize(&admin, &vault_wasm_hash, &fee_wallet, &300u64);

        // Deploy vault 1
        let config1 = make_create_config(&env, &creator, &token, &approval_id, &identity_id);
        let vault1 = factory_client.create_vault(&config1);

        // Deploy vault 2
        let config2 = make_create_config(&env, &creator, &token, &approval_id, &identity_id);
        let vault2 = factory_client.create_vault(&config2);

        // Addresses must be distinct
        assert_ne!(vault1, vault2);

        // Counter incremented correctly
        assert_eq!(factory_client.get_vault(&1), vault1);
        assert_eq!(factory_client.get_vault(&2), vault2);
    }

    #[test]
    fn test_reinitialize_factory_guard() {
        let env = Env::default();
        env.mock_all_auths();

        let factory_id = env.register(BlkfndrFactory, ());
        let factory_client = BlkfndrFactoryClient::new(&env, &factory_id);

        let admin = Address::generate(&env);
        let fee_wallet = Address::generate(&env);
        let vault_wasm_hash = env.deployer().upload_contract_wasm(VAULT_WASM);

        factory_client.initialize(&admin, &vault_wasm_hash, &fee_wallet, &300u64);

        // Second initialization should fail
        let admin2 = Address::generate(&env);
        let result = factory_client.try_initialize(&admin2, &vault_wasm_hash, &fee_wallet, &300u64);
        assert!(result.is_err());
    }

    #[soroban_sdk::contracttype]
    #[derive(Clone, Debug)]
    pub struct TestProjectInfo {
        pub project_id:        u64,
        pub creator:           Address,
        pub token:             Address,
        pub goal:              i128,    
        pub raised_amount:     i128,    
        pub deadline:          u64,
        pub bond_amount:       i128,     
        pub bond_posted:       bool,
        pub approval_module:   Address,
        pub identity_registry: Address,
        pub milestones:        Vec<Milestone>,
        pub released_total:    i128,    
        pub fee_wallet_address: Address,
        pub fee_percentage:     u64,    
        pub metadata_cid:       String,
        pub admin:             Address,
    }

    #[soroban_sdk::contractclient(name = "VaultInspectClient")]
    pub trait VaultInspectTrait {
        fn get_info(env: Env) -> TestProjectInfo;
    }

    #[test]
    fn test_factory_governance() {
        let env = Env::default();
        env.mock_all_auths();

        let factory_id = env.register(BlkfndrFactory, ());
        let factory_client = BlkfndrFactoryClient::new(&env, &factory_id);

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let token = Address::generate(&env);
        let fee_wallet = Address::generate(&env);

        let approval_id = env.register(MockApprovalModule, ());
        let identity_id = env.register(MockIdentityRegistry, ());

        let vault_wasm_hash = env.deployer().upload_contract_wasm(VAULT_WASM);

        // Initialize with 3% fee (300 bps)
        factory_client.initialize(&admin, &vault_wasm_hash, &fee_wallet, &300u64);

        assert_eq!(factory_client.get_admin(), admin);
        assert_eq!(factory_client.get_fee_wallet(), fee_wallet);
        assert_eq!(factory_client.get_fee_percentage(), 300);

        // Deploy vault 1 under 3% fee config
        let config1 = make_create_config(&env, &creator, &token, &approval_id, &identity_id);
        let vault1_address = factory_client.create_vault(&config1);

        // Update Factory platform fee to 5% (500 bps) and fee wallet to new address
        let fee_wallet2 = Address::generate(&env);
        factory_client.update_fee_wallet(&fee_wallet2);
        factory_client.update_fee_percentage(&500u64);

        assert_eq!(factory_client.get_fee_wallet(), fee_wallet2);
        assert_eq!(factory_client.get_fee_percentage(), 500);

        // Deploy vault 2 under new 5% fee config
        let config2 = make_create_config(&env, &creator, &token, &approval_id, &identity_id);
        let vault2_address = factory_client.create_vault(&config2);

        // Inspect on-chain config of vault 1 (must remain at 3.0% / original fee wallet)
        let vault1_client = VaultInspectClient::new(&env, &vault1_address);
        let info1 = vault1_client.get_info();
        assert_eq!(info1.fee_percentage, 300);
        assert_eq!(info1.fee_wallet_address, fee_wallet);

        // Inspect on-chain config of vault 2 (must be 5.0% / new fee wallet)
        let vault2_client = VaultInspectClient::new(&env, &vault2_address);
        let info2 = vault2_client.get_info();
        assert_eq!(info2.fee_percentage, 500);
        assert_eq!(info2.fee_wallet_address, fee_wallet2);
    }

    #[test]
    fn test_bond_percentage_governance_and_validation() {
        let env = Env::default();
        env.mock_all_auths();

        let factory_id = env.register(BlkfndrFactory, ());
        let factory_client = BlkfndrFactoryClient::new(&env, &factory_id);

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let token = Address::generate(&env);
        let fee_wallet = Address::generate(&env);

        let approval_id = env.register(MockApprovalModule, ());
        let identity_id = env.register(MockIdentityRegistry, ());

        let vault_wasm_hash = env.deployer().upload_contract_wasm(VAULT_WASM);

        // Initialize factory
        factory_client.initialize(&admin, &vault_wasm_hash, &fee_wallet, &300u64);

        // Default should be 500 (5.00%)
        assert_eq!(factory_client.get_bond_percentage(), 500);

        // 1. Try to create a vault with too low bond: goal is 10,000,000, 5% of it is 500,000.
        // Let's set bond_amount to 400,000.
        let mut config = make_create_config(&env, &creator, &token, &approval_id, &identity_id);
        config.goal = 10_000_000i128;
        config.bond_amount = 400_000i128;

        let result = factory_client.try_create_vault(&config);
        assert!(result.is_err()); // Under 5% default

        // Let's set bond_amount to 500,000 (exactly 5%)
        config.bond_amount = 500_000i128;
        let vault_addr1 = factory_client.create_vault(&config);
        assert_eq!(factory_client.get_vault(&1), vault_addr1);

        // 2. Update bond percentage to 8% (800 bps)
        factory_client.update_bond_percentage(&800u64);
        assert_eq!(factory_client.get_bond_percentage(), 800);

        // Try to create vault with 5% bond (500,000) which should now fail under 8% config
        config.bond_amount = 500_000i128;
        let result2 = factory_client.try_create_vault(&config);
        assert!(result2.is_err()); // Under 8% config

        // Create with 8% bond (800,000) which should succeed
        config.bond_amount = 800_000i128;
        let vault_addr2 = factory_client.create_vault(&config);
        assert_eq!(factory_client.get_vault(&2), vault_addr2);

        // 3. Try to set invalid bond percentage (> 100% / 10000 bps)
        let result_invalid = factory_client.try_update_bond_percentage(&10001u64);
        assert!(result_invalid.is_err());
    }
}
