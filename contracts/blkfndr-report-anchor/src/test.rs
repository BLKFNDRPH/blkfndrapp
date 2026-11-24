use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    vec, Address, BytesN, Env, IntoVal,
};

use crate::{Error, ReportAnchorRegistry, ReportAnchorRegistryClient};

struct Setup {
    env: Env,
    registry: ReportAnchorRegistryClient<'static>,
    admin: Address,
    attestor: Address,
    vault: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attestor = Address::generate(&env);
    let vault = Address::generate(&env);

    // The same two steps the deploy runs: construct, then list the attestor.
    let id = env.register(ReportAnchorRegistry, (admin.clone(),));
    let registry = ReportAnchorRegistryClient::new(&env, &id);
    registry.add_attestor(&attestor);

    Setup { env, registry, admin, attestor, vault }
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// A contract error as the client's try_ calls report it.
fn code(error: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(error as u32)
}

#[test]
fn a_new_registry_has_its_admin_and_no_anchors() {
    let s = setup();
    assert_eq!(s.registry.get_admin(), s.admin);
    assert_eq!(s.registry.get_attestors(), vec![&s.env, s.attestor.clone()]);
    assert_eq!(s.registry.get_count(&s.vault), 0);
    assert_eq!(s.registry.get_latest(&s.vault), None);
    assert_eq!(s.registry.find(&hash(&s.env, 1)), None);
    assert_eq!(s.registry.get_history(&s.vault, &0, &10).len(), 0);
}

#[test]
fn an_anchor_is_recorded_with_its_position_and_time() {
    let s = setup();
    s.env.ledger().set_timestamp(1_795_000_000);

    let seq = s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 1), &1);
    assert_eq!(seq, 0);

    let a = s.registry.get_anchor(&s.vault, &0);
    assert_eq!(a.vault, s.vault);
    assert_eq!(a.seq, 0);
    assert_eq!(a.report_hash, hash(&s.env, 1));
    assert_eq!(a.schema_version, 1);
    assert_eq!(a.attestor, s.attestor);
    assert_eq!(a.anchored_at, 1_795_000_000);

    assert_eq!(s.registry.get_count(&s.vault), 1);
    assert_eq!(s.registry.get_latest(&s.vault), Some(a.clone()));
    assert_eq!(s.registry.find(&hash(&s.env, 1)), Some(a));
}

#[test]
fn an_anchor_emits_an_event_with_the_vault_as_a_topic() {
    let s = setup();
    s.env.ledger().set_timestamp(1_795_000_000);
    s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 7), &1);

    let events = s.env.events().all();
    let (contract, topics, data) = events.last().unwrap();
    assert_eq!(contract, s.registry.address);
    assert_eq!(
        topics,
        (symbol_short!("ANCHOR"), symbol_short!("RECORDED"), s.vault.clone()).into_val(&s.env)
    );
    let got: (u32, BytesN<32>, u32, Address, u64) = data.into_val(&s.env);
    assert_eq!(got, (0u32, hash(&s.env, 7), 1u32, s.attestor.clone(), 1_795_000_000u64));
}

#[test]
fn a_re_run_appends_and_replaces_nothing() {
    let s = setup();
    assert_eq!(s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 1), &1), 0);
    assert_eq!(s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 2), &1), 1);
    assert_eq!(s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 3), &2), 2);

    assert_eq!(s.registry.get_count(&s.vault), 3);
    assert_eq!(s.registry.get_latest(&s.vault).unwrap().report_hash, hash(&s.env, 3));
    // The first one is still there, unchanged.
    assert_eq!(s.registry.get_anchor(&s.vault, &0).report_hash, hash(&s.env, 1));
    assert_eq!(s.registry.find(&hash(&s.env, 1)).unwrap().seq, 0);
}

#[test]
fn each_vault_has_its_own_history() {
    let s = setup();
    let other = Address::generate(&s.env);
    s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 1), &1);
    assert_eq!(s.registry.anchor(&s.attestor, &other, &hash(&s.env, 2), &1), 0);

    assert_eq!(s.registry.get_count(&s.vault), 1);
    assert_eq!(s.registry.get_count(&other), 1);
    assert_eq!(s.registry.find(&hash(&s.env, 2)).unwrap().vault, other);
}

#[test]
fn a_hash_is_anchored_once() {
    let s = setup();
    s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 1), &1);

    // Not again under the same vault, and not under another.
    assert_eq!(
        s.registry.try_anchor(&s.attestor, &s.vault, &hash(&s.env, 1), &1),
        Err(Ok(code(Error::HashAlreadyAnchored)))
    );
    let other = Address::generate(&s.env);
    assert_eq!(
        s.registry.try_anchor(&s.attestor, &other, &hash(&s.env, 1), &1),
        Err(Ok(code(Error::HashAlreadyAnchored)))
    );
    assert_eq!(s.registry.get_count(&s.vault), 1);
    assert_eq!(s.registry.get_count(&other), 0);
}

#[test]
fn an_address_off_the_roster_cannot_anchor() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.registry.try_anchor(&stranger, &s.vault, &hash(&s.env, 1), &1),
        Err(Ok(code(Error::NotAnAttestor)))
    );
    // Not even the admin: the admin runs the roster, it does not publish.
    assert_eq!(
        s.registry.try_anchor(&s.admin, &s.vault, &hash(&s.env, 1), &1),
        Err(Ok(code(Error::NotAnAttestor)))
    );
}

