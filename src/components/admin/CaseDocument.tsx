"use client";

import { useEffect, useState } from "react";
import { FileCode, Loader2 } from "lucide-react";

/**
 * An applicant's identity document, shown without the reviewer's browser
 * keeping a copy.
 *
 * The document is reached through a short-lived signed URL. Supabase Storage
 * serves those with no Cache-Control header (checked 2026-10-07), so an <img>
 * or link pointed at one leaves the browser free to store the image in its
 * disk cache, by its own heuristics. That is a copy of someone's ID on the
 * reviewer's machine, outliving the document deleted after the decision.
 *
 * So the bytes are fetched with cache: "no-store", which neither reads from
 * nor writes to the HTTP cache, and shown from an object URL held in memory.
 * The object URL is revoked when the case closes or the panel goes away.
 * Storage answers any origin (CORS *), so no proxy is needed.
 */
function useUncachedObjectUrl(signedUrl: string) {
  const [state, setState] = useState<{ url: string } | "loading" | "failed">("loading");

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setState("loading");
    fetch(signedUrl, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl });
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [signedUrl]);

  return state;
}

const BOX = "w-full aspect-[4/3] flex flex-col items-center justify-center gap-2 rounded-xl";

export function CaseDocument({
  signedUrl,
  isPdf,
  onInspect,
}: {
  signedUrl: string;
  /** A PDF opens in the browser's own viewer; an image in the panel's. */
  isPdf: boolean;
  /** Open the image viewer on this in-memory copy. */
  onInspect: (objectUrl: string) => void;
}) {
  const doc = useUncachedObjectUrl(signedUrl);

  if (doc === "loading") {
    return (
      <div className={`${BOX} bg-muted/30 border-2 border-dashed border-border/50`}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading the document" />
      </div>
    );
  }
  if (doc === "failed") {
    return (
      <div className={`${BOX} bg-muted/30 border-2 border-dashed border-border/50`}>
        <span className="text-xs text-muted-foreground italic px-4 text-center">
          Couldn&apos;t load the document. Close the case and open it again.
        </span>
      </div>
    );
  }

  if (isPdf) {
    return (
      <a
        href={doc.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${BOX} bg-muted/30 border-2 border-border/60 text-sm font-semibold text-primary hover:bg-muted/50`}
      >
        <FileCode className="h-8 w-8" />
        Open the PDF document
        <span className="text-xs font-normal text-muted-foreground">Opens in a new tab. Your browser doesn&apos;t keep a copy.</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onInspect(doc.url)}
      className="group relative cursor-pointer block border-2 border-border/60 rounded-xl overflow-hidden w-full aspect-[4/3] bg-zinc-900/30 shadow-lg hover:shadow-xl transition-all"
    >
      {/* Not next/image: its optimizer would fetch and cache the ID server-side. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={doc.url}
        alt="Verification Document"
        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-white font-semibold tracking-wide">
        Click to Inspect
      </span>
    </button>
  );
}
