"use client";

import { Asset, Operation, TransactionBuilder, BASE_FEE } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "@/lib/stellar-clients";
import { horizonClient } from "@/lib/stellar";
import { bondAssetFor, tokenBalance, type BondAsset, type TokenBalance } from "@/lib/bond-readiness";
import { freighterSigner } from "@/lib/freighter-signer";
import { FRIENDBOT_URL } from "@/lib/network";

/**
 * Is this wallet ready to stake in a vault, and if not, what one thing is
 * missing?
 *
 * A stake fails for reasons a person has never heard of: the account has never
 * received anything (it does not exist on the network yet), the wallet has not
 * said yes to holding the vault's dollars (a missing trustline), or it holds
 * too little. Each used to surface as a raw contract error after the wallet
 * had already been asked to sign. These reads answer the question first, and
 * the two fixes are ones the person makes themselves:
 *
 *   - activatePractice: the practice network's public faucet sends the first
 *     XLM straight to the person's own address. BLKFNDR holds nothing.
 *   - enableAsset: a trustline, signed in the person's own wallet. It moves
 *     nothing; it lets the wallet hold the asset, and sets aside a small XLM
 *     reserve the person gets back if they remove it.
 *
 * Non-custodial throughout: nothing here holds a key or touches the person's
 * money; every write is signed by their wallet or sent to their address.
 */

/** The native-asset contract, read like any other token for its balance. */
const NATIVE_SAC = Asset.native().contractId(NETWORK_PASSPHRASE);

/** Circle's public test faucet, which pays practice USDC to any address. */
export const PRACTICE_DOLLARS_FAUCET = "https://faucet.circle.com/";

export interface WalletReadiness {
  /** Whether the account exists on the network. */
  account: "ok" | "missing" | "unknown";
  /** Native XLM held, in base units, or null when unknown. */
  xlmRaw: bigint | null;
  /** The asset the vault holds, or null when it could not be read. */
  asset: BondAsset | null;
  /** What the wallet holds of that asset. */
  holding: TokenBalance;
}

/**
 * Read everything the stake gate needs in parallel. Never throws: a read that
 * fails comes back "unknown", which the gate treats as "can't tell" and does
 * not block on, since the vault's own simulation refuses a stake the wallet
 * cannot cover before anything is signed.
 */
export async function readWalletReadiness(
  address: string,
  vaultToken: string,
): Promise<WalletReadiness> {
  const [asset, holding, xlm] = await Promise.all([
    bondAssetFor(vaultToken).catch(() => null),
    tokenBalance(vaultToken, address).catch((): TokenBalance => ({ status: "unknown" })),
    tokenBalance(NATIVE_SAC, address).catch((): TokenBalance => ({ status: "unknown" })),
  ]);

  const account: WalletReadiness["account"] =
    xlm.status === "no-account" || holding.status === "no-account"
      ? "missing"
      : xlm.status === "ok"
        ? "ok"
        : "unknown";

  return {
    account,
    xlmRaw: xlm.status === "ok" ? xlm.raw : account === "missing" ? 0n : null,
    asset,
    holding,
  };
}

/**
 * Ask the practice network's faucet to activate an address with free practice
 * XLM. The faucet pays the address directly. Practice network only.
 */
export async function activatePractice(address: string): Promise<void> {
  if (!FRIENDBOT_URL) {
    throw new Error("Friendbot only exists on Stellar Testnet.");
  }
  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(address)}`);
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  // An address the faucet has already funded is already active.
  if (/already exists|createAccountAlreadyExist|op_already_exists/i.test(body)) return;
  throw new Error(`Friendbot answered ${res.status}. ${body.slice(0, 300)}`);
}

/**
 * Let this wallet hold the vault's asset: a trustline, approved in the
 * person's own wallet and sent to the network from here. Nothing moves; the
 * network sets aside 0.5 XLM of the person's own balance while it exists.
 *
 * Errors keep Horizon's result codes in the message, so explainError can tell
 * "not enough XLM" from anything else.
 */
export async function enableAsset(
  address: string,
  asset: BondAsset,
  /** The wallet's signer. Defaults to the person's own Freighter. */
  signTransaction: (xdr: string) => Promise<{ signedTxXdr: string }> = (xdr) =>
    freighterSigner(address).signTransaction(xdr),
): Promise<string> {
  if (asset.isNative || !asset.issuer) {
    throw new Error("XLM needs no trustline.");
  }
  const account = await horizonClient.loadAccount(address);
  const fee = await horizonClient
    .fetchBaseFee()
    .then((f) => String(Math.max(f, Number(BASE_FEE))))
    .catch(() => BASE_FEE);

  const tx = new TransactionBuilder(account, { fee, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: new Asset(asset.code, asset.issuer) }))
    .setTimeout(300)
    .build();

  const { signedTxXdr } = await signTransaction(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);

  try {
    const result = await horizonClient.submitTransaction(signed);
    return result.hash;
  } catch (error) {
    const codes = (error as { response?: { data?: { extras?: { result_codes?: unknown } } } })
      ?.response?.data?.extras?.result_codes;
    throw new Error(
      `Adding the ${asset.code} trustline was refused by the network. ${codes ? JSON.stringify(codes) : String(error)}`,
    );
  }
}