#[test]
fn naming_an_attestor_is_not_enough_without_its_signature() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    let h = hash(&s.env, 1);

    // Only the stranger signs, but the call names the real attestor.
    s.env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &s.registry.address,
            fn_name: "anchor",
            args: (s.attestor.clone(), s.vault.clone(), h.clone(), 1u32).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.registry.try_anchor(&s.attestor, &s.vault, &h, &1).is_err());
    assert_eq!(s.registry.get_count(&s.vault), 0);
}

#[test]
fn schema_version_zero_is_refused() {
    let s = setup();
    assert_eq!(
        s.registry.try_anchor(&s.attestor, &s.vault, &hash(&s.env, 1), &0),
        Err(Ok(code(Error::UnknownSchemaVersion)))
    );
}

#[test]
fn removing_an_attestor_stops_its_writes_and_keeps_its_anchors() {
    let s = setup();
    s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 1), &1);

    s.registry.remove_attestor(&s.attestor);
    assert!(!s.registry.is_attestor(&s.attestor));
    assert_eq!(
        s.registry.try_anchor(&s.attestor, &s.vault, &hash(&s.env, 2), &1),
        Err(Ok(code(Error::NotAnAttestor)))
    );

    // What it anchored is still readable, under its name.
    let kept = s.registry.get_latest(&s.vault).unwrap();
    assert_eq!(kept.report_hash, hash(&s.env, 1));
    assert_eq!(kept.attestor, s.attestor);
}

#[test]
fn a_rotated_key_carries_on_the_same_history() {
    let s = setup();
    s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, 1), &1);

    let next = Address::generate(&s.env);
    s.registry.add_attestor(&next);
    s.registry.remove_attestor(&s.attestor);

    assert_eq!(s.registry.anchor(&next, &s.vault, &hash(&s.env, 2), &1), 1);
    assert_eq!(s.registry.get_anchor(&s.vault, &0).attestor, s.attestor);
    assert_eq!(s.registry.get_anchor(&s.vault, &1).attestor, next);
}

#[test]
fn the_roster_refuses_duplicates_unknowns_and_a_seventeenth() {
    let s = setup();
    assert_eq!(
        s.registry.try_add_attestor(&s.attestor),
        Err(Ok(code(Error::AttestorAlreadyListed)))
    );
    assert_eq!(
        s.registry.try_remove_attestor(&Address::generate(&s.env)),
        Err(Ok(code(Error::AttestorNotListed)))
    );
    for _ in 1..16 {
        s.registry.add_attestor(&Address::generate(&s.env));
    }
    assert_eq!(s.registry.get_attestors().len(), 16);
    assert_eq!(
        s.registry.try_add_attestor(&Address::generate(&s.env)),
        Err(Ok(code(Error::TooManyAttestors)))
    );
}

#[test]
fn only_the_admin_changes_the_roster() {
    let s = setup();
    let newcomer = Address::generate(&s.env);

    // The attestor signs; the admin does not.
    s.env.mock_auths(&[MockAuth {
        address: &s.attestor,
        invoke: &MockAuthInvoke {
            contract: &s.registry.address,
            fn_name: "add_attestor",
            args: (newcomer.clone(),).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.registry.try_add_attestor(&newcomer).is_err());
    assert!(!s.registry.is_attestor(&newcomer));
}

#[test]
fn the_admin_can_be_handed_over() {
    let s = setup();
    let treasury = Address::generate(&s.env);
    s.registry.transfer_admin(&treasury);
    assert_eq!(s.registry.get_admin(), treasury);

    // The old admin's signature no longer changes the roster.
    let newcomer = Address::generate(&s.env);
    s.env.mock_auths(&[MockAuth {
        address: &s.admin,
        invoke: &MockAuthInvoke {
            contract: &s.registry.address,
            fn_name: "add_attestor",
            args: (newcomer.clone(),).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.registry.try_add_attestor(&newcomer).is_err());
}

#[test]
fn history_is_paged_oldest_first_and_clamped() {
    let s = setup();
    for i in 0..120u8 {
        s.registry.anchor(&s.attestor, &s.vault, &hash(&s.env, i), &1);
    }
    assert_eq!(s.registry.get_count(&s.vault), 120);

    let first = s.registry.get_history(&s.vault, &0, &0);
    assert_eq!(first.len(), 100);
    assert_eq!(first.get(0).unwrap().seq, 0);
    assert_eq!(s.registry.get_history(&s.vault, &0, &500).len(), 100);

    let rest = s.registry.get_history(&s.vault, &100, &100);
    assert_eq!(rest.len(), 20);
    assert_eq!(rest.get(19).unwrap().report_hash, hash(&s.env, 119));

    let two = s.registry.get_history(&s.vault, &5, &2);
    assert_eq!(two.len(), 2);
    assert_eq!(two.get(0).unwrap().seq, 5);
    assert_eq!(s.registry.get_history(&s.vault, &120, &10).len(), 0);
}

#[test]
fn a_missing_anchor_is_an_error() {
    let s = setup();
    assert_eq!(
        s.registry.try_get_anchor(&s.vault, &0),
        Err(Ok(code(Error::AnchorNotFound)))
    );
}
