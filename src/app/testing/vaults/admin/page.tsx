"use client";

import { useCallback, useEffect, useState } from "react";
import { rpc, xdr, Address, scValToNative } from "@stellar/stellar-sdk";
import { signTransaction, signAuthEntry } from "@stellar/freighter-api";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useToast } from "@/hooks/use-toast";
import { Client as FactoryClient } from "@/packages/blkfndr_factory/src";
import { Client as IdentityClient } from "@/packages/blkfndr_identity/src";
import { Client as ApprovalClient } from "@/packages/blkfndr_approval/src";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import Link from "next/link";
import { getKycRequests, updateKycRequestStatus } from "@/app/actions";
import { getIPFSGatewayUrl } from "@/lib/pinata-client";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Shield,
  FileCode,
  Users,
  UserCheck,
  ArrowLeft,
  Trash2,
  Plus,
  RefreshCw,
  Settings,
  Wallet
} from "lucide-react";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
const IDENTITY_ID = process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID || "";
const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";

const ALLOWED_ADMIN = process.env.NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS || "";

const getSignerOptions = (publicKey: string) => ({
  signTransaction: (xdr: string) =>
    signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    }),
  signAuthEntry: async (xdr: string) => {
    const res = await signAuthEntry(xdr, {
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

export default function VaultsAdminPage() {
  const { freighterWalletAddress, login } = useFreighterWallet();
  const { toast } = useToast();

  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Identity Admin State
  const [kycRequests, setKycRequests] = useState<any[]>([]);

  // Multisig Admin State
  const [signersList, setSignersList] = useState<string[]>([]);
  const [currentThreshold, setCurrentThreshold] = useState<number | null>(null);
  const [newSignerToAdd, setNewSignerToAdd] = useState("");
  const [newThresholdVal, setNewThresholdVal] = useState("1");

  // Factory Admin State
  const [newWasmHashHex, setNewWasmHashHex] = useState("");

  // Factory Config State
  const [factoryAdmin, setFactoryAdmin] = useState<string | null>(null);
  const [factoryFeeWallet, setFactoryFeeWallet] = useState<string | null>(null);
  const [factoryFeePercentage, setFactoryFeePercentage] = useState<number | null>(null);


  const [newFactoryFeeWallet, setNewFactoryFeeWallet] = useState("");
  const [newFactoryFeePercentage, setNewFactoryFeePercentage] = useState("");

  // Vault Inspection State
  const [selectedVaultAddress, setSelectedVaultAddress] = useState("");
  const [selectedVaultInfo, setSelectedVaultInfo] = useState<any | null>(null);

  // Slashing Admin State
  const [projects, setProjects] = useState<any[]>([]);
  const [slashingApprovals, setSlashingApprovals] = useState<Record<string, boolean>>({});
  const [slashVotesByProject, setSlashVotesByProject] = useState<Record<string, string[]>>({});
  const [slashThresholdsByProject, setSlashThresholdsByProject] = useState<Record<string, number>>({});

  // Milestone Approval & Release State
  const [selectedApproveProjectId, setSelectedApproveProjectId] = useState("");
  const [selectedApproveMilestoneId, setSelectedApproveMilestoneId] = useState("");
  const [multisigLoaded, setMultisigLoaded] = useState(false);

  // Milestone Vote Tracking State
  const [milestoneVotes, setMilestoneVotes] = useState<string[]>([]);
  const [milestoneVotesLoading, setMilestoneVotesLoading] = useState(false);
  const [milestoneThreshold, setMilestoneThreshold] = useState<number | null>(null);

  const fetchSlashingApprovals = useCallback(async (projectsList: any[]) => {
    const approvals: Record<string, boolean> = {};
    const votes: Record<string, string[]> = {};
    const thresholds: Record<string, number> = {};
    const eligibleProjects = projectsList.filter(
      (p) => p.status === "funded" || p.status === "active"
    );

    await Promise.all(
      eligibleProjects.map(async (proj) => {
        try {
          if (!proj.vaultAddress) return;
          const vaultClient = new VaultClient({
            contractId: proj.vaultAddress,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
            publicKey: freighterWalletAddress || ALLOWED_ADMIN,
          });
          const infoTx = await vaultClient.get_info();
          const infoRes = await infoTx.simulate();
          let info = null;
          try {
            info = infoRes.result;
          } catch (pe) {
            console.warn(`Failed to parse info for slashing approval simulation of ${proj.title}:`, pe);
          }

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
              thresholds[proj.vaultAddress] = threshRes.result || 0;
            } catch (tErr) {
              console.warn(`Failed to fetch threshold for ${proj.title}:`, tErr);
            }

            try {
              const votesTx = await approvalClient.get_slash_approvals({
                project_id: BigInt(info.project_id),
              });
              const votesRes = await votesTx.simulate();
              votes[proj.vaultAddress] = votesRes.result || [];
            } catch (vErr) {
              console.warn(`get_slash_approvals not supported on contract ${info.approval_module}. Falling back to ledger check.`, vErr);
              try {
                const slashSymbol = xdr.ScVal.scvSymbol("SlashApproval");
                const keyScVal = xdr.ScVal.scvVec([
                  slashSymbol,
                  xdr.ScVal.scvU64(new xdr.Uint64(Number(info.project_id)))
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
                  const ledgerEntry = res.entries[0];
                  const contractDataEntry = (ledgerEntry.val as any).contractData();
                  const scValValue = contractDataEntry.val();
                  const nativeVal = scValToNative(scValValue);
                  if (Array.isArray(nativeVal)) {
                    votes[proj.vaultAddress] = nativeVal.map(v => String(v));
                  } else {
                    votes[proj.vaultAddress] = [];
                  }
                } else {
                  votes[proj.vaultAddress] = [];
                }
              } catch (ledgerErr) {
                console.error("Failed to query ledger entries for slashing approvals fallback:", ledgerErr);
                let hasVoted = false;
                if (freighterWalletAddress) {
                  try {
                    const checkTx = await approvalClient.approve_slash({
                      signer: freighterWalletAddress,
                      project_id: BigInt(info.project_id),
                    });

                    const simError = (checkTx.simulation as any)?.error;
                    const errStr = String(simError || "");
                    if (errStr.includes("AlreadyApproved") || errStr.includes("Contract error 14") || errStr.includes("#14")) {
                      hasVoted = true;
                    } else {
                      const simRes = await checkTx.simulate();
                      const simResError = (simRes.simulation as any)?.error;
                      const resErrStr = String(simResError || "");
                      if (resErrStr.includes("AlreadyApproved") || resErrStr.includes("Contract error 14") || resErrStr.includes("#14")) {
                        hasVoted = true;
                      }
                    }
                  } catch (simErr: any) {
                    const errStr = String(simErr?.message || simErr);
                    if (errStr.includes("AlreadyApproved") || errStr.includes("Contract error 14") || errStr.includes("#14")) {
                      hasVoted = true;
                    }
                  }
                }
                votes[proj.vaultAddress] = hasVoted ? [freighterWalletAddress] : [];
              }
            }
          }
        } catch (err) {
          console.error(`Failed to fetch slashing approval for ${proj.title}:`, err);
        }
      })
    );

    setSlashingApprovals(approvals);
    setSlashVotesByProject(votes);
    setSlashThresholdsByProject(thresholds);
  }, [freighterWalletAddress]);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data || []);
      if (data && Array.isArray(data)) {
        await fetchSlashingApprovals(data);
      }
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    }
  }, [fetchSlashingApprovals]);

  const fetchMilestoneVotes = useCallback(async (projectId: string, milestoneId: string) => {
    if (!projectId || !milestoneId || projectId === "undefined" || projectId === "NaN" || isNaN(Number(projectId))) {
      setMilestoneVotes([]);
      setMilestoneThreshold(null);
      return;
    }
    setMilestoneVotesLoading(true);
    try {
      // Find selected project to get its vaultAddress and on-chain approval module
      const proj = projects.find((p) => String(p.id) === projectId);
      let contractId = APPROVAL_ID;

      if (proj && proj.vaultAddress) {
        try {
          const vaultClient = new VaultClient({
            contractId: proj.vaultAddress,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
            publicKey: freighterWalletAddress || ALLOWED_ADMIN,
          });
          const infoTx = await vaultClient.get_info();
          const infoRes = await infoTx.simulate();
          if (infoRes.result && infoRes.result.approval_module) {
            contractId = infoRes.result.approval_module;
          }
        } catch (err) {
          console.warn("Failed to fetch custom approval module from vault info, using default", err);
        }
      }

      const client = new ApprovalClient({
        contractId,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress || ALLOWED_ADMIN,
      });

      try {
        const threshTx = await client.get_threshold();
        const threshRes = await threshTx.simulate();
        setMilestoneThreshold(threshRes.result || null);
      } catch (tErr) {
        console.warn("Failed to fetch threshold for milestone selection:", tErr);
      }

      try {
        const approvalsTx = await client.get_milestone_approvals({
          project_id: BigInt(projectId),
          milestone_id: Number(milestoneId)
        });
        const approvalsRes = await approvalsTx.simulate();
        setMilestoneVotes(approvalsRes.result || []);
      } catch (vErr) {
        console.warn(`get_milestone_approvals not supported on contract ${contractId}. Falling back to ledger check.`, vErr);
        try {
          const milestoneSymbol = xdr.ScVal.scvSymbol("MilestoneApproval");
          const keyScVal = xdr.ScVal.scvVec([
            milestoneSymbol,
            xdr.ScVal.scvU64(new xdr.Uint64(Number(projectId))),
            xdr.ScVal.scvU32(Number(milestoneId))
          ]);

          const server = new rpc.Server(SOROBAN_RPC_URL);
          const ledgerKey = xdr.LedgerKey.contractData(
            new xdr.LedgerKeyContractData({
              contract: Address.fromString(contractId).toScAddress(),
              key: keyScVal,
              durability: xdr.ContractDataDurability.persistent(),
            })
          );
          const res = await server.getLedgerEntries(ledgerKey);
          if (res.entries && res.entries.length > 0) {
            const ledgerEntry = res.entries[0];
            const contractDataEntry = (ledgerEntry.val as any).contractData();
            const scValValue = contractDataEntry.val();
            const nativeVal = scValToNative(scValValue);
            if (Array.isArray(nativeVal)) {
              setMilestoneVotes(nativeVal.map(v => String(v)));
            } else {
              setMilestoneVotes([]);
            }
          } else {
            setMilestoneVotes([]);
          }
        } catch (ledgerErr) {
          console.error("Failed to query ledger entries for milestone approvals fallback:", ledgerErr);
          let hasVoted = false;
          if (freighterWalletAddress) {
            try {
              const checkTx = await client.approve_milestone({
                signer: freighterWalletAddress,
                project_id: BigInt(projectId),
                milestone_id: Number(milestoneId)
              });

              const simError = (checkTx.simulation as any)?.error;
              const errStr = String(simError || "");
              if (errStr.includes("AlreadyApproved") || errStr.includes("Contract error 14") || errStr.includes("#14")) {
                hasVoted = true;
              } else {
                const simRes = await checkTx.simulate();
                const simResError = (simRes.simulation as any)?.error;
                const resErrStr = String(simResError || "");
                if (resErrStr.includes("AlreadyApproved") || resErrStr.includes("Contract error 14") || resErrStr.includes("#14")) {
                  hasVoted = true;
                }
              }
            } catch (simErr: any) {
              const errStr = String(simErr?.message || simErr);
              if (errStr.includes("AlreadyApproved") || errStr.includes("Contract error 14") || errStr.includes("#14")) {
                hasVoted = true;
              }
            }
          }
          setMilestoneVotes(hasVoted ? [freighterWalletAddress] : []);
        }
      }
    } catch (err) {
      console.error("Failed to fetch milestone votes:", err);
    } finally {
      setMilestoneVotesLoading(false);
    }
  }, [projects, freighterWalletAddress]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchMilestoneVotes(selectedApproveProjectId, selectedApproveMilestoneId);
  }, [selectedApproveProjectId, selectedApproveMilestoneId, fetchMilestoneVotes]);

  const handleExecuteSlashing = async (proj: any) => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!proj.vaultAddress) return;

    if (proj.status === "refunding") {
      toast({ title: "Already Executed", description: "This project bond has already been slashed.", variant: "destructive", isError: true });
      return;
    }
    const isSlashApproved = slashingApprovals[proj.vaultAddress] || false;
    if (!isSlashApproved) {
      const voters = slashVotesByProject[proj.vaultAddress] || [];
      const threshold = slashThresholdsByProject[proj.vaultAddress] || 3;
      toast({ title: "Threshold Not Met", description: `Required approvals not met. Need ${threshold - voters.length} more.`, variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Initiating slash_bond on vault ${proj.vaultAddress}...`);
    try {
      const client = new VaultClient({
        contractId: proj.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.slash_bond();
      addLog("Signing slash_bond transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Slash bond TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Bond Slashed", description: "Vault has transitioned to Refunding state." });

      // Force indexer to run to sync live changes to database immediately
      await fetch("/api/indexer", { method: "POST" });
      await fetchProjects();
    } catch (err: any) {
      const errMsg = err.message || String(err);
      addLog(`Slash bond failed: ${errMsg}`);

      const isAlreadyExecuted = errMsg.includes("Contract, #2") || errMsg.includes("#2") || errMsg.includes("InvalidStatus") || errMsg.includes("already executed") || errMsg.includes("already slashed");
      if (isAlreadyExecuted) {
        toast({ title: "Already Executed", description: "Slashing has already been executed.", variant: "destructive", isError: true });
        try {
          await fetch("/api/indexer", { method: "POST" });
          await fetchProjects();
        } catch (refreshErr) {
          console.error("Failed to refresh state after slash bond failed:", refreshErr);
        }
      } else {
        toast({ title: "Slash Bond Failed", description: errMsg, variant: "destructive", isError: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const addLog = (message: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev]);
  };

  const isPrimaryAdmin = freighterWalletAddress === (factoryAdmin || ALLOWED_ADMIN);
  const isMultisigSigner = signersList.includes(freighterWalletAddress);
  const isAuthorized = isPrimaryAdmin || isMultisigSigner;

  // Fetch Multisig signers & threshold
  const fetchApprovalInfo = useCallback(async () => {
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
      setCurrentThreshold(thresholdRes.result || 0);
    } catch (err: any) {
      addLog(`Failed to fetch multisig config: ${err.message || String(err)}`);
    } finally {
      setMultisigLoaded(true);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    if (freighterWalletAddress) {
      fetchApprovalInfo();
    } else {
      setMultisigLoaded(false);
    }
  }, [freighterWalletAddress, fetchApprovalInfo]);

  const selectedApproveProject = projects.find((p) => String(p.id) === selectedApproveProjectId);
  const isNumericId = /^\d+$/.test(selectedApproveProjectId);

  const selectedMilestone = selectedApproveProject?.milestones?.find((m: any) => String(m.id) === selectedApproveMilestoneId);
  const isMilestoneReleased = selectedMilestone?.released || false;
  const milestoneThreshVal = milestoneThreshold !== null ? milestoneThreshold : 2;
  const isMilestoneThresholdMet = milestoneVotes.length >= milestoneThreshVal;



  const handleApproveMilestone = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!selectedApproveProjectId) {
      toast({ title: "Missing Project Selection", description: "Please select a project first.", variant: "destructive", isError: true });
      return;
    }
    if (!isNumericId) {
      toast({ title: "Sync Pending", description: "This project is awaiting indexer syncing.", variant: "destructive", isError: true });
      return;
    }
    if (!selectedApproveMilestoneId) {
      toast({ title: "Missing Milestone Selection", description: "Please select a milestone first.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Signing approval for milestone ${selectedApproveMilestoneId} (project ${selectedApproveProjectId}) in approval module...`);
    try {
      // Find selected project to get its vaultAddress and on-chain approval module
      const proj = projects.find((p) => String(p.id) === selectedApproveProjectId);
      let contractId = APPROVAL_ID;

      if (proj && proj.vaultAddress) {
        try {
          const vaultClient = new VaultClient({
            contractId: proj.vaultAddress,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
            publicKey: freighterWalletAddress,
          });
          const infoTx = await vaultClient.get_info();
          const infoRes = await infoTx.simulate();
          if (infoRes.result && infoRes.result.approval_module) {
            contractId = infoRes.result.approval_module;
          }
        } catch (err) {
          console.warn("Failed to fetch custom approval module from vault info, using default", err);
        }
      }

      const client = new ApprovalClient({
        contractId,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.approve_milestone({
        signer: freighterWalletAddress,
        project_id: BigInt(selectedApproveProjectId),
        milestone_id: Number(selectedApproveMilestoneId),
      });

      const result = await tx.signAndSend();
      addLog(`Approve milestone TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Approved in Multisig", description: "Milestone has been approved." });

      // Optimistic update of voter list to immediately disable button and show vote
      if (freighterWalletAddress) {
        setMilestoneVotes((prev) => {
          if (prev.includes(freighterWalletAddress)) return prev;
          return [...prev, freighterWalletAddress];
        });
      }

      // Re-fetch milestone votes after a short delay to allow ledger state to update/propagate
      setTimeout(async () => {
        try {
          await fetchMilestoneVotes(selectedApproveProjectId, selectedApproveMilestoneId);
        } catch (fetchErr) {
          console.error("Delayed milestone vote fetch failed:", fetchErr);
        }
      }, 3000);
    } catch (err: any) {
      addLog(`Milestone approval failed: ${err.message || String(err)}`);
      toast({ title: "Approval Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleReleaseMilestone = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!selectedApproveProject || !selectedApproveProject.vaultAddress) {
      toast({ title: "Missing Vault Address", description: "The selected project does not have a valid vault address.", variant: "destructive", isError: true });
      return;
    }
    const milestone = selectedApproveProject?.milestones?.find((m: any) => String(m.id) === selectedApproveMilestoneId);
    if (milestone?.released) {
      toast({ title: "Already Released", description: "This milestone tranche has already been released.", variant: "destructive", isError: true });
      return;
    }
    const threshold = milestoneThreshold !== null ? milestoneThreshold : 2;
    if (milestoneVotes.length < threshold) {
      toast({ title: "Threshold Not Met", description: `Required approvals not met. Need ${threshold - milestoneVotes.length} more.`, variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Initiating release_milestone (${selectedApproveMilestoneId}) on vault ${selectedApproveProject.vaultAddress}...`);
    try {
      const client = new VaultClient({
        contractId: selectedApproveProject.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.release_milestone({
        milestone_id: Number(selectedApproveMilestoneId),
      });

      addLog("Signing release_milestone transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Release milestone TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Tranche Released", description: `Milestone ${selectedApproveMilestoneId} released.` });

      // Force indexer to update status & refresh projects list
      await fetch("/api/indexer", { method: "POST" });
      await fetchProjects();

      // Delay milestone votes refresh to ensure the ledger matches
      setTimeout(async () => {
        try {
          await fetchMilestoneVotes(selectedApproveProjectId, selectedApproveMilestoneId);
        } catch (fetchErr) {
          console.error("Delayed milestone vote fetch failed:", fetchErr);
        }
      }, 3000);
    } catch (err: any) {
      const errMsg = err.message || String(err);
      addLog(`Release milestone failed: ${errMsg}`);

      const isAlreadyReleased = errMsg.includes("Contract, #14") || errMsg.includes("#14") || errMsg.includes("MilestoneAlreadyReleased");
      if (isAlreadyReleased) {
        toast({ title: "Already Released", description: "This tranche has already been released.", variant: "destructive", isError: true });
        try {
          await fetch("/api/indexer", { method: "POST" });
          await fetchProjects();
          if (selectedApproveProjectId && selectedApproveMilestoneId) {
            await fetchMilestoneVotes(selectedApproveProjectId, selectedApproveMilestoneId);
          }
        } catch (refreshErr) {
          console.error("Failed to refresh state after release milestone failed:", refreshErr);
        }
      } else {
        toast({ title: "Release Failed", description: errMsg, variant: "destructive", isError: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApproveSlash = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!selectedApproveProjectId) {
      toast({ title: "Missing Project Selection", description: "Please select a project first.", variant: "destructive", isError: true });
      return;
    }
    if (!isNumericId) {
      toast({ title: "Sync Pending", description: "This project is awaiting indexer syncing.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Signing slash approval for project ${selectedApproveProjectId} in approval module...`);
    try {
      // Find selected project to get its vaultAddress and on-chain approval module
      const proj = projects.find((p) => String(p.id) === selectedApproveProjectId);
      let contractId = APPROVAL_ID;

      if (proj && proj.vaultAddress) {
        try {
          const vaultClient = new VaultClient({
            contractId: proj.vaultAddress,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
            publicKey: freighterWalletAddress,
          });
          const infoTx = await vaultClient.get_info();
          const infoRes = await infoTx.simulate();
          if (infoRes.result && infoRes.result.approval_module) {
            contractId = infoRes.result.approval_module;
          }
        } catch (err) {
          console.warn("Failed to fetch custom approval module from vault info, using default", err);
        }
      }

      const client = new ApprovalClient({
        contractId,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.approve_slash({
        signer: freighterWalletAddress,
        project_id: BigInt(selectedApproveProjectId),
      });

      const result = await tx.signAndSend();
      addLog(`Approve slash TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Slash Approved in Multisig", description: "Bond slashing has been approved." });

      // Optimistic update of slash voter list to immediately disable button and show vote
      if (freighterWalletAddress && proj && proj.vaultAddress) {
        setSlashVotesByProject((prev) => {
          const projectVotes = prev[proj.vaultAddress] || [];
          if (projectVotes.includes(freighterWalletAddress)) return prev;
          return {
            ...prev,
            [proj.vaultAddress]: [...projectVotes, freighterWalletAddress],
          };
        });
      }

      // Fetch approvals again after a short delay to allow ledger state to update/propagate
      setTimeout(async () => {
        try {
          await fetchSlashingApprovals(projects);
        } catch (fetchErr) {
          console.error("Delayed slashing approvals fetch failed:", fetchErr);
        }
      }, 3000);
    } catch (err: any) {
      addLog(`Slash approval failed: ${err.message || String(err)}`);
      toast({ title: "Slash Approval Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  const fetchKycRequests = useCallback(async () => {
    try {
      const res = await getKycRequests();
      if (res.success && res.requests) {
        setKycRequests(res.requests);
      }
    } catch (err) {
      console.error("Failed to fetch KYC requests:", err);
    }
  }, []);

  useEffect(() => {
    fetchKycRequests();
  }, [fetchKycRequests]);

  const handleApproveRequest = async (address: string) => {
    if (!freighterWalletAddress) return;
    setLoading(true);
    addLog(`Checking if ${address} is already attested on-chain...`);
    try {
      const client = new IdentityClient({
        contractId: IDENTITY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      // Query if already approved on-chain
      const checkTx = await client.is_kyc_approved({ address });
      const checkSim = await checkTx.simulate();
      const isApprovedOnChain = checkSim.result;

      if (isApprovedOnChain) {
        addLog(`Address ${address} is already attested on-chain. Syncing database status to approved.`);
        await updateKycRequestStatus(address, "approved");
        toast({ title: "Approved & Synced", description: `KYC approved for ${address}` });
        fetchKycRequests();
        return;
      }

      addLog(`Approving request and submitting KYC attestation for ${address}...`);
      const req = kycRequests.find((r) => r.address === address);
      const hashBuffer = req?.detailsHash
        ? Buffer.from(req.detailsHash, "hex")
        : Buffer.alloc(32);

      addLog(`Computed KYC hash for transaction: ${req?.detailsHash || "empty"}`);
      const tx = await client.attest({
        address,
        kyc_hash: hashBuffer,
      });

      const response = await tx.signAndSend();
      addLog(`KYC attested successfully. TX Hash: ${response.sendTransactionResponse?.hash || "Success"}`);
      await updateKycRequestStatus(address, "approved");
      addLog(`KYC request for ${address} marked as approved in database.`);
      toast({ title: "Attested & Approved", description: `KYC approved for ${address}` });
      fetchKycRequests();
    } catch (err: any) {
      const errStr = String(err);
      if (errStr.includes("Error(Contract, #12)") || errStr.includes("AlreadyAttested")) {
        addLog(`Address ${address} is already attested on-chain (Contract error 12). Syncing database status to approved.`);
        await updateKycRequestStatus(address, "approved");
        toast({ title: "Approved & Synced", description: `KYC approved for ${address}` });
        fetchKycRequests();
        return;
      }
      addLog(`Attestation failed: ${err.message || String(err)}`);
      toast({ title: "Attestation Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleRejectRequest = async (address: string) => {
    setLoading(true);
    addLog(`Rejecting KYC request for ${address}...`);
    try {
      await updateKycRequestStatus(address, "rejected");
      addLog(`KYC request for ${address} marked as rejected in database.`);
      toast({ title: "Rejected", description: `KYC request for ${address} has been rejected.` });
      fetchKycRequests();
    } catch (err: any) {
      addLog(`Rejection failed: ${err.message || String(err)}`);
      toast({ title: "Rejection Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeRequest = async (address: string) => {
    if (!freighterWalletAddress) return;
    setLoading(true);
    addLog(`Revoking KYC attestation for ${address}...`);
    try {
      const client = new IdentityClient({
        contractId: IDENTITY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.revoke({
        address,
      });

      const response = await tx.signAndSend();
      addLog(`KYC revoked successfully. TX Hash: ${response.sendTransactionResponse?.hash || "Success"}`);
      await updateKycRequestStatus(address, "rejected");
      toast({ title: "Revoked", description: `KYC revoked for ${address}` });
      fetchKycRequests();
    } catch (err: any) {
      addLog(`Revocation failed: ${err.message || String(err)}`);
      toast({ title: "Revocation Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // Approval: Add Signer
  const handleAddSigner = async () => {
    if (!freighterWalletAddress) return;
    if (!newSignerToAdd) {
      toast({ title: "Error", description: "Please enter signer address.", variant: "destructive", isError: true });
      return;
    }
    setLoading(true);
    addLog(`Adding milestone signer: ${newSignerToAdd}...`);
    try {
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.add_signer({ new_signer: newSignerToAdd });
      const response = await tx.signAndSend();
      addLog(`Signer added successfully. TX Hash: ${response.sendTransactionResponse?.hash || "Success"}`);
      toast({ title: "Signer Added", description: `Added ${newSignerToAdd} to multisig.` });
      setNewSignerToAdd("");
      fetchApprovalInfo();
    } catch (err: any) {
      addLog(`Add signer failed: ${err.message || String(err)}`);
      toast({ title: "Operation Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // Approval: Remove Signer
  const handleRemoveSigner = async (signerAddress: string) => {
    if (!freighterWalletAddress) return;
    setLoading(true);
    addLog(`Removing milestone signer: ${signerAddress}...`);
    try {
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.remove_signer({ signer: signerAddress });
      const response = await tx.signAndSend();
      addLog(`Signer removed successfully. TX Hash: ${response.sendTransactionResponse?.hash || "Success"}`);
      toast({ title: "Signer Removed", description: `Removed ${signerAddress} from multisig.` });
      fetchApprovalInfo();
    } catch (err: any) {
      addLog(`Remove signer failed: ${err.message || String(err)}`);
      toast({ title: "Operation Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // Approval: Update Threshold
  const handleUpdateThreshold = async () => {
    if (!freighterWalletAddress) return;
    const threshold = Number(newThresholdVal);
    if (isNaN(threshold) || threshold <= 0) {
      toast({ title: "Error", description: "Invalid threshold value.", variant: "destructive", isError: true });
      return;
    }
    setLoading(true);
    addLog(`Updating multisig approval threshold to ${threshold}...`);
    try {
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.update_threshold({ new_threshold: threshold });
      const response = await tx.signAndSend();
      addLog(`Threshold updated successfully. TX Hash: ${response.sendTransactionResponse?.hash || "Success"}`);
      toast({ title: "Threshold Updated", description: `Approval threshold updated to ${threshold}.` });
      fetchApprovalInfo();
    } catch (err: any) {
      addLog(`Update threshold failed: ${err.message || String(err)}`);
      toast({ title: "Operation Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // Factory: Update WASM Hash
  const handleUpdateWasmHash = async () => {
    if (!freighterWalletAddress) return;
    if (!newWasmHashHex || newWasmHashHex.length !== 64) {
      toast({ title: "Error", description: "Please enter a valid 32-byte hex WASM hash (64 chars).", variant: "destructive", isError: true });
      return;
    }
    setLoading(true);
    addLog(`Updating vault template WASM hash to hex: ${newWasmHashHex}...`);
    try {
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const hashBuffer = Buffer.from(newWasmHashHex, "hex");
      const tx = await client.update_wasm_hash({ new_hash: hashBuffer });
      const response = await tx.signAndSend();
      addLog(`WASM hash updated successfully. TX Hash: ${response.sendTransactionResponse?.hash || "Success"}`);
      toast({ title: "WASM Hash Updated", description: "Vault template WASM hash modified." });
      setNewWasmHashHex("");
    } catch (err: any) {
      addLog(`WASM hash update failed: ${err.message || String(err)}`);
      toast({ title: "Operation Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  const fetchFactoryConfig = useCallback(async () => {
    try {
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress || ALLOWED_ADMIN,
      });

      const [adminTx, feeWalletTx, feePercentageTx] = await Promise.all([
        client.get_admin(),
        client.get_fee_wallet(),
        client.get_fee_percentage(),
      ]);

      const [adminSim, feeWalletSim, feePercentageSim] = await Promise.all([
        adminTx.simulate(),
        feeWalletTx.simulate(),
        feePercentageTx.simulate(),
      ]);

      setFactoryAdmin(adminSim.result || null);
      setFactoryFeeWallet(feeWalletSim.result || null);
      setFactoryFeePercentage(feePercentageSim.result ? Number(feePercentageSim.result) : null);
    } catch (err: any) {
      console.error("Failed to fetch factory config:", err);
      addLog(`Failed to fetch Factory configuration: ${err.message || String(err)}`);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    fetchFactoryConfig();
  }, [fetchFactoryConfig]);

  const fetchSelectedVaultInfo = useCallback(async (address: string) => {
    if (!address) {
      setSelectedVaultInfo(null);
      return;
    }
    try {
      const vaultClient = new VaultClient({
        contractId: address,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress || ALLOWED_ADMIN,
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
      addLog(`Failed to fetch info for vault ${address}: ${err.message || String(err)}`);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    fetchSelectedVaultInfo(selectedVaultAddress);
  }, [selectedVaultAddress, fetchSelectedVaultInfo]);



  const handleUpdateFactoryFeeWallet = async () => {
    if (!freighterWalletAddress) return;
    if (!newFactoryFeeWallet) {
      toast({ title: "Error", description: "Please enter new fee wallet address.", variant: "destructive", isError: true });
      return;
    }
    setLoading(true);
    addLog(`Updating Factory platform fee wallet to ${newFactoryFeeWallet}...`);
    try {
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.update_fee_wallet({ new_fee_wallet: newFactoryFeeWallet });
      const response = await tx.signAndSend();
      addLog(`Factory fee wallet updated successfully. TX Hash: ${response.sendTransactionResponse?.hash || "Success"}`);
      toast({ title: "Fee Wallet Updated", description: `Factory fee wallet updated to ${newFactoryFeeWallet}.` });
      setNewFactoryFeeWallet("");
      await fetchFactoryConfig();
    } catch (err: any) {
      addLog(`Update Factory fee wallet failed: ${err.message || String(err)}`);
      toast({ title: "Operation Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateFactoryFeePercentage = async () => {
    if (!freighterWalletAddress) return;
    const pct = parseFloat(newFactoryFeePercentage);
    if (isNaN(pct) || pct < 0 || pct > 10.0) {
      toast({ title: "Error", description: "Fee percentage must be between 0% and 10%.", variant: "destructive", isError: true });
      return;
    }
    const bps = BigInt(Math.round(pct * 100)); // convert to bps
    setLoading(true);
    addLog(`Updating Factory fee percentage to ${pct}% (${bps} bps)...`);
    try {
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.update_fee_percentage({ new_percentage: bps });
      const response = await tx.signAndSend();
      addLog(`Factory fee percentage updated successfully. TX Hash: ${response.sendTransactionResponse?.hash || "Success"}`);
      toast({ title: "Fee Percentage Updated", description: `Factory fee percentage updated to ${pct}%.` });
      setNewFactoryFeePercentage("");
      await fetchFactoryConfig();
    } catch (err: any) {
      addLog(`Update Factory fee percentage failed: ${err.message || String(err)}`);
      toast({ title: "Operation Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  if (!freighterWalletAddress) {
    return (
      <div className="container mx-auto max-w-md py-20 px-4">
        <div className="rounded-2xl border border-muted bg-card/40 backdrop-blur-md p-8 shadow-lg text-center flex flex-col items-center gap-5">
          <div className="rounded-full bg-emerald-500/10 p-4 text-emerald-500 animate-pulse">
            <Shield className="h-10 w-10" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Vault Admin Connection</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Please connect your Freighter wallet to access the smart contract administrative console.
          </p>
          <button
            onClick={login}
            className="w-full mt-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-3 text-sm font-semibold text-slate-950 flex items-center justify-center gap-2 transition"
          >
            Connect Freighter Wallet
          </button>
          <Link href="/testing/vaults" className="text-xs text-muted-foreground hover:text-foreground transition mt-2">
            Back to Playground
          </Link>
        </div>
      </div>
    );
  }

  // Show verification spinner while loading multisig signers (unless primary admin matches immediately)
  if (!isPrimaryAdmin && !multisigLoaded) {
    return (
      <div className="container mx-auto max-w-md py-20 px-4">
        <div className="rounded-2xl border border-muted bg-card/40 backdrop-blur-md p-8 shadow-lg text-center flex flex-col items-center gap-5">
          <Loader2 className="h-10 w-10 text-emerald-500 animate-spin" />
          <h2 className="text-xl font-bold tracking-tight text-foreground">Verifying Authorization...</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Please wait while we check your access permissions on-chain.
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="container mx-auto max-w-lg py-20 px-4">
        <div className="rounded-2xl border border-rose-500/20 bg-card/40 backdrop-blur-md p-8 shadow-lg text-center flex flex-col items-center gap-5">
          <div className="rounded-full bg-rose-500/10 p-4 text-rose-500">
            <AlertCircle className="h-10 w-10" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Access Denied</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Your connected wallet address:
            <span className="block font-mono text-xs text-rose-400 bg-rose-500/10 px-2.5 py-1.5 rounded-lg border border-rose-500/20 my-3 font-semibold break-all select-all font-mono">
              {freighterWalletAddress}
            </span>
            is not authorized to access the Admin Panel.
          </p>
          <Link href="/testing/vaults" className="w-full mt-2 rounded-lg border border-muted bg-background hover:bg-muted px-4 py-3 text-sm font-semibold text-foreground flex items-center justify-center gap-2 transition shadow-sm">
            <ArrowLeft className="h-4 w-4" /> Return to Playground
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-10 px-4">
      {/* Title & Navigation */}
      <div className="flex items-center gap-3 border-b pb-4">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary flex-shrink-0 animate-pulse">
          <Settings className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">
              BLKFNDR Vault Admin
            </h1>
            <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[10px] px-2 py-0.5 rounded uppercase font-semibold">
              Authorized Console
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Manage KYC approvals, platform fee configuration, multisig signers, and contract template upgrades.
          </p>
        </div>
        <Link
          href="/testing/vaults"
          className="text-xs font-semibold bg-background border border-muted hover:bg-muted text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg flex items-center gap-1.5 transition shadow-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Playground
        </Link>
      </div>



      {/* Administrative Operations */}
      <div className="space-y-6">
        {/* Section: Platform Fee Settings */}
        <div className="border border-muted bg-card/40 backdrop-blur-md rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-muted pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-orange-500" />
              <h3 className="text-base font-bold text-foreground">Platform Fee & Admin Configuration</h3>
              {!isPrimaryAdmin && (
                <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold">
                  Read Only
                </span>
              )}
            </div>
            <button
              onClick={fetchFactoryConfig}
              disabled={loading}
              className="p-1 text-muted-foreground hover:text-foreground transition disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            These values represent the active default settings configured at the Factory contract level. Modifying these configurations does not affect already-deployed vaults.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-muted/30 p-4 rounded-xl border border-muted text-xs flex flex-col gap-1.5">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Platform Admin Owner</span>
              <span className="text-foreground font-mono text-[11px] break-all select-all font-semibold font-mono" title={factoryAdmin || ALLOWED_ADMIN}>
                {factoryAdmin ? `${factoryAdmin.slice(0, 6)}...${factoryAdmin.slice(-6)}` : "Loading..."}
              </span>
            </div>
            <div className="bg-muted/30 p-4 rounded-xl border border-muted text-xs flex flex-col gap-1.5">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Platform Fee Wallet</span>
              <span className="text-foreground font-mono text-[11px] break-all select-all font-semibold font-mono" title={factoryFeeWallet || "Loading..."}>
                {factoryFeeWallet ? `${factoryFeeWallet.slice(0, 6)}...${factoryFeeWallet.slice(-6)}` : "Loading..."}
              </span>
            </div>
            <div className="bg-muted/30 p-4 rounded-xl border border-muted text-xs flex flex-col gap-1.5">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Platform Fee Percentage</span>
              <span className="text-emerald-500 text-lg font-bold">
                {factoryFeePercentage !== null ? `${(factoryFeePercentage / 100).toFixed(2)}%` : "Loading..."}
                {factoryFeePercentage !== null && <span className="text-muted-foreground text-xs font-normal font-mono"> ({factoryFeePercentage} bps)</span>}
              </span>
            </div>
          </div>

          <div className="border-t border-muted pt-4 flex flex-col gap-4">
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">Update Platform Settings</span>

            {/* Action: Update Fee Wallet */}
            <div className="flex flex-col md:flex-row gap-3 items-end">
              <div className="flex-grow flex flex-col gap-1.5 w-full">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">New Platform Fee Wallet Address</span>
                <input
                  type="text"
                  value={newFactoryFeeWallet}
                  onChange={(e) => setNewFactoryFeeWallet(e.target.value)}
                  disabled={loading || !isPrimaryAdmin}
                  placeholder="G..."
                  className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-xs font-mono text-foreground focus:border-primary focus:outline-none transition disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <button
                onClick={handleUpdateFactoryFeeWallet}
                disabled={loading || !newFactoryFeeWallet || !isPrimaryAdmin}
                className="bg-primary hover:opacity-90 disabled:opacity-50 text-primary-foreground px-4 py-2.5 rounded-lg text-xs font-bold transition whitespace-nowrap w-full md:w-auto shadow-sm"
              >
                Update Fee Wallet
              </button>
            </div>

            {/* Action: Update Fee Percentage */}
            <div className="flex flex-col md:flex-row gap-3 items-end">
              <div className="flex-grow flex flex-col gap-1.5 w-full">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">New Platform Fee Percentage (%) <span className="text-rose-500 font-semibold font-mono">(Max 10%)</span></span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  value={newFactoryFeePercentage}
                  onChange={(e) => setNewFactoryFeePercentage(e.target.value)}
                  disabled={loading || !isPrimaryAdmin}
                  placeholder="e.g. 3.0"
                  className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none transition disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <button
                onClick={handleUpdateFactoryFeePercentage}
                disabled={loading || !newFactoryFeePercentage || !isPrimaryAdmin}
                className="bg-primary hover:opacity-90 disabled:opacity-50 text-primary-foreground px-4 py-2.5 rounded-lg text-xs font-bold transition whitespace-nowrap w-full md:w-auto shadow-sm"
              >
                Update Fee %
              </button>
            </div>
          </div>
        </div>


        {/* Section: Project Vault Configuration Inspector */}
        <div className="border border-muted bg-card/40 backdrop-blur-md rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-muted pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-orange-500" />
              <h3 className="text-base font-bold text-foreground">Project Vault Config Inspector</h3>
            </div>
            <button
              onClick={() => selectedVaultAddress && fetchSelectedVaultInfo(selectedVaultAddress)}
              disabled={!selectedVaultAddress || loading}
              className="p-1 text-muted-foreground hover:text-foreground transition disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Select any active/funded project vault to inspect its immutable on-chain administrative and fee configuration.
          </p>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select Project Vault</label>
            <select
              value={selectedVaultAddress}
              onChange={(e) => setSelectedVaultAddress(e.target.value)}
              className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none transition cursor-pointer"
            >
              <option value="">-- Select a Project Vault --</option>
              {projects
                .filter((p) => p.vaultAddress)
                .map((p) => (
                  <option key={p.id} value={p.vaultAddress}>
                    {p.title} ({p.vaultAddress.slice(0, 8)}...{p.vaultAddress.slice(-8)})
                  </option>
                ))}
            </select>
          </div>

          {selectedVaultInfo && (
            <div className="flex flex-col gap-5 mt-2">
              {selectedVaultInfo.isLegacy ? (
                <div className="border border-amber-500/20 bg-amber-500/5 px-4 py-3.5 rounded-xl border-dashed flex gap-3 text-xs text-amber-500 items-start">
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                  <div className="flex flex-col gap-1">
                    <strong className="text-foreground font-semibold">Legacy Contract Instance</strong>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">
                      This vault was deployed using an older smart contract version. Its on-chain configurations cannot be parsed by the updated admin console.
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-muted/30 p-4 rounded-xl border border-muted text-xs flex flex-col gap-1.5">
                      <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Vault Administrator</span>
                      <span className="text-foreground font-mono text-[11px] break-all select-all font-semibold font-mono" title={selectedVaultInfo.admin}>
                        {selectedVaultInfo.admin ? `${selectedVaultInfo.admin.slice(0, 6)}...${selectedVaultInfo.admin.slice(-6)}` : "Unknown"}
                      </span>
                    </div>
                    <div className="bg-muted/30 p-4 rounded-xl border border-muted text-xs flex flex-col gap-1.5">
                      <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Fee Payout Wallet</span>
                      <span className="text-foreground font-mono text-[11px] break-all select-all font-semibold font-mono" title={selectedVaultInfo.fee_wallet_address}>
                        {selectedVaultInfo.fee_wallet_address ? `${selectedVaultInfo.fee_wallet_address.slice(0, 6)}...${selectedVaultInfo.fee_wallet_address.slice(-6)}` : "Unknown"}
                      </span>
                    </div>
                    <div className="bg-muted/30 p-4 rounded-xl border border-muted text-xs flex flex-col gap-1.5">
                      <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Fee Percentage</span>
                      <span className="text-emerald-500 text-lg font-bold">
                        {selectedVaultInfo.fee_percentage !== undefined ? `${(Number(selectedVaultInfo.fee_percentage) / 100).toFixed(2)}%` : "0.00%"}
                        {selectedVaultInfo.fee_percentage !== undefined && (
                          <span className="text-muted-foreground text-xs font-normal font-mono"> ({selectedVaultInfo.fee_percentage.toString()} bps)</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="border border-indigo-500/20 bg-indigo-500/5 px-4 py-3.5 rounded-xl border-dashed flex gap-3 text-xs text-indigo-500 items-start">
                    <Shield className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-1">
                      <strong className="text-foreground font-semibold">Immutable On-Chain Invariant</strong>
                      <span className="text-[11px] leading-relaxed text-muted-foreground">
                        This project vault's configurations are permanently locked on-chain. The administrator address, fee destination wallet, and platform fee percentage cannot be edited or bypassed under any circumstances.
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Section: Identity Registry Control */}
        <div className="border border-muted bg-card/40 backdrop-blur-md rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-muted pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-orange-500" />
              <h3 className="text-base font-bold text-foreground">Identity Registry Admin</h3>
              {!isPrimaryAdmin && (
                <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold">
                  Read Only
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-mono">Registry: {IDENTITY_ID.slice(0, 6)}...</span>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Attest addresses to approve them for creating project vaults, or revoke them to suspend creation privileges.
          </p>

          {/* Approved Creators List */}
          <div className="flex flex-col gap-3 border border-muted bg-muted/20 p-4 rounded-xl">
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">Approved Creators ({kycRequests.filter(r => r.status === 'approved').length})</span>
            {kycRequests.filter(r => r.status === 'approved').length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No approved creators yet.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                {kycRequests.filter(r => r.status === 'approved').map((req) => (
                  <div key={req._id} className="flex items-center justify-between bg-background/50 p-2.5 rounded-lg border border-muted text-[11px]">
                    <span className="font-mono text-muted-foreground break-all truncate mr-4">{req.address}</span>
                    <button
                      onClick={() => handleRevokeRequest(req.address)}
                      disabled={loading || !isPrimaryAdmin}
                      className="border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 disabled:opacity-50 text-rose-500 px-3 py-1.5 rounded-lg text-[10px] font-bold transition whitespace-nowrap shadow-sm disabled:cursor-not-allowed"
                    >
                      Revoke KYC
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Requests List */}
          <div className="flex flex-col gap-3 border border-muted bg-muted/20 p-4 rounded-xl">
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">Pending KYC Requests ({kycRequests.filter(r => r.status === 'pending').length})</span>
            {kycRequests.filter(r => r.status === 'pending').length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No pending KYC attestation requests.</p>
            ) : (
              <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
                {kycRequests.filter(r => r.status === 'pending').map((req) => (
                  <div key={req._id} className="flex flex-col gap-3 bg-background/50 p-4 rounded-lg border border-muted text-xs">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="font-mono text-foreground font-semibold break-all">{req.address}</span>
                        <div className="flex flex-col gap-0.5 text-muted-foreground mt-1">
                          <div><strong className="text-foreground">Name:</strong> {req.fullName || "Not Provided"}</div>
                          <div><strong className="text-foreground">Email:</strong> {req.email || "Not Provided"}</div>
                          <div><strong className="text-foreground">ID Type:</strong> {req.documentType || "Not Provided"}</div>
                          {req.detailsHash && (
                            <div className="font-mono text-[10px] text-muted-foreground break-all mt-1">
                              <strong className="text-foreground">Hash:</strong> {req.detailsHash}
                            </div>
                          )}
                        </div>
                      </div>
                      {req.documentImage ? (
                        <a
                          href={getIPFSGatewayUrl(req.documentImage)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 group relative cursor-pointer"
                        >
                          <img
                            src={getIPFSGatewayUrl(req.documentImage)}
                            alt="ID Proof"
                            className="h-16 w-24 object-cover rounded border border-muted group-hover:border-primary transition"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition rounded text-[9px] text-white font-semibold">
                            View Large
                          </span>
                        </a>
                      ) : (
                        <div className="h-16 w-24 flex items-center justify-center bg-muted border border-muted rounded text-[10px] text-muted-foreground font-semibold italic shrink-0">
                          No Image
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 justify-end border-t border-muted/80 pt-2.5">
                      <button
                        onClick={() => handleRejectRequest(req.address)}
                        disabled={loading || !isPrimaryAdmin}
                        className="border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 disabled:opacity-50 text-rose-500 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm disabled:cursor-not-allowed"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleApproveRequest(req.address)}
                        disabled={loading || !isPrimaryAdmin}
                        className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm disabled:cursor-not-allowed"
                      >
                        Approve & Attest
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section: Multisig Milestone Approval & Release Console */}
        <div className="border border-muted bg-card/40 backdrop-blur-md rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-muted pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-emerald-500 animate-pulse" />
              <h3 className="text-base font-bold text-foreground">Multisig Milestone Approval & Release</h3>
            </div>
            <button
              onClick={fetchProjects}
              disabled={loading}
              className="p-1 text-muted-foreground hover:text-foreground transition disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Manage project milestone releases.
          </p>



          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Project Selector */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select Project</label>
              <select
                value={selectedApproveProjectId}
                onChange={(e) => {
                  setSelectedApproveProjectId(e.target.value);
                  setSelectedApproveMilestoneId(""); // reset milestone selection
                }}
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none transition cursor-pointer"
              >
                <option value="">-- Select Project --</option>
                {projects
                  .filter((p) => p.vaultAddress && (p.status?.toLowerCase() === "funded" || p.status?.toLowerCase() === "completed" || p.status?.toLowerCase() === "active"))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} (ID: {p.id})
                    </option>
                  ))}
              </select>
            </div>

            {/* Milestone Selector */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select Milestone</label>
              <select
                value={selectedApproveMilestoneId}
                onChange={(e) => setSelectedApproveMilestoneId(e.target.value)}
                disabled={!selectedApproveProject}
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">-- Select Milestone --</option>
                {selectedApproveProject?.milestones?.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    Milestone {m.id}: {m.title || `Milestone ${m.id}`} ({m.amount.toLocaleString()} USDC) - {m.released ? "Released" : "Locked"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedApproveProject && (
            <div className="bg-muted/10 border border-muted/50 p-4 rounded-xl space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vault Address:</span>
                <span className="text-foreground break-all select-all font-semibold">{selectedApproveProject.vaultAddress}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Project Status:</span>
                <span className="text-foreground font-semibold uppercase">{selectedApproveProject.status}</span>
              </div>
              {selectedApproveMilestoneId && (
                (() => {
                  const m = selectedApproveProject.milestones?.find((m: any) => String(m.id) === selectedApproveMilestoneId);
                  return m ? (
                    <div className="border-t border-muted/50 pt-2 mt-2 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Milestone Status:</span>
                        <span className={`font-semibold ${m.released ? "text-emerald-500" : "text-amber-500"}`}>
                          {m.released ? "Released" : "Locked"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Milestone Amount:</span>
                        <span className="text-foreground font-semibold">{m.amount.toLocaleString()} USDC</span>
                      </div>
                    </div>
                  ) : null;
                })()
              )}
            </div>
          )}

          {selectedApproveProject && selectedApproveMilestoneId && (
            <div className="bg-muted/10 border border-muted/50 p-4 rounded-xl space-y-3 text-xs font-mono">
              <div className="flex justify-between items-center">
                <span className="font-bold text-foreground">
                  Milestone Approval Votes: {milestoneVotes.length} / {milestoneThreshold !== null ? milestoneThreshold : '3'} Required
                </span>
              </div>

              {/* Voters list */}
              {milestoneVotes.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-muted/30 pt-2">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Voters:</span>
                  <div className="flex flex-col gap-1">
                    {milestoneVotes.map((voter) => (
                      <div key={voter} className="text-[11px] text-foreground flex items-center gap-1.5 select-all" title={voter}>
                        {voter.slice(0, 8)}...{voter.slice(-8)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-muted pt-4">
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 1: Signer Attestation</span>
              <button
                onClick={handleApproveMilestone}
                disabled={
                  loading ||
                  !selectedApproveProjectId ||
                  !selectedApproveMilestoneId ||
                  !isMultisigSigner ||
                  !isNumericId ||
                  (freighterWalletAddress && milestoneVotes.includes(freighterWalletAddress))
                }
                className="w-full rounded-lg bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-500 py-3 text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {freighterWalletAddress && milestoneVotes.includes(freighterWalletAddress) ? (
                  "Already Voted"
                ) : (
                  "Sign Milestone Approval"
                )}
              </button>
              <p className="text-[10px] text-muted-foreground leading-normal italic">
                * Requires the connected wallet to be a registered multisig signer.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 2: Execute Release</span>
              <button
                onClick={handleReleaseMilestone}
                disabled={
                  loading ||
                  !selectedApproveProjectId ||
                  !selectedApproveMilestoneId ||
                  !isNumericId ||
                  isMilestoneReleased ||
                  !isMilestoneThresholdMet
                }
                className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 py-3 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-950" />}
                {isMilestoneReleased ? "Already Released" : "Release Tranche"}
              </button>

              {selectedApproveProjectId && selectedApproveMilestoneId && (
                <div className="text-[11px] font-semibold">
                  {isMilestoneReleased ? (
                    <span className="text-emerald-500">Tranche has already been released.</span>
                  ) : !isMilestoneThresholdMet ? (
                    <span className="text-amber-500">
                      Need {milestoneThreshVal - milestoneVotes.length} more approval(s) before release.
                    </span>
                  ) : null}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground leading-normal italic">
                * Can be executed by any user once the signer threshold is reached on-chain.
              </p>
            </div>
          </div>
        </div>

        {/* Section: Project Performance Bond Slashing */}
        <div className="border border-muted bg-card/40 backdrop-blur-md rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-muted pb-3">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-rose-500 animate-pulse" />
              <h3 className="text-base font-bold text-foreground">Project Performance Bond Slashing</h3>
            </div>
            <button onClick={fetchProjects} className="p-1 text-muted-foreground hover:text-foreground transition">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Active or funded campaigns can be slashed if the creator defaults or fails to complete milestones. Slashing transitions the vault status to Refunding and requires multisig approval.
          </p>

          <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">
            {projects.filter(p => p.status?.toLowerCase() === 'funded' || p.status?.toLowerCase() === 'active' || p.status?.toLowerCase() === 'refunding').length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">No projects eligible for slashing.</p>
            ) : (
              projects.filter(p => p.status?.toLowerCase() === 'funded' || p.status?.toLowerCase() === 'active' || p.status?.toLowerCase() === 'refunding').map((proj) => {
                const isSlashApproved = slashingApprovals[proj.vaultAddress] || false;
                const voters = slashVotesByProject[proj.vaultAddress] || [];
                const threshold = slashThresholdsByProject[proj.vaultAddress] || 3;
                const hasVoted = freighterWalletAddress && voters.includes(freighterWalletAddress);
                const isSlashExecuted = proj.status?.toLowerCase() === 'refunding';
                return (
                  <div key={proj.id} className="flex flex-col md:flex-row md:items-center justify-between bg-background/50 p-4 rounded-xl border border-muted text-xs gap-3">
                    <div className="flex flex-col gap-1 min-w-0 font-mono">
                      <div className="flex items-center gap-2">
                        <strong className="text-foreground font-semibold font-sans text-sm">{proj.title}</strong>
                        <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase border bg-background/30 font-sans ${proj.status?.toLowerCase() === 'refunding'
                          ? 'text-rose-500 border-rose-500/20 bg-rose-500/10'
                          : proj.status?.toLowerCase() === 'funded'
                            ? 'text-emerald-500 border-emerald-500/20 bg-emerald-500/10'
                            : 'text-indigo-500 border-indigo-500/20 bg-indigo-500/10'
                          }`}>
                          {proj.status}
                        </span>
                      </div>
                      <span className="text-muted-foreground text-[10px] break-all font-sans">Vault: {proj.vaultAddress}</span>

                      {/* Voting indicator */}
                      <div className="border-t border-muted/30 pt-2 mt-2 space-y-1.5 font-sans">
                        <div className="font-bold text-foreground font-mono">
                          Slashing Approval Votes: {voters.length} / {threshold} Required
                        </div>
                        {voters.length > 0 && (
                          <div className="flex flex-col gap-0.5 font-mono">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider font-sans">Voters:</span>
                            {voters.map((v) => (
                              <div key={v} className="text-[10px] text-foreground flex items-center gap-1 select-all" title={v}>
                                {v.slice(0, 8)}...{v.slice(-8)}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-1 font-semibold text-[11px]">
                          {isSlashExecuted ? (
                            <span className="text-rose-500">Slashing has already been executed.</span>
                          ) : !isSlashApproved ? (
                            <span className="text-amber-500">
                              Need {threshold - voters.length} more approval(s) before execution.
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 self-end md:self-center font-sans">
                      {/* Sign Slash Approval */}
                      <button
                        onClick={async () => {
                          setSelectedApproveProjectId(String(proj.id));
                          // Small timeout to let state update, then execute handleApproveSlash
                          setTimeout(async () => {
                            await handleApproveSlash();
                          }, 50);
                        }}
                        disabled={loading || !isMultisigSigner || hasVoted || isSlashExecuted}
                        className="bg-rose-500/10 border border-rose-500/20 hover:border-rose-500/40 text-rose-500 px-4 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        {hasVoted ? "Already Voted" : "Sign Slash Approval"}
                      </button>

                      {/* Execute Slashing */}
                      <button
                        onClick={() => handleExecuteSlashing(proj)}
                        disabled={loading || !isSlashApproved || isSlashExecuted}
                        className="bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap shadow-sm"
                      >
                        {isSlashExecuted ? "Already Executed" : "Execute Slashing"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Section: Multisig Signer Management */}
        <div className="border border-muted bg-card/40 backdrop-blur-md rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-muted pb-3">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-orange-500" />
              <h3 className="text-base font-bold text-foreground">Multisig Approval Signers</h3>
              {!isPrimaryAdmin && (
                <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold">
                  Read Only
                </span>
              )}
            </div>
            <button onClick={fetchApprovalInfo} className="p-1 text-muted-foreground hover:text-foreground transition">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Add or remove signers and configure the threshold required for milestone tranche releases.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Current Configuration */}
            <div className="border border-muted bg-muted/20 p-4 rounded-xl flex flex-col gap-3">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider">Active Signers & Threshold</span>
              <div className="text-xs flex flex-col gap-1.5 max-h-[140px] overflow-y-auto">
                {signersList.map((signer) => (
                  <div key={signer} className="flex justify-between items-center bg-background/50 border border-muted p-2 rounded-lg font-mono text-[10px]">
                    <span className="text-muted-foreground">{signer.slice(0, 10)}...{signer.slice(-10)}</span>
                    {signersList.length > 1 && (
                      <button
                        onClick={() => handleRemoveSigner(signer)}
                        disabled={loading || !isPrimaryAdmin}
                        className="text-rose-500 hover:text-rose-400 p-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-muted pt-2 mt-1 text-xs flex justify-between">
                <span className="text-muted-foreground">Required Threshold:</span>
                <span className="text-emerald-500 font-bold font-mono">{currentThreshold !== null ? `${currentThreshold} of ${signersList.length}` : "Loading..."}</span>
              </div>
            </div>

            {/* Edit Signers */}
            <div className="flex flex-col gap-3 border border-muted bg-muted/20 p-4 rounded-xl">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider">Add Signer</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSignerToAdd}
                  onChange={(e) => setNewSignerToAdd(e.target.value)}
                  disabled={loading || !isPrimaryAdmin}
                  placeholder="Signer G..."
                  className="flex-grow bg-background/50 border border-muted rounded-lg px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleAddSigner}
                  disabled={loading || !isPrimaryAdmin}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 rounded-lg flex items-center justify-center transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <span className="text-xs font-bold text-foreground uppercase tracking-wider mt-1">Update Threshold</span>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={newThresholdVal}
                  onChange={(e) => setNewThresholdVal(e.target.value)}
                  min="1"
                  max={signersList.length || 1}
                  disabled={loading || !isPrimaryAdmin}
                  className="w-20 bg-background/50 border border-muted rounded-lg px-3 py-1.5 text-xs text-center text-foreground focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleUpdateThreshold}
                  disabled={loading || !isPrimaryAdmin}
                  className="flex-grow bg-background hover:bg-muted border border-muted text-xs font-semibold rounded-lg transition shadow-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Set Threshold
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section: Vault Template Upgrades (Factory) */}
        <div className="border border-muted bg-card/40 backdrop-blur-md rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-muted pb-3">
            <div className="flex items-center gap-2">
              <FileCode className="h-5 w-5 text-orange-500" />
              <h3 className="text-base font-bold text-foreground">Factory Vault Template Upgrades</h3>
              {!isPrimaryAdmin && (
                <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold">
                  Read Only
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-mono">Factory: {FACTORY_ID.slice(0, 6)}...</span>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Update the canonical WASM bytecode hash pointer inside the Factory. New project vaults deployed by the factory will use this updated logic.
          </p>

          <div className="flex flex-col gap-2 border border-muted bg-muted/20 p-4 rounded-xl">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New 32-Byte Vault WASM Hash (Hex)</label>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={newWasmHashHex}
                onChange={(e) => setNewWasmHashHex(e.target.value)}
                disabled={loading || !isPrimaryAdmin}
                placeholder="ce412b3b2af4582d44a87100a4821122b44db3f8b06d01a81c3bc1bf196e4ae7"
                className="bg-background/50 border border-muted rounded-lg px-4 py-2.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleUpdateWasmHash}
                disabled={loading || !isPrimaryAdmin}
                className="w-full rounded-lg bg-primary hover:opacity-90 px-4 py-2.5 text-xs font-semibold text-primary-foreground flex items-center justify-center gap-1.5 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Apply Template WASM Hash Update
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
