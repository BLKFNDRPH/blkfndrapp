"use client";

import { useState, useTransition, useEffect, useMemo, useCallback } from "react";
import type { Project } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  MoreHorizontal,
  Star,
  FileUp,
  Users,
  PiggyBank,
  CheckCircle,
  XCircle,
  Settings,
  Info,
  Plus,
  LayoutGrid,
  Shield,
  UserCheck,
  Tags,
  Clock,
} from "lucide-react";
import { IdentityRegistryPanel } from "./IdentityRegistryPanel";
import { Badge } from "../ui/badge";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Progress } from "@/components/ui/progress";
import { getKycRequests } from "@/app/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectsByStatusChart } from "./ProjectsByStatusChart";
import { InternalDetails } from "./InternalDetails";
import { AnimatePresence, motion } from "framer-motion";
import { CubeSpinner } from "../ui/CubeSpinner";
import { AdminManagement } from "./AdminManagement";
import { CategoryManager } from "./CategoryManager";
import {
  useProjects,
  usePlatformInfo,
  useRefreshAfterTx,
} from "@/context/BlockchainContext";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { formatCurrency } from "@/lib/formatters";
import { AdminSettingsSheet } from "./AdminSettingsSheet";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AdminDashboardProps {
  initialAdminAccessInfo: { hasAdminAccess: boolean; isMainAdmin: boolean };
}

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
});

interface InteractiveStatCardProps {
  title: string;
  value: string | number | null;
  icon: React.ReactNode;
  onClick?: () => void;
  isLoading?: boolean;
  glowColor?: string;
}

