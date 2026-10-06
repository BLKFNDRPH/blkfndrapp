"use client";

import { Cog } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/types";

export type Participation = "watching" | "stakeholder" | "steward";
export type IdentityState = "loading" | "none" | "pending" | "approved" | "rejected" | "verified";

const PARTICIPATION_LABEL: Record<Participation, string> = {
  watching: "Watching",
  stakeholder: "Stakeholder",
  steward: "Builder",
};

const IDENTITY: Record<Exclude<IdentityState, "loading">, { label: string; className: string }> = {
  none: { label: "Identity not verified", className: "border-border bg-muted/60 text-muted-foreground" },
  pending: {
    label: "Identity under review",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  // Approved by a reviewer, not yet on the public record: waiting for a wallet
  // to be attached, or for a reviewer to record it.
  approved: {
    label: "Identity approved: one step left",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  rejected: {
    label: "Identity needs a new document",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  verified: {
    label: "Identity verified",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
};

const chip = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium";

/**
 * Who this account is, in two neutral chips: how they take part and where
 * their identity check stands. Never a red pill about a wallet: a missing
 * wallet is a to-do in the set-up card, not a fault.
 */
export function ProfileHeader({
  user,
  participation,
  identity,
}: {
  user: User;
  participation: Participation;
  identity: IdentityState;
}) {
  return (
    <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
      <div className="relative">
        <Avatar className="h-20 w-20 border-4 border-primary">
          <AvatarImage src={user.avatarUrl} alt="" />
          <AvatarFallback className="text-2xl">{user.name.charAt(0)}</AvatarFallback>
        </Avatar>
        {user.role === "admin" && (
          <span
            className="absolute bottom-0 right-0 rounded-full border-2 border-background bg-primary p-1.5 text-primary-foreground"
            title="BLKFNDR admin"
          >
            <Cog className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <h1 className="font-headline text-2xl font-bold [overflow-wrap:anywhere]">{user.name}</h1>
        {user.email && <p className="text-sm text-muted-foreground">{user.email}</p>}
        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
          <span className={cn(chip, "border-primary/30 bg-primary/10 text-foreground")}>
            {PARTICIPATION_LABEL[participation]}
          </span>
          {identity !== "loading" && (
            <span className={cn(chip, IDENTITY[identity].className)}>{IDENTITY[identity].label}</span>
          )}
        </div>
      </div>
    </header>
  );
}
