"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { useRefreshAfterTx } from "@/context/BlockchainContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { vaultClient, simulate } from "@/lib/stellar-clients";
import { currencyForToken } from "@/lib/currencies";
import { describeMoney, formatToken, rawToUnits } from "@/lib/money";
import { useXlmRate } from "@/lib/xlm-rate";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import { WalletPanel } from "@/components/settings/WalletSettings";
import { MoneyActionPanel } from "@/components/money-action/MoneyActionPanel";
import {
  refundBreakdown,
  VAULT_STATE_FAILED as STATE_FAILED,
  VAULT_STATE_REFUNDING as STATE_REFUNDING,
} from "@/lib/refund";

/**
 * Collecting a refund: why it is due, exactly how much, and one confirm.
 *
 * The amount is worked out the way the vault's claim_refund works it out, from
 * the vault's own figures, so the number on the button is the number that
 * arrives. A vault that missed its goal returns every stake whole (the
 * builder's deposit goes back to the builder separately). A vault whose stage
 * failed, or whose builder went quiet, shares out what is left plus the
 * builder's deposit in proportion to each stake.
 *
 * Refunds are pulled, never pushed: the vault pays only the account that asks.
 * The sheet says so, because that is what keeps anyone else from moving it.
 */

interface VaultFigures {
  state: number;
  raised: bigint;
  released: bigint;
  bond: bigint;
  goal: bigint;
  deadlineMs: number;
  token: string;
  failedStage: number | null;
}

