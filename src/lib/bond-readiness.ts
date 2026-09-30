import {
  Account,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
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
  | { ok: false; reason: "insufficient"; asset: BondAsset; held: string; needed: string };

/**
 * All-zero ed25519 key. Simulation needs a source account but never charges or
 * authorises one, and using the builder's own would fail for a wallet that has
 * no ledger entry yet -- exactly the person this check exists for.
 */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

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
    const server = new rpc.Server(SOROBAN_RPC_URL);
    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(tokenAddress).call("name"))
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result) return null;

    const name = String(scValToNative(sim.result.retval));
    if (name === "native") return { code: "XLM", issuer: null, isNative: true };

    const [code, issuer] = name.split(":");
    if (!code || !issuer) return null;
    return { code, issuer, isNative: false };
  } catch {
    return null;
  }
}

/**
 * Whether the builder holds the asset, and enough of it, to post the bond.
 *
 * Fails open. If the RPC or Horizon cannot answer, this reports ready and lets
 * the chain decide: a check that cannot reach the network should not be the
 * thing standing between a builder and a vault they are perfectly able to
 * deploy. It exists to explain a specific, predictable dead end, not to become
 * a second gate that can fail on its own.
 */
export async function checkBondReadiness(
  publicKey: string,
  tokenAddress: string,
  bondAmount: number,
): Promise<BondReadiness> {
  const asset = await bondAssetFor(tokenAddress);
  if (!asset) return { ok: true };

  let balances: Array<Record<string, string>>;
  try {
    const account = await horizonClient.loadAccount(publicKey);
    balances = account.balances as unknown as Array<Record<string, string>>;
  } catch (error) {
    // An unfunded wallet has no ledger entry at all, which is a different
    // problem from a missing trustline and needs different words.
    if ((error as { response?: { status?: number } })?.response?.status === 404) {
      return { ok: false, reason: "no-account", asset };
    }
    return { ok: true };
  }

  const held = balances.find((b) =>
    asset.isNative
      ? b.asset_type === "native"
      : b.asset_code === asset.code && b.asset_issuer === asset.issuer,
  );

  if (!held) return { ok: false, reason: "no-trustline", asset };

  if (Number(held.balance) < bondAmount) {
    return {
      ok: false,
      reason: "insufficient",
      asset,
      held: held.balance,
      needed: String(bondAmount),
    };
  }

  return { ok: true };
}

/**
 * Whether a failed deployment failed for want of a trustline.
 *
 * Keyed on the host's own diagnostic text, never on the bare error number: a
 * contract error code only means anything alongside the contract that raised
 * it, and #13 is MilestoneNotFound in the vault.
 */
export function looksLikeMissingTrustline(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}` : String(error);
  return /trustline/i.test(text);
}
