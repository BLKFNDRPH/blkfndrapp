"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, Clock, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { attachMyKycWallet, getMyKycStatus } from "@/app/actions";
// Type only, so the server-only module is erased rather than bundled.
import type { ApplicantSubmission } from "@/lib/data/kyc";
import { identityClient, simulate } from "@/lib/stellar-clients";
import { formatDay, renewalState, RENEWAL_WINDOW_DAYS } from "@/lib/kyc/renewal";
import { Button } from "@/components/ui/button";
import { IdentityForm } from "@/components/identity/IdentityForm";
import { VerificationRecord } from "@/components/identity/VerificationRecord";
import { cn } from "@/lib/utils";

/**
 * Verify your identity.
 *
 * Open to anyone signed in. It used to show nothing but "Link Your Wallet"
 * until a wallet extension had signed a challenge, so a builder with a
 * passport and no crypto could not even learn what verification involved. Now
 * the documents go in first and the wallet is attached at submission if there
 * is one, or later if not: a reviewer can approve the documents either way,
 * and the approval reaches the public record once a wallet is attached.
 *
 * Where a check stands comes from two places: the submission (pending,
 * approved, rejected) and the public record the vault checks
 * (is_kyc_approved for the attached wallet). Only the second makes someone
 * verified.
 */

type Phase =
  | "none"
  | "pending"
  | "rejected"
  | "approved-no-wallet"
  | "approved-unrecorded"
  | "verified"
  // Approved, but the ID it was approved on has expired.
  | "lapsed";

function phaseOf(submission: ApplicantSubmission | null, onRecord: boolean | null): Phase {
  if (!submission) return "none";
  // The submission's status first. A renewal under review, or one turned
  // down, sits beside an earlier approval that is still on the record.
  if (submission.status === "pending") return "pending";
  if (submission.status === "rejected") return "rejected";
  if (renewalState(submission.verified_until) === "lapsed") return "lapsed";
  if (submission.stellar_address && onRecord) return "verified";
  return submission.stellar_address ? "approved-unrecorded" : "approved-no-wallet";
}

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

const DOCUMENT_NAMES: Record<string, string> = {
  passport: "Passport",
  national_id: "National ID card",
  drivers_license: "Driver's license",
};

