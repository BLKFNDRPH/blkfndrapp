"use client";

import { useCallback, useEffect, useState } from "react";
import { rpc, xdr, Address, scValToNative } from "@stellar/stellar-sdk";
import { signTransaction, signAuthEntry } from "@stellar/freighter-api";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useToast } from "@/hooks/use-toast";
import { Client as ApprovalClient } from "@/packages/blkfndr_approval/src";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { useProjects, useRefreshAfterTx } from "@/context/BlockchainContext";
import type { Project } from "@/lib/types";
import {
  Shield,
  CheckCircle,
  RefreshCw,
  Users,
  AlertTriangle,
  FileCode,
  DollarSign,
  ChevronRight,
  UserCheck,
  ExternalLink
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../ui/dialog";

const formatTextWithLinks = (text: string) => {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-semibold break-all"
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

const extractUrls = (text: string): string[] => {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches ? Array.from(new Set(matches)) : [];
};

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";
const ALLOWED_ADMIN = process.env.NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS || "";

const getSignerOptions = (publicKey: string) => ({
  signTransaction: (xdrStr: string) =>
    signTransaction(xdrStr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    }),
  signAuthEntry: async (xdrStr: string) => {
    const res = await signAuthEntry(xdrStr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    });
    if (!res.signedAuthEntry) {
      throw new Error("Freighter signedAuthEntry returned null");
    }
    return {
      signedAuthEntry: res.signedAuthEntry,
      signerAddress: res.signerAddress,
    };
  },
});

