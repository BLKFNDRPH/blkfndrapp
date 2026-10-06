"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { identityClient, simulate } from "@/lib/stellar-clients";

/**
 * What the public record says about this person's check, shown here rather
 * than by sending them to a contract explorer: the wallet it clears and the
 * reference it was recorded with. The reference is the commitment to their
 * details that the reviewer's attestation put on the public record; it proves
 * a set of details was checked without revealing any of them.
 */
export function VerificationRecord({
  open,
  onOpenChange,
  wallet,
  approvedOn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: string;
  /** When the check was last decided, from the submission. */
  approvedOn: string | null;
}) {
  const [reference, setReference] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || reference !== undefined) return;
    let active = true;
    simulate(() => identityClient().get_attestation({ address: wallet }), `get_attestation(${wallet})`).then(
      (hash) => {
        if (!active) return;
        // A Buffer from the binding, which is a Uint8Array; no global Buffer needed.
        setReference(
          hash
            ? Array.from(hash as Uint8Array, (b) => b.toString(16).padStart(2, "0")).join("")
            : null,
        );
      },
    );
    return () => {
      active = false;
    };
  }, [open, wallet, reference]);

  const copy = async () => {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Shown in full below the short form anyway.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your verification record</DialogTitle>
          <DialogDescription>
            A public note that this account ID passed an identity check. Your documents and details
            are never published.
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y rounded-lg border text-sm">
          <div className="flex justify-between gap-4 px-3 py-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium text-emerald-600 dark:text-emerald-400">Verified by a BLKFNDR reviewer</dd>
          </div>
          {approvedOn && (
            <div className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-muted-foreground">Approved</dt>
              <dd className="font-medium">
                {new Date(approvedOn).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-4 px-3 py-2">
            <dt className="text-muted-foreground">Attached wallet</dt>
            <dd className="font-medium">Account ID …{wallet.slice(-4)}</dd>
          </div>
          <div className="space-y-1 px-3 py-2">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                {reference === undefined
                  ? "Reading…"
                  : reference
                    ? `${reference.slice(0, 4)}…${reference.slice(-4)}`
                    : "Couldn't read it just now"}
                {reference && (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={copy} aria-label="Copy the reference">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </dd>
            </div>
            {reference && (
              <p className="break-all font-mono text-xs text-muted-foreground">{reference}</p>
            )}
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          The reference is a fingerprint of the details you submitted. Anyone holding those details
          can check it matches; nobody can work the details out from it.
        </p>
      </DialogContent>
    </Dialog>
  );
}
