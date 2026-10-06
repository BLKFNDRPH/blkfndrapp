"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyKycStatus } from "@/app/actions";
import { identityClient, simulate } from "@/lib/stellar-clients";
import {
  bondAssetFor,
  spendableXlm,
  tokenBalance,
  type BondAsset,
} from "@/lib/bond-readiness";
import { activatePractice, enableAsset } from "@/lib/wallet-readiness";
import { explainError } from "@/lib/explain-error";
import { describeMoney, formatToken } from "@/lib/money";

/**
 * Where a builder stands before a vault can open: identity, a wallet, and
 * enough in it. Read live, shown in "Before you begin" and the cost card, and
 * listed again if they press Review with something still missing.
 *
 * These reads are a convenience, not the gate. The launch itself still checks
 * identity on the record and the deposit against the wallet, and the network's
 * simulation refuses anything they miss, before anything is signed. So a read
 * that fails is "unknown", and unknown never blocks.
 */

/**
 * What opening a vault charges in network fees on a normal day, in XLM, for a
 * plan with this many stages. Simulated on the practice network on 6 Oct 2026,
 * the same for both currencies: 0.57 XLM for one stage, 0.61 for two, 0.76
 * for five, 1.00 for ten, 1.48 for twenty, so about 0.52 plus 0.05 a stage,
 * rounded up. The simulated figure is the most it can charge; the network
 * refunds what it doesn't use. The review shows the exact one.
 */
export function openingFeeXlm(stages: number): number {
  return 0.52 + 0.05 * Math.max(1, stages);
}

/**
 * A fee far above the usual one. It happens when storage every vault shares
 * has lapsed and this opening pays to renew it (QA met 172 XLM once).
 */
export function isUnusualOpeningFee(feeXlm: number, stages: number): boolean {
  return feeXlm > Math.max(5, 3 * openingFeeXlm(stages));
}

export type IdentityStatus = "loading" | "signed-out" | "none" | "pending" | "rejected" | "verified" | "unknown";

/** What the wallet holds, read once per wallet and currency. */
export type WalletHoldings =
  | { state: "loading" }
  | { state: "no-wallet" }
  | { state: "unknown" }
  | { state: "no-account"; asset: BondAsset | null }
  | { state: "no-trustline"; asset: BondAsset }
  | {
      state: "read";
      asset: BondAsset | null;
      /** What the wallet can put toward the deposit and listing fee, in the vault's currency. */
      held: number | null;
      /** XLM the wallet can spend, after the reserve the network holds back. */
      xlm: number | null;
    };

/** The holdings measured against what this opening needs. */
export type FundsView =
  | { state: "loading" | "no-wallet" | "unknown" | "signed-out" }
  | { state: "no-account" }
  | { state: "no-trustline"; asset: BondAsset }
  | { state: "short"; held: number; shortBy: number }
  | { state: "fee-short"; xlm: number }
  | { state: "ready"; held: number | null; xlm: number | null };

export function fundsView(
  holdings: WalletHoldings,
  needed: number,
  currency: string,
  /** The network fee this opening is expected to need, in XLM. */
  feeXlm: number,
): FundsView {
  switch (holdings.state) {
    case "loading":
    case "no-wallet":
    case "unknown":
      return { state: holdings.state };
    case "no-account":
      return { state: "no-account" };
    case "no-trustline":
      return { state: "no-trustline", asset: holdings.asset };
  }
  const { held, xlm } = holdings;
  if (held !== null && held < needed) return { state: "short", held, shortBy: needed - held };
  // The network fee is paid in XLM whatever the vault holds; for an XLM vault
  // it comes out of what is left after the deposit and listing fee.
  const xlmLeft = xlm === null ? null : xlm - (currency === "XLM" ? needed : 0);
  if (xlmLeft !== null && xlmLeft < feeXlm) return { state: "fee-short", xlm: Math.max(0, xlmLeft) };
  return { state: "ready", held, xlm };
}

/**
 * An amount in the vault's currency as a builder reads it: "$250.00" for
 * dollars, "1,000 XLM (≈ $250)" for XLM when a rate is known.
 */
export function launchMoney(amount: number, currency: string, xlmUsd: number | null): string {
  // The practice network's flat listing fee is 300 base units, 0.00003: to the
  // cent that reads "$0.00", which looks like a fee that isn't there.
  if (amount > 0 && amount < 0.01) {
    return currency.toUpperCase() === "XLM" ? `${Number(amount.toPrecision(2))} XLM` : "less than $0.01";
  }
  const view = describeMoney(amount, currency, xlmUsd, "always");
  if (currency.toUpperCase() === "XLM") {
    return view.approx && view.secondary ? `${view.secondary} (${view.primary})` : formatToken(amount, "XLM");
  }
  return view.primary;
}

