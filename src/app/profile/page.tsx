"use client";

import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { getBalance } from "@/lib/stellar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/auth/WalletButton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ProjectCard } from "@/components/project/ProjectCard";
import {
  Copy,
  Wallet,
  Coins,
  Replace,
  Cog,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  Check,
  TrendingUp,
  Lock,
  AlertTriangle,
  PieChart,
  Plus,
  ArrowUpDown,
  LinkIcon,
  Flame,
  Zap,
  Shield,
  ArrowDownCircle,
  Users,
  Send,
} from "lucide-react";
import type { Project, WebState, FundReceipt } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useTransition, useState, useMemo, useCallback } from "react";
import Loading from "@/app/loading";
import { formatCurrency } from "@/lib/formatters";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";
import { Separator } from "@/components/ui/separator";
import { useCurrency } from "@/context/CurrencyContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CurrencyIcon } from "@/components/layout/CurrencyIcon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { CubeSpinner } from "@/components/ui/CubeSpinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import {
  useProjects,
  usePlatformInfo,
  useUserFunds,
} from "@/context/BlockchainContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";



import { getMyKycStatus, submitMilestoneProof } from "@/app/actions";
import { Client as IdentityClient } from "@/packages/blkfndr_identity/src";
import { ShieldCheck } from "lucide-react";

type ProjectVisibilityFilter = "all" | "public" | "private";

const FreighterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <rect width="24" height="24" rx="5.5" fill="#5C3CFA" />
    <defs>
      <filter id="keyShadow" x="-20%" y="-20%" width="150%" height="150%">
        <feDropShadow dx="0.8" dy="1.2" stdDeviation="0.6" floodColor="#1E0066" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#keyShadow)">
      <path d="M 7 5 A 4 4 0 1 0 7 13 A 4 4 0 1 0 7 5 Z M 7 7 A 2 2 0 1 1 7 11 A 2 2 0 1 1 7 7 Z" fillRule="evenodd" fill="white" />
      <rect x="10" y="8" width="10" height="2" rx="0.5" fill="white" />
      <rect x="14" y="10" width="2" height="3" rx="0.5" fill="white" />
      <rect x="17.5" y="10" width="2" height="3" rx="0.5" fill="white" />
    </g>
    <g filter="url(#keyShadow)">
      <path d="M 17 11 A 4 4 0 1 0 17 19 A 4 4 0 1 0 17 11 Z M 17 13 A 2 2 0 1 1 17 17 A 2 2 0 1 1 17 13 Z" fillRule="evenodd" fill="white" />
      <rect x="4" y="14" width="10" height="2" rx="0.5" fill="white" />
      <rect x="4.5" y="11" width="2" height="3" rx="0.5" fill="white" />
      <rect x="8" y="11" width="2" height="3" rx="0.5" fill="white" />
    </g>
  </svg>
);

const COIN_DECIMALS: Record<string, number> = {
  XLM: 10_000_000,
  USDC: 10_000_000,
};

// Global cache for investment receipts to prevent redundant network fetches across cards
let receiptsCache: any[] | null = null;
let receiptsCachePromise: Promise<any[]> | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 30000; // 30 seconds cache TTL

function clearReceiptsCache() {
  receiptsCache = null;
  receiptsCachePromise = null;
  lastFetchTime = 0;
}

async function getCachedFundReceipts(
  fetchFn: () => Promise<any[]>,
  force = false,
): Promise<any[]> {
  const now = Date.now();
  if (force || !receiptsCachePromise || now - lastFetchTime > CACHE_TTL) {
    lastFetchTime = now;
    receiptsCachePromise = fetchFn()
      .then((res) => {
        receiptsCache = res;
        return res;
      })
      .catch((err) => {
        receiptsCachePromise = null;
        lastFetchTime = 0;
        throw err;
      });
  }
  return receiptsCachePromise;
}

// ─── Project Investors Card ──────────────────────────────────────────────────

type InvestorInfo = {
  address: string;
  name: string;
  avatarUrl: string;
  totalAmount: number;
  currency: string;
};

