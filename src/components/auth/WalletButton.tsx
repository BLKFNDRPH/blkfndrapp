"use client";

import React from "react";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Wallet } from "lucide-react";
import {
  PracticeNetworkBadge,
  WalletPanel,
} from "@/components/settings/WalletSettings";

/**
 * The header's wallet control. The dialog it opens is the same wallet panel
 * as Settings, so one action has one name everywhere.
 */
export function WalletButton() {
  const { freighterWalletAddress } = useFreighterWallet();
  const activeAddress: string = freighterWalletAddress || "";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="default"
          size="icon"
          className="rounded-full nav-button relative"
          aria-label={activeAddress ? "Your wallet, connected" : "Your wallet, not set up"}
        >
          <Wallet className="h-4 w-4" />
          {activeAddress && (
            <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-w-[95vw] border border-border bg-card/95 text-card-foreground backdrop-blur-xl p-6 rounded-2xl shadow-2xl overflow-hidden">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-xl font-bold text-foreground">
              Your wallet
            </DialogTitle>
            <PracticeNetworkBadge />
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            The wallet you confirm stakes, votes and refunds with.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <WalletPanel showProfileLink />
        </div>
      </DialogContent>
    </Dialog>
  );
}
