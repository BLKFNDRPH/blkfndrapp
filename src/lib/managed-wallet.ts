import "server-only";

import {
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Horizon,
  Networks,
} from "@stellar/stellar-sdk";
import {
  identityClient,
  NETWORK_PASSPHRASE,
  HORIZON_URL,
  type Signer,
} from "@/lib/stellar-clients";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Signing keys the platform holds on a KYC attestor's behalf.
 *
 * A KYC attestor is hired to review identity documents, not to run a Stellar
 * wallet — they may never have held one. So the platform generates their signing
 * key, funds it with a little XLM for gas, and keeps the secret in Supabase
 * Vault, reachable only by this server's service-role key. The reviewer approves
 * a submission in the console and the server signs the on-chain attestation for
 * them. They never connect Freighter and never touch a private key.
 *
 * What this key can and cannot do is the whole safety argument:
 *
 *   - It can `attest` and `revoke` on the identity registry, and nothing else.
 *     Those write an append-only record that someone's details were verified.
 *   - It is NOT the registry admin, so it cannot appoint other attestors or hand
 *     off the registry. That power stays with an owner's own wallet, signed from
 *     Freighter — appointing someone who can write KYC is a deliberate trust
 *     grant, not something a compromised web server should be able to do alone.
 *   - It holds no project funds. Its only balance is the gas float, and on
 *     removal that float is swept back to the operations account before the key
 *     is destroyed — a wallet is present exactly while the appointment is.
 *
 * The public key is not a secret and is stored in a column
 * (platform_admins.managed_wallet) so the console can show which wallet belongs
 * to which attestor and whether the registry has appointed it. Only the private
 * half lives in the Vault, and only this module ever asks for it.
 */

const FRIENDBOT = "https://friendbot.stellar.org";
const IS_TESTNET = NETWORK_PASSPHRASE === Networks.TESTNET;

/** How much XLM a fresh managed wallet gets for gas when the platform funds it
 *  itself (mainnet). Enough for the base reserve plus a long run of attestations;
 *  the leftover is swept back when the attestor is removed. */
const MANAGED_GAS_FLOAT = "5";

// ─── Vault: the private key, service-role only ──────────────────────────────
// These go through the admin (service-role) client because set/get/delete
// _managed_key are granted to service_role alone. A browser session — even an
// owner's — cannot reach them, which is the point: a key a stolen session could
// read is a key an attacker could sign attestations with.

async function storeManagedSecret(keyRef: string, secret: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_managed_key", {
    key_ref: keyRef,
    secret_value: secret,
  });
  if (error) throw new Error(`Could not store the managed signing key: ${error.message}`);
}

async function getManagedSecret(keyRef: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_managed_key", { key_ref: keyRef });
  if (error) throw new Error(`Could not read the managed signing key: ${error.message}`);
  return typeof data === "string" && data.length > 0 ? data : null;
}

async function deleteManagedSecret(keyRef: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("delete_managed_key", { key_ref: keyRef });
  if (error) throw new Error(`Could not delete the managed signing key: ${error.message}`);
}

/** Whether the platform already holds a key for this attestor. */
export async function hasManagedWallet(keyRef: string): Promise<boolean> {
  return (await getManagedSecret(keyRef)) !== null;
}

// ─── Signing ────────────────────────────────────────────────────────────────

/**
 * A server-side signer: the same shape the wallet layer supplies, but the
 * signature comes from a key this process holds rather than from Freighter.
 *
 * Only signTransaction is needed. The managed account is both the transaction
 * source and the address `attest` requires auth from, so its source signature
 * satisfies the contract's require_auth — no separate auth-entry signature. This
 * was confirmed on-chain before wiring: attest signed this way lands SUCCESS.
 */
function serverSigner(kp: Keypair): Signer {
  return {
    publicKey: kp.publicKey(),
    signTransaction: async (xdr: string) => {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
      tx.sign(kp);
      return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
    },
  };
}

function assertSucceeded(res: unknown, what: string): void {
  const r = res as { getTransactionResponse?: { status?: string }; status?: string };
  const status = r?.getTransactionResponse?.status ?? r?.status;
  if (status && status !== "SUCCESS") {
    throw new Error(`${what} did not succeed on-chain (${status}).`);
  }
}

/**
 * Write a KYC attestation on-chain, signed by the attestor's managed key.
 *
 * kycHashHex is the 32-byte SHA-256 commitment to the applicant's details — the
 * same value the applicant can recompute to check the chain against their own
 * documents. A wrong length would silently commit to a different hash, so it is
 * checked rather than truncated.
 */
export async function signAttestation(params: {
  keyRef: string;
  subject: string;
  kycHashHex: string;
}): Promise<{ attestor: string }> {
  const secret = await getManagedSecret(params.keyRef);
  if (!secret) {
    throw new Error("No managed signing key is on file for this attestor.");
  }
  const hash = Buffer.from(params.kycHashHex, "hex");
  if (hash.length !== 32) {
    throw new Error("The details hash must be 32 bytes (64 hex characters).");
  }

  const kp = Keypair.fromSecret(secret);
  const client = identityClient(serverSigner(kp));
  const tx = await client.attest({
    attestor: kp.publicKey(),
    address: params.subject,
    kyc_hash: hash,
  });
  const res = await tx.signAndSend();
  assertSucceeded(res, "The attestation");
  return { attestor: kp.publicKey() };
}

