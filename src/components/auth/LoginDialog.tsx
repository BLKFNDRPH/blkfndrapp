"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import StaticBLKFNDR from "../layout/StaticBLKFNDR";
import { AuthForm, type AuthMode } from "./AuthForm";

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: () => void | Promise<void>;
}

/**
 * The one sign-in sheet. It stays on the page, says honestly that moving
 * money also needs a wallet, and lets the server actions carry the person
 * back to where they were (the `next` field below; the project they had open
 * is remembered by ProjectDetailsContext).
 */
const COPY: Record<AuthMode, { title: string; subtitle: string }> = {
  signin: {
    title: "Sign in to",
    subtitle:
      "Follow vaults, stake from $5 and vote on payouts. To move money you'll also set up a Stellar wallet you control; we'll guide you right after this (about five minutes).",
  },
  signup: {
    title: "Create your",
    subtitle:
      "One account for your stakes, votes and projects. You'll confirm it by email, then we'll bring you straight back here.",
  },
};

export function LoginDialog({ isOpen, onClose }: LoginDialogProps) {
  const pathname = usePathname();
  const [mode, setMode] = useState<AuthMode>("signin");
  const copy = COPY[mode];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setMode("signin");
        }
      }}
    >
      <DialogContent
        className="sm:max-w-md border border-neutral-800/80 bg-neutral-950/90 backdrop-blur-xl p-6 rounded-2xl shadow-2xl shadow-black/40"
        hideCloseButton
      >
        <DialogClose className="absolute right-4 top-4 rounded-full p-1.5 bg-neutral-900/60 hover:bg-neutral-800/80 border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition-all focus:outline-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogClose>

        <DialogHeader className="text-center space-y-2">
          <DialogTitle className="text-2xl font-bold tracking-tight text-white">
            {copy.title}{" "}
            <span className="inline-block align-middle ml-1">
              <StaticBLKFNDR />
            </span>
            {mode === "signup" && " account"}
          </DialogTitle>
          <DialogDescription className="text-neutral-400 text-sm">
            {copy.subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="pt-6">
          <AuthForm next={pathname || "/profile"} mode={mode} onModeChange={setMode} />
        </div>

        <p className="pt-2 text-center text-xs text-neutral-500">
          Already use Freighter? Sign in first, then connect it from Settings.
        </p>
      </DialogContent>
    </Dialog>
  );
}
