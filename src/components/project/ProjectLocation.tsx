"use client";

import { MapPin, ExternalLink } from "lucide-react";

/**
 * Where a project says it is based, pinned on Google Maps.
 *
 * Two rendering paths, chosen by whether a Maps key is configured. Without one
 * this is a link — which works everywhere, costs nothing and needs no key. With
 * one it embeds the map inline. The link is not a degraded fallback; for most
 * deployments it is the right answer, and an interactive map is the upgrade.
 *
 * The location is creator-supplied and unverified, so the wording says "listed"
 * rather than asserting the project is there. A backer reading a precise address
 * should not infer that anyone checked it.
 */

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

interface Props {
  location?: string;
  lat?: number | null;
  lng?: number | null;
}

export function ProjectLocation({ location, lat, lng }: Props) {
  const hasPoint = typeof lat === "number" && typeof lng === "number";
  const label = location?.trim() ?? "";

  // Nothing to show. An empty string is the column default, so this is the
  // common case for every project created before the field existed.
  if (!label && !hasPoint) return null;

  // A point is unambiguous; a place name is not, so prefer coordinates when we
  // have them and let the name be the caption.
  const query = hasPoint ? `${lat},${lng}` : label;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium break-words">{label || query}</p>
            <p className="text-xs text-muted-foreground">
              Listed by the project creator
            </p>
          </div>
        </div>
        <a
          href={mapsUrl}
          target="_blank"
          // noreferrer as well as noopener: the destination should not receive
          // this page's URL, which identifies the project being viewed.
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open in Maps
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>

      {MAPS_KEY ? (
        <iframe
          title={`Map showing ${label || query}`}
          className="w-full h-48 rounded-lg border border-border/60"
          loading="lazy"
          // Without this the embed leaks the full listing URL to Google on every
          // project view.
          referrerPolicy="no-referrer"
          allowFullScreen
          src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(
            MAPS_KEY,
          )}&q=${encodeURIComponent(query)}`}
        />
      ) : null}
    </div>
  );
}
