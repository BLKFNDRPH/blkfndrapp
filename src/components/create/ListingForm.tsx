"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "../ui/card";
import { runImproveListingQuality, getProjects, saveProjectMetadataCacheByVault } from "@/app/actions";
import { createNotification } from "@/actions/notifications-client";
import type { ImproveListingQualityOutput } from "@/ai/flows/improve-listing-quality";
import { AiAnalysisDialog } from "./AiAnalysisDialog";
import { Wand2, Globe, Lock, Calendar, Plus, Trash2, Shield } from "lucide-react";
import { getPinataClient, getIPFSGatewayUrl } from "@/lib/pinata-client";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { CurrencyType } from "@/packages/blkfndr_v2";
import { usePlatformInfo, useRefreshAfterTx } from "@/context/BlockchainContext";
import { Client as FactoryClient } from "@/packages/blkfndr_factory/src";
import { Client as IdentityClient } from "@/packages/blkfndr_identity/src";
import { signTransaction, signAuthEntry } from "@stellar/freighter-api";
import Link from "next/link";
import { CubeSpinner } from "../ui/CubeSpinner";
import { SubmitLoader } from "./SubmitLoader";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Combobox } from "../ui/combobox";
import { projectCategories } from "@/lib/categories";

const MIN_DEADLINE_MS = () => Date.now() + 24 * 60 * 60 * 1000;
const DEFAULT_DEADLINE_MS = () => Date.now() + 30 * 24 * 60 * 60 * 1000;

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
const IDENTITY_ID = process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID || "";
const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";
const USDC_ID = process.env.NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID || "";

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

const msToDatetimeLocal = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters long."),
  tagline: z
    .string()
    .min(10, "Tagline must be at least 10 characters long.")
    .max(100, "Tagline must be less than 100 characters."),
  description: z
    .string()
    .min(50, "Description must be at least 50 characters long."),
  category: z.string().min(1, "Category is required."),
  fundingGoal: z.coerce.number().min(1, "Funding goal must be at least 1."),
  currencyType: z.enum(["XLM", "USDC", "USDT", "WBTC", "WETH"], {
    required_error: "Currency type is required.",
  }),
  fundingDeadline: z.coerce
    .number()
    .min(MIN_DEADLINE_MS(), "Deadline must be at least 1 day in the future."),
  image: z
    .any()
    .refine(
      (files) =>
        typeof window === "undefined" ||
        (files instanceof FileList && files.length > 0),
      "Project image is required.",
    ),
});

type FormSchema = z.infer<typeof formSchema>;

const CURRENCY_LABELS: Record<string, string> = {
  XLM: "XLM",
  USDC: "USDC",
  USDT: "USDT",
  WBTC: "WBTC",
  WETH: "WETH",
};

