"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useProjects, useUserFunds } from "@/context/BlockchainContext";
import { getMyKycStatus } from "@/app/actions";
import { identityClient, simulate } from "@/lib/stellar-clients";
import { tokenAddressFor } from "@/lib/currencies";
import { readWalletReadiness, type WalletReadiness } from "@/lib/wallet-readiness";
import { rawToUnits, isDollarToken } from "@/lib/money";
import { useXlmRate } from "@/lib/xlm-rate";
import type { FundReceipt } from "@/lib/types";
import {
  ProfileHeader,
  type IdentityState,
  type Participation,
} from "@/components/profile/ProfileHeader";
import { GettingSetUp } from "@/components/profile/GettingSetUp";
import { SummaryCards } from "@/components/profile/SummaryCards";
import { StakesTab } from "@/components/profile/StakesTab";
import { ProjectsTab } from "@/components/profile/ProjectsTab";
import { ActivityTab } from "@/components/profile/ActivityTab";
import { WalletTab } from "@/components/profile/WalletTab";
import { StakeholdersTab } from "@/components/profile/StakeholdersTab";

/**
 * The signed-in home: who you are, what's left to set up, what your wallet
 * holds, and tabs for your stakes, your projects, your activity and your
 * wallet (plus your stakeholders, for builders).
 *
 * Everything about money keys on the account's linked wallet, so the page
 * shows the same stakes and balances whether or not that wallet happens to be
 * connected in this browser. A wallet connected but not yet linked stands in
 * until it is. Identity status keys on the account itself.
 */

type Tab = "funded" | "projects" | "activity" | "wallet" | "investors";
const TABS: Tab[] = ["funded", "projects", "activity", "wallet", "investors"];

function usdcToken(): string | null {
  try {
    return tokenAddressFor("USDC");
  } catch {
    return null;
  }
}