function InteractiveStatCard({
  title,
  value,
  icon,
  onClick,
  isLoading,
  glowColor,
}: InteractiveStatCardProps) {
  const isInteractive = !!onClick;

  return (
    <Card
      onClick={onClick}
      className={cn(
        "border-slate-800 bg-card/60 backdrop-blur-sm transition-all duration-300",
        isInteractive && "cursor-pointer select-none hover:bg-muted/30 hover:translate-y-[-2px] active:translate-y-[0px]",
        glowColor
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="h-5 w-5 shrink-0 flex items-center justify-center">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || value === null ? (
          <div className="h-8 w-24 bg-neutral-800 animate-pulse rounded mt-1" />
        ) : (
          <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {value}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminDashboard({
  initialAdminAccessInfo,
}: AdminDashboardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const {
    projects: contextProjects,
    refreshProjects,
    isLoadingProjects,
  } = useProjects();
  const { platformInfo } = usePlatformInfo();
  const refreshAfterTx = useRefreshAfterTx();
  const { openProjectDetails } = useProjectDetails();

  const [projects, setProjects] = useState(contextProjects);
  const [withdrawalCounts, setWithdrawalCounts] = useState<
    Record<string, number>
  >({});
  const [withdrawalApprovals, setWithdrawalApprovals] = useState<
    Record<string, string[]>
  >({});
  const [isInfoExpanded, setIsInfoExpanded] = useState(false);
  const [visibleRecentCount, setVisibleRecentCount] = useState(5);
  const [adminView, setAdminView] = useState<"projects" | "admins" | "identity" | "categories">("projects");

  // KYC and withdrawals SWR Polling
  const { data: withdrawalsData } = useSWR("/api/admin/withdrawals", fetcher, {
    refreshInterval: 15000,
  });
  const { data: kycData } = useSWR("/api/admin/kyc-count", fetcher, {
    refreshInterval: 15000,
  });

  const [kycRequests, setKycRequests] = useState<any[]>([]);
  const [isLoadingKyc, setIsLoadingKyc] = useState(false);

  const fetchKycRequests = useCallback(async () => {
    setIsLoadingKyc(true);
    try {
      const res = await getKycRequests();
      if (res?.success) {
        setKycRequests(res.requests || []);
      }
    } catch (err) {
      console.warn("Failed to fetch KYC requests in dashboard:", err);
    } finally {
      setIsLoadingKyc(false);
    }
  }, []);

  useEffect(() => {
    fetchKycRequests();
  }, [fetchKycRequests]);

  // Vault inspector dialog state
  const [selectedVaultProject, setSelectedVaultProject] = useState<Project | null>(null);
  const [selectedVaultInfo, setSelectedVaultInfo] = useState<any | null>(null);
  const [isLoadingVaultInfo, setIsLoadingVaultInfo] = useState(false);
  const [vaultInfoError, setVaultInfoError] = useState<string | null>(null);
  const [liveBondAmounts, setLiveBondAmounts] = useState<Record<string, number>>({});

  const formatAddress = (address: string) => {
    if (!address) return "Unknown";
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  useEffect(() => {
    let active = true;
    const fetchPendingBonds = async () => {
      const pendingWithVault = projects.filter(
        (p) => p.status === "pending" && p.vaultAddress
      );
      for (const project of pendingWithVault) {
        if (!active) break;
        if (project.vaultAddress && liveBondAmounts[project.id] === undefined) {
          try {
            const vaultClient = new VaultClient({
              contractId: project.vaultAddress,
              rpcUrl: SOROBAN_RPC_URL,
              networkPassphrase: NETWORK_PASSPHRASE,
            });
            const infoTx = await vaultClient.get_info();
            const infoRes = await infoTx.simulate();
            if (infoRes.result && infoRes.result.bond_amount !== undefined && active) {
              const liveBond = Number(infoRes.result.bond_amount) / 10_000_000;
              setLiveBondAmounts((prev) => ({
                ...prev,
                [project.id]: liveBond,
              }));
            }
          } catch (err) {
            console.error(`Failed to fetch live bond for project ${project.id}:`, err);
          }
        }
      }
    };

    if (projects.length > 0) {
      fetchPendingBonds();
    }
    return () => {
      active = false;
    };
  }, [projects]);

  const handleViewVaultConfig = async (project: Project) => {
    setSelectedVaultProject(project);
    setSelectedVaultInfo(null);
    setVaultInfoError(null);
    if (!project.vaultAddress) {
      setVaultInfoError("No vault address found for this project.");
      return;
    }
    setIsLoadingVaultInfo(true);
    try {
      const vaultClient = new VaultClient({
        contractId: project.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      const infoTx = await vaultClient.get_info();
      const infoRes = await infoTx.simulate();
      let parsedInfo = null;
      try {
        parsedInfo = infoRes.result || null;
      } catch (parseErr) {
        console.warn("Failed to parse vault on-chain info, likely legacy schema:", parseErr);
        parsedInfo = { isLegacy: true };
      }
      setSelectedVaultInfo(parsedInfo);
    } catch (err: any) {
      console.error("Failed to fetch vault info:", err);
      setVaultInfoError(err.message || String(err));
    } finally {
      setIsLoadingVaultInfo(false);
    }
  };

  // approveProject, rejectProject and getPendingProposals are gone with the
  // old model: a project exists when its vault is deployed, and withdrawals
  // are decided by contributors inside each vault rather than proposed here.

  useEffect(() => {
    setProjects(contextProjects);
  }, [contextProjects]);

  // Withdrawal proposals no longer exist. Contributors vote inside the vault.

  const allRecentProjects = useMemo(
    () =>
      projects
        .filter((p) => p.status !== "pending")
        .sort(
          (a, b) =>
            (new Date(b.createdAt!) as any) - (new Date(a.createdAt!) as any),
        ),
    [projects],
  );

  const recentProjects = allRecentProjects.slice(0, visibleRecentCount);

  // Admin approval of a project no longer exists on chain. A vault is live
  // the moment the factory deploys it, with the builder bonded. Hiding a
  // listing is an off-chain moderation concern and is handled by the
  // is_public flag on the project row, not by a contract call.
  const handleUpdateStatus = (_id: string, _status: Project["status"]) => {
    toast({
      title: "No longer applicable",
      description:
        "Projects are live as soon as their vault is deployed. There is no on-chain approval step.",
    });
  };

  // Client-side computed count of milestones awaiting signatures
  const awaitingSignaturesCount = useMemo(() => {
    let count = 0;
    projects.forEach((p) => {
      if (p.milestones) {
        p.milestones.forEach((m) => {
          if (m.proof && m.proof.trim() !== "" && !m.released) {
            count++;
          }
        });
      }
    });
    return count;
  }, [projects]);

  // Aggregated "Action Required" feed items
  const actionRequiredItems = useMemo(() => {
    const items: {
      id: string;
      type: "project" | "kyc" | "milestone";
      title: string;
      description: string;
      badgeText: string;
      badgeVariant: "default" | "secondary" | "destructive" | "outline";
      actionLabel: string;
      onAction: () => void;
      urgency: "high" | "medium" | "low";
    }[] = [];

    // Projects pending review
    projects
      .filter((p) => p.status === "pending")
      .forEach((p) => {
        items.push({
          id: `project-review-${p.id}`,
          type: "project",
          title: `Review Project: "${p.title}"`,
          description: `Goal: ${formatCurrency(p.fundingGoal, p.currencyType ?? "XLM")} • By ${(p as any).creatorName || p.creator}`,
          badgeText: "Review Pending",
          badgeVariant: "secondary",
          actionLabel: "Review",
          onAction: () => openProjectDetails(p),
          urgency: "medium",
        });
      });

    // Pending KYC requests
    kycRequests
      .filter((r) => r.status === "pending")
      .forEach((r) => {
        items.push({
          id: `kyc-verify-${r.address}`,
          type: "kyc",
          title: `KYC: ${r.fullName}`,
          description: `Email: ${r.email} • Doc: ${r.documentType}`,
          badgeText: "KYC Pending",
          badgeVariant: "outline",
          actionLabel: "Verify",
          onAction: () => setAdminView("identity"),
          urgency: "medium",
        });
      });

    // Milestone proofs submitted
    projects.forEach((p) => {
      if (p.milestones) {
        p.milestones.forEach((m) => {
          if (m.proof && m.proof.trim() !== "" && !m.released) {
            items.push({
              id: `milestone-proof-${p.id}-${m.id}`,
              type: "milestone",
              title: `Milestone Proof: "${p.title}"`,
              description: `Milestone #${m.id}: "${m.title || "Untitled"}" proof submitted.`,
              badgeText: "Proof Submitted",
              badgeVariant: "default",
              actionLabel: "Verify",
              onAction: () => router.push("/admin/withdrawals"),
              urgency: "high",
            });
          }
        });
      }
    });

    // Sort items so high urgency is first
    return items.sort((a, b) => {
      const urgencyScore = { high: 3, medium: 2, low: 1 };
      return urgencyScore[b.urgency] - urgencyScore[a.urgency];
    });
  }, [projects, kycRequests, openProjectDetails, router]);

  return (
    <>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight font-headline text-accent">
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground text-lg">
              Welcome back, {user?.name.split(" ")[0]}. Here's what's happening.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setIsInfoExpanded((prev) => !prev)}
            >
              <Info className="mr-2 h-5 w-5" />
              Tools
            </Button>
            {platformInfo && <AdminSettingsSheet />}
            <div className="flex items-center gap-1 border bg-card rounded-xl p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setAdminView("projects")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all",
                  adminView === "projects"
                    ? "bg-[#003049] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-4 w-4" />
                Projects
              </button>
              <button
                type="button"
                onClick={() => setAdminView("identity")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all",
                  adminView === "identity"
                    ? "bg-[#003049] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <UserCheck className="h-4 w-4" />
                Identity Verification
              </button>
              <button
                type="button"
                onClick={() => setAdminView("admins")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all",
                  adminView === "admins"
                    ? "bg-[#003049] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Users className="h-4 w-4" />
                Admins
              </button>
              <button
                type="button"
                onClick={() => setAdminView("categories")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all",
                  adminView === "categories"
                    ? "bg-[#003049] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Tags className="h-4 w-4" />
                Categories
              </button>
            </div>
          </div>
        </div>

        {isInfoExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -20 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <InternalDetails />
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {adminView === "projects" && (
            <motion.div
              key="projects-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              {/* Interactive KPI Row */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <InteractiveStatCard
                  title="Pending Withdrawals"
                  value={withdrawalsData !== undefined ? withdrawalsData.count : null}
                  icon={<PiggyBank className="h-5 w-5 text-amber-500" />}
                  onClick={() => router.push("/admin/withdrawals")}
                  glowColor="hover:shadow-amber-500/5 hover:border-amber-500/20"
                />
                <InteractiveStatCard
                  title="Pending KYC"
                  value={kycData !== undefined ? kycData.count : null}
                  icon={<UserCheck className="h-5 w-5 text-blue-500" />}
                  onClick={() => setAdminView("identity")}
                  glowColor="hover:shadow-blue-500/5 hover:border-blue-500/20"
                />
                <InteractiveStatCard
                  title="Awaiting Signatures"
                  value={isLoadingProjects ? null : awaitingSignaturesCount}
                  icon={<Shield className="h-5 w-5 text-emerald-500" />}
                  onClick={() => router.push("/admin/withdrawals")}
                  glowColor="hover:shadow-emerald-500/5 hover:border-emerald-500/20"
                />
                <InteractiveStatCard
                  title="System Threshold"
                  value={
                    platformInfo
                      ? `${platformInfo.multisigThreshold} of ${platformInfo.multiSigAdmins?.length ?? 0}`
                      : null
                  }
                  icon={<Settings className="h-5 w-5 text-purple-500" />}
                  onClick={() => setAdminView("admins")}
                  glowColor="hover:shadow-purple-500/5 hover:border-purple-500/20"
                />
              </div>

              {/* Action Feed & Status Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                {/* Action Required Feed (col-span-4) */}
                <Card className="lg:col-span-4 border-slate-800 bg-card/80 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Shield className="h-5 w-5 text-accent animate-pulse" />
                      Action Required
                    </CardTitle>
                    <CardDescription>
                      Pending operations requiring immediate administrator attention.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="max-h-[400px] overflow-y-auto pr-2 space-y-3">
                    {isLoadingProjects || isLoadingKyc ? (
                      <div className="space-y-3">
                        <div className="h-16 w-full bg-neutral-800 animate-pulse rounded-xl" />
                        <div className="h-16 w-full bg-neutral-800 animate-pulse rounded-xl" />
                        <div className="h-16 w-full bg-neutral-800 animate-pulse rounded-xl" />
                      </div>
                    ) : actionRequiredItems.length > 0 ? (
                      actionRequiredItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3.5 rounded-xl border border-slate-800/80 bg-neutral-950/20 hover:bg-neutral-900/40 transition-colors gap-4"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge
                                variant={item.badgeVariant}
                                className={cn(
                                  "text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider",
                                  item.urgency === "high" && "bg-rose-500/10 text-rose-500 hover:bg-rose-500/15 border-rose-500/20",
                                  item.urgency === "medium" && "bg-amber-500/10 text-amber-500 hover:bg-amber-500/15 border-amber-500/20"
                                )}
                              >
                                {item.badgeText}
                              </Badge>
                            </div>
                            <h4 className="text-sm font-bold text-foreground truncate">
                              {item.title}
                            </h4>
                            <p className="text-xs text-muted-foreground truncate">
                              {item.description}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            onClick={item.onAction}
                            className="bg-[#003049] hover:bg-[#003049]/90 text-white shrink-0 font-semibold"
                          >
                            {item.actionLabel}
                          </Button>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border border-dashed border-slate-800 rounded-xl bg-neutral-950/5">
                        <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                          <CheckCircle className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">All actions resolved</p>
                          <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
                            No pending KYC verifications, project reviews, or milestone proof validations.
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Projects by Status Distribution Chart (col-span-3) */}
                <Card className="lg:col-span-3 border-slate-800 bg-card/80 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle>Projects by Status</CardTitle>
                    <CardDescription>
                      Distribution of all registered campaigns.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4 flex items-center justify-center">
                    <ProjectsByStatusChart projects={projects} />
                  </CardContent>
                </Card>
              </div>

              {/* Enhanced Recent Projects Grid */}
              <Card className="border-slate-800 bg-card/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Recent Projects</CardTitle>
                  <CardDescription>
                    Explore all projects created on-chain.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Milestone Progress</TableHead>
                        <TableHead>Goal</TableHead>
                        <TableHead>Active Proposals</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentProjects.length > 0 ? (
                        recentProjects.map((project) => (
                          <TableRow
                            key={project.id}
                            onClick={() => openProjectDetails(project)}
                            className="cursor-pointer"
                          >
                            <TableCell className="font-bold">
                              <div className="flex items-center gap-2">
                                <span className="truncate max-w-[200px]">{project.title}</span>
                                {(() => {
                                  if (project.status === "completed" || project.status === "expired" || project.status === "failed") return null;
                                  const timeDiff = project.fundingDeadline ? project.fundingDeadline - Date.now() : 0;
                                  const isUrgent = timeDiff > 0 && timeDiff <= 48 * 60 * 60 * 1000;
                                  if (!isUrgent) return null;

                                  const hoursLeft = Math.ceil(timeDiff / (3600 * 1000));
                                  return (
                                    <Badge variant="destructive" className="bg-rose-500/10 text-rose-500 border-rose-500/20 text-[9px] font-bold uppercase flex items-center gap-1 animate-pulse shrink-0">
                                      <Clock className="h-2.5 w-2.5" />
                                      {hoursLeft}h Left
                                    </Badge>
                                  );
                                })()}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  project.status === "approved" ||
                                    project.status === "completed" ||
                                    project.status === "funded"
                                    ? "default"
                                    : project.status === "pending"
                                      ? "secondary"
                                      : "destructive"
                                }
                              >
                                {project.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const milestones = project.milestones || [];
                                const total = milestones.length;
                                if (total === 0) return <span className="text-muted-foreground text-xs">—</span>;

                                const released = milestones.filter(m => m.released).length;
                                const percent = Math.round((released / total) * 100);

                                return (
                                  <div className="space-y-1.5 max-w-[120px]">
                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold">
                                      <span>{released} of {total}</span>
                                      <span>{percent}%</span>
                                    </div>
                                    <Progress value={percent} className="h-1 bg-neutral-800" />
                                  </div>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              {formatCurrency(
                                project.fundingGoal,
                                project.currencyType ?? "XLM",
                              )}
                            </TableCell>
                            <TableCell>
                              {withdrawalCounts[project.id] ? (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                  <span>
                                    {withdrawalCounts[project.id]} Pending
                                  </span>
                                  <div className="text-[10px] text-muted-foreground font-normal">
                                    Approved by: (
                                    {withdrawalApprovals[project.id]
                                      ? withdrawalApprovals[
                                        project.id
                                      ].length
                                      : 0}
                                    )
                                  </div>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <DropdownMenuItem
                                    onClick={() => openProjectDetails(project)}
                                  >
                                    View Details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleViewVaultConfig(project)}
                                  >
                                    View Vault
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center">
                            No recent projects to display.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
                {allRecentProjects.length > visibleRecentCount && (
                  <CardFooter className="justify-center">
                    <Button
                      onClick={() => setVisibleRecentCount((prev) => prev + 5)}
                      variant="secondary"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Show More
                    </Button>
                  </CardFooter>
                )}
              </Card>
            </motion.div>
          )}

          {adminView === "identity" && (
            <motion.div
              key="identity-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <IdentityRegistryPanel />
            </motion.div>
          )}

          {adminView === "admins" && (
            <motion.div
              key="admins-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <AdminManagement
                isMainAdmin={initialAdminAccessInfo.isMainAdmin}
              />
            </motion.div>
          )}

          {adminView === "categories" && (
            <motion.div
              key="categories-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <CategoryManager />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Vault Configuration Dialog */}
      <Dialog
        open={selectedVaultProject !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedVaultProject(null);
            setSelectedVaultInfo(null);
            setVaultInfoError(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl border border-border bg-card/95 text-card-foreground backdrop-blur-xl p-6 rounded-2xl shadow-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Project Vault Configuration</DialogTitle>
            <DialogDescription>
              On-chain administrative and fee configuration for the vault.
            </DialogDescription>
          </DialogHeader>

          {selectedVaultProject && (
            <div className="space-y-4 my-2">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground font-semibold">Vault Address</span>
                <p className="text-xs font-mono bg-muted/50 p-2 rounded border border-border break-all font-semibold">
                  {selectedVaultProject.vaultAddress || "No vault deployed"}
                </p>
              </div>

              {isLoadingVaultInfo ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span className="text-xs text-muted-foreground">Fetching on-chain config...</span>
                </div>
              ) : vaultInfoError ? (
                <div className="border border-rose-500/20 bg-rose-500/5 px-4 py-3 rounded-xl text-xs text-rose-500 font-semibold leading-relaxed">
                  {vaultInfoError}
                </div>
              ) : selectedVaultInfo ? (
                selectedVaultInfo.isLegacy ? (
                  <div className="border border-amber-500/20 bg-amber-500/5 px-4 py-3 rounded-xl text-xs text-amber-500 flex flex-col gap-1">
                    <strong className="text-foreground font-semibold">Legacy Contract Instance</strong>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">
                      This vault was deployed using an older smart contract version. Its on-chain configurations cannot be parsed.
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4 pt-2">
                    <div className="bg-muted/30 p-3.5 rounded-xl border border-muted text-xs flex flex-col gap-1.5">
                      <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Vault Administrator</span>
                      <span className="text-foreground font-mono text-[11px] font-semibold break-all select-all font-mono" title={selectedVaultInfo.admin}>
                        {formatAddress(selectedVaultInfo.admin)}
                      </span>
                    </div>

                    <div className="bg-muted/30 p-3.5 rounded-xl border border-muted text-xs flex flex-col gap-1.5">
                      <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Fee Payout Wallet</span>
                      <span className="text-foreground font-mono text-[11px] font-semibold break-all select-all font-mono" title={selectedVaultInfo.fee_wallet_address}>
                        {formatAddress(selectedVaultInfo.fee_wallet_address)}
                      </span>
                    </div>

                    <div className="bg-muted/30 p-3.5 rounded-xl border border-muted text-xs flex flex-col gap-1.5 justify-center">
                      <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Fee Percentage</span>
                      <span className="text-emerald-500 text-base font-bold flex items-baseline gap-1">
                        {selectedVaultInfo.fee_percentage !== undefined ? `${(Number(selectedVaultInfo.fee_percentage) / 100).toFixed(2)}%` : "0.00%"}
                        {selectedVaultInfo.fee_percentage !== undefined && (
                          <span className="text-muted-foreground text-xs font-normal font-mono"> ({selectedVaultInfo.fee_percentage.toString()} bps)</span>
                        )}
                      </span>
                    </div>
                  </div>
                )
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
