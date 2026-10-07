"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleHelp, Loader2, ShieldOff, XCircle } from "lucide-react";
import { getKycSubmission } from "@/app/actions";
import { computeDetailsHash } from "@/lib/kyc/details-hash";
import { formatDay, renewalState } from "@/lib/kyc/renewal";
import { identityClient, simulate } from "@/lib/stellar-clients";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

/**
 * A verified wallet's record, and a check of a person against it.
 *
 * A check's documents and personal details are deleted once it is decided
 * (20261007130000). What is kept is shown at the top: the name, the
 * document's type and expiry, and the hash its attestation put on the record,
 * which is SHA-256 of the details and the wallet (src/lib/kyc/details-hash.ts).
 *
 * When there is doubt about who holds a verified wallet -- a dispute, an
 * account recovery, a report -- the person shows their ID again. The check is
 * a separate step behind a button, so the dialog is otherwise just the record.
 * It asks only for what the record no longer holds: the kept details are used
 * as they are, locked, and the reviewer types the rest from the ID. The hash
 * is recomputed and compared with the record. A match means these are the
 * details that were verified for this wallet.
 *
 * The record is read through getKycSubmission, the reviewer's one-case read.
 * The comparison runs in the reviewer's browser: what is typed never reaches
 * the server and is never stored, and the fields clear when the dialog closes.
 */

/** The approved check to show, from the identity panel's list. */
export interface RecordTarget {
  id: string;
  wallet: string;
  status: "pending" | "approved" | "rejected";
  verifiedUntil: string | null;
}

/** What getSubmissionForReview returns that this dialog reads. */
interface KeptRecord {
  full_name: string;
  document_type: string;
  document_expires_on: string | null;
  details_hash: string;
  id_number: string | null;
  date_of_birth: string | null;
  residential_address: string | null;
  document_path: string | null;
}

const DOCUMENT_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID card" },
  { value: "drivers_license", label: "Driver's license" },
] as const;
const documentLabel = (value: string) => DOCUMENT_TYPES.find((t) => t.value === value)?.label ?? value;

const EMPTY = {
  fullName: "",
  dateOfBirth: "",
  documentType: "passport",
  idNumber: "",
  documentExpiresOn: "",
  residentialAddress: "",
};
type Fields = typeof EMPTY;