export function VaultOperationsPanel() {
  const { freighterWalletAddress } = useFreighterWallet();
  const { toast } = useToast();
  const refreshAfterTx = useRefreshAfterTx();
  const { projects, refreshProjects } = useProjects();

  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [signersList, setSignersList] = useState<string[]>([]);
  const [multisigThreshold, setMultisigThreshold] = useState<number>(2);

  // Milestone voting state
  const [milestoneVotes, setMilestoneVotes] = useState<Record<string, string[]>>({});
  const [milestoneReleasedState, setMilestoneReleasedState] = useState<Record<number, boolean>>({});

  // Slashing voting state
  const [slashingApprovals, setSlashingApprovals] = useState<Record<string, boolean>>({});
  const [slashVotesByProject, setSlashVotesByProject] = useState<Record<string, string[]>>({});
  const [slashThresholdsByProject, setSlashThresholdsByProject] = useState<Record<string, number>>({});

  // Proof modal state
  const [activeProofMilestoneId, setActiveProofMilestoneId] = useState<number | null>(null);
  const [activeProofMilestoneIndex, setActiveProofMilestoneIndex] = useState<number>(-1);
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [detailedProject, setDetailedProject] = useState<Project | null>(null);

  const fetchSelectedProjectFresh = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (res.ok) {
        const data = await res.json();
        setDetailedProject(data);
      }
    } catch (err) {
      console.warn("Failed to fetch fresh project details:", err);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      refreshProjects();
      setDetailedProject(null);
    }
  }, [selectedProjectId, refreshProjects]);

  const isMultisigSigner = signersList.includes(freighterWalletAddress || "");

  const activeVaultProjects = projects.filter(
    (p) =>
      !!p.vaultAddress &&
      p.vaultAddress !== "" &&
      (p.status?.toLowerCase() === "funded" || p.status?.toLowerCase() === "active")
  );

  const selectedProject = detailedProject || activeVaultProjects.find((p) => p.id === selectedProjectId);
  const selectedVaultAddress = selectedProject?.vaultAddress || "";

  const activeProofMilestone = selectedProject?.milestones?.find((m: any) => m.id === activeProofMilestoneId);
  const activeProofMilestoneVotes = activeProofMilestone ? (milestoneVotes[activeProofMilestone.id] || []) : [];
  const activeProofMilestoneHasVoted = freighterWalletAddress && activeProofMilestoneVotes.includes(freighterWalletAddress);
  const activeProofMilestoneIsReleased = activeProofMilestone ? activeProofMilestone.released : false;
  const activeProofMilestoneIsProofMissing = activeProofMilestone ? (!activeProofMilestone.proof || activeProofMilestone.proof.trim() === "") : true;

  // Fetch multisig configuration from the Approval module contract
  const fetchApprovalConfig = useCallback(async () => {
    if (!freighterWalletAddress) return;
    try {
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
      });

      const [signersTx, thresholdTx] = await Promise.all([
        client.get_signers(),
        client.get_threshold(),
      ]);

      const signersRes = await signersTx.simulate();
      const thresholdRes = await thresholdTx.simulate();

      setSignersList(signersRes.result || []);
      setMultisigThreshold(thresholdRes.result || 2);
    } catch (err) {
      console.error("Failed to fetch multisig signers config:", err);
    }
  }, [freighterWalletAddress]);

  // Fetch votes and threshold for slashing bond
  const fetchSlashingState = useCallback(async (projectsList: any[]) => {
    const approvals: Record<string, boolean> = {};
    const votes: Record<string, string[]> = {};
    const thresholds: Record<string, number> = {};
    const eligibleProjects = projectsList.filter((p) => !!p.vaultAddress);

    await Promise.all(
      eligibleProjects.map(async (proj) => {
        try {
          const vaultClient = new VaultClient({
            contractId: proj.vaultAddress,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
            publicKey: freighterWalletAddress || ALLOWED_ADMIN,
          });

          const infoTx = await vaultClient.get_info();
          const infoRes = await infoTx.simulate();
          const info = infoRes.result;

          if (info && info.approval_module) {
            const approvalClient = new ApprovalClient({
              contractId: info.approval_module,
              rpcUrl: SOROBAN_RPC_URL,
              networkPassphrase: NETWORK_PASSPHRASE,
              publicKey: freighterWalletAddress || ALLOWED_ADMIN,
            });

            const slashTx = await approvalClient.is_slash_approved({
              project_id: BigInt(info.project_id),
            });
            const slashRes = await slashTx.simulate();
            approvals[proj.vaultAddress] = Boolean(slashRes.result);

            try {
              const threshTx = await approvalClient.get_threshold();
              const threshRes = await threshTx.simulate();
              thresholds[proj.vaultAddress] = threshRes.result || 2;
            } catch (tErr) {
              thresholds[proj.vaultAddress] = 2;
            }

            try {
              const votesTx = await approvalClient.get_slash_approvals({
                project_id: BigInt(info.project_id),
              });
              const votesRes = await votesTx.simulate();
              votes[proj.vaultAddress] = votesRes.result || [];
            } catch (vErr) {
              // Fallback to directly querying ledger entries if custom view is missing
              try {
                const slashSymbol = xdr.ScVal.scvSymbol("SlashApproval");
                const keyScVal = xdr.ScVal.scvVec([
                  slashSymbol,
                  xdr.ScVal.scvU64(new xdr.Uint64(Number(info.project_id))),
                ]);

                const server = new rpc.Server(SOROBAN_RPC_URL);
                const ledgerKey = xdr.LedgerKey.contractData(
                  new xdr.LedgerKeyContractData({
                    contract: Address.fromString(info.approval_module).toScAddress(),
                    key: keyScVal,
                    durability: xdr.ContractDataDurability.persistent(),
                  })
                );
                const res = await server.getLedgerEntries(ledgerKey);
                if (res.entries && res.entries.length > 0) {
                  const nativeVal = scValToNative((res.entries[0].val as any).contractData().val());
                  if (Array.isArray(nativeVal)) {
                    votes[proj.vaultAddress] = nativeVal.map((v) => String(v));
                  } else {
                    votes[proj.vaultAddress] = [];
                  }
                } else {
                  votes[proj.vaultAddress] = [];
                }
              } catch (ledgerErr) {
                votes[proj.vaultAddress] = [];
              }
            }
          }
        } catch (err) {
          console.error(`Failed to load slashing state for project ${proj.title}:`, err);
        }
      })
    );

    setSlashingApprovals(approvals);
    setSlashVotesByProject(votes);
    setSlashThresholdsByProject(thresholds);
  }, [freighterWalletAddress]);

  // Fetch milestone approvals votes list
  const fetchMilestoneVotesState = useCallback(async (projectId: string, milestonesList: any[], vaultAddr: string) => {
    if (!projectId || !vaultAddr) return;

    try {
      const vaultClient = new VaultClient({
        contractId: vaultAddr,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress || ALLOWED_ADMIN,
      });

      const infoTx = await vaultClient.get_info();
      const infoRes = await infoTx.simulate();
      const info = infoRes.result;

      if (info && info.milestones) {
        const releasedMap: Record<number, boolean> = {};
        info.milestones.forEach((lm: any) => {
          releasedMap[Number(lm.id)] = lm.released;
        });
        setMilestoneReleasedState(releasedMap);
      }

      const approvalModuleId = info?.approval_module || APPROVAL_ID;

      const approvalClient = new ApprovalClient({
        contractId: approvalModuleId,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress || ALLOWED_ADMIN,
      });

      const votesMap: Record<string, string[]> = {};

      await Promise.all(
        milestonesList.map(async (m) => {
          try {
            const approvalsTx = await approvalClient.get_milestone_approvals({
              project_id: BigInt(projectId),
              milestone_id: Number(m.id),
            });
            const approvalsRes = await approvalsTx.simulate();
            votesMap[m.id] = approvalsRes.result || [];
          } catch (vErr) {
            // Ledger fallback
            try {
              const milestoneSymbol = xdr.ScVal.scvSymbol("MilestoneApproval");
              const keyScVal = xdr.ScVal.scvVec([
                milestoneSymbol,
                xdr.ScVal.scvU64(new xdr.Uint64(Number(projectId))),
                xdr.ScVal.scvU32(Number(m.id)),
              ]);

              const server = new rpc.Server(SOROBAN_RPC_URL);
              const ledgerKey = xdr.LedgerKey.contractData(
                new xdr.LedgerKeyContractData({
                  contract: Address.fromString(approvalModuleId).toScAddress(),
                  key: keyScVal,
                  durability: xdr.ContractDataDurability.persistent(),
                })
              );
              const res = await server.getLedgerEntries(ledgerKey);
              if (res.entries && res.entries.length > 0) {
                const nativeVal = scValToNative((res.entries[0].val as any).contractData().val());
                if (Array.isArray(nativeVal)) {
                  votesMap[m.id] = nativeVal.map((v) => String(v));
                } else {
                  votesMap[m.id] = [];
                }
              } else {
                votesMap[m.id] = [];
              }
            } catch (ledgerErr) {
              votesMap[m.id] = [];
            }
          }
        })
      );

      setMilestoneVotes(votesMap);
    } catch (err) {
      console.error("Failed to load milestone votes state:", err);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    fetchApprovalConfig();
  }, [fetchApprovalConfig]);

  useEffect(() => {
    if (activeVaultProjects.length > 0) {
      fetchSlashingState(activeVaultProjects);
    }
  }, [projects, fetchSlashingState]);

  useEffect(() => {
    if (selectedProject && selectedProject.milestones && selectedProject.vaultAddress) {
      fetchMilestoneVotesState(selectedProject.id, selectedProject.milestones, selectedProject.vaultAddress);
    }
  }, [selectedProjectId, selectedProject, fetchMilestoneVotesState]);

  const handleRefresh = async () => {
    setLoading(true);
    await refreshProjects();
    await fetchApprovalConfig();
    if (selectedProject && selectedProject.milestones && selectedProject.vaultAddress) {
      await fetchMilestoneVotesState(selectedProject.id, selectedProject.milestones, selectedProject.vaultAddress);
    }
    setLoading(false);
    toast({
      title: "Data Synced",
      description: "Successfully re-loaded contract storage and ledger entries.",
    });
  };

  // Sign Milestone Approval in multisig contract
  const handleApproveMilestone = async (milestoneId: number) => {
    if (!freighterWalletAddress) return;
    if (!selectedProject || !selectedProject.vaultAddress) return;

    setLoading(true);
    try {
      const vaultClient = new VaultClient({
        contractId: selectedProject.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
      });

      const infoTx = await vaultClient.get_info();
      const infoRes = await infoTx.simulate();
      const approvalModuleId = infoRes.result?.approval_module || APPROVAL_ID;

      const approvalClient = new ApprovalClient({
        contractId: approvalModuleId,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await approvalClient.approve_milestone({
        signer: freighterWalletAddress,
        project_id: BigInt(selectedProject.id),
        milestone_id: Number(milestoneId),
      });

      await tx.signAndSend();

      toast({
        title: "Milestone Approved",
        description: `Successfully voted to approve Milestone #${milestoneId} on-chain.`,
      });

      // Fetch updated votes
      if (selectedProject.milestones) {
        await fetchMilestoneVotesState(selectedProject.id, selectedProject.milestones, selectedProject.vaultAddress);
      }
      if (selectedProjectId) {
        fetchSelectedProjectFresh(selectedProjectId);
      }
      refreshAfterTx();
    } catch (err: any) {
      toast({
        title: "Approval Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Execute Tranche Release on the Vault Contract
  const handleReleaseMilestone = async (milestoneId: number) => {
    if (!freighterWalletAddress) return;
    if (!selectedProject || !selectedProject.vaultAddress) return;

    setLoading(true);
    try {
      const client = new VaultClient({
        contractId: selectedProject.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      // Verify on-chain that this milestone has not been released yet
      const infoTx = await client.get_info();
      const infoRes = await infoTx.simulate();
      const info = infoRes.result;
      const onChainMilestone = info?.milestones?.find((lm: any) => Number(lm.id) === milestoneId);
      if (onChainMilestone?.released) {
        throw new Error("This milestone has already been released on-chain.");
      }

      const tx = await client.release_milestone({
        milestone_id: Number(milestoneId),
      });

      await tx.signAndSend();

      toast({
        title: "Tranche Released",
        description: `Milestone #${milestoneId} funding allocation successfully transferred to creator.`,
      });

      // Synchronize database indexer
      await fetch("/api/indexer", { method: "POST" });
      await refreshProjects();
      if (selectedProjectId) {
        fetchSelectedProjectFresh(selectedProjectId);
      }
      refreshAfterTx();
    } catch (err: any) {
      toast({
        title: "Execution Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Vote Slashing Approval
  const handleApproveSlash = async () => {
    if (!freighterWalletAddress) return;
    if (!selectedProject || !selectedProject.vaultAddress) return;

    setLoading(true);
    try {
      const vaultClient = new VaultClient({
        contractId: selectedProject.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
      });

      const infoTx = await vaultClient.get_info();
      const infoRes = await infoTx.simulate();
      const approvalModuleId = infoRes.result?.approval_module || APPROVAL_ID;

      const approvalClient = new ApprovalClient({
        contractId: approvalModuleId,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await approvalClient.approve_slash({
        signer: freighterWalletAddress,
        project_id: BigInt(selectedProject.id),
      });

      await tx.signAndSend();

      toast({
        title: "Slashing Voted",
        description: "Your vote to slash the creator bond has been submitted.",
      });

      await fetchSlashingState(activeVaultProjects);
      refreshAfterTx();
    } catch (err: any) {
      toast({
        title: "Vote Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Execute Slashing
  const handleExecuteSlashing = async () => {
    if (!freighterWalletAddress) return;
    if (!selectedProject || !selectedProject.vaultAddress) return;

    setLoading(true);
    try {
      const client = new VaultClient({
        contractId: selectedProject.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.slash_bond();
      await tx.signAndSend();

      toast({
        title: "Bond Slashed Successfully",
        description: "The campaign performance bond has been slashed and vault is now in refund state.",
      });

      // Synchronize database indexer
      await fetch("/api/indexer", { method: "POST" });
      await refreshProjects();
      refreshAfterTx();
    } catch (err: any) {
      toast({
        title: "Execution Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Sidebar List of Vaults */}
      <Card className="lg:col-span-1 border bg-card/60 backdrop-blur-sm overflow-hidden flex flex-col max-h-[80vh]">
        <CardHeader className="border-b py-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-primary" /> Deployed Vaults
              </CardTitle>
              <CardDescription className="text-xs">
                Select a project to manage its escrow state on-chain.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-y-auto flex-1">
          {activeVaultProjects.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">
              No deployed vaults found in database.
            </p>
          ) : (
            <div className="divide-y">
              {activeVaultProjects.map((p) => {
                const isSelected = p.id === selectedProjectId;
                const isSlashed = p.status?.toLowerCase() === "refunding";
                const hasNewProof = (p.milestones || []).some(
                  (m: any) => m.proof && m.proof.trim() !== "" && !m.released
                );

                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProjectId(p.id)}
                    className={cn(
                      "w-full text-left p-4 transition-all flex items-center justify-between hover:bg-[#003049]/5",
                      isSelected && "bg-[#003049]/5 border-l-4 border-l-[#003049]"
                    )}
                  >
                    <div className="min-w-0 pr-2 flex-1">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {p.title}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(p.milestones || []).map((m: any, idx: number) => {
                          const isReleased = m.released;
                          const firstUnreleasedIdx = (p.milestones || []).findIndex((ms: any) => !ms.released);
                          const isPendingApproval = !isReleased && idx === firstUnreleasedIdx;
                          const isFuture = !isReleased && idx > firstUnreleasedIdx;

                          return (
                            <span
                              key={m.id}
                              className={cn(
                                "text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider",
                                isReleased && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                                isPendingApproval && "bg-amber-500/10 text-amber-600 border-amber-500/20 animate-pulse",
                                isFuture && "bg-muted text-muted-foreground border-border/40"
                              )}
                            >
                              M{idx + 1}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={isSlashed ? "destructive" : "secondary"}
                          className="text-[9px] uppercase tracking-wider font-semibold py-0.5"
                        >
                          {p.status}
                        </Badge>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      {hasNewProof && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                          New Proof
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Operations Board */}
      <Card className="lg:col-span-2 border bg-card/60 backdrop-blur-sm overflow-hidden flex flex-col">
        {!selectedProject ? (
          <div className="flex-1 flex flex-col items-center justify-center py-24 text-center p-6">
            <FileCode className="h-10 w-10 text-muted-foreground/60 mb-2" />
            <h3 className="text-sm font-semibold text-foreground">No Vault Selected</h3>
            <p className="text-xs text-muted-foreground max-w-xs mt-1">
              Select a project from the left panel to review milestones approvals, signature thresholds, and perform bond slashing.
            </p>
          </div>
        ) : (
          <>
            <CardHeader className="border-b bg-muted/20 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold">{selectedProject.title}</CardTitle>
                  <CardDescription className="text-xs font-mono mt-0.5 select-all">
                    <a
                      href={`https://stellar.expert/explorer/testnet/contract/${selectedVaultAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                    >
                      {selectedVaultAddress}
                      <ExternalLink className="h-3 w-3 inline" />
                    </a>
                  </CardDescription>
                </div>
                <Badge className="bg-[#003049] text-white">
                  Active escrow
                </Badge>
              </div>
            </CardHeader>

            <ScrollAreaContainer>
              <div className="p-6 space-y-6">
                {/* Vault Config Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-border/60 bg-background/50 rounded-xl p-3.5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-[#003049]/5 flex items-center justify-center text-[#003049]">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                        Multisig Signers
                      </p>
                      <p className="text-xs font-bold text-foreground mt-0.5">
                        {signersList.length} registered admins ({multisigThreshold} threshold)
                      </p>
                    </div>
                  </div>

                  <div className="border border-border/60 bg-background/50 rounded-xl p-3.5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-emerald-500/5 flex items-center justify-center text-emerald-600">
                      <DollarSign className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                        Vault Allocation Goal
                      </p>
                      <p className="text-xs font-bold text-foreground mt-0.5">
                        {selectedProject.fundingGoal.toLocaleString()} USDC
                      </p>
                    </div>
                  </div>
                </div>

                {/* Milestones Approvals section */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                    Milestones Approval & Tranche Release
                  </h3>
                  <div className="divide-y border rounded-xl overflow-hidden bg-background/40">
                    {(!selectedProject.milestones || selectedProject.milestones.length === 0) ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        No milestones configured for this project.
                      </p>
                    ) : (
                      selectedProject.milestones.map((m: any, index: number) => {
                        const votes = milestoneVotes[m.id] || [];
                        const hasVoted = freighterWalletAddress && votes.includes(freighterWalletAddress);
                        const isReleased = milestoneReleasedState[m.id] !== undefined
                          ? milestoneReleasedState[m.id]
                          : m.released;
                        const canRelease = votes.length >= multisigThreshold;
                        const isProofMissing = !m.proof || m.proof.trim() === "";

                        return (
                          <div
                            key={m.id}
                            className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs hover:bg-background/20 transition-colors"
                          >
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-foreground">
                                  Milestone #{index + 1}: {m.title || `Milestone ${m.id}`}
                                </span>
                                <Badge
                                  variant={isReleased ? "default" : "secondary"}
                                  className={cn(
                                    "text-[9px] font-semibold py-0.5",
                                    isReleased
                                      ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                                      : "bg-amber-500/10 text-amber-600 border border-amber-500/20 hover:bg-amber-500/20"
                                  )}
                                >
                                  {isReleased ? "Released" : "Pending Release"}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground text-[11px] break-words line-clamp-2">
                                {m.description || "No description provided."}
                              </p>

                              {isReleased ? (
                                m.proof ? (
                                  <div
                                    onClick={async () => {
                                      setActiveProofMilestoneId(m.id);
                                      setActiveProofMilestoneIndex(index);
                                      setIsProofModalOpen(true);
                                      if (selectedProjectId) {
                                        await fetchSelectedProjectFresh(selectedProjectId);
                                      }
                                    }}
                                    className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 text-muted-foreground transition-all cursor-pointer select-none max-w-max text-[11px]"
                                  >
                                    <span>Proof submitted</span>
                                    <span className="text-[10px] underline font-normal text-primary">
                                      View Details
                                    </span>
                                  </div>
                                ) : null
                              ) : m.proof ? (
                                <div
                                  onClick={async () => {
                                    setActiveProofMilestoneId(m.id);
                                    setActiveProofMilestoneIndex(index);
                                    setIsProofModalOpen(true);
                                    if (selectedProjectId) {
                                      await fetchSelectedProjectFresh(selectedProjectId);
                                    }
                                  }}
                                  className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10 transition-all cursor-pointer select-none max-w-max text-[11px] font-semibold group"
                                >
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                  </span>
                                  <span>Proof available & ready to verify</span>

                                </div>
                              ) : (
                                <p className="text-muted-foreground/60 text-[11px] italic mt-1.5">
                                  Awaiting creator delivery proof submission
                                </p>
                              )}

                              <div className="flex items-center gap-4 text-[10px] text-muted-foreground mt-2">
                                <span>Allocation: <strong>{m.amount.toLocaleString()} USDC</strong></span>
                                <span className="flex items-center gap-1 font-semibold text-foreground">
                                  <UserCheck className="h-3 w-3" /> Approvals: {votes.length} / {multisigThreshold}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                              <Button
                                size="sm"
                                onClick={() => handleReleaseMilestone(m.id)}
                                disabled={loading || isReleased || !canRelease}
                                className="h-8 bg-[#003049] hover:bg-[#003049]/90 text-white text-xs font-semibold"
                              >
                                {isReleased ? "Released" : "Release Tranche"}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Bond Slashing section */}
                <div className="border border-rose-500/20 bg-rose-500/5 rounded-xl p-5 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-rose-600 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" />
                      Performance Bond Slashing
                    </h3>
                    {selectedProject.status?.toLowerCase() === "refunding" && (
                      <Badge className="bg-rose-600 hover:bg-rose-700 text-white">
                        Slashed (Refunding)
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-rose-700 leading-normal">
                    Bond slashing forces the vault into a Refunding state, burning the creator's performance bond and unlocking investment claims. This is irreversible and requires multi-sig confirmation.
                  </p>

                  {selectedProject.status?.toLowerCase() !== "refunding" ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-rose-500/10 text-xs">
                      <div className="space-y-0.5">
                        <p className="font-bold text-foreground">
                          Slashing approvals: {(slashVotesByProject[selectedVaultAddress] || []).length} / {slashThresholdsByProject[selectedVaultAddress] || 2}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Voted: {(slashVotesByProject[selectedVaultAddress] || []).map((addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4)).join(", ") || "None"}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={handleApproveSlash}
                          disabled={
                            loading ||
                            !isMultisigSigner ||
                            (slashVotesByProject[selectedVaultAddress] || []).includes(freighterWalletAddress || "")
                          }
                          className="h-8 border-rose-600/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 hover:border-rose-500/30"
                        >
                          Sign Slash Vote
                        </Button>

                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={handleExecuteSlashing}
                          disabled={loading || !slashingApprovals[selectedVaultAddress]}
                          className="h-8 bg-rose-600 hover:bg-rose-700 text-white"
                        >
                          Execute Slashing
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 text-center text-xs font-semibold text-rose-600">
                      Performance bond has been slashed. Investors can claim refunds.
                    </div>
                  )}
                </div>
              </div>
            </ScrollAreaContainer>
          </>
        )}
      </Card>

      {/* Milestone Delivery Proof Modal */}
      <Dialog open={isProofModalOpen} onOpenChange={setIsProofModalOpen}>
        <DialogContent className="max-w-2xl border border-border bg-card/95 text-card-foreground backdrop-blur-xl p-6 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
          {activeProofMilestone && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider text-primary border-primary/20 bg-primary/5">
                    Milestone #{activeProofMilestoneIndex + 1}
                  </Badge>
                  <Badge
                    variant={activeProofMilestoneIsReleased ? "default" : "secondary"}
                    className={cn(
                      "text-[10px] font-semibold py-0.5",
                      activeProofMilestoneIsReleased
                        ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                        : "bg-amber-500/10 text-amber-600 border border-amber-500/20 hover:bg-amber-500/20"
                    )}
                  >
                    {activeProofMilestoneIsReleased ? "Released" : "Pending Release"}
                  </Badge>
                </div>
                <DialogTitle className="text-xl font-bold font-headline mt-2 text-foreground">
                  {activeProofMilestone.title || `Milestone ${activeProofMilestone.id}`}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  {activeProofMilestone.description || "No description provided."}
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto pr-1 my-4 space-y-5 text-sm">
                {/* Textual Completion Evidence */}
                <div className="space-y-1.5">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                    Completion Evidence
                  </h4>
                  <div className="bg-muted/40 p-4 rounded-xl border border-border/50 leading-relaxed text-foreground whitespace-pre-wrap select-text">
                    {(() => {
                      let desc = activeProofMilestone.proof || "";
                      if (desc.startsWith("{")) {
                        try {
                          const parsed = JSON.parse(desc);
                          desc = parsed.description || "";
                        } catch (e) { }
                      }
                      return desc ? formatTextWithLinks(desc) : (
                        <span className="text-amber-600 dark:text-amber-400 italic">
                          Awaiting creator delivery proof submission
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Extracted Links Section */}
                {(() => {
                  let desc = activeProofMilestone.proof || "";
                  if (desc.startsWith("{")) {
                    try {
                      const parsed = JSON.parse(desc);
                      desc = parsed.description || "";
                    } catch (e) { }
                  }
                  const urls = extractUrls(desc);
                  if (urls.length > 0) {
                    return (
                      <div className="space-y-2">
                        <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                          Extracted Links
                        </h4>
                        <div className="space-y-1.5">
                          {urls.map((url, i) => (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 p-2.5 rounded-lg border border-border/40 hover:border-primary/40 bg-background/50 hover:bg-background/80 transition-all text-xs font-semibold text-primary hover:underline break-all group"
                            >
                              <span className="shrink-0 p-1 rounded bg-[#003049]/5 text-[#003049] group-hover:bg-[#003049]/10">
                                <FileCode className="h-3.5 w-3.5" />
                              </span>
                              {url}
                            </a>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Visual Attachment File */}
                {(() => {
                  if (activeProofMilestone.proof && activeProofMilestone.proof.startsWith("{")) {
                    try {
                      const parsed = JSON.parse(activeProofMilestone.proof);
                      if (parsed.imageUrl) {
                        return (
                          <div className="space-y-1.5">
                            <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                              Visual Attachment
                            </h4>
                            <div className="relative border border-border/40 rounded-xl overflow-hidden bg-black/5 dark:bg-white/5 flex items-center justify-center p-2">
                              <img
                                src={parsed.imageUrl}
                                alt="Milestone Proof Attachment"
                                className="max-h-[300px] w-auto object-contain rounded-lg shadow-sm"
                              />
                            </div>
                          </div>
                        );
                      }
                    } catch (e) { }
                  }
                  return null;
                })()}
              </div>

              <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsProofModalOpen(false)}
                  className="text-xs font-semibold"
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    await handleApproveMilestone(activeProofMilestone.id);
                  }}
                  disabled={loading || activeProofMilestoneIsReleased || activeProofMilestoneHasVoted || !isMultisigSigner || activeProofMilestoneIsProofMissing}
                  className="bg-[#003049] text-white hover:bg-[#003049]/90 text-xs font-semibold"
                >
                  {activeProofMilestoneHasVoted ? "Signed" : "Sign Approval"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Internal scroll helper
function ScrollAreaContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto max-h-[75vh]">
      {children}
    </div>
  );
}