/** "0.5 XLM (≈ $0.10)": a network fee, with cents, since it is small. */
export function networkFeeMoney(xlm: number, xlmUsd: number | null): string {
  const figure = formatToken(Number(xlm.toPrecision(2)), "XLM");
  if (!xlmUsd) return figure;
  const usd = xlm * xlmUsd;
  return `${figure} (≈ ${usd < 0.01 ? "under 1¢" : `$${usd.toFixed(2)}`})`;
}

export function useLaunchReadiness({
  signedIn,
  address,
  tokenAddress,
}: {
  signedIn: boolean;
  /** The wallet the vault would open from, or null when there is none. */
  address: string | null;
  /** The vault currency's token contract, or null when it isn't configured. */
  tokenAddress: string | null;
}) {
  const [identity, setIdentity] = useState<IdentityStatus>("loading");
  const [holdings, setHoldings] = useState<WalletHoldings>({ state: "loading" });
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState<null | "activate" | "enable">(null);
  const [fixProblem, setFixProblem] = useState<string | null>(null);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  // Identity: the account's own submission, and the public record for the
  // wallet. The record is what the vault checks, so it decides "verified".
  useEffect(() => {
    if (!signedIn) {
      setIdentity("signed-out");
      return;
    }
    let active = true;
    (async () => {
      const res = await getMyKycStatus().catch(() => null);
      const submitted = res && res.success ? res.request?.status ?? "none" : null;
      let onRecord: boolean | null = false;
      if (address) {
        // simulate answers null when the record can't be read, which is not
        // the same as "not verified".
        const read = await simulate(
          () => identityClient().is_kyc_approved({ address }),
          `is_kyc_approved(${address})`,
        );
        onRecord = read === null ? null : Boolean(read);
      }
      if (!active) return;
      if (onRecord) setIdentity("verified");
      else if (submitted === "rejected") setIdentity("rejected");
      else if (submitted === "pending" || submitted === "approved") setIdentity("pending");
      else if (submitted === "none" && onRecord === false) setIdentity("none");
      else setIdentity("unknown");
    })();
    return () => {
      active = false;
    };
  }, [signedIn, address, generation]);

  // The wallet: does it exist, can it hold the vault's currency, and how much
  // of it and of XLM can it spend.
  useEffect(() => {
    if (!address) {
      setHoldings({ state: "no-wallet" });
      return;
    }
    if (!tokenAddress) {
      setHoldings({ state: "unknown" });
      return;
    }
    let active = true;
    setHoldings({ state: "loading" });
    (async () => {
      const [asset, balance, xlm] = await Promise.all([
        bondAssetFor(tokenAddress).catch(() => null),
        tokenBalance(tokenAddress, address).catch(() => ({ status: "unknown" as const })),
        spendableXlm(address),
      ]);
      if (!active) return;
      if (balance.status === "no-account") {
        setHoldings({ state: "no-account", asset });
      } else if (balance.status === "no-trustline" && asset) {
        setHoldings({ state: "no-trustline", asset });
      } else if (balance.status === "unknown" && xlm === null) {
        setHoldings({ state: "unknown" });
      } else {
        const held = asset?.isNative
          ? xlm
          : balance.status === "ok"
            ? Number(balance.raw) / 10_000_000
            : null;
        setHoldings({ state: "read", asset, held, xlm });
      }
    })();
    return () => {
      active = false;
    };
  }, [address, tokenAddress, generation]);

  /** Activate a new wallet with practice XLM from the network's faucet. */
  const activate = useCallback(async () => {
    if (!address) return;
    setBusy("activate");
    setFixProblem(null);
    try {
      await activatePractice(address);
      refresh();
    } catch (error) {
      setFixProblem(explainError(error, { action: "activate" }).body);
    } finally {
      setBusy(null);
    }
  }, [address, refresh]);

  /** Let the wallet hold the vault's currency, approved in the wallet. */
  const enable = useCallback(
    async (asset: BondAsset) => {
      if (!address) return;
      setBusy("enable");
      setFixProblem(null);
      try {
        await enableAsset(address, asset);
        refresh();
      } catch (error) {
        const out = explainError(error, { action: "enable-dollars" });
        setFixProblem(`${out.body} ${out.moneyLine}`.trim());
      } finally {
        setBusy(null);
      }
    },
    [address, refresh],
  );

  return { identity, holdings, refresh, activate, enable, busy, fixProblem };
}

export type LaunchReadiness = ReturnType<typeof useLaunchReadiness>;
