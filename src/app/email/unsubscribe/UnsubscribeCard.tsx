"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EMAIL_SWITCH_COPY, type EmailSwitch } from "@/lib/email/categories";
import { unsubscribeFromEmail } from "./actions";

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function UnsubscribeCard({ token, category }: { token: string; category: EmailSwitch | null }) {
  const [state, setState] = useState<"ask" | "saving" | "done" | "invalid" | "failed">(
    token && category ? "ask" : "invalid",
  );

  const stop = async () => {
    if (!category) return;
    setState("saving");
    const res = await unsubscribeFromEmail(token, category).catch(() => null);
    setState(res?.success ? "done" : res?.error === "invalid" ? "invalid" : "failed");
  };

  if (state === "invalid" || !category) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>That link doesn&apos;t work any more</CardTitle>
          <CardDescription>
            It may have been copied only in part. You can choose which emails you get in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings#email">Open email settings</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const copy = EMAIL_SWITCH_COPY[category];

  if (state === "done") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true" />
            Done
          </CardTitle>
          <CardDescription>
            {copy.unsubscribed} They&apos;ll still show in your notifications on BLKFNDR.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Changed your mind? Turn them back on in{" "}
            <Link href="/settings#email" className="underline underline-offset-4">
              Settings
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.stopTitle}</CardTitle>
        <CardDescription>
          You get these {lowerFirst(copy.detail)} They&apos;ll still show in your notifications on BLKFNDR.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={stop} disabled={state === "saving"}>
            {state === "saving" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Stop these emails
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Keep getting them</Link>
          </Button>
        </div>
        {state === "failed" && (
          <p role="alert" className="text-sm text-destructive">
            We couldn&apos;t save that just now. Try again in a moment.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
