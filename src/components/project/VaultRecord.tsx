"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EXPLORER_BASE, EXPLORER_EXPLAINER } from "@/lib/network";
import { HORIZON_URL } from "@/lib/stellar-clients";
import { describeRecord, horizonOperationId, RECORD_FILTERS, type RecordFilter, type RecordLine } from "@/lib/vault-record";
// Type only, so the server-only module is erased rather than bundled.
import type { VaultRecord as VaultRecordData } from "@/lib/data/vault-record";

/**
 * The Record tab: everything the vault has done, newest first, in plain words,
 * each line checkable on an independent site.
 *
 * It reads the events the indexer stored from the ledger, so it can be a
 * minute or two behind; the page says how far. "Verify this" looks up the
 * line's transaction on the public ledger only when someone asks.
 */

function when(iso: string | null, withYear = false) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ago(iso: string | null) {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "less than a minute ago";
  if (mins === 1) return "a minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
}

/** "Verify this": the line's transaction, looked up on the public ledger on demand. */
function Verify({ line }: { line: RecordLine }) {
  const [hash, setHash] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const op = horizonOperationId(line.id);
    if (!op) {
      setHash(null);
      return;
    }
    let active = true;
    fetch(`${HORIZON_URL}/operations/${op}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active) setHash(typeof data?.transaction_hash === "string" ? data.transaction_hash : null);
      })
      .catch(() => {
        if (active) setHash(null);
      });
    return () => {
      active = false;
    };
  }, [line.id]);

  const copy = async () => {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Shown in full on the public ledger page.
    }
  };

  return (
    <div className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-sm">
      <p className="font-medium">Verify this</p>
      <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
        Transaction hash{" "}
        {hash === undefined ? (
          <span>looking it up…</span>
        ) : hash ? (
          <>
            <span className="font-mono text-foreground">
              {hash.slice(0, 4)}…{hash.slice(-4)}
            </span>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={copy} aria-label="Copy the transaction hash">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </>
        ) : (
          <span>couldn&apos;t be looked up just now</span>
        )}
      </p>
      <p className="text-muted-foreground">Recorded on-chain {when(line.at, true)}</p>
      {hash && (
        <a
          href={`${EXPLORER_BASE}/tx/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          View on Stellar Expert
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
      <p className="text-xs text-muted-foreground">{EXPLORER_EXPLAINER}</p>
    </div>
  );
}

export function VaultRecord({
  projectId,
  currency,
  xlmUsd,
  me,
  ledgerUrl,
}: {
  projectId: string;
  currency: string;
  xlmUsd: number | null;
  /** The viewer's wallet, so their own lines say "You". */
  me: string | null;
  /** The vault on the public ledger, offered when the record can't load. */
  ledgerUrl: string | null;
}) {
  const [data, setData] = useState<VaultRecordData | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RecordFilter>("all");
  // Rows opened so far. A closed <details> still mounts its content, so the
  // lookup is rendered only once a row has been opened.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/record`);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as VaultRecordData);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = useMemo(
    () =>
      data
        ? describeRecord(data.entries, {
            currency,
            xlmUsd,
            stageName: (id) => `Stage ${id}`,
            me,
          })
        : [],
    [data, currency, xlmUsd, me],
  );
  const shown = lines.filter((l) => l.filters.includes(filter));

  if (loading && !data) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading the record">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </div>
    );
  }

  if (failed && !data) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4 text-sm">
        <p>We couldn&apos;t load the record just now.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
          {ledgerUrl && (
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <a href={ledgerUrl} target="_blank" rel="noopener noreferrer">
                View on Stellar Expert
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing recorded on-chain yet. The vault opens when the builder&apos;s deposit lands.
      </p>
    );
  }

  const freshness = ago(data?.indexedAt ?? null);

  return (
    <section aria-label="The vault's record" className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Indexed from the Stellar ledger by our indexer. Every line can be verified on Stellar
          Expert, an independent block explorer.
        </p>
        {freshness && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Showing the record as of {freshness}. Newer entries are on their way.
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3 w-3" aria-hidden="true" />}
              Refresh
            </button>
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {RECORD_FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            className="h-8 rounded-full px-3"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing of this kind yet.</p>
      ) : (
        <ol className="divide-y divide-border/60 rounded-xl border border-border">
          {shown.map((line) => (
            <li key={line.id}>
              <details
                className="group"
                onToggle={(e) => {
                  if ((e.currentTarget as HTMLDetailsElement).open && !opened.has(line.id)) {
                    setOpened((prev) => new Set(prev).add(line.id));
                  }
                }}
              >
                <summary
                  className={cn(
                    "flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2.5 hover:bg-muted/30",
                    line.mine && "bg-primary/5",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm">{line.sentence}</span>
                    <span className="block text-xs text-muted-foreground">{when(line.at)}</span>
                  </span>
                  {line.amount && <span className="shrink-0 text-sm font-medium tabular-nums">{line.amount}</span>}
                </summary>
                <div className="px-3 pb-3">{opened.has(line.id) && <Verify line={line} />}</div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
