"use client";

import { useState } from "react";
import { Check, CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import {
  activatePractice,
  enableAsset,
  PRACTICE_DOLLARS_FAUCET,
  type WalletReadiness,
} from "@/lib/wallet-readiness";
import { explainError } from "@/lib/explain-error";

/**
 * Where a connected wallet stands for this stake, as one state.
 *
 * "unknown" does not block: when the wallet cannot be read, the vault's own
 * simulation still refuses a stake the wallet cannot cover, before anything is
 * signed.
 */
export type ReadinessState =
  | "loading"
  | "unknown"
  | "no-account"
  | "no-trustline"
  | "short"
  | "ready";

export function readinessState(
  readiness: WalletReadiness | null,
  loading: boolean,
  needRaw: bigint | null,
): ReadinessState {
  if (loading || !readiness) return "loading";
  if (readiness.account === "missing" || readiness.holding.status === "no-account") return "no-account";
  if (readiness.holding.status === "no-trustline") return "no-trustline";
  if (readiness.holding.status === "unknown") return "unknown";
  if (needRaw !== null && readiness.holding.raw < needRaw) return "short";
  return "ready";
}

export function gatePasses(state: ReadinessState): boolean {
  return state === "ready" || state === "unknown";
}

export function WalletReadinessCard({
  address,
  readiness,
  state,
  needRaw,
  isDollar,
  display,
  onRefresh,
}: {
  address: string;
  readiness: WalletReadiness | null;
  state: ReadinessState;
  needRaw: bigint | null;
  isDollar: boolean;
  /** Base units in the vault's currency, as a person reads them. */
  display: (raw: bigint) => string;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<null | "activate" | "enable">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The address is shown under "Show full address" in the wallet panel too.
    }
  };

  const activate = async () => {
    setBusy("activate");
    setProblem(null);
    try {
      await activatePractice(address);
      onRefresh();
    } catch (error) {
      setProblem(explainError(error, { action: "activate" }).body);
    } finally {
      setBusy(null);
    }
  };

  const enable = async () => {
    if (!readiness?.asset) return;
    setBusy("enable");
    setProblem(null);
    try {
      await enableAsset(address, readiness.asset);
      onRefresh();
    } catch (error) {
      const out = explainError(error, { action: "enable-dollars" });
      setProblem(`${out.body} ${out.moneyLine}`);
    } finally {
      setBusy(null);
    }
  };

  const accountId = (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">Wallet address</span>
      <span className="font-mono">...{address.slice(-4)}</span>
      <button
        type="button"
        onClick={copyId}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );

  const checkAgain = (
    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRefresh}>
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      Check again
    </Button>
  );

  if (state === "loading") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking your wallet…
      </div>
    );
  }

  if (state === "ready") {
    const held = readiness?.holding.status === "ok" ? display(readiness.holding.raw) : null;
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Wallet ready{held ? ` · ${held} in your wallet` : ""}</span>
      </div>
    );
  }

  if (state === "unknown") {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        We can&apos;t read your wallet right now. You can still continue; your wallet will show the
        final amount before you sign.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-left">
      <p className="font-semibold text-foreground">Get your wallet ready</p>

      {state === "no-account" && (
        <div className="space-y-2 text-sm">
          <p className="font-medium text-foreground">Activate your Stellar account</p>
          {IS_PRACTICE_NETWORK ? (
            <>
              <p className="text-muted-foreground">
                A new Stellar account isn&apos;t on the ledger until it receives its first XLM.
                Friendbot, the Stellar Testnet faucet, funds your account with testnet XLM, which
                activates it on the ledger and pays network fees. It goes straight to your wallet.
              </p>
              <Button type="button" className="h-9" onClick={activate} disabled={busy !== null}>
                {busy === "activate" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {busy === "activate" ? "Activating…" : "Get testnet XLM"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">
                A new Stellar account isn&apos;t on the ledger until it receives its first XLM. Send
                a little XLM to your wallet address from another wallet or an exchange to activate it.
              </p>
              <p className="text-sm">{accountId}</p>
            </>
          )}
        </div>
      )}

      {state === "no-trustline" && (
        <div className="space-y-2 text-sm">
          <p className="font-medium text-foreground">
            {isDollar ? "Your wallet has no USDC trustline yet" : "Your wallet has no trustline for this asset yet"}
          </p>
          <p className="text-muted-foreground">
            A trustline lets your Stellar account hold {isDollar ? "dollars (USDC)" : readiness?.asset?.code ?? "it"};{" "}
            nobody can send {isDollar ? "them" : "it"} to you without one. You&apos;ll sign this once in
            your wallet. It costs under a cent and reserves 0.5 XLM of your own while the trustline
            exists, which you get back if you remove it. Nothing goes to BLKFNDR.
          </p>
          <Button type="button" className="h-9" onClick={enable} disabled={busy !== null || !readiness?.asset}>
            {busy === "enable" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {busy === "enable" ? "Waiting for your wallet…" : isDollar ? "Add a USDC trustline" : "Add a trustline"}
          </Button>
        </div>
      )}

      {state === "short" && readiness?.holding.status === "ok" && needRaw !== null && (
        <div className="space-y-2 text-sm">
          <p className="font-medium text-foreground">
            Your wallet has {display(readiness.holding.raw)}; this stake needs {display(needRaw)}.
          </p>
          {isDollar && IS_PRACTICE_NETWORK ? (
            <>
              <p className="text-muted-foreground">
                Circle, the company behind USDC, gives testnet USDC for free. On their page pick
                Stellar Testnet, paste your wallet address (this button copies it), and press Send.
                You get 20 testnet USDC every 2 hours, straight to your wallet. Then come back and
                press Check again.
              </p>
              <Button
                type="button"
                className="h-9 gap-1.5"
                onClick={() => {
                  copyId();
                  window.open(PRACTICE_DOLLARS_FAUCET, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Get testnet USDC
              </Button>
              <p className="text-xs">{accountId}</p>
            </>
          ) : isDollar ? (
            <>
              <p className="text-muted-foreground">
                Add USDC to your wallet from an exchange, sending it on the Stellar network to your
                wallet address. It goes straight to your wallet. Or stake a smaller amount.
              </p>
              <p className="text-xs">{accountId}</p>
            </>
          ) : (
            <p className="text-muted-foreground">Stake a smaller amount, or add XLM to your wallet.</p>
          )}
        </div>
      )}

      {problem && <p className="text-sm text-destructive">{problem}</p>}
      <div className="flex justify-end">{checkAgain}</div>
    </div>
  );
}
