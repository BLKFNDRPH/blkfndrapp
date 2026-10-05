"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
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
  useFormField,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CURRENCIES,
  availableCurrencies,
  tokenAddressFor,
  type Currency,
} from "@/lib/currencies";
import {
  bondAssetFor,
  checkBondReadiness,
  spendableXlm,
  tokenBalance,
  type BondAsset,
  type BondReadiness,
} from "@/lib/bond-readiness";
import { classifyLaunchFailure, technicalDetail } from "@/lib/launch-errors";
import { enableAsset } from "@/lib/enable-asset";
import {
  forgetLaunch,
  recalledLaunch,
  rememberLaunch,
  type InFlightLaunch,
} from "@/lib/launch-in-flight";
import { EXPLORER_BASE } from "@/lib/network";
import { rpc } from "@stellar/stellar-sdk";
import { BondBlockerDialog } from "./BondBlockerDialog";
import { LaunchBlockedDialog } from "./LaunchBlockedDialog";
import { LaunchReviewDialog, type LaunchReview } from "./LaunchReviewDialog";
import {
  findDeployedVault,
  resolveSubmittedLaunch,
  type SubmittedOutcome,
} from "@/lib/vault-deploy-guard";
import { factoryClient as factoryReader, simulate } from "@/lib/stellar-clients";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "../ui/card";
import { runImproveListingQuality } from "@/app/actions";
import type { ImproveListingQualityOutput } from "@/ai/flows/improve-listing-quality";
import { AiAnalysisDialog } from "./AiAnalysisDialog";
import { Wand2, Calendar, Plus, Trash2, Shield, MapPin } from "lucide-react";
import { getPinataClient, getIPFSGatewayUrl } from "@/lib/pinata-client";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { usePlatformInfo, useRefreshAfterTx } from "@/context/BlockchainContext";
import { Client as FactoryClient } from "@/packages/blkfndr_factory/src";
import { Client as IdentityClient } from "@/packages/blkfndr_identity/src";
import { CubeSpinner } from "../ui/CubeSpinner";
import { cn } from "@/lib/utils";
import { Combobox } from "../ui/combobox";
import { projectCategories } from "@/lib/categories";
import { getCategoriesAction } from "@/actions/categories";
import { freighterSigner, FreighterDeclined } from "@/lib/freighter-signer";
import { LISTING_LIMITS, charCount } from "@/lib/listing-limits";

const MIN_DEADLINE_MS = () => Date.now() + 24 * 60 * 60 * 1000;
/**
 * Thirty days out, on a whole minute. The date field shows minutes, so a
 * default carrying seconds and milliseconds was never quite what the builder
 * saw: both of QA's 1 Oct vaults went on-chain with deadlines like 10:57:09.307.
 */
const DEFAULT_DEADLINE_MS = () => {
  const ms = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return ms - (ms % 60_000);
};

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
const IDENTITY_ID = process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID || "";

// Signing goes through freighterSigner, which checks what the wallet actually
// returned. Passing Freighter's raw result to the SDK meant a dismissed popup
// surfaced as "Cannot read properties of undefined (reading 'switch')".
const getSignerOptions = (publicKey: string) => freighterSigner(publicKey);

const msToDatetimeLocal = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Within a limit from LISTING_LIMITS, counted as the database counts. zod's own
 * `.max()` counts UTF-16 units, so an emoji would use up two.
 */
const withinLimit = (max: number, label: string) =>
  [
    (value: string) => charCount(value) <= max,
    `${label} must be ${max.toLocaleString()} characters or fewer.`,
  ] as const;

// Trimmed first, so a title of nothing but spaces is empty rather than long
// enough, and what is pinned and counted is what a visitor will read.
const formSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Title must be at least 5 characters long.")
    .refine(...withinLimit(LISTING_LIMITS.title, "Title")),
  tagline: z
    .string()
    .trim()
    .min(10, "Tagline must be at least 10 characters long.")
    .refine(...withinLimit(LISTING_LIMITS.tagline, "Tagline")),
  description: z
    .string()
    .trim()
    .min(50, "Description must be at least 50 characters long.")
    .refine(...withinLimit(LISTING_LIMITS.description, "Description")),
  category: z.string().min(1, "Category is required."),
  // Required. These are real-world assets, and a listing that names no place
  // gives a backer nothing to verify against — location is frequently the most
  // material fact about the thing being funded.
  location: z
    .string()
    .trim()
    .min(3, "Location is required.")
    .refine(...withinLimit(LISTING_LIMITS.location, "Location")),
  fundingGoal: z.coerce.number().min(1, "Funding goal must be at least 1."),
  // Derived from CURRENCIES rather than restated. A hand-maintained copy drifts,
  // and the drift is silent: this list accepted three currencies that had no
  // token address configured and no code path that would have used one.
  currencyType: z.enum(CURRENCIES, {
    required_error: "Currency type is required.",
  }),
  // NaN when the date field is empty or half-typed: see handleDeadlineChange.
  // The minimum is read at validation time, not once when the module loads.
  fundingDeadline: z.coerce
    .number({ invalid_type_error: "Choose a funding deadline." })
    .refine((ms) => ms >= MIN_DEADLINE_MS(), "Deadline must be at least 1 day in the future."),
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

/**
 * "42 / 80" under a field, red with how many to cut once it is over.
 *
 * The field itself has no maxLength. A hard cap silently cuts off pasted text
 * mid-word, and the browser counts an emoji as two against it. Instead the
 * builder sees the whole paste, how far over it is, and a launch that stops
 * until it fits. It counts what will be saved: the text without the spaces
 * around it, which the checks trim too.
 */
function CharacterCount({ value, max, id }: { value: string; max: number; id?: string }) {
  const count = charCount(value.trim());
  const over = count - max;
  return (
    <p
      id={id}
      className={cn(
        "text-right text-xs tabular-nums text-muted-foreground",
        over > 0 && "font-medium text-destructive",
      )}
    >
      {count.toLocaleString()} / {max.toLocaleString()}
      {over > 0 && ` · ${over.toLocaleString()} too many`}
    </p>
  );
}

/**
 * A toast's body: one plain sentence, a link to the transaction when there is
 * one, and the network's own text folded underneath.
 *
 * For a refusal, the raw text used to be the whole message: "HostError:
 * Error(Contract, #10)", a SendFailed JSON dump, or a TypeError about reading
 * 'switch'. It is still there for whoever has to debug it, just not in the
 * builder's way.
 */
function ToastDetail({ message, detail, txUrl }: { message: string; detail?: string; txUrl?: string }) {
  return (
    <span className="block space-y-1.5">
      <span className="block">{message}</span>
      {txUrl && (
        <a href={txUrl} target="_blank" rel="noopener noreferrer" className="block underline">
          See the transaction
        </a>
      )}
      {detail && (
        <details className="text-xs opacity-80">
          <summary className="cursor-pointer">Technical details</summary>
          <span className="mt-1 block break-all font-mono">{detail}</span>
        </details>
      )}
    </span>
  );
}

/** A CharacterCount that is its form field's description, so the input announces it. */
function FieldCharacterCount({ value, max }: { value: string; max: number }) {
  const { formDescriptionId } = useFormField();
  return <CharacterCount id={formDescriptionId} value={value} max={max} />;
}

/**
 * Where a launch is.
 *
 * The button keeps one shape and one word while it is busy -- QA BUG-005 was a
 * launch button that reflowed -- so the stage is spelt out on a line beneath
 * it instead. The stage that matters most is "signing": Freighter's window
 * opens wherever the browser puts it and drops a request left open for about
 * five minutes, and QA Trial #3 found the page reporting failure while that
 * window still sat open. So the page says, while it waits, what it is waiting
 * on and for how long it can.
 */
type LaunchStage =
  | "idle"
  | "verifying"
  | "uploading"
  | "deduping"
  | "preparing"
  | "review"
  | "signing"
  | "submitting"
  | "confirming";

const LAUNCH_STATUS: Record<LaunchStage, string> = {
  idle: "",
  verifying: "Checking your identity verification and bond…",
  uploading: "Uploading the image and project details to IPFS…",
  deduping: "Making sure this project isn't already on-chain…",
  preparing: "Preparing the transaction and estimating its network fee…",
  review: "Review the launch, then sign in Freighter.",
  signing: "Waiting for you to approve in Freighter. Requests expire after about 5 minutes.",
  submitting: "Signed. Sending it to the network…",
  confirming: "Sent. Waiting for the network to confirm it — don't close this page.",
};

const CURRENCY_LABELS: Record<Currency, string> = {
  XLM: "XLM",
  USDC: "USDC",
};