/** Revoke a KYC attestation on-chain, signed by the attestor's managed key. */
export async function signRevocation(params: {
  keyRef: string;
  subject: string;
}): Promise<{ attestor: string }> {
  const secret = await getManagedSecret(params.keyRef);
  if (!secret) {
    throw new Error("No managed signing key is on file for this attestor.");
  }
  const kp = Keypair.fromSecret(secret);
  const client = identityClient(serverSigner(kp));
  const tx = await client.revoke({ attestor: kp.publicKey(), address: params.subject });
  const res = await tx.signAndSend();
  assertSucceeded(res, "The revocation");
  return { attestor: kp.publicKey() };
}

// ─── Lifecycle: fund, provision, sweep ──────────────────────────────────────

/**
 * Put enough XLM on a new managed wallet to pay for gas.
 *
 * On testnet the free Friendbot tap funds it. On mainnet the operations funder
 * pays the base reserve plus a gas float — that key is only ever a payer, never
 * an attestor. Idempotent: funding an account that already exists is tolerated,
 * so a retried provision converges rather than erroring.
 */
async function fundForGas(publicKey: string): Promise<void> {
  if (IS_TESTNET) {
    const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`);
    if (res.ok) return;
    const body = await res.text().catch(() => "");
    // 400 with op_already_exists means it was already funded — not a failure.
    if (body.includes("op_already_exists") || body.includes("already_exist")) return;
    throw new Error(`Friendbot could not fund ${publicKey} (${res.status}).`);
  }

  const funderSecret = process.env.OPERATIONS_FUNDER_SECRET;
  if (!funderSecret) {
    throw new Error(
      "OPERATIONS_FUNDER_SECRET is not set — cannot fund a managed wallet off testnet.",
    );
  }
  const funder = Keypair.fromSecret(funderSecret);
  const server = new Horizon.Server(HORIZON_URL);
  const source = await server.loadAccount(funder.publicKey());
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createAccount({ destination: publicKey, startingBalance: MANAGED_GAS_FLOAT }),
    )
    .setTimeout(60)
    .build();
  tx.sign(funder);
  try {
    await server.submitTransaction(tx);
  } catch (err: unknown) {
    const codes = (err as { response?: { data?: { extras?: { result_codes?: { operations?: string[] } } } } })
      ?.response?.data?.extras?.result_codes?.operations;
    // Already created by a prior attempt — treat as funded.
    if (codes?.includes("op_already_exists")) return;
    throw err;
  }
}

/**
 * Generate, fund and store a managed signing key for an attestor, returning its
 * public key so the caller can record it and an owner can appoint it on-chain.
 *
 * Idempotent by design: if a key already exists for this ref, it is reused and
 * re-funded rather than replaced — replacing it would orphan the funded account
 * the old secret controlled. The secret is stored before funding so a crash
 * between the two steps leaves a recoverable key, not a funded account with no
 * key on file.
 */
export async function provisionManagedWallet(keyRef: string): Promise<string> {
  const existing = await getManagedSecret(keyRef);
  const kp = existing ? Keypair.fromSecret(existing) : Keypair.random();
  if (!existing) await storeManagedSecret(keyRef, kp.secret());
  await fundForGas(kp.publicKey());
  return kp.publicKey();
}

export interface SweepResult {
  /** XLM balance found before the merge, as a decimal string. */
  swept: string;
  /** Where it went, if anywhere. */
  destination?: string;
  note: string;
}

/**
 * Sweep a managed wallet's remaining gas back and destroy the key.
 *
 * Called when an attestor is removed, after an owner has already withdrawn their
 * authority to attest on-chain. account-merge sends the whole balance to the
 * operations account and deletes the ledger entry in one operation — a gas-only
 * wallet has no trustlines or offers to block it.
 *
 * The order is deliberate: the merge must land before the key is deleted, so a
 * misconfigured destination fails loudly and leaves the key in place to retry,
 * rather than deleting the only thing that could have moved the funds. The key
 * is harmless in the meantime — its attest authority was already removed.
 */
export async function sweepAndDeleteManaged(keyRef: string): Promise<SweepResult> {
  const secret = await getManagedSecret(keyRef);
  if (!secret) return { swept: "0", note: "no managed key on file" };

  const kp = Keypair.fromSecret(secret);
  const server = new Horizon.Server(HORIZON_URL);

  let account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>;
  try {
    account = await server.loadAccount(kp.publicKey());
  } catch {
    // Not on the ledger — never funded, or already merged. Nothing to sweep, so
    // retire the key and report it done.
    await deleteManagedSecret(keyRef);
    return { swept: "0", note: "account not on ledger; key deleted" };
  }

  const destination = process.env.OPERATIONS_ACCOUNT;
  if (!destination) {
    // Deleting now would strand the balance with no key to move it. Refuse, so a
    // missing setting is a fixable error rather than a silent loss.
    throw new Error(
      "OPERATIONS_ACCOUNT is not set — refusing to delete a funded managed wallet with nowhere to sweep it.",
    );
  }

  const native = account.balances.find((b) => b.asset_type === "native");
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.accountMerge({ destination }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await server.submitTransaction(tx);

  await deleteManagedSecret(keyRef);
  return {
    swept: native?.balance ?? "0",
    destination,
    note: "merged to operations account; key deleted",
  };
}
