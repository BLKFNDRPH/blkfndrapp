"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { usePlatformInfo } from "@/context/BlockchainContext";

/**
 * The contact address for fee matters.
 *
 * It used to sit beside the fee destination in a panel called "Tools", which
 * put a plain contact string next to the single most consequential setting on
 * the platform and gave them one Save button. Changing where every listing fee
 * goes and correcting a typo in an email are not the same kind of act, and they
 * should not be one gesture.
 *
 * This half touches no money and no contract — it is a note in a table. The
 * other half now lives beside the vault balance it redirects, behind a
 * confirmation.
 */
export function FeeContactForm() {
  const { toast } = useToast();
  const { platformInfo } = usePlatformInfo();
  const [email, setEmail] = useState("");
  const [saving, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (platformInfo?.feeWalletEmail) setEmail(platformInfo.feeWalletEmail);
  }, [platformInfo?.feeWalletEmail]);

  const save = () => {
    setBusy(true);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/platform-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feeWalletEmail: email }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? "Could not save the contact address.");
        }
        toast({ title: "Contact address saved" });
      } catch (err: any) {
        toast({
          title: "Could not save",
          description: err?.message ?? String(err),
          variant: "destructive",
        });
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="fee-contact">Fee contact address</Label>
      <Input
        id="fee-contact"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="admin@example.com"
      />
      <p className="text-xs text-muted-foreground">
        Where fee correspondence goes. This is a contact detail only — it does not
        affect where fees are actually sent, which is the platform vault.
      </p>
      <Button size="sm" variant="outline" disabled={busy || saving} onClick={save}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Mail className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="ml-1.5">Save contact</span>
      </Button>
    </div>
  );
}
