"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Project } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { useRefreshAfterTx } from "@/context/BlockchainContext";
import { AnimatePresence, motion } from "framer-motion";
import {
  Info,
  AlertCircle,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { CubeSpinner } from "../ui/CubeSpinner";
import { useStellarContract, PlatformLockError } from "@/hooks/use-stellar-contract";
import { FreighterDeclined } from "@/lib/freighter-signer";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { getBalance } from "@/lib/stellar";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FUND_AMOUNT = 1_000_000_000_000;
const AUTO_FUND_THRESHOLD = 0.2;

const COIN_DECIMALS: Record<string, number> = {
  USDC: 7,
  XLM: 7,
};

const MOCK_USD_RATES: Record<string, number> = {
  XLM: 0.15,
  USDC: 1.0,
};

// ─── Component ────────────────────────────────────────────────────────────────

export function FundDialog({
  project,
  isFundFlow,
  setIsFundFlow,
}: {
  project: Project;
  isFundFlow: boolean;
  setIsFundFlow: (isFundFlow: boolean) => void;
}) {
  const [amount, setAmount] = useState("");
  const { toast } = useToast();
  const { user, login, refreshUser } = useAuth();
  const { closeProjectDetails, refreshProject } = useProjectDetails();
  const refreshAfterTx = useRefreshAfterTx();
  const [isSubmitPending, startSubmitTransition] = useTransition();

  const { contribute } = useStellarContract();
  const { freighterWalletAddress, login: connectFreighter } = useFreighterWallet();

  const [balances, setBalances] = useState<any[]>([]);
  const [usdRates, setUsdRates] = useState<Record<string, number>>(MOCK_USD_RATES);
  const [isConnectingFreighter, setIsConnectingFreighter] = useState(false);

  const handleConnectFreighter = async () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in with Google first before connecting your wallet.",
        variant: "destructive",
      });
      login();
      return;
    }
    setIsConnectingFreighter(true);
    try {
      await connectFreighter();
      await refreshUser();
      toast({
        title: "Wallet Connected",
        description: "Freighter wallet successfully connected and verified.",
      });
      setIsFundFlow(true);
    } catch (err: any) {
      console.error("[FundDialog] Freighter connection failed:", err);
      toast({
        title: "Connection Failed",
        description: err.message || "Failed to connect Freighter wallet.",
        variant: "destructive",
      });
    } finally {
      setIsConnectingFreighter(false);
    }
  };

  useEffect(() => {
    const fetchLiveRates = async () => {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=stellar,usd-coin&vs_currencies=usd",
        );
        if (response.ok) {
          const data = await response.json();
          setUsdRates({
            XLM: data["stellar"]?.usd ?? MOCK_USD_RATES.XLM,
            USDC: data["usd-coin"]?.usd ?? MOCK_USD_RATES.USDC,
          });
        }
      } catch (error) {
        console.warn(
          "Failed to fetch live crypto rates in FundDialog, using fallbacks:",
          error,
        );
      }
    };
    if (isFundFlow) {
      fetchLiveRates();
    }
  }, [isFundFlow]);

  const projectCurrency =
    (project.currencyType as string)?.toUpperCase() || "XLM";
  const inputCurrency = projectCurrency;
  const coinDecimals = COIN_DECIMALS[inputCurrency] ?? 7;
  const decimalMultiplier = Math.pow(10, coinDecimals);

  const toHumanAmount = (raw: number | string) =>
    Number(raw) / decimalMultiplier;
  const toRawAmount = (human: number) =>
    Math.floor(human * decimalMultiplier);

  const remainingGoalRaw =
    Number(project.fundingGoalRaw ?? 0) -
    Number(project.currentFundingRaw ?? 0);
  const remainingGoal = toHumanAmount(remainingGoalRaw);
  const isCloseToGoal =
    remainingGoal > 0 && remainingGoal < AUTO_FUND_THRESHOLD;

  const refreshBalances = useCallback(async () => {
    if (!freighterWalletAddress) {
      setBalances([]);
      return;
    }
    try {
      const walletBalances = await getBalance(freighterWalletAddress);
      setBalances(walletBalances as any[]);
    } catch (error) {
      console.error("Failed to load freighter balances:", error);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    if (isFundFlow && freighterWalletAddress) {
      refreshBalances();
    }
  }, [isFundFlow, freighterWalletAddress, refreshBalances]);

  useEffect(() => {
    if (isFundFlow) {
      if (isCloseToGoal) {
        setAmount(remainingGoal.toFixed(coinDecimals > 6 ? 4 : 2));
      }
    } else {
      setAmount("");
    }
  }, [isFundFlow, isCloseToGoal, remainingGoal, coinDecimals]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isCloseToGoal) return;
    const value = e.target.value;
    if (value === "") {
      setAmount("");
      return;
    }
    let numericValue = parseFloat(value);
    if (!isNaN(numericValue)) {
      if (numericValue > MAX_FUND_AMOUNT) numericValue = MAX_FUND_AMOUNT;
      setAmount(numericValue.toString());
    }
  };

  const fundAmount = parseFloat(amount) || 0;
  // The vault's `contribute` takes the whole stake and nothing else. The
  // platform's flat listing fee is charged to the builder once at creation,
  // so no fee is added here. This used to add a percentage on top, which
  // overstated every stake and refused wallets that could in fact cover it.

  const targetAssetCode =
    projectCurrency === "XLM"
      ? "native"
      : projectCurrency;
  const userBalanceObj = balances.find((b) =>
    targetAssetCode === "native"
      ? b.asset_type === "native"
      : b.asset_code === targetAssetCode,
  );
  const userBalance = userBalanceObj
    ? parseFloat(userBalanceObj.balance)
    : 0;
  const isBalanceSufficient = userBalance >= fundAmount;

  const isProjectApproved = project.status === "raising";
  const isProjectPending = project.status === "pending";
  const wouldExceedGoal = !isCloseToGoal && fundAmount > remainingGoal;
  const isProjectFunded =
    Number(project.currentFundingRaw ?? 0) >= Number(project.fundingGoalRaw ?? 0) ||
    project.status === "funded" ||
    project.status === "completed";
  const fundingDeadlinePassed = project.fundingDeadline
    ? Date.now() > project.fundingDeadline
    : false;
  const isProjectExpired =
    project.status === "expired" ||
    fundingDeadlinePassed;
  // A platform lock pauses new stakes. The vault would still accept one, so
  // this is the platform declining to build it, not the contract refusing.
  const isLocked = project.restriction?.locked === true;

  const formatAmount = (val: number, currency: string) =>
    `${val.toLocaleString(undefined, { maximumFractionDigits: COIN_DECIMALS[currency] > 6 ? 4 : 2 })} ${currency}`;

  const canFund = (() => {
    if (isLocked) return false;
    if (!freighterWalletAddress) return true;
    if (!isProjectApproved || isProjectExpired || fundAmount <= 0)
      return false;
    if (wouldExceedGoal) return false;
    return isBalanceSufficient;
  })();

  const handleOnChainFund = () => {
    startSubmitTransition(async () => {
      if (!freighterWalletAddress) {
        toast({ title: "No wallet connected", variant: "destructive" });
        return;
      }

      const parsedAmount = BigInt(toRawAmount(fundAmount));

      // Wallet balance validations
      const targetAssetCode =
        projectCurrency === "XLM"
          ? "native"
          : projectCurrency;

      const targetBalanceObj = balances.find((b) =>
        targetAssetCode === "native"
          ? b.asset_type === "native"
          : b.asset_code === targetAssetCode,
      );

      const userBalance = targetBalanceObj
        ? parseFloat(targetBalanceObj.balance)
        : 0;
      const userBalanceSmallest = BigInt(Math.floor(userBalance * 10_000_000));

      if (parsedAmount > userBalanceSmallest) {
        toast({
          title: "Insufficient balance",
          description: `You have ${userBalance} ${projectCurrency}, but tried to stake ${fundAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${projectCurrency}.`,
          variant: "destructive",
        });
        return;
      }

      if (!project.vaultAddress) {
        toast({
          title: "Contribution Failed",
          description: "Vault address is missing for this project.",
          variant: "destructive",
        });
        return;
      }

      try {
        const result = await contribute({
          vaultAddress: project.vaultAddress,
          amount: parsedAmount,
        });

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Funding transaction failed on-chain.");
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const txUrl = txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : null;

        let investorUid = user?.uid;
        if (!investorUid && freighterWalletAddress) {
          try {
            const res = await fetch(`/api/user-by-address?field=stellarPublicKey&address=${freighterWalletAddress}`);
            const data = res.ok ? await res.json() : null;
            investorUid = data?.uid;
          } catch (e) {
            console.error("Failed to lookup investor profile:", e);
          }
        }

        let creatorUid = null;
        if (project.creator) {
          try {
            const res = await fetch(`/api/user-by-address?field=stellarPublicKey&address=${project.creator}`);
            const data = res.ok ? await res.json() : null;
            creatorUid = data?.uid;
          } catch (e) {
            console.error("Failed to lookup creator profile:", e);
          }
        }

        if (investorUid) {
        }

        if (creatorUid) {
        }

        toast({
          title: "Contribution Successful",
          description: (
            <div>
              <p>Your contribution has been processed on Stellar Testnet.</p>
              {txUrl && (
                <Link
                  href={txUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  View on Stellar Explorer
                </Link>
              )}
            </div>
          ),
        });

        refreshProject(project.id);
        await refreshAfterTx(freighterWalletAddress ?? undefined);
        closeProjectDetails();
      } catch (error: any) {
        // Locked since the listing loaded. Say so, and reload it so the notice
        // and the disabled button catch up with what the platform just said.
        if (error instanceof PlatformLockError) {
          toast({ title: "Project locked", description: error.message, variant: "destructive" });
          refreshProject(project.id);
          return;
        }
        // Declining in Freighter, or letting its request expire, is a decision
        // rather than a fault, and the signer's message already says so.
        if (error instanceof FreighterDeclined) {
          toast({ title: "Signing cancelled", description: error.message });
          return;
        }
        // The reason used to be discarded here, so a wrong Freighter account, a
        // network mismatch and a contract refusal all read as "check your
        // wallet connection and balance", even with both visibly fine.
        console.error("Contribution failed:", error);
        const reason = String(error?.message ?? "").trim();
        toast({
          title: "Contribution Failed",
          description:
            reason.length > 0
              ? reason.slice(0, 400)
              : "Your contribution could not be processed. Nothing was sent to the network.",
          variant: "destructive",
        });
      }
    });
  };

  const handleFund = () => {
    if (!user) {
      login("user");
      return;
    }
    if (!freighterWalletAddress) {
      handleConnectFreighter();
      return;
    }
    if (isNaN(fundAmount) || fundAmount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount.",
        variant: "destructive",
      });
      return;
    }
    if (isLocked) {
      toast({
        title: "Project locked",
        description: "The platform has paused new stakes in this project.",
        variant: "destructive",
      });
      return;
    }
    if (!isProjectApproved) {
      toast({
        title: "Project Not Available",
        description: "This project is not open for funding yet.",
        variant: "destructive",
      });
      return;
    }
    if (isProjectExpired) {
      toast({ title: "Funding Period Ended", variant: "destructive" });
      return;
    }
    if (wouldExceedGoal) {
      toast({
        title: "Amount Too Large",
        description: `Maximum: ${formatAmount(remainingGoal, projectCurrency)}`,
        variant: "destructive",
      });
      return;
    }
    handleOnChainFund();
  };

  const handleTriggerClick = () => {
    if (!user) {
      login("user");
      return;
    }
    if (!freighterWalletAddress) {
      handleConnectFreighter();
      return;
    }
    setIsFundFlow(true);
  };

  const anyPending = isSubmitPending;

  const getButtonContent = () => {
    if (anyPending) return <CubeSpinner />;
    if (project.status === "completed") return "Completed";
    if (project.status === "funded" || isProjectFunded) return "Fully Funded";
    if (isProjectExpired) return "Funding Ended";
    if (isLocked) return "Locked";
    if (isProjectPending) return "Pending Approval";
    return `Fund with ${projectCurrency}`;
  };

  const MainButton = () => (
    <Button
      onClick={handleTriggerClick}
      variant={isProjectFunded ? "outline" : "default"}
      disabled={
        anyPending ||
        isProjectFunded ||
        isProjectExpired ||
        isLocked ||
        isProjectPending
      }
      className={`w-full sm:w-auto whitespace-nowrap shrink-0 ${isProjectFunded ? "" : "bg-primary hover:bg-primary/90 text-primary-foreground"}`}
    >
      {getButtonContent()}
    </Button>
  );

  return (
    <div className={isFundFlow ? "w-full mx-auto px-2 sm:px-1 max-w-none md:max-w-xl transition-all duration-300" : "w-full sm:w-auto"}>
      <AnimatePresence mode="wait">
        {isFundFlow ? (
          <motion.div
            key="fund-view"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="w-full space-y-4"
          >
            {/* ── Header info banner ──────────────────────────────────────── */}
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
              <div className="max-w-xs">
                <span>This project accepts </span>
                <span className="font-bold text-foreground">
                  {projectCurrency}
                </span>
                <span> on Stellar</span>
              </div>
            </div>

            {/* ── Close to goal banner ───────────────────────────────────── */}
            {isCloseToGoal && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800">
                <Info className="h-4 w-4 shrink-0" />
                <span>
                  This is the exact amount to complete the funding goal!
                </span>
              </div>
            )}

            {/* ── Amount input ───────────────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="amount"
                  className="text-xs sm:text-sm font-semibold text-foreground flex justify-between items-center"
                >
                  <span>Contribution Amount</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    Currency: <span className="font-bold text-foreground">{inputCurrency}</span>
                  </span>
                </Label>
                <div className="relative">
                  <Input
                    id="amount"
                    type="number"
                    value={amount}
                    onChange={handleAmountChange}
                    className="w-full text-base pr-12 font-semibold"
                    placeholder="0.00"
                    min="0"
                    max={MAX_FUND_AMOUNT}
                    readOnly={isCloseToGoal}
                    disabled={isCloseToGoal}
                    autoFocus={!isCloseToGoal}
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-muted-foreground font-bold text-xs">
                    {inputCurrency}
                  </div>
                </div>
              </div>

              {/* Wallet Balance Card directly below the Input */}
              {!freighterWalletAddress && (
                <div className="flex flex-col gap-2 w-full mt-2 text-left">
                  <div className="flex items-center gap-3 bg-red-950/10 border border-red-500/20 backdrop-blur-md rounded-xl px-3 py-2.5 shadow-sm">
                    <div className="bg-red-500/10 p-2 rounded-lg shrink-0">
                      <AlertCircle className="h-4 w-4 text-red-400" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-red-400 font-medium uppercase">
                        Wallet Disconnected
                      </span>
                      <span className="text-xs text-neutral-400 font-normal">
                        Please connect your Freighter wallet to verify ownership and fund this project.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {freighterWalletAddress && (
                <div className="flex flex-col gap-2 w-full mt-2 text-left">
                  <span className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground ml-1">
                    Freighter Wallet Balance
                  </span>
                  <div className="flex items-center gap-3 bg-secondary/30 border border-border/40 backdrop-blur-md rounded-xl px-3 py-2.5 shadow-sm">
                    <div className="bg-primary/10 p-2 rounded-lg shrink-0">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-muted-foreground font-medium uppercase truncate">
                        {projectCurrency} Balance
                      </span>
                      <span className="text-sm text-foreground font-bold tracking-tight">
                        {userBalance.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: coinDecimals > 6 ? 4 : 2,
                        })}{" "}
                        {projectCurrency}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Transaction Summary & Breakdown ───────────────────────── */}
            {fundAmount > 0 && (
              <div className="mt-2 rounded-xl bg-muted/30 border border-muted/50 p-4 text-xs sm:text-sm space-y-3.5 shadow-sm text-muted-foreground">
                <p className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                  Transaction Summary & Breakdown
                </p>
                <div className="space-y-2 text-sm text-card-foreground">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">
                      Your stake:
                    </span>
                    <span className="font-bold text-foreground">
                      {fundAmount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: coinDecimals > 6 ? 4 : 2,
                      })}{" "}
                      {projectCurrency}
                    </span>
                  </div>
                  <div className="flex justify-between text-accent font-bold border-t border-muted-foreground/10 pt-2 text-sm">
                    <span>Total deducted from wallet:</span>
                    <span>
                      {fundAmount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: coinDecimals > 6 ? 4 : 2,
                      })}{" "}
                      {projectCurrency}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-emerald-600 dark:text-emerald-400 text-sm border-t border-muted-foreground/10 pt-2">
                    <span>Estimated USD value:</span>
                    <span>
                      $
                      {(fundAmount * (usdRates[projectCurrency] || 0)).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      USD
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  No platform fee is taken from stakes. The builder paid a flat
                  listing fee when the vault was created, so your whole stake is
                  credited toward the goal. Freighter shows the network fee
                  separately.
                </p>

                <div className="mt-3 pt-3 border-t border-muted-foreground/10 flex flex-wrap gap-x-4 gap-y-1.5 justify-between text-xs items-center">
                  <div>
                    {isBalanceSufficient ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                        Sufficient Balance
                      </span>
                    ) : (
                      <span className="text-rose-500 dark:text-rose-400 font-bold bg-rose-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                        Insufficient Balance
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Validation warnings ───────────────────────────────────── */}
            {fundAmount > 0 && (
              <>
                {!isProjectApproved && (
                  <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    <span>This project is not yet open for funding</span>
                  </div>
                )}
                {isProjectExpired && (
                  <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <span>Funding period has ended</span>
                  </div>
                )}
                {wouldExceedGoal && (
                  <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    <span>
                      Amount exceeds remaining goal (
                      {formatAmount(remainingGoal, projectCurrency)})
                    </span>
                  </div>
                )}
              </>
            )}

            {/* ── Confirm button ─────────────────────────────────────────── */}
            <div className="flex justify-end gap-2 pt-2 border-t mt-4">
              <div className="flex flex-col justify-end w-full sm:w-auto">
                <Button
                  onClick={handleFund}
                  disabled={anyPending || isConnectingFreighter || !canFund}
                  className="text-xs sm:text-sm h-10 px-4 whitespace-nowrap w-full"
                >
                  {(isSubmitPending || isConnectingFreighter) && <CubeSpinner />}
                  <span>
                    {isConnectingFreighter
                      ? "Connecting Wallet..."
                      : freighterWalletAddress
                        ? "Confirm Contribution"
                        : "Connect Wallet to Contribute"}
                  </span>
                </Button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="button-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full sm:w-auto"
          >
            <MainButton />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}