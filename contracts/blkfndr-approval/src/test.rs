#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::Address as _, Address, Env, Vec,
    };
    use crate::{MultisigApproval, MultisigApprovalClient};

    // SETUP
    struct Setup {
        env: Env,
        client: MultisigApprovalClient<'static>,
        admin: Address,
        signer1: Address,
        signer2: Address,
        signer3: Address,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(MultisigApproval, ());
        let client = MultisigApprovalClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);

        Setup { env, client, admin, signer1, signer2, signer3 }
    }

    fn init_2of3(s: &Setup) {
        let mut signers = Vec::new(&s.env);
        signers.push_back(s.signer1.clone());
        signers.push_back(s.signer2.clone());
        signers.push_back(s.signer3.clone());
        s.client.initialize(&s.admin, &signers, &2);
    }

    // INITIALIZATION
    #[test]
    fn test_initialize() {
        let s = setup();
        init_2of3(&s);

        assert_eq!(s.client.get_threshold(), 2);
        assert_eq!(s.client.get_signers().len(), 3);
    }

    #[test]
    fn test_reinitialize_guard() {
        let s = setup();
        init_2of3(&s);

        let mut signers = Vec::new(&s.env);
        signers.push_back(s.signer1.clone());
        let result = s.client.try_initialize(&s.admin, &signers, &1);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_threshold_zero() {
        let s = setup();
        let mut signers = Vec::new(&s.env);
        signers.push_back(s.signer1.clone());

        let result = s.client.try_initialize(&s.admin, &signers, &0);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_threshold_exceeds_signers() {
        let s = setup();
        let mut signers = Vec::new(&s.env);
        signers.push_back(s.signer1.clone());

        let result = s.client.try_initialize(&s.admin, &signers, &5);
        assert!(result.is_err());
    }

    // MILESTONE APPROVAL
    #[test]
    fn test_milestone_threshold_not_reached() {
        let s = setup();
        init_2of3(&s); // 2-of-3

        // Only 1 signer approves → not approved
        s.client.approve_milestone(&s.signer1, &1, &1);
        assert!(!s.client.is_approved(&1, &1));
    }

    #[test]
    fn test_milestone_threshold_reached() {
        let s = setup();
        init_2of3(&s); // 2-of-3

        s.client.approve_milestone(&s.signer1, &1, &1);
        s.client.approve_milestone(&s.signer2, &1, &1);
        assert!(s.client.is_approved(&1, &1));
    }

    #[test]
    fn test_milestone_duplicate_approval() {
        let s = setup();
        init_2of3(&s);

        s.client.approve_milestone(&s.signer1, &1, &1);
        let result = s.client.try_approve_milestone(&s.signer1, &1, &1);
        assert!(result.is_err());
    }

    #[test]
    fn test_milestone_non_signer_rejected() {
        let s = setup();
        init_2of3(&s);

        let stranger = Address::generate(&s.env);
        let result = s.client.try_approve_milestone(&stranger, &1, &1);
        assert!(result.is_err());
    }

    #[test]
    fn test_milestone_different_projects_independent() {
        let s = setup();
        init_2of3(&s);

        // Approve milestone 1 on project 1
        s.client.approve_milestone(&s.signer1, &1, &1);
        s.client.approve_milestone(&s.signer2, &1, &1);
        assert!(s.client.is_approved(&1, &1));

        // Project 2 milestone 1 should NOT be approved
        assert!(!s.client.is_approved(&2, &1));
    }

    // SLASH APPROVAL
    #[test]
    fn test_slash_threshold_not_reached() {
        let s = setup();
        init_2of3(&s);

        s.client.approve_slash(&s.signer1, &1);
        assert!(!s.client.is_slash_approved(&1));
    }

    #[test]
    fn test_slash_threshold_reached() {
        let s = setup();
        init_2of3(&s);

        s.client.approve_slash(&s.signer1, &1);
        s.client.approve_slash(&s.signer2, &1);
        assert!(s.client.is_slash_approved(&1));
    }

    #[test]
    fn test_slash_duplicate_approval() {
        let s = setup();
        init_2of3(&s);

        s.client.approve_slash(&s.signer1, &1);
        let result = s.client.try_approve_slash(&s.signer1, &1);
        assert!(result.is_err());
    }

    // SIGNER MANAGEMENT
    #[test]
    fn test_add_signer() {
        let s = setup();
        init_2of3(&s);

        let signer4 = Address::generate(&s.env);
        s.client.add_signer(&signer4);
        assert_eq!(s.client.get_signers().len(), 4);
    }

    #[test]
    fn test_add_duplicate_signer() {
        let s = setup();
        init_2of3(&s);

        let result = s.client.try_add_signer(&s.signer1);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_signer() {
        let s = setup();
        init_2of3(&s);

        s.client.remove_signer(&s.signer3);
        assert_eq!(s.client.get_signers().len(), 2);
    }

    #[test]
    fn test_remove_signer_below_threshold() {
        let s = setup();
        init_2of3(&s); // 2-of-3

        // Remove one → 2-of-2 (OK)
        s.client.remove_signer(&s.signer3);

        // Remove another → 2-of-1 (FAIL — threshold exceeds signers)
        let result = s.client.try_remove_signer(&s.signer2);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_nonexistent_signer() {
        let s = setup();
        init_2of3(&s);

        let stranger = Address::generate(&s.env);
        let result = s.client.try_remove_signer(&stranger);
        assert!(result.is_err());
    }

    // THRESHOLD MANAGEMENT
    #[test]
    fn test_update_threshold() {
        let s = setup();
        init_2of3(&s);

        s.client.update_threshold(&3);
        assert_eq!(s.client.get_threshold(), 3);

        // Now need all 3 signers for approval
        s.client.approve_milestone(&s.signer1, &1, &1);
        s.client.approve_milestone(&s.signer2, &1, &1);
        assert!(!s.client.is_approved(&1, &1)); // only 2 of 3

        s.client.approve_milestone(&s.signer3, &1, &1);
        assert!(s.client.is_approved(&1, &1)); // 3 of 3
    }

    #[test]
    fn test_update_threshold_invalid() {
        let s = setup();
        init_2of3(&s);

        // 0 is invalid
        let result = s.client.try_update_threshold(&0);
        assert!(result.is_err());

        // 4 > 3 signers is invalid
        let result = s.client.try_update_threshold(&4);
        assert!(result.is_err());
    }
}
