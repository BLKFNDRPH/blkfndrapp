"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

/**
 * MoneyActionPanel, loaded when it is first shown.
 *
 * The panel brings the wallet setup flow and, through it, the whole Stellar
 * SDK (about 440 KB compressed). It only ever appears after someone presses
 * an action (vote, open a vote, collect, close the vault), so a page showing
 * those buttons no longer loads it for every visitor who just reads.
 */
export const LazyMoneyActionPanel = dynamic(
  () => import("./MoneyActionPanel").then((m) => m.MoneyActionPanel),
  {
    ssr: false,
    loading: () => (
      <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Getting this ready…
      </div>
    ),
  },
);