type Result = "match" | "mismatch" | "not-on-record" | "unreadable";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function RecordCheckDialog({
  target,
  onClose,
}: {
  /** The check to show; the dialog is open while this is set. */
  target: RecordTarget | null;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<KeptRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // What the reviewer types from the ID shown. Only the details the record no
  // longer holds are asked for; the rest come from the record, locked.
  const [fields, setFields] = useState<Fields>(EMPTY);
  // The check is a separate step, opened on purpose. Without it the dialog is
  // the record and nothing else.
  const [checkOpen, setCheckOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // A turned-down renewal's row holds the refused document's name, type and
  // expiry. The record on-chain is still the earlier approval, so those
  // neither describe it nor count towards the check.
  const turnedDownRenewal = target?.status === "rejected";

  useEffect(() => {
    if (!target) return;
    let active = true;
    setRecord(null);
    setLoadError(null);
    setCheckOpen(false);
    getKycSubmission(target.id)
      .then((res) => {
        if (!active) return;
        const rec = res.success ? (res.request as KeptRecord | null) : null;
        if (!rec) {
          setLoadError(("error" in res && res.error) || "No such check.");
          return;
        }
        setRecord(rec);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [target]);

  const wallet = target?.wallet ?? null;

  const set =
    (key: keyof Fields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setFields((f) => ({ ...f, [key]: e.target.value }));
      setResult(null);
    };

  const close = () => {
    setFields(EMPTY);
    setResult(null);
    setRecord(null);
    setLoadError(null);
    setCheckOpen(false);
    onClose();
  };

  // The details the fingerprint was made from that the record still holds: an
  // approved check's name, document and expiry. They are what was attested, so
  // they are used as they are; editing them could only produce a false
  // mismatch.
  const locked: Partial<Fields> = {};
  if (record && target?.status === "approved") {
    if (record.full_name) locked.fullName = record.full_name;
    if (record.document_type) locked.documentType = record.document_type;
    if (record.document_expires_on) locked.documentExpiresOn = record.document_expires_on;
  }
  const asks = (key: keyof Fields) => !(key in locked);
  const details: Fields = { ...fields, ...locked };
  const complete = Object.values(details).every((v) => v.trim() !== "");

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet || !complete) return;
    setChecking(true);
    setResult(null);
    try {
      // is_kyc_approved answers false for a wallet with no attestation, where
      // get_attestation would fail, so the two cases stay apart.
      const approved = await simulate(
        () => identityClient().is_kyc_approved({ address: wallet }),
        `is_kyc_approved(${wallet})`,
      );
      if (approved === null) return setResult("unreadable");
      if (!approved) return setResult("not-on-record");
      const recorded = await simulate(
        () => identityClient().get_attestation({ address: wallet }),
        `get_attestation(${wallet})`,
      );
      // Typed as a Buffer, but a contract refusal comes back as an Err object.
      if (!(recorded instanceof Uint8Array)) return setResult("unreadable");
      const typed = await computeDetailsHash({ ...details, stellarAddress: wallet });
      setResult(typed === hex(recorded) ? "match" : "mismatch");
    } finally {
      setChecking(false);
    }
  };

  // Whether the personal details and the document are gone from this row, as
  // they are once a check with a wallet is decided.
  const deleted =
    record !== null &&
    !record.document_path &&
    !record.id_number &&
    !record.date_of_birth &&
    !record.residential_address;
  const lapsed = renewalState(target?.verifiedUntil) === "lapsed";

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Verification details</DialogTitle>
          <DialogDescription>The record for the wallet ending …{wallet?.slice(-4)}.</DialogDescription>
        </DialogHeader>

        {/* ── What is kept ─────────────────────────────────────────────── */}
        {loadError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            Couldn&apos;t load the record: {loadError}
          </p>
        ) : !record ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading the record…
          </p>
        ) : (
          <section aria-labelledby="kept-heading" className="space-y-3">
            <h3 id="kept-heading" className="text-sm font-semibold">
              On record
            </h3>
            {turnedDownRenewal && (
              <p className="text-sm text-muted-foreground">
                This is the renewal that was turned down.
                {target?.verifiedUntil
                  ? ` The public record still holds the earlier approval, valid until ${formatDay(target.verifiedUntil)}.`
                  : ""}
              </p>
            )}
            <dl className="divide-y rounded-lg border text-sm">
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="text-right font-medium">{record.full_name}</dd>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-muted-foreground">Document</dt>
                <dd className="text-right font-medium">{documentLabel(record.document_type)}</dd>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-muted-foreground">ID expires</dt>
                <dd className="text-right font-medium">
                  {record.document_expires_on ? formatDay(record.document_expires_on) : "Not given"}
                  {lapsed && !turnedDownRenewal && (
                    <span className="ml-1 font-semibold text-destructive">(expired)</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">Wallet</dt>
                <dd className="break-all text-right font-mono text-xs">{wallet}</dd>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">Fingerprint</dt>
                <dd className="text-right font-mono text-xs" title={record.details_hash}>
                  {record.details_hash.slice(0, 10)}…{record.details_hash.slice(-10)}
                </dd>
              </div>
            </dl>

            {deleted && (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-semibold">Documents and personal details are deleted after attestation</p>
                  <p className="text-muted-foreground">
                    The ID scan, ID number, date of birth, home address and email were permanently deleted once this
                    check was decided. Only what&apos;s above is kept. The fingerprint is a one-way hash of the
                    details; it&apos;s what the public record holds, and it can&apos;t be turned back into them.
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Check a person against it: a separate step ─────────────── */}
        {record && !checkOpen && (
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={close}>
              Close
            </Button>
            <Button type="button" variant="outline" onClick={() => setCheckOpen(true)}>
              Check a person against this record
            </Button>
          </div>
        )}

        {record && checkOpen && (
          <form onSubmit={check} className="space-y-4 border-t pt-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Check a person against this record</h3>
              <p className="text-sm text-muted-foreground">
                {asks("fullName") || asks("documentType") || asks("documentExpiresOn")
                  ? "For when you need to confirm who holds this wallet. The details this approval was made from aren't kept, so type them from the ID they show you."
                  : "For when you need to confirm who holds this wallet. Ask them to show their ID, and make sure its name, document and expiry match the record above. Then type these from it."}
              </p>
            </div>
            {asks("fullName") && (
              <div className="space-y-1.5">
                <Label htmlFor="rc-name">Full name, as on the ID</Label>
                <Input id="rc-name" value={fields.fullName} onChange={set("fullName")} autoComplete="off" />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rc-dob">Date of birth</Label>
                <Input id="rc-dob" type="date" value={fields.dateOfBirth} onChange={set("dateOfBirth")} />
              </div>
              {asks("documentType") && (
                <div className="space-y-1.5">
                  <Label htmlFor="rc-type">Document</Label>
                  <select
                    id="rc-type"
                    value={fields.documentType}
                    onChange={set("documentType")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {DOCUMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="rc-number">Document number</Label>
                <Input id="rc-number" value={fields.idNumber} onChange={set("idNumber")} autoComplete="off" />
              </div>
              {asks("documentExpiresOn") && (
                <div className="space-y-1.5">
                  <Label htmlFor="rc-expiry">Expiry date</Label>
                  <Input id="rc-expiry" type="date" value={fields.documentExpiresOn} onChange={set("documentExpiresOn")} />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-address">Home address, as they wrote it when they applied</Label>
              <Textarea id="rc-address" rows={2} value={fields.residentialAddress} onChange={set("residentialAddress")} />
            </div>

            <div role="status" aria-live="polite">
              {result === "match" && (
                <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">Match.</span> These are the details that were verified for this
                    wallet.
                  </span>
                </p>
              )}
              {result === "mismatch" && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-semibold">No match.</p>
                    <p>
                      Something differs from what was verified. Check each field against the ID. The address has to
                      be the one they gave when they applied; capitals and spacing don&apos;t matter.
                    </p>
                    <p>
                      An ID issued since they were verified has a different number and expiry, so it won&apos;t
                      match. Ask them to verify again with it.
                    </p>
                  </div>
                </div>
              )}
              {result === "not-on-record" && (
                <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  This wallet has no verification on the public record, so there is nothing to compare with.
                </p>
              )}
              {result === "unreadable" && (
                <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  Couldn&apos;t read the public record just now. Try again.
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setFields(EMPTY);
                  setResult(null);
                  setCheckOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!complete || checking}>
                {checking && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Check
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Checked in your browser. Nothing you type is sent or saved, and it&apos;s cleared when you close this.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
