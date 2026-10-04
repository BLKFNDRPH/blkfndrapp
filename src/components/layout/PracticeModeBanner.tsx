"use client";

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IS_PRACTICE_NETWORK } from "@/lib/network";

/**
 * The one place the app says, in plain words, that the money here is not real.
 *
 * Replaces every "Testnet" badge and "Live on testnet" pill. Shown only on a
 * practice network. Dismissing it collapses it to a thin line that still reads
 * "Practice mode", because a visitor who hid it an hour ago must never mistake
 * a practice balance for a real one. The collapsed state is remembered per
 * browser; it is a convenience, so a storage failure simply shows the full
 * banner again.
 */

const STORAGE_KEY = "blkfndr.practice-banner.collapsed";

export const PRACTICE_BANNER_SENTENCE =
  "Practice mode: the dollars here are practice dollars. Nothing you add or stake is real money.";

export const PRACTICE_POPOVER =
  "BLKFNDR is running on a test network. The money here is practice money: added free in the app straight into a wallet only you hold, and impossible to cash out. Real money arrives when we move to the main network.";

export function PracticeModeBanner() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private window or blocked storage: show the full banner.
    }
  }, []);

  if (!IS_PRACTICE_NETWORK) return null;

  const remember = (value: boolean) => {
    setCollapsed(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Not remembering it is fine.
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => remember(false)}
        className="block w-full bg-amber-500/15 py-0.5 text-center text-[11px] font-medium text-amber-700 dark:text-amber-300"
        aria-label="Practice mode. Show what this means."
      >
        Practice mode
      </button>
    );
  }

  return (
    <div
      role="status"
      className="flex min-h-9 w-full items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-center text-xs text-amber-800 dark:text-amber-200 sm:text-sm"
    >
      <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {PRACTICE_BANNER_SENTENCE}{" "}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
            >
              What does this mean?
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 text-sm leading-relaxed">
            {PRACTICE_POPOVER}
          </PopoverContent>
        </Popover>
      </span>
      <button
        type="button"
        onClick={() => remember(true)}
        className="ml-1 rounded-full p-1 hover:bg-amber-500/20"
        aria-label="Collapse the practice-mode banner"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
