"use client";

import { useState, useEffect, useTransition, useCallback, useRef } from "react";
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
import { vaultClient, simulate } from "@/lib/stellar-clients";
import { EXPLORER_BASE } from "@/lib/network";
import {
  bondAssetFor,
  tokenBalance,
  type BondAsset,
  type TokenBalance,
} from "@/lib/bond-readiness";

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
  const { user, refreshUser } = useAuth();
  const { refreshProject, signInToContinue } = useProjectDetails();
  const refreshAfterTx = useRefreshAfterTx();
  const [isSubmitPending, startSubmitTransition] = useTransition();

  const { contribute } = useStellarContract();
  const { freighterWalletAddress, login: connectFreighter } = useFreighterWallet();

  // Null until the first read for the connected wallet comes back.
  const [walletBalance, setWalletBalance] = useState<TokenBalance | null>(null);
  const [vaultAsset, setVaultAsset] = useState<BondAsset | null>(null);
  const balanceRequest = useRef(0);
  const [usdRates, setUsdRates] = useState<Record<string, number>>(MOCK_USD_RATES);
  const [isConnectingFreighter, setIsConnectingFreighter] = useState(false);

  const handleConnectFreighter = async () => {
    if (!user) {
      toast({
        title: "Sign in first",
        description: "Sign in to continue, then set up your wallet.",
        variant: "destructive",
      });
      signInToContinue({ fund: true });
      return;
    }
    setIsConnectingFreighter(true);
    try {
      await connectFreighter();
      await refreshUser();
      toast({
        title: "Your wallet is linked",
        description: "Your wallet is linked to your account.",
      });
      setIsFundFlow(true);
    } catch (err: any) {
      console.error("[FundDialog] Freighter connection failed:", err);
      toast({
        title: "Couldn't set up your wallet",
        description: err.message || "Something went wrong setting up your wallet. Nothing was moved. Try again.",
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

  // The balance comes from the vault's own token contract. This used to take
  // the first Horizon balance line whose code matched, but a wallet can hold
  // several assets called USDC from different issuers: one whose first line was
  // another issuer's showed 0.00 and was refused a stake it could cover. The
  // vault fixes its token at construction, so it, not the listing, says which
  // asset a stake moves.
  const refreshBalances = useCallback(async () => {
    const request = ++balanceRequest.current;
    const vaultAddress = project.vaultAddress;
    if (!freighterWalletAddress || !vaultAddress) {
      setWalletBalance(vaultAddress ? null : { status: "unknown" });
      setVaultAsset(null);
      return;
    }
    setWalletBalance(null);
    const info = await simulate(
      () => vaultClient(vaultAddress).get_info(),
      `get_info(${vaultAddress})`,
    );
    const token = info?.token ? String(info.token) : null;
    const [balance, asset] = token
      ? await Promise.all([
          tokenBalance(token, freighterWalletAddress),
          bondAssetFor(token),
        ])
      : [{ status: "unknown" } as TokenBalance, null];
    // A wallet switch or a newer refresh has started since; its answer wins.
    if (request !== balanceRequest.current) return;
    setWalletBalance(balance);
    setVaultAsset(asset);
  }, [freighterWalletAddress, project.vaultAddress]);

  useEffect(() => {
    // Also runs on disconnect, so a balance read for a previous wallet is
    // cleared rather than left to vouch for the next one.
    if (isFundFlow) {
      refreshBalances();
    }
  }, [isFundFlow, refreshBalances]);

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
      if (numericValue < 0) numericValue = 0;
      setAmount(numericValue.toString());
    }
  };

  const fundAmount = parseFloat(amount) || 0;
  // The vault's `contribute` takes the whole stake and nothing else. The
  // platform's flat listing fee is charged to the builder once at creation,
  // so no fee is added here. This used to add a percentage on top, which
  // overstated every stake and refused wallets that could in fact cover it.

  // No trustline or no account means the wallet holds none of this token. A
  // failed read is not the same as an empty wallet: contribute is simulated
  // before Freighter is asked to sign, and a stake the wallet cannot cover is
  // refused there, so an unknown balance does not block the stake.
  const balanceLoading = Boolean(freighterWalletAddress) && walletBalance === null;
  const balanceRaw: bigint | null =
    walletBalance?.status === "ok"
      ? walletBalance.raw
      : walletBalance?.status === "no-trustline" || walletBalance?.status === "no-account"
        ? 0n
        : null;
  const userBalance = balanceRaw === null ? null : toHumanAmount(balanceRaw.toString());
  // Computed on every render, so it must never throw: BigInt() rejects the
  // -Infinity a huge negative entry floors to. A positive amount is capped at
  // MAX_FUND_AMOUNT above and always converts.
  const stakeRaw = fundAmount > 0 ? BigInt(toRawAmount(fundAmount)) : 0n;
  const isBalanceSufficient = balanceRaw === null || balanceRaw >= stakeRaw;
  const issuerShort =
    vaultAsset?.issuer ? `${vaultAsset.issuer.slice(0, 4)}…${vaultAsset.issuer.slice(-5)}` : null;

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
    // In base units: an amount under one stroop floors to a stake of nothing.
    if (!isProjectApproved || isProjectExpired || stakeRaw <= 0n)
      return false;
    if (wouldExceedGoal) return false;
    if (balanceLoading) return false;
    return isBalanceSufficient;
  })();

  const handleOnChainFund = () => {
    startSubmitTransition(async () => {
      if (!freighterWalletAddress) {
        toast({ title: "No wallet connected", variant: "destructive" });
        return;
      }

      const parsedAmount = BigInt(toRawAmount(fundAmount));

      // The same token-contract balance the dialog shows, compared in base
      // units. An unknown balance is left to contribute's own simulation.
      if (balanceRaw !== null && parsedAmount > balanceRaw) {
        toast({
          title: "Insufficient balance",
          description: `You have ${formatAmount(userBalance ?? 0, projectCurrency)}, but tried to stake ${formatAmount(fundAmount, projectCurrency)}.`,
          variant: "destructive",
        });
        return;
      }

      if (!project.vaultAddress) {
        toast({
          title: "Stake not made",
          description: "This project's vault could not be found. Nothing was moved or charged.",
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
          throw new Error("Your stake didn't go through. Nothing was moved or charged.");
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const txUrl = txHash ? `${EXPLORER_BASE}/tx/${txHash}` : null;

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
          title: "Stake confirmed",
          description: (
            <div>
              <p>Your stake is in the vault.</p>
              {txUrl && (
                <Link
                  href={txUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  See the public record
                </Link>
              )}
            </div>
          ),
        });

        refreshProject(project.id);
        await refreshAfterTx(freighterWalletAddress ?? undefined);
        // The project is a page now, so there is nothing to close: the sheet
        // folds back into the button and the refreshed figures show behind it.
        setIsFundFlow(false);
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
          title: "Stake not made",
          description:
            reason.length > 0
              ? reason.slice(0, 400)
              : "Your stake didn't go through. Nothing was moved or charged.",
          variant: "destructive",
        });
      }
    });
  };

  const handleFund = () => {
    if (!user) {
      signInToContinue({ fund: true });
      return;
    }
    if (!freighterWalletAddress) {
      handleConnectFreighter();
      return;
    }
    if (isNaN(fundAmount) || stakeRaw <= 0n) {
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
      signInToContinue({ fund: true });
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
    if (project.status === "funded" || isProjectFunded) return "Goal reached";
    if (isProjectExpired) return "Deadline passed";
    if (isLocked) return "Paused by BLKFNDR";
    if (isProjectPending) return "Under listing review";
    return "Stake from $5";
  };

  // An element, not a component declared inside render. As a component it
  // was a new type on every render, so React replaced the button each time
  // this dialog re-rendered. A press that straddled one of those re-renders
  // (the project refetch finishing, for instance) ended on a button that no
  // longer existed, and nothing happened.
  const mainButton = (
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
                <span> for stakes</span>
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
                  <span>Stake</span>
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
                        Wallet: not set up
                      </span>
                      <span className="text-xs text-neutral-400 font-normal">
                        Set up your wallet to confirm this stake.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {freighterWalletAddress && (
                <div className="flex flex-col gap-2 w-full mt-2 text-left">
                  <span className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground ml-1">
                    In your wallet
                  </span>
                  <div className="flex items-center gap-3 bg-secondary/30 border border-border/40 backdrop-blur-md rounded-xl px-3 py-2.5 shadow-sm">
                    <div className="bg-primary/10 p-2 rounded-lg shrink-0">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-muted-foreground font-medium uppercase truncate">
                        {projectCurrency} Balance
                        {issuerShort && (
                          <span className="normal-case font-normal"> · issuer {issuerShort}</span>
                        )}
                      </span>
                      <span className="text-sm text-foreground font-bold tracking-tight">
                        {balanceLoading
                          ? "Checking…"
                          : userBalance === null
                            ? "Unavailable"
                            : `${userBalance.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: coinDecimals > 6 ? 4 : 2,
                              })} ${projectCurrency}`}
                      </span>
                    </div>
                  </div>
                  {walletBalance?.status === "no-trustline" && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 ml-1 space-y-1">
                      <p>
                        Your wallet cannot hold the {vaultAsset?.code ?? projectCurrency} this vault
                        takes yet. In Freighter, open{" "}
                        <span className="font-medium">Manage Assets</span> and add it, then reopen
                        this dialog.
                      </p>
                      {vaultAsset?.issuer && (
                        <p>
                          If Freighter asks for the issuer:
                          <br />
                          <span className="font-mono break-all select-all">{vaultAsset.issuer}</span>
                        </p>
                      )}
                    </div>
                  )}
                  {walletBalance?.status === "no-account" && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 ml-1">
                      This wallet does not exist on the network yet. Fund it with XLM in
                      Freighter first{vaultAsset && !vaultAsset.isNative
                        ? `, then add ${vaultAsset.code} under Manage Assets`
                        : ""}.
                    </p>
                  )}
                  {walletBalance?.status === "unknown" && (
                    <p className="text-xs text-muted-foreground ml-1">
                      Your balance could not be read. If it does not cover the stake, the stake
                      is refused before anything is signed.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Transaction Summary & Breakdown ───────────────────────── */}
            {/* An amount under one stroop is a stake of nothing: no summary, no badge. */}
            {stakeRaw > 0n && (
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
                  credited toward the goal. Your wallet shows the network fee
                  separately.
                </p>

                <div className="mt-3 pt-3 border-t border-muted-foreground/10 flex flex-wrap gap-x-4 gap-y-1.5 justify-between text-xs items-center">
                  <div>
                    {balanceLoading || balanceRaw === null ? (
                      <span className="text-muted-foreground font-bold bg-muted px-2.5 py-0.5 rounded-full">
                        {balanceLoading ? "Checking balance…" : "Balance not checked"}
                      </span>
                    ) : isBalanceSufficient ? (
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
                      ? "Opening your wallet..."
                      : freighterWalletAddress
                        ? "Review and confirm"
                        : "Set up your wallet"}
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
            {mainButton}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}