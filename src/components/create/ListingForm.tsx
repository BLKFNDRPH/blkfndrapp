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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { LaunchBlockedDialog, type LaunchProblem } from "./LaunchBlockedDialog";
import { LaunchReviewDialog, type LaunchReview } from "./LaunchReviewDialog";
import { BeforeYouBegin } from "./BeforeYouBegin";
import { CostCard } from "./CostCard";
import { DepositField, type DepositChoice } from "./DepositField";
import { LaunchSuccess, type OpenedVault } from "./LaunchSuccess";
import {
  fundsView,
  launchMoney,
  networkFeeMoney,
  openingFeeXlm,
  useLaunchReadiness,
  type FundsView,
} from "./launch-readiness";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import { PRACTICE_DOLLARS_FAUCET } from "@/lib/wallet-readiness";
import { useXlmRate } from "@/lib/xlm-rate";
import {
  clearDraft,
  draftHasContent,
  draftImageFiles,
  loadDraft,
  saveDraft,
} from "@/lib/listing-draft";
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
import { Wand2, Calendar, Plus, Trash2, MapPin } from "lucide-react";
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

/**
 * Whole units to base units, rounded rather than cut off: 1.15 × 10⁷ is
 * 11499999.999999998 in floating point, and Math.floor sent a stage of 1.15 as
 * 1.1499999.
 */
const toStroops = (units: number): bigint =>
  BigInt(Math.round((Number.isFinite(units) ? units : 0) * 10_000_000));

/** Up to the next cent, ignoring floating-point dust (1000 × 0.1 is 100.00000000000001). */
const centsUp = (n: number) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;

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
  category: z.string().min(1, "Choose a category."),
  // Required. These are real-world assets, and a listing that names no place
  // gives a stakeholder nothing to verify against — location is frequently the
  // most material fact about the project.
  location: z
    .string()
    .trim()
    .min(3, "Say where the project is.")
    .refine(...withinLimit(LISTING_LIMITS.location, "Location")),
  fundingGoal: z.coerce.number().min(1, "The goal, the sum of your stages, must be at least 1."),
  // Derived from CURRENCIES rather than restated. A hand-maintained copy drifts,
  // and the drift is silent: this list accepted three currencies that had no
  // token address configured and no code path that would have used one.
  currencyType: z.enum(CURRENCIES, {
    required_error: "Choose a currency.",
  }),
  // NaN when the date field is empty or half-typed: see handleDeadlineChange.
  // The minimum is read at validation time, not once when the module loads.
  fundingDeadline: z.coerce
    .number({ invalid_type_error: "Choose a deadline to reach the goal." })
    .refine((ms) => ms >= MIN_DEADLINE_MS(), "Pick a deadline at least a day from now."),
  image: z
    .any()
    .refine(
      (files) =>
        typeof window === "undefined" ||
        (files instanceof FileList && files.length > 0),
      "Add a picture of the project.",
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
          See the public record
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
 * it instead. The stage that matters most is "signing": the wallet's window
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
  verifying: "Checking your identity and your deposit…",
  uploading: "Saving your picture and details…",
  deduping: "Making sure this vault wasn't already opened…",
  preparing: "Preparing your confirmation…",
  review: "Review the details, then confirm in your wallet.",
  signing: "Waiting for you to confirm in your wallet (the request expires in about 5 minutes)…",
  submitting: "Confirmed. Sending it to the network…",
  confirming: "Sent. Waiting for the network, about 10 seconds. Keep this page open.",
};

