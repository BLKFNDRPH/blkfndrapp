#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::Address as _, Address, BytesN, Env,
    };
    use crate::{IdentityRegistry, IdentityRegistryClient};

    // SETUP
    struct Setup {
        env: Env,
        client: IdentityRegistryClient<'static>,
        admin: Address,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(IdentityRegistry, ());
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        Setup { env, client, admin }
    }

    /// generate a deterministic-looking hash for tests.
    fn mock_kyc_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[
            1, 2, 3, 4, 5, 6, 7, 8,
            9, 10, 11, 12, 13, 14, 15, 16,
            17, 18, 19, 20, 21, 22, 23, 24,
            25, 26, 27, 28, 29, 30, 31, 32,
        ])
    }

    // INITIALIZATION
    #[test]
    fn test_initialize() {
        let s = setup();
        s.client.initialize(&s.admin);
        // No panic = success
    }

    #[test]
    fn test_reinitialize_guard() {
        let s = setup();
        s.client.initialize(&s.admin);

        let admin2 = Address::generate(&s.env);
        let result = s.client.try_initialize(&admin2);
        assert!(result.is_err());
    }

    // ATTESTATION
    #[test]
    fn test_attest_and_query() {
        let s = setup();
        s.client.initialize(&s.admin);

        let user = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        assert!(!s.client.is_kyc_approved(&user));

        s.client.attest(&user, &hash);

        assert!(s.client.is_kyc_approved(&user));
        assert_eq!(s.client.get_attestation(&user), hash);
    }

    #[test]
    fn test_attest_duplicate_rejected() {
        let s = setup();
        s.client.initialize(&s.admin);

        let user = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        s.client.attest(&user, &hash);

        // Second attest without revoke should fail
        let result = s.client.try_attest(&user, &hash);
        assert!(result.is_err());
    }

    #[test]
    fn test_query_unattested_address() {
        let s = setup();
        s.client.initialize(&s.admin);

        let stranger = Address::generate(&s.env);
        assert!(!s.client.is_kyc_approved(&stranger));
    }

    #[test]
    fn test_get_attestation_unattested_panics() {
        let s = setup();
        s.client.initialize(&s.admin);

        let stranger = Address::generate(&s.env);
        let result = s.client.try_get_attestation(&stranger);
        assert!(result.is_err());
    }

    // REVOCATION
    #[test]
    fn test_revoke() {
        let s = setup();
        s.client.initialize(&s.admin);

        let user = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        s.client.attest(&user, &hash);
        assert!(s.client.is_kyc_approved(&user));

        s.client.revoke(&user);
        assert!(!s.client.is_kyc_approved(&user));
    }

    #[test]
    fn test_revoke_unattested_fails() {
        let s = setup();
        s.client.initialize(&s.admin);

        let stranger = Address::generate(&s.env);
        let result = s.client.try_revoke(&stranger);
        assert!(result.is_err());
    }

    #[test]
    fn test_revoke_then_reattest() {
        let s = setup();
        s.client.initialize(&s.admin);

        let user = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        s.client.attest(&user, &hash);
        s.client.revoke(&user);

        // Re-attest should succeed after revocation
        let hash2 = BytesN::from_array(&s.env, &[
            32, 31, 30, 29, 28, 27, 26, 25,
            24, 23, 22, 21, 20, 19, 18, 17,
            16, 15, 14, 13, 12, 11, 10, 9,
            8, 7, 6, 5, 4, 3, 2, 1,
        ]);
        s.client.attest(&user, &hash2);
        assert!(s.client.is_kyc_approved(&user));
        assert_eq!(s.client.get_attestation(&user), hash2);
    }

    #[test]
    fn test_multiple_users() {
        let s = setup();
        s.client.initialize(&s.admin);

        let user1 = Address::generate(&s.env);
        let user2 = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        s.client.attest(&user1, &hash);

        assert!(s.client.is_kyc_approved(&user1));
        assert!(!s.client.is_kyc_approved(&user2));

        s.client.attest(&user2, &hash);
        assert!(s.client.is_kyc_approved(&user2));
    }
}
