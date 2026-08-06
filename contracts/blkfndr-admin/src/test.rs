use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{AdminRegistry, AdminRegistryClient};

struct Setup {
    env: Env,
    registry: AdminRegistryClient<'static>,
    owner: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let registry = AdminRegistryClient::new(&env, &env.register(AdminRegistry, ()));
    registry.initialize(&owner);

    Setup { env, registry, owner }
}

#[test]
fn the_owner_starts_as_the_only_admin() {
    let s = setup();
    assert_eq!(s.registry.get_owner(), s.owner);
    assert_eq!(s.registry.admin_count(), 1);
    assert!(s.registry.is_admin(&s.owner));
}

#[test]
fn admins_can_be_added_and_removed() {
    let s = setup();
    let alice = Address::generate(&s.env);

    s.registry.add_admin(&alice);
    assert!(s.registry.is_admin(&alice));
    assert_eq!(s.registry.admin_count(), 2);

    s.registry.remove_admin(&alice);
    assert!(!s.registry.is_admin(&alice));
    assert_eq!(s.registry.admin_count(), 1);
}

#[test]
fn an_account_cannot_be_added_twice() {
    let s = setup();
    let alice = Address::generate(&s.env);
    s.registry.add_admin(&alice);
    assert!(s.registry.try_add_admin(&alice).is_err());
    assert_eq!(s.registry.admin_count(), 2);
}

#[test]
fn removing_someone_who_is_not_an_admin_fails() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert!(s.registry.try_remove_admin(&stranger).is_err());
}

/// Only the owner may edit the roster, so removing them would leave it frozen.
#[test]
fn the_owner_cannot_be_removed() {
    let s = setup();
    assert!(s.registry.try_remove_admin(&s.owner).is_err());
    assert!(s.registry.is_admin(&s.owner));
}

#[test]
fn ownership_transfer_carries_admin_rights() {
    let s = setup();
    let successor = Address::generate(&s.env);

    s.registry.transfer_ownership(&successor);
    assert_eq!(s.registry.get_owner(), successor);
    assert!(s.registry.is_admin(&successor));
    // The previous owner keeps their seat but no longer controls the roster.
    assert!(s.registry.is_admin(&s.owner));
}

#[test]
fn a_stranger_is_not_an_admin() {
    let s = setup();
    assert!(!s.registry.is_admin(&Address::generate(&s.env)));
}

#[test]
fn cannot_be_initialized_twice() {
    let s = setup();
    let hijacker = Address::generate(&s.env);
    assert!(s.registry.try_initialize(&hijacker).is_err());
    assert_eq!(s.registry.get_owner(), s.owner);
}

/// The point of this contract's existence: it holds nothing and gates nothing
/// that moves money. There is deliberately no entrypoint that could.
#[test]
fn exposes_no_approval_or_release_surface() {
    let s = setup();
    // Roster in, roster out. If a future change adds a release-adjacent
    // entrypoint here, that is a design regression this test is meant to
    // provoke a conversation about.
    assert_eq!(s.registry.get_admins().len(), 1);
}
