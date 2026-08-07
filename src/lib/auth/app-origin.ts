import "server-only";

import { headers } from "next/headers";

/**
 * The public origin of this deployment.
 *
 * Route handlers used to build redirects from `request.nextUrl.origin`. Behind
 * a reverse proxy that does not preserve the Host header, that resolves to the
 * container's own bind address — `https://0.0.0.0:3000` in this deployment —
 * and the browser is sent somewhere it cannot reach. It is the reason OAuth
 * appeared to succeed and then landed on port 3000.
 *
 * So the origin comes from configuration, and the request only chooses between
 * origins we already named.
 *
 * NEXT_PUBLIC_APP_URL is canonical. APP_URLS adds more, comma separated, for a
 * deployment answering on several domains. APP_URLS has no NEXT_PUBLIC_ prefix
 * because nothing reads it in the browser — a new domain takes a restart rather
 * than a rebuild.
 */
export function allowedOrigins(): string[] {
  const raw = [
    process.env.NEXT_PUBLIC_APP_URL ?? "",
    ...(process.env.APP_URLS ?? "").split(","),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim().replace(/\/+$/, "");
    if (!trimmed) continue;
    try {
      // Parsed rather than pattern-matched, so a malformed entry is dropped
      // instead of becoming a redirect target nobody intended.
      const origin = new URL(trimmed).origin;
      if (!seen.has(origin)) {
        seen.add(origin);
        out.push(origin);
      }
    } catch {
      console.warn(`[auth] Ignoring unparseable origin in configuration: ${entry}`);
    }
  }
  return out;
}

/**
 * Which configured origin this request arrived on.
 *
 * Both `x-forwarded-host` and `host` are consulted, because a proxy may rewrite
 * one and not the other — nginx's default `proxy_set_header Host $proxy_host`
 * replaces Host with the upstream, which is exactly how the internal address
 * ended up in redirects here.
 *
 * Both headers are attacker-controlled, and neither is trusted: they only
 * select among origins already configured. A value that matches nothing gets
 * the canonical origin rather than itself, so this cannot be turned into an
 * open redirect.
 */
export async function publicOrigin(): Promise<string> {
  const allowed = allowedOrigins();
  const headerList = await headers();

  const candidates = [
    headerList.get("x-forwarded-host"),
    headerList.get("host"),
  ]
    // A proxy chain can produce "a.example, b.example"; the first hop is the
    // client-facing one.
    .map((h) => h?.split(",")[0]?.trim())
    .filter((h): h is string => Boolean(h));

  for (const candidate of candidates) {
    const match = allowed.find((origin) => {
      try {
        return new URL(origin).host.toLowerCase() === candidate.toLowerCase();
      } catch {
        return false;
      }
    });
    if (match) return match;
  }

  if (allowed.length > 0) {
    // Configured, but this request arrived on a host we do not recognise —
    // most often because a proxy rewrote it. The canonical origin is right far
    // more often than the header is.
    return allowed[0];
  }

  // Nothing configured at all. Local development, or a deployment missing
  // NEXT_PUBLIC_APP_URL — which is worth saying out loud, because the symptom
  // is a redirect to an unreachable address rather than an error.
  const host = candidates[0] ?? "localhost:9002";
  if (process.env.NODE_ENV === "production") {
    console.warn(
      `[auth] NEXT_PUBLIC_APP_URL is not set; deriving the redirect origin from ` +
        `the request host (${host}). Behind a proxy this is frequently the ` +
        `container's own address, and sign-in will return users to somewhere ` +
        `they cannot reach.`,
    );
  }
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${protocol}://${host}`;
}
