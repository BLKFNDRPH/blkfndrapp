"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/AuthContext";
import { getMyEmailSettings, setMyEmailPreference } from "@/app/settings/actions";
import {
  EMAIL_SWITCHES,
  EMAIL_SWITCH_COPY,
  type EmailPreferences,
  type EmailSwitch,
} from "@/lib/email/categories";

/**
 * The email switches. Each one saves as it is flipped; a failed save puts the
 * switch back and says so beside it.
 */
export function EmailSettings() {
  const { user, login } = useAuth();
  const uid = user?.uid ?? null;

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [saving, setSaving] = useState<EmailSwitch | null>(null);
  const [failed, setFailed] = useState<EmailSwitch | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Keyed on the account, not the user object, which is replaced on every
  // refresh and would otherwise reset the switches mid-change.
  useEffect(() => {
    if (!uid) return;
    let live = true;
    setState("loading");
    getMyEmailSettings()
      .then((res) => {
        if (!live) return;
        if (!res.success) {
          setState("error");
          return;
        }
        setEmail(res.settings.email);
        setIsAdmin(res.settings.isAdmin);
        setPrefs(res.settings.preferences);
        setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [uid, attempt]);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center">
        <p className="text-sm font-semibold text-foreground">Sign in first</p>
        <p className="text-xs text-muted-foreground">Sign in to choose which emails you get.</p>
        <Button onClick={() => login()} className="h-9 w-full">
          Sign in
        </Button>
      </div>
    );
  }

  if (state === "loading" || (state === "ready" && !prefs)) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading your email settings...
      </p>
    );
  }

  if (state === "error" || !prefs) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">We couldn&apos;t load your email settings. Try again in a moment.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  const flip = async (sw: EmailSwitch, on: boolean) => {
    const before = prefs;
    setFailed(null);
    setSaving(sw);
    setPrefs({ ...prefs, [sw]: on });
    const res = await setMyEmailPreference(sw, on).catch(() => null);
    setSaving(null);
    if (res?.success) {
      setPrefs(res.preferences);
    } else {
      setPrefs(before);
      setFailed(sw);
    }
  };

  const shown = EMAIL_SWITCHES.filter((sw) => sw !== "reviews" || isAdmin);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {email ? (
          <>
            Emails go to <span className="font-medium text-foreground">{email}</span>, the address you sign in with.
          </>
        ) : (
          "Your account has no email address, so we can't email you. Everything still shows in your notifications."
        )}
      </p>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {shown.map((sw) => {
          const copy = EMAIL_SWITCH_COPY[sw];
          const id = `email-switch-${sw}`;
          return (
            <li key={sw} className="flex items-start justify-between gap-4 p-4">
              <div className="space-y-1">
                <label htmlFor={id} className="text-sm font-medium leading-snug text-foreground">
                  {copy.label}
                </label>
                <p id={`${id}-detail`} className="text-xs text-muted-foreground">
                  {copy.detail}
                </p>
                {failed === sw && (
                  <p role="alert" className="text-xs text-destructive">
                    We couldn&apos;t save that. Try again.
                  </p>
                )}
              </div>
              <Switch
                id={id}
                checked={prefs[sw]}
                onCheckedChange={(on) => flip(sw, on)}
                disabled={saving !== null || !email}
                aria-describedby={`${id}-detail`}
              />
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Emails about your own account, like the result of your identity check, always come through. We only email about
        vaults you&apos;re part of and your own account. Never marketing.
      </p>
    </div>
  );
}