type Read =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; vault: VaultFigures; mine: bigint; linked: bigint | null };

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function RefundSheet({ project, onClose }: { project: Project; onClose: () => void }) {
  const { user } = useAuth();
  const { freighterWalletAddress } = useFreighterWallet();
  const { refreshProject, signInToContinue } = useProjectDetails();
  const refreshAfterTx = useRefreshAfterTx();
  const { prepareClaimRefund } = useStellarContract();
  const { rate: xlmUsd } = useXlmRate();
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  // Set when the refund lands; the panel keeps its success line until Done.
  const succeeded = useRef(false);

  const linkedAddress = user?.stellarPublicKey || "";
  const actingAddress = freighterWalletAddress || linkedAddress;

  const load = useCallback(async () => {
    const vaultAddress = project.vaultAddress;
    if (!vaultAddress || !actingAddress) {
      setRead({ kind: "error" });
      return;
    }
    setRead({ kind: "loading" });
    const client = vaultClient(vaultAddress);
    const [info, state, mine, linked] = await Promise.all([
      simulate(() => client.get_info(), `get_info(${vaultAddress})`),
      simulate(() => client.get_state(), `get_state(${vaultAddress})`),
      simulate(() => client.get_balance({ contributor: actingAddress }), "get_balance(mine)"),
      linkedAddress && linkedAddress !== actingAddress
        ? simulate(() => client.get_balance({ contributor: linkedAddress }), "get_balance(linked)")
        : Promise.resolve(null),
    ]);
    if (!info || state === null || state === undefined || mine === null) {
      setRead({ kind: "error" });
      return;
    }
    const failed = (info.milestones ?? []).find((m: { failed: boolean }) => m.failed);
    setRead({
      kind: "ready",
      vault: {
        state: Number(state),
        raised: BigInt(info.raised_amount),
        released: BigInt(info.released_total),
        bond: BigInt(info.bond_amount),
        goal: BigInt(info.goal),
        deadlineMs: Number(info.deadline) * 1000,
        token: String(info.token),
        failedStage: failed ? Number(failed.id) : null,
      },
      mine: BigInt(mine),
      linked: linked === null || linked === undefined ? null : BigInt(linked),
    });
  }, [project.vaultAddress, actingAddress, linkedAddress]);

  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <div className="flex items-start justify-between gap-3">
      <p className="text-base font-semibold [overflow-wrap:anywhere]">
        Collect your refund from {project.title}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Close the refund sheet"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
  const shell = (children: ReactNode) => (
    <section aria-label="Refund" className="w-full space-y-4 rounded-xl border border-border bg-card p-4 text-left">
      {header}
      {children}
    </section>
  );

  if (!user) {
    return shell(
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Sign in to collect this. Your refund belongs to the wallet that staked.
        </p>
        <Button type="button" className="h-10 w-full" onClick={() => signInToContinue()}>
          Sign in
        </Button>
      </div>,
    );
  }

  if (read.kind === "loading") {
    return shell(
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Working out your refund from the vault…
      </div>,
    );
  }

  if (read.kind === "error") {
    return shell(
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {actingAddress
            ? "We couldn't read the vault's figures right now."
            : "This refund belongs to the wallet that staked. Set up that wallet to collect it."}
        </p>
        {actingAddress ? (
          <Button type="button" variant="outline" className="h-9" onClick={load}>
            Try again
          </Button>
        ) : (
          <WalletPanel />
        )}
      </div>,
    );
  }

  const { vault, mine, linked } = read;
  const currency = currencyForToken(vault.token) ?? project.currencyType ?? "USDC";
  const show = (raw: bigint) => describeMoney(rawToUnits(raw), currency, xlmUsd, "always").primary;
  const exact = (raw: bigint) => formatToken(rawToUnits(raw), currency, "always");

  // Not returning money yet: say why rather than offer a button that fails.
  if (vault.state !== STATE_FAILED && vault.state !== STATE_REFUNDING) {
    return shell(
      <p className="text-sm text-muted-foreground">
        Refunds aren&apos;t open for this vault. If a stage vote ended short, it has to be closed
        first: open the Stages tab and use &ldquo;Close the stage and open refunds&rdquo;. Anyone
        can do that for a small network fee.
      </p>,
    );
  }

  if (mine === 0n && !confirming) {
    const elsewhere = linked !== null && linked > 0n;
    return shell(
      <div className="space-y-2 text-sm text-muted-foreground">
        {elsewhere ? (
          <p>
            Your stake is held by the wallet ending ...{linkedAddress.slice(-4)}, which isn&apos;t the
            one connected now. Switch to that account in your wallet, then reopen this.
          </p>
        ) : (
          <p>
            There&apos;s nothing left to collect for this wallet: the money already came back to you,
            or this wallet didn&apos;t stake here.
          </p>
        )}
        <Button type="button" variant="outline" className="h-9" onClick={onClose}>
          Close
        </Button>
      </div>,
    );
  }

  // The vault's own arithmetic, in base units, truncating like the contract.
  const breakdown = refundBreakdown(vault.state, mine, vault.raised, vault.released, vault.bond);
  const fullRefund = breakdown.full;
  const depositShare = breakdown.depositShare;
  const comingBack = breakdown.total;
  const paidOut = breakdown.paidOut;

  const reason = fullRefund
    ? `The project didn't reach its ${show(vault.goal)} goal by ${shortDate(vault.deadlineMs)}, so every stake comes back in full.`
    : vault.failedStage !== null
      ? `Stage ${vault.failedStage} wasn't approved, so what's left in the vault plus the builder's deposit is shared out among stakeholders in proportion to their stakes.`
      : "The builder went quiet for 90 days, so the vault's 90-day rule closed the project. Anyone could trigger that step, and nobody could decide it. What's left plus the builder's deposit is shared out.";

  return shell(
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{reason}</p>

      <dl className="divide-y divide-border/60 rounded-xl border border-border bg-muted/20 text-sm">
        <div className="flex justify-between gap-3 px-3 py-2">
          <dt className="text-muted-foreground">Your stake</dt>
          <dd className="font-medium">{show(mine)}</dd>
        </div>
        {!fullRefund && paidOut > 0n && (
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">Your part of what was already paid to the builder</dt>
            <dd className="font-medium">−{show(paidOut)}</dd>
          </div>
        )}
        {!fullRefund && depositShare > 0n && (
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">Your share of the builder&apos;s deposit</dt>
            <dd className="font-medium">+{show(depositShare)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 px-3 py-2">
          <dt className="font-medium text-foreground">Coming back to you</dt>
          <dd className="font-semibold">{show(comingBack)}</dd>
        </div>
      </dl>

      {!fullRefund && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-primary">How this is worked out</summary>
          <p className="mt-1.5">
            The vault takes your stake as a share of everything staked. You get that share of what
            is still in the vault, and the same share of the builder&apos;s deposit. The last
            stakeholder to collect also gets any fractions of a cent left over from rounding.
          </p>
        </details>
      )}

      <p className="text-sm text-muted-foreground">
        Refunds aren&apos;t pushed to you automatically. The vault only pays an account that asks,
        which is what stops anyone else from ever moving your money. Confirm once in your wallet and
        it&apos;s yours within seconds.
      </p>

      {confirming ? (
        <MoneyActionPanel
          context={{ action: "refund" }}
          title="Collect your refund"
          sentence={`This moves ${show(comingBack)} from the ${project.title} vault to your wallet.`}
          rows={[{ label: "Coming back to you", value: show(comingBack) }]}
          walletShows={`a refund request: ${exact(comingBack)} comes to you`}
          prepare={() => prepareClaimRefund({ vaultAddress: project.vaultAddress! })}
          successTitle="Your refund is in your wallet."
          successBody={
            IS_PRACTICE_NETWORK
              ? "It's there as practice dollars. Practice money can't be cashed out, but you can stake it again."
              : "It's in your wallet. You can stake it in another project, keep it, or move it out."
          }
          onSuccess={() => {
            succeeded.current = true;
            refreshProject(project.id);
            refreshAfterTx(freighterWalletAddress ?? undefined);
          }}
          onClose={() => {
            if (succeeded.current) onClose();
            else setConfirming(false);
          }}
        />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="button" className="h-10 flex-1" onClick={() => setConfirming(true)}>
            Collect {show(comingBack)}
          </Button>
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onClose}>
            Not now
          </Button>
        </div>
      )}
    </div>,
  );
}
