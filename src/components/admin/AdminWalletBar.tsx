"use client";

import { useState } from "react";
import { Wallet, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { shortenAddress, cn } from "@/lib/utils";

/**
 * Wallet state for the admin dashboard.
 *
 * Being signed in as an admin is what gets you into this dashboard; it is not
 * what lets you change a contract. Those are checked in different places by
 * different systems — the app checks the session, the ledger checks a
 * signature — and this bar exists so that distinction is visible rather than
 * discovered when a transaction fails.
 *
 * Three states worth distinguishing: no wallet, a wallet that is not on the
 * on-chain roster, and a wallet that is. The middle one is the one that
 * confuses people, because everything on screen looks available right up until
 * the contract rejects it.
 */
export function AdminWalletBar({
  isChainAdmin,
  isMainAdmin,
}: {
  isChainAdmin: boolean;
  isMainAdmin: boolean;
}) {
  const { freighterWalletAddress, login, error } = useFreighterWallet();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = async () => {
    setIsConnecting(true);
    try {
      await login();
    } catch (err: any) {
      toast({
        title: "Could not connect wallet",
        description:
          err?.message ??
          (error?.includes("extension is not installed")
            ? "Freighter is not installed in this browser."
            : "Freighter did not return an address."),
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const tone = !freighterWalletAddress
    ? "muted"
    : isChainAdmin
      ? "ok"
      : "warn";

  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/40 bg-amber-500/5",
        tone === "muted" && "border-border bg-muted/30",
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        {tone === "ok" ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
        ) : tone === "warn" ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
        ) : (
          <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}

        <div className="min-w-0">
          {!freighterWalletAddress ? (
            <>
              <p className="text-sm font-semibold">No wallet connected</p>
              <p className="text-xs text-muted-foreground">
                Reviewing applications, editing categories and moderating projects
                all work without one. Changing platform fees, the bond percentage,
                the identity registry or the admin roster needs a signature.
              </p>
            </>
          ) : isChainAdmin ? (
            <>
              <p className="text-sm font-semibold">
                Wallet connected
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {shortenAddress(freighterWalletAddress)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                This wallet is on the on-chain admin roster, so contract actions
                are available.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">
                Wallet is not an on-chain admin
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {shortenAddress(freighterWalletAddress)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Your account has dashboard access, but the contracts do not
                recognise this address. Contract actions will be rejected by the
                ledger regardless of what this interface allows. Connect a wallet
                on the roster, or have an existing admin add this one.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isMainAdmin && <Badge variant="secondary">Owner</Badge>}
        {isChainAdmin && !isMainAdmin && <Badge variant="secondary">Chain admin</Badge>}
        <Button
          size="sm"
          variant={freighterWalletAddress ? "outline" : "default"}
          onClick={connect}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Wallet className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="ml-1.5">
            {freighterWalletAddress ? "Switch wallet" : "Connect wallet"}
          </span>
        </Button>
      </div>
    </div>
  );
}
