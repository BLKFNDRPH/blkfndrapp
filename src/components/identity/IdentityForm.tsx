"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Upload } from "lucide-react";
import { submitKycRequest } from "@/app/actions";
import { uploadKycDocument, computeDetailsHash } from "@/lib/kyc/prepare-submission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/**
 * The identity check, on one page in three parts: the document, the details
 * on it, and the wallet it will be attached to.
 *
 * Nothing here asks for a wallet first. Someone without one submits now and
 * attaches it later; the documents are reviewed in the meantime. The button is
 * never disabled for a gap: pressing it marks every field still missing and
 * says so, rather than greying out with no reason.
 */

const DOCUMENT_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID card" },
  { value: "drivers_license", label: "Driver's license" },
] as const;

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;

type Field =
  | "fullName"
  | "email"
  | "document"
  | "idNumber"
  | "dob"
  | "expiry"
  | "address"
  | "consent";

/** Whole years between a YYYY-MM-DD date and today. */
function ageOn(dob: string, today = new Date()): number {
  const d = new Date(`${dob}T00:00:00`);
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

export function IdentityForm({
  defaultName,
  accountEmail,
  walletToAttach,
  filedWallet,
  onSubmitted,
  onCancel,
}: {
  defaultName: string;
  /** The account's email; when there is one the field is fixed to it. */
  accountEmail: string;
  /** The wallet set up on the account, which a new check is attached to; "" for none. */
  walletToAttach: string;
  /** For a resubmission: the wallet the check is already attached to, or null. */
  filedWallet: string | null;
  onSubmitted: () => void;
  onCancel?: () => void;
}) {
  const [fullName, setFullName] = useState(defaultName);
  const [email, setEmail] = useState(accountEmail);
  const [documentType, setDocumentType] = useState<string>("passport");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [idNumber, setIdNumber] = useState("");
  const [dob, setDob] = useState("");
  const [expiry, setExpiry] = useState("");
  const [address, setAddress] = useState("");
  const [consent, setConsent] = useState(false);

  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!fullName && defaultName) setFullName(defaultName);
    // Only fills an empty field; never overwrites what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultName]);

  // The object URL for an image preview, released when replaced.
  useEffect(() => {
    if (!file || file.type === "application/pdf") {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The wallet this submission names: the one already on file for a
  // resubmission, else the one set up on the account, else none for now.
  const wallet = filedWallet ?? (walletToAttach || null);
  const wrongWallet = Boolean(filedWallet && walletToAttach && filedWallet !== walletToAttach);

  const clear = (field: Field) =>
    setProblems((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const pickFile = (picked: File | undefined) => {
    clear("document");
    if (!picked) return;
    if (!ACCEPTED.includes(picked.type)) {
      setProblems((p) => ({ ...p, document: "Use a photo (JPG, PNG or WebP) or a PDF." }));
      return;
    }
    if (picked.size > MAX_BYTES) {
      setProblems((p) => ({ ...p, document: "That file is over 10 MB. Try a smaller photo or a lighter scan." }));
      return;
    }
    setFile(picked);
  };

  const check = (): Partial<Record<Field, string>> => {
    const out: Partial<Record<Field, string>> = {};
    if (!fullName.trim()) out.fullName = "Enter your full legal name, as on the document.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) out.email = "Enter an email address we can reach you on.";
    if (!file) out.document = "Add a photo or scan of your document.";
    if (!idNumber.trim()) out.idNumber = "Enter the number printed on your document.";
    if (!dob) out.dob = "Enter your date of birth.";
    else if (ageOn(dob) < 18) out.dob = "You must be 18 or over.";
    if (!expiry) out.expiry = "Enter the date your document expires.";
    else if (new Date(`${expiry}T23:59:59`) < new Date()) out.expiry = "This document has expired. Use one that's still valid.";
    if (!address.trim()) out.address = "Enter your home address.";
    if (!consent) out.consent = "Tick this so a reviewer can check your document.";
    return out;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const found = check();
    setProblems(found);
    if (Object.keys(found).length > 0) {
      // After React has committed the highlights, so there is something to
      // find. A timer rather than an animation frame, which a background tab
      // never runs.
      setTimeout(() => {
        const first = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-problem="true"]');
        first?.focus();
        first?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setSubmitting(true);
    try {
      // The document goes to a private storage bucket and only its path is
      // recorded; identity documents are kept out of any table a query reaches.
      const documentPath = await uploadKycDocument(file!);
      const detailsHash = await computeDetailsHash({
        fullName,
        dateOfBirth: dob,
        documentType,
        idNumber,
        documentExpiresOn: expiry,
        residentialAddress: address,
        stellarAddress: wallet ?? "",
      });
      const res = await submitKycRequest({
        stellarAddress: wallet,
        fullName,
        email,
        documentType,
        documentPath,
        idNumber,
        dateOfBirth: dob,
        documentExpiresOn: expiry,
        residentialAddress: address,
        detailsHash,
        consentGiven: consent,
      });
      if (!res.success) throw new Error(res.error);
      onSubmitted();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const problemCount = Object.keys(problems).length;
  const fieldClass = (field: Field) =>
    cn(problems[field] && "border-destructive focus-visible:ring-destructive");
  const problem = (field: Field) =>
    problems[field] ? (
      <p id={`${field}-problem`} className="text-sm font-medium text-destructive">
        {problems[field]}
      </p>
    ) : null;
  const describedBy = (field: Field, hint?: string) =>
    [hint, problems[field] ? `${field}-problem` : null].filter(Boolean).join(" ") || undefined;

  return (
    <form noValidate onSubmit={submit} className="space-y-8">
      {/* ── Your document ─────────────────────────────────────────────── */}
      <section aria-labelledby="doc-heading" className="space-y-4">
        <h2 id="doc-heading" className="text-lg font-semibold">
          1. Your document
        </h2>

        <div className="space-y-2">
          <Label htmlFor="fullName">Full legal name</Label>
          <Input
            id="fullName"
            autoComplete="name"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              clear("fullName");
            }}
            aria-invalid={Boolean(problems.fullName)}
            aria-describedby={describedBy("fullName", "fullName-hint")}
            className={fieldClass("fullName")}
          />
          <p id="fullName-hint" className="text-sm text-muted-foreground">
            Exactly as it's printed on your document.
          </p>
          {problem("fullName")}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            readOnly={Boolean(accountEmail)}
            onChange={(e) => {
              setEmail(e.target.value);
              clear("email");
            }}
            aria-invalid={Boolean(problems.email)}
            aria-describedby={describedBy("email", accountEmail ? "email-hint" : undefined)}
            className={cn(accountEmail && "bg-muted text-muted-foreground", fieldClass("email"))}
          />
          {accountEmail && (
            <p id="email-hint" className="text-sm text-muted-foreground">
              Your account's email. A reviewer uses it only if they need to reach you.
            </p>
          )}
          {problem("email")}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Document type</legend>
          <RadioGroup value={documentType} onValueChange={setDocumentType} className="grid gap-2 sm:grid-cols-3">
            {DOCUMENT_TYPES.map((t) => (
              <label
                key={t.value}
                htmlFor={`doc-${t.value}`}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-sm",
                  documentType === t.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                )}
              >
                <RadioGroupItem id={`doc-${t.value}`} value={t.value} />
                {t.label}
              </label>
            ))}
          </RadioGroup>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="document">Photo or scan of the document</Label>
          {file ? (
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              {preview ? (
                // A local object URL, so next/image has nothing to optimise.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-16 w-24 shrink-0 rounded object-cover" />
              ) : (
                <FileText className="h-10 w-10 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                Change
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              data-problem={Boolean(problems.document)}
              aria-describedby={describedBy("document", "document-hint")}
              className={cn(
                "flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm text-muted-foreground hover:bg-muted/40",
                problems.document ? "border-destructive" : "border-border",
              )}
            >
              <Upload className="h-6 w-6" aria-hidden="true" />
              <span className="font-medium text-foreground">Choose a photo or PDF</span>
            </button>
          )}
          <input
            ref={fileInput}
            id="document"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <p id="document-hint" className="text-sm text-muted-foreground">
            On a phone you can take a photo. Make sure all four corners and the text are readable.
            JPG, PNG, WebP or PDF, up to 10 MB.
          </p>
          {problem("document")}
        </div>
      </section>

      {/* ── Your details ──────────────────────────────────────────────── */}
      <section aria-labelledby="details-heading" className="space-y-4">
        <h2 id="details-heading" className="text-lg font-semibold">
          2. Your details
        </h2>

        <div className="space-y-2">
          <Label htmlFor="idNumber">Document number</Label>
          <Input
            id="idNumber"
            autoComplete="off"
            value={idNumber}
            onChange={(e) => {
              setIdNumber(e.target.value);
              clear("idNumber");
            }}
            aria-invalid={Boolean(problems.idNumber)}
            aria-describedby={describedBy("idNumber")}
            className={fieldClass("idNumber")}
          />
          {problem("idNumber")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dob">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              autoComplete="bday"
              value={dob}
              onChange={(e) => {
                setDob(e.target.value);
                clear("dob");
              }}
              aria-invalid={Boolean(problems.dob)}
              aria-describedby={describedBy("dob", "dob-hint")}
              className={fieldClass("dob")}
            />
            <p id="dob-hint" className="text-sm text-muted-foreground">
              You must be 18 or over.
            </p>
            {problem("dob")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="expiry">Document expiry date</Label>
            <Input
              id="expiry"
              type="date"
              value={expiry}
              onChange={(e) => {
                setExpiry(e.target.value);
                clear("expiry");
              }}
              aria-invalid={Boolean(problems.expiry)}
              aria-describedby={describedBy("expiry", "expiry-hint")}
              className={fieldClass("expiry")}
            />
            <p id="expiry-hint" className="text-sm text-muted-foreground">
              Must be in the future.
            </p>
            {problem("expiry")}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">Home address</Label>
          <Textarea
            id="address"
            autoComplete="street-address"
            rows={3}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              clear("address");
            }}
            aria-invalid={Boolean(problems.address)}
            aria-describedby={describedBy("address")}
            className={fieldClass("address")}
          />
          {problem("address")}
        </div>

        <div className="space-y-1">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                clear("consent");
              }}
              aria-invalid={Boolean(problems.consent)}
              aria-describedby={describedBy("consent")}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-[hsl(var(--primary))]"
            />
            <span>I agree that BLKFNDR&apos;s reviewers may check this document to verify my identity.</span>
          </label>
          {problem("consent")}
        </div>
      </section>

      {/* ── Your wallet ───────────────────────────────────────────────── */}
      <section aria-labelledby="wallet-heading" className="space-y-2">
        <h2 id="wallet-heading" className="text-lg font-semibold">
          3. Your wallet
        </h2>
        {wrongWallet ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Your verification is attached to the wallet ending …{filedWallet!.slice(-4)}, but the wallet
            set up on your account now ends …{walletToAttach.slice(-4)}. Switch back to …
            {filedWallet!.slice(-4)} in your wallet and set it up on your account again, or{" "}
            <a href="mailto:hello@blkfndr.com" className="font-medium underline">
              contact support
            </a>{" "}
            to move the verification.
          </p>
        ) : wallet ? (
          <p className="text-sm text-muted-foreground">
            Your verification will be attached to your wallet ending{" "}
            <span className="font-medium text-foreground">…{wallet.slice(-4)}</span>. That&apos;s the
            wallet a vault you open is tied to.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              You can submit now and set up a wallet later; we&apos;ll review your documents in the
              meantime. You&apos;ll attach the wallet here before you open a vault.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/profile?tab=wallet">Set up your wallet</Link>
            </Button>
          </div>
        )}
      </section>

      <div className="space-y-3 border-t border-border pt-6">
        {problemCount > 0 && (
          <p role="alert" className="text-sm font-medium text-destructive">
            Fill in the highlighted {problemCount === 1 ? "field" : "fields"} to continue.
          </p>
        )}
        {submitError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {submitError} Nothing was sent for review.
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={submitting} aria-busy={submitting} className="sm:min-w-[200px]">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Sending…" : "Submit for review"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Your name, ID number, date of birth and address are never shown on this page after you
          submit. Only a reviewer can see them.
        </p>
      </div>
    </form>
  );
}
