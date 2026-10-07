"use client";

import { useState } from "react";
import { CheckCircle2, CircleHelp, Loader2, XCircle } from "lucide-react";
import { computeDetailsHash } from "@/lib/kyc/details-hash";
import { identityClient, simulate } from "@/lib/stellar-clients";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

/**
 * Check a person against their verification record, with no documents kept.
 *
 * A check's documents and details are deleted once it is decided
 * (20261007130000). What remains is the hash its attestation put on the
 * record: SHA-256 of the details and the wallet (src/lib/kyc/details-hash.ts).
 * When there is doubt about who holds a verified wallet -- a dispute, an
 * account recovery, a report -- the person shows their ID again, the reviewer
 * types its details here, and the hash is recomputed and compared with the
 * record. A match means these are the details that were verified for this
 * wallet.
 *
 * Runs in the reviewer's browser. What is typed never reaches the server and
 * is never stored: the hash is computed here, the record is read from the
 * chain, and the fields are cleared when the dialog closes.
 */

const DOCUMENT_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID card" },
  { value: "drivers_license", label: "Driver's license" },
] as const;

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
  wallet,
  onClose,
}: {
  /** The wallet to check against; the dialog is open while this is set. */
  wallet: string | null;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const set =
    (key: keyof Fields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setFields((f) => ({ ...f, [key]: e.target.value }));
      setResult(null);
    };

  const close = () => {
    setFields(EMPTY);
    setResult(null);
    onClose();
  };

  const complete = Object.values(fields).every((v) => v.trim() !== "");

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
      const typed = await computeDetailsHash({ ...fields, stellarAddress: wallet });
      setResult(typed === hex(recorded) ? "match" : "mismatch");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open={wallet !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check against the record</DialogTitle>
          <DialogDescription>
            Ask the person to show their ID, and type its details. They are compared with what was
            verified for the wallet ending …{wallet?.slice(-4)}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={check} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rc-name">Full name, as on the ID</Label>
            <Input id="rc-name" value={fields.fullName} onChange={set("fullName")} autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rc-dob">Date of birth</Label>
              <Input id="rc-dob" type="date" value={fields.dateOfBirth} onChange={set("dateOfBirth")} />
            </div>
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
            <div className="space-y-1.5">
              <Label htmlFor="rc-number">Document number</Label>
              <Input id="rc-number" value={fields.idNumber} onChange={set("idNumber")} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-expiry">Expiry date</Label>
              <Input id="rc-expiry" type="date" value={fields.documentExpiresOn} onChange={set("documentExpiresOn")} />
            </div>
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
            <Button type="button" variant="ghost" onClick={close}>
              Close
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
      </DialogContent>
    </Dialog>
  );
}