/** The currency choice, in words a builder can choose between. */
const CURRENCY_CHOICES: Record<Currency, { title: string; body: string }> = {
  USDC: {
    title: "US dollars (USDC)",
    body: "Recommended. Stakes, your deposit and every payout stay worth the same.",
  },
  XLM: {
    title: "XLM",
    body: "The network's own currency. Its dollar value moves every day, so your goal and payouts will too.",
  },
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
        title: "Wallet connected",
        description: "Your wallet is ready to open the vault.",
      });
      return address || null;
    } catch (err: any) {
      console.warn("[ListingForm] wallet connection failed:", err);
      toast({
        title: "Couldn't connect your wallet",
        description: (
          <ToastDetail
            message="Nothing was sent. Check that your wallet is set up, then press Review again. Your profile's Wallet tab walks you through it."
            detail={err?.message}
          />
        ),
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
   * Everything standing between the builder and an open vault, for the dialog.
   *
   * A dialog rather than a toast, to match BondBlockerDialog: both answer the
   * same question -- why did pressing Review not open anything -- and a toast
   * slides away while the builder is still reading the form.
   */
  const [launchProblems, setLaunchProblems] = useState<LaunchProblem[] | null>(null);

  const { platformInfo } = usePlatformInfo();
  const { rate: xlmUsd } = useXlmRate();
  const bondBps = platformInfo?.bondPercentage ?? 500;
  const minPct = bondBps / 100;
  const listingFee = Number(platformInfo?.platformFeeStroops ?? 0) / 10_000_000;

  const milestoneSum = milestones.reduce((sum, m) => sum + Number(m.amount), 0);
  // The factory's own rule, in base units: goal × percentage ÷ 10,000, rounded down.
  const minBondStroops = (toStroops(milestoneSum) * BigInt(bondBps)) / BigInt(10_000);
  // The minimum as a builder reads it, rounded up to the cent so it always clears that rule.
  const minBondRequired = Number((minBondStroops + BigInt(99_999)) / BigInt(100_000)) / 100;

  /**
   * The builder's deposit. It starts at the minimum and follows it while left
   * there; a percentage they pick follows the goal; an amount they type is
   * theirs, and nothing overwrites it. It used to reset to 10% of the goal on
   * every change to a stage, silently replacing whatever had been typed.
   */
  const [depositChoice, setDepositChoice] = useState<DepositChoice>({ kind: "min" });
  // The minimum when the builder last chose, so the field can say when the
  // stages have moved it since.
  const [minAtChoice, setMinAtChoice] = useState<number | null>(null);
  const chooseDeposit = (choice: DepositChoice) => {
    setDepositChoice(choice);
    setMinAtChoice(choice.kind === "min" ? null : minBondRequired);
  };
  const numericBond =
    depositChoice.kind === "min"
      ? minBondRequired
      : depositChoice.kind === "pct"
        ? Math.max(minBondRequired, centsUp((milestoneSum * depositChoice.pct) / 100))
        : parseFloat(depositChoice.amount) || 0;
  const minChangedTo =
    minAtChoice !== null && minAtChoice !== minBondRequired ? minBondRequired : null;

  useEffect(() => {
    form.setValue("fundingGoal", milestoneSum, { shouldValidate: true });
  }, [form, milestoneSum]);

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
        problem.title = "Give this stage a name.";
        missing.push("a name");
      }
      if (!(Number(m.amount) > 0)) {
        problem.amount = "Enter an amount greater than zero.";
        missing.push("an amount above zero");
      }
      if (!m.description.trim()) {
        problem.description = "Say what this stage delivers.";
        missing.push("what it delivers");
      }

      if (missing.length > 0) {
        const list =
          missing.length === 1
            ? missing[0]
            : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
        described.push(`Stage ${index + 1} needs ${list}.`);
      }

      const titleLength = charCount(m.title.trim());
      if (titleLength > LISTING_LIMITS.milestoneTitle) {
        problem.title = `Keep this name to ${LISTING_LIMITS.milestoneTitle} characters or fewer.`;
        described.push(
          `Stage ${index + 1}'s name is ${titleLength.toLocaleString()} characters; the limit is ${LISTING_LIMITS.milestoneTitle}.`,
        );
      }
      const descriptionLength = charCount(m.description.trim());
      if (descriptionLength > LISTING_LIMITS.milestoneDescription) {
        problem.description = `Keep this to ${LISTING_LIMITS.milestoneDescription} characters or fewer.`;
        described.push(
          `Stage ${index + 1}'s description is ${descriptionLength.toLocaleString()} characters; the limit is ${LISTING_LIMITS.milestoneDescription}.`,
        );
      }

      if (Object.keys(problem).length > 0) byId[m.id] = problem;
    });

    setMilestoneErrors(byId);
    return described;
  }, [milestones]);

  // Checked as the factory checks it, in base units.
  const isBondValid = toStroops(numericBond) >= minBondStroops;

  const selectedCurrency = form.watch("currencyType");
  const currencies = availableCurrencies();

  // ── Before you begin ──────────────────────────────────────────────────────
  // The wallet the vault would open from: the one connected here, else the
  // one linked to the account. The launch signs with the connected one.
  const builderAddress = freighterWalletAddress || user?.stellarPublicKey || null;
  // The exact asset behind the chosen currency is read from its token
  // contract: one wallet can hold several assets all called USDC (QA's test
  // wallet had three), and only the vault's own issuer counts.
  const selectedToken = (() => {
    try {
      return tokenAddressFor(selectedCurrency);
    } catch {
      return null;
    }
  })();
  const readiness = useLaunchReadiness({
    signedIn: Boolean(user),
    address: builderAddress,
    tokenAddress: selectedToken,
  });
  // The usual network fee for a plan this size; the review shows the exact one.
  const feeEstimate = openingFeeXlm(milestones.length);
  const funds: FundsView = user
    ? fundsView(readiness.holdings, numericBond + listingFee, selectedCurrency, feeEstimate)
    : { state: "signed-out" };

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageDataUri(reader.result as string);
      };
      reader.readAsDataURL(file);
      setImageName(file.name);
      form.setValue("image", event.target.files!, { shouldValidate: true });
    }
  };

  // ── The draft, kept in this browser ───────────────────────────────────────
  // Restored once on arrival, so leaving to verify an identity or set up a
  // wallet brings the builder back to what they had typed.
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  const draftReady = useRef(false);
  /** Set once the vault opens; the page then shows what happened instead of the form. */
  const [opened, setOpened] = useState<OpenedVault | null>(null);
  useEffect(() => {
    const draft = loadDraft();
    if (!draft || !draftHasContent(draft)) {
      draftReady.current = true;
      return;
    }
    const v = draft.values;
    form.reset({
      ...form.getValues(),
      title: v.title,
      tagline: v.tagline,
      description: v.description,
      category: v.category || form.getValues("category"),
      location: v.location,
      currencyType: (CURRENCIES as readonly string[]).includes(v.currencyType)
        ? (v.currencyType as Currency)
        : form.getValues("currencyType"),
      // A deadline that has since come too close is offered back anyway, and
      // the field says so, rather than silently replaced.
      fundingDeadline: v.fundingDeadline ?? NaN,
    });
    setDeadlineInputValue(draft.deadlineInput);
    if (draft.stages.length > 0) setMilestones(draft.stages);
    setDepositChoice(draft.deposit);
    setDraftRestoredAt(draft.savedAt);
    if (draft.image) {
      const image = draft.image;
      draftImageFiles(image).then((files) => {
        if (!files) return;
        form.setValue("image", files);
        if (imageInputRef.current) imageInputRef.current.files = files;
        setImageDataUri(image.dataUri);
        setImageName(image.name);
      });
    }
    draftReady.current = true;
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watched = form.watch();
  /** Write the draft as it stands, if anything has been typed. */
  const saveDraftNow = () => {
    const file = (watched.image as FileList | undefined)?.[0];
    const draft = {
      v: 1 as const,
      savedAt: Date.now(),
      values: {
        title: watched.title ?? "",
        tagline: watched.tagline ?? "",
        description: watched.description ?? "",
        category: watched.category ?? "",
        location: watched.location ?? "",
        currencyType: watched.currencyType,
        fundingDeadline: Number.isFinite(watched.fundingDeadline) ? watched.fundingDeadline : null,
      },
      deadlineInput: deadlineInputValue,
      stages: milestones,
      deposit: depositChoice,
      image:
        file && imageDataUri
          ? { name: file.name, type: file.type, lastModified: file.lastModified, dataUri: imageDataUri }
          : undefined,
    };
    if (draftHasContent(draft)) saveDraft(draft);
  };
  // Saved half a second after the last change.
  useEffect(() => {
    // Nothing to keep once the vault is open: the draft is cleared then.
    if (!draftReady.current || opened) return;
    const timer = setTimeout(saveDraftNow, 500);
    return () => clearTimeout(timer);
    // saveDraftNow reads exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, deadlineInputValue, milestones, depositChoice, imageDataUri, opened]);

  /** Back to an empty form, and the saved draft gone. */
  const startOver = () => {
    clearDraft();
    form.reset({
      title: "",
      tagline: "",
      description: "",
      category: "Blockchain",
      location: "",
      fundingGoal: 0,
      currencyType: "USDC",
      fundingDeadline: initialDeadline,
      image: undefined,
    });
    setDeadlineInputValue(msToDatetimeLocal(initialDeadline));
    setMilestones([{ id: 1, title: "", description: "", amount: 0 }]);
    setMilestoneErrors({});
    chooseDeposit({ kind: "min" });
    setImageDataUri(null);
    setImageName(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
    uploadCacheRef.current = {};
    setDraftRestoredAt(null);
  };

  /**
   * The date field and the value the launch submits, kept as one.
   *
   * An empty or half-typed date used to leave the form value alone, so the
   * field showed what the builder typed while the launch went out with
   * whatever was there before -- the 30-day default, in practice. Now an
   * unusable date clears the value and the launch stops on "Choose a deadline
   * to reach the goal" instead.
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
        title: "Add a picture first",
        description: "The quality check looks at your picture as well as your words.",
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
          title: "The quality check didn't answer",
          description: "Nothing about your listing changed. Try again in a moment.",
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

  /**
   * The vault is open: say so, forget the draft, and show where the project
   * will live, in place of the form. It used to toast a contract address and
   * send the builder to a project list their project was not in yet.
   */
  const announceLaunched = async (
    vaultAddr: string | null,
    activeAddress: string,
    title: string,
    metadataCid: string | null,
  ) => {
    forgetLaunch();
    clearDraft();
    toast({
      title: "Your vault is open",
      description: `“${title}” appears in Projects within a minute or two.`,
    });

    // Nothing is written to the database here. The indexer picks the
    // project up from the FACTORY/DEPLOY event and resolves this metadata
    // from IPFS — letting the browser write it would mean the client
    // deciding what a listing says about an on-chain project.
    refreshAfterTx(activeAddress);

    // The project's number, for its link: the factory numbers vaults as it
    // opens them, and this draft's metadata identifies the one just opened.
    let projectId: string | null = null;
    if (metadataCid) {
      const found = await findDeployedVault(activeAddress, metadataCid).catch(() => null);
      if (found && (!vaultAddr || found.vaultAddress === vaultAddr)) projectId = String(found.projectId);
    }
    setOpened({ title, projectId });
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          title: "Your last vault opened",
          description: (
            <ToastDetail
              message={`${name} is open. It appears in Projects once BLKFNDR has read it, usually within a minute.`}
              txUrl={txUrl}
            />
          ),
        });
        refreshAfterTx(prior.creator);
        return false;
      case "FAILED":
        forgetLaunch(prior.hash);
        toast({
          title: "Your last vault didn't open",
          description: (
            <ToastDetail
              message={`The network refused ${name}, so no vault was opened and no deposit was taken; only the network fee was charged.`}
              txUrl={txUrl}
            />
          ),
          variant: "destructive",
        });
        return true;
      case "EXPIRED":
        forgetLaunch(prior.hash);
        toast({
          title: "Your last vault didn't open",
          description: `The network didn't accept ${name} in time, so no vault was opened and nothing was paid. You can try again.`,
        });
        return true;
      default:
        toast({
          title: "Your last vault isn't confirmed yet",
          description: (
            <ToastDetail
              message={`${name} was sent, but the network couldn't be reached to confirm it. Check it before trying again, so you don't open a second vault.`}
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
    readiness.refresh();
    toast({
      title: asset.code === "USDC" ? "Dollars are on in your wallet" : `${asset.code} is on in your wallet`,
      description: "Press Review and open the vault again to continue.",
    });
  };

  /** Activate a new wallet from the practice faucet, from the deposit dialog. */
  const handleActivate = async () => {
    await readiness.activate();
    setBondBlocker(null);
  };

  const handleOnChainSubmit =(values: FormSchema, verifiedAddress?: string) => {
    if (isSubmittingRef.current) return;

    const activeAddress = verifiedAddress || freighterWalletAddress;
    if (!activeAddress) {
      toast({
        title: "Connect your wallet first",
        description: "Opening a vault uses your own wallet, because the deposit and every payout are tied to it.",
        variant: "destructive",
      });
      return;
    }

    if (!isBondValid) {
      toast({
        title: "Your deposit is below the minimum",
        description: `It has to be at least ${launchMoney(minBondRequired, selectedCurrency, xlmUsd)}, ${minPct}% of your goal.`,
        variant: "destructive",
      });
      return;
    }

    if (isCooldown) {
      toast({
        title: "Give it a few seconds",
        description: "Pictures can be saved once every 5 seconds. Press Review again in a moment.",
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
        // Saved now rather than trusting the last debounce, so the draft is
        // here again when they come back.
        saveDraftNow();
        toast({
          title: "Verify your identity first",
          description:
            "Opening a vault needs a verified identity. Your draft is saved in this browser and will be here when you come back.",
          variant: "destructive",
        });
        router.push("/profile/kyc-attestation");
        return;
      }
    } catch (err: any) {
      console.warn("[ListingForm] identity check failed:", err);
      toast({
        title: "Couldn't check your identity",
        description: (
          <ToastDetail
            message="The identity record couldn't be read just now, so nothing was sent. Try again in a moment."
            detail={err?.message}
          />
        ),
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
        description: "This currency isn't set up on BLKFNDR right now. Choose another one.",
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
      toast({ title: "Add a picture of the project first.", variant: "destructive" });
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
        console.warn("Pinata upload failed:", error);
        toast({
          title: "Couldn't save your picture",
          description: (
            <ToastDetail
              message="Nothing was opened or charged. Try again in a moment, or try a smaller picture."
              detail={error?.message}
            />
          ),
          variant: "destructive",
        });
        return;
      }
    }

    const goalStroops = toStroops(values.fundingGoal);
    const bondStroops = toStroops(numericBond);
    const deadlineTimestamp = BigInt(Math.floor(values.fundingDeadline / 1000));

    const formattedMilestones = milestones.map((m, idx) => {
      let amount: bigint;
      if (idx === milestones.length - 1) {
        const previousSum = milestones.slice(0, idx).reduce((sum, item) => sum + toStroops(item.amount), BigInt(0));
        amount = goalStroops - previousSum;
      } else {
        amount = toStroops(m.amount);
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
        console.warn("Pinata metadata upload failed:", uploadErr);
        // The route says why it refused, e.g. a field over its length limit,
        // and that reason is the message.
        toast({
          title: "Couldn't save your project details",
          description: (
            <ToastDetail
              message={
                uploadErr?.message
                  ? `${uploadErr.message} Nothing was opened or charged.`
                  : "Nothing was opened or charged. Try again in a moment."
              }
            />
          ),
          variant: "destructive",
        });
        return;
      }
    }

    // 4. Already on-chain?
    //
    // An opening whose confirmation failed may still have landed, and pressing
    // Review again would then deploy a second vault and pull a second deposit.
    // An unchanged draft has the same metadata CID, so an earlier vault for it
    // can be found and shown instead. Fails closed: if the factory cannot be
    // read, a duplicate cannot be ruled out, and nothing is sent.
    setLaunchStage("deduping");
    try {
      const existing = await findDeployedVault(activeAddress, metadataCid);
      if (existing) {
        forgetLaunch();
        clearDraft();
        toast({
          title: "This draft already opened a vault",
          description: "Nothing new was paid or confirmed.",
        });
        refreshAfterTx(activeAddress);
        setOpened({ title: values.title, projectId: String(existing.projectId), alreadyOpened: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    } catch (guardError) {
      console.warn("[ListingForm] duplicate check failed:", guardError);
      toast({
        title: "Couldn't check for an earlier opening",
        description:
          "The network couldn't be read to make sure this draft hasn't already opened a vault, so nothing was sent. Try again in a moment.",
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
            ? "This vault can't open yet"
            : failure.kind === "network"
              ? "Couldn't reach the network"
              : "The vault didn't open",
        description: (
          <ToastDetail
            message={
              failure.kind === "rule"
                ? `${failure.message} Nothing was charged.`
                : failure.kind === "network"
                  ? "Nothing was sent. Check your connection and try again."
                  : "No vault was opened and nothing was charged. Try again in a moment; if it keeps happening, send the technical details below to the BLKFNDR team."
            }
            detail={technicalDetail(text)}
          />
        ),
        variant: "destructive",
      });
    };

    /** An opening the network applied and then failed. Only its fee was charged. */
    const reportFailedOnChain = (hash: string | null) => {
      if (hash) forgetLaunch(hash);
      toast({
        title: "The vault didn't open",
        description: (
          <ToastDetail
            message="The network refused it, so no vault was opened and no deposit or listing fee was taken; only the network fee was charged. Check the form and try again."
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

      // What the wallet holds toward the deposit and fee, for the review's
      // "you have" line. Unread is fine: the line is left out.
      const held =
        values.currencyType === "XLM"
          ? spendable
          : await tokenBalance(tokenAddress, activeAddress)
              .then((b) => (b.status === "ok" ? Number(b.raw) / 10_000_000 : null))
              .catch(() => null);

      setLaunchStage("review");
      const approved = await askForReview({
        title: values.title,
        currency: values.currencyType,
        goal: values.fundingGoal,
        bond: numericBond,
        platformFee,
        networkFeeXlm,
        stages: milestones.length,
        deadlineMs: values.fundingDeadline,
        held,
        xlmUsd: xlmUsd ?? null,
      });
      if (!approved) {
        toast({
          title: "Not opened",
          description: "Nothing was confirmed or sent.",
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

      await announceLaunched(vaultAddr, activeAddress, values.title, metadataCid ?? null);
    } catch (error: any) {
      console.warn("Vault opening failed:", error);

      // Sent, but its confirmation went wrong. Ask the network what became of
      // it before calling this a failure: the builder's next move is to press
      // Review again, and if the first one landed that is a second vault and a
      // second deposit. The button stays busy until there is an answer.
      if (sent.hash) {
        setLaunchStage("confirming");
        const outcome = await resolveSubmittedLaunch(sent.hash, sent.expiresAtMs);
        const txUrl = `${EXPLORER_BASE}/tx/${sent.hash}`;

        if (outcome.status === "SUCCESS") {
          forgetLaunch(sent.hash);
          await announceLaunched(outcome.vaultAddress ?? null, activeAddress, values.title, metadataCid ?? null);
          return;
        }
        if (outcome.status === "EXPIRED") {
          forgetLaunch(sent.hash);
          toast({
            title: "The network didn't accept it in time",
            description: "So no vault was opened and nothing was paid. Try again.",
            variant: "destructive",
          });
          return;
        }
        if (outcome.status === "UNKNOWN") {
          toast({
            title: "Sent, but not confirmed yet",
            description: (
              <ToastDetail
                message="Don't worry about pressing Review again: it checks on this one first, even after a reload, so you can't open a second vault or be charged twice."
                txUrl={txUrl}
              />
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

      // Declining in the wallet, or closing its window, is a decision rather
      // than a fault. It used to reach here as an unreadable TypeError about
      // reading 'switch', reported under "Vault Deployment Failed" as though
      // something had broken.
      if (error instanceof FreighterDeclined) {
        toast({
          title: "Not confirmed",
          description: "Nothing was sent and nothing was charged.",
        });
        return;
      }
      // Everything else -- a refusal that slipped past the checks above, a
      // network that could not be reached, a rejected submission -- in words,
      // with the raw text folded underneath instead of as the whole message.
      await reportRefusal(error instanceof Error ? error.message : String(error));
    }
  };

  const money = (n: number) => launchMoney(n, selectedCurrency, xlmUsd ?? null);

  /** A deposit below the minimum, for the dialog, with the one-press fix. */
  const depositProblems = (): LaunchProblem[] =>
    !isBondValid && milestoneSum > 0
      ? [
          {
            text: `Your deposit is below the minimum of ${money(minBondRequired)}.`,
            actions: [{ label: "Use the minimum", onClick: () => chooseDeposit({ kind: "min" }) }],
          },
        ]
      : [];

  /**
   * What "Before you begin" already knows is missing, for the dialog. Only
   * what is known: a read still loading, or one that failed, blocks nothing,
   * because the launch checks identity and the deposit again itself.
   */
  const prerequisiteProblems = (): LaunchProblem[] => {
    const out: LaunchProblem[] = [];
    const identity = readiness.identity;
    if (identity === "none" || identity === "rejected") {
      out.push({
        text:
          identity === "rejected"
            ? "Your identity check wasn't approved. You can send it again."
            : "Your identity isn't verified yet.",
        actions: [{ label: "Verify", href: "/profile/kyc-attestation" }],
      });
    } else if (identity === "lapsed") {
      out.push({
        text: "Your ID has expired, so your identity verification no longer counts. Verify again with a current one.",
        actions: [{ label: "Verify again", href: "/profile/kyc-attestation" }],
      });
    } else if (identity === "pending") {
      out.push({ text: "Your identity check is still under review. The vault can open once it's approved." });
    } else if (identity === "approved") {
      out.push({
        text: "Your identity is approved, with one step left before it counts.",
        actions: [{ label: "See what's left", href: "/profile/kyc-attestation" }],
      });
    }

    switch (funds.state) {
      case "no-wallet":
        out.push({
          text: "Set up a wallet you control.",
          actions: [{ label: "Set up", href: "/profile?tab=wallet&for=vault" }],
        });
        break;
      case "no-account":
        out.push({
          text: "Your wallet hasn't been activated yet.",
          actions: IS_PRACTICE_NETWORK
            ? [{ label: "Activate with practice XLM", onClick: () => void readiness.activate() }]
            : undefined,
        });
        break;
      case "no-trustline": {
        const asset = funds.asset;
        out.push({
          text:
            selectedCurrency === "XLM"
              ? "Your wallet isn't set up for this currency yet."
              : "Your wallet isn't set up to hold dollars yet.",
          actions: [
            {
              label: selectedCurrency === "XLM" ? "Enable it" : "Enable dollars",
              onClick: () => void readiness.enable(asset),
            },
          ],
        });
        break;
      }
      case "short":
        out.push({
          text: `Your wallet needs ${money(funds.shortBy)} more for the deposit and listing fee.`,
          actions: [
            ...(selectedCurrency !== "XLM" && IS_PRACTICE_NETWORK && builderAddress
              ? [
                  {
                    label: "Get practice dollars",
                    href: PRACTICE_DOLLARS_FAUCET,
                    external: true,
                    // The faucet asks for the account ID; it goes to the clipboard.
                    onClick: () => void navigator.clipboard?.writeText(builderAddress).catch(() => {}),
                  },
                ]
              : []),
            ...(selectedCurrency !== "XLM" && currencies.includes("XLM")
              ? [{ label: "Switch to XLM", onClick: () => form.setValue("currencyType", "XLM") }]
              : []),
          ],
        });
        break;
      case "fee-short":
        out.push({
          text: `Your wallet needs a little more XLM for the network fee, about ${networkFeeMoney(feeEstimate, xlmUsd ?? null)}.`,
        });
        break;
    }
    return out;
  };

  /**
   * A submit that failed validation.
   *
   * Every path that stops a launch now ends somewhere the builder can see.
   * The goal is the case that needed this most: it is derived from the stage
   * amounts, has no control of its own and renders no message, so a goal
   * below the minimum rejected the submit with nothing on screen at all.
   */
  const onInvalid = (errors: FieldErrors<FormSchema>) => {
    const milestoneProblems = collectMilestoneProblems();

    const fieldMessages = Object.values(errors)
      .map((e) => (e as { message?: unknown } | undefined)?.message)
      .filter((m): m is string => typeof m === "string");

    setLaunchProblems([
      ...fieldMessages,
      ...milestoneProblems,
      ...depositProblems(),
      ...(user ? prerequisiteProblems() : []),
    ]);

    // Take them to the problem rather than leaving them to hunt for it.
    document
      .querySelector('[aria-invalid="true"], [data-milestone-error="true"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  async function onSubmit(values: FormSchema) {
    // The stage rows are not form fields, so zod passing says nothing about
    // them. Checked here, where a failure can still be shown.
    const milestoneProblems = collectMilestoneProblems();
    const formProblems = [...milestoneProblems, ...depositProblems()];

    if (!user && formProblems.length === 0) {
      toast({
        title: "Sign in to open a vault",
        description: "Your draft is saved in this browser, so it will be here after you sign in.",
      });
      login();
      return;
    }

    const problems = [...formProblems, ...(user ? prerequisiteProblems() : [])];
    if (problems.length > 0) {
      setLaunchProblems(problems);
      document
        .querySelector('[data-milestone-error="true"], #builder-deposit[aria-invalid="true"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    let activeAddress = freighterWalletAddress;
    if (!activeAddress) {
      toast({
        title: "Connecting your wallet…",
        description: "Approve the connection in your wallet to continue.",
      });
      const connectedAddress = await handleConnectFreighter();
      if (!connectedAddress) return;
      activeAddress = connectedAddress;
    }

    handleOnChainSubmit(values, activeAddress);
  }

  if (opened) {
    return (
      <LaunchSuccess
        opened={opened}
        onStartAnother={() => {
          startOver();
          setOpened(null);
        }}
      />
    );
  }

  const costCard = (className?: string) => (
    <CostCard
      currency={selectedCurrency}
      deposit={numericBond}
      listingFee={listingFee}
      feeXlm={feeEstimate}
      xlmUsd={xlmUsd ?? null}
      funds={funds}
      className={className}
    />
  );

  return (
    <>
      <div className="space-y-6">
        <BeforeYouBegin
          readiness={readiness}
          funds={funds}
          address={builderAddress}
          currency={selectedCurrency}
          xlmUsd={xlmUsd ?? null}
          minPct={minPct}
          listingFee={listingFee}
          feeXlm={feeEstimate}
          canSwitchToXlm={currencies.includes("XLM")}
          onSwitchToXlm={() => form.setValue("currencyType", "XLM")}
          onSignIn={login}
        />

        {/* Form on the left, what it costs alongside it on a wide screen; on a
            phone the cost sits just above the button instead. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6">
          <Card>
            <CardContent className="relative pt-6">
              <div className="mb-6 space-y-1">
                <h2 className="text-lg font-semibold">Your listing</h2>
                <p className="text-sm text-muted-foreground">
                  Describe the project. Your draft is saved in this browser as you type, and nothing
                  is paid until you open the vault.
                </p>
                {draftRestoredAt !== null && (
                  <p className="text-sm text-muted-foreground">
                    We brought back your draft from{" "}
                    {new Date(draftRestoredAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    .{" "}
                    <button
                      type="button"
                      onClick={startOver}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Start over
                    </button>
                  </p>
                )}
              </div>
              <Form {...form}>
                {/* noValidate hands validation to zod and the checks below, so it
                    has one owner. With the browser's own validation left on, an
                    empty stage row stopped the submit before React saw it: no
                    submit event, so handleSubmit never ran and the page did
                    nothing at all. onInvalid guarantees a blocked submit always
                    says why. */}
                <form
                  noValidate
                  onSubmit={form.handleSubmit(onSubmit, onInvalid)}
                  className="space-y-10"
                >
                  {/* ── The project ─────────────────────────────────────── */}
                  <section aria-labelledby="listing-project" className="space-y-6">
                    <h3 id="listing-project" className="text-base font-semibold">
                      The project
                    </h3>
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Solar pump for the Kibera market garden" {...field} />
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
                            <Input placeholder="One line on what it is and who it's for" {...field} />
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
                              placeholder="What you'll build, where, for whom, and how stakeholders can check progress"
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
                            Where the project actually is. People deciding whether to stake look for
                            this first.
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

                    <FormField
                      control={form.control}
                      name="image"
                      render={() => (
                        <FormItem>
                          <FormLabel>Picture of the project</FormLabel>
                          <FormControl>
                            <Input
                              ref={imageInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleFileChange}
                            />
                          </FormControl>
                          {imageDataUri && (
                            <div className="flex items-center gap-3">
                              {/* A local preview of a data URI, not a remote
                                  image, so next/image has nothing to optimise. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={imageDataUri}
                                alt=""
                                className="h-16 w-24 shrink-0 rounded-md border border-border object-cover"
                              />
                              <span className="min-w-0 truncate text-sm text-muted-foreground">
                                {imageName}
                              </span>
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        Want a second opinion on your words and picture?
                      </p>
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
                        Quality check
                      </Button>
                    </div>
                  </section>

                  {/* ── Stages and goal ─────────────────────────────────── */}
                  <section aria-labelledby="listing-stages" className="space-y-4">
                    <div className="space-y-1">
                      <h3 id="listing-stages" className="text-base font-semibold">
                        Stages and goal
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Split the work into stages. Each stage is paid to you only after
                        stakeholders vote that it was delivered, so say what they&apos;ll be able to
                        check.
                      </p>
                    </div>

                    <div className="space-y-3">
                      {milestones.map((milestone, index) => (
                        <div
                          key={milestone.id}
                          className="relative space-y-3 rounded-xl border border-border/80 bg-card p-4"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase text-primary">
                              Stage {index + 1}
                            </span>
                            {milestones.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveMilestone(milestone.id)}
                                aria-label={`Remove stage ${index + 1}`}
                                className="h-7 w-7 text-muted-foreground hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="space-y-1 sm:col-span-2">
                              {/* Fixed examples. These used to repeat the project
                                  title, so a long or messy title made a hint that
                                  was clipped and read as nonsense. */}
                              <Input
                                placeholder="Name, e.g. Buy and install the pump"
                                aria-label={`Stage ${index + 1} name`}
                                value={milestone.title}
                                onChange={(e) => handleUpdateMilestone(milestone.id, "title", e.target.value)}
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
                                inputMode="decimal"
                                placeholder={selectedCurrency === "XLM" ? "Amount in XLM" : "Amount in $"}
                                aria-label={`Stage ${index + 1} amount`}
                                value={milestone.amount || ""}
                                onChange={(e) => handleUpdateMilestone(milestone.id, "amount", parseFloat(e.target.value) || 0)}
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
                            placeholder="What you'll deliver, and how stakeholders can check it"
                            aria-label={`What stage ${index + 1} delivers`}
                            value={milestone.description}
                            onChange={(e) => handleUpdateMilestone(milestone.id, "description", e.target.value)}
                            rows={2}
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

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddMilestone}
                      className="gap-1.5"
                    >
                      <Plus className="h-4 w-4" /> Add a stage
                    </Button>

                    {/* The goal is derived, so it has no field of its own to
                        carry a message. Saying it here is the only place a
                        builder can see that it is the thing blocking them. */}
                    <div className="flex items-baseline justify-between gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
                      <span className="font-medium">Goal, the sum of your stages</span>
                      <span
                        className={cn(
                          "font-bold tabular-nums",
                          milestoneSum > 0 ? "text-primary" : "text-destructive",
                        )}
                      >
                        {money(milestoneSum)}
                      </span>
                    </div>
                    {milestoneSum <= 0 && (
                      <p className="px-1 text-xs font-medium text-destructive">
                        The goal is the sum of your stage amounts, so it has to be above zero.
                      </p>
                    )}
                  </section>

                  {/* ── Money and timing ────────────────────────────────── */}
                  <section aria-labelledby="listing-money" className="space-y-6">
                    <h3 id="listing-money" className="text-base font-semibold">
                      Currency, deadline and deposit
                    </h3>

                    {/* The builder was never asked this. currencyType sat in the
                        schema with a default of USDC and no control ever rendered
                        it, so every project was denominated by omission. */}
                    <FormField
                      control={form.control}
                      name="currencyType"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel>Currency</FormLabel>
                          <FormControl>
                            <RadioGroup
                              value={field.value}
                              onValueChange={field.onChange}
                              className="grid gap-3 sm:grid-cols-2"
                            >
                              {currencies.map((c) => (
                                <label
                                  key={c}
                                  htmlFor={`currency-${c}`}
                                  className={cn(
                                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                                    field.value === c
                                      ? "border-primary bg-primary/5"
                                      : "border-border hover:bg-muted/40",
                                  )}
                                >
                                  <RadioGroupItem id={`currency-${c}`} value={c} className="mt-0.5" />
                                  <span className="space-y-1">
                                    <span className="block font-medium">{CURRENCY_CHOICES[c].title}</span>
                                    <span className="block text-sm text-muted-foreground">
                                      {CURRENCY_CHOICES[c].body}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </RadioGroup>
                          </FormControl>
                          <FormDescription>
                            Stakes, refunds and every payout happen in this currency. It can&apos;t be
                            changed after the vault opens.
                          </FormDescription>
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
                            Deadline to reach the goal
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="datetime-local"
                              value={deadlineInputValue}
                              onChange={handleDeadlineChange}
                              min={msToDatetimeLocal(MIN_DEADLINE_MS())}
                            />
                          </FormControl>
                          <FormDescription>
                            If the goal isn&apos;t reached by then, the vault closes and everyone who
                            staked can collect their stake back in full.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <DepositField
                      currency={selectedCurrency}
                      xlmUsd={xlmUsd ?? null}
                      goal={milestoneSum}
                      minPct={minPct}
                      minDeposit={minBondRequired}
                      deposit={numericBond}
                      choice={depositChoice}
                      onChoose={chooseDeposit}
                      minChangedTo={minChangedTo}
                      isValid={isBondValid}
                    />
                  </section>

                  {costCard("lg:hidden")}

                  <div className="space-y-2">
                    <div className="flex justify-end">
                      {/* The pending state swaps the icon and the word, never the
                          button, and min-w holds the resting width so nothing
                          reflows. The button is never disabled for a reason it
                          can't show: a deposit below the minimum or a missing
                          step opens the dialog that says what to fix. */}
                      <Button
                        type="submit"
                        size="lg"
                        disabled={isSubmitPending || isSubmittingRef.current || priorLaunchTitle !== null}
                        aria-busy={isSubmitPending}
                        className="w-full gap-2 sm:w-auto sm:min-w-[240px]"
                      >
                        {isSubmitPending && <CubeSpinner size="small" />}
                        {isSubmitPending ? "Opening…" : "Review and open the vault"}
                      </Button>
                    </div>
                    {/* What the opening is doing, so the button never has to say it. */}
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
                        Checking on your last vault opening for “{priorLaunchTitle}” before you start
                        another…
                      </p>
                    )}
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
          <aside className="hidden lg:sticky lg:top-24 lg:block">{costCard()}</aside>
        </div>
      </div>
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
        onActivate={handleActivate}
      />
      <LaunchBlockedDialog problems={launchProblems} onClose={() => setLaunchProblems(null)} />
      <LaunchReviewDialog review={launchReview} onDecide={decideReview} />
    </>
  );
}