"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { EXPLORER_BASE, EXPLORER_EXPLAINER, IS_PRACTICE_NETWORK } from "@/lib/network";
import { isWalletNotDetected } from "@/lib/freighter-connect";
import { WalletSetupFlow } from "@/components/wallet/WalletSetupFlow";

/**
 * The wallet panel, shared by the header's wallet dialog, the profile's Wallet
 * tab, Settings, and every sheet that needs a wallet to confirm something.
 *
 * Someone with no wallet on their account gets the guided setup
 * (WalletSetupFlow, the Phase 1 shell of the brief's wizard). Someone whose
 * wallet is linked but not connected in this browser gets one button,
 * "Reconnect". Connected, it shows the account ID and the way to disconnect.
 * Nothing here moves money; connecting proves control of a wallet and links it
 * to the account.
 */

export const WALLET_EXPLAINER =
  "A wallet holds the key to your money. It lives on your device, not with BLKFNDR. You'll use it to confirm each stake, vote and refund.";

const FREIGHTER_SITE = "https://freighter.app";

const INSTALL_STEPS = [
  "Install Freighter from freighter.app (free, in Chrome, Firefox, Brave or Edge).",
  "Create a new wallet and set a password.",
  "Write down the recovery words on paper and keep them safe; nobody can restore them for you.",
  ...(IS_PRACTICE_NETWORK ? ["Switch the wallet to the test network."] : []),
  "Come back here and press Check again.",
];

/** The neutral status chip: a to-do, never a fault. */
export function WalletChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden="true" />
      {label}
    </span>
  );
}

/** "Practice network", or nothing at all on the main network. */
export function PracticeNetworkBadge() {
  if (!IS_PRACTICE_NETWORK) return null;
  return (
    <Badge className="border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-300">
      Practice network
    </Badge>
  );
}

type Failure =
  | { kind: "not-detected" }
  | { kind: "other"; message: string };

interface WalletPanelProps {
  /** Offer the link to the profile's wallet tab (the header dialog does). */
  showProfileLink?: boolean;
  /** What the wallet is for, shown in the setup flow's header: "to stake in Solar Pump". */
  purpose?: string;
  /** "Do this later" in the setup flow, where there is somewhere to go back to. */
  onLater?: () => void;
  /** Where the setup flow's last step continues to, and its label. */
  doneHref?: string;
  doneLabel?: string;
}

export function WalletPanel({
  showProfileLink = false,
  purpose,
  onLater,
  doneHref,
  doneLabel,
}: WalletPanelProps) {
  const { user, login, refreshUser } = useAuth();
  const {
    freighterWalletAddress,
    login: connectWallet,
    disconnectWallet,
  } = useFreighterWallet();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showFullId, setShowFullId] = useState(false);
  const [copied, setCopied] = useState(false);
  // Held from the moment the wallet's windows open until the person leaves the
  // last step: linking sets the address mid-flow, and without this the panel
  // would swap to its connected view and skip "done".
  const [flowHeld, setFlowHeld] = useState(false);
  // A phone has no browser extensions, so the install checklist would be a
  // dead end there. Touch without hover is the closest the browser can say.
  const isPhone = useMediaQuery("(hover: none) and (pointer: coarse)");

  // The wallet in use, never the account's linked one: this is where the app
  // says a wallet is connected and offers to disconnect it, and with nothing
  // connected every transaction asks to connect first.
  const activeAddress: string = freighterWalletAddress || "";
  const linkedAddress: string = user?.stellarPublicKey || "";
  const hasLinkedWallet = Boolean(linkedAddress);

  useEffect(() => {
    setShowFullId(false);
    setCopied(false);
  }, [activeAddress]);

  const handleConnect = async () => {
    if (!user) {
      login();
      return;
    }
    setIsConnecting(true);
    setFailure(null);
    try {
      await connectWallet();
      await refreshUser();
      toast({
        title: "Your wallet is linked",
        description: "Your wallet is linked to your account.",
      });
    } catch (err: unknown) {
      if (isWalletNotDetected(err)) {
        setFailure({ kind: "not-detected" });
      } else {
        setFailure({
          kind: "other",
          message:
            err instanceof Error && err.message
              ? err.message
              : "Something went wrong setting up your wallet. Nothing was moved. Try again.",
        });
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectWallet();
    setFailure(null);
    toast({
      title: "Wallet disconnected for now",
      description: "It stays linked to your account. Reconnect it whenever you like.",
    });
  };

  // "Disconnect for now" is this browser only; this is the account-level
  // action: the server forgets the link, so stakes stop showing here until a
  // wallet is set up again. Money is untouched either way.
  const [isRemoving, setIsRemoving] = useState(false);
  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      const res = await fetch("/api/auth/freighter/disconnect", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === "string" && data.error
            ? data.error
            : "Couldn't remove the wallet just now. Nothing was moved. Try again.",
        );
      }
      await disconnectWallet();
      await refreshUser();
      setFailure(null);
      toast({
        title: "Wallet removed from your account",
        description:
          "Your money stays in your wallet and in any vaults. Set a wallet up again whenever you like.",
      });
    } catch (err: unknown) {
      toast({
        title: "Couldn't remove the wallet",
        description:
          err instanceof Error && err.message
            ? err.message
            : "Nothing was moved. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const removeWalletAction = (
    <div className="border-t border-border/60 pt-3 text-center">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={isRemoving}
            className="text-xs font-medium text-rose-600 underline-offset-4 hover:underline disabled:opacity-60 dark:text-rose-400"
          >
            {isRemoving ? "Removing..." : "Remove wallet from account"}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this wallet from your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your money stays in your wallet and in any vaults; nothing is moved. But
              your stakes won&apos;t show on this account until you set a wallet up
              again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove}>Remove wallet</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  const handleCopy = async () => {
    if (!activeAddress) return;
    try {
      await navigator.clipboard.writeText(activeAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Account ID copied" });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the ID and copy it yourself.",
        variant: "destructive",
      });
    }
  };

  // ── Not signed in ───────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center">
        <p className="text-sm font-semibold text-foreground">Sign in first</p>
        <p className="text-xs text-muted-foreground">
          Sign in to continue, then set up your wallet.
        </p>
        <Button onClick={() => login()} className="h-9 w-full">
          Sign in
        </Button>
      </div>
    );
  }

  // ── First setup: the guided flow ────────────────────────────────────────
  if (flowHeld || (!hasLinkedWallet && !activeAddress)) {
    return (
      <WalletSetupFlow
        purpose={purpose}
        onLater={onLater}
        onStart={() => setFlowHeld(true)}
        onFinish={() => setFlowHeld(false)}
        doneHref={doneHref}
        doneLabel={doneLabel}
      />
    );
  }

  // ── Connected ───────────────────────────────────────────────────────────
  if (activeAddress) {
    const lastFour = activeAddress.slice(-4);
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-left">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            {linkedAddress === activeAddress
              ? "Your wallet is linked to your account."
              : "Your wallet is connected."}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Account ID{" "}
              <span className="font-mono text-foreground">...{lastFour}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowFullId((v) => !v)}
              className="text-xs font-medium text-foreground underline underline-offset-4 hover:text-primary"
              aria-expanded={showFullId}
            >
              {showFullId ? "Hide full ID" : "Show full ID"}
            </button>
          </div>

          {showFullId && (
            <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Technical details
              </p>
              <p className="text-xs text-muted-foreground">
                Your account ID. Like a bank account number: safe to share.
              </p>
              <div className="mt-2 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-foreground">
                  {activeAddress}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={handleCopy}
                  aria-label="Copy account ID"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className="mt-3 border-t border-border/60 pt-3">
            <a
              href={`${EXPLORER_BASE}/account/${activeAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              See the public record
            </a>
            <p className="mt-1 text-xs text-muted-foreground">{EXPLORER_EXPLAINER}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {showProfileLink && (
            <Button variant="outline" size="sm" className="h-10 flex-1" asChild>
              <Link href="/profile?tab=wallet" className="flex items-center justify-center gap-2">
                <Eye className="h-4 w-4" aria-hidden="true" />
                What your wallet holds
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-10 flex-1 gap-2"
            onClick={handleDisconnect}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Disconnect for now
          </Button>
        </div>

        {hasLinkedWallet && removeWalletAction}
      </div>
    );
  }

  // ── Linked to the account but not connected in this browser ─────────────
  const actionLabel = hasLinkedWallet ? "Reconnect" : "Set up your wallet";

  return (
    <div className="space-y-4 text-left">
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-2">
            <WalletChip label={hasLinkedWallet ? "Wallet: reconnect" : "Wallet: not set up"} />
            <p className="text-sm text-muted-foreground">
              {hasLinkedWallet
                ? "Your wallet is linked to this account but not connected in this browser. Reconnect it to confirm stakes, votes and refunds."
                : WALLET_EXPLAINER}
            </p>
          </div>
        </div>

        <Button
          onClick={handleConnect}
          disabled={isConnecting}
          className="mt-4 h-10 w-full gap-2"
        >
          {isConnecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Waiting for your wallet...
            </>
          ) : (
            actionLabel
          )}
        </Button>

        {!hasLinkedWallet && !isConnecting && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Have it already?{" "}
            <button
              type="button"
              onClick={handleConnect}
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              Connect
            </button>
          </p>
        )}

        {hasLinkedWallet && <div className="mt-4">{removeWalletAction}</div>}
      </div>

      {failure?.kind === "not-detected" && isPhone && (
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            Wallets on phones aren&apos;t supported yet
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            For now you can set up a wallet on a computer; staking, voting and refunds then
            work from there.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 h-9 w-full"
            onClick={() => setFailure(null)}
          >
            Keep browsing
          </Button>
        </div>
      )}

      {failure?.kind === "not-detected" && !isPhone && (
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <p className="text-sm font-semibold text-foreground">
            We can&apos;t see your wallet yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            If it&apos;s installed, make sure it&apos;s unlocked. Otherwise, here is how to set one up.
          </p>
          <ol className="mt-3 space-y-2">
            {INSTALL_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-3 text-sm text-foreground">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" size="sm" className="h-9 flex-1 gap-2" asChild>
              <a href={FREIGHTER_SITE} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open freighter.app
              </a>
            </Button>
            <Button
              size="sm"
              className="h-9 flex-1 gap-2"
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              Check again
            </Button>
          </div>
        </div>
      )}

      {failure?.kind === "other" && (
        <div
          role="alert"
          className="rounded-xl border border-border bg-muted/20 p-4"
        >
          <p className="text-sm text-foreground">{failure.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 h-9 w-full gap-2"
            onClick={handleConnect}
            disabled={isConnecting}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/** The Settings page's wallet section. */
export function WalletSettings() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div className="h-32 w-full animate-pulse rounded-xl border border-border bg-muted/40" />
    );
  }

  return <WalletPanel />;
}
