"use client";

import { useId, useState } from "react";
import { ChevronDown, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Where the landing page keeps its deepest technical material: wasm hashes,
 * contract addresses, build commands and test names. Collapsed by default so
 * the page stays easy to scan; everything inside it stays on the page so the
 * custody claims above remain checkable.
 *
 * A small stateful disclosure rather than a dependency: the project has no
 * accordion primitive and this increment adds no packages.
 */
export function AuditorAccordion({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonId = useId();

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-4 px-6 py-5 text-left transition-colors hover:bg-muted/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Code2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-headline text-lg font-semibold">
              {title}
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {intro}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        className="border-t px-6 py-6 sm:px-8"
      >
        {children}
      </div>
    </div>
  );
}
