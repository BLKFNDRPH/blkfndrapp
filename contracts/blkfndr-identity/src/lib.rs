#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype,
    panic_with_error, symbol_short, Address, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized      = 1,
    // 10 was AlreadyInitialized; the constructor makes re-init impossible, so
    // the guard and its code are gone. Reserved gap for ABI stability.
    NotInitialized     = 11,
    AlreadyAttested    = 12,
    NotAttested        = 13,
    NotAnAttestor      = 14,
    AlreadyAnAttestor  = 15,
}

const LEDGERS_TO_LIVE: u32 = 518_400; // ~30 days

#[contracttype]
pub enum DataKey {
    /// address -> may attest. Absent means no.
    Attestor(Address),
    Admin,
    Attestation(Address),
}

// HELPERS

#[inline]
fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

// IDENTITY REGISTRY

/// Require the caller to be an attestor, or the admin.
///
/// The admin retains the power deliberately: a registry whose only attestor
/// has left must still be usable, and the alternative is appointing someone
/// before you can appoint anyone.
fn require_attestor(env: &Env, caller: &Address) {
    caller.require_auth();

    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));

    if caller == &admin {
        return;
    }

    let key = DataKey::Attestor(caller.clone());
    if !env.storage().persistent().has(&key) {
        panic_with_error!(env, Error::NotAnAttestor);
    }
    // Re-extend on use: an attestor who attests regularly never lets their own
    // authorisation archive (~30 days), which would otherwise silently brick the
    // key mid-service. Soroban does not auto-extend a persistent entry on read.
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
}

#[contract]
pub struct IdentityRegistry;

#[contractimpl]
impl IdentityRegistry {

    // SETUP

    /// Bind the registry to its admin, atomically at deploy.
    ///
    /// A constructor runs inside the deploy transaction, so the registry is
    /// never deployed-but-unconfigured: the window in which whoever called
    /// `initialize` first could seize it — and so decide who counts as
    /// KYC-approved — is gone. `admin` must authorise the deploy.
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("INIT")),
            admin,
        );
    }

    // ATTESTORS
    //
    // Recording a KYC attestation used to require the admin's signature, and the
    // admin is the deployer. Letting someone review identity documents therefore
    // meant handing them the deployer key — which also transfers this registry
    // away and, being the same key elsewhere, governs the factory. A support
    // hire cannot be given that.
    //
    // An attestor may do exactly one thing: mark an identity verified, and
    // unmark it. The key is worthless for anything else, so it can live on the
    // laptop of whoever actually reviews the documents.

    /// Authorise an address to attest. Admin only.
    pub fn add_attestor(env: Env, account: Address) {
        extend_instance_ttl(&env);
        load_admin(&env).require_auth();

        let key = DataKey::Attestor(account.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyAnAttestor);
        }
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("ATTESTOR")),
            (account, true),
        );
    }

    /// Withdraw the authorisation. Admin only.
    ///
    /// Attestations already written stay written. Someone leaving should not
    /// silently un-verify everyone they ever approved — that would turn a
    /// personnel change into a platform-wide identity outage.
    pub fn remove_attestor(env: Env, account: Address) {
        extend_instance_ttl(&env);
        load_admin(&env).require_auth();

        let key = DataKey::Attestor(account.clone());
        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::NotAnAttestor);
        }
        env.storage().persistent().remove(&key);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("ATTESTOR")),
            (account, false),
        );
    }

    pub fn is_attestor(env: Env, account: Address) -> bool {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        account == admin || env.storage().persistent().has(&DataKey::Attestor(account))
    }


    // ATTESTATION MANAGEMENT

    /// Record a KYC attestation hash for an address.
    pub fn attest(env: Env, attestor: Address, address: Address, kyc_hash: BytesN<32>) {
        extend_instance_ttl(&env);
        require_attestor(&env, &attestor);

        let key = DataKey::Attestation(address.clone());

        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyAttested);
        }

        env.storage().persistent().set(&key, &kyc_hash);
        env.storage().persistent().extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("ATTEST")),
            (address, kyc_hash),
        );
    }

    /// Revoke a KYC attestation for an address.
    pub fn revoke(env: Env, attestor: Address, address: Address) {
        extend_instance_ttl(&env);
        require_attestor(&env, &attestor);

        let key = DataKey::Attestation(address.clone());

        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::NotAttested);
        }

        env.storage().persistent().remove(&key);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("REVOKE")),
            address,
        );
    }

    /// Hand the registry to a new admin.
    ///
    /// Without this the admin set at initialization would be permanent, and a
    /// lost or compromised key would mean no further KYC attestation was
    /// possible for the life of the contract — recoverable only by redeploying
    /// and re-attesting every user.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        extend_instance_ttl(&env);
        let admin = load_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (symbol_short!("IDENTITY"), symbol_short!("ADMIN_TX")),
            new_admin,
        );
    }

    // QUERIES

    /// The account that may attest and revoke.
    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    /// Check if the address has a valid KYC attestation on file.
    pub fn is_kyc_approved(env: Env, address: Address) -> bool {
        let key = DataKey::Attestation(address);
        if env.storage().persistent().has(&key) {
            // Re-extend on the check the vault runs at creation, so an approval
            // stays alive as long as it is relied on rather than archiving ~30
            // days after it was written and silently un-approving the holder.
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
            true
        } else {
            false
        }
    }

    /// Retrieve the KYC attestation hash for the given address.
    pub fn get_attestation(env: Env, address: Address) -> BytesN<32> {
        let key = DataKey::Attestation(address);
        let hash = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotAttested));
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
        hash
    }

    /// Extend a KYC attestation's lifetime without changing it.
    ///
    /// Permissionless, so a keeper — or the holder — can keep an approval from
    /// archiving through a stretch where the holder creates no vaults (the
    /// on-access extension in is_kyc_approved only helps while they are active).
    /// A missing attestation reverts, so a keeper iterating approvals can tell a
    /// revoked one apart.
    pub fn bump_kyc(env: Env, address: Address) {
        let key = DataKey::Attestation(address);
        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::NotAttested);
        }
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
    }

    /// Extend an attestor's authorisation lifetime. Permissionless, for the same
    /// reason as bump_kyc: a keeper keeps a newly-appointed or rarely-active
    /// attestor from archiving before they next attest.
    pub fn bump_attestor(env: Env, account: Address) {
        let key = DataKey::Attestor(account);
        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::NotAnAttestor);
        }
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGERS_TO_LIVE, LEDGERS_TO_LIVE);
    }
}

#[cfg(test)]
mod test;
