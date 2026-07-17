"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Copy, Wallet, Eye, LogOut, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

// Sleek Freighter interlocking keys icon
const FreighterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <rect width="24" height="24" rx="5.5" fill="#5C3CFA" />
    <defs>
      <filter id="keyShadowBtn" x="-20%" y="-20%" width="150%" height="150%">
        <feDropShadow dx="0.8" dy="1.2" stdDeviation="0.6" floodColor="#1E0066" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#keyShadowBtn)">
      <path d="M 7 5 A 4 4 0 1 0 7 13 A 4 4 0 1 0 7 5 Z M 7 7 A 2 2 0 1 1 7 11 A 2 2 0 1 1 7 7 Z" fillRule="evenodd" fill="white" />
      <rect x="10" y="8" width="10" height="2" rx="0.5" fill="white" />
      <rect x="14" y="10" width="2" height="3" rx="0.5" fill="white" />
      <rect x="17.5" y="10" width="2" height="3" rx="0.5" fill="white" />
    </g>
    <g filter="url(#keyShadowBtn)">
      <path d="M 17 11 A 4 4 0 1 0 17 19 A 4 4 0 1 0 17 11 Z M 17 13 A 2 2 0 1 1 17 17 A 2 2 0 1 1 17 13 Z" fillRule="evenodd" fill="white" />
      <rect x="4" y="14" width="10" height="2" rx="0.5" fill="white" />
      <rect x="4.5" y="11" width="2" height="3" rx="0.5" fill="white" />
      <rect x="8" y="11" width="2" height="3" rx="0.5" fill="white" />
    </g>
  </svg>
);

export function WalletButton() {
  const { user, login, refreshUser } = useAuth();
  const { freighterWalletAddress, login: connectFreighter, disconnectWallet } = useFreighterWallet();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);

  const activeStellarAddress = user?.stellarPublicKey || freighterWalletAddress || "";

  const handleCopyAddress = () => {
    if (activeStellarAddress) {
      navigator.clipboard.writeText(activeStellarAddress);
      toast({
        title: "Address Copied",
        description: (
          <span className="flex items-center gap-1">
            Stellar public key copied to clipboard.
          </span>
        ),
      });
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connectFreighter();
      await refreshUser();
      toast({
        title: "Wallet Connected",
        description: "Freighter wallet successfully connected and verified.",
      });
    } catch (err: any) {
      toast({
        title: "Connection Failed",
        description: err.message || "Failed to connect Freighter wallet.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRippleEffect = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget as HTMLElement;
    let ripple = target.querySelector(".ripple-span") as HTMLElement;
    if (!ripple) {
      ripple = document.createElement("span");
      ripple.className = "ripple-span";
      target.appendChild(ripple);
    }

    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="default"
          size="icon"
          className="rounded-full nav-button relative"
        >
          <Wallet className="h-4 w-4" />
          {activeStellarAddress && (
            <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          )}
          <span className="sr-only">Wallet</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-w-[95vw] border border-border bg-card/95 text-card-foreground backdrop-blur-xl p-6 rounded-2xl shadow-2xl overflow-hidden">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <FreighterIcon className="h-5 w-5" />
            Wallet Settings
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 py-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground text-left">Connected Address</h4>
              <Badge className="bg-primary/10 text-primary border border-primary/20 text-[10px] py-0.5 px-2 font-medium">
                Stellar Testnet
              </Badge>
            </div>
            
            {activeStellarAddress ? (
              <div
                onClick={handleCopyAddress}
                className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/40 hover:bg-muted/80 cursor-pointer transition-colors relative overflow-hidden group"
                onMouseMove={handleRippleEffect}
              >
                <div className="flex flex-col min-w-0 flex-1 mr-2 text-left">
                  <span className="inline-flex items-center gap-1.5 text-xs text-primary font-semibold mb-1">
                    <FreighterIcon className="h-3.5 w-3.5" />
                    Freighter Connected
                  </span>
                  <span className="font-mono text-[13px] break-all leading-relaxed text-foreground">
                    {activeStellarAddress}
                  </span>
                </div>
                <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0" />
                <span className="ripple-span"></span>
              </div>
            ) : user ? (
              <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-border bg-muted/20 text-center space-y-3">
                <p className="text-sm text-red-400 font-medium">Wallet Disconnected</p>
                <p className="text-xs text-muted-foreground">Please connect your Freighter wallet to perform transactions.</p>
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6 h-9 rounded-lg flex items-center gap-2 transition-all w-full"
                >
                  {isConnecting ? "Connecting..." : "Connect Wallet"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-border bg-muted/20 text-center space-y-3">
                <p className="text-sm text-red-400 font-medium">Log In Required</p>
                <p className="text-xs text-muted-foreground">Please log in with Google first to connect your wallet.</p>
                <Button
                  onClick={() => {
                    login();
                  }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6 h-9 rounded-lg flex items-center gap-2 transition-all w-full"
                >
                  Log In with Google
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 pt-2">
            {activeStellarAddress && (
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 border-border hover:border-border/80 bg-muted/40 text-foreground hover:text-foreground hover:bg-muted/80"
                  asChild
                >
                  <Link href="/profile?tab=wallet" className="flex items-center gap-2 justify-center">
                    <Eye className="h-4 w-4" />
                    View Wallet
                  </Link>
                </Button>
                
                <a
                  href={`https://stellar.expert/explorer/testnet/account/${activeStellarAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 w-full border-border hover:border-border/80 bg-muted/40 text-foreground hover:text-foreground hover:bg-muted/80 flex items-center gap-2 justify-center"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Stellar.Expert
                  </Button>
                </a>
              </div>
            )}

            {activeStellarAddress && (
              <Button
                variant="outline"
                size="sm"
                className="h-10 mt-1 w-full text-rose-500 hover:text-rose-600 border-border hover:border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 flex items-center justify-center gap-2"
                onClick={async () => {
                  try {
                    await disconnectWallet();
                    await refreshUser();
                    toast({
                      title: "Wallet Disconnected",
                      description: "Freighter wallet disconnected successfully.",
                    });
                  } catch (err: any) {
                    toast({
                      title: "Error",
                      description: err.message || "Failed to disconnect wallet.",
                      variant: "destructive",
                    });
                  }
                }}
              >
                <LogOut className="h-4 w-4" />
                Disconnect Wallet
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}