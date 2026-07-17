"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Heart } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { useAuth } from "@/context/AuthContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { CurrencyType } from "@/packages/blkfndr_v2";
import Link from "next/link";
import { CubeSpinner } from "../ui/CubeSpinner";
import { getUserByCreatorId } from "@/lib/data.client";
import { createNotification } from "@/actions/notifications-client";
import StaticBLKFNDR from "./StaticBLKFNDR";
import { StellarLogo } from "./StellarLogo";
import { getBalance } from "@/lib/stellar";

export default function Footer() {
  const [amount, setAmount] = useState("10");
  const [xlmBalance, setXlmBalance] = useState(0);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [xlmUsdRate, setXlmUsdRate] = useState(0.15);
  const [feeWalletAddress, setFeeWalletAddress] = useState<string | null>(null);

  const { toast } = useToast();
  const { user } = useAuth();
  const { donateToPlatform, getPlatform } = useStellarContract();
  const { freighterWalletAddress } = useFreighterWallet();
  const [isPending, startTransition] = useTransition();

  const refreshBalance = useCallback(async () => {
    if (!freighterWalletAddress) {
      setXlmBalance(0);
      return;
    }
    setIsLoadingBalance(true);
    try {
      const walletBalances = await getBalance(freighterWalletAddress);
      const nativeBalance = (walletBalances as any[]).find(
        (b) => b.asset_type === "native",
      );
      setXlmBalance(nativeBalance ? parseFloat(nativeBalance.balance) : 0);
    } catch (error) {
      console.warn("Failed to load XLM balance for donation:", error);
    } finally {
      setIsLoadingBalance(false);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    if (freighterWalletAddress) {
      refreshBalance();
    }
  }, [freighterWalletAddress, refreshBalance]);

  // Fetch the on-chain fee wallet address to detect self-donation
  useEffect(() => {
    const fetchFeeWallet = async () => {
      try {
        const platformInfo = await getPlatform();
        setFeeWalletAddress(platformInfo?.fee_wallet_address ?? null);
      } catch (error) {
        console.warn("Failed to fetch platform fee wallet:", error);
      }
    };
    fetchFeeWallet();
  }, [getPlatform]);

  useEffect(() => {
    const fetchXlmRate = async () => {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
        );
        if (response.ok) {
          const data = await response.json();
          setXlmUsdRate(data["stellar"]?.usd ?? 0.15);
        }
      } catch (error) {
        console.warn("Failed to fetch XLM rate:", error);
      }
    };
    fetchXlmRate();
  }, []);

  const donationAmount = parseFloat(amount) || 0;
  const isBalanceSufficient = xlmBalance >= donationAmount;
  const isSelfDonation =
    !!freighterWalletAddress &&
    !!feeWalletAddress &&
    freighterWalletAddress === feeWalletAddress;

  const handleDonate = () => {
    startTransition(async () => {
      if (!freighterWalletAddress) {
        toast({
          title: "Please connect your Freighter wallet to donate.",
          variant: "destructive",
        });
        return;
      }

      if (isSelfDonation) {
        toast({
          title: "Donation Blocked",
          description:
            "Your wallet is the platform fee wallet.",
          variant: "destructive",
        });
        return;
      }

      if (isNaN(donationAmount) || donationAmount <= 0) {
        toast({
          title: "Invalid Amount",
          description: "Please enter a valid donation amount.",
          variant: "destructive",
        });
        return;
      }

      if (!isBalanceSufficient) {
        toast({
          title: "Insufficient Balance",
          description: `You have ${xlmBalance} XLM, but tried to donate ${donationAmount} XLM.`,
          variant: "destructive",
        });
        return;
      }

      const amountInStroops = BigInt(Math.floor(donationAmount * 10_000_000));

      try {
        const result = await donateToPlatform({
          donor: freighterWalletAddress,
          amount: amountInStroops,
          currencyType: CurrencyType.XLM,
          message: `Donation from ${user?.name || "Anonymous donor"}`,
        });

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Donation transaction failed on-chain.");
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const url = txHash
          ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
          : null;

        // Notification for the user
        if (user?.uid) {
          createNotification(
            user.uid,
            "Thank You for Your Donation!",
            `Your donation of ${formatCurrency(donationAmount, "XLM", false)} has been received.`,
            url,
            null,
          );
        }

        // Notification for the admin
        try {
          const platformInfo = await getPlatform();
          const feeWalletAddress = platformInfo?.fee_wallet_address;
          if (feeWalletAddress) {
            const adminUser = await getUserByCreatorId(
              feeWalletAddress,
              "stellarPublicKey",
            );
            if (adminUser) {
              createNotification(
                adminUser.uid,
                "New Platform Donation Received!",
                `${user?.name || "Anonymous donor"} donated ${formatCurrency(donationAmount, "XLM", false)} to the platform.`,
                url,
                null,
              );
            }
          }
        } catch (error) {
          console.warn(
            "Failed to send admin notification for donation:",
            error,
          );
        }

        toast({
          title: "Thank You For Your Donation!",
          description: (
            <div>
              <p>Your donation has been successfully processed on-chain.</p>
              {url && (
                <Link
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  View transaction on Stellar Explorer
                </Link>
              )}
            </div>
          ),
        });
        refreshBalance();
      } catch (error: any) {
        toast({
          title: "Donation Failed",
          description:
            error.message || "Your donation could not be processed.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <footer className="py-6 md:px-8 md:py-0 border-t">
      <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
        <div className="text-balance text-center text-sm leading-loose text-muted-foreground md:text-left">
          © {new Date().getFullYear()}{" "}
          <StaticBLKFNDR className="-mt-2 inline-block text-lg font-bold align-middle" />
          . All rights reserved.
        </div>

        <div className="flex items-center gap-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Heart className="mr-2 h-4 w-4" />
                Donation Box
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xs w-full p-4 sm:max-w-sm sm:p-6">
              <DialogHeader>
                <DialogTitle>
                  Support{" "}
                  <span className="inline-block text-2xl font-bold align-middle">
                    <StaticBLKFNDR className="-mt-2" />
                  </span>
                </DialogTitle>
                <DialogDescription>
                  Your donations are transparently recorded on-chain, helping us
                  continue to build and support this platform for innovators.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {/* Quick Amounts */}
                <div>
                  <label className="text-sm font-semibold block mb-2">
                    Quick Amounts
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setAmount("5")}
                      className="w-full font-semibold"
                    >
                      {formatCurrency(5, "XLM")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setAmount("10")}
                      className="w-full font-semibold"
                    >
                      {formatCurrency(10, "XLM")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setAmount("25")}
                      className="w-full font-semibold"
                    >
                      {formatCurrency(25, "XLM")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setAmount("50")}
                      className="w-full font-semibold"
                    >
                      {formatCurrency(50, "XLM")}
                    </Button>
                  </div>
                </div>

                {/* Amount input */}
                <div>
                  <label
                    htmlFor="amount"
                    className="text-sm font-semibold block mb-2"
                  >
                    Amount
                  </label>
                  <div className="relative">
                    <Input
                      id="amount"
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      max={999999999}
                      step="0.01"
                      min="0"
                      onChange={(e) => {
                        const val = e.target.value;
                        const [intPart, decPart] = val.split(".");
                        if (intPart.length > 9) {
                          setAmount(
                            "999999999" + (decPart ? "." + decPart : ""),
                          );
                        } else if (parseFloat(val) > 999999999) {
                          setAmount("999999999");
                        } else {
                          setAmount(val);
                        }
                      }}
                      className="pr-16 font-semibold"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-muted-foreground font-medium">
                      <StellarLogo className="h-4 w-4" />
                      XLM
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Min: {formatCurrency(0, "XLM")} • Max:{" "}
                    {formatCurrency(999999999, "XLM")}
                  </p>
                </div>

                {/* Wallet Balance */}
                {freighterWalletAddress && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground bg-secondary/30 rounded-md px-3 py-2 border border-border/40 mt-2">
                    <span className="flex items-center gap-1.5">
                      <StellarLogo className="h-3 w-3" />
                      Wallet Balance:
                    </span>
                    <span className="font-bold text-foreground">
                      {isLoadingBalance
                        ? "Loading..."
                        : `${xlmBalance.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 4,
                        })} XLM`}
                    </span>
                  </div>
                )}

                {/* Estimated USD Value */}
                {donationAmount > 0 && (
                  <div className="flex justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded-md">
                    <span>Estimated USD Value:</span>
                    <span>
                      $
                      {(donationAmount * xlmUsdRate).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      USD
                    </span>
                  </div>
                )}

                {/* Insufficient Balance warning */}
                {!isBalanceSufficient && donationAmount > 0 && !isSelfDonation && (
                  <div className="text-xs text-rose-500 font-semibold bg-rose-500/10 px-3 py-2 rounded-md animate-pulse">
                    Insufficient balance in your wallet.
                  </div>
                )}

                {isSelfDonation && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 font-semibold bg-amber-500/10 px-3 py-2 rounded-md border border-amber-500/20">
                    Your connected wallet is the platform fee wallet.
                  </div>
                )}
              </div>
              <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-0">
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button
                    onClick={handleDonate}
                    disabled={
                      isPending ||
                      !amount ||
                      parseFloat(amount) <= 0 ||
                      !isBalanceSufficient ||
                      isSelfDonation
                    }
                    className="w-full sm:w-auto"
                  >
                    {isPending ? (
                      <CubeSpinner />
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <StellarLogo className="h-4 w-4" />
                        {`Donate ${formatCurrency(parseFloat(amount) || 0, "XLM", false)}`}
                      </span>
                    )}
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <a
            href="https://stellar.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <StellarLogo className="h-8 w-auto opacity-50 hover:opacity-100 transition-opacity" />
          </a>
        </div>
      </div>
    </footer>
  );
}

