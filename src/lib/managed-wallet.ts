import "server-only";

import {
  Keypair,
  TransactionBuilder,
  Contract,
  Asset,
  BASE_FEE,
  Networks,
  nativeToScVal,
  scValToNative,
  rpc,
} from "@stellar/stellar-sdk";
import {
  identityClient,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URL,
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
 *   - It holds no project funds. Its only balance is the gas the Operations
 *     Vault released to it, and on removal that gas is swept back to the vault
 *     before the key is destroyed — a wallet is present exactly while the
 *     appointment is.
 *
 * The public key is not a secret and is stored in a column
 * (platform_admins.managed_wallet) so the console can show which wallet belongs
 * to which attestor and whether the registry has appointed it. Only the private
 * half lives in the Vault, and only this module ever asks for it.
 */

const FRIENDBOT = "https://friendbot.stellar.org";
const IS_TESTNET = NETWORK_PASSPHRASE === Networks.TESTNET;

/** The native-asset (XLM) contract, so gas can move to and from a managed wallet
 *  as token transfers — the only way a contract like the Operations Vault can
 *  hold and hand out XLM. Derived from the network so it is correct on any. */
const NATIVE_SAC = Asset.native().contractId(NETWORK_PASSPHRASE);

/** What a swept wallet is left with: its ~1 XLM base reserve, which cannot follow
 *  the balance to a contract (account-merge only pays a classic account), plus a
 *  cushion for the sweep transaction's own fee. Everything above this returns to
 *  the vault. */
const SWEEP_RETAIN_STROOPS = 15_000_000n; // 1.5 XLM

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

// ─── Lifecycle: provision, sweep ────────────────────────────────────────────

/**
 * Friendbot-fund a fresh account on testnet, so a newly added attestor can be
 * exercised end to end without waiting on a vote. Not fatal if it fails, and it
 * does nothing on mainnet — there the wallet is funded by an owner-voted release
 * from the Operations Vault, which is the only source of its gas.
 */
async function friendbotFund(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`);
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  if (body.includes("op_already_exists") || body.includes("already_exist")) return;
  console.warn(`[managed-wallet] Friendbot could not fund ${publicKey} (${res.status}).`);
}

/**
 * Generate and store a managed signing key for an attestor, returning its public
 * key so the caller can record it and an owner can appoint it on-chain.
 *
 * It funds the wallet from no platform key of its own: gas comes from the
 * Operations Vault, released by an owner vote. On testnet it is Friendbot-funded
 * for convenience; on mainnet it stays empty until the vault funds it — which is
 * the whole point, there is no platform-held wallet in this path.
 *
 * Idempotent: if a key already exists for this ref it is reused rather than
 * replaced, so a retry never orphans the wallet the old secret controlled. The
 * secret is stored first, so a crash leaves a recoverable key.
 */
export async function provisionManagedWallet(keyRef: string): Promise<string> {
  const existing = await getManagedSecret(keyRef);
  const kp = existing ? Keypair.fromSecret(existing) : Keypair.random();
  if (!existing) await storeManagedSecret(keyRef, kp.secret());
  if (IS_TESTNET) await friendbotFund(kp.publicKey());
  return kp.publicKey();
}

export interface SweepResult {
  /** Stroops returned to the vault. Zero if the wallet held only its reserve. */
  swept: string;
  /** The vault it went to, if a transfer happened. */
  destination?: string;
  note: string;
}

/** The managed wallet's native balance in stroops, read through the native asset
 *  contract. Zero if the account is not on the ledger. */
async function nativeBalance(server: rpc.Server, pubkey: string): Promise<bigint> {
  let source;
  try {
    source = await server.getAccount(pubkey);
  } catch {
    return 0n; // not on the ledger — nothing there
  }
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(NATIVE_SAC).call("balance", nativeToScVal(pubkey, { type: "address" })),
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result) return 0n;
  return BigInt(scValToNative(sim.result.retval) as bigint);
}

/** Move `amount` stroops of native XLM from the managed wallet to `to`, signed by
 *  the held key, and wait for it to land. */
async function sacTransfer(
  server: rpc.Server,
  kp: Keypair,
  to: string,
  amount: bigint,
): Promise<void> {
  const source = await server.getAccount(kp.publicKey());
  const op = new Contract(NATIVE_SAC).call(
    "transfer",
    nativeToScVal(kp.publicKey(), { type: "address" }),
    nativeToScVal(to, { type: "address" }),
    nativeToScVal(amount, { type: "i128" }),
  );
  let tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();
  tx = await server.prepareTransaction(tx);
  tx.sign(kp);

  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(
      `Sweep could not be submitted: ${JSON.stringify(sent.errorResult ?? sent.status)}`,
    );
  }
  for (let i = 0; i < 30; i++) {
    const r = await server.getTransaction(sent.hash);
    if (r.status === "SUCCESS") return;
    if (r.status === "FAILED") throw new Error(`Sweep failed on-chain (${sent.hash}).`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Sweep was not confirmed in time (${sent.hash}).`);
}

/**
 * Return a removed attestor's gas to the Operations Vault, then destroy the key.
 *
 * The wallet transfers everything above its base reserve back to the vault — a
 * native-asset transfer to the vault contract, signed by the key we hold. The old
 * design used account-merge, but a merge can only pay a classic account, and the
 * destination now is a contract. The ~1 XLM reserve every account must keep
 * cannot follow the balance there, so it is left behind: the accepted cost of the
 * wallet having existed.
 *
 * The transfer lands before the key is deleted, so a missing vault address fails
 * loudly and leaves the key in place to retry rather than stranding the balance.
 * The key is harmless meanwhile — its attest authority is withdrawn separately.
 */
export async function sweepAndDeleteManaged(keyRef: string): Promise<SweepResult> {
  const secret = await getManagedSecret(keyRef);
  if (!secret) return { swept: "0", note: "no managed key on file" };

  const kp = Keypair.fromSecret(secret);
  const server = new rpc.Server(SOROBAN_RPC_URL);

  const balance = await nativeBalance(server, kp.publicKey());
  const sweepable = balance - SWEEP_RETAIN_STROOPS;

  if (sweepable <= 0n) {
    // Not on the ledger, or only the reserve and cushion left — nothing worth a
    // transaction. Retire the key.
    await deleteManagedSecret(keyRef);
    return { swept: "0", note: "nothing above the reserve; key deleted" };
  }

  const vault = process.env.NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID;
  if (!vault) {
    throw new Error(
      "NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID is not set — refusing to delete a funded managed wallet with nowhere to sweep it.",
    );
  }

  await sacTransfer(server, kp, vault, sweepable);
  await deleteManagedSecret(keyRef);
  return {
    swept: sweepable.toString(),
    destination: vault,
    note: "swept to the operations vault; key deleted (~1 XLM reserve left behind)",
  };
}
