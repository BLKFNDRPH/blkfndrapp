"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { projectHref } from "@/lib/project-href";

export interface OpenedVault {
  title: string;
  /** The project's number, or null when it could not be read back yet. */
  projectId: string | null;
  /** True when this draft had opened a vault before, and nothing new was paid. */
  alreadyOpened?: boolean;
}

/**
 * The page after a vault opens, in place of the form: what happened, where the
 * project will live, and a link to share. The listing reaches Projects once
 * BLKFNDR has read the new vault, so the page says when, rather than sending
 * the builder to a list it isn't in yet.
 */
export function LaunchSuccess({ opened, onStartAnother }: { opened: OpenedVault; onStartAnother: () => void }) {
  const [copied, setCopied] = useState(false);
  const href = opened.projectId ? projectHref(opened.projectId) : null;

  const copyLink = async () => {
    if (!href) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The address bar of the project page has it too.
    }
  };

  return (
    <section
      aria-labelledby="vault-open-title"
      className="rounded-xl border border-emerald-500/30 bg-card p-6 text-center sm:p-10"
    >
      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden="true" />
      <h2 id="vault-open-title" className="mt-4 text-2xl font-bold">
        {opened.alreadyOpened ? "This draft already opened a vault" : "Your vault is open"}
      </h2>
      <p className="mt-2 break-words text-lg font-medium">{opened.title}</p>
      <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
        {opened.alreadyOpened ? (
          "Nothing new was paid or confirmed. If it isn't in Projects yet, it will be within a minute or two."
        ) : (
          <>
            Your deposit is locked in it, and people can stake as soon as it shows in Projects. It
            appears there within a minute or two, once BLKFNDR has read the new vault
            {href ? ", and the link below works from then on." : "."}
          </>
        )}
      </p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        {href ? (
          <>
            <Button type="button" variant="outline" className="gap-1.5" onClick={copyLink}>
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
              {copied ? "Link copied" : "Copy the link to share"}
            </Button>
            <Button asChild>
              <Link href={href}>{opened.alreadyOpened ? "View your project" : "Go to your vault"}</Link>
            </Button>
          </>
        ) : (
          <Button asChild>
            <Link href="/projects">See all projects</Link>
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={onStartAnother}
        className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Open another vault
      </button>
    </section>
  );
}
