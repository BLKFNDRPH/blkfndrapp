import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, SOROBAN_RPC_URL } from "@/lib/stellar-clients";
import { horizonClient } from "@/lib/stellar";

/**
 * Can this builder actually post the bond?
 *
 * Constructing a vault pulls the builder's bond with a token transfer, in the
 * same call that creates it (contracts/blkfndr-vault/src/lib.rs). A classic
 * Stellar asset can only be held through a trustline, so a builder who has
 * never held USDC has nowhere for that transfer to land: the call traps inside
 * the token contract and the whole deployment fails at simulation, showing a
 * raw host diagnostic and no way forward.
 *
 * That surfaced as `HostError: Error(Contract, #13)` -- the Stellar Asset
 * Contract's TrustlineMissingError. Worth being precise about, because #13 in
 * *our* vault is MilestoneNotFound: the number only means a trustline when the
 * token contract is the one that threw, so it must never be mapped on its own.
 *
 * Checking here turns that dead end into something the builder can act on
 * before signing anything.
 */

/** The asset a vault's token contract actually moves. */
export interface BondAsset {
  /** Classic asset code, or "XLM" for the native asset. */
  code: string;
  /** Issuer G-address. Null for the native asset, which has none. */
  issuer: string | null;
  isNative: boolean;
}

export type BondReadiness =
  | { ok: true }
  | { ok: false; reason: "no-account"; asset: BondAsset }
  | { ok: false; reason: "no-trustline"; asset: BondAsset }
  | {
      ok: false;
      reason: "insufficient";
      asset: BondAsset;
      /** What the wallet holds, or null when only the network's refusal is known. */
      held: number | null;
      bond: number;
      /** The flat listing fee, taken in the same asset in the same call. */
      fee: number;
    }
  | {
      ok: false;
      reason: "network-fee";
      /** XLM the wallet can spend: its balance less the reserve the network holds back. */
      spendable: number;
      /** The most the launch can charge in XLM, as Freighter will show it. */
      needed: number;
    };

/** The XLM asset, for messages about the network fee. */
export const XLM_ASSET: BondAsset = { code: "XLM", issuer: null, isNative: true };

/**
 * All-zero ed25519 key. Simulation needs a source account but never charges or
 * authorises one, and using the builder's own would fail for a wallet that has
 * no ledger entry yet -- exactly the person this check exists for.
 */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Simulate a read on a token contract. A refusal comes back as the host's own
 * diagnostic text, which callers match on; a network failure throws.
 */
