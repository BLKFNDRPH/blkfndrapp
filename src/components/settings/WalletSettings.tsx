"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, LogOut, ShieldAlert, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Sleek Freighter interlocking keys icon
const FreighterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect width="24" height="24" rx="5.5" fill="#5C3CFA" />
    <defs>
      <filter
        id="keyShadowSettings"
        x="-20%"
        y="-20%"
        width="150%"
        height="150%"
      >
        <feDropShadow
          dx="0.8"
          dy="1.2"
          stdDeviation="0.6"
          floodColor="#1E0066"
          floodOpacity="0.4"
        />
      </filter>
    </defs>
    <g filter="url(#keyShadowSettings)">
      <path
        d="M 7 5 A 4 4 0 1 0 7 13 A 4 4 0 1 0 7 5 Z M 7 7 A 2 2 0 1 1 7 11 A 2 2 0 1 1 7 7 Z"
        fillRule="evenodd"
        fill="white"
      />
      <rect x="10" y="8" width="10" height="2" rx="0.5" fill="white" />
      <rect x="14" y="10" width="2" height="3" rx="0.5" fill="white" />
      <rect x="17.5" y="10" width="2" height="3" rx="0.5" fill="white" />
    </g>
    <g filter="url(#keyShadowSettings)">
      <path
        d="M 17 11 A 4 4 0 1 0 17 19 A 4 4 0 1 0 17 11 Z M 17 13 A 2 2 0 1 1 17 17 A 2 2 0 1 1 17 13 Z"
        fillRule="evenodd"
        fill="white"
      />
      <rect x="4" y="14" width="10" height="2" rx="0.5" fill="white" />
      <rect x="4.5" y="11" width="2" height="3" rx="0.5" fill="white" />
      <rect x="8" y="11" width="2" height="3" rx="0.5" fill="white" />
    </g>
  </svg>
);

export function WalletSettings() {
  const { user, login, refreshUser } = useAuth();
  const {
    freighterWalletAddress,
    login: connectFreighter,
    disconnectWallet,
    error: freighterError,
  } = useFreighterWallet();
  const { toast } = useToast();
  const [isMounted, setIsMounted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const activeStellarAddress =
    user?.stellarPublicKey || freighterWalletAddress || "";

  const handleCopyAddress = () => {
    if (activeStellarAddress) {
      navigator.clipboard.writeText(activeStellarAddress);
      toast({
        title: "Address Copied",
        description: "Stellar public key copied to clipboard.",
      });
    }
  };

  const handleConnect = async () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in with Google first before connecting your wallet.",
        variant: "destructive",
      });
      login();
      return;
    }
    setIsConnecting(true);
    try {
      await connectFreighter();
      await refreshUser();
      toast({
        title: "Wallet Connected",
        description: "Freighter wallet successfully connected and verified.",
      });
    } catch (err: any) {
      const errorMessage = err.message || "Could not connect Freighter wallet.";
      const isExtensionNotInstalledError =
        errorMessage.includes("Could not detect Freighter in this browser") ||
        errorMessage.includes("Freighter did not respond in this browser") ||
        errorMessage.includes("Freighter did not respond in time");

      toast({
        title: "Connection Failed",
        description: errorMessage,
        variant: "destructive",
      });

      if (isExtensionNotInstalledError) {
        toast({
          title: "Install Freighter",
          description: "Click to visit freighter.app",
          action: (
            <button
              onClick={() => window.open("https://freighter.app", "_blank")}
              className="underline text-sm font-medium"
            >
              Install
            </button>
          ),
        });
      }
    } finally {
      setIsConnecting(false);
    }
  };

  if (!isMounted) {
    return (
      <div className="h-32 w-full animate-pulse bg-neutral-900/50 rounded-xl border border-neutral-800" />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-neutral-400">Connected Stellar Account</p>
          <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] py-0.5 px-2 font-medium">
            Stellar Testnet
          </Badge>
        </div>

        {activeStellarAddress ? (
          <div className="space-y-4">
            <div
              onClick={handleCopyAddress}
              className="flex items-center justify-between p-4 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/40 cursor-pointer transition-all duration-300 relative overflow-hidden group shadow-inner"
            >
              <div className="flex flex-col min-w-0 flex-1 mr-2 text-left">
                <span className="inline-flex items-center gap-1.5 text-xs text-indigo-400 font-semibold mb-2">
                  <FreighterIcon className="h-4 w-4" />
                  Freighter Connected & Active
                </span>
                <span className="font-mono text-xs md:text-sm break-all leading-relaxed text-neutral-200">
                  {activeStellarAddress}
                </span>
              </div>
              <Copy className="h-4 w-4 text-neutral-400 group-hover:text-neutral-200 transition-colors shrink-0" />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`https://stellar.expert/explorer/testnet/account/${activeStellarAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-[150px]"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 w-full border-neutral-800 hover:border-neutral-700 bg-neutral-900/20 text-neutral-200 hover:text-white flex items-center gap-2 justify-center transition-all duration-200"
                >
                  <ExternalLink className="h-4 w-4 text-indigo-400" />
                  View on Stellar.Expert
                </Button>
              </a>

              <Button
                variant="outline"
                size="sm"
                className="h-10 text-red-400 hover:text-red-300 border-neutral-800 hover:border-red-900/30 bg-red-950/10 hover:bg-red-950/20 flex items-center justify-center gap-2 transition-all duration-200 flex-1 min-w-[150px]"
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
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 text-center space-y-4">
            <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5 text-red-400" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-neutral-200">
                Wallet Disconnected
              </h4>
              <p className="text-xs text-neutral-500 max-w-sm">
                No active Stellar account found. Please connect your Freighter
                wallet to use the platform.
              </p>
            </div>
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 h-10 rounded-lg flex items-center gap-2 transition-all"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <FreighterIcon className="h-4 w-4" />
                  Connect Freighter Wallet
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