/** "Documents submitted → Reviewed by a person → Verified", for where a check stands. */
function Tracker({ phase }: { phase: Phase }) {
  const reviewed = phase !== "pending";
  const steps = [
    { label: "Documents submitted", state: "done" as const },
    {
      label: phase === "rejected" ? "Not accepted" : "Reviewed by a person",
      state: phase === "pending" ? ("current" as const) : phase === "rejected" ? ("failed" as const) : ("done" as const),
    },
    {
      label: phase === "lapsed" ? "Expired" : "Verified",
      state:
        phase === "verified"
          ? ("done" as const)
          : phase === "lapsed"
            ? ("failed" as const)
            : reviewed && phase !== "rejected"
              ? ("current" as const)
              : ("todo" as const),
    },
  ];
  return (
    <ol className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-4 text-center text-xs sm:text-sm">
      {steps.map((s) => (
        <li key={s.label} className="flex flex-col items-center gap-1.5">
          {s.state === "done" ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-500" aria-hidden="true" />
          ) : s.state === "current" ? (
            <Clock className="h-6 w-6 text-amber-500" aria-hidden="true" />
          ) : s.state === "failed" ? (
            <XCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
          ) : (
            <Circle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          )}
          <span className={cn("font-medium", s.state === "todo" && "text-muted-foreground")}>
            {s.label}
            <span className="sr-only">
              {s.state === "done" ? " (done)" : s.state === "current" ? " (in progress)" : s.state === "failed" && phase !== "lapsed" ? " (not accepted)" : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function VerifyIdentityPage() {
  const { user, loading: authLoading, login } = useAuth();
  // The wallet set up on the account, which it proved it holds by signing a
  // challenge. A check can be attached to no other.
  const linked = user?.stellarPublicKey || "";

  const [submission, setSubmission] = useState<ApplicantSubmission | null>(null);
  const [onRecord, setOnRecord] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Only the first read shows the loading line. A later one -- after a
  // submission, an attach, or the account refreshing -- updates in place, so a
  // half-typed form is never unmounted by a status check.
  const loaded = useRef(false);
  const load = useCallback(async () => {
    if (!loaded.current) setLoading(true);
    setReadFailed(false);
    const res = await getMyKycStatus().catch(() => null);
    if (!res || !res.success) {
      if (!loaded.current) setReadFailed(true);
      setLoading(false);
      return;
    }
    loaded.current = true;
    const sub = res.request ?? null;
    setSubmission(sub);
    if (sub?.stellar_address) {
      const read = await simulate(
        () => identityClient().is_kyc_approved({ address: sub.stellar_address! }),
        `is_kyc_approved(${sub.stellar_address})`,
      );
      setOnRecord(read === null ? null : Boolean(read));
    } else {
      setOnRecord(null);
    }
    setLoading(false);
  }, []);

  // Keyed on the account, not the user object, which is rebuilt on every
  // session refresh.
  const uid = user?.uid;
  useEffect(() => {
    if (uid) load();
  }, [uid, load]);

  const attach = async () => {
    setAttaching(true);
    setAttachError(null);
    try {
      const res = await attachMyKycWallet();
      if (!res.success) throw new Error(res.error);
      await load();
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : String(error));
    } finally {
      setAttaching(false);
    }
  };

  const header = (
    <div className="space-y-2">
      <h1 className="font-headline text-3xl font-bold tracking-tight text-accent">Verify your identity</h1>
      <p className="text-muted-foreground">
        Only builders need this. It lets stakeholders see that a real, checked person is behind a
        project. Stakeholders never need it.
      </p>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <Link href="/profile" className="mb-6 inline-flex items-center text-sm font-semibold hover:text-accent">
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        Back to your profile
      </Link>
      <div className="space-y-6">
        {header}
        {children}
      </div>
    </div>
  );

  if (authLoading) {
    return shell(
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading your verification status…
      </p>,
    );
  }

  // Signed out: say what this is and offer to sign in here, rather than
  // bouncing to the profile, which bounced again.
  if (!user) {
    return shell(
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <p className="font-medium">Sign in to verify your identity</p>
        <p className="text-sm text-muted-foreground">
          You&apos;ll need a passport, national ID card or driver&apos;s license, and a few minutes. No
          wallet is needed to start.
        </p>
        <Button type="button" onClick={() => login()}>
          Sign in
        </Button>
      </div>,
    );
  }

  if (loading) {
    return shell(
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading your verification status…
      </p>,
    );
  }

  if (readFailed) {
    return shell(
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <p className="font-medium">We couldn&apos;t load your verification just now.</p>
        <Button type="button" variant="outline" onClick={load}>
          Try again
        </Button>
      </div>,
    );
  }

  const phase = phaseOf(submission, onRecord);
  const filed = submission?.stellar_address ?? null;
  const wrongWallet = Boolean(filed && linked && filed !== linked);
  // When the last approval runs out: the expiry of the ID it was approved on.
  const until = submission?.verified_until ?? null;
  const renewal = renewalState(until);
  // An earlier approval still standing beside a renewal under review or turned down.
  const stillVerifiedUntil = until && renewal !== "lapsed" ? until : null;

  const form = (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <IdentityForm
        defaultName={user.name && user.name !== "Anonymous" ? user.name : ""}
        accountEmail={user.email || ""}
        walletToAttach={linked}
        filedWallet={filed}
        onSubmitted={() => {
          setEditing(false);
          load();
        }}
        onCancel={submission ? () => setEditing(false) : undefined}
      />
    </div>
  );

  if (phase === "none" || editing) {
    return shell(
      <>
        {phase === "none" && (
          <p className="text-sm text-muted-foreground">
            A person at BLKFNDR checks every document. You&apos;ll see the decision here and in your
            notifications.
          </p>
        )}
        {submission?.status === "approved" && (
          <p className="text-sm text-muted-foreground">
            Verify again with your current ID.{" "}
            {stillVerifiedUntil
              ? `Your verification holds until ${formatDay(stillVerifiedUntil)} while a reviewer checks the new one.`
              : "A reviewer checks it, and you can open vaults again once it's approved."}
          </p>
        )}
        {form}
      </>,
    );
  }

  // ── Where the check stands ──────────────────────────────────────────────
  const panel = (() => {
    switch (phase) {
      case "verified":
        return (
          <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              Verified. You can open a vault.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/create-listing">Open a vault</Link>
              </Button>
              <Button type="button" variant="outline" onClick={() => setRecordOpen(true)}>
                See your verification record
              </Button>
            </div>
          </div>
        );
      case "pending":
        return (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
            <p className="font-semibold">Under review</p>
            <p className="text-sm text-muted-foreground">
              Submitted on {day(submission?.updated_at)}. A reviewer will check your documents, and
              you&apos;ll get a notification when they&apos;ve decided.
            </p>
            {stillVerifiedUntil && (
              <p className="text-sm text-muted-foreground">
                Your current verification holds until {formatDay(stillVerifiedUntil)} meanwhile.
              </p>
            )}
          </div>
        );
      case "rejected":
        return (
          <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5">
            <p className="font-semibold">We couldn&apos;t verify this document</p>
            <p className="text-sm">
              {submission?.rejection_reason
                ? `${submission.rejection_reason.replace(/[.\s]+$/, "")}. `
                : ""}
              Upload a clearer copy and submit again.
              {stillVerifiedUntil && ` Your current verification holds until ${formatDay(stillVerifiedUntil)}.`}
            </p>
            <Button type="button" onClick={() => setEditing(true)}>
              Submit again
            </Button>
          </div>
        );
      case "lapsed":
        return (
          <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5">
            <p className="font-semibold">Your verification has lapsed</p>
            <p className="text-sm">
              Your ID expired on {formatDay(until!)}. Verify again with a current one to open vaults.
            </p>
            <Button type="button" onClick={() => setEditing(true)}>
              Verify again
            </Button>
          </div>
        );
      case "approved-no-wallet":
        return (
          <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
            <p className="font-semibold">
              {linked ? "Approved. Attach your wallet to finish." : "Approved. Set up a wallet to finish."}
            </p>
            <p className="text-sm text-muted-foreground">
              A reviewer approved your documents. Your verification counts once it&apos;s attached to the
              wallet you&apos;ll open vaults from, and a reviewer has recorded it on the public record.
            </p>
            {linked ? (
              <Button type="button" onClick={attach} disabled={attaching}>
                {attaching && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {attaching ? "Attaching…" : `Attach your wallet ending …${linked.slice(-4)}`}
              </Button>
            ) : (
              <Button asChild>
                <Link href="/profile?tab=wallet&for=identity">Set up your wallet</Link>
              </Button>
            )}
            {attachError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {attachError}
              </p>
            )}
          </div>
        );
      case "approved-unrecorded":
        return (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
            <p className="font-semibold">Approved. Being recorded.</p>
            <p className="text-sm text-muted-foreground">
              {onRecord === null
                ? "We couldn't check the public record just now. If your verification isn't on it yet, a reviewer records it next; you'll get a notification."
                : "A reviewer records your verification on the public record next, and you'll get a notification when it's done. Then you can open a vault."}
            </p>
            {onRecord === null && (
              <Button type="button" variant="outline" size="sm" onClick={load}>
                Check again
              </Button>
            )}
          </div>
        );
    }
  })();

  return shell(
    <>
      <Tracker phase={phase} />
      {panel}

      {/* Inside the renewal window: the ID behind this approval expires soon. */}
      {submission?.status === "approved" && renewal === "due" && (
        <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
          <p className="font-semibold">Your ID expires on {formatDay(until!)}</p>
          <p>
            Your verification holds until then. Verify again with your current ID before it runs out, so you
            can keep opening vaults. You can do it any time in the {RENEWAL_WINDOW_DAYS} days before.
          </p>
          <Button type="button" size="sm" onClick={() => setEditing(true)}>
            Verify again
          </Button>
        </div>
      )}

      {/* A check filed for one wallet while the account now uses another:
          vaults open from the account's wallet, so it wouldn't count. */}
      {wrongWallet && (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
          <p className="font-semibold">Your verification is on a different wallet</p>
          <p>
            It&apos;s attached to the wallet ending …{filed!.slice(-4)}, but the wallet set up on your
            account now ends …{linked.slice(-4)}. Switch back to …{filed!.slice(-4)} in your wallet and set
            it up on your account again, or contact support to move the verification.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/profile?tab=wallet&for=identity">Set up a wallet</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="mailto:hello@blkfndr.com?subject=Move%20my%20identity%20verification">Contact support</a>
            </Button>
          </div>
        </div>
      )}

      {/* What the applicant may see of their own submission: never the
          identity fields, which no browser-facing role can read. */}
      {submission && (
        <section aria-labelledby="submitted-heading" className="rounded-xl border border-border bg-card p-5">
          <h2 id="submitted-heading" className="mb-3 font-semibold">
            What you submitted
          </h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Document</dt>
              <dd className="font-medium">{DOCUMENT_NAMES[submission.document_type] ?? "Identity document"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="font-medium">{day(submission.document_expires_on) || "Not given"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Submitted</dt>
              <dd className="font-medium">{day(submission.updated_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Attached wallet</dt>
              <dd className="font-medium">
                {filed ? `Account ID …${filed.slice(-4)}` : "None yet"}
                {!filed && linked && phase === "pending" && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="ml-1 h-auto p-0"
                    onClick={attach}
                    disabled={attaching}
                  >
                    {attaching ? "Attaching…" : `Attach …${linked.slice(-4)}`}
                  </Button>
                )}
              </dd>
            </div>
          </dl>
          {phase === "pending" && attachError && (
            <p role="alert" className="mt-3 text-sm font-medium text-destructive">
              {attachError}
            </p>
          )}
          {/* Deleted on the decision, or for an approval without a wallet
              once one is attached (kyc_requests_drop_identity_after_decision). */}
          <p className="mt-4 text-xs text-muted-foreground">
            {submission.status === "pending"
              ? filed
                ? "Your name, ID number, date of birth and address are never shown on this page. Only a reviewer can see them. Once they've decided, we delete your document, ID number, date of birth and address."
                : "Your name, ID number, date of birth and address are never shown on this page. Only a reviewer can see them. Once they've decided, we delete your document. Your ID number, date of birth and address are deleted then too, or, if they approve before you've attached a wallet, once you attach one."
              : submission.status === "approved" && !filed
                ? "Your document has been deleted. Your ID number, date of birth and address are kept only until you attach your wallet, then deleted too."
                : "Your document, ID number, date of birth and address have been deleted. We keep your name and a one-way fingerprint of your details."}
          </p>
        </section>
      )}

      {phase === "verified" && filed && (
        <VerificationRecord
          open={recordOpen}
          onOpenChange={setRecordOpen}
          wallet={filed}
          approvedOn={submission?.updated_at ?? null}
        />
      )}
    </>,
  );
}
