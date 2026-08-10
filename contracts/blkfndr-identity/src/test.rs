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

        let admin = Address::generate(&env);
        let contract_id = env.register(IdentityRegistry, (admin.clone(),));
        let client = IdentityRegistryClient::new(&env, &contract_id);

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

    // CONSTRUCTION
    //
    // Configuration is a `__constructor`: it runs inside the deploy
    // transaction, so there is no deployed-but-unconfigured window to seize and
    // no separate `initialize` to re-run. What remains to prove is that the
    // constructor still demands the admin's signature.
    #[test]
    #[should_panic] // admin.require_auth() fails without the admin's signature
    fn construction_requires_the_admins_signature() {
        let env = Env::default(); // deliberately no mock_all_auths
        env.register(IdentityRegistry, (Address::generate(&env),));
    }

    // ATTESTATION
    #[test]
    fn test_attest_and_query() {
        let s = setup();

        let user = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        assert!(!s.client.is_kyc_approved(&user));

        s.client.attest(&s.admin, &user, &hash);

        assert!(s.client.is_kyc_approved(&user));
        assert_eq!(s.client.get_attestation(&user), hash);
    }

    #[test]
    fn test_attest_duplicate_rejected() {
        let s = setup();

        let user = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        s.client.attest(&s.admin, &user, &hash);

        // Second attest without revoke should fail
        let result = s.client.try_attest(&s.admin, &user, &hash);
        assert!(result.is_err());
    }

    #[test]
    fn test_query_unattested_address() {
        let s = setup();

        let stranger = Address::generate(&s.env);
        assert!(!s.client.is_kyc_approved(&stranger));
    }

    #[test]
    fn test_get_attestation_unattested_panics() {
        let s = setup();

        let stranger = Address::generate(&s.env);
        let result = s.client.try_get_attestation(&stranger);
        assert!(result.is_err());
    }

    // REVOCATION
    #[test]
    fn test_revoke() {
        let s = setup();

        let user = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        s.client.attest(&s.admin, &user, &hash);
        assert!(s.client.is_kyc_approved(&user));

        s.client.revoke(&s.admin, &user);
        assert!(!s.client.is_kyc_approved(&user));
    }

    #[test]
    fn test_revoke_unattested_fails() {
        let s = setup();

        let stranger = Address::generate(&s.env);
        let result = s.client.try_revoke(&s.admin, &stranger);
        assert!(result.is_err());
    }

    #[test]
    fn test_revoke_then_reattest() {
        let s = setup();

        let user = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        s.client.attest(&s.admin, &user, &hash);
        s.client.revoke(&s.admin, &user);

        // Re-attest should succeed after revocation
        let hash2 = BytesN::from_array(&s.env, &[
            32, 31, 30, 29, 28, 27, 26, 25,
            24, 23, 22, 21, 20, 19, 18, 17,
            16, 15, 14, 13, 12, 11, 10, 9,
            8, 7, 6, 5, 4, 3, 2, 1,
        ]);
        s.client.attest(&s.admin, &user, &hash2);
        assert!(s.client.is_kyc_approved(&user));
        assert_eq!(s.client.get_attestation(&user), hash2);
    }

    #[test]
    fn test_multiple_users() {
        let s = setup();

        let user1 = Address::generate(&s.env);
        let user2 = Address::generate(&s.env);
        let hash = mock_kyc_hash(&s.env);

        s.client.attest(&s.admin, &user1, &hash);

        assert!(s.client.is_kyc_approved(&user1));
        assert!(!s.client.is_kyc_approved(&user2));

        s.client.attest(&s.admin, &user2, &hash);
        assert!(s.client.is_kyc_approved(&user2));
    }

    // ── Attestors ──────────────────────────────────────────────────────────────
    //
    // The point of the roster: someone who reviews identity documents holds a key
    // that can do that and nothing else. Before it, attesting needed the admin's
    // signature, and the admin is the deployer — so a support hire would have been
    // given a key that also transfers this registry away and governs the factory.

    #[test]
    fn an_attestor_can_attest_but_cannot_administer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let reviewer = Address::generate(&env);
        let applicant = Address::generate(&env);

        let id = env.register(IdentityRegistry, (admin.clone(),));
        let c = IdentityRegistryClient::new(&env, &id);

        c.add_attestor(&reviewer);
        assert!(c.is_attestor(&reviewer));

        c.attest(&reviewer, &applicant, &BytesN::from_array(&env, &[7u8; 32]));
        assert!(c.is_kyc_approved(&applicant));

        // The whole reason the role exists: this key cannot take the registry.
        //
        // The mocks have to come off first. mock_all_auths makes every
        // require_auth succeed, so with it on this assertion passes whether or
        // not the contract checks anything — which it did, and the test was
        // proving nothing until it failed for the right reason.
        env.set_auths(&[]);
        assert!(
            c.try_transfer_admin(&reviewer).is_err(),
            "an attestor must not be able to transfer admin"
        );
    }

    #[test]
    fn a_stranger_cannot_attest() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);
        let applicant = Address::generate(&env);

        let id = env.register(IdentityRegistry, (admin.clone(),));
        let c = IdentityRegistryClient::new(&env, &id);

        assert!(
            c.try_attest(&stranger, &applicant, &BytesN::from_array(&env, &[1u8; 32]))
                .is_err(),
            "only an attestor or the admin may attest"
        );
    }

    /// The admin keeps the power deliberately. A registry whose only attestor has
    /// left must still be usable, and the alternative is needing to appoint someone
    /// before you can appoint anyone.
    #[test]
    fn the_admin_can_still_attest_without_appointing_itself() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let applicant = Address::generate(&env);

        let id = env.register(IdentityRegistry, (admin.clone(),));
        let c = IdentityRegistryClient::new(&env, &id);

        c.attest(&admin, &applicant, &BytesN::from_array(&env, &[2u8; 32]));
        assert!(c.is_kyc_approved(&applicant));
    }

    /// Removing a reviewer must not un-verify everyone they approved — a personnel
    /// change should not become a platform-wide identity outage.
    #[test]
    fn removing_an_attestor_leaves_their_attestations_standing() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let reviewer = Address::generate(&env);
        let applicant = Address::generate(&env);

        let id = env.register(IdentityRegistry, (admin.clone(),));
        let c = IdentityRegistryClient::new(&env, &id);

        c.add_attestor(&reviewer);
        c.attest(&reviewer, &applicant, &BytesN::from_array(&env, &[3u8; 32]));
        c.remove_attestor(&reviewer);

        assert!(!c.is_attestor(&reviewer));
        assert!(
            c.is_kyc_approved(&applicant),
            "an approved applicant stays approved after the reviewer leaves"
        );
    }

    // ── TTL upkeep (M-02) ────────────────────────────────────────────────────
    //
    // Persistent entries archive ~30 days after their last write, and Soroban
    // does not auto-extend on read. The on-access extensions in is_kyc_approved
    // and require_attestor keep active entries alive; these permissionless bumps
    // cover the inactive stretch. The archival behaviour itself is not practical
    // to unit-test, so these prove the entrypoint contract: extend if present,
    // revert if not, so a keeper can distinguish a revoked entry.

    #[test]
    fn bump_kyc_extends_present_and_rejects_absent() {
        let s = setup();

        let user = Address::generate(&s.env);
        s.client.attest(&s.admin, &user, &mock_kyc_hash(&s.env));

        s.client.bump_kyc(&user); // present -> ok
        assert!(s.client.is_kyc_approved(&user));

        let stranger = Address::generate(&s.env);
        assert!(
            s.client.try_bump_kyc(&stranger).is_err(),
            "no approval to extend"
        );
    }

    #[test]
    fn bump_attestor_extends_present_and_rejects_absent() {
        let s = setup();

        let reviewer = Address::generate(&s.env);
        s.client.add_attestor(&reviewer);

        s.client.bump_attestor(&reviewer); // present -> ok
        assert!(s.client.is_attestor(&reviewer));

        let stranger = Address::generate(&s.env);
        assert!(
            s.client.try_bump_attestor(&stranger).is_err(),
            "not an attestor"
        );
    }

}