async function readToken(
  tokenAddress: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<{ value: unknown } | { error: string }> {
  const server = new rpc.Server(SOROBAN_RPC_URL);
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(tokenAddress).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return { error: sim.error };
  if (!sim.result) return { error: "The simulation returned no result." };
  return { value: scValToNative(sim.result.retval) };
}

/**
 * Ask the token contract which asset it is.
 *
 * A Stellar Asset Contract reports `name()` as "CODE:ISSUER", or "native" for
 * XLM. Reading it from the contract rather than from configuration keeps this
 * working off the token address already in use, with no second source of truth
 * to keep in step -- and no new NEXT_PUBLIC_* variable, which would need a
 * Docker rebuild before it held anything on a deployed site.
 *
 * Returns null when the answer cannot be obtained, which callers treat as
 * "cannot tell" rather than "not ready".
 */
export async function bondAssetFor(tokenAddress: string): Promise<BondAsset | null> {
  try {
    const read = await readToken(tokenAddress, "name");
    if ("error" in read) return null;

    const name = String(read.value);
    if (name === "native") return { code: "XLM", issuer: null, isNative: true };

    const [code, issuer] = name.split(":");
    if (!code || !issuer) return null;
    return { code, issuer, isNative: false };
  } catch {
    return null;
  }
}

/** What a token contract says a wallet holds, or why it cannot hold any. */
export type TokenBalance =
  | { status: "ok"; raw: bigint }
  | { status: "no-trustline" }
  | { status: "no-account" }
  | { status: "unknown" };

/**
 * How much of a token a wallet holds, asked of the token contract itself.
 *
 * Horizon lists a wallet's balances by asset code, and one wallet can hold
 * several assets that are all called USDC, each from a different issuer. Taking
 * the first "USDC" line read 0 for a wallet whose first line was another
 * issuer's while it held thousands of the USDC the vault takes, and refused a
 * stake it could cover. `balance(address)` on the vault's own token contract
 * answers for exactly the asset a stake moves, in base units.
 *
 * The contract refuses rather than answering 0 when the wallet has no
 * trustline for the asset, or no account at all. Both are told apart by the
 * host's diagnostic text, never by the bare error number, for the reason given
 * in src/lib/launch-errors.ts. Anything else, network failures included, is
 * "unknown", which callers treat as "cannot tell" rather than "has nothing".
 */
export async function tokenBalance(
  tokenAddress: string,
  holder: string,
): Promise<TokenBalance> {
  try {
    const read = await readToken(tokenAddress, "balance", new Address(holder).toScVal());
    if ("error" in read) {
      if (/trustline entry is missing/i.test(read.error)) {
        // An issued asset checks the trustline first, so a wallet with no
        // account at all gets the same answer. It cannot add a trustline until
        // it is funded, so it needs different words.
        return (await accountMissing(holder)) ? { status: "no-account" } : { status: "no-trustline" };
      }
      if (/account entry is missing/i.test(read.error)) return { status: "no-account" };
      return { status: "unknown" };
    }
    return { status: "ok", raw: BigInt(read.value as bigint) };
  } catch {
    return { status: "unknown" };
  }
}

/** True only when the network says the account does not exist. */
async function accountMissing(holder: string): Promise<boolean> {
  try {
    await new rpc.Server(SOROBAN_RPC_URL).getAccount(holder);
    return false;
  } catch (error) {
    return /account not found/i.test(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Whether the builder holds the asset, and enough of it, to post the bond and
 * pay the flat listing fee.
 *
 * Both leave the wallet in the same call, in the vault's asset. Checking the
 * bond alone passed a wallet that held the bond but not bond plus fee, which
 * then failed on the network with the token's balance error.
 *
 * Fails open. If the RPC or Horizon cannot answer, this reports ready and lets
 * the chain decide: a check that cannot reach the network should not be the
 * thing standing between a builder and a vault they are perfectly able to
 * deploy. The simulation that follows refuses an uncoverable launch anyway,
 * and its refusal is put into the same words (src/lib/launch-errors.ts).
 */
export async function checkBondReadiness(
  publicKey: string,
  tokenAddress: string,
  bondAmount: number,
  platformFee = 0,
): Promise<BondReadiness> {
  const asset = await bondAssetFor(tokenAddress);
  if (!asset) return { ok: true };

  let account: HorizonAccount;
  try {
    account = await horizonClient.loadAccount(publicKey);
  } catch (error) {
    // An unfunded wallet has no ledger entry at all, which is a different
    // problem from a missing trustline and needs different words.
    if ((error as { response?: { status?: number } })?.response?.status === 404) {
      return { ok: false, reason: "no-account", asset };
    }
    return { ok: true };
  }

  const balances = account.balances as unknown as Array<Record<string, string>>;
  const held = balances.find((b) =>
    asset.isNative
      ? b.asset_type === "native"
      : b.asset_code === asset.code && b.asset_issuer === asset.issuer,
  );

  if (!held) return { ok: false, reason: "no-trustline", asset };

  // For XLM, what can move is the balance less the reserve, not the balance.
  const available = asset.isNative ? spendableNative(held, accountReserve(account)) : Number(held.balance);
  if (available < bondAmount + platformFee) {
    return { ok: false, reason: "insufficient", asset, held: available, bond: bondAmount, fee: platformFee };
  }

  return { ok: true };
}

/** Base reserve on Stellar, in XLM, per ledger entry an account owns. */
const BASE_RESERVE_XLM = 0.5;

type HorizonAccount = Awaited<ReturnType<typeof horizonClient.loadAccount>>;

/** The XLM the network holds back from an account: two base reserves, plus one per entry it owns. */
function accountReserve(account: HorizonAccount): number {
  const a = account as unknown as {
    subentry_count?: number;
    num_sponsoring?: number;
    num_sponsored?: number;
  };
  const entries = 2 + (a.subentry_count ?? 0) + (a.num_sponsoring ?? 0) - (a.num_sponsored ?? 0);
  return entries * BASE_RESERVE_XLM;
}

function spendableNative(line: Record<string, string>, reserve: number): number {
  const selling = Number(line.selling_liabilities ?? 0);
  return Math.max(0, Number(line.balance) - reserve - selling);
}

/**
 * XLM this wallet can spend right now, or null when that cannot be read.
 *
 * Every launch pays its network fee in XLM, whatever the vault's asset, and
 * the network will not dip into the reserve to pay it.
 */
export async function spendableXlm(publicKey: string): Promise<number | null> {
  try {
    const account = await horizonClient.loadAccount(publicKey);
    const balances = account.balances as unknown as Array<Record<string, string>>;
    const native = balances.find((b) => b.asset_type === "native");
    return native ? spendableNative(native, accountReserve(account)) : null;
  } catch {
    return null;
  }
}