export function ListingForm() {
  const { toast } = useToast();
  const router = useRouter();
  const { user, login, refreshUser } = useAuth();
  const { createProject } = useStellarContract();
  const { freighterWalletAddress, login: connectFreighter } = useFreighterWallet();
  const refreshAfterTx = useRefreshAfterTx();

  const [isAiPending, startAiTransition] = useTransition();
  const [isSubmitPending, startSubmitTransition] = useTransition();
  const [imageDataUri, setImageDataUri] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<ImproveListingQualityOutput | null>(null);
  const [isAiDialogOpen, setAiDialogOpen] = useState(false);
  const [deadlineInputValue, setDeadlineInputValue] = useState<string>(
    msToDatetimeLocal(DEFAULT_DEADLINE_MS()),
  );
  const [isCooldown, setIsCooldown] = useState(false);
  const [isConnectingFreighter, setIsConnectingFreighter] = useState(false);
  const isSubmittingRef = useRef(false);

  const handleConnectFreighter = async (): Promise<string | null> => {
    setIsConnectingFreighter(true);
    try {
      const address = await connectFreighter();
      await refreshUser();
      toast({
        title: "Wallet Connected",
        description: "Freighter wallet successfully connected and verified.",
      });
      return address || null;
    } catch (err: any) {
      console.error("[ListingForm] Freighter connection failed:", err);
      toast({
        title: "Connection Failed",
        description: err.message || "Failed to connect Freighter wallet.",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsConnectingFreighter(false);
    }
  };

  const form = useForm<FormSchema>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      tagline: "",
      description: "",
      category: "Blockchain",
      fundingGoal: 100,
      currencyType: "USDC",
      fundingDeadline: DEFAULT_DEADLINE_MS(),
      image: undefined,
    },
  });

  const [milestones, setMilestones] = useState([
    { id: 1, title: "", description: "", amount: 0 },
  ]);
  const [performanceBond, setPerformanceBond] = useState<number | string>(0);

  const { platformInfo } = usePlatformInfo();
  const bondPct = platformInfo?.bondPercentage !== undefined ? platformInfo.bondPercentage / 10000 : 0.05;

  const projectTitle = form.watch("title") || "Project";
  const milestoneSum = milestones.reduce((sum, m) => sum + Number(m.amount), 0);
  const minBondRequired = milestoneSum * bondPct;
  const recommendedBond = milestoneSum * Math.max(0.10, bondPct * 2);
  const isBondManuallyEdited = useRef(false);

  // Compute numeric value of performanceBond
  const numericBond = typeof performanceBond === "number" ? performanceBond : (parseFloat(performanceBond) || 0);

  useEffect(() => {
    form.setValue("fundingGoal", milestoneSum, { shouldValidate: true });
    setPerformanceBond(Math.round(milestoneSum * Math.max(0.10, bondPct * 2) * 100) / 100);
    isBondManuallyEdited.current = false;
  }, [milestoneSum, milestones.length, bondPct]);

  const handleAddMilestone = () => {
    setMilestones((prev) => {
      const nextId = prev.length > 0 ? Math.max(...prev.map((m) => m.id)) + 1 : 1;
      return [
        ...prev,
        {
          id: nextId,
          title: "",
          description: "",
          amount: 0,
        },
      ];
    });
  };

  const handleRemoveMilestone = (id: number) => {
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  };

  const handleUpdateMilestone = (id: number, field: string, value: any) => {
    setMilestones((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  };

  const isBondValid = numericBond >= minBondRequired;

  const selectedCurrency = form.watch("currencyType");

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageDataUri(reader.result as string);
      };
      reader.readAsDataURL(file);
      form.setValue("image", event.target.files!);
    }
  };

  const handleDeadlineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDeadlineInputValue(val);
    const ms = new Date(val).getTime();
    if (!isNaN(ms)) {
      form.setValue("fundingDeadline", ms, { shouldValidate: true });
    }
  };

  const onAiAnalyze = async () => {
    const values = form.getValues();
    if (!imageDataUri) {
      toast({
        title: "Image Required",
        description: "Please provide an image for your project before analyzing.",
        variant: "destructive",
      });
      return;
    }
    startAiTransition(async () => {
      const result = await runImproveListingQuality({
        title: values.title,
        description: values.description,
        category: values.category,
        fundingGoal: values.fundingGoal,
        imageUrl: imageDataUri,
      });
      if (result) {
        setAiResult(result);
        setAiDialogOpen(true);
      } else {
        toast({
          title: "AI Analysis Failed",
          description: "Could not get suggestions. Please try again.",
          variant: "destructive",
        });
      }
    });
  };

  const handleOnChainSubmit = (values: FormSchema, verifiedAddress?: string) => {
    if (isSubmittingRef.current) return;

    const activeAddress = verifiedAddress || freighterWalletAddress;
    if (!activeAddress) {
      toast({
        title: "Wallet Not Connected",
        description: "Please connect your Freighter wallet to launch a campaign.",
        variant: "destructive",
      });
      return;
    }



    if (!isBondValid) {
      toast({
        title: "Insufficient Performance Bond",
        description: `The performance bond must be at least ${(bondPct * 100).toFixed(2)}% of the campaign goal (${minBondRequired.toFixed(2)} USDC).`,
        variant: "destructive",
      });
      return;
    }

    if (isCooldown) {
      toast({
        title: "Please wait",
        description: "You can only upload one image every 5 seconds.",
        variant: "destructive",
      });
      return;
    }

    isSubmittingRef.current = true;
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 5000);

    startSubmitTransition(async () => {
      // 1. KYC validation check
      try {
        const identityClient = new IdentityClient({
          contractId: IDENTITY_ID,
          rpcUrl: SOROBAN_RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          publicKey: process.env.NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS || "",
        });
        const tx = await identityClient.is_kyc_approved({ address: activeAddress });
        const result = await tx.simulate();
        if (!result.result) {
          toast({
            title: "Identity Verification Required",
            description: "You must complete Identity Verification on your profile page before you can deploy a project vault.",
            variant: "destructive",
          });
          isSubmittingRef.current = false;
          router.push("/profile/kyc-attestation");
          return;
        }
      } catch (err: any) {
        console.error("[ListingForm] KYC verification check failed:", err);
        toast({
          title: "Identity Verification Check Failed",
          description: "Could not query on-chain identity registry. Please try again.",
          variant: "destructive",
        });
        isSubmittingRef.current = false;
        return;
      }

      // 2. Upload file & metadata to Pinata
      try {
        const fileList = values.image as FileList;
        if (!fileList || fileList.length === 0) {
          toast({ title: "Please select an image.", variant: "destructive" });
          isSubmittingRef.current = false;
          return;
        }
        const file = fileList[0];

        let blobId: string;
        try {
          const pinata = getPinataClient();
          blobId = await pinata.uploadFile(file);
        } catch (error: any) {
          console.error("Pinata upload failed:", error);
          toast({
            title: "Image Upload Failed",
            description: error.message || "Unknown error",
            variant: "destructive",
          });
          isSubmittingRef.current = false;
          return;
        }

        const goalStroops = BigInt(Math.floor(values.fundingGoal * 10_000_000));
        const bondStroops = BigInt(Math.floor(numericBond * 10_000_000));
        const deadlineTimestamp = BigInt(Math.floor(values.fundingDeadline / 1000));

        const formattedMilestones = milestones.map((m, idx) => {
          let amount: bigint;
          if (idx === milestones.length - 1) {
            const previousSum = milestones.slice(0, idx).reduce((sum, item) => sum + BigInt(Math.floor(item.amount * 10_000_000)), BigInt(0));
            amount = goalStroops - previousSum;
          } else {
            amount = BigInt(Math.floor(m.amount * 10_000_000));
          }
          return {
            id: m.id,
            amount,
            released: false,
          };
        });

        // Upload metadata JSON to IPFS via Pinata
        const metadata = {
          title: values.title,
          tagline: values.tagline,
          description: values.description,
          category: values.category,
          imageUrl: getIPFSGatewayUrl(blobId),
          creator: activeAddress,
          fundingDeadline: values.fundingDeadline,
          fundingGoal: values.fundingGoal,
          fundingGoalRaw: goalStroops.toString(),
          currencyType: "USDC",
          bondAmount: numericBond,
          milestones: milestones.map((m, idx) => {
            let amount: number;
            if (idx === milestones.length - 1) {
              amount = values.fundingGoal - milestones.slice(0, idx).reduce((s, prev) => s + Number(prev.amount), 0);
            } else {
              amount = m.amount;
            }
            return {
              id: m.id,
              amount,
              title: m.title || `Milestone ${m.id}`,
              description: m.description || "",
            };
          }),
        };

        let metadataCid = "";
        try {
          const pinata = getPinataClient();
          const metadataFile = new File(
            [JSON.stringify(metadata, null, 2)],
            "metadata.json",
            { type: "application/json" }
          );
          metadataCid = await pinata.uploadFile(metadataFile);
        } catch (uploadErr: any) {
          console.error("Pinata metadata upload failed:", uploadErr);
          toast({
            title: "Metadata Upload Failed",
            description: "Failed to upload project specification details to IPFS.",
            variant: "destructive",
          });
          isSubmittingRef.current = false;
          return;
        }

        // 3. Submit transaction via Factory Client
        const factoryClient = new FactoryClient({
          contractId: FACTORY_ID,
          rpcUrl: SOROBAN_RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          publicKey: activeAddress,
          ...getSignerOptions(activeAddress),
        });

        const tx = await factoryClient.create_vault({
          config: {
            creator: activeAddress,
            token: USDC_ID,
            goal: goalStroops,
            deadline: deadlineTimestamp,
            bond_amount: bondStroops,
            approval_module: APPROVAL_ID,
            identity_registry: IDENTITY_ID,
            milestones: formattedMilestones,
            metadata_cid: metadataCid,
          },
        });

        const response = await tx.signAndSend();
        const vaultAddr = response.result;

        if (!vaultAddr) {
          throw new Error("Factory transaction completed but did not return a vault address.");
        }

        toast({
          title: "Vault Deployed Successfully!",
          description: `Spawned funding vault at ${vaultAddr.slice(0, 6)}...${vaultAddr.slice(-4)} on-chain.`,
        });

        const txHash = response.sendTransactionResponse?.hash;
        const txUrl = txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : null;

        // Cache metadata in MongoDB ProjectCache collection
        try {
          const cacheResult = await saveProjectMetadataCacheByVault(vaultAddr, {
            ...metadata,
            metadataCid,
          });
          if (!cacheResult.success) {
            console.error("MongoDB caching failed:", cacheResult.error);
          }
        } catch (dbErr) {
          console.error("Database connection caching error:", dbErr);
        }

        if (user) {
          await createNotification(
            user.uid,
            "Project Created",
            `Your new project "${values.title}" has been created with a custom vault on-chain.`,
            txUrl,
            vaultAddr,
          );
        }

        refreshAfterTx(activeAddress);
        router.push("/projects");
      } catch (error: any) {
        console.error("Vault deployment failed:", error);
        toast({
          title: "Vault Deployment Failed",
          description: error.message || "Failed to submit transaction to the factory.",
          variant: "destructive",
        });
      } finally {
        isSubmittingRef.current = false;
      }
    });
  };

  async function onSubmit(values: FormSchema) {
    if (!user) {
      toast({
        title: "Please log in to create a project.",
        description: "You'll be redirected to log in.",
        variant: "destructive",
      });
      login();
      return;
    }

    let activeAddress = freighterWalletAddress;
    if (!activeAddress) {
      toast({
        title: "Wallet Connection Required",
        description: "Connecting and verifying Freighter wallet...",
      });
      const connectedAddress = await handleConnectFreighter();
      if (!connectedAddress) return;
      activeAddress = connectedAddress;
    }

    handleOnChainSubmit(values, activeAddress);
  }

  return (
    <>
      <Card>
        <CardContent className="pt-6 relative">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., My Awesome Stellar Project" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tagline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tagline</FormLabel>
                    <FormControl>
                      <Input placeholder="A short, catchy phrase for your project" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe your project in detail..."
                        {...field}
                        rows={6}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Category</FormLabel>
                    <Combobox
                      options={projectCategories.map((cat) => ({ value: cat, label: cat }))}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Select category..."
                      searchPlaceholder="Search category..."
                      notFoundText="No category found."
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fundingDeadline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Funding Deadline
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        value={deadlineInputValue}
                        onChange={handleDeadlineChange}
                        min={msToDatetimeLocal(MIN_DEADLINE_MS())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Creator Performance Bond Input */}
              <div className="space-y-2 p-4 rounded-xl border border-border/80 bg-[#003049]/5 relative overflow-hidden transition-all duration-300">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    Creator Performance Bond
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    Min required: {minBondRequired.toFixed(2)} USDC ({(bondPct * 100).toFixed(2)}%)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      type="number"
                      step="any"
                      placeholder={`e.g. ${recommendedBond.toFixed(2)}`}
                      value={performanceBond}
                      onChange={(e) => {
                        isBondManuallyEdited.current = true;
                        setPerformanceBond(e.target.value);
                      }}
                      className="h-10 bg-background border-border/80 rounded-xl pr-16 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 text-sm font-semibold"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground select-none">
                      USDC
                    </div>
                  </div>
                </div>
                {!isBondManuallyEdited.current ? (
                  <p className="text-[10px] text-[#003049]/70 transition-all">

                  </p>
                ) : (
                  <div className="flex justify-between items-center text-[10px] transition-all">
                    <span className="text-amber-600 font-medium">

                    </span>

                  </div>
                )}
                {!isBondValid && (
                  <p className="text-[10px] text-red-500 font-medium">
                    Bond must be at least {(bondPct * 100).toFixed(2)}% of the campaign goal ({minBondRequired.toFixed(2)} USDC).
                  </p>
                )}
              </div>

              {/* Milestones List */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-semibold text-foreground">Project Milestones</label>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={handleAddMilestone}
                    className="h-9 bg-[#003049] hover:bg-[#003049]/90 text-white font-semibold flex items-center gap-1.5 shadow-sm rounded-xl px-4"
                  >
                    <Plus className="h-4 w-4" /> Add Milestone
                  </Button>
                </div>

                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {milestones.map((milestone, index) => (
                    <div key={milestone.id} className="border border-border/80 bg-card rounded-xl p-4 space-y-3 relative group">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-primary uppercase">
                          Milestone #{index + 1}
                        </span>
                        {milestones.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveMilestone(milestone.id)}
                            className="h-6 w-6 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2 space-y-1">
                          <Input
                            placeholder={`e.g. ${projectTitle} Phase ${index + 1}`}
                            value={milestone.title}
                            onChange={(e) => handleUpdateMilestone(milestone.id, "title", e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Input
                            type="number"
                            placeholder="Amount (USDC)"
                            value={milestone.amount || ""}
                            onChange={(e) => handleUpdateMilestone(milestone.id, "amount", parseFloat(e.target.value) || 0)}
                            required
                            step="any"
                          />
                        </div>
                      </div>

                      <Textarea
                        placeholder={`e.g. Deliverables for ${projectTitle} Phase ${index + 1}`}
                        value={milestone.description}
                        onChange={(e) => handleUpdateMilestone(milestone.id, "description", e.target.value)}
                        rows={2}
                        required
                      />
                    </div>
                  ))}
                </div>



                {/* Milestone Sum Validation Status */}
                <div className="flex justify-between items-center p-3 rounded-xl border bg-muted/40 text-xs">
                  <span className="font-medium">Total Milestone Allocation (Funding Goal):</span>
                  <span className="font-bold text-primary">
                    {milestoneSum.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                  </span>
                </div>
              </div>

              <FormField
                control={form.control}
                name="image"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Image</FormLabel>
                    <FormControl>
                      <Input type="file" accept="image/*" onChange={handleFileChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-col sm:flex-row justify-end gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onAiAnalyze}
                  disabled={isAiPending}
                  className="gap-2"
                >
                  {isAiPending ? (
                    <CubeSpinner size="small" />
                  ) : (
                    <Wand2 className="h-4 w-4 text-orange-500" />
                  )}
                  AI Suggestions
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitPending || isCooldown || isSubmittingRef.current || !isBondValid}
                >
                  {isSubmitPending ? <SubmitLoader /> : "Launch Campaign"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
      {aiResult && (
        <AiAnalysisDialog
          open={isAiDialogOpen}
          onOpenChange={setAiDialogOpen}
          result={aiResult}
        />
      )}
    </>
  );
}