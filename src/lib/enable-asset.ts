import { Asset, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { horizonClient } from "@/lib/stellar";
import { NETWORK_PASSPHRASE } from "@/lib/stellar-clients";
import { freighterSigner } from "@/lib/freighter-signer";
import { spendableXlm, type BondAsset } from "@/lib/bond-readiness";

/**
 * Let a wallet hold an asset: one ChangeTrust, approved by its owner.
 *
 * A wallet that has never held USDC cannot receive or send it, so a builder
 * without a trustline could not post a bond and a backer could not stake. The
 * dialog used to explain where to add it inside Freighter; this asks Freighter
 * to do exactly that, for exactly the asset the vault uses -- issuer included,
 * since one wallet can hold several assets all called USDC.
 *
 * It stays the owner's decision. The transaction is built here and signed in
 * their wallet, where they see what it changes; BLKFNDR signs nothing for them
 * and holds no key (owner decision, non-custodial).
 */

/** XLM a new trustline sets aside as reserve on the account. */
export const TRUSTLINE_RESERVE_XLM = 0.5;

/** A refusal from Horizon, put into words. */
function describeSubmitError(error: unknown, code: string): string {
  const codes = (error as {
    response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } };
  })?.response?.data?.extras?.result_codes;
  const op = codes?.operations?.[0];
  if (op === "op_low_reserve") {
    return `Adding ${code} sets aside ${TRUSTLINE_RESERVE_XLM} XLM on your account, and the wallet doesn't have that much free. Add XLM in Freighter, then try again.`;
  }
  if (codes?.transaction === "tx_bad_seq") {
    return "Your wallet sent another transaction at the same moment. Try again.";
  }
  if (codes?.transaction === "tx_insufficient_balance") {
    return "The wallet doesn't have enough XLM for the network fee. Add XLM in Freighter, then try again.";
  }
  if (codes?.transaction === "tx_too_late") {
    return "The approval took too long and expired. Try again.";
  }
  return `${code} couldn't be added. Nothing was changed. Try again, or add it in Freighter under Manage Assets.`;
}

/**
 * Add a trustline for `asset` to `publicKey`'s wallet. Resolves with the
 * transaction hash; throws FreighterDeclined if the owner declines, or an
 * Error whose message can be shown as is.
 */
export async function enableAsset(publicKey: string, asset: BondAsset): Promise<string> {
  if (asset.isNative || !asset.issuer) {
    throw new Error("XLM needs no setup: every funded wallet can hold it.");
  }

  const spendable = await spendableXlm(publicKey);
  if (spendable !== null && spendable < TRUSTLINE_RESERVE_XLM + 0.0001) {
    throw new Error(
      `Adding ${asset.code} sets aside ${TRUSTLINE_RESERVE_XLM} XLM on your account, and you can spend ${spendable.toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM. Add XLM in Freighter, then try again.`,
    );
  }

  const account = await horizonClient.loadAccount(publicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: new Asset(asset.code, asset.issuer) }))
    .setTimeout(180)
    .build();

  // Throws FreighterDeclined if the owner says no or the window times out.
  const { signedTxXdr } = await freighterSigner(publicKey).signTransaction(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);

  try {
    const result = await horizonClient.submitTransaction(signed);
    return result.hash;
  } catch (error) {
    console.error("[enableAsset] submit failed:", error);
    throw new Error(describeSubmitError(error, asset.code));
  }
}
