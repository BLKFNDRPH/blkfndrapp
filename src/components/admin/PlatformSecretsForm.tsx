"use client";

import { useEffect, useState, useTransition } from "react";
import { KeyRound, Check, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  getSecretStatusAction,
  setPlatformSecretAction,
} from "@/actions/secrets";

/**
 * Integration secrets — set here, stored in the Vault, never shown back.
 *
 * These fields are write-only by design. The value you type goes to the server
 * and into Supabase Vault; nothing, including this page, can read it back out —
 * only the server's own key can, and only when it needs the secret to do its
 * job. So there is no "current value" to display: a secret is either set or not,
 * and rotating it is typing a new one over the top.
 *
 * That is also why a blank field is not a way to clear a secret. Leaving it
 * empty does nothing; the existing value stays. Clearing is deliberately not
 * offered — an integration silently losing its key is a worse accident than one
 * you have to mean.
 */
interface SecretMeta {
  name: "pinata_jwt" | "resend_api_key";
  label: string;
  hint: string;
}

const SECRETS: SecretMeta[] = [
  {
    name: "pinata_jwt",
    label: "Pinata JWT",
    hint: "Authorises pinning project images and metadata to IPFS.",
  },
  {
    name: "resend_api_key",
    label: "Resend API key",
    hint: "For sending platform email. Stored now; email sending is a later step.",
  },
];

export function PlatformSecretsForm() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Record<string, { isSet: boolean; updatedAt: string | null }>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const applyStatus = (rows: { name: string; is_set: boolean; updated_at: string | null }[]) => {
    const next: Record<string, { isSet: boolean; updatedAt: string | null }> = {};
    for (const row of rows) next[row.name] = { isSet: row.is_set, updatedAt: row.updated_at };
    setStatus(next);
  };

  useEffect(() => {
    getSecretStatusAction().then((res) => {
      if (res.success) applyStatus(res.status as any);
    });
  }, []);

  const save = (name: SecretMeta["name"]) => {
    const value = drafts[name] ?? "";
    if (!value.trim()) return;
    setBusy(name);
    startTransition(async () => {
      try {
        const res = await setPlatformSecretAction(name, value);
        if (res.success) {
          applyStatus(res.status as any);
          setDrafts((d) => ({ ...d, [name]: "" }));
          toast({ title: "Secret saved" });
        } else {
          toast({ title: "Could not save", description: res.error, variant: "destructive" });
        }
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Integration secrets</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Stored in the Supabase Vault and readable only by the server. Once saved,
        a secret is never shown again — to replace one, type a new value over it.
      </p>

      {SECRETS.map((s) => {
        const set = status[s.name]?.isSet;
        return (
          <div key={s.name} className="space-y-1.5 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`secret-${s.name}`}>{s.label}</Label>
              {set ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  Set
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Not set
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                id={`secret-${s.name}`}
                type="password"
                autoComplete="off"
                value={drafts[s.name] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                placeholder={set ? "Enter a new value to replace it" : "Paste the secret"}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy === s.name || !(drafts[s.name] ?? "").trim()}
                onClick={() => save(s.name)}
              >
                {busy === s.name ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span className="ml-1.5">Save</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{s.hint}</p>
          </div>
        );
      })}
    </div>
  );
}
