"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { Button } from "../ui/button";
import { useToast } from "@/hooks/use-toast";
import { getClaimRequests, deleteClaimRequest, createClaimRequest } from "@/actions/claims";
import {
  useRefreshAfterTx,
  useProjects,
  useAdminStatus,
} from "@/context/BlockchainContext";
import { ProjectLoader } from "../project/ProjectLoader";
import { shortenAddress } from "@/lib/utils";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { StellarFormatter } from "@/lib/stellar-format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { ShieldCheck, Inbox, Loader2 } from "lucide-react";
import type { Project } from "@/lib/types";

const getSupermajority = (n: number) => {
  if (n <= 2) return n;
  return Math.floor((2 * n + 2) / 3);
};

type PendingProposal = {
  id: string;
  proposal_id: bigint;
  project_id: string;
  projectTitle: string;
  amount: string;
  approvals: string[];
  proposer: string;
  projectInfo: Project | null;
};

export function WithdrawalProposalsList() {
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [proposePendingId, setProposePendingId] = useState<string | null>(null);
  const [claimRequestVersion, setClaimRequestVersion] = useState(0);
  const [claimRequestedProjectIds, setClaimRequestedProjectIds] = useState<string[]>([]);
  const { toast } = useToast();
  const refreshAfterTx = useRefreshAfterTx();
  const { openProjectDetails } = useProjectDetails();
  const { projects } = useProjects();
  const { platformInfo } = useAdminStatus();
  const { freighterWalletAddress } = useFreighterWallet();

  const {
    getPendingProposals,
    voteWithdrawal,
    executeWithdrawal,
    proposeWithdrawal,
  } = useStellarContract();

  const approvalThreshold = getSupermajority(
    platformInfo?.multiSigAdmins?.length ?? 0,
  );

  const loadProposals = useCallback(() => {
    setLoading(true);
    getClaimRequests()
      .then((ids) => {
        setClaimRequestedProjectIds(ids);
      })
      .catch((err) => {
        console.error("Failed to load DB claim requests:", err);
      });

    getPendingProposals()
      .then((data) => {
        const enhanced = data
          .filter((proposal) => !proposal.executed)
          .map((proposal) => {
            const project = projects.find(
              (p) => p.id === proposal.project_id.toString(),
            );
            return {
              id: proposal.proposal_id.toString(),
              proposal_id: proposal.proposal_id,
              project_id: proposal.project_id.toString(),
              projectTitle:
                project?.title || `Campaign #${proposal.project_id.toString()}`,
              amount: proposal.amount.toString(),
              approvals: proposal.approvals,
              proposer: proposal.proposer,
              projectInfo: project || null,
            };
          });
        setProposals(enhanced);
      })
      .catch((err) => {
        console.error("Failed to load proposals:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [getPendingProposals, projects]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      let migrated = false;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("blkfndr_claim_requested_")) {
          const value = localStorage.getItem(key);
          if (value === "true") {
            const projectId = key.replace("blkfndr_claim_requested_", "");
            migrated = true;
            promises.push(
              createClaimRequest(projectId, freighterWalletAddress ?? "migrated")
                .then(() => {
                  localStorage.removeItem(key);
                })
                .catch((err) => {
                  console.error(`Failed to migrate project ${projectId}:`, err);
                })
            );
          }
        }
      }

      if (migrated) {
        Promise.all(promises).then(() => {
          loadProposals();
        });
      }
    }
  }, [freighterWalletAddress, loadProposals]);

  const hasActiveProposal = useCallback(
    (projectId: string) =>
      proposals.some((prop) => prop.project_id === projectId),
    [proposals],
  );

  const claimRequestedProjects = useMemo(() => {
    return projects.filter(
      (p) =>
        p.status === "funded" &&
        claimRequestedProjectIds.includes(p.id) &&
        !hasActiveProposal(p.id),
    );
  }, [projects, claimRequestedProjectIds, hasActiveProposal]);

  const handleCreateProposal = async (project: Project) => {
    const amountStr = project.currentFundingRaw;
    if (!amountStr || BigInt(amountStr) <= BigInt(0)) {
      toast({
        title: "Cannot Propose Withdrawal",
        description: "This campaign has no raised funds to withdraw.",
        variant: "destructive",
      });
      return;
    }

    setProposePendingId(project.id);
    try {
      await proposeWithdrawal({
        projectId: BigInt(project.id),
        amount: BigInt(amountStr),
      });

      // Remove claim request from database
      await deleteClaimRequest(project.id);

      toast({
        title: "Withdrawal Proposal Created",
        description: `Proposal submitted for campaign #${project.id}. Other multisig admins can approve and execute.`,
      });
      await refreshAfterTx(freighterWalletAddress ?? undefined);
      setClaimRequestVersion((v) => v + 1);
      loadProposals();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: "Proposal Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setProposePendingId(null);
    }
  };

  const handleApprove = async (proposalIdStr: string) => {
    setActionPending(proposalIdStr);
    try {
      await voteWithdrawal({ proposalId: BigInt(proposalIdStr) });
      toast({
        title: "Proposal Approved",
        description: "You have approved the withdrawal proposal.",
      });
      await refreshAfterTx(freighterWalletAddress ?? undefined);
      loadProposals();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: "Approval Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setActionPending(null);
    }
  };

  const handleExecute = async (proposalIdStr: string) => {
    setActionPending(proposalIdStr);
    try {
      await executeWithdrawal({ proposalId: BigInt(proposalIdStr) });
      toast({
        title: "Withdrawal Executed",
        description:
          "Funds have been transferred to the project creator on-chain.",
      });
      await refreshAfterTx(freighterWalletAddress ?? undefined);
      setClaimRequestVersion((v) => v + 1);
      loadProposals();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: "Execution Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setActionPending(null);
    }
  };

  if (loading) {
    return <ProjectLoader />;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
      <Card className="h-full min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Inbox className="h-5 w-5 text-accent" />
            Initialized Claim Requests
          </CardTitle>
          <CardDescription>
            Funded campaigns where the creator requested withdrawal. Propose
            release of the full raised amount for multisig approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {claimRequestedProjects.length > 0 ? (
            claimRequestedProjects.map((project) => (
              <div
                key={project.id}
                className="min-w-0 rounded-lg border p-4 space-y-3"
              >
                <div className="min-w-0 space-y-1">
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto max-w-full p-0 text-left font-bold text-base break-words whitespace-normal"
                    onClick={() => openProjectDetails(project)}
                  >
                    {project.title}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Campaign #{project.id}
                  </p>
                  <div className="text-xs text-muted-foreground min-w-0">
                    <span>Creator</span>
                    <span
                      className="font-mono truncate block max-w-full"
                      title={project.creatorAddress || project.creator}
                    >
                      {shortenAddress(
                        project.creatorAddress || project.creator,
                      )}
                    </span>
                  </div>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Raised: </span>
                    {StellarFormatter.formatWithLabel(
                      project.currentFundingRaw ?? "0",
                      2,
                      project.currencyType || "XLM",
                    )}
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={() => handleCreateProposal(project)}
                  disabled={
                    proposePendingId !== null ||
                    actionPending !== null ||
                    !freighterWalletAddress
                  }
                >
                  {proposePendingId === project.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Submit Withdrawal Proposal
                    </>
                  )}
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No pending claim requests from project owners.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="h-full min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-lg">Active Proposals</CardTitle>
          <CardDescription>
            Approve and execute withdrawals once{" "}
            {approvalThreshold} of {platformInfo?.multiSigAdmins?.length ?? "—"}{" "}
            multisig admins have voted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {proposals.length > 0 ? (
            proposals.map((proposal) => {
              const hasVoted =
                freighterWalletAddress &&
                proposal.approvals.some(
                  (a) =>
                    a === freighterWalletAddress,
                );
              const canExecute =
                proposal.approvals.length >= approvalThreshold;

              return (
                <div
                  key={proposal.id}
                  className="min-w-0 rounded-lg border p-4 flex flex-col gap-4"
                >
                  <div className="space-y-2 min-w-0">
                    <p className="text-xs text-muted-foreground truncate">
                      Proposal #{proposal.id}
                    </p>
                    <Button
                      size="sm"
                      variant="link"
                      className="h-auto max-w-full p-0 text-left font-bold text-base break-words whitespace-normal"
                      onClick={() =>
                        proposal.projectInfo &&
                        openProjectDetails(proposal.projectInfo)
                      }
                    >
                      {proposal.projectTitle}
                    </Button>
                    <dl className="text-sm text-muted-foreground space-y-2 min-w-0">
                      <div className="min-w-0">
                        <dt className="font-medium text-foreground">Amount</dt>
                        <dd className="break-words">
                          {StellarFormatter.formatWithLabel(
                            proposal.amount,
                            2,
                            proposal.projectInfo?.currencyType || "XLM",
                          )}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="font-medium text-foreground">Proposer</dt>
                        <dd
                          className="font-mono text-xs truncate"
                          title={proposal.proposer}
                        >
                          {shortenAddress(proposal.proposer)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">
                          Approvals
                        </dt>
                        <dd>
                          {proposal.approvals.length} / {approvalThreshold}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t">
                    {canExecute ? (
                      <Button
                        onClick={() => handleExecute(proposal.id)}
                        disabled={actionPending !== null}
                        className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
                      >
                        {actionPending === proposal.id
                          ? "Executing..."
                          : "Execute Withdrawal"}
                      </Button>
                    ) : hasVoted ? (
                      <Button disabled variant="outline" className="w-full sm:w-auto">
                        Voted
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleApprove(proposal.id)}
                        disabled={
                          actionPending !== null || !freighterWalletAddress
                        }
                        className="w-full sm:w-auto"
                      >
                        {actionPending === proposal.id
                          ? "Approving..."
                          : "Approve"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No pending withdrawal proposals.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