export function ListingForm() {
  const { toast } = useToast();
  const router = useRouter();
  const { user, login, refreshUser } = useAuth();
  const { freighterWalletAddress, login: connectFreighter } = useFreighterWallet();
  const refreshAfterTx = useRefreshAfterTx();

  const [isAiPending, startAiTransition] = useTransition();
  const [isSubmitPending, startSubmitTransition] = useTransition();
  const [imageDataUri, setImageDataUri] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<ImproveListingQualityOutput | null>(null);
  const [isAiDialogOpen, setAiDialogOpen] = useState(false);

  // Set when the builder cannot post the bond. Holds the reason rather than a
  // boolean, because "you have never held USDC", "you hold too little" and
  // "this wallet was never funded" need different instructions.
  const [bondBlocker, setBondBlocker] = useState<BondReadiness | null>(null);
  // Read once, so the field and the form start from the same instant.
  const [initialDeadline] = useState(DEFAULT_DEADLINE_MS);
  const [deadlineInputValue, setDeadlineInputValue] = useState<string>(() =>
    msToDatetimeLocal(initialDeadline),
  );
  // The list is admin-editable, so it is fetched rather than compiled in.
  // projectCategories stays as the fallback: a builder should still be able to
  // file a listing if this request fails.
  const [categories, setCategories] = useState<string[]>(projectCategories);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isCooldown, setIsCooldown] = useState(false);
  const isSubmittingRef = useRef(false);

  const handleConnectFreighter = async (): Promise<string | null> => {
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
    }
  };

  const form = useForm<FormSchema>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      tagline: "",
      description: "",
      category: "Blockchain",
      location: "",
      fundingGoal: 100,
      currencyType: "USDC",
      fundingDeadline: initialDeadline,
      image: undefined,
    },
  });

  useEffect(() => {
    let cancelled = false;
    getCategoriesAction()
      .then((res) => {
        // Only replace the fallback on a non-empty list. An admin who has not
        // seeded the table yet should not be shown an empty dropdown.
        if (!cancelled && res.success && res.categories?.length) {
          setCategories(res.categories);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingCategories(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [milestones, setMilestones] = useState([
    { id: 1, title: "", description: "", amount: 0 },
  ]);
  const [performanceBond, setPerformanceBond] = useState<number | string>(0);

  /**
   * Problems with the milestone rows, keyed by milestone id.
   *
   * The rows are plain state rather than form fields, so react-hook-form knows
   * nothing about them and cannot show their errors. They carried the native
   * `required` attribute instead, which meant the browser refused the submit
   * before React ever saw it -- no submit event, so no toast, no validation
   * message, no request. Pressing Launch Campaign simply did nothing.
   */
  type MilestoneProblem = { title?: string; amount?: string; description?: string };
  const [milestoneErrors, setMilestoneErrors] = useState<Record<number, MilestoneProblem>>({});

  /**
   * Everything standing between the builder and a launch, for the dialog.
   *
   * A dialog rather than a toast, to match BondBlockerDialog: both answer the
   * same question -- why did pressing Launch Campaign not launch anything --
   * and a toast slides away while the builder is still reading the form.
   */
  const [launchProblems, setLaunchProblems] = useState<string[] | null>(null);

  const { platformInfo } = usePlatformInfo();
  const bondPct = platformInfo?.bondPercentage !== undefined ? platformInfo.bondPercentage / 10000 : 0.05;

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
    // Clear this field's complaint as it is addressed, rather than leaving the
    // row red until the next submit.
    setMilestoneErrors((prev) => {
      const key = field as keyof MilestoneProblem;
      if (!prev[id]?.[key]) return prev;
      const rest: MilestoneProblem = { ...prev[id] };
      delete rest[key];
      const next = { ...prev };
      if (Object.keys(rest).length === 0) delete next[id];
      else next[id] = rest;
      return next;
    });
  };

  /**
   * Check the milestone rows, mark the offending fields, and describe what is
   * wrong in words the dialog can list.
   *
   * An amount of zero is rejected here rather than only through the derived
   * funding goal, which has no control of its own and so had nowhere to show a
   * message of its own.
   */
  const collectMilestoneProblems = useCallback(() => {
    const byId: Record<number, MilestoneProblem> = {};
    const described: string[] = [];

    milestones.forEach((m, index) => {
      const problem: MilestoneProblem = {};
      const missing: string[] = [];

      if (!m.title.trim()) {
        problem.title = "Give this milestone a title.";
        missing.push("a title");
      }
      if (!(Number(m.amount) > 0)) {
        problem.amount = "Enter an amount greater than zero.";
        missing.push("an amount above zero");
      }
      if (!m.description.trim()) {
        problem.description = "Describe what this milestone delivers.";
        missing.push("a description");
      }

      if (missing.length > 0) {
        const list =
          missing.length === 1
            ? missing[0]
            : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
        described.push(`Milestone ${index + 1} needs ${list}.`);
      }

      const titleLength = charCount(m.title.trim());
      if (titleLength > LISTING_LIMITS.milestoneTitle) {
        problem.title = `Keep this title to ${LISTING_LIMITS.milestoneTitle} characters or fewer.`;
        described.push(
          `Milestone ${index + 1}'s title is ${titleLength.toLocaleString()} characters; the limit is ${LISTING_LIMITS.milestoneTitle}.`,
        );
      }
      const descriptionLength = charCount(m.description.trim());
      if (descriptionLength > LISTING_LIMITS.milestoneDescription) {
        problem.description = `Keep this description to ${LISTING_LIMITS.milestoneDescription} characters or fewer.`;
        described.push(
          `Milestone ${index + 1}'s description is ${descriptionLength.toLocaleString()} characters; the limit is ${LISTING_LIMITS.milestoneDescription}.`,
        );
      }

      if (Object.keys(problem).length > 0) byId[m.id] = problem;
    });

    setMilestoneErrors(byId);
    return described;
  }, [milestones]);

  const isBondValid = numericBond >= minBondRequired;

  const selectedCurrency = form.watch("currencyType");

  // The exact asset behind the chosen currency, asked of its token contract.
  // One wallet can hold several assets all called USDC (QA's test wallet had
  // three), and only the vault's own issuer counts.
  const [currencyAsset, setCurrencyAsset] = useState<BondAsset | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCurrencyAsset(null);
    let token: string | null = null;
    try {
      token = tokenAddressFor(selectedCurrency);
    } catch {
      return;
    }
    bondAssetFor(token).then((asset) => {
      if (!cancelled) setCurrencyAsset(asset);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCurrency]);

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

  /**
   * The date field and the value the launch submits, kept as one.
   *
   * An empty or half-typed date used to leave the form value alone, so the
   * field showed what the builder typed while the launch went out with
   * whatever was there before -- the 30-day default, in practice. Now an
   * unusable date clears the value and the launch stops on "Choose a funding
   * deadline" instead.
   */
  const handleDeadlineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDeadlineInputValue(val);
    const ms = val ? new Date(val).getTime() : NaN;
    form.setValue("fundingDeadline", ms, { shouldValidate: true });
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

  // ── Launching ─────────────────────────────────────────────────────────────

  const [launchStage, setLaunchStage] = useState<LaunchStage>("idle");
  const [launchReview, setLaunchReview] = useState<LaunchReview | null>(null);
  const reviewDecisionRef = useRef<((approved: boolean) => void) | null>(null);

  /**
   * This draft's uploads, kept for a retry.
   *
   * Pinata pins by content, so uploading the same image and metadata again
   * would return the same CIDs anyway; keeping them skips the wait and the
   * upload cooldown. The metadata CID is also what the duplicate check matches
   * an earlier vault on.
   */
  const uploadCacheRef = useRef<{
    imageKey?: string;
    imageCid?: string;
    metadataJson?: string;
    metadataCid?: string;
  }>({});

  /** Open the review dialog and wait for the builder's answer. */
  const askForReview = (review: LaunchReview) =>
    new Promise<boolean>((resolve) => {
      reviewDecisionRef.current = resolve;
      setLaunchReview(review);
    });

  const decideReview = (approved: boolean) => {
    const resolve = reviewDecisionRef.current;
    reviewDecisionRef.current = null;
    setLaunchReview(null);
    resolve?.(approved);
  };

  const announceLaunched = (vaultAddr: string, activeAddress: string) => {
    forgetLaunch();
    toast({
      title: "Vault Deployed Successfully!",
      description: `Spawned funding vault at ${vaultAddr.slice(0, 6)}...${vaultAddr.slice(-4)} on-chain.`,
    });

    // Nothing is written to the database here. The indexer picks the
    // project up from the FACTORY/DEPLOY event and resolves this metadata
    // from IPFS — letting the browser write it would mean the client
    // deciding what a listing says about an on-chain project.
    refreshAfterTx(activeAddress);
    router.push("/projects");
  };

  // ── A launch from before a reload ─────────────────────────────────────────

  /** The title of a remembered launch being checked; Launch waits for it. */
  const [priorLaunchTitle, setPriorLaunchTitle] = useState<string | null>(null);

  /**
   * Say what became of a remembered launch, and forget it once the answer is
   * final. Returns whether a new launch may go ahead.
   */
  const settlePriorLaunch = (prior: InFlightLaunch, outcome: SubmittedOutcome): boolean => {
    const txUrl = `${EXPLORER_BASE}/tx/${prior.hash}`;
    const name = `“${prior.title}”`;
    switch (outcome.status) {
      case "SUCCESS":
        forgetLaunch(prior.hash);
        toast({
          title: "Your last launch went through",
          description: (
            <ToastDetail
              message={`${name} is on-chain. Its listing appears once the platform has read it, usually within a minute.`}
              txUrl={txUrl}
            />
          ),
        });
        refreshAfterTx(prior.creator);
        return false;
      case "FAILED":
        forgetLaunch(prior.hash);
        toast({
          title: "Your last launch didn't go through",
          description: (
            <ToastDetail
              message={`The network refused ${name}, so no vault was created and no bond was taken; only the network fee was charged.`}
              txUrl={txUrl}
            />
          ),
          variant: "destructive",
        });
        return true;
      case "EXPIRED":
        forgetLaunch(prior.hash);
        toast({
          title: "Your last launch was never applied",
          description: `${name} expired before the network took it, so no vault was created and nothing was charged. You can launch again.`,
        });
        return true;
      default:
        toast({
          title: "Your last launch isn't confirmed yet",
          description: (
            <ToastDetail
              message={`The network couldn't be reached to confirm ${name}. Check the transaction before launching again, so you don't create a second vault.`}
              txUrl={txUrl}
            />
          ),
          variant: "destructive",
        });
        return false;
    }
  };

  // On arrival, settle a launch a reload or a closed tab left unconfirmed.
  useEffect(() => {
    const prior = recalledLaunch();
    if (!prior) return;
    let cancelled = false;
    setPriorLaunchTitle(prior.title);
    resolveSubmittedLaunch(prior.hash, prior.expiresAtMs)
      .then((outcome) => {
        if (!cancelled) settlePriorLaunch(prior, outcome);
      })
      .finally(() => {
        if (!cancelled) setPriorLaunchTitle(null);
      });
    return () => {
      cancelled = true;
    };
    // Once, on arrival; settlePriorLaunch only reads stable helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a launch is in Freighter's hands or the network's, leaving would
  // drop the page's only record of it. The browser asks first.
  useEffect(() => {
    if (launchStage !== "signing" && launchStage !== "submitting" && launchStage !== "confirming") {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [launchStage]);

  /**
   * Ask Freighter to add the vault's asset, from the bond dialog. Throws the
   * message to show in the dialog if it doesn't happen.
   */
  const handleEnableAsset = async (asset: BondAsset) => {
    if (!freighterWalletAddress) throw new Error("Connect your wallet first.");
    await enableAsset(freighterWalletAddress, asset);
    setBondBlocker(null);
    toast({
      title: `${asset.code} added to your wallet`,
      description: "Press Launch Campaign again to continue.",
    });
  };

  const handleOnChainSubmit =(values: FormSchema, verifiedAddress?: string) => {
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
        description: `The performance bond must be at least ${(bondPct * 100).toFixed(2)}% of the campaign goal (${minBondRequired.toFixed(2)} ${selectedCurrency}).`,
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
      try {
        await launch(values, activeAddress);
      } finally {
        // Every way out -- launched, refused, cancelled, failed -- ends here,
        // so the page can never be left saying it is waiting on Freighter.
        isSubmittingRef.current = false;
        setLaunchStage("idle");
      }
    });
  };

  /**
   * One launch, in order: identity, bond, uploads, the duplicate check,
   * simulation, the builder's review, Freighter, the network.
   */
  const launch = async (values: FormSchema, activeAddress: string) => {
    // 0. A launch this wallet sent before a reload, still unaccounted for.
    // Until the network says it failed or expired, another one could be a
    // second vault and a second bond -- and the duplicate check below cannot
    // see it, because a reloaded form pins different metadata.
    const prior = recalledLaunch();
    if (prior && prior.creator === activeAddress) {
      setLaunchStage("deduping");
      const outcome = await resolveSubmittedLaunch(prior.hash, prior.expiresAtMs);
      if (!settlePriorLaunch(prior, outcome)) return;
    }

    // 1. KYC validation check
    setLaunchStage("verifying");
    try {
      const identityClient = new IdentityClient({
        contractId: IDENTITY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        // No publicKey. This is a read-only simulation, and the SDK resolves
        // the source as `options.publicKey ? getAccount(publicKey) :
        // NULL_ACCOUNT` — so omitting it uses the null account and never
        // touches the network for an account lookup. src/lib/vault-state.ts
        // already does this.
        //
        // It used to pass NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS, which is
        // FILL_ME on this deployment. That is truthy but not a strkey, so it
        // reached getAccount and threw "invalid encoded string", and the
        // catch below reported a registry failure that never happened.
        //
        // Passing the connected wallet instead would fix that case and break
        // another: getAccount throws "Account not found" for a wallet that
        // has never been created on the ledger, which is exactly the person
        // about to start verification with a fresh Freighter account.
      });
      const tx = await identityClient.is_kyc_approved({ address: activeAddress });
      const result = await tx.simulate();
      if (!result.result) {
        toast({
          title: "Identity Verification Required",
          description: "You must complete Identity Verification on your profile page before you can deploy a project vault.",
          variant: "destructive",
        });
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
      return;
    }

    // The vault is fixed to this token for its whole life, so it must be the
    // currency the builder actually chose. tokenAddressFor throws on a
    // currency this deployment has no token for, rather than handing
    // create_vault an empty string.
    const tokenAddress = (() => {
      try {
        return tokenAddressFor(values.currencyType);
      } catch {
        return null;
      }
    })();
    if (!tokenAddress) {
      toast({
        title: `${values.currencyType} isn't available`,
        description: "This currency isn't set up on the platform right now. Choose another one.",
        variant: "destructive",
      });
      return;
    }
    // The flat listing fee leaves the wallet in the same call as the bond, in
    // the same asset, so the pre-flight and the review both need it.
    const platformFeeStroops = await simulate(() => factoryReader().get_platform_fee(), "get_platform_fee");
    const platformFee = Number(platformFeeStroops ?? platformInfo?.platformFeeStroops ?? 0) / 10_000_000;

    // 2. Bond pre-flight.
    //
    // The vault pulls the bond and the listing fee in the same call that
    // creates it, so a builder who cannot part with both has no vault. Until
    // now they found that out from a raw host diagnostic after signing, with
    // nothing to act on. Runs before the uploads below so a blocked builder
    // does not pin files they cannot use, and fails open: a check that cannot
    // reach the network must not be the thing standing between a builder and a
    // vault they can deploy. The simulation further down refuses an
    // uncoverable launch anyway, and that refusal gets the same dialog.
    try {
      const readiness = await checkBondReadiness(activeAddress, tokenAddress, numericBond, platformFee);
      if (!readiness.ok) {
        setBondBlocker(readiness);
        return;
      }
    } catch (preflightError) {
      console.warn("[ListingForm] bond pre-flight skipped:", preflightError);
    }

    // 3. Upload file & metadata to Pinata, reusing this draft's earlier uploads.
    const fileList = values.image as FileList;
    if (!fileList || fileList.length === 0) {
      toast({ title: "Please select an image.", variant: "destructive" });
      return;
    }
    const file = fileList[0];

    setLaunchStage("uploading");
    const imageKey = `${file.name}:${file.size}:${file.lastModified}`;
    let blobId =
      uploadCacheRef.current.imageKey === imageKey ? uploadCacheRef.current.imageCid : undefined;
    if (!blobId) {
      try {
        blobId = await getPinataClient().uploadFile(file);
        // A new image means new metadata too, so the old metadata CID goes.
        uploadCacheRef.current = { imageKey, imageCid: blobId };
      } catch (error: any) {
        console.error("Pinata upload failed:", error);
        toast({
          title: "Image Upload Failed",
          description: error.message || "Unknown error",
          variant: "destructive",
        });
        return;
      }
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
      location: values.location ?? "",
      imageUrl: getIPFSGatewayUrl(blobId),
      creator: activeAddress,
      fundingDeadline: values.fundingDeadline,
      fundingGoal: values.fundingGoal,
      fundingGoalRaw: goalStroops.toString(),
      currencyType: values.currencyType,
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
          title: m.title.trim() || `Milestone ${m.id}`,
          description: m.description.trim(),
        };
      }),
    };

    const metadataJson = JSON.stringify(metadata, null, 2);
    let metadataCid =
      uploadCacheRef.current.metadataJson === metadataJson
        ? uploadCacheRef.current.metadataCid
        : undefined;
    if (!metadataCid) {
      try {
        const metadataFile = new File([metadataJson], "metadata.json", {
          type: "application/json",
        });
        metadataCid = await getPinataClient().uploadFile(metadataFile);
        uploadCacheRef.current = { ...uploadCacheRef.current, metadataJson, metadataCid };
      } catch (uploadErr: any) {
        console.error("Pinata metadata upload failed:", uploadErr);
        // The route says why it refused, e.g. a field over its length limit.
        toast({
          title: "Metadata Upload Failed",
          description:
            uploadErr?.message || "Failed to upload project specification details to IPFS.",
          variant: "destructive",
        });
        return;
      }
    }

    // 4. Already on-chain?
    //
    // A launch whose confirmation failed may still have landed, and pressing
    // Launch Campaign again would then deploy a second vault and pull a second
    // bond. An unchanged draft has the same metadata CID, so an earlier vault
    // for it can be found and shown instead. Fails closed: if the factory
    // cannot be read, a duplicate cannot be ruled out, and nothing is sent.
    setLaunchStage("deduping");
    try {
      const existing = await findDeployedVault(activeAddress, metadataCid);
      if (existing) {
        toast({
          title: "This project is already on-chain",
          description: `An earlier launch of this draft went through: project #${existing.projectId}, vault ${existing.vaultAddress.slice(0, 6)}...${existing.vaultAddress.slice(-4)}. Nothing new was signed.`,
        });
        refreshAfterTx(activeAddress);
        router.push("/projects");
        return;
      }
    } catch (guardError) {
      console.error("[ListingForm] duplicate check failed:", guardError);
      toast({
        title: "Could not check for an earlier launch",
        description:
          "The network could not be read to confirm this project is not already on-chain, so nothing was sent. Try again in a moment.",
        variant: "destructive",
      });
      return;
    }

    /**
     * A launch refused before anything reached the network, in words.
     *
     * A wallet that cannot cover the bond and fee gets the same dialog the
     * pre-flight shows, with the real asset and, where it can be read, the
     * real balance. Anything else gets one plain sentence, with the network's
     * own text folded underneath.
     */
    const reportRefusal = async (text: string) => {
      const failure = classifyLaunchFailure(text, tokenAddress, FACTORY_ID);
      if (failure.kind === "token") {
        const asset: BondAsset = (await bondAssetFor(tokenAddress)) ?? {
          code: values.currencyType,
          issuer: null,
          isNative: values.currencyType === "XLM",
        };
        if (failure.reason === "insufficient") {
          const balance = await tokenBalance(tokenAddress, activeAddress);
          setBondBlocker({
            ok: false,
            reason: "insufficient",
            asset,
            held: balance.status === "ok" ? Number(balance.raw) / 10_000_000 : null,
            bond: numericBond,
            fee: platformFee,
          });
        } else {
          setBondBlocker({ ok: false, reason: failure.reason, asset });
        }
        return;
      }
      toast({
        title:
          failure.kind === "rule"
            ? "This launch can't go ahead"
            : failure.kind === "network"
              ? "Couldn't reach the network"
              : "The launch didn't go through",
        description: (
          <ToastDetail
            message={
              failure.kind === "rule"
                ? `${failure.message} Nothing was charged.`
                : failure.kind === "network"
                  ? "Nothing was sent. Check your connection and try again."
                  : "No vault was created and nothing was charged. Try again in a moment; if it keeps happening, send the technical details below to the BLKFNDR team."
            }
            detail={technicalDetail(text)}
          />
        ),
        variant: "destructive",
      });
    };

    /** A launch the network applied and then failed. Only its fee was charged. */
    const reportFailedOnChain = (hash: string | null) => {
      if (hash) forgetLaunch(hash);
      toast({
        title: "The network refused the launch",
        description: (
          <ToastDetail
            message="No vault was created and no bond or listing fee was taken; only the network fee was charged. Check the form and try again."
            txUrl={hash ? `${EXPLORER_BASE}/tx/${hash}` : undefined}
          />
        ),
        variant: "destructive",
      });
    };

    // 5. Simulate, 6. let the builder review it, 7. sign and send.
    setLaunchStage("preparing");
    // An object rather than a variable, so the watcher can set it from inside
    // the SDK's callback and the catch below still sees the write.
    const sent: { hash: string | null; expiresAtMs: number | null } = {
      hash: null,
      expiresAtMs: null,
    };
    try {
      const freighter = getSignerOptions(activeAddress);
      const factoryClient = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        ...freighter,
        // The stage follows the signature: until Freighter answers, the wait
        // is the builder's; after it, the network's.
        signTransaction: async (xdr: string) => {
          setLaunchStage("signing");
          const signed = await freighter.signTransaction(xdr);
          setLaunchStage("submitting");
          return signed;
        },
      });

      // tokenAddress is the builder's chosen currency (resolved above). This
      // used to read `USDC_ID` regardless of the selection, which made the
      // dropdown decorative: a project listed in XLM escrowed USDC.
      const tx = await factoryClient.create_vault({
        config: {
          creator: activeAddress,
          token: tokenAddress,
          goal: goalStroops,
          deadline: deadlineTimestamp,
          bond_amount: bondStroops,
          milestones: formattedMilestones,
          metadata_cid: metadataCid,
        },
      });

      // A refused simulation does not throw here: the SDK raises it only once
      // signing is asked for. Left alone, the review opened on a launch the
      // network had already refused, quoting 0.00001 XLM -- the base fee of a
      // transaction that was never going to run -- and the refusal arrived
      // after "Sign in Freighter", as raw host text.
      if (tx.simulation && rpc.Api.isSimulationError(tx.simulation)) {
        await reportRefusal(tx.simulation.error);
        return;
      }

      // The network fee is the simulated one -- the same figure Freighter is
      // about to show. QA Trial #3 met it for the first time inside Freighter.
      // It is paid in XLM whatever the vault's asset, and never from the
      // reserve, so a wallet holding the bond can still be unable to send.
      const networkFeeXlm = Number(tx.built?.fee ?? 0) / 10_000_000;
      const spendable = await spendableXlm(activeAddress);
      if (spendable !== null) {
        const leftForFee = spendable - (values.currencyType === "XLM" ? numericBond + platformFee : 0);
        if (leftForFee < networkFeeXlm) {
          setBondBlocker({
            ok: false,
            reason: "network-fee",
            spendable: Math.max(0, leftForFee),
            needed: networkFeeXlm,
          });
          return;
        }
      }

      setLaunchStage("review");
      const approved = await askForReview({
        title: values.title,
        currency: values.currencyType,
        goal: values.fundingGoal,
        bond: numericBond,
        platformFee,
        networkFeeXlm,
        deadlineMs: values.fundingDeadline,
      });
      if (!approved) {
        toast({
          title: "Launch cancelled",
          description: "Nothing was signed or sent to the network.",
        });
        return;
      }

      const response = await tx.signAndSend({
        watcher: {
          onSubmitted: (submitted) => {
            sent.hash = submitted?.hash ?? null;
            const maxTime = Number(tx.signed?.timeBounds?.maxTime ?? 0);
            sent.expiresAtMs = maxTime > 0 ? maxTime * 1000 : null;
            // From here the transaction exists outside this page. Written
            // down now, so a reload still knows to ask what became of it.
            if (sent.hash) {
              rememberLaunch({
                hash: sent.hash,
                expiresAtMs: sent.expiresAtMs,
                creator: activeAddress,
                title: values.title,
                sentAt: Date.now(),
              });
            }
            setLaunchStage("confirming");
          },
        },
      });

      // A transaction the network applied and then failed comes back here
      // rather than as an error, and reading `.result` on it threw "Cannot
      // read properties of undefined (reading 'switch')" -- QA's DEFECT-002
      // message by a second route, since the result it parses is not there.
      // The status says whether there is a result to read.
      const final = response.getTransactionResponse;
      if (final && final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        reportFailedOnChain(sent.hash ?? response.sendTransactionResponse?.hash ?? null);
        return;
      }
      const vaultAddr = response.result;

      if (!vaultAddr) {
        throw new Error("Factory transaction completed but did not return a vault address.");
      }

      announceLaunched(vaultAddr, activeAddress);
    } catch (error: any) {
      console.error("Vault deployment failed:", error);

      // Sent, but its confirmation went wrong. Ask the network what became of
      // it before calling this a failure: the builder's next move is to press
      // Launch again, and if the first one landed that is a second vault and a
      // second bond. The button stays busy until there is an answer.
      if (sent.hash) {
        setLaunchStage("confirming");
        const outcome = await resolveSubmittedLaunch(sent.hash, sent.expiresAtMs);
        const txUrl = `${EXPLORER_BASE}/tx/${sent.hash}`;

        if (outcome.status === "SUCCESS") {
          if (outcome.vaultAddress) {
            announceLaunched(outcome.vaultAddress, activeAddress);
          } else {
            forgetLaunch(sent.hash);
            toast({ title: "Vault Deployed Successfully!", description: "The launch went through." });
            refreshAfterTx(activeAddress);
            router.push("/projects");
          }
          return;
        }
        if (outcome.status === "EXPIRED") {
          forgetLaunch(sent.hash);
          toast({
            title: "Launch expired before it was confirmed",
            description:
              "The network never applied it, so no vault was created and nothing was charged. You can launch again.",
            variant: "destructive",
          });
          return;
        }
        if (outcome.status === "UNKNOWN") {
          toast({
            title: "Launch sent, not confirmed",
            description: (
              <span>
                The network could not be reached to confirm it.{" "}
                <a href={txUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Check the transaction
                </a>{" "}
                before trying again. Launch Campaign checks on this one first, even
                after a reload, so it won&apos;t create a second vault.
              </span>
            ),
            variant: "destructive",
          });
          return;
        }
        if (outcome.status === "FAILED") {
          reportFailedOnChain(sent.hash);
          return;
        }
      }

      // Declining in Freighter, or closing its window, is a decision rather
      // than a fault. It used to reach here as an unreadable TypeError about
      // reading 'switch', reported under "Vault Deployment Failed" as though
      // something had broken.
      if (error instanceof FreighterDeclined) {
        toast({
          title: "Signing cancelled",
          description: error.message,
        });
        return;
      }
      // Everything else -- a refusal that slipped past the checks above, a
      // network that could not be reached, a rejected submission -- in words,
      // with the raw text folded underneath instead of as the whole message.
      await reportRefusal(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * A submit that failed validation.
   *
   * Every path that stops a launch now ends somewhere the builder can see.
   * The funding goal is the case that needed this most: it is derived from the
   * milestone amounts, has no control of its own and renders no message, so a
   * goal below the minimum rejected the submit with nothing on screen at all.
   */
  const onInvalid = (errors: FieldErrors<FormSchema>) => {
    const milestoneProblems = collectMilestoneProblems();

    const fieldMessages = Object.values(errors)
      .map((e) => (e as { message?: unknown } | undefined)?.message)
      .filter((m): m is string => typeof m === "string");

    setLaunchProblems([...fieldMessages, ...milestoneProblems]);

    // Take them to the problem rather than leaving them to hunt for it.
    document
      .querySelector('[aria-invalid="true"], [data-milestone-error="true"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  async function onSubmit(values: FormSchema) {
    // The milestone rows are not form fields, so zod passing says nothing about
    // them. Checked here, where a failure can still be shown.
    const milestoneProblems = collectMilestoneProblems();
    if (milestoneProblems.length > 0) {
      setLaunchProblems(milestoneProblems);
      document
        .querySelector('[data-milestone-error="true"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

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
            {/* noValidate hands validation to zod and the checks below, so it
                has one owner. With the browser's own validation left on, an
                empty milestone row stopped the submit before React saw it: no
                submit event, so handleSubmit never ran and the page did
                nothing at all. onInvalid guarantees a blocked submit always
                says why. */}
            <form
              noValidate
              onSubmit={form.handleSubmit(onSubmit, onInvalid)}
              className="space-y-8"
            >
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., My Awesome Stellar Project" {...field} />
                    </FormControl>
                    <FieldCharacterCount value={field.value} max={LISTING_LIMITS.title} />
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
                    <FieldCharacterCount value={field.value} max={LISTING_LIMITS.tagline} />
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
                    <FieldCharacterCount value={field.value} max={LISTING_LIMITS.description} />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Location
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Cebu City, Philippines"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Where the asset actually is. Required — a real-world asset
                      that names no place cannot be diligenced by the people being
                      asked to fund it, and location is often the single most
                      material fact about one.
                    </FormDescription>
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
                      options={categories.map((cat) => ({ value: cat, label: cat }))}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={
                        isLoadingCategories ? "Loading categories..." : "Select category..."
                      }
                      searchPlaceholder="Search category..."
                      notFoundText="No category found."
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* The builder was never asked this. currencyType sat in the
                  schema with a default of USDC and no control ever rendered it,
                  so every project was denominated by omission. */}
              <FormField
                control={form.control}
                name="currencyType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Funding Currency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a currency" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableCurrencies().map((c) => (
                          <SelectItem key={c} value={c}>
                            {CURRENCY_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Contributions, refunds and every milestone release happen in
                      this asset. The vault is fixed to it permanently — it cannot
                      be changed after the project is created.
                    </FormDescription>
                    {currencyAsset?.issuer && (
                      <p className="text-xs text-muted-foreground">
                        This is {currencyAsset.code} issued by{" "}
                        <span className="font-mono" title={currencyAsset.issuer}>
                          {currencyAsset.issuer.slice(0, 4)}…{currencyAsset.issuer.slice(-4)}
                        </span>
                        . Your wallet needs this exact asset; {currencyAsset.code} from another
                        issuer won&apos;t count.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fundingDeadline"
                render={() => (
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
              <div className="space-y-2 p-4 rounded-xl border border-border/80 bg-accent/5 relative overflow-hidden transition-all duration-300">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    Creator Performance Bond
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    Min required: {minBondRequired.toFixed(2)} {selectedCurrency} ({(bondPct * 100).toFixed(2)}%)
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
                      {selectedCurrency}
                    </div>
                  </div>
                </div>
                {!isBondManuallyEdited.current ? (
                  <p className="text-[10px] text-accent/70 transition-all">

                  </p>
                ) : (
                  <div className="flex justify-between items-center text-[10px] transition-all">
                    <span className="text-amber-600 font-medium">

                    </span>

                  </div>
                )}
                {!isBondValid && (
                  <p className="text-[10px] text-red-500 font-medium">
                    Bond must be at least {(bondPct * 100).toFixed(2)}% of the campaign goal ({minBondRequired.toFixed(2)} {selectedCurrency}).
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
                    className="h-9 bg-accent hover:bg-accent/90 text-white font-semibold flex items-center gap-1.5 shadow-sm rounded-xl px-4"
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
                          {/* Fixed examples. These used to repeat the project
                              title, so a long or messy title made a hint that
                              was clipped and read as nonsense. */}
                          <Input
                            placeholder={`e.g. Phase ${index + 1}: Hardware procurement`}
                            value={milestone.title}
                            onChange={(e) => handleUpdateMilestone(milestone.id, "title", e.target.value)}
                            required
                            aria-describedby={`milestone-${milestone.id}-title-count`}
                            aria-invalid={!!milestoneErrors[milestone.id]?.title}
                            data-milestone-error={!!milestoneErrors[milestone.id]?.title}
                          />
                          <CharacterCount
                            id={`milestone-${milestone.id}-title-count`}
                            value={milestone.title}
                            max={LISTING_LIMITS.milestoneTitle}
                          />
                          {milestoneErrors[milestone.id]?.title && (
                            <p className="text-xs font-medium text-destructive">
                              {milestoneErrors[milestone.id]?.title}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Input
                            type="number"
                            placeholder={`Amount (${selectedCurrency})`}
                            value={milestone.amount || ""}
                            onChange={(e) => handleUpdateMilestone(milestone.id, "amount", parseFloat(e.target.value) || 0)}
                            required
                            step="any"
                            aria-invalid={!!milestoneErrors[milestone.id]?.amount}
                            data-milestone-error={!!milestoneErrors[milestone.id]?.amount}
                          />
                          {milestoneErrors[milestone.id]?.amount && (
                            <p className="text-xs font-medium text-destructive">
                              {milestoneErrors[milestone.id]?.amount}
                            </p>
                          )}
                        </div>
                      </div>

                      <Textarea
                        placeholder="e.g. What this stage delivers, and how stakeholders can check it"
                        value={milestone.description}
                        onChange={(e) => handleUpdateMilestone(milestone.id, "description", e.target.value)}
                        rows={2}
                        required
                        aria-describedby={`milestone-${milestone.id}-description-count`}
                        aria-invalid={!!milestoneErrors[milestone.id]?.description}
                        data-milestone-error={!!milestoneErrors[milestone.id]?.description}
                      />
                      <CharacterCount
                        id={`milestone-${milestone.id}-description-count`}
                        value={milestone.description}
                        max={LISTING_LIMITS.milestoneDescription}
                      />
                      {milestoneErrors[milestone.id]?.description && (
                        <p className="text-xs font-medium text-destructive">
                          {milestoneErrors[milestone.id]?.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>



                {/* Milestone Sum Validation Status */}
                <div className="flex justify-between items-center p-3 rounded-xl border bg-muted/40 text-xs">
                  <span className="font-medium">Total Milestone Allocation (Funding Goal):</span>
                  <span
                    className={cn(
                      "font-bold",
                      // The goal is derived, so it has no field of its own to
                      // carry a message. Saying it here is the only place a
                      // builder can see that it is the thing blocking them.
                      milestoneSum > 0 ? "text-primary" : "text-destructive",
                    )}
                  >
                    {milestoneSum.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedCurrency}
                  </span>
                </div>
                {milestoneSum <= 0 && (
                  <p className="px-1 pt-1 text-xs font-medium text-destructive">
                    The funding goal is the sum of your milestone amounts, so it has to be above zero.
                  </p>
                )}
              </div>

              <FormField
                control={form.control}
                name="image"
                render={() => (
                  <FormItem>
                    <FormLabel>Project Image</FormLabel>
                    <FormControl>
                      <Input type="file" accept="image/*" onChange={handleFileChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
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
                  {/* The pending state swaps the icon and the word, never the
                      button. SubmitLoader used to replace the whole label with a
                      position:absolute element sitting 100px below the button, so
                      it contributed no width or height at all: the button
                      collapsed to its own padding and the animation played
                      outside it, leaving a grey block and no sign of progress.
                      min-w holds the resting width so nothing reflows. */}
                  <Button
                    type="submit"
                    disabled={
                      isSubmitPending ||
                      isCooldown ||
                      isSubmittingRef.current ||
                      !isBondValid ||
                      priorLaunchTitle !== null
                    }
                    aria-busy={isSubmitPending}
                    className="gap-2 min-w-[168px]"
                  >
                    {isSubmitPending && <CubeSpinner size="small" />}
                    {isSubmitPending ? "Launching..." : "Launch Campaign"}
                  </Button>
                </div>
                {/* What the launch is doing, so the button never has to say it. */}
                {isSubmitPending && launchStage !== "idle" && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-sm text-muted-foreground sm:text-right"
                  >
                    {LAUNCH_STATUS[launchStage]}
                  </p>
                )}
                {!isSubmitPending && priorLaunchTitle !== null && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-sm text-muted-foreground sm:text-right"
                  >
                    Checking on your last launch of “{priorLaunchTitle}” before you start another…
                  </p>
                )}
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

      <BondBlockerDialog
        blocker={bondBlocker}
        onClose={() => setBondBlocker(null)}
        onEnableAsset={handleEnableAsset}
      />
      <LaunchBlockedDialog problems={launchProblems} onClose={() => setLaunchProblems(null)} />
      <LaunchReviewDialog review={launchReview} onDecide={decideReview} />
    </>
  );
}