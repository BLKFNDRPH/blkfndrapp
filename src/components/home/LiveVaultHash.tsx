"use client";

import { useEffect, useState } from "react";
import { EXPLORER_EXPLAINER } from "@/lib/network";

/**
 * The vault code hash the factory deploys new projects from, read from the
 * chain via /api/vault-wasm-hash.
 *
 * It used to be a constant in the page, which went stale the moment the
 * factory was pointed at new code. Showing a hash that is not the one in use
 * would be worse than showing none, so a failed read says so instead of falling
 * back to a remembered value.
 *
 * Renders only inside the "For auditors and developers" disclosure, which is
 * why it may print a raw hash.
 */
export function LiveVaultHash({ factoryExplorerUrl }: { factoryExplorerUrl: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ok"; hash: string } | { status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/vault-wasm-hash")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { hash?: string }) => {
        if (cancelled) return;
        setState(body.hash ? { status: "ok", hash: body.hash } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "ok") {
    return (
      <code className="mt-2 block break-all font-code text-xs leading-relaxed">
        {state.hash}
      </code>
    );
  }
  if (state.status === "loading") {
    return (
      <p className="mt-2 text-xs text-muted-foreground">Reading it from the factory…</p>
    );
  }
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Could not read it from the network just now. The factory&apos;s storage is
      public —{" "}
      <a
        href={factoryExplorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={EXPLORER_EXPLAINER}
        className="underline underline-offset-2"
      >
        see the public record
      </a>
      .
    </p>
  );
}
