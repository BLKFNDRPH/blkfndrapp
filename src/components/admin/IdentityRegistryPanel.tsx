"use client";

import { useCallback, useEffect, useState } from "react";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useToast } from "@/hooks/use-toast";
import { Client as IdentityClient } from "@/packages/blkfndr_identity/src";
import { getKycRequests, updateKycRequestStatus } from "@/app/actions";
import { getIPFSGatewayUrl } from "@/lib/pinata-client";
import {
  Shield,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  UserCheck,
  FileCode,
  Copy,
  RotateCw,
  ZoomIn,
  ZoomOut,
  AlertTriangle
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { usePlatformInfo } from "@/context/BlockchainContext";
import { signTransaction, signAuthEntry } from "@stellar/freighter-api";
import { cn } from "@/lib/utils";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const IDENTITY_ID = process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID || "";
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

export function IdentityRegistryPanel() {
  const { freighterWalletAddress } = useFreighterWallet();
  const { toast } = useToast();
  const { platformInfo } = usePlatformInfo();

  const [loading, setLoading] = useState(false);
  const [kycRequests, setKycRequests] = useState<any[]>([]);

  // Lightbox State
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxRotation, setLightboxRotation] = useState<number>(0);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);

  // Rejection State
  const [rejectionTarget, setRejectionTarget] = useState<string | null>(null);
  const [selectedRejectionReason, setSelectedRejectionReason] = useState<string>("Blurry/Low Quality");
  const [customReason, setCustomReason] = useState<string>("");

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: `${label} has been copied to your clipboard.`,
    });
  };

  const isPrimaryAdmin =
    freighterWalletAddress === (platformInfo?.admin || ALLOWED_ADMIN);

  const fetchKycRequests = useCallback(async () => {
    try {
      const res = await getKycRequests();
      if (res.success && res.requests) {
        setKycRequests(res.requests);
      } else {
        toast({
          title: "Failed to load KYC requests",
          description: (res as { error?: string }).error || "Unknown server error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error("Failed to fetch KYC requests:", err);
      toast({
        title: "Failed to load KYC requests",
        description: err.message || String(err),
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    fetchKycRequests();
  }, [fetchKycRequests]);

  const handleApproveRequest = async (address: string) => {
    if (!freighterWalletAddress) return;
    setLoading(true);
    try {
      const client = new IdentityClient({
        contractId: IDENTITY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: freighterWalletAddress,
        ...getSignerOptions(freighterWalletAddress),
      });

      const checkTx = await client.is_kyc_approved({ address });
      const checkSim = await checkTx.simulate();
      const isApprovedOnChain = checkSim.result;

      if (isApprovedOnChain) {
        await updateKycRequestStatus(address, "approved");
        toast({
          title: "Approved and Synced",
          description: `KYC for ${address.slice(0, 6)}... has been synced as approved.`,
        });
        fetchKycRequests();
        return;
      }

      const req = kycRequests.find((r) => r.address === address);
      const hashBuffer = req?.detailsHash
        ? Buffer.from(req.detailsHash, "hex")
        : Buffer.alloc(32);

      const tx = await client.attest({
        address,
        kyc_hash: hashBuffer,
      });

      await tx.signAndSend();
      await updateKycRequestStatus(address, "approved");

      toast({
        title: "Attested and Approved",
        description: `KYC successfully approved for ${address.slice(0, 6)}... on-chain.`,
      });
      fetchKycRequests();
    } catch (err: any) {
      const errStr = String(err);
      if (errStr.includes("AlreadyAttested") || errStr.includes("Contract, #12")) {
        await updateKycRequestStatus(address, "approved");
        toast({
          title: "Approved and Synced",
          description: `KYC for ${address.slice(0, 6)}... has been synced as approved.`,
        });
        fetchKycRequests();
        return;
      }
      toast({
        title: "Attestation Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRejectRequest = async (address: string, reason: string) => {
    setLoading(true);
    try {
      await updateKycRequestStatus(address, "rejected", reason);
      toast({
        title: "Request Rejected",
        description: `KYC request for ${address.slice(0, 6)}... has been rejected. Reason: ${reason}`,
      });
      setRejectionTarget(null);
      setSelectedRejectionReason("Blurry/Low Quality");
      setCustomReason("");
      fetchKycRequests();
    } catch (err: any) {
      toast({
        title: "Rejection Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeRequest = async (address: string) => {
    if (!freighterWalletAddress) return;
    setLoading(true);
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

      await tx.signAndSend();
      await updateKycRequestStatus(address, "rejected");

      toast({
        title: "Attestation Revoked",
        description: `KYC has been revoked for ${address.slice(0, 6)}... on-chain.`,
      });
      fetchKycRequests();
    } catch (err: any) {
      toast({
        title: "Revocation Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const pendingList = kycRequests.filter((r) => r.status === "pending");
  const approvedList = kycRequests.filter((r) => r.status === "approved");

  const [showApproved, setShowApproved] = useState(false);

  return (
    <div className="space-y-8">
      {/* ─── Primary Section: Pending KYC Requests ─── */}
      <Card className="border bg-card/60 backdrop-blur-sm overflow-hidden">
        <CardHeader className="border-b bg-muted/20 p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Shield className="h-5 w-5 text-amber-500" /> Pending KYC Requests
              </CardTitle>
              <CardDescription className="text-sm">
                Review identity documents and verify creators on-chain.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {!isPrimaryAdmin && (
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wider font-semibold">
                  Read-Only
                </Badge>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={fetchKycRequests}
                disabled={loading}
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <div className="flex-1 overflow-y-auto max-h-[75vh] p-6 md:p-8 space-y-6">
          {pendingList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <FileCode className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <h3 className="text-base font-semibold text-foreground">No Pending Requests</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1.5">
                All creator attestation submissions have been processed. New requests will appear here.
              </p>
            </div>
          ) : (
            pendingList.map((req) => (
              <div
                key={req._id}
                className="border border-border/80 bg-background/50 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Split-Pane: Data + Image (stack image above data on mobile) */}
                <div className="flex flex-col-reverse md:flex-row">
                  {/* Left Data Column */}
                  <div className="flex-1 p-6 md:p-8 space-y-6">
                    {/* Wallet Address Header */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-foreground break-all select-all">
                          {req.address}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopy(req.address, "Wallet address")}
                          className="h-6 w-6 hover:bg-muted text-muted-foreground rounded-md shrink-0"
                          title="Copy Wallet Address"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* 2×2 Data Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-6">
                      {/* Top Row: Name and Email */}
                      <div className="space-y-1">
                        <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
                          Full Name
                        </span>
                        <p className="text-lg font-bold text-foreground leading-snug">
                          {req.fullName || "N/A"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
                          Email Address
                        </span>
                        <p className="text-base font-semibold text-foreground">
                          {req.email || "N/A"}
                        </p>
                      </div>

                      {/* Bottom Row: ID Type and Submission ID */}
                      <div className="space-y-1">
                        <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
                          ID Document Type
                        </span>
                        <p className="text-base font-semibold text-foreground capitalize">
                          {req.documentType?.replace("_", " ") || "N/A"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
                            Submission ID
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopy(req._id, "Submission ID")}
                            className="h-4 w-4 hover:bg-muted text-muted-foreground rounded-md shrink-0"
                            title="Copy Submission ID"
                          >
                            <Copy className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                        <p className="text-sm font-mono font-semibold text-foreground select-all break-all">
                          {req._id}
                        </p>
                      </div>
                    </div>

                    {/* Compliance Details Section */}
                    {(req.idNumber || req.dob || req.expiryDate || req.residentialAddress) && (
                      <div className="border-t border-border/40 pt-5 space-y-4">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Compliance Data</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4">
                          {req.idNumber && (
                            <div className="space-y-1">
                              <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
                                ID Number
                              </span>
                              <p className="text-sm font-semibold font-mono text-foreground select-all">{req.idNumber}</p>
                            </div>
                          )}
                          {req.dob && (
                            <div className="space-y-1">
                              <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
                                Date of Birth
                              </span>
                              <p className="text-sm font-semibold text-foreground">
                                {new Date(req.dob).toLocaleDateString()}
                              </p>
                            </div>
                          )}
                          {req.expiryDate && (
                            <div className="space-y-1">
                              <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
                                ID Expiry Date
                              </span>
                              <div className="flex items-center gap-2">
                                <p className={cn(
                                  "text-sm font-semibold",
                                  new Date(req.expiryDate) < new Date() ? "text-rose-500 font-bold" : "text-foreground"
                                )}>
                                  {new Date(req.expiryDate).toLocaleDateString()}
                                </p>
                                {new Date(req.expiryDate) < new Date() && (
                                  <Badge variant="destructive" className="text-[9px] font-bold uppercase tracking-wider py-0.5 px-1.5 shrink-0 bg-rose-500/10 text-rose-500 border border-rose-500/20">
                                    Expired
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                          {req.residentialAddress && (
                            <div className="space-y-1 sm:col-span-2">
                              <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
                                Residential Address
                              </span>
                              <p className="text-sm font-semibold text-foreground leading-relaxed whitespace-pre-wrap select-all">
                                {req.residentialAddress}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Details Hash */}
                    {req.detailsHash && (
                      <div className="space-y-1.5 border-t border-border/40 pt-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider">
                            Details Hash
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopy(req.detailsHash, "Details hash")}
                            className="h-5 w-5 hover:bg-muted text-muted-foreground rounded-md"
                            title="Copy Details Hash"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="font-mono text-[11px] text-foreground/80 select-all break-all block py-2 px-3 bg-muted/40 rounded-lg border border-border/40">
                          {req.detailsHash}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right Visual Column — Document Image */}
                  <div className="md:w-[260px] lg:w-[300px] shrink-0 flex items-center justify-center p-6 md:p-8 bg-muted/10 md:border-l border-b md:border-b-0 border-border/60">
                    {req.documentImage ? (
                      <button
                        type="button"
                        onClick={() => {
                          setLightboxRotation(0);
                          setLightboxZoom(1);
                          setLightboxImage(getIPFSGatewayUrl(req.documentImage));
                        }}
                        className="group relative cursor-pointer block border-2 border-border/60 rounded-xl overflow-hidden w-full aspect-[4/3] bg-zinc-900/30 shadow-lg hover:shadow-xl transition-all"
                      >
                        <img
                          src={getIPFSGatewayUrl(req.documentImage)}
                          alt="Verification Document"
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-white font-semibold tracking-wide">
                          Click to Inspect
                        </span>
                      </button>
                    ) : (
                      <div className="w-full aspect-[4/3] flex items-center justify-center bg-muted/30 border-2 border-dashed border-border/50 rounded-xl">
                        <span className="text-xs text-muted-foreground italic">No document uploaded</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Action Bar */}
                <div className="flex items-center justify-between gap-4 px-6 md:px-8 py-5 bg-muted/15 border-t border-border/60 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-widest font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20">
                      Awaiting Review
                    </Badge>
                    <span className="text-xs text-muted-foreground font-medium">
                      Submitted: {req.createdAt ? new Date(req.createdAt).toLocaleString() : "Unknown"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {req.expiryDate && new Date(req.expiryDate) < new Date() && (
                      <Badge variant="destructive" className="animate-pulse bg-rose-600 hover:bg-rose-600 border border-rose-500 text-white font-bold tracking-wider text-[10px] uppercase h-11 px-4 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        Expired Document
                      </Badge>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedRejectionReason("Blurry/Low Quality");
                        setCustomReason("");
                        setRejectionTarget(req.address);
                      }}
                      disabled={loading || !isPrimaryAdmin}
                      className="h-11 px-6 text-sm font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200/50 dark:border-rose-500/20 dark:hover:bg-rose-500/10"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => handleApproveRequest(req.address)}
                      disabled={loading || !isPrimaryAdmin}
                      className="h-11 px-8 bg-accent hover:bg-accent/90 text-white text-sm font-semibold shadow-sm"
                    >
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Approve & Attest
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* ─── Secondary Section: Approved Creators (Collapsible) ─── */}
      <Card className="border bg-card/60 backdrop-blur-sm overflow-hidden">
        <CardHeader
          className="py-4 px-6 cursor-pointer select-none hover:bg-muted/10 transition-colors"
          onClick={() => setShowApproved(!showApproved)}
        >
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-primary" />
                Approved Creators
                <Badge variant="secondary" className="ml-1 text-[10px] font-bold">
                  {approvedList.length}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Active addresses approved to launch project vaults.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); setShowApproved(!showApproved); }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn("transition-transform duration-200", showApproved ? "rotate-180" : "")}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Button>
          </div>
        </CardHeader>

        {showApproved && (
          <CardContent className="p-0 border-t">
            {approvedList.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                No approved creators found.
              </p>
            ) : (
              <div className="divide-y">
                {approvedList.map((req) => (
                  <div
                    key={req._id}
                    className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-muted/5 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate" title={req.address}>
                        {req.fullName || "Unnamed"}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                        {req.address}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeRequest(req.address)}
                      disabled={loading || !isPrimaryAdmin}
                      className="h-9 px-4 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-rose-200/30 text-xs font-semibold shrink-0"
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Lightbox Dialog */}
      <Dialog open={!!lightboxImage} onOpenChange={(open) => { if (!open) setLightboxImage(null); }}>
        <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-4 bg-background/95 backdrop-blur-md border border-border/80 rounded-2xl shadow-2xl">
          <DialogHeader className="flex flex-row items-center justify-between border-b pb-2 select-none">
            <div>
              <DialogTitle className="text-lg font-bold">Document Viewer</DialogTitle>
              <DialogDescription className="text-xs">
                Inspect document proof with zoom and rotation controls.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-hidden relative flex items-center justify-center bg-zinc-950/80 rounded-lg my-2 border border-border/40">
            <div
              className="transition-all duration-200 ease-out flex items-center justify-center"
              style={{
                transform: `rotate(${lightboxRotation}deg) scale(${lightboxZoom})`,
              }}
            >
              {lightboxImage && (
                <img
                  src={lightboxImage}
                  alt="Enlarged Document"
                  className="max-h-[60vh] max-w-full object-contain shadow-lg"
                />
              )}
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between border-t pt-3 gap-4 sm:justify-between select-none">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLightboxZoom(prev => Math.max(0.5, prev - 0.25))}
                className="h-9 px-3 flex items-center gap-1"
              >
                <ZoomOut className="h-4 w-4" /> Zoom Out
              </Button>
              <span className="text-xs font-medium font-mono min-w-[3rem] text-center">
                {Math.round(lightboxZoom * 100)}%
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLightboxZoom(prev => Math.min(3.0, prev + 0.25))}
                className="h-9 px-3 flex items-center gap-1"
              >
                <ZoomIn className="h-4 w-4" /> Zoom In
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLightboxRotation(prev => (prev + 90) % 360)}
                className="h-9 px-3 flex items-center gap-1"
              >
                <RotateCw className="h-4 w-4" /> Rotate
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLightboxImage(null);
                }}
                className="h-9 px-4"
              >
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejection Reasons Dialog */}
      <Dialog open={!!rejectionTarget} onOpenChange={(open) => { if (!open) setRejectionTarget(null); }}>
        <DialogContent className="max-w-md w-full bg-background/95 backdrop-blur-md border border-border/80 rounded-2xl shadow-2xl p-6">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-rose-500">
              <XCircle className="h-5 w-5" /> Reject KYC Request
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select a reason for rejecting this verification request. This reason will be displayed to the user.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-3">
            {[
              "Blurry/Low Quality",
              "Document Expired",
              "Name Mismatch",
              "Invalid Document Type",
              "Other"
            ].map((reason) => (
              <label
                key={reason}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all hover:bg-muted/40",
                  selectedRejectionReason === reason
                    ? "border-primary bg-primary/5 font-medium text-foreground"
                    : "border-border/60 text-muted-foreground"
                )}
              >
                <input
                  type="radio"
                  name="rejectionReason"
                  value={reason}
                  checked={selectedRejectionReason === reason}
                  onChange={() => {
                    setSelectedRejectionReason(reason);
                  }}
                  className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
                />
                <span className="text-xs">{reason}</span>
              </label>
            ))}

            {selectedRejectionReason === "Other" && (
              <div className="space-y-1.5 pt-1 animate-in fade-in-50 duration-200">
                <label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                  Custom Reason Details
                </label>
                <textarea
                  placeholder="Type specific rejection details here..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full min-h-[80px] p-2.5 text-xs rounded-lg border border-border focus:ring-1 focus:ring-primary focus:outline-none bg-background resize-none"
                />
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRejectionTarget(null);
                setSelectedRejectionReason("Blurry/Low Quality");
                setCustomReason("");
              }}
              disabled={loading}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (rejectionTarget) {
                  const finalReason = selectedRejectionReason === "Other" ? customReason.trim() : selectedRejectionReason;
                  handleRejectRequest(rejectionTarget, finalReason || "Other");
                }
              }}
              disabled={loading || (selectedRejectionReason === "Other" && !customReason.trim())}
              className="text-xs"
            >
              {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
