"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signTransaction, signAuthEntry } from "@stellar/freighter-api";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Client as FactoryClient } from "@/packages/blkfndr_factory/src";
import { Client as IdentityClient } from "@/packages/blkfndr_identity/src";
import { Client as ApprovalClient } from "@/packages/blkfndr_approval/src";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { getPinataClient, getIPFSGatewayUrl } from "@/lib/pinata-client";
import Link from "next/link";
import { getProjects, saveProjectMetadataCacheByVault, updateProjectStatusFromChain, submitKycRequest, getKycRequestByAddress, triggerIndexerSync } from "@/app/actions";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Copy,
  Check,
  Wallet,
  Activity,
  ArrowRight,
  Shield,
  FileCode,
  DollarSign,
  Plus,
  Trash2,
  RotateCw,
  Clock,
  Coins,
  RefreshCw
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TextPressure from "@/components/layout/TextPressure";
import {
  getAccountInfo,
  getBalance,
  getRecentAccountOperations,
  type StellarAccountActivityItem,
} from "@/lib/stellar";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
const IDENTITY_ID = process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID || "";
const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";
const USDC_ID = process.env.NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID || "";
const ALLOWED_ADMIN = process.env.NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS || "";

const shortenAddress = (
  value: string | null | undefined,
  head = 6,
  tail = 6,
) => {
  if (!value) return "not connected";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const getStatusToneClass = (status: string, bondPosted?: boolean) => {
  if (status === "raising" && bondPosted === false) {
    return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  }
  switch (status) {
    case "completed":
    case "active":
    case "funded":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "failed":
    case "refunding":
      return "bg-rose-500/10 text-rose-400 border-rose-500/20";
    case "raising":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    default:
      return "bg-slate-800 text-slate-400 border-slate-700/50";
  }
};

const shortenId = (id: string | number | null | undefined) => {
  if (!id) return "";
  const str = String(id);
  if (str.length <= 12) return str;
  return `${str.slice(0, 6)}...${str.slice(-6)}`;
};

const msToDatetimeLocal = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const CATEGORY_OPTIONS = [
  "Technology",
  "Gaming",
  "Arts",
  "Education",
  "Health",
  "Environment",
  "Community",
];

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

export default function VaultPlaygroundPage() {
  const { freighterWalletAddress } = useFreighterWallet();
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("projects");
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Deployed projects list
  const [projects, setProjects] = useState<any[]>([]);
  const [syncingVaults, setSyncingVaults] = useState<Record<string, boolean>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [bondPercentage, setBondPercentage] = useState<number>(500);

  const fetchBondPercentage = useCallback(async () => {
    try {
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress || ALLOWED_ADMIN,
      });
      const tx = await client.get_bond_percentage();
      const res = await tx.simulate();
      if (res.result !== undefined) {
        setBondPercentage(Number(res.result));
      }
    } catch (err) {
      console.error("Failed to fetch bond percentage in playground:", err);
    }
  }, [freighterWalletAddress]);

  const fetchProjects = useCallback(async () => {
    try {
      const list = await getProjects();
      setProjects(list);
      if (list.length > 0) {
        setSelectedProjectId((prev) => prev || list[0].id?.toString());
      }
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchBondPercentage();
  }, [fetchProjects, fetchBondPercentage]);

  // States for forms
  const [creatorToAttest, setCreatorToAttest] = useState("");
  const [kycFullName, setKycFullName] = useState("");
  const [kycEmail, setKycEmail] = useState("");
  const [kycDocumentType, setKycDocumentType] = useState("Passport");
  const [kycDocumentImage, setKycDocumentImage] = useState("");
  const [kycUploading, setKycUploading] = useState(false);
  const [deployDeadlineInput, setDeployDeadlineInput] = useState<string>(
    msToDatetimeLocal(Date.now() + 10 * 24 * 60 * 60 * 1000)
  );
  const [deployBond, setDeployBond] = useState("1");
  const [deployedVaultAddress, setDeployedVaultAddress] = useState("");
  const [kycRequestStatus, setKycRequestStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");

  const [deployTitle, setDeployTitle] = useState("My Test Project");
  const [deployTagline, setDeployTagline] = useState("A revolutionary Web3 crowd-funding initiative");
  const [deployDescription, setDeployDescription] = useState("This is a detailed description of the test project showing milestone-based release mechanism on Stellar Testnet.");
  const [deployCategory, setDeployCategory] = useState("Technology");

  // Project Image States
  const [deployImageName, setDeployImageName] = useState<string | null>(null);
  const [deployImagePreview, setDeployImagePreview] = useState<string | null>(null);
  const [isDeployImageUploading, setIsDeployImageUploading] = useState(false);
  const [deployImageFile, setDeployImageFile] = useState<File | null>(null);

  const [deployMilestones, setDeployMilestones] = useState<{ id: number; amount: string; title: string; description: string }[]>([
    { id: 1, amount: "5", title: "Milestone 1", description: "First phase of project development and validation" },
    { id: 2, amount: "5", title: "Milestone 2", description: "Second phase: deployment and completion" },
  ]);

  const deployGoal = deployMilestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0).toString();

  const bondPct = bondPercentage / 10000;
  const calculatedDeployGoal = Number(deployGoal) || 0;
  const minBondRequired = calculatedDeployGoal * bondPct;
  const recommendedBond = calculatedDeployGoal * Math.max(0.10, bondPct * 2);

  const prevRecommendedRef = useRef(1.0);
  useEffect(() => {
    const goalVal = Number(deployGoal) || 0;
    const newRecommended = goalVal * Math.max(0.10, bondPct * 2);
    const currentBondNum = Number(deployBond) || 0;
    if (currentBondNum === prevRecommendedRef.current || deployBond === "" || deployBond === "0") {
      setDeployBond(newRecommended.toString());
    }
    prevRecommendedRef.current = newRecommended;
  }, [deployGoal, bondPct]);

  const [vaultAddressToInteract, setVaultAddressToInteract] = useState("");
  const [contributionAmount, setContributionAmount] = useState("");
  const [projectIdToApprove, setProjectIdToApprove] = useState("1");
  const [milestoneIdToApprove, setMilestoneIdToApprove] = useState("1");
  const [milestoneSignerAddress, setMilestoneSignerAddress] = useState("");
  const [milestoneIdToRelease, setMilestoneIdToRelease] = useState("1");

  useEffect(() => {
    if (freighterWalletAddress) {
      setMilestoneSignerAddress((prev) => prev || freighterWalletAddress);
    }
  }, [freighterWalletAddress]);

  const [vaultStateInfo, setVaultStateInfo] = useState<any>(null);
  const [selectedProjBackerBalance, setSelectedProjBackerBalance] = useState<number | null>(null);
  const [userContributions, setUserContributions] = useState<string[]>([]);

  const [approvalSigners, setApprovalSigners] = useState<string[]>([]);
  const [approvalThreshold, setApprovalThreshold] = useState<number>(0);

  const fetchApprovalSigners = useCallback(async () => {
    try {
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress || ALLOWED_ADMIN,
      });
      const [signersTx, thresholdTx] = await Promise.all([
        client.get_signers(),
        client.get_threshold(),
      ]);
      const signersRes = await signersTx.simulate();
      const thresholdRes = await thresholdTx.simulate();
      setApprovalSigners(signersRes.result || []);
      setApprovalThreshold(thresholdRes.result || 0);
    } catch (err) {
      console.error("Failed to fetch approval signers in playground:", err);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    fetchApprovalSigners();
  }, [fetchApprovalSigners]);

  const [balances, setBalances] = useState<any[]>([]);
  const [accountSeq, setAccountSeq] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<StellarAccountActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const refreshWalletActivity = useCallback(async () => {
    if (!freighterWalletAddress) {
      setBalances([]);
      setRecentActivity([]);
      setAccountSeq(null);
      return;
    }

    setActivityLoading(true);
    setActivityError(null);
    try {
      const [account, walletBalances, operations] = await Promise.all([
        getAccountInfo(freighterWalletAddress),
        getBalance(freighterWalletAddress),
        getRecentAccountOperations(freighterWalletAddress, 20),
      ]);

      setBalances(walletBalances as any[]);
      setAccountSeq(account.sequence ?? null);
      setRecentActivity(operations);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActivityError(message);
    } finally {
      setActivityLoading(false);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    refreshWalletActivity().catch((err) =>
      console.error("wallet activity refresh failed:", err),
    );
  }, [refreshWalletActivity]);

  // Fetch user contributions history
  useEffect(() => {
    if (freighterWalletAddress) {
      const fetchUserContributions = async () => {
        try {
          const res = await fetch(`/api/user/contributions?address=${freighterWalletAddress}`);
          const data = await res.json();
          if (data.success) {
            setUserContributions(data.contributedVaults || []);
          }
        } catch (e) {
          console.error("Failed to fetch user contributions:", e);
        }
      };
      fetchUserContributions();
    } else {
      setUserContributions([]);
    }
  }, [freighterWalletAddress]);

  const [walletBalances, setWalletBalances] = useState<any[]>([]);

  const fetchWalletBalances = useCallback(async () => {
    if (!freighterWalletAddress) {
      setWalletBalances([]);
      return;
    }
    try {
      const { getBalance } = await import("@/lib/stellar");
      const bals = await getBalance(freighterWalletAddress);
      setWalletBalances(bals || []);
    } catch (e) {
      console.error("Failed to fetch wallet balances:", e);
      setWalletBalances([]);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    fetchWalletBalances();
  }, [freighterWalletAddress, fetchWalletBalances]);

  // Fetch backer balance for selected project
  const fetchSelectedProjBackerBalance = useCallback(async (vaultAddress: string, walletAddress: string) => {
    try {
      const client = new VaultClient({
        contractId: vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: walletAddress,
      });
      const balanceTx = await client.get_balance({ contributor: walletAddress });
      const balanceVal = await balanceTx.simulate();
      const balNum = Number(balanceVal.result || 0) / 10_000_000;
      setSelectedProjBackerBalance(balNum);
    } catch (e) {
      console.error("Failed to query backer balance for selected project:", e);
      setSelectedProjBackerBalance(0);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId || projects.length === 0 || !freighterWalletAddress) {
      setSelectedProjBackerBalance(null);
      return;
    }
    const selectedProj = projects.find((p) => p.id?.toString() === selectedProjectId);
    if (selectedProj && selectedProj.vaultAddress) {
      fetchSelectedProjBackerBalance(selectedProj.vaultAddress, freighterWalletAddress);
    }
  }, [selectedProjectId, freighterWalletAddress, projects, fetchSelectedProjBackerBalance]);


  const addLog = (message: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev]);
  };

  const handleSyncProjectStatus = async (vaultAddress: string) => {
    if (!vaultAddress) return;
    setSyncingVaults((prev) => ({ ...prev, [vaultAddress]: true }));
    addLog(`Syncing live status from blockchain for vault: ${vaultAddress}`);
    try {
      const client = new VaultClient({
        contractId: vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      // Query get_info and get_state on-chain
      addLog(`Querying get_info on-chain for vault: ${vaultAddress}`);
      const infoTx = await client.get_info();
      const infoRes = await infoTx.simulate();

      let info = null;
      let isLegacy = false;
      try {
        info = infoRes.result;
      } catch (parseErr) {
        console.warn("Failed to parse vault on-chain info, likely legacy schema:", parseErr);
        isLegacy = true;
      }

      addLog(`Querying get_state on-chain for vault: ${vaultAddress}`);
      const stateTx = await client.get_state();
      const stateRes = await stateTx.simulate();
      const stateNum = stateRes.result;

      const mapStateToString = (sNum: number): string => {
        switch (sNum) {
          case 0: return "raising";
          case 1: return "funded";
          case 2: return "active";
          case 3: return "failed";
          case 4: return "refunding";
          case 5: return "completed";
          default: return "pending";
        }
      };

      const statusStrRaw = mapStateToString(stateNum);

      if (isLegacy || !info) {
        addLog(`Vault ${vaultAddress} is a legacy instance. Skipping database cache updates for on-chain status sync.`);
        toast({ title: "Legacy Vault", description: "Skipping sync for legacy contract version." });
        return;
      }

      const infoObj = info as any;
      let statusStr = statusStrRaw;
      if (statusStr === "raising" && !infoObj.bond_posted) {
        statusStr = "pending";
      }
      const raisedHuman = Number(infoObj.raised_amount) / 10_000_000;
      const bondAmountHuman = Number(infoObj.bond_amount) / 10_000_000;
      const releasedTotalHuman = Number(infoObj.released_total) / 10_000_000;

      const mappedMilestones = infoObj.milestones.map((m: any) => ({
        id: Number(m.id),
        amount: Number(m.amount) / 10_000_000,
        released: Boolean(m.released),
      }));

      addLog(`Updating database cache with status: ${statusStr}, raised: ${raisedHuman} USDC, bondPosted: ${infoObj.bond_posted}`);
      const syncRes = await updateProjectStatusFromChain(vaultAddress, {
        currentFunding: raisedHuman,
        currentFundingRaw: infoObj.raised_amount.toString(),
        bondPosted: Boolean(infoObj.bond_posted),
        bondAmount: bondAmountHuman,
        releasedTotal: releasedTotalHuman,
        milestones: mappedMilestones,
        status: statusStr,
      });

      if (syncRes.success) {
        addLog(`Successfully synced project status for vault ${vaultAddress}`);
        toast({ title: "Sync Successful", description: "Project status updated from blockchain." });
        await fetchProjects();
      } else {
        throw new Error(syncRes.error || "Failed to update cache");
      }
    } catch (err: any) {
      console.error("Sync failed:", err);
      addLog(`Sync failed for vault ${vaultAddress}: ${err.message || String(err)}`);
      toast({ title: "Sync Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setSyncingVaults((prev) => ({ ...prev, [vaultAddress]: false }));
    }
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 1. Submit KYC Attestation Request
  const handleAttestCreator = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!kycFullName.trim()) {
      toast({ title: "Missing Name", description: "Please enter your full name.", variant: "destructive", isError: true });
      return;
    }
    if (!kycEmail.trim()) {
      toast({ title: "Missing Email", description: "Please enter your email address.", variant: "destructive", isError: true });
      return;
    }
    if (!kycDocumentImage) {
      toast({ title: "Missing ID Image", description: "Please upload an image of your government-issued ID.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Submitting KYC attestation request for ${freighterWalletAddress} to database...`);
    try {
      const res = await submitKycRequest(freighterWalletAddress, {
        fullName: kycFullName,
        email: kycEmail,
        documentType: kycDocumentType,
        documentImage: kycDocumentImage,
        idNumber: "TEST-ID-1234",
        dob: "2000-01-01",
        expiryDate: "2030-01-01",
        residentialAddress: "123 Testing St, Playground City",
        consentFlag: true,
      });
      if (res.success) {
        addLog(`KYC attestation request submitted for ${freighterWalletAddress}. Status: pending.`);
        toast({ title: "Request Submitted", description: "KYC Attestation Request has been submitted to the administrator." });
        setKycRequestStatus("pending");
      } else {
        throw new Error(res.error || "Failed to submit request");
      }
    } catch (err: any) {
      addLog(`Failed to submit KYC request: ${err.message || String(err)}`);
      toast({ title: "Submission Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleKycImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setKycUploading(true);
    addLog(`Uploading image ${file.name} to IPFS...`);
    try {
      const pinata = getPinataClient();
      const cid = await pinata.uploadFile(file);
      setKycDocumentImage(cid);
      addLog(`Image uploaded successfully to IPFS. CID: ${cid}`);
      toast({ title: "Upload Successful", description: "Your ID image has been uploaded to IPFS." });
    } catch (err: any) {
      console.error("Image upload failed:", err);
      addLog(`Image upload failed: ${err.message || String(err)}`);
      toast({ title: "Upload Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setKycUploading(false);
    }
  };

  const handleDeployImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setDeployImagePreview(null);
      setDeployImageName(null);
      setDeployImageFile(null);
      return;
    }
    setDeployImageName(file.name);
    setDeployImageFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setDeployImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // 2. Deploy Project Vault
  const handleDeployProject = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }

    if (!deployTitle.trim() || !deployTagline.trim() || !deployDescription.trim() || !deployCategory.trim()) {
      toast({ title: "Missing Metadata", description: "Please provide a title, tagline, description, and category for your project.", variant: "destructive", isError: true });
      return;
    }

    // KYC pre-validation
    try {
      const identityClient = new IdentityClient({
        contractId: IDENTITY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: process.env.NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS || "",
      });
      const tx = await identityClient.is_kyc_approved({ address: freighterWalletAddress });
      const result = await tx.simulate();
      if (!result.result) {
        toast({ title: "KYC Required", description: "You must complete KYC attestation before deploying a vault.", variant: "destructive", isError: true });
        return;
      }
    } catch (err: any) {
      console.error("Failed to verify KYC attestation:", err);
      toast({ title: "KYC Check Failed", description: "Could not verify your KYC status. Please try again.", variant: "destructive", isError: true });
      return;
    }

    const calculatedGoal = deployMilestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    if (calculatedGoal <= 0) {
      toast({ title: "Invalid Milestones", description: "Total milestone funding goal must be greater than 0 USDC.", variant: "destructive", isError: true });
      return;
    }

    const hasNegativeOrZeroMilestone = deployMilestones.some((m) => (Number(m.amount) || 0) <= 0);
    if (hasNegativeOrZeroMilestone) {
      toast({ title: "Invalid Milestones", description: "All milestone amounts must be greater than 0 USDC.", variant: "destructive", isError: true });
      return;
    }

    const minRequiredBond = calculatedGoal * bondPct;
    if (Number(deployBond) < minRequiredBond) {
      toast({
        title: "Insufficient Performance Bond",
        description: `The performance bond must be at least ${(bondPct * 100).toFixed(2)}% of the campaign goal (${minRequiredBond.toFixed(2)} USDC).`,
        variant: "destructive",
        isError: true,
      });
      return;
    }

    if (!deployImageFile) {
      toast({ title: "Project Image Required", description: "Please choose a project cover image file first.", variant: "destructive", isError: true });
      return;
    }

    const targetDeadlineMs = new Date(deployDeadlineInput).getTime();
    if (isNaN(targetDeadlineMs) || targetDeadlineMs <= Date.now()) {
      toast({ title: "Invalid Deadline", description: "Funding deadline must be in the future.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog("Uploading project cover image to IPFS via Pinata...");
    let imageCid = "";
    try {
      const pinata = getPinataClient();
      imageCid = await pinata.uploadFile(deployImageFile);
      addLog(`Cover image uploaded to IPFS successfully. CID: ${imageCid}`);
    } catch (err: any) {
      console.error("Cover image upload failed:", err);
      addLog(`Cover image upload failed: ${err.message || String(err)}`);
      toast({ title: "Image Upload Failed", description: err.message || String(err), variant: "destructive", isError: true });
      setLoading(false);
      return;
    }

    addLog("Preparing Vault initialization parameters...");
    try {
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const goalStroops = BigInt(Math.floor(calculatedGoal * 10000000));
      const bondStroops = BigInt(Math.floor(Number(deployBond) * 10000000));
      const deadlineTimestamp = BigInt(Math.floor(targetDeadlineMs / 1000));

      let currentSum = BigInt(0);
      const milestones = deployMilestones.map((m, idx) => {
        let amount: bigint;
        if (idx === deployMilestones.length - 1) {
          amount = goalStroops - currentSum;
        } else {
          amount = BigInt(Math.floor((Number(m.amount) || 0) * 10000000));
          currentSum += amount;
        }
        return {
          id: m.id,
          amount,
          released: false,
        };
      });

      addLog("Uploading project metadata JSON to IPFS via Pinata...");
      const metadata = {
        title: deployTitle,
        tagline: deployTagline,
        description: deployDescription,
        category: deployCategory,
        imageUrl: getIPFSGatewayUrl(imageCid),
        creator: freighterWalletAddress,
        fundingDeadline: targetDeadlineMs,
        fundingGoal: calculatedGoal,
        fundingGoalRaw: goalStroops.toString(),
        currencyType: "USDC",
        bondAmount: Number(deployBond),
        milestones: deployMilestones.map((m, idx) => {
          let amount: number;
          if (idx === deployMilestones.length - 1) {
            amount = calculatedGoal - deployMilestones.slice(0, idx).reduce((s, prev) => s + (Number(prev.amount) || 0), 0);
          } else {
            amount = Number(m.amount) || 0;
          }
          return {
            id: m.id,
            amount,
            title: m.title || `Milestone ${m.id}`,
            description: m.description || "",
          };
        }),
      };

      let metadataCid = "fallback_cid";
      try {
        const pinata = getPinataClient();
        const metadataFile = new File(
          [JSON.stringify(metadata, null, 2)],
          "metadata.json",
          { type: "application/json" }
        );
        metadataCid = await pinata.uploadFile(metadataFile);
        addLog(`Metadata uploaded to IPFS. CID: ${metadataCid}`);
      } catch (uploadErr: any) {
        metadataCid = "mock_" + Date.now();
        addLog(`[Warning] Pinata metadata upload failed: ${uploadErr.message || String(uploadErr)}. Falling back to local direct caching with CID: ${metadataCid}`);
      }

      addLog(`Submitting create_vault transaction via Factory ${FACTORY_ID}...`);
      const tx = await client.create_vault({
        config: {
          creator: freighterWalletAddress,
          token: USDC_ID,
          goal: goalStroops,
          deadline: deadlineTimestamp,
          bond_amount: bondStroops,
          approval_module: APPROVAL_ID,
          identity_registry: IDENTITY_ID,
          milestones,
          metadata_cid: metadataCid,
        },
      });

      addLog("Signing create_vault transaction with Freighter...");
      const response = await tx.signAndSend();
      const vaultAddr = response.result;
      setDeployedVaultAddress(vaultAddr);
      setVaultAddressToInteract(vaultAddr);
      addLog(`Vault deployed successfully at address: ${vaultAddr}`);

      // Save metadata directly in MongoDB cache
      try {
        addLog("Caching project metadata in MongoDB...");
        const cacheResult = await saveProjectMetadataCacheByVault(vaultAddr, {
          ...metadata,
          metadataCid,
        });
        if (cacheResult.success) {
          addLog("Project metadata cached successfully in MongoDB.");
        } else {
          addLog(`Failed to cache project metadata in MongoDB: ${cacheResult.error}`);
        }
      } catch (cacheErr: any) {
        addLog(`Error caching project metadata in MongoDB: ${cacheErr.message || String(cacheErr)}`);
      }

      toast({ title: "Deployment Successful", description: `Vault spawned at ${vaultAddr}` });
      try {
        await triggerIndexerSync();
      } catch (syncErr: any) {
        addLog(`Indexer sync failed: ${syncErr.message || String(syncErr)}`);
      }
      await fetchProjects();
    } catch (err: any) {
      addLog(`Deployment failed: ${err.message || String(err)}`);
      toast({ title: "Deployment Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // 3. Post Performance Bond
  const handlePostBond = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!vaultAddressToInteract) {
      toast({ title: "Missing Vault Address", description: "Please specify a vault address to interact with.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Initiating post_bond on vault ${vaultAddressToInteract}...`);
    try {
      const client = new VaultClient({
        contractId: vaultAddressToInteract,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.post_bond();
      addLog("Signing post_bond transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Post bond TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Bond Posted", description: "Creator performance bond has been posted." });
      try {
        await triggerIndexerSync();
      } catch (syncErr: any) {
        addLog(`Indexer sync failed: ${syncErr.message || String(syncErr)}`);
      }
      await handleSyncProjectStatus(vaultAddressToInteract);
      await handleQueryStatus(true);
      await fetchProjects();
    } catch (err: any) {
      addLog(`Post bond failed: ${err.message || String(err)}`);
      toast({ title: "Post Bond Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // 4. Contribute Funds
  const handleContribute = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!vaultAddressToInteract) {
      toast({ title: "Missing Vault Address", description: "Please specify a vault address.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    const amountVal = Number(contributionAmount) || 0;
    if (amountVal <= 0) {
      toast({ title: "Invalid Amount", description: "Contribution amount must be greater than 0.", variant: "destructive", isError: true });
      setLoading(false);
      return;
    }
    const amountStroops = BigInt(Math.round(amountVal * 10000000));
    addLog(`Initiating contribution of ${contributionAmount} USDC to vault ${vaultAddressToInteract}...`);
    try {
      const client = new VaultClient({
        contractId: vaultAddressToInteract,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.contribute({
        contributor: freighterWalletAddress,
        amount: amountStroops,
      });

      addLog("Signing contribution transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Contribute TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Contribution Complete", description: `Deposited ${contributionAmount} USDC.` });
      setContributionAmount("");
      await handleSyncProjectStatus(vaultAddressToInteract);
      await handleQueryStatus(true);
    } catch (err: any) {
      addLog(`Contribution failed: ${err.message || String(err)}`);
      toast({ title: "Contribution Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // 5. Finalize Raise
  const handleFinalizeRaise = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!vaultAddressToInteract) {
      toast({ title: "Missing Vault Address", description: "Please specify a vault address.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Initiating finalize_raise on vault ${vaultAddressToInteract}...`);
    try {
      const client = new VaultClient({
        contractId: vaultAddressToInteract,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.finalize_raise();
      addLog("Signing finalize_raise transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Finalize raise TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Finalized", description: "Raising period has been finalized." });
      try {
        await triggerIndexerSync();
      } catch (syncErr: any) {
        addLog(`Indexer sync failed: ${syncErr.message || String(syncErr)}`);
      }
      await handleSyncProjectStatus(vaultAddressToInteract);
      await handleQueryStatus(true);
      await fetchProjects();
    } catch (err: any) {
      addLog(`Finalization failed: ${err.message || String(err)}`);
      toast({ title: "Finalization Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // 6. Approve Milestone in Approval module
  const handleApproveMilestone = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!milestoneSignerAddress) {
      toast({ title: "Missing Signer Address", description: "Please enter the signer public key.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Signing approval for milestone ${milestoneIdToApprove} (project ${projectIdToApprove}) in approval module...`);
    try {
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.approve_milestone({
        signer: freighterWalletAddress,
        project_id: BigInt(projectIdToApprove),
        milestone_id: Number(milestoneIdToApprove),
      });

      addLog("Signing approve_milestone transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Approve milestone TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Approved in Multisig", description: "Milestone has been approved." });
    } catch (err: any) {
      addLog(`Milestone approval failed: ${err.message || String(err)}`);
      toast({ title: "Approval Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // 7. Release Milestone
  const handleReleaseMilestone = async () => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!vaultAddressToInteract) {
      toast({ title: "Missing Vault Address", description: "Please specify a vault address.", variant: "destructive", isError: true });
      return;
    }

    setLoading(true);
    addLog(`Initiating release_milestone (${milestoneIdToRelease}) on vault ${vaultAddressToInteract}...`);
    try {
      const client = new VaultClient({
        contractId: vaultAddressToInteract,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.release_milestone({
        milestone_id: Number(milestoneIdToRelease),
      });

      addLog("Signing release_milestone transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Release milestone TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Tranche Released", description: `Milestone ${milestoneIdToRelease} released.` });
      await handleSyncProjectStatus(vaultAddressToInteract);
      await handleQueryStatus(true);
    } catch (err: any) {
      addLog(`Release milestone failed: ${err.message || String(err)}`);
      toast({ title: "Release Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // Project-level Action: Post Performance Bond
  const handlePostBondForProject = async (proj: any) => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!proj.vaultAddress) return;

    setLoading(true);
    addLog(`Initiating post_bond on vault ${proj.vaultAddress}...`);
    try {
      const client = new VaultClient({
        contractId: proj.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.post_bond();
      addLog("Signing post_bond transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Post bond TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Bond Posted", description: "Creator performance bond has been posted." });
      try {
        await triggerIndexerSync();
      } catch (syncErr: any) {
        addLog(`Indexer sync failed: ${syncErr.message || String(syncErr)}`);
      }

      // Auto-sync status right after posting bond to update database/UI
      await handleSyncProjectStatus(proj.vaultAddress);
      await fetchProjects();
    } catch (err: any) {
      addLog(`Post bond failed: ${err.message || String(err)}`);
      toast({ title: "Post Bond Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // Project-level Action: Finalize Campaign (Raise Period)
  const handleFinalizeRaiseForProject = async (proj: any) => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!proj.vaultAddress) return;

    setLoading(true);
    addLog(`Initiating finalize_raise on vault ${proj.vaultAddress}...`);
    try {
      const client = new VaultClient({
        contractId: proj.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.finalize_raise();
      addLog("Signing finalize_raise transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Finalize raise TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Campaign Finalized", description: "Project state has been finalized." });
      try {
        await triggerIndexerSync();
      } catch (syncErr: any) {
        addLog(`Indexer sync failed: ${syncErr.message || String(syncErr)}`);
      }

      // Auto-sync status right after finalizing to update database/UI
      await handleSyncProjectStatus(proj.vaultAddress);
      await fetchProjects();
    } catch (err: any) {
      addLog(`Finalize campaign failed: ${err.message || String(err)}`);
      toast({ title: "Finalize Failed", description: err.message || String(err), variant: "destructive", isError: true });
    } finally {
      setLoading(false);
    }
  };

  // Project-level Action: Claim Refund
  const handleClaimRefundForProject = async (proj: any) => {
    if (!freighterWalletAddress) {
      toast({ title: "Wallet Disconnected", description: "Please connect your Freighter wallet.", variant: "destructive", isError: true });
      return;
    }
    if (!proj.vaultAddress) return;

    setLoading(true);
    addLog(`Initiating claim_refund for contributor ${freighterWalletAddress} on vault ${proj.vaultAddress}...`);
    try {
      const client = new VaultClient({
        contractId: proj.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const tx = await client.claim_refund({
        contributor: freighterWalletAddress,
      });

      addLog("Signing claim_refund transaction with Freighter...");
      const result = await tx.signAndSend();
      addLog(`Claim refund TX submitted. Result: ${JSON.stringify(result)}`);
      toast({ title: "Refund Claimed", description: "Refund has been processed." });
      try {
        await triggerIndexerSync();
      } catch (syncErr: any) {
        addLog(`Indexer sync failed: ${syncErr.message || String(syncErr)}`);
      }

      // Re-fetch project backer balance and sync database status
      await fetchSelectedProjBackerBalance(proj.vaultAddress, freighterWalletAddress);
      await handleSyncProjectStatus(proj.vaultAddress);
      await fetchProjects();
    } catch (err: any) {
      // Extract deep simulation error from Soroban
      const simError = (err.simulation as any)?.error;
      const errMsg = simError || err.message || String(err);
      addLog(`Claim refund failed: ${errMsg}`);

      const isAlreadyClaimed = String(errMsg).includes("#9") || String(errMsg).includes("NoFundsToRefund") || String(errMsg).includes("Contract, #9");
      const isInvalidStatus = String(errMsg).includes("#2") || String(errMsg).includes("InvalidStatus") || String(errMsg).includes("Contract, #2");
      const isNotAuthorized = String(errMsg).includes("#1") || String(errMsg).includes("NotAuthorized") || String(errMsg).includes("Contract, #1");

      if (isAlreadyClaimed) {
        toast({ title: "Refund Unavailable", description: "Refund already claimed or no contribution found.", variant: "destructive", isError: true });
        // Sync state so UI reflects the claimed status and locks the button
        try {
          await fetchSelectedProjBackerBalance(proj.vaultAddress, freighterWalletAddress);
          await handleSyncProjectStatus(proj.vaultAddress);
        } catch (refreshErr) {
          console.error("Failed to refresh state after refund error:", refreshErr);
        }
      } else if (isInvalidStatus) {
        toast({ title: "Invalid Vault State", description: "This vault is not in a refundable state. The project must be Failed or Refunding.", variant: "destructive", isError: true });
      } else if (isNotAuthorized) {
        toast({ title: "Authorization Failed", description: "You are not authorized to claim this refund. The connected wallet must match the original contributor.", variant: "destructive", isError: true });
      } else {
        toast({ title: "Refund Failed", description: String(errMsg), variant: "destructive", isError: true });
      }
    } finally {
      setLoading(false);
    }
  };

  // 9. Fetch Vault Status
  const handleQueryStatus = useCallback(async (silent = false) => {
    if (!vaultAddressToInteract) {
      if (!silent) {
        toast({ title: "Missing Vault Address", description: "Please specify a vault address.", variant: "destructive", isError: true });
      }
      return;
    }

    setLoading(true);
    addLog(`Querying on-chain state for vault ${vaultAddressToInteract}...`);
    try {
      // Refresh wallet balance automatically as part of the query status logic
      await fetchWalletBalances();

      const client = new VaultClient({
        contractId: vaultAddressToInteract,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress || process.env.NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS || "",
      });

      const [stateTx, infoTx] = await Promise.all([
        client.get_state(),
        client.get_info(),
      ]);

      const stateVal = await stateTx.simulate();
      const infoVal = await infoTx.simulate();

      let infoResult = null;
      let isLegacy = false;
      try {
        infoResult = infoVal.result || null;
      } catch (parseErr) {
        console.warn("Failed to parse vault on-chain info, likely legacy schema:", parseErr);
        isLegacy = true;
      }

      let slashApproved = false;
      try {
        if (!isLegacy && infoResult && infoResult.approval_module) {
          const approvalClient = new ApprovalClient({
            contractId: infoResult.approval_module,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
            publicKey: freighterWalletAddress || process.env.NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS || "",
          });
          const slashTx = await approvalClient.is_slash_approved({
            project_id: BigInt(infoResult.project_id),
          });
          const slashVal = await slashTx.simulate();
          slashApproved = Boolean(slashVal.result);
        }
      } catch (e) {
        console.error("Failed to query slash approval status:", e);
      }

      let backerBalance = 0;
      try {
        if (freighterWalletAddress) {
          const balanceTx = await client.get_balance({ contributor: freighterWalletAddress });
          const balanceVal = await balanceTx.simulate();
          backerBalance = Number(balanceVal.result || 0);
        }
      } catch (e) {
        console.error("Failed to query backer balance:", e);
      }

      setVaultStateInfo({
        state: stateVal.result,
        info: infoResult,
        slashApproved,
        backerBalance,
        isLegacy,
      });

      addLog(`Query state successful. State: ${JSON.stringify(stateVal.result)}. Info: ${JSON.stringify(infoResult)}. Legacy: ${isLegacy}. Slash Approved: ${slashApproved}. Backer Bal: ${backerBalance}`);
      if (!silent) {
        toast({ title: "Status Fetched", description: "Vault parameters loaded successfully." });
      }
    } catch (err: any) {
      addLog(`Status query failed: ${err.message || String(err)}`);
      if (!silent) {
        toast({ title: "Query Failed", description: err.message || String(err), variant: "destructive", isError: true });
      }
    } finally {
      setLoading(false);
    }
  }, [vaultAddressToInteract, freighterWalletAddress, fetchWalletBalances]);

  useEffect(() => {
    if (vaultAddressToInteract && vaultAddressToInteract.length === 56) {
      handleQueryStatus(true);
    }
  }, [vaultAddressToInteract, handleQueryStatus]);

  const fetchKycRequestStatus = useCallback(async () => {
    if (!freighterWalletAddress) return;
    try {
      const res = await getKycRequestByAddress(freighterWalletAddress);
      if (res.success && res.request) {
        setKycRequestStatus(res.request.status);
        setKycFullName(res.request.fullName || "");
        setKycEmail(res.request.email || "");
        setKycDocumentType(res.request.documentType || "Passport");
        setKycDocumentImage(res.request.documentImage || "");
      } else {
        setKycRequestStatus("none");
      }
    } catch (err) {
      console.error("Failed to fetch KYC request status:", err);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    if (freighterWalletAddress) {
      fetchKycRequestStatus();
    }
  }, [freighterWalletAddress, fetchKycRequestStatus]);

  // Pre-fill fields once wallet connects
  useEffect(() => {
    if (freighterWalletAddress) {
      setCreatorToAttest(freighterWalletAddress);
      setMilestoneSignerAddress(freighterWalletAddress);
    }
  }, [freighterWalletAddress]);

  // Auto-sync status on project selection
  useEffect(() => {
    if (!selectedProjectId || projects.length === 0) return;
    const selectedProj = projects.find((p) => p.id?.toString() === selectedProjectId);
    if (selectedProj && selectedProj.vaultAddress) {
      handleSyncProjectStatus(selectedProj.vaultAddress);
    }
  }, [selectedProjectId]);

  // Contribution calculations for interact tab
  const interactProj = projects.find((p) => p.vaultAddress === vaultAddressToInteract);
  const interactGoal = interactProj ? interactProj.fundingGoal : 0;
  const interactRaised = interactProj ? interactProj.currentFunding : 0;
  const contribVal = Number(contributionAmount) || 0;
  const feeBps = vaultStateInfo?.info?.fee_percentage !== undefined
    ? Number(vaultStateInfo.info.fee_percentage)
    : 300;
  const platformFeePercentage = feeBps / 10000;
  const platformFee = contribVal * platformFeePercentage;
  const totalWalletCharge = contribVal + platformFee;
  const usdcToken = walletBalances.find((b) => b.asset === "USDC" || b.asset_code === "USDC");
  const usdcBalance = usdcToken ? Number(usdcToken.balance) || 0 : 0;
  const isBalanceSufficient = usdcBalance >= totalWalletCharge;
  const remainingGoal = Math.max(0, interactGoal - interactRaised);
  const isExceedingGoal = contribVal > remainingGoal;

  const isBondPosted = vaultStateInfo?.info
    ? vaultStateInfo.info.bond_posted
    : (interactProj ? interactProj.bondPosted : false);

  const status = vaultStateInfo?.state
    ? (vaultStateInfo.state.tag || String(vaultStateInfo.state)).toLowerCase()
    : (interactProj ? interactProj.status : "raising");

  const isBondPending = status === "pending" || (status === "raising" && !isBondPosted);

  return (
    <div className="container mx-auto max-w-3xl space-y-8 py-10 px-4">
      {/* Title & Connection Status */}
      <div className="space-y-4">
        <div className="space-y-2">
          <TextPressure
            text="BLKFNDR"
            minFontSize={24}
            stroke={true}
            strokeWidth={1}
            textColor="orange"
            strokeColor="white"
          />
          <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Vault Testing Console
          </h2>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 bg-card/40 backdrop-blur-md rounded-xl border border-muted p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-orange-500" />
            <span className="text-sm text-muted-foreground">Freighter Wallet:</span>
            {freighterWalletAddress ? (
              <span
                className="font-mono text-xs font-semibold text-foreground select-all"
                title={freighterWalletAddress}
              >
                {freighterWalletAddress.slice(0, 8)}...{freighterWalletAddress.slice(-8)}
              </span>
            ) : (
              <span className="text-xs font-semibold text-rose-500 bg-rose-500/10 px-2.5 py-0.5 rounded-full border border-rose-500/10">
                Disconnected
              </span>
            )}
          </div>
          <Link
            href="/testing/vaults/admin"
            className="text-xs font-semibold bg-emerald-500/15 border border-emerald-500/25 hover:bg-emerald-500/25 text-emerald-400 px-4 py-2 rounded-lg flex items-center gap-1.5 transition shadow-sm"
          >
            <Shield className="h-3.5 w-3.5" /> Admin Panel
          </Link>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto bg-muted/40 p-1 rounded-xl">
          <TabsTrigger value="projects">All Projects</TabsTrigger>
          <TabsTrigger value="identity">KYC Attestation</TabsTrigger>
          <TabsTrigger value="deploy">Deploy Project</TabsTrigger>
          <TabsTrigger value="interact">Fund Project</TabsTrigger>
          <TabsTrigger value="activity">Account Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-6">
          <div className="space-y-6 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-muted pb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground font-headline flex items-center gap-2.5">
                  <Coins className="h-5 w-5 text-orange-500 animate-pulse" />
                  Deployed Projects Explorer
                </h3>
                <p className="text-xs text-muted-foreground">
                  Browse and manage milestone-gated fundraising campaigns deployed on the Stellar network.
                </p>
              </div>
              <button
                onClick={fetchProjects}
                disabled={loading}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-muted bg-background/50 hover:bg-background px-4 py-2 text-xs font-semibold shadow-sm transition disabled:opacity-50 text-foreground hover:text-emerald-400"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" />
                ) : (
                  <RotateCw className="h-3.5 w-3.5" />
                )}
                {loading ? "Refreshing..." : "Refresh Projects"}
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 border border-dashed border-muted rounded-xl">
                No deployed project vaults found. Use the "Deploy Project" tab to launch one.
              </div>
            ) : (
              <div className="flex flex-col gap-6 w-full">
                {/* Horizontal Carousel Selector */}
                <div className="relative w-full px-8">
                  <Carousel
                    opts={{ align: "start", loop: false }}
                    className="w-full py-2"
                  >
                    <CarouselContent className="-ml-3">
                      {projects.map((proj) => {
                        const id = proj.id?.toString();
                        const active = selectedProjectId === id;
                        const raised = proj.currentFunding || 0;
                        const goal = proj.fundingGoal || 1;
                        const progressPct = Math.min(100, Math.max(0, (raised / goal) * 100));

                        return (
                          <CarouselItem
                            key={proj.id}
                            className="pl-3 sm:basis-1/2 lg:basis-1/3"
                          >
                            <button
                              className={`w-full rounded-xl border p-4 text-left transition duration-200 hover:scale-[1.01] hover:shadow-md ${active
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md"
                                : "bg-card border-muted text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                                }`}
                              onClick={() => setSelectedProjectId(id)}
                            >
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
                                  Project #{shortenId(proj.id)}
                                </p>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase border ${getStatusToneClass(proj.status, proj.bondPosted)}`}
                                >
                                  {proj.status === "pending" || (proj.status === "raising" && !proj.bondPosted) ? "Bond Pending" : proj.status}
                                </span>
                              </div>
                              <p className="line-clamp-1 text-sm font-bold text-foreground">
                                {proj.title || `Project #${shortenId(proj.id)}`}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1.5 font-mono">
                                Raised {raised.toLocaleString()} / {goal.toLocaleString()} USDC
                              </p>
                              <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                                  style={{
                                    width: `${progressPct}%`,
                                  }}
                                />
                              </div>
                              <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>Category:</span>
                                <span className="font-semibold uppercase text-foreground">{proj.category}</span>
                              </div>
                            </button>
                          </CarouselItem>
                        );
                      })}
                    </CarouselContent>
                    <CarouselPrevious className="-left-4 bg-background border-muted text-muted-foreground hover:bg-muted hover:text-foreground" />
                    <CarouselNext className="-right-4 bg-background border-muted text-muted-foreground hover:bg-muted hover:text-foreground" />
                  </Carousel>
                </div>

                {/* Full Width Selected Project Inspect Card */}
                {(() => {
                  const selectedProj = projects.find((p) => p.id?.toString() === selectedProjectId) || projects[0];
                  if (!selectedProj) return null;

                  const imageSrc = selectedProj.imageUrl || "https://cdn.dribbble.com/userupload/24360672/file/original-185b34e5d1793db979a43af6d6abd426.gif";

                  // Calculate raise progress percent
                  const raised = selectedProj.currentFunding || 0;
                  const goal = selectedProj.fundingGoal || 1;
                  const progressPct = Math.min(100, Math.max(0, (raised / goal) * 100));

                  const MILESTONE_COLORS = [
                    { bg: "bg-emerald-500", text: "text-emerald-500" },
                    { bg: "bg-indigo-500", text: "text-indigo-500" },
                    { bg: "bg-purple-500", text: "text-purple-500" },
                    { bg: "bg-amber-500", text: "text-amber-500" },
                    { bg: "bg-cyan-500", text: "text-cyan-500" },
                    { bg: "bg-rose-500", text: "text-rose-500" },
                    { bg: "bg-teal-500", text: "text-teal-500" },
                  ];

                  // Find active milestone based on raised vs cumulative amounts
                  let activeMilestoneIdx = 0;
                  let cumulativeAmt = 0;
                  if (selectedProj.milestones && selectedProj.milestones.length > 0) {
                    for (let i = 0; i < selectedProj.milestones.length; i++) {
                      const m = selectedProj.milestones[i];
                      if (raised >= cumulativeAmt && raised < cumulativeAmt + m.amount) {
                        activeMilestoneIdx = i;
                        break;
                      }
                      cumulativeAmt += m.amount;
                    }
                    if (raised >= goal) {
                      activeMilestoneIdx = selectedProj.milestones.length - 1;
                    }
                  }
                  const activeColorSet = MILESTONE_COLORS[activeMilestoneIdx % MILESTONE_COLORS.length] || MILESTONE_COLORS[0];

                  return (
                    <div className="border border-muted bg-card/60 rounded-xl p-5 flex flex-col gap-5 shadow-lg animate-in fade-in duration-300 cursor-default">
                      {/* Image preview with overlay title, status, category, tagline */}
                      <div className="overflow-hidden rounded-xl border border-muted bg-background/50 relative aspect-[21/9] sm:aspect-[16/6] w-full max-h-[350px] cursor-default">
                        <img
                          src={imageSrc}
                          alt={selectedProj.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/45 to-transparent z-10" />

                        <div className="absolute bottom-0 left-0 right-0 p-5 z-20 flex flex-row justify-between items-end gap-4 cursor-default">
                          <div className="flex flex-col gap-1.5 justify-end">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-xl sm:text-2xl font-bold text-foreground leading-tight drop-shadow-md cursor-default">
                                {selectedProj.title}
                              </h3>
                              <span className={`text-[10px] px-2.5 py-0.5 rounded font-bold uppercase border backdrop-blur-md bg-background/30 cursor-default ${getStatusToneClass(selectedProj.status, selectedProj.bondPosted)}`}>
                                {selectedProj.status === "pending" || (selectedProj.status === "raising" && !selectedProj.bondPosted) ? "Bond Pending" : selectedProj.status}
                              </span>
                              <span className="text-[10px] px-2.5 py-0.5 bg-background/60 border border-muted rounded text-muted-foreground font-semibold uppercase backdrop-blur-md cursor-default">
                                {selectedProj.category}
                              </span>
                            </div>
                            <p className="text-xs sm:text-sm text-emerald-500 font-medium italic drop-shadow-sm leading-relaxed cursor-default">
                              {selectedProj.tagline}
                            </p>
                          </div>

                          <div className="flex flex-col items-end text-right shrink-0 pb-0.5 cursor-default">
                            <span className="text-foreground text-lg sm:text-xl font-bold font-mono drop-shadow-md cursor-default">
                              {goal.toLocaleString()} USDC
                            </span>
                            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mt-0.5 drop-shadow-sm cursor-default">
                              Funding Goal
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Detailed description */}
                      <div className="flex flex-col gap-1 cursor-default">
                        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider font-mono cursor-default">Campaign Pitch</span>
                        <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line cursor-default">
                          {selectedProj.description}
                        </p>
                      </div>

                      {/* Segmented Milestone Progress Bar */}
                      <div className="flex flex-col gap-3 pt-2 cursor-default">
                        <div className="flex justify-between items-center text-xs cursor-default">
                          <span className="text-foreground font-bold font-mono cursor-default">{(selectedProj.currentFunding || 0).toLocaleString()} USDC</span>
                          <span className={`font-mono font-bold cursor-default ${activeColorSet.text}`}>{progressPct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex cursor-default">
                          {selectedProj.milestones && selectedProj.milestones.length > 0 ? (
                            selectedProj.milestones.map((m: any, idx: number) => {
                              const segmentWeight = (m.amount / goal) * 100;
                              let cumulativeStart = 0;
                              for (let i = 0; i < idx; i++) {
                                cumulativeStart += selectedProj.milestones[i].amount;
                              }
                              const cumulativeEnd = cumulativeStart + m.amount;

                              let fillPct = 0;
                              if (raised >= cumulativeEnd) {
                                fillPct = 100;
                              } else if (raised > cumulativeStart) {
                                fillPct = ((raised - cumulativeStart) / m.amount) * 100;
                              }

                              const colorSet = MILESTONE_COLORS[idx % MILESTONE_COLORS.length];

                              return (
                                <div
                                  key={m.id}
                                  style={{ width: `${segmentWeight}%` }}
                                  className="h-full bg-muted overflow-hidden relative"
                                  title={`${m.title || `Milestone ${m.id}`}: ${m.amount} USDC (${fillPct.toFixed(1)}% funded)`}
                                >
                                  <div
                                    style={{ width: `${fillPct}%` }}
                                    className={`h-full transition-all duration-300 ${colorSet.bg}`}
                                  />
                                </div>
                              );
                            })
                          ) : (
                            <div
                              style={{ width: `${progressPct}%` }}
                              className="h-full bg-emerald-500 transition-all duration-300"
                            />
                          )}
                        </div>

                        {/* Milestones in Bullet Form */}
                        {selectedProj.milestones && selectedProj.milestones.length > 0 && (
                          <div className="flex flex-col gap-2.5 mt-3 pt-3 border-t border-muted cursor-default">
                            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider font-mono cursor-default">Milestones</span>
                            <ul className="space-y-3.5 pl-1 cursor-default">
                              {selectedProj.milestones.map((m: any, idx: number) => {
                                const colorSet = MILESTONE_COLORS[idx % MILESTONE_COLORS.length];
                                return (
                                  <li key={m.id} className="flex items-start gap-2.5 text-foreground/90 cursor-default" title={m.description}>
                                    <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${colorSet.bg}`} />
                                    <div className="flex-1 text-xs cursor-default">
                                      <div className="flex flex-wrap items-center gap-1.5 cursor-default">
                                        <span className="font-bold font-mono text-foreground cursor-default">
                                          {m.title || `Milestone ${m.id}`}:
                                        </span>
                                        <span className="font-mono text-muted-foreground cursor-default">{m.amount.toLocaleString()} USDC</span>
                                        <span className={`text-[10px] font-bold uppercase cursor-default ${m.released ? "text-emerald-500" : "text-muted-foreground"}`}>
                                          ({m.released ? "Released" : "Locked"})
                                        </span>
                                      </div>
                                      {m.description && <p className="text-muted-foreground font-normal mt-0.5 leading-relaxed cursor-default">{m.description}</p>}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Context block */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px] border-t border-muted pt-3 cursor-default">
                        <div className="cursor-default">
                          <span className="text-[9px] text-muted-foreground uppercase tracking-wider block mb-1.5 cursor-default">Creator</span>
                          <div className="flex items-center gap-2 select-all cursor-default">
                            {selectedProj.creatorAvatar ? (
                              <img
                                src={selectedProj.creatorAvatar}
                                alt="Creator Avatar"
                                className="h-5 w-5 rounded-full border border-muted object-cover cursor-default"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-muted bg-muted flex items-center justify-center text-[8px] text-muted-foreground cursor-default">
                                ?
                              </div>
                            )}
                            <span
                              className="font-mono text-xs text-foreground hover:text-emerald-500 transition cursor-default"
                              title={selectedProj.creator}
                            >
                              {selectedProj.creatorName || selectedProj.creator}
                            </span>
                          </div>
                        </div>
                        <div className="cursor-default">
                          <span className="text-[9px] text-muted-foreground uppercase tracking-wider block mb-1.5 cursor-default">Vault Contract ID</span>
                          <span
                            className="font-mono text-xs text-foreground break-all hover:text-emerald-500 transition block select-all cursor-default"
                            title={selectedProj.vaultAddress}
                          >
                            {selectedProj.vaultAddress || "None"}
                          </span>
                        </div>
                      </div>

                      {/* Interaction controls */}
                      {selectedProj.vaultAddress && (() => {
                        const isSelectedProjCreator = freighterWalletAddress && (
                          selectedProj.creatorAddress === freighterWalletAddress ||
                          selectedProj.creator === freighterWalletAddress
                        );

                        const hasExpired = (selectedProj.status === "raising" || selectedProj.status === "pending") && Date.now() >= (selectedProj.fundingDeadline || 0);

                        const hasContributed = (selectedProj.vaultAddress && userContributions.includes(selectedProj.vaultAddress)) || (selectedProjBackerBalance !== null && selectedProjBackerBalance > 0);

                        const isRefundable = selectedProj.status?.toLowerCase() === "failed" || selectedProj.status?.toLowerCase() === "refunding";

                        return (
                          <div className="border-t border-muted pt-3 mt-1 flex flex-col sm:flex-row gap-2.5 justify-between items-center w-full">
                            {/* Left side actions */}
                            <div className="flex flex-wrap gap-2.5">
                              {/* Post Bond Button */}
                              {isSelectedProjCreator && (selectedProj.status === "pending" || !selectedProj.bondPosted) && (
                                <button
                                  onClick={() => handlePostBondForProject(selectedProj)}
                                  disabled={loading || selectedProj.bondPosted}
                                  className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-muted disabled:text-muted-foreground text-white disabled:opacity-50 text-xs px-4 py-2 rounded-lg font-bold transition shadow-md"
                                >
                                  {selectedProj.bondPosted ? "Bond Posted" : "Post Bond"}
                                </button>
                              )}

                              {/* Finalize Project Campaign Button */}
                              {hasExpired && (
                                <button
                                  onClick={() => handleFinalizeRaiseForProject(selectedProj)}
                                  disabled={loading}
                                  className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs px-4 py-2 rounded-lg font-bold transition shadow-md"
                                >
                                  Finalize Campaign
                                </button>
                              )}

                              {/* Claim Refund Button */}
                              {isRefundable && hasContributed && (
                                <button
                                  onClick={() => handleClaimRefundForProject(selectedProj)}
                                  disabled={loading || selectedProjBackerBalance === 0}
                                  className="bg-rose-500 hover:bg-rose-600 disabled:bg-muted disabled:text-muted-foreground text-white disabled:opacity-50 text-xs px-4 py-2 rounded-lg font-bold transition shadow-md"
                                >
                                  {selectedProjBackerBalance === 0 ? "Refunded" : "Claim Refund"}
                                </button>
                              )}
                            </div>

                            {/* Right side main action */}
                            {(() => {
                              const isBondPending = selectedProj.status === "pending" || (selectedProj.status === "raising" && !selectedProj.bondPosted);
                              const isGoalReached = selectedProj.currentFunding >= selectedProj.fundingGoal;
                              const isExpired = Date.now() >= (selectedProj.fundingDeadline || 0);

                              let buttonText = "Fund";
                              if (isBondPending) {
                                buttonText = "Bond Pending";
                              } else if (isGoalReached) {
                                buttonText = "Goal Reached";
                              } else if (isExpired) {
                                buttonText = "Expired";
                              } else if (selectedProj.status !== "raising") {
                                buttonText = "Closed";
                              }

                              return (
                                <button
                                  onClick={() => {
                                    setVaultAddressToInteract(selectedProj.vaultAddress);
                                    setProjectIdToApprove(selectedProj.id);
                                    setActiveTab("interact");
                                    toast({ title: "Project Selected", description: `Active project vault selected: ${selectedProj.title || `Project #${selectedProj.id}`}` });
                                  }}
                                  disabled={isBondPending || isGoalReached || isExpired || selectedProj.status !== "raising"}
                                  className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-muted disabled:text-muted-foreground text-white disabled:opacity-50 text-xs px-4 py-2.5 rounded-lg font-semibold transition shrink-0"
                                >
                                  {buttonText}
                                </button>
                              );
                            })()}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="identity" className="mt-6">
          <div className="space-y-6 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-2 border-b border-muted pb-4">
              <Shield className="h-5 w-5 text-orange-500 animate-pulse" />
              <h3 className="text-lg font-bold text-foreground">KYC Creator Attestation</h3>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Submit your identity details and verification documents below to have the administrator verify and attest your address.
            </p>

            <div className="flex flex-col gap-2 mt-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Creator Public Key Address (Read-Only Wallet)</label>
              <input
                type="text"
                value={freighterWalletAddress || ""}
                readOnly
                placeholder="Freighter wallet not connected"
                className="w-full rounded-lg border border-muted bg-background/30 text-muted-foreground px-4 py-2.5 text-sm font-mono cursor-not-allowed focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Full Name</label>
              <input
                type="text"
                value={kycFullName}
                onChange={(e) => setKycFullName(e.target.value)}
                disabled={kycRequestStatus === "pending" || kycRequestStatus === "approved"}
                placeholder="Juan Dela Cruz"
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Address</label>
              <input
                type="email"
                value={kycEmail}
                onChange={(e) => setKycEmail(e.target.value)}
                disabled={kycRequestStatus === "pending" || kycRequestStatus === "approved"}
                placeholder="juan.delacruz@example.com"
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Government-Issued ID Type</label>
              <select
                value={kycDocumentType}
                onChange={(e) => setKycDocumentType(e.target.value)}
                disabled={kycRequestStatus === "pending" || kycRequestStatus === "approved"}
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              >
                <option value="Passport">Passport</option>
                <option value="PhilID">Philippine Identification (PhilID / ePhilID)</option>
                <option value="Driver's License">Driver's License</option>
                <option value="SSS ID">SSS ID</option>
                <option value="UMID">UMID (Unified Multi-Purpose ID)</option>
                <option value="Other Government ID">Other Government-Issued ID</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">ID Document Verification Image</label>
              {kycRequestStatus !== "pending" && kycRequestStatus !== "approved" ? (
                <div className="flex items-center gap-4">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleKycImageUpload}
                    disabled={kycUploading}
                    className="text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 file:cursor-pointer cursor-pointer transition"
                  />
                  {kycUploading && (
                    <div className="flex items-center gap-1.5 text-orange-500 text-xs font-semibold animate-pulse">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading to IPFS...
                    </div>
                  )}
                </div>
              ) : null}

              {kycDocumentImage && (
                <div className="mt-2 flex items-start gap-3">
                  <div className="relative h-24 w-36 overflow-hidden rounded-lg border border-muted bg-background/30">
                    <img
                      src={getIPFSGatewayUrl(kycDocumentImage)}
                      alt="ID Upload Preview"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground/90">Uploaded Image IPFS Gateway Link</span>
                    <a
                      href={getIPFSGatewayUrl(kycDocumentImage)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-emerald-500 hover:text-emerald-400 transition truncate max-w-[200px]"
                    >
                      {kycDocumentImage.slice(0, 10)}...{kycDocumentImage.slice(-10)}
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Status Indicator */}
            {kycRequestStatus !== "none" && (
              <div className="mt-2 rounded-xl text-xs flex items-center gap-2 border border-muted leading-normal">
                {kycRequestStatus === "pending" && (
                  <div className="flex items-center gap-2 text-amber-500 bg-amber-500/10 border border-amber-500/20 w-full p-2.5 rounded-lg">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>KYC Request submitted and pending administrator on-chain approval.</span>
                  </div>
                )}
                {kycRequestStatus === "approved" && (
                  <div className="flex items-center gap-2 text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 w-full p-2.5 rounded-lg">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>KYC Request approved and attested! You are authorized to deploy projects.</span>
                  </div>
                )}
                {kycRequestStatus === "rejected" && (
                  <div className="flex items-center gap-2 text-rose-500 bg-rose-500/10 border border-rose-500/20 w-full p-2.5 rounded-lg">
                    <AlertCircle className="h-4 w-4" />
                    <span>KYC Request rejected. You can update details and submit a new request.</span>
                  </div>
                )}
              </div>
            )}

            {(kycRequestStatus === "none" || kycRequestStatus === "rejected") && (
              <button
                onClick={handleAttestCreator}
                disabled={loading || kycUploading || !freighterWalletAddress}
                className="mt-4 rounded-lg bg-primary hover:bg-primary/90 px-4 py-3 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 transition w-full"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit KYC Attestation Request
              </button>
            )}
          </div>
        </TabsContent>

        <TabsContent value="deploy" className="mt-6">
          <div className="space-y-6 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-1 border-b border-muted pb-4">
              <FileCode className="h-5 w-5 text-orange-500 animate-pulse" />
              <h3 className="text-lg font-bold text-foreground">Deploy Project Vault</h3>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Submit initialization parameters to the Factory contract to deploy a customized vault instance.
            </p>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project Title</label>
              <input
                type="text"
                value={deployTitle}
                onChange={(e) => setDeployTitle(e.target.value)}
                placeholder="Enter project title"
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tagline</label>
              <input
                type="text"
                value={deployTagline}
                onChange={(e) => setDeployTagline(e.target.value)}
                placeholder="Enter project tagline"
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</label>
              <textarea
                value={deployDescription}
                onChange={(e) => setDeployDescription(e.target.value)}
                placeholder="Enter project description"
                rows={3}
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</label>
                <select
                  value={deployCategory}
                  onChange={(e) => setDeployCategory(e.target.value)}
                  className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition cursor-pointer"
                >
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Funding Deadline</label>
                <input
                  type="datetime-local"
                  value={deployDeadlineInput}
                  onChange={(e) => setDeployDeadlineInput(e.target.value)}
                  min={msToDatetimeLocal(Date.now() + 24 * 60 * 60 * 1000)}
                  className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition cursor-pointer"
                />
              </div>
            </div>

            <div className="flex flex-col gap-4 border border-muted bg-muted/20 p-4 rounded-xl mt-1">
              <div className="flex justify-between items-center">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">Milestone Gating</span>
                  <span className="text-[11px] text-muted-foreground font-medium">Specify milestones and absolute USDC tranches. The total raise is computed automatically.</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newId = deployMilestones.length > 0 ? Math.max(...deployMilestones.map(m => m.id)) + 1 : 1;
                    setDeployMilestones([...deployMilestones, { id: newId, amount: "0", title: "", description: "" }]);
                  }}
                  className="text-xs text-primary hover:text-primary-foreground hover:bg-primary transition font-semibold flex items-center gap-1 bg-primary/10 border border-primary/20 px-2.5 py-1.5 rounded-lg"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Milestone
                </button>
              </div>

              {deployMilestones.length > 0 && Number(deployGoal) > 0 && (
                <div className="flex flex-col gap-2 mt-1 bg-background/30 p-3 rounded-lg border border-muted/50">
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                    {deployMilestones.map((m, idx) => {
                      const amt = Number(m.amount) || 0;
                      if (amt <= 0) return null;
                      const percent = (amt / Number(deployGoal)) * 100;
                      const colors = [
                        "bg-emerald-500", "bg-indigo-500", "bg-purple-500",
                        "bg-blue-500", "bg-teal-500", "bg-cyan-500", "bg-amber-500"
                      ];
                      const bgClass = colors[idx % colors.length];
                      return (
                        <div
                          key={m.id}
                          style={{ width: `${percent}%` }}
                          className={`${bgClass} h-full transition-all duration-300`}
                          title={`Milestone ${m.id}: ${m.amount} USDC (${percent.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-semibold">Total Target Raise (Calculated Goal):</span>
                    <span className="font-bold font-mono text-emerald-500">
                      {deployGoal} USDC
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-4">
                {deployMilestones.map((m, index) => (
                  <div key={m.id} className="border border-muted bg-background/50 p-4 rounded-xl flex flex-col gap-3 transition">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-500 font-mono">Milestone #{m.id}</span>
                      {deployMilestones.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = deployMilestones.filter((_, idx) => idx !== index).map((mil, newIndex) => ({
                              ...mil,
                              id: newIndex + 1,
                            }));
                            setDeployMilestones(updated);
                          }}
                          className="text-muted-foreground hover:text-rose-500 transition"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Milestone Title</label>
                        <input
                          type="text"
                          value={m.title}
                          onChange={(e) => {
                            const updated = [...deployMilestones];
                            updated[index].title = e.target.value;
                            setDeployMilestones(updated);
                          }}
                          placeholder="e.g. Smart Contract Audit"
                          className="w-full rounded-lg border border-muted bg-background/50 px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none transition"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">USDC Amount</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            value={m.amount}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val.startsWith("-") || Number(val) < 0) {
                                return;
                              }
                              const updated = [...deployMilestones];
                              updated[index].amount = val;
                              setDeployMilestones(updated);
                            }}
                            placeholder="e.g. 5"
                            className="w-full rounded-lg border border-muted bg-background/50 px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none transition font-mono flex-grow"
                          />
                          <span className="text-xs text-muted-foreground font-mono">USDC</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Description of Deliverables</label>
                      <textarea
                        value={m.description}
                        onChange={(e) => {
                          const updated = [...deployMilestones];
                          updated[index].description = e.target.value;
                          setDeployMilestones(updated);
                        }}
                        placeholder="e.g. Complete third-party verification and deploy contracts to mainnet"
                        rows={2}
                        className="w-full rounded-lg border border-muted bg-background/50 px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none transition resize-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Performance Bond (USDC)</label>
              <input
                type="number"
                value={deployBond}
                onChange={(e) => setDeployBond(e.target.value)}
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition"
              />
              <p className="text-[11px] text-muted-foreground leading-normal">
                Minimum required bond ({(bondPct * 100).toFixed(2)}%): <span className="font-semibold text-foreground font-mono">{minBondRequired.toFixed(2)} USDC</span>. Recommended ({(Math.max(0.10, bondPct * 2) * 100).toFixed(2)}%): <span className="font-semibold text-foreground font-mono">{recommendedBond.toFixed(2)} USDC</span>.
              </p>
              {Number(deployBond) < minBondRequired && (
                <p className="text-[11px] text-rose-500 font-semibold flex items-center gap-1.5 mt-0.5 animate-pulse">
                  <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                  Bond amount is too low. It must be at least {minBondRequired.toFixed(2)} USDC.
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-dashed border-muted bg-muted/10 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-foreground">Project Cover Image</p>
                  <p className="text-xs text-muted-foreground">
                    Select an image file. It will be uploaded automatically to IPFS when you deploy.
                  </p>
                </div>
                {deployImageFile && (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-500 border border-emerald-500/20">
                    Image Selected
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input
                  id="vault-deploy-project-image"
                  type="file"
                  accept="image/*"
                  className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-foreground file:font-semibold hover:file:opacity-90 cursor-pointer border border-muted rounded-lg"
                  disabled={loading}
                  onChange={handleDeployImageChange}
                />
              </div>

              {deployImageName && (
                <p className="text-xs text-muted-foreground">Selected file: {deployImageName}</p>
              )}

              {deployImagePreview && (
                <div className="overflow-hidden rounded-lg border border-muted bg-background/30">
                  <div className="relative aspect-[16/9] w-full max-h-[200px] flex items-center justify-center overflow-hidden">
                    <img
                      src={deployImagePreview}
                      alt="Project image preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>

            {deployedVaultAddress && (
              <div className="mt-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-emerald-500 uppercase font-semibold">Active Vault deployed</span>
                  <span className="text-xs font-mono text-emerald-400">{deployedVaultAddress}</span>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(deployedVaultAddress)}
                  className="p-1 text-emerald-500 hover:text-emerald-400 transition"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            )}

            <button
              onClick={handleDeployProject}
              disabled={loading || isDeployImageUploading}
              className="mt-2 rounded-lg bg-primary hover:bg-primary/90 px-4 py-3 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 transition w-full"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Deploy Vault Instance
            </button>
          </div>
        </TabsContent>

        <TabsContent value="interact" className="mt-6">
          <div className="space-y-6 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-muted pb-4">
              <div className="flex items-center gap-2.5">
                <Activity className="h-5 w-5 text-orange-500 animate-pulse" />
                <h3 className="text-lg font-bold text-foreground">Fund Project Vault</h3>
              </div>
              {vaultAddressToInteract && (
                <button
                  onClick={() => handleQueryStatus(false)}
                  disabled={loading}
                  className="p-1 text-muted-foreground hover:text-foreground transition"
                  title="Refresh on-chain status"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select Project Vault</label>
              <select
                value={vaultAddressToInteract}
                onChange={(e) => {
                  setVaultAddressToInteract(e.target.value);
                  const selectedProjObj = projects.find(p => p.vaultAddress === e.target.value);
                  if (selectedProjObj) {
                    setProjectIdToApprove(selectedProjObj.id);
                  }
                }}
                className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition cursor-pointer"
              >
                <option value="">-- Choose Deployed Project --</option>
                {projects.map((proj) => {
                  const shortAddr = proj.vaultAddress ? `${proj.vaultAddress.slice(0, 6)}...${proj.vaultAddress.slice(-6)}` : "None";
                  const displayLabel = `${proj.title || `Project #${proj.id}`} (${shortAddr})`;
                  return (
                    <option key={proj.id} value={proj.vaultAddress}>
                      {displayLabel}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Vault State Display */}
            {vaultStateInfo && (
              <div className="p-4 bg-muted/20 rounded-xl border border-muted flex flex-col gap-2 text-xs">
                <div className="flex justify-between border-b border-muted/50 pb-1.5">
                  <span className="text-muted-foreground uppercase font-semibold">Vault State</span>
                  <span className="text-emerald-500 font-bold font-mono">
                    {vaultStateInfo.state ? vaultStateInfo.state.tag || JSON.stringify(vaultStateInfo.state) : "Unknown"}
                  </span>
                </div>
                {vaultStateInfo.info && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Raised:</span>
                      <span className="text-foreground font-mono">{(Number(vaultStateInfo.info.raised_amount) / 10000000).toFixed(2)} USDC</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Goal:</span>
                      <span className="text-foreground font-mono">{(Number(vaultStateInfo.info.goal) / 10000000).toFixed(2)} USDC</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Performance Bond:</span>
                      <span className="text-foreground font-mono">
                        {(Number(vaultStateInfo.info.bond_amount) / 10000000).toFixed(2)} USDC ({vaultStateInfo.info.bond_posted ? "Posted" : "Awaiting"})
                      </span>
                    </div>
                    {vaultStateInfo.backerBalance !== undefined && (
                      <div className="flex justify-between border-t border-muted/40 pt-1.5 mt-0.5">
                        <span className="text-muted-foreground font-semibold">Your Contributed Balance:</span>
                        <span className="text-emerald-500 font-bold font-mono">{(Number(vaultStateInfo.backerBalance) / 10000000).toFixed(2)} USDC</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Operations Grid */}
            <div className="grid grid-cols-1 gap-4 mt-2">
              <div className="border border-muted bg-muted/10 p-4 rounded-xl flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 mt-1">
                  {isBondPending && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-lg text-xs flex items-start gap-2.5 mb-2.5">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Fundraising Inactive:</span> The project creator must post the performance bond before this campaign can accept public contributions.
                      </div>
                    </div>
                  )}
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Contribution Amount (USDC)</label>
                  <input
                    type="number"
                    min="0"
                    value={contributionAmount}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith("-") || Number(val) < 0) {
                        return;
                      }
                      setContributionAmount(val);
                    }}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-muted bg-background/50 px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition font-mono"
                  />

                  {isExceedingGoal && (
                    <p className="text-xs text-rose-500 font-semibold mt-1.5 flex items-center gap-1 animate-pulse">
                      <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                      Amount exceeds the remaining campaign goal of {remainingGoal.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC.
                    </p>
                  )}

                  {contribVal > 0 && (
                    <div className="mt-4 rounded-xl bg-muted/30 border border-muted/50 p-4 text-sm space-y-3.5 shadow-sm">
                      <p className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                        Transaction Summary & Breakdown
                      </p>
                      <div className="space-y-2 text-sm text-foreground/90">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground font-medium">Project Contribution:</span>
                          <span className="font-bold text-foreground">
                            {contribVal.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
                          </span>
                        </div>
                        <div className="flex justify-between text-amber-500 font-semibold">
                          <span className="text-muted-foreground font-medium">Platform Fee - {(platformFeePercentage * 100).toFixed(1)}%:</span>
                          <span>
                            +{platformFee.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
                          </span>
                        </div>
                        <div className="flex justify-between text-emerald-500 font-bold border-t border-muted/50 pt-2 text-sm">
                          <span>Total Contribution:</span>
                          <span>
                            {totalWalletCharge.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
                          </span>
                        </div>
                        <div className="flex justify-between text-muted-foreground/80 font-semibold border-t border-muted/50 pt-2">
                          <span>Remaining Campaign Goal:</span>
                          <span className="text-foreground">
                            {remainingGoal.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-muted/50 flex flex-wrap gap-x-4 gap-y-1.5 justify-between text-xs items-center">
                        <div className="text-muted-foreground font-medium">
                          Available Balance:{" "}
                          <span className="font-bold text-foreground">
                            {usdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
                          </span>
                        </div>
                        <div className="flex gap-2">
                          {isExceedingGoal && (
                            <span className="text-rose-500 font-bold bg-rose-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border border-rose-500/10 animate-pulse">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                              Exceeds Remaining Goal
                            </span>
                          )}
                          {isBalanceSufficient ? (
                            <span className="text-emerald-500 font-bold bg-emerald-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border border-emerald-500/10">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                              Sufficient Balance
                            </span>
                          ) : (
                            <span className="text-rose-500 font-bold bg-rose-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border border-rose-500/10 animate-pulse">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                              Insufficient Balance
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleContribute}
                    disabled={loading || !vaultAddressToInteract || !freighterWalletAddress || contribVal <= 0 || !isBalanceSufficient || isExceedingGoal || isBondPending || status !== "raising" || (interactGoal > 0 && interactRaised >= interactGoal)}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-muted disabled:text-muted-foreground text-white font-bold rounded-lg py-2.5 text-xs transition mt-2 shadow-md disabled:opacity-50"
                  >
                    {loading ? "Processing..." : status !== "raising" ? `Project ${status.charAt(0).toUpperCase() + status.slice(1)}` : isBondPending ? "Bond Pending" : (interactGoal > 0 && interactRaised >= interactGoal) ? "Goal Reached" : "Fund"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <div className="space-y-6 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-muted pb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground font-headline flex items-center gap-2.5">
                  <Wallet className="h-5 w-5 text-orange-500" />
                  Account & Wallet Activity
                </h3>
                <p className="text-xs text-muted-foreground">
                  Monitor balances, sequence ID, and campaigns created by your connected wallet.
                </p>
              </div>
              <button
                className="flex items-center justify-center gap-1.5 rounded-lg border bg-background/50 hover:bg-background px-4 py-2 text-xs font-semibold shadow-sm transition disabled:opacity-50 text-foreground"
                onClick={() => refreshWalletActivity()}
                disabled={activityLoading}
              >
                {activityLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" />
                ) : (
                  <RotateCw className="h-3.5 w-3.5" />
                )}
                {activityLoading ? "Refreshing..." : "Refresh Activity"}
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 text-sm bg-muted/20 border border-muted/50 rounded-xl p-4">
              <div className="flex items-center gap-2.5">
                <div className="rounded-full bg-primary/10 p-2 text-primary flex-shrink-0">
                  <Wallet className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-muted-foreground text-xs block">
                    Connected Address
                  </span>
                  <span
                    className="font-mono text-xs text-foreground font-semibold break-all select-all animate-fade-in"
                    title={freighterWalletAddress ?? "not connected"}
                  >
                    {shortenAddress(freighterWalletAddress, 10, 10)}
                  </span>
                </div>
              </div>
              {accountSeq && (
                <div className="flex items-center gap-2.5">
                  <div className="rounded-full bg-primary/10 p-2 text-primary flex-shrink-0">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">
                      Stellar Sequence ID
                    </span>
                    <span className="font-mono text-xs text-foreground font-semibold bg-muted/60 rounded px-2 py-0.5">
                      {accountSeq}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {activityError && (
              <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-500 text-xs flex gap-2">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <div>
                  <strong className="block font-semibold">Wallet Activity Load Failed</strong>
                  <span>{activityError}</span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">
                Asset Balances
              </h3>
              {activityLoading ? (
                <div className="h-10 bg-muted/20 animate-pulse rounded-xl" />
              ) : balances.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No balances found or wallet not connected.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {balances.map((bal: any, idx: number) => {
                    const symbol = bal.asset_type === "native" ? "XLM" : bal.asset_code || "Unknown";
                    return (
                      <div key={idx} className="rounded-xl border border-muted bg-card/60 p-4 flex justify-between items-center text-xs">
                        <div>
                          <span className="text-muted-foreground block uppercase font-bold text-[9px] tracking-wider">{bal.asset_type === "native" ? "Native Asset" : "Token"}</span>
                          <span className="text-sm font-bold text-foreground">{symbol}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold font-mono text-foreground">{parseFloat(bal.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 })}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3 pt-4 border-t border-muted/80">
              <h3 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">
                My Deployed Projects
              </h3>
              {(() => {
                const myProjects = projects.filter(
                  (p) =>
                    p.creatorAddress === freighterWalletAddress ||
                    p.creator === freighterWalletAddress
                );
                if (myProjects.length === 0) {
                  return (
                    <p className="text-xs text-muted-foreground italic">
                      You have not deployed any projects on this wallet address yet.
                    </p>
                  );
                }
                return (
                  <div className="space-y-3">
                    {myProjects.map((proj) => (
                      <div key={proj.id} className="rounded-xl border border-muted bg-card/60 p-4 space-y-3 text-xs">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <h4 className="text-sm font-bold text-foreground">{proj.title}</h4>
                            <span className="font-mono text-[10px] text-muted-foreground block truncate max-w-xs sm:max-w-md">Vault: {proj.vaultAddress}</span>
                          </div>
                          <span className={`text-[10px] font-bold uppercase border px-2.5 py-0.5 rounded ${proj.status === "completed" || proj.status === "funded"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : proj.status === "raising"
                              ? "bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse"
                              : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                            }`}>
                            {proj.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-muted/10 p-3 rounded-lg border border-muted/50 text-[11px] font-mono">
                          <div>
                            <span className="text-muted-foreground text-[10px] block">Funding Goal</span>
                            <span className="text-foreground font-bold">{proj.fundingGoal.toLocaleString()} USDC</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-[10px] block">Total Raised</span>
                            <span className="text-foreground font-bold">{proj.currentFunding.toLocaleString()} USDC</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-[10px] block">Performance Bond</span>
                            <span className="text-foreground font-bold">{proj.bondAmount ? proj.bondAmount.toLocaleString() : "N/A"} USDC {proj.bondPosted ? "(Posted)" : "(Pending)"}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-[10px] block">Milestones</span>
                            <span className="text-foreground font-bold">
                              {proj.milestones ? `${proj.milestones.filter((m: any) => m.released).length} of ${proj.milestones.length} Released` : "N/A"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
