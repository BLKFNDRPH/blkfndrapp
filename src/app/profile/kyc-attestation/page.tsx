"use client";

import { useEffect, useState, useTransition } from "react";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { submitKycRequest, getMyKycStatus } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, ShieldCheck, Loader2, AlertTriangle, FileText, Send, User, Mail, Shield } from "lucide-react";
import Link from "next/link";
import { Client as IdentityClient } from "@/packages/blkfndr_identity/src";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const IDENTITY_ID = process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID || "";

export default function KycAttestationPage() {
  const { user, loading: authLoading } = useAuth();
  const { freighterWalletAddress } = useFreighterWallet();
  const { toast } = useToast();
  const router = useRouter();

  // Wizard state configuration
  interface KycFormData {
    fullName: string;
    email: string;
    documentType: string;
    documentImage: string; // Base64 data URL
    documentFile: File | null; // Raw File object for name display
    idNumber: string;
    dob: string;
    expiryDate: string;
    residentialAddress: string;
    consentFlag: boolean;
  }

  const [formData, setFormData] = useState<KycFormData>({
    fullName: "",
    email: "",
    documentType: "passport",
    documentImage: "",
    documentFile: null,
    idNumber: "",
    dob: "",
    expiryDate: "",
    residentialAddress: "",
    consentFlag: false,
  });

  const [step, setStep] = useState(1);
  const [currentKycRequest, setCurrentKycRequest] = useState<any>(null);
  const [isOnChainApproved, setIsOnChainApproved] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [isPendingSubmit, startSubmitTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);

  const activeAddress = user?.stellarPublicKey || freighterWalletAddress || "";

  const fetchKycStatus = async () => {
    if (!activeAddress) return;
    setLoadingStatus(true);
    try {
      // Fetch Database Status
      const res = await getMyKycStatus();
      if (res.success && res.request) {
        // Status only. The identity fields are not granted to any
        // browser-facing role, so a resubmission is re-entered by hand rather
        // than prefilled — deliberately, since prefilling would mean serving
        // an ID number back to the page on every visit.
        setCurrentKycRequest(res.request);
        setFormData((prev) => ({
          ...prev,
          documentType: res.request?.document_type || 'passport',
        }));
      } else {
        setCurrentKycRequest(null);
        setFormData((prev) => ({
          ...prev,
          fullName: user?.name || "",
          email: user?.email || "",
        }));
      }

      // Fetch On-chain Status
      if (IDENTITY_ID) {
        try {
          const client = new IdentityClient({
            contractId: IDENTITY_ID,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
            // The address being queried doubles as the simulation source. The
              // old NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS is unset on the current
              // deployment, and an empty publicKey throws inside the SDK before
              // the registry is reached.
              publicKey: activeAddress,
          });
          const checkTx = await client.is_kyc_approved({ address: activeAddress });
          const checkSim = await checkTx.simulate();
          setIsOnChainApproved(Boolean(checkSim.result));
        } catch (simulateErr) {
          console.error("Failed to simulate KYC check on-chain:", simulateErr);
          setIsOnChainApproved(false);
        }
      }
    } catch (err) {
      console.error("Failed to load KYC details:", err);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/profile");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    fetchKycStatus();
  }, [activeAddress]);

  // Pre-populate user profile data if user changes
  useEffect(() => {
    if (user && !formData.fullName) {
      setFormData((prev) => ({
        ...prev,
        fullName: prev.fullName || user.name || "",
        email: prev.email || user.email || "",
      }));
    }
  }, [user]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData((prev) => ({
        ...prev,
        documentFile: file,
        documentImage: reader.result as string,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleNextStep = () => {
    if (!formData.fullName || !formData.email || !formData.documentImage) {
      toast({
        title: "Missing Fields",
        description: "Please fill out all fields and provide a document image.",
        variant: "destructive",
      });
      return;
    }
    setStep(2);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAddress) {
      toast({
        title: "Wallet Not Connected",
        description: "Connect your Freighter wallet to submit verification details.",
        variant: "destructive",
      });
      return;
    }

    if (
      !formData.fullName ||
      !formData.email ||
      !formData.documentImage ||
      !formData.idNumber ||
      !formData.dob ||
      !formData.expiryDate ||
      !formData.residentialAddress
    ) {
      toast({
        title: "Missing Fields",
        description: "Please fill out all fields in the Review & Confirm step.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.consentFlag) {
      toast({
        title: "Consent Required",
        description: "You must check the consent box to proceed.",
        variant: "destructive",
      });
      return;
    }

    // DOB age validation (must be 18+)
    const dobDate = new Date(formData.dob);
    const today = new Date();
    let age = today.getFullYear() - dobDate.getFullYear();
    const monthDiff = today.getMonth() - dobDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
      age--;
    }
    if (age < 18) {
      toast({
        title: "Underage Applicant",
        description: "You must be at least 18 years old to verify your identity.",
        variant: "destructive",
      });
      return;
    }

    // Expiry date validation (must be in future)
    const expiryDate = new Date(formData.expiryDate);
    if (expiryDate < today) {
      toast({
        title: "Expired Document",
        description: "Your document's expiry date must be in the future.",
        variant: "destructive",
      });
      return;
    }

    startSubmitTransition(async () => {
      try {
        const res = await submitKycRequest({
          stellarAddress: activeAddress,
          fullName: formData.fullName,
          email: formData.email,
          documentType: formData.documentType,
          documentImage: formData.documentImage,
          idNumber: formData.idNumber,
          dob: formData.dob,
          expiryDate: formData.expiryDate,
          residentialAddress: formData.residentialAddress,
          consentFlag: formData.consentFlag,
        });

        if (res.success) {
          toast({
            title: "Submission sent for admin review!",
            description: "Your identity details have been successfully recorded.",
          });
          setIsEditing(false);
          setStep(1);
          await fetchKycStatus();
        } else {
          throw new Error(res.error || "Submission failed");
        }
      } catch (err: any) {
        toast({
          title: "Submission Error",
          description: err.message || "Failed to submit application.",
          variant: "destructive",
        });
      }
    });
  };

  if (authLoading || loadingStatus) {
    return (
      <div className="container mx-auto max-w-2xl py-12 flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground mt-4">Loading verification status...</p>
      </div>
    );
  }

  const dbStatus = currentKycRequest?.status || "none";
  const showSubmittedDetails = dbStatus !== "none" && !isEditing;

  return (
    <div className="container mx-auto max-w-2xl py-12 px-4">
      <div className="mb-6">
        <Link href="/profile" className="flex items-center text-sm font-semibold hover:text-accent transition-colors">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Profile
        </Link>
      </div>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-headline text-accent">Identity Verification</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Attest your identity on the Stellar network to authorize project vault creations.
          </p>
        </div>

        {/* Progress Stepper */}
        {dbStatus !== "none" && (
          <div className="bg-card border border-border/80 rounded-2xl p-6 shadow-sm select-none">
            <div className="flex items-center justify-between relative max-w-md mx-auto">
              {/* Connecting Lines */}
              <div className="absolute top-5 left-[10%] right-[10%] h-0.5 bg-muted -z-0">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{
                    width:
                      isOnChainApproved || dbStatus === "approved" || dbStatus === "rejected"
                        ? "100%"
                        : dbStatus === "pending"
                        ? "50%"
                        : "0%",
                  }}
                />
              </div>

              {/* Step 1: Submitted */}
              <div className="flex flex-col items-center z-10 relative">
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center border-2 font-bold text-xs transition-colors",
                    dbStatus !== "none"
                      ? "bg-primary border-primary text-primary-foreground"
                      : "bg-background border-muted text-muted-foreground"
                  )}
                >
                  1
                </div>
                <span className="text-[11px] font-semibold mt-2 text-foreground">Submitted</span>
              </div>

              {/* Step 2: Under Review */}
              <div className="flex flex-col items-center z-10 relative">
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center border-2 font-bold text-xs transition-colors",
                    dbStatus === "pending" || dbStatus === "approved" || dbStatus === "rejected" || isOnChainApproved
                      ? dbStatus === "pending"
                        ? "bg-amber-500 border-amber-500 text-white animate-pulse"
                        : "bg-primary border-primary text-primary-foreground"
                      : "bg-background border-muted text-muted-foreground"
                  )}
                >
                  2
                </div>
                <span className="text-[11px] font-semibold mt-2 text-foreground">Under Review</span>
              </div>

              {/* Step 3: Verified / Rejected */}
              <div className="flex flex-col items-center z-10 relative">
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center border-2 font-bold text-xs transition-colors",
                    isOnChainApproved || dbStatus === "approved" || dbStatus === "rejected"
                      ? dbStatus === "rejected"
                        ? "bg-rose-500 border-rose-500 text-white"
                        : "bg-emerald-500 border-emerald-500 text-white"
                      : "bg-background border-muted text-muted-foreground"
                  )}
                >
                  3
                </div>
                <span className="text-[11px] font-semibold mt-2 text-foreground">
                  {dbStatus === "rejected" ? "Rejected" : "Verified"}
                </span>
              </div>
            </div>
          </div>
        )}

        {isOnChainApproved ? (
          <Alert className="bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl">
            <div className="flex gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <AlertTitle className="font-bold">Verified on Chain</AlertTitle>
                <AlertDescription className="text-xs mt-0.5">
                  Your wallet address has been verified and recorded on the Identity Registry contract.
                </AlertDescription>
              </div>
            </div>
            {IDENTITY_ID && (
              <Button
                variant="outline"
                size="sm"
                className="self-start sm:self-auto shrink-0 text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-800 dark:text-emerald-300 animate-none"
                asChild
              >
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${IDENTITY_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Attestation
                </a>
              </Button>
            )}
          </Alert>
        ) : dbStatus === "pending" ? (
          <Alert className="bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300">
            <Loader2 className="h-5 w-5 text-amber-600 dark:text-amber-400 animate-spin" />
            <AlertTitle className="font-bold">Verification Pending Admin Approval</AlertTitle>
            <AlertDescription className="text-xs">
              Your identity document submission is currently being reviewed by administrators. Once confirmed, it will be registered on-chain.
            </AlertDescription>
          </Alert>
        ) : dbStatus === "rejected" ? (
          <Alert className="bg-rose-500/10 border-rose-500/20 text-rose-800 dark:text-rose-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <AlertTitle className="font-bold">Verification Rejected</AlertTitle>
                <AlertDescription className="text-xs mt-0.5">
                  Your document was rejected:{" "}
                  <strong className="text-rose-900 dark:text-rose-200">
                    {currentKycRequest?.rejectionReason || "No reason specified"}
                  </strong>
                  . Please re-upload a clear copy.
                </AlertDescription>
              </div>
            </div>
            <Button
              onClick={() => {
                setIsEditing(true);
                setStep(1);
              }}
              className="self-start sm:self-auto shrink-0 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold animate-none"
              size="sm"
            >
              Re-submit Documents
            </Button>
          </Alert>
        ) : null}

        {showSubmittedDetails ? (
          <Card className="border border-border bg-card shadow-lg rounded-2xl overflow-hidden">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Submitted Identity Info
              </CardTitle>
              <CardDescription>
                The details you submitted for identification.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                    <User className="h-3.5 w-3.5" /> Full Name
                  </span>
                  <p className="text-sm font-semibold text-foreground">{currentKycRequest.fullName}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" /> Email Address
                  </span>
                  <p className="text-sm font-semibold text-foreground">{currentKycRequest.email}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                    <Shield className="h-3.5 w-3.5" /> Document Type
                  </span>
                  <p className="text-sm font-semibold text-foreground capitalize">
                    {currentKycRequest.documentType.replace("_", " ")}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">ID Number</span>
                  <p className="text-sm font-semibold font-mono text-foreground">{currentKycRequest.idNumber || "N/A"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Date of Birth</span>
                  <p className="text-sm font-semibold text-foreground">
                    {currentKycRequest.dob ? new Date(currentKycRequest.dob).toLocaleDateString() : "N/A"}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Expiry Date</span>
                  <p className="text-sm font-semibold text-foreground">
                    {currentKycRequest.expiryDate ? new Date(currentKycRequest.expiryDate).toLocaleDateString() : "N/A"}
                  </p>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Residential Address</span>
                  <p className="text-sm font-semibold text-foreground leading-relaxed whitespace-pre-wrap">
                    {currentKycRequest.residentialAddress || "N/A"}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Submission Status</span>
                  <p className="text-sm font-semibold text-foreground capitalize">{dbStatus}</p>
                </div>
              </div>

              {currentKycRequest.documentImage && (
                <div className="space-y-2">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Document Image Copy</span>
                  <div className="border rounded-xl overflow-hidden max-h-60 flex justify-center bg-black/5 dark:bg-black/20 p-2">
                    <img
                      src={currentKycRequest.documentImage}
                      alt="Uploaded Document"
                      className="max-h-full object-contain"
                    />
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="bg-muted/10 p-6 flex justify-end border-t mt-4 gap-3">
              {(dbStatus === "rejected" || (dbStatus === "approved" && !isOnChainApproved)) && (
                <Button
                  onClick={() => {
                    setIsEditing(true);
                    setStep(1);
                  }}
                  className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold px-6"
                >
                  Edit Submission
                </Button>
              )}
            </CardFooter>
          </Card>
        ) : (
          <Card className="border border-border bg-card shadow-lg rounded-2xl overflow-hidden">
            <CardHeader className="border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-bold flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    Submit Verification Documents
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {step === 1
                      ? "Step 1: Fill out your basic profile and upload an identification document."
                      : "Step 2: Review details and enter compliance identifier parameters."}
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-[10px] uppercase font-bold px-2 py-0.5">
                  Step {step} of 2
                </Badge>
              </div>
            </CardHeader>

            <form onSubmit={step === 2 ? handleSubmit : (e) => { e.preventDefault(); handleNextStep(); }}>
              <CardContent className="space-y-4 pt-6">
                {step === 1 ? (
                  /* ─── STEP 1: Upload Details ─── */
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Full Name</Label>
                      <Input
                        id="fullName"
                        placeholder="John Doe"
                        value={formData.fullName}
                        onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
                        required
                        disabled={isPendingSubmit}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="john@example.com"
                        value={formData.email}
                        onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                        required
                        disabled={isPendingSubmit}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="documentType">Document Type</Label>
                      <Select
                        value={formData.documentType}
                        onValueChange={(val) => setFormData((prev) => ({ ...prev, documentType: val }))}
                        disabled={isPendingSubmit}
                      >
                        <SelectTrigger id="documentType">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="passport">Passport</SelectItem>
                          <SelectItem value="national_id">National Identity Card</SelectItem>
                          <SelectItem value="drivers_license">Driver's License</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="documentFile">Upload Identity Document</Label>
                      {formData.documentFile ? (
                        <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-foreground font-semibold">
                          <span className="truncate max-w-[80%]">{formData.documentFile.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 shrink-0 text-[10px] font-bold h-7 px-2"
                            onClick={() => setFormData((prev) => ({ ...prev, documentFile: null, documentImage: "" }))}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : formData.documentImage ? (
                        <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-700 font-semibold">
                          <span className="truncate max-w-[80%]">Document proof loaded</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 shrink-0 text-[10px] font-bold h-7 px-2"
                            onClick={() => setFormData((prev) => ({ ...prev, documentImage: "" }))}
                          >
                            Change File
                          </Button>
                        </div>
                      ) : (
                        <Input
                          id="documentFile"
                          type="file"
                          accept="image/*"
                          onChange={handleImageChange}
                          required={!formData.documentImage}
                          disabled={isPendingSubmit}
                        />
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Upload a clear photo of your passport, national ID card, or driver's license.
                      </p>
                    </div>

                    {formData.documentImage && (
                      <div className="mt-4 border rounded-xl overflow-hidden max-h-48 flex justify-center bg-black/5 dark:bg-black/20 p-2">
                        <img
                          src={formData.documentImage}
                          alt="Uploaded Document Preview"
                          className="max-h-full object-contain"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  /* ─── STEP 2: Review & Confirm ─── */
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="confirmName">Full Name</Label>
                      <Input
                        id="confirmName"
                        value={formData.fullName}
                        disabled
                        className="bg-muted text-muted-foreground font-semibold"
                      />
                      <p className="text-[9px] text-muted-foreground">Pre-filled from Step 1 profile parameters.</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="idNumber">ID/Document Number</Label>
                      <Input
                        id="idNumber"
                        placeholder="Enter your passport or ID number"
                        value={formData.idNumber}
                        onChange={(e) => setFormData((prev) => ({ ...prev, idNumber: e.target.value }))}
                        required
                        disabled={isPendingSubmit}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="dob">Date of Birth</Label>
                        <Input
                          id="dob"
                          type="date"
                          value={formData.dob}
                          onChange={(e) => setFormData((prev) => ({ ...prev, dob: e.target.value }))}
                          required
                          disabled={isPendingSubmit}
                        />
                        <p className="text-[9px] text-muted-foreground">Must be 18 years or older.</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="expiryDate">ID Expiry Date</Label>
                        <Input
                          id="expiryDate"
                          type="date"
                          value={formData.expiryDate}
                          onChange={(e) => setFormData((prev) => ({ ...prev, expiryDate: e.target.value }))}
                          required
                          disabled={isPendingSubmit}
                        />
                        <p className="text-[9px] text-muted-foreground">Must be a future date.</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="residentialAddress">Residential Address</Label>
                      <Textarea
                        id="residentialAddress"
                        placeholder="Enter your current primary residential address..."
                        value={formData.residentialAddress}
                        onChange={(e) => setFormData((prev) => ({ ...prev, residentialAddress: e.target.value }))}
                        required
                        rows={3}
                        className="min-h-[80px]"
                        disabled={isPendingSubmit}
                      />
                    </div>

                    <div className="pt-2">
                      <label className="flex items-start gap-3 cursor-pointer select-none group text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <input
                          type="checkbox"
                          checked={formData.consentFlag}
                          onChange={(e) => setFormData((prev) => ({ ...prev, consentFlag: e.target.checked }))}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                          disabled={isPendingSubmit}
                          required
                        />
                        <span className="leading-normal font-medium">
                          I consent to the collection and processing of my identity documents for verification purposes.
                        </span>
                      </label>
                    </div>
                  </div>
                )}
              </CardContent>

              <CardFooter className="bg-muted/10 p-6 flex justify-between border-t mt-4 gap-3">
                {step === 1 ? (
                  <>
                    <div>
                      {isEditing && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setIsEditing(false)}
                          disabled={isPendingSubmit}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                    <Button
                      type="button"
                      onClick={handleNextStep}
                      disabled={isPendingSubmit || !formData.fullName || !formData.email || (!formData.documentImage && !formData.documentFile)}
                      className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold px-6"
                    >
                      Continue to Review
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setStep(1)}
                      disabled={isPendingSubmit}
                    >
                      Back to Step 1
                    </Button>
                    <Button
                      type="submit"
                      disabled={isPendingSubmit || !formData.idNumber || !formData.dob || !formData.expiryDate || !formData.residentialAddress || !formData.consentFlag}
                      className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold px-6 flex items-center gap-2"
                    >
                      {isPendingSubmit ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          Submit Verification
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
