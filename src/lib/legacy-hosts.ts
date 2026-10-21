/**
 * Send visitors who arrive on a retired hostname to the canonical site.
 *
 * `LEGACY_HOSTS` lists hostnames (comma separated, port included when one is
 * served) that this deployment used to answer on. A request whose host is on
 * the list is redirected to the same path and query on `NEXT_PUBLIC_APP_URL`,
 * permanently (308, so the method survives too).
 *
 * The host is read the way app-origin.ts reads it: `X-Forwarded-Host` first,
 * because the reverse proxy may rewrite `Host`, then `Host`. Only hosts on the
 * list are ever redirected, and never to anywhere but the configured canonical
 * origin, so a forged header cannot turn this into an open redirect. A list
 * entry that names the canonical host itself is ignored, so a misconfiguration
 * cannot loop.
 *
 * Runtime, not a build arg: switch it on with a restart once the new domain
 * answers, and off again the same way.
 *
 * Pure, so it can be unit-tested without Next: the proxy passes the request's
 * pieces in and turns a returned URL into a redirect.
 */

export interface LegacyHostInput {
  /** The request's X-Forwarded-Host header, if any. */
  forwardedHost: string | null | undefined;
  /** The request's Host header, if any. */
  host: string | null | undefined;
  /** The request path, starting with "/". */
  pathname: string;
  /** The query string, starting with "?" when present, else "". */
  search: string;
}

export interface LegacyHostEnv {
  /** LEGACY_HOSTS: comma-separated hostnames, or full URLs whose host is taken. */
  legacyHosts?: string;
  /** NEXT_PUBLIC_APP_URL: the canonical origin visitors are sent to. */
  appUrl?: string;
}

/** Lower-cased host (with port when given), or "" when it cannot be read. */
function normalizeHost(value: string | null | undefined): string {
  if (!value) return "";
  const first = value.split(",")[0].trim();
  if (!first) return "";
  // Accept a full URL as well as a bare host.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(first)) {
    try {
      return new URL(first).host.toLowerCase();
    } catch {
      return "";
    }
  }
  // A bare host may carry a path by mistake; keep what is before it.
  return first.split("/")[0].replace(/\.$/, "").toLowerCase();
}

/** The retired hostnames, parsed once per call: cheap, and the env can change between restarts only. */
export function legacyHosts(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const host = normalizeHost(entry);
    if (host) out.add(host);
  }
  return out;
}

/**
 * The URL a request on a retired host should be sent to, or null when the
 * request should be served as usual.
 */
export function legacyHostRedirect(input: LegacyHostInput, env: LegacyHostEnv): string | null {
  const hosts = legacyHosts(env.legacyHosts);
  if (hosts.size === 0) return null;

  let canonical: URL;
  try {
    canonical = new URL((env.appUrl ?? "").trim());
  } catch {
    return null; // nowhere to send anyone
  }
  if (canonical.protocol !== "http:" && canonical.protocol !== "https:") return null;

  const arrivedOn = normalizeHost(input.forwardedHost) || normalizeHost(input.host);
  if (!arrivedOn || !hosts.has(arrivedOn)) return null;
  if (arrivedOn === canonical.host.toLowerCase()) return null; // never loop

  const pathname = input.pathname.startsWith("/") ? input.pathname : `/${input.pathname}`;
  const search = input.search && !input.search.startsWith("?") ? `?${input.search}` : input.search ?? "";
  return `${canonical.origin}${pathname}${search}`;
}