function ProjectInvestorsCard({
  project,
  allReceipts,
}: {
  project: Project;
  allReceipts: any[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [investorProfiles, setInvestorProfiles] = useState<
    Record<string, { name: string; avatarUrl: string }>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const currency = (project.currencyType ?? "XLM").toUpperCase();
  const decimals = COIN_DECIMALS[currency] ?? 10_000_000;

  // Filter and map receipts for this specific project synchronously
  const receipts = useMemo(() => {
    const data = allReceipts.filter(
      (r) =>
        r &&
        r.project_id !== undefined &&
        r.project_id !== null &&
        r.fund_id !== undefined &&
        r.fund_id !== null &&
        r.amount !== undefined &&
        r.amount !== null &&
        r.project_id.toString() === project.id.toString(),
    );

    return data.map((r) => ({
      fund_id: r.fund_id.toString(),
      contributor: r.contributor,
      project_id: r.project_id.toString(),
      project_title: project.title,
      image_url: project.imageUrl || "",
      amount: r.amount.toString(),
      usdc_amount: r.amount.toString(),
      share_percentage: (r.share_percentage ?? 0).toString(),
      fee_paid: (r.fee_paid ?? 0).toString(),
      fund_date: Number(r.fund_date ?? 0) * 1000,
      currency_type: project.currencyType || "XLM",
    }));
  }, [allReceipts, project.id, project.title, project.imageUrl, project.currencyType]);

  // Fetch profiles only for the unique investors of this project
  useEffect(() => {
    let cancelled = false;
    async function loadProfiles() {
      const uniqueAddresses = [...new Set(receipts.map((r) => r.contributor))];
      if (uniqueAddresses.length === 0) return;

      setIsLoading(true);
      try {
        const res = await fetch("/api/user-by-addresses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: uniqueAddresses }),
        });
        const json = await res.json();
        if (cancelled) return;

        const normalizedProfiles: Record<
          string,
          { name: string; avatarUrl: string }
        > = {};

        Object.keys(json).forEach((addr) => {
          const u = json[addr];
          normalizedProfiles[addr] = {
            name: u.name || addr,
            avatarUrl: u.creatorAvatar || "",
          };
        });

        if (!cancelled) setInvestorProfiles(normalizedProfiles);
      } catch (e) {
        console.error("Failed to load investor profiles:", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [receipts]);

  const investors: InvestorInfo[] = useMemo(() => {
    const map: Record<string, InvestorInfo> = {};
    for (const r of receipts) {
      const addr = r.contributor;
      const profile = investorProfiles[addr];
      if (!map[addr]) {
        map[addr] = {
          address: addr,
          name: profile?.name ?? addr,
          avatarUrl:
            profile?.avatarUrl || `https://i.pravatar.cc/150?u=${addr}`,
          totalAmount: 0,
          currency,
        };
      }
      map[addr].totalAmount += Number(r.amount);
    }
    return Object.values(map).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [receipts, investorProfiles, currency]);

  const totalRaised =
    investors.reduce((sum, f) => sum + f.totalAmount, 0) / decimals;

  const handleCopy = (val: string) => {
    navigator.clipboard.writeText(val);
    toast({ title: "Copied", description: "Address copied to clipboard" });
  };

  return (
    <Card className="overflow-hidden flex flex-col h-full">
      <div className="relative h-40 w-full shrink-0">
        <ImageWithFallback
          src={project.imageUrl || ""}
          alt={project.title}
          className="w-full h-full object-cover"
          fill
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4">
          <p className="font-bold text-white text-base leading-tight truncate">
            {project.title}
          </p>
          <div className="flex items-center gap-3 mt-1 text-[10px] uppercase tracking-wider font-semibold text-white/70">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {investors.length} Funders
            </span>
            <span>·</span>
            <span className="text-[#16A34A] font-bold">
              {totalRaised.toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}{" "}
              {currency}
            </span>
          </div>
        </div>
      </div>

      <CardContent className="p-0 flex-grow">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium hover:bg-muted/50 transition-colors"
            >
              <span className="text-muted-foreground">
                View Funders List
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-w-[95vw] border border-border bg-card p-6 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-accent flex items-center gap-2 font-headline">
                {project.title}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Manage and view all supporters who have invested in this project.
              </DialogDescription>
            </DialogHeader>

            {/* Scrollable list of investors */}
            <div className="flex-grow overflow-y-auto space-y-3 py-4 pr-1">
              {isLoading ? (
                <div className="flex justify-center p-8">
                  <CubeSpinner size="large" />
                </div>
              ) : investors.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No funders found.</p>
              ) : (
                investors.map((f) => (
                  <div
                    key={f.address}
                    className="flex items-center justify-between gap-3 p-3 bg-accent/5 dark:bg-accent/10 border border-accent/10 rounded-xl hover:bg-accent/10 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={f.avatarUrl} alt={f.name} />
                        <AvatarFallback>
                          {f.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate flex items-center gap-1.5 text-foreground">
                          {f.name === f.address
                            ? `${f.address.slice(0, 6)}...${f.address.slice(-4)}`
                            : f.name}
                        </p>
                        <div className="flex items-center gap-1">
                          <p className="font-mono text-[10px] text-muted-foreground truncate max-w-[100px]">
                            {f.address.slice(0, 10)}...
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleCopy(f.address)}
                          >
                            <Copy className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs font-bold text-[#16A34A] shrink-0">
                      {(f.totalAmount / decimals).toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {currency}
                    </p>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}



// ─── Stellar Wallet Info Card ────────────────────────────────────────────────

function StellarWalletDetailsCard({ address }: { address: string }) {
  const [balances, setBalances] = useState<
    { asset: string; balance: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [triggerRefresh, setTriggerRefresh] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (!address) return;
    let active = true;
    async function fetchBalances() {
      setIsLoading(true);
      try {
        const stellarBalances = await getBalance(address);
        if (!active) return;

        const mapped = stellarBalances.map((b: any) => {
          if (b.asset_type === "native") {
            return { asset: "XLM", balance: parseFloat(b.balance).toFixed(4) };
          }
          return {
            asset: b.asset_code || "Unknown",
            balance: parseFloat(b.balance).toFixed(4),
          };
        });
        setBalances(mapped);
      } catch (err) {
        console.error("Failed to fetch Stellar balances:", err);
        if (active) {
          setBalances([{ asset: "XLM", balance: "0.0000 (Inactive)" }]);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    fetchBalances();
    return () => {
      active = false;
    };
  }, [address, triggerRefresh]);

  const handleFundFriendbot = async () => {
    setIsFunding(true);
    try {
      const res = await fetch(`https://friendbot.stellar.org/?addr=${address}`);
      if (res.ok) {
        toast({
          title: "Account Funded!",
          description:
            "Received 10,000 testnet XLM successfully. Refreshing balances...",
        });
        setTriggerRefresh((prev) => prev + 1);
      } else {
        throw new Error("Friendbot failed");
      }
    } catch (err) {
      toast({
        title: "Funding Failed",
        description: "Could not contact Friendbot. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <Card className="border border-border/40 bg-card/40 backdrop-blur-md overflow-hidden rounded-2xl shadow-lg">
      <CardHeader className="pb-4">
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Coins className="h-5 w-5 text-accent" />
              Stellar Asset Balances
            </CardTitle>
            <CardDescription>
              Your token balances on the Stellar Testnet.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleFundFriendbot}
              disabled={isFunding}
              className="border-accent/30 hover:border-accent/60 hover:bg-accent/10 text-accent font-medium"
            >
              {isFunding ? (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Funding...
                </>
              ) : (
                <>
                  <Flame className="mr-2 h-3.5 w-3.5" />
                  Get testnet XLM
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTriggerRefresh((prev) => prev + 1)}
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <CubeSpinner size="large" />
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {balances.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No balances found. Make sure your account is funded.
              </div>
            ) : (
              balances.map((b) => (
                <div
                  key={b.asset}
                  className="flex justify-between items-center py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent/10 rounded-lg">
                      <Coins className="h-4 w-4 text-accent" />
                    </div>
                    <div>
                      <p className="font-semibold text-base">{b.asset}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.asset === "XLM"
                          ? "Stellar Native Asset"
                          : "Soroban Token"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-foreground">
                      {b.balance}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Stellar Recent Activity Card ────────────────────────────────────────────

function StellarRecentActivityCard({ address }: { address: string }) {
  const [payments, setPayments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let active = true;
    async function fetchPayments() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `https://horizon-testnet.stellar.org/accounts/${address}/payments?limit=5&order=desc`,
        );
        if (res.status === 404) {
          if (active) {
            setPayments([]);
          }
          return;
        }
        if (!res.ok) {
          if (active) {
            setError("Failed to fetch payments");
          }
          return;
        }
        const data = await res.json();
        if (!active) return;

        const records = data._embedded?.records || [];
        const mapped = records.map((r: any) => {
          const type = r.type;
          let asset = "XLM";
          const amount = r.amount || "0";
          const success = r.transaction_successful !== false;

          if (r.asset_code) {
            asset = r.asset_code;
          }

          return {
            id: r.id,
            txHash: r.transaction_hash,
            type: type.replace(/_/g, " "),
            amount: parseFloat(amount).toFixed(2),
            asset,
            success,
            time: r.created_at ? new Date(r.created_at) : new Date(),
          };
        });
        setPayments(mapped);
      } catch (err) {
        console.error("Failed to fetch payments:", err);
        if (active) {
          setError("Failed to fetch transactions");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    fetchPayments();
    return () => {
      active = false;
    };
  }, [address]);

  return (
    <Card className="border border-border/40 bg-card/40 backdrop-blur-md overflow-hidden rounded-2xl shadow-lg mt-6">
      <CardHeader>
        <div>
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-accent" />
            Recent Payments
          </CardTitle>
          <CardDescription>
            Your last 5 payment transactions on the testnet.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transaction Hash</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                  <CubeSpinner size="large" />
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground py-6"
                >
                  No transaction history found. Fund your wallet or make a
                  transaction to see records.
                </TableCell>
              </TableRow>
            ) : payments.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center py-6 text-muted-foreground"
                >
                  No transaction history found.
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${p.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-accent hover:text-[#D62828] hover:underline truncate block max-w-[200px]"
                    >
                      {p.txHash.slice(0, 8)}...{p.txHash.slice(-8)}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={p.success ? "default" : "destructive"}
                      className="capitalize"
                    >
                      {p.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-semibold">
                    {p.amount} {p.asset}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDistanceToNow(p.time, { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Receipt Card (grouped by project) ──────────────────────────────────────

function ReceiptCard({
  receipts: groupReceipts,
  project,
  onBurned,
}: {
  receipts: FundReceipt[];
  project?: Project;
  onBurned: (id: string) => void;
}) {
  const { toast } = useToast();
  const { claimRefund } = useStellarContract();
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const { freighterWalletAddress } = useFreighterWallet();
  const { user } = useAuth();
  const activeAddress = freighterWalletAddress || user?.stellarPublicKey || "";

  useEffect(() => {
    if (activeAddress && project?.vaultAddress && (project.status === "failed" || project.status === "refunding")) {
      const checkVaultBalance = async () => {
        try {
          const client = new VaultClient({
            contractId: project.vaultAddress!,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
            publicKey: activeAddress,
          });
          const balanceTx = await client.get_balance({ contributor: activeAddress });
          const balanceVal = await balanceTx.simulate();
          const balNum = Number(balanceVal.result || 0);
          setVaultBalance(balNum);
        } catch (e) {
          console.error("Failed to query vault balance:", e);
          setVaultBalance(0);
        }
      };
      checkVaultBalance();
    } else {
      setVaultBalance(null);
    }
  }, [activeAddress, project?.vaultAddress, project?.status]);

  const isExpired =
    project?.status === "failed" ||
    project?.status === "refunding";

  const primary = groupReceipts[0];
  const currency = (primary.currency_type ?? "XLM").toUpperCase();
  const decimals = COIN_DECIMALS[currency] ?? 10_000_000;

  const totalAmount = groupReceipts.reduce(
    (sum, r) => sum + Number(r.amount),
    0,
  );
  const totalShares = groupReceipts.reduce(
    (sum, r) => sum + Number(r.share_percentage),
    0,
  );
  const humanAmount = totalAmount / decimals;
  const latestDate = Math.max(
    ...groupReceipts.map((r) => r.fund_date ?? 0),
  );

  const explorerUrl = `https://stellar.expert/explorer/testnet/contract/${project?.vaultAddress ?? ""}`;

  const handleRefund = async (receipt: FundReceipt) => {
    if (!project || !project.vaultAddress) {
      toast({
        title: "Refund Failed",
        description: "Vault address is missing for this project.",
        variant: "destructive",
      });
      return;
    }
    setRefundingId(receipt.fund_id);
    try {
      const result = await claimRefund({
        vaultAddress: project.vaultAddress,
      });

      const txStatus = (result as any)?.getTransactionResponse?.status;
      if (txStatus !== "SUCCESS") {
        throw new Error("Refund transaction failed on-chain.");
      }

      toast({
        title: "Refund Successful",
        description: "Your contribution has been successfully refunded.",
      });
      // Receipt is burned on-chain as part of the refund, remove it from UI
      onBurned(receipt.fund_id);
    } catch (error: any) {
      console.error("Refund failed:", error);
      toast({
        title: "Refund Failed",
        description: error.message || "Could not complete refund on-chain.",
        variant: "destructive",
      });
    } finally {
      setRefundingId(null);
    }
  };

  const ReceiptActions = ({
    receipt,
    size = "sm",
  }: {
    receipt: FundReceipt;
    size?: "sm" | "default";
  }) => {
    const humanAmt = (Number(receipt.amount) / decimals).toLocaleString(
      undefined,
      {
        maximumFractionDigits: 4,
      },
    );
    const receiptCurrency = (receipt.currency_type ?? "XLM").toUpperCase();

    return (
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button
            variant="ghost"
            size={size}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              size === "sm" && "h-6 px-2",
            )}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View
          </Button>
        </a>

        {isExpired && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size={size}
                className={cn(
                  "text-green-600 hover:text-green-600 hover:bg-green-500/10",
                  size === "sm" && "h-6 px-2",
                )}
                disabled={refundingId === receipt.fund_id || vaultBalance === 0}
              >
                {refundingId === receipt.fund_id ? (
                  <CubeSpinner />
                ) : (
                  <>
                    <ArrowDownCircle className="h-3 w-3 mr-1" />
                    {vaultBalance === 0 ? "Refunded" : "Refund"}
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Claim Refund?</AlertDialogTitle>
                <AlertDialogDescription>
                  This project expired without reaching its goal. You can claim
                  back your{" "}
                  <strong>
                    {humanAmt} {receiptCurrency}
                  </strong>
                  . Your receipt will be burned automatically in the same
                  transaction.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleRefund(receipt)}>
                  Yes, claim refund
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    );
  };

  return (
    <Card className="overflow-hidden flex flex-col h-full">
      <div className="relative h-40 w-full shrink-0">
        <ImageWithFallback
          src={primary.image_url || ""}
          alt={primary.project_title || "Project"}
          className="w-full h-full object-cover"
          fill
        />
        {groupReceipts.length > 1 && (
          <div className="absolute top-2 right-2">
            <Badge className="bg-black/70 text-white border-0">
              {groupReceipts.length} receipts
            </Badge>
          </div>
        )}
        {isExpired && (
          <div className="absolute top-2 left-2">
            <Badge className="bg-orange-500/90 text-white border-0">
              Expired — Refund Available
            </Badge>
          </div>
        )}
      </div>

      <CardContent className="p-4 flex-grow flex flex-col gap-4">
        {/* Title and Total Amount on the right */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-grow">
            <p className="font-bold text-base leading-tight truncate">
              {primary.project_title || "Unknown Project"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {latestDate
                ? formatDistanceToNow(new Date(latestDate), { addSuffix: true })
                : "Date unknown"}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Total Funded</p>
            <p className="font-bold text-sm text-[#16A34A]">
              {humanAmount.toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}{" "}
              {currency}
            </p>
          </div>
        </div>

        {groupReceipts.length > 1 ? (
          <div className="mt-auto pt-2 border-t">
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 w-full font-medium"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Show {groupReceipts.length} individual receipts
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg max-w-[95vw] border border-border bg-card p-6 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold text-accent flex items-center gap-2 font-headline">

                    {primary.project_title || "Project"}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground mt-1">
                    Manage and view all your investment receipts for this project.
                  </DialogDescription>
                </DialogHeader>

                {/* Scrollable list of receipts */}
                <div className="flex-grow overflow-y-auto space-y-3 py-4 pr-1">
                  {groupReceipts.map((r) => (
                    <div
                      key={r.fund_id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-accent/5 dark:bg-accent/10 border border-accent/10 rounded-xl hover:bg-accent/10 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <p className="font-headline font-bold text-xs text-[#2E86C1] flex items-center gap-1">
                            Receipt <span className="font-mono text-[10px] text-[#D62828] font-bold bg-accent/10 px-1.5 py-0.5 rounded-md">(SBT-{r.fund_id})</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t sm:border-t-0 pt-1.5 sm:pt-0">
                        <p className="font-bold text-xs text-foreground">
                          {(Number(r.amount) / decimals).toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })}{" "}
                          {currency}
                        </p>
                        <ReceiptActions receipt={r} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>


              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <div className="mt-auto pt-3 border-t flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground font-mono bg-muted/40 px-2 py-1 rounded-md">
              (SBT-{primary.fund_id})
            </p>
            <ReceiptActions receipt={primary} size="sm" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const { freighterWalletAddress, login: connectFreighter } = useFreighterWallet();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { projects, isLoadingProjects } = useProjects();
  const { platformInfo, isLoadingPlatform } = usePlatformInfo();
  const [isConnectingFreighter, setIsConnectingFreighter] = useState(false);

  const handleConnectFreighter = async () => {
    setIsConnectingFreighter(true);
    try {
      await connectFreighter();
      await refreshUser();
      toast({
        title: "Wallet Connected",
        description: "Freighter wallet successfully connected and verified.",
      });
    } catch (err: any) {
      toast({
        title: "Connection Failed",
        description: err.message || "Failed to connect Freighter wallet.",
        variant: "destructive",
      });
    } finally {
      setIsConnectingFreighter(false);
    }
  };

  const activeStellarAddress =
    user?.stellarPublicKey || freighterWalletAddress || "";

  const [kycStatus, setKycStatus] = useState<string>("none");
  const [isOnChainKycApproved, setIsOnChainKycApproved] = useState(false);
  const [isLoadingKyc, setIsLoadingKyc] = useState(false);
  const [isUpdatingProof, setIsUpdatingProof] = useState(false);

  useEffect(() => {
    if (!activeStellarAddress) {
      setKycStatus("none");
      setIsOnChainKycApproved(false);
      return;
    }

    let active = true;
    async function fetchKyc() {
      setIsLoadingKyc(true);
      try {
        const dbRes = await getMyKycStatus();
        if (!active) return;
        if (dbRes.success && dbRes.request) {
          setKycStatus(dbRes.request.status || "none");
        } else {
          setKycStatus("none");
        }

        const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
        const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
        const IDENTITY_ID = process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID || "";

        if (IDENTITY_ID) {
          try {
            const client = new IdentityClient({
              contractId: IDENTITY_ID,
              rpcUrl: SOROBAN_RPC_URL,
              networkPassphrase: NETWORK_PASSPHRASE,
              // The address being queried doubles as the simulation source. The old
              // NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS is unset on the current deployment,
              // and an empty publicKey throws inside the SDK before the registry is
              // ever reached.
              publicKey: activeStellarAddress,
            });
            const checkTx = await client.is_kyc_approved({ address: activeStellarAddress });
            const checkSim = await checkTx.simulate();
            if (!active) return;
            setIsOnChainKycApproved(Boolean(checkSim.result));
          } catch (simulateErr) {
            console.error("Failed to simulate KYC check on-chain:", simulateErr);
            if (active) {
              setIsOnChainKycApproved(false);
            }
          }
        }
      } catch (err) {
        console.error("Error loading KYC status in profile:", err);
      } finally {
        if (active) setIsLoadingKyc(false);
      }
    }

    fetchKyc();
    return () => {
      active = false;
    };
  }, [activeStellarAddress]);

  const {
    userFunds: receipts,
    isLoadingFunds: isLoadingInvestments,
    refreshUserFunds: refreshUserInvestments,
  } = useUserFunds(activeStellarAddress || undefined);

  // Reads the indexer: contributions live in per-project vaults now, so no
  // single contract call returns them all.
  const getAllInvestmentReceipts = useCallback(async () => {
    const res = await fetch("/api/user/funds");
    if (!res.ok) return [];
    return res.json();
  }, []);
  const [allReceipts, setAllReceipts] = useState<any[]>([]);
  const [isLoadingAllReceipts, setIsLoadingAllReceipts] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const tab = searchParams.get("tab") || "projects";

  const refreshActiveInvestments = () => {
    clearReceiptsCache();
    setRefreshTrigger((prev) => prev + 1);
    if (activeStellarAddress) {
      refreshUserInvestments(activeStellarAddress);
    }
  };

  useEffect(() => {
    if (tab === "investors" && activeStellarAddress) {
      let cancelled = false;
      async function loadAllReceipts() {
        setIsLoadingAllReceipts(true);
        try {
          const res = await getCachedFundReceipts(getAllInvestmentReceipts);
          if (!cancelled) {
            setAllReceipts(res);
          }
        } catch (e) {
          console.error("Failed to load on-chain receipts:", e);
        } finally {
          if (!cancelled) {
            setIsLoadingAllReceipts(false);
          }
        }
      }
      loadAllReceipts();
      return () => {
        cancelled = true;
      };
    }
  }, [tab, activeStellarAddress, refreshTrigger, getAllInvestmentReceipts]);

  const [burnedReceiptIds, setBurnedReceiptIds] = useState<string[]>([]);
  const handleReceiptBurned = (id: string) => {
    setBurnedReceiptIds((prev) => [...prev, id]);
  };

  const activeReceipts = useMemo(() => {
    return receipts.filter((r) => !burnedReceiptIds.includes(r.fund_id));
  }, [receipts, burnedReceiptIds]);

  const [projectFilter, setProjectFilter] =
    useState<ProjectVisibilityFilter>("all");

  const [fundedSort, setFundedSort] = useState<
    "date-desc" | "date-asc" | "amount-desc" | "amount-asc"
  >("date-desc");

  const [investorSort, setInvestorSort] = useState<
    "investors-desc" | "investors-asc" | "amount-desc" | "amount-asc"
  >("investors-desc");

  const sortedFundedGroups = useMemo(() => {
    const groupsMap = activeReceipts.reduce((g, r) => {
      (g[r.project_id] = g[r.project_id] || []).push(r);
      return g;
    }, {} as Record<string, FundReceipt[]>);

    const groupsList = Object.values(groupsMap).map((g) => {
      const primary = g[0];
      const currency = (primary.currency_type ?? "XLM").toUpperCase();
      const decimals = COIN_DECIMALS[currency] ?? 10_000_000;
      const totalAmount = g.reduce((sum, r) => sum + Number(r.amount), 0);
      const latestDate = Math.max(...g.map((r) => r.fund_date ?? 0));
      return {
        projectId: primary.project_id,
        receipts: g,
        totalAmount: totalAmount / decimals,
        latestDate,
      };
    });

    return groupsList.sort((a, b) => {
      if (fundedSort === "date-desc") {
        return b.latestDate - a.latestDate;
      }
      if (fundedSort === "date-asc") {
        return a.latestDate - b.latestDate;
      }
      if (fundedSort === "amount-desc") {
        return b.totalAmount - a.totalAmount;
      }
      if (fundedSort === "amount-asc") {
        return a.totalAmount - b.totalAmount;
      }
      return 0;
    });
  }, [activeReceipts, fundedSort]);

  useEffect(() => {
    if (!authLoading && !user) router.push("/");
  }, [user, authLoading, router]);

  const ownedProjects = useMemo(() => {
    if (!user || !activeStellarAddress) return [];
    const userOwned = projects.filter(
      (p) =>
        p.creatorAddress === activeStellarAddress,
    );
    let filtered = userOwned;
    switch (projectFilter) {
      case "public":
        filtered = userOwned.filter((p) => p.isPublic === true);
        break;
      case "private":
        filtered = userOwned.filter((p) => p.isPublic === false);
        break;
      default:
        filtered = userOwned;
        break;
    }

    // Helper to get number of unique investors for a project ID
    const getInvestorsCount = (projectId: string) => {
      const projReceipts = allReceipts.filter(
        (r) =>
          r &&
          r.project_id !== undefined &&
          r.project_id !== null &&
          r.project_id.toString() === projectId.toString(),
      );
      const uniqueInvestors = new Set(projReceipts.map((r) => r.investor));
      return uniqueInvestors.size;
    };

    return [...filtered].sort((a, b) => {
      if (investorSort === "investors-desc") {
        return getInvestorsCount(b.id) - getInvestorsCount(a.id);
      }
      if (investorSort === "investors-asc") {
        return getInvestorsCount(a.id) - getInvestorsCount(b.id);
      }
      if (investorSort === "amount-desc") {
        return b.currentFunding - a.currentFunding;
      }
      if (investorSort === "amount-asc") {
        return a.currentFunding - b.currentFunding;
      }
      return 0;
    });
  }, [projects, user, projectFilter, activeStellarAddress, investorSort, allReceipts]);

  const isLoading = authLoading || isLoadingProjects || isLoadingPlatform;

  if (isLoading || !user) return <Loading />;

  const handleCopyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast({
      title: "Address Copied",
      description: (
        <span className="inline-flex items-baseline gap-1">
          <Wallet className="h-4 w-4 text-accent mr-1" /> Stellar public key
          copied to clipboard.
        </span>
      ),
    });
  };

  const TabHeader = ({
    title,
    description,
    showRefresh,
    rightElement,
  }: {
    title: string;
    description?: string;
    showRefresh?: boolean;
    rightElement?: React.ReactNode;
  }) => (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-accent font-headline">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {rightElement}
        {showRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={refreshActiveInvestments}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="container mx-auto py-12">
      <Card className="mb-8 p-6 bg-transparent border-none shadow-none">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          <div className="md:col-span-1 flex flex-col items-center text-center gap-4">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="h-24 w-24 rounded-full border-4 border-primary"
                />
                {user.role === "admin" && (
                  <div className="absolute bottom-0 right-0 bg-primary text-primary-foreground rounded-full p-1.5 border-2 border-background">
                    <Cog className="h-4 w-4" />
                  </div>
                )}
              </div>
              <div>
                <h1 className="text-2xl font-bold font-headline">
                  {user.name}
                </h1>
                <p className="text-muted-foreground">
                  {user.email || "Freighter Authenticated"}
                </p>
                {activeStellarAddress ? (
                  <span className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-green-600 dark:text-green-400 font-semibold px-2.5 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 shadow-sm">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                    Freighter Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-red-600 dark:text-red-400 font-semibold px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 shadow-sm">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    Wallet Disconnected
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-2 flex flex-col gap-4 items-center w-full">
            {/* Identity Verification Card */}
            {activeStellarAddress && (
              <Card className="relative overflow-hidden w-full border border-border bg-card/40 backdrop-blur-md p-6 shadow-xl rounded-2xl">
                <div className="absolute top-0 right-0 -mr-16 -mt-16 h-32 w-32 rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="shrink-0 shadow-lg rounded-xl overflow-hidden bg-primary/10 p-3">
                      <ShieldCheck className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-foreground">
                        Identity Verification
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Attest your identity on the Stellar network
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {isLoadingKyc ? (
                      <span className="text-xs text-muted-foreground">Checking status...</span>
                    ) : isOnChainKycApproved ? (
                      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs py-1 px-3 font-semibold">
                        Verified On-Chain
                      </Badge>
                    ) : kycStatus === "pending" ? (
                      <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs py-1 px-3 font-semibold">
                        Pending Admin Review
                      </Badge>
                    ) : kycStatus === "rejected" ? (
                      <Badge className="bg-destructive/10 text-destructive border border-destructive/20 text-xs py-1 px-3 font-semibold">
                        Rejected - Resubmit
                      </Badge>
                    ) : (
                      <Badge className="bg-secondary text-muted-foreground border border-border text-xs py-1 px-3 font-semibold">
                        Not Verified
                      </Badge>
                    )}

                    <Button asChild variant="outline" size="sm" className="border-primary/20 hover:border-primary/50 text-xs font-semibold">
                      <Link href="/profile/kyc-attestation">
                        {isOnChainKycApproved ? "View Attestation" : kycStatus === "pending" ? "Check Details" : "Verify Identity"}
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </Card>

      <Tabs
        defaultValue={tab}
        className="w-full"
        onValueChange={(v) => router.push(`/profile?tab=${v}`)}
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="funded">Funded</TabsTrigger>
          <TabsTrigger value="investors">Funders</TabsTrigger>
          <TabsTrigger value="wallet">Wallet</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="bg-card border rounded-lg p-6">
          <TabHeader title="My Projects" />
          {ownedProjects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {ownedProjects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          ) : (
            <CardContent className="p-10 text-center">
              <p className="text-muted-foreground">No projects found.</p>
              <Button asChild className="mt-4">
                <Link href="/create-listing">Create Project</Link>
              </Button>
            </CardContent>
          )}
        </TabsContent>

        <TabsContent value="funded" className="bg-card border rounded-lg p-6">
          <TabHeader
            title="Projects I've Funded"
            showRefresh
            rightElement={
              <Select value={fundedSort} onValueChange={(v: any) => setFundedSort(v)}>
                <SelectTrigger className="w-[190px] bg-background border-input hover:bg-accent hover:text-accent-foreground transition-colors text-xs font-semibold h-9 rounded-lg">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc">Latest Funded</SelectItem>
                  <SelectItem value="date-asc">Oldest Funded</SelectItem>
                  <SelectItem value="amount-desc">Largest Funded</SelectItem>
                  <SelectItem value="amount-asc">Smallest Funded</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          {isLoadingInvestments ? (
            <CubeSpinner size="large" />
          ) : sortedFundedGroups.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
              {sortedFundedGroups.map((group) => (
                <ReceiptCard
                  key={group.projectId}
                  receipts={group.receipts}
                  project={projects.find((p) => p.id === group.projectId)}
                  onBurned={handleReceiptBurned}
                />
              ))}
            </div>
          ) : (
            <p className="text-center py-10 text-muted-foreground">
              No funded projects.
            </p>
          )}
        </TabsContent>

        {/* ── Investors Tab ── */}
        <TabsContent value="investors" className="bg-card border rounded-lg p-6">
          <TabHeader
            title="Funders Dashboard"
            description="Manage and view all supporters who have invested in your specific projects."
            rightElement={
              <Select value={investorSort} onValueChange={(v: any) => setInvestorSort(v)}>
                <SelectTrigger className="w-[190px] bg-background border-input hover:bg-accent hover:text-accent-foreground transition-colors text-xs font-semibold h-9 rounded-lg">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investors-desc">Most Funders</SelectItem>
                  <SelectItem value="investors-asc">Least Funders</SelectItem>
                  <SelectItem value="amount-desc">Largest Amount Raised</SelectItem>
                  <SelectItem value="amount-asc">Smallest Amount Raised</SelectItem>
                </SelectContent>
              </Select>
            }
          />

          {isLoadingProjects || isLoadingInvestments || isLoadingAllReceipts ? (
            <div className="flex justify-center p-12">
              <CubeSpinner size="large" />
            </div>
          ) : ownedProjects.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/10">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-20" />
              <p className="text-muted-foreground">
                You haven't created any projects yet.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start mt-6">
              {ownedProjects.map((project) => (
                <ProjectInvestorsCard
                  key={project.id}
                  project={project}
                  allReceipts={allReceipts}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="wallet" className="bg-card border rounded-lg p-6">
          <TabHeader title="Wallet Details" />
          {!activeStellarAddress ? (
            <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-dashed border-border bg-muted/20 text-center space-y-4 max-w-md mx-auto my-6 shadow-inner">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Wallet className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-semibold text-foreground">
                  Wallet Disconnected
                </h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Please connect your Freighter wallet to view details, testnet balances, and transaction history.
                </p>
              </div>
              <Button
                onClick={handleConnectFreighter}
                disabled={isConnectingFreighter}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6 h-10 rounded-lg flex items-center gap-2 transition-all w-full justify-center"
              >
                {isConnectingFreighter ? (
                  "Connecting..."
                ) : (
                  <>
                    <FreighterIcon className="h-4 w-4" />
                    Connect Freighter Wallet
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Freighter Wallet Card */}
              <Card className="relative overflow-hidden w-full border border-border bg-card/40 backdrop-blur-md p-6 shadow-xl rounded-2xl">
                {/* Decorative background glow */}
                <div className="absolute top-0 right-0 -mr-16 -mt-16 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />
                <div className="absolute bottom-0 left-0 -ml-16 -mb-16 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />

                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="shrink-0 shadow-lg rounded-xl overflow-hidden">
                      <FreighterIcon className="h-14 w-14" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-foreground">
                        Freighter Wallet
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Your authenticated Stellar public key on Testnet
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 min-w-0 md:max-w-md w-full md:w-auto">
                    <div className="flex items-center justify-between bg-black/10 dark:bg-black/20 rounded-xl px-4 py-3 border border-border">
                      <span className="font-mono text-sm truncate text-foreground select-all pr-4">
                        {activeStellarAddress}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 hover:bg-muted"
                                onClick={() =>
                                  handleCopyAddress(activeStellarAddress)
                                }
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Copy Address</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={`https://stellar.expert/explorer/testnet/account/${activeStellarAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex"
                              >
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 hover:bg-muted"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>
                              View on Stellar.Expert
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              <StellarWalletDetailsCard address={activeStellarAddress} />
              <StellarRecentActivityCard address={activeStellarAddress} />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