export default function ProfilePage() {
  const { user, loading: authLoading, login } = useAuth();
  const { freighterWalletAddress } = useFreighterWallet();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projects, isLoadingProjects } = useProjects();
  const { rate: xlmUsd } = useXlmRate();

  const linkedAddress = user?.stellarPublicKey || "";
  const address = linkedAddress || freighterWalletAddress || "";

  // ── Identity: the account's own check, and the public record of it ──────
  const [identity, setIdentity] = useState<IdentityState>("loading");
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const res = await getMyKycStatus().catch(() => null);
      const status = res && res.success ? res.request?.status ?? "none" : "none";
      let onRecord = false;
      if (address) {
        onRecord = Boolean(
          await simulate(
            () => identityClient().is_kyc_approved({ address }),
            `is_kyc_approved(${address})`,
          ).catch(() => false),
        );
      }
      if (!active) return;
      setIdentity(
        onRecord
          ? "verified"
          : status === "rejected"
            ? "rejected"
            : status === "approved"
              ? "approved"
              : status === "pending"
                ? "pending"
                : "none",
      );
    })();
    return () => {
      active = false;
    };
  }, [user, address]);

  // ── Stakes, indexed for the wallet ──────────────────────────────────────
  const { userFunds: receipts, isLoadingFunds } = useUserFunds(address || undefined);

  // ── What the wallet holds ───────────────────────────────────────────────
  const [readiness, setReadiness] = useState<WalletReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const readRequest = useRef(0);
  const refreshHoldings = useCallback(async () => {
    const request = ++readRequest.current;
    const token = usdcToken();
    if (!address || !token) {
      setReadiness(null);
      return;
    }
    setReadinessLoading(true);
    const result = await readWalletReadiness(address, token);
    if (request !== readRequest.current) return;
    setReadiness(result);
    setReadinessLoading(false);
  }, [address]);
  useEffect(() => {
    refreshHoldings();
  }, [refreshHoldings]);

  // ── Builder's view ──────────────────────────────────────────────────────
  const ownedProjects = useMemo(
    () =>
      user
        ? projects.filter(
            (p) =>
              (!!address && p.creatorAddress === address) ||
              (!!p.creatorId && p.creatorId === user.uid),
          )
        : [],
    [projects, user, address],
  );
  const isBuilder = ownedProjects.length > 0;

  const tabParam = searchParams.get("tab");
  const tab: Tab =
    tabParam && (TABS as string[]).includes(tabParam) && (tabParam !== "investors" || isBuilder)
      ? (tabParam as Tab)
      : "funded";

  const [allReceipts, setAllReceipts] = useState<FundReceipt[]>([]);
  const [allReceiptsLoading, setAllReceiptsLoading] = useState(false);
  useEffect(() => {
    if (tab !== "investors" || !isBuilder) return;
    let active = true;
    setAllReceiptsLoading(true);
    fetch("/api/user/funds")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (active) setAllReceipts(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAllReceiptsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, isBuilder]);

  // ── Summary figures ─────────────────────────────────────────────────────
  const { stakedUsd, stakedVaults } = useMemo(() => {
    let usd = 0;
    const vaults = new Set<string>();
    for (const r of receipts) {
      vaults.add(r.project_id);
      const currency = projects.find((p) => p.id === r.project_id)?.currencyType ?? "USDC";
      const units = rawToUnits(BigInt(r.amount || "0"));
      usd += isDollarToken(currency) ? units : xlmUsd ? units * xlmUsd : 0;
    }
    return { stakedUsd: usd, stakedVaults: vaults.size };
  }, [receipts, projects, xlmUsd]);

  const participation: Participation = isBuilder
    ? "steward"
    : receipts.length > 0
      ? "stakeholder"
      : "watching";

  // ── Rendering ───────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="container mx-auto space-y-6 py-10" role="status" aria-label="Loading your profile">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="h-32 animate-pulse rounded-xl bg-muted/50" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-md py-16">
        <div className="space-y-3 rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-lg font-semibold">Sign in to see your stakes</p>
          <p className="text-sm text-muted-foreground">
            Your stakes, votes, refunds and projects show here once you sign in with Google or email.
          </p>
          <Button className="w-full" onClick={() => login()}>
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  const setTab = (next: string) => router.replace(`/profile?tab=${next}`, { scroll: false });

  return (
    <div className="container mx-auto space-y-6 py-10">
      <ProfileHeader user={user} participation={participation} identity={identity} />

      <GettingSetUp
        walletAddress={address}
        walletActivated={readiness ? (readiness.account === "unknown" ? null : readiness.account === "ok") : null}
        identityVerified={identity === "verified"}
        isBuilder={isBuilder}
        onChanged={refreshHoldings}
      />

      <SummaryCards
        participation={participation}
        walletAddress={address}
        usdcRaw={readiness?.holding.status === "ok" ? readiness.holding.raw : readiness ? 0n : null}
        xlmRaw={readiness?.xlmRaw ?? null}
        xlmUsd={xlmUsd}
        stakedUsd={stakedUsd}
        stakedVaults={stakedVaults}
        holdingsLoading={readinessLoading && !readiness}
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="funded">Your stakes</TabsTrigger>
            <TabsTrigger value="projects">Your projects</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="wallet">Wallet</TabsTrigger>
            {isBuilder && <TabsTrigger value="investors">Stakeholders</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="funded" className="pt-2">
          <StakesTab
            receipts={receipts}
            projects={projects}
            loading={isLoadingFunds || isLoadingProjects}
            xlmUsd={xlmUsd}
          />
        </TabsContent>
        <TabsContent value="projects" className="pt-2">
          <ProjectsTab projects={ownedProjects} loading={isLoadingProjects} />
        </TabsContent>
        <TabsContent value="activity" className="pt-2">
          <ActivityTab address={address} projects={projects} xlmUsd={xlmUsd} />
        </TabsContent>
        <TabsContent value="wallet" className="pt-2">
          <WalletTab
            address={address}
            readiness={readiness}
            readinessLoading={readinessLoading}
            xlmUsd={xlmUsd}
            onRefresh={refreshHoldings}
          />
        </TabsContent>
        {isBuilder && (
          <TabsContent value="investors" className="pt-2">
            <StakeholdersTab
              projects={ownedProjects}
              allReceipts={allReceipts}
              loading={allReceiptsLoading || isLoadingProjects}
              xlmUsd={xlmUsd}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
