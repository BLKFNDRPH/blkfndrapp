/**
 * The Content-Security-Policy every page is served with, built per request by
 * src/proxy.ts so its nonce is new each time.
 *
 * Scripts: 'self' plus the request's nonce, with 'strict-dynamic' so the
 * chunks Next.js loads from a nonced script are trusted too. Next reads the
 * nonce back out of the request's Content-Security-Policy header and puts it
 * on its own inline scripts; the one inline script of ours (next-themes'
 * theme picker) gets it from the x-nonce header in the root layout. No inline
 * script without the nonce runs, which is what makes an injected <script> or
 * onerror= inert.
 *
 * Styles: 'unsafe-inline'. Radix (react-remove-scroll), framer-motion,
 * next-themes' transition blocker and the chart theme all insert <style>
 * elements at runtime without a nonce, and server-rendered style= attributes
 * are everywhere. Injected CSS cannot run code; the script policy is the part
 * that stops XSS.
 *
 * Images: this origin (listing pictures go through /api/images), data: and
 * blob: for upload previews, the shared Pinata gateway that getIPFSGatewayUrl
 * points at (and that stored image_url and milestone proofs hold), Google
 * account avatars, and the pravatar fallback. Those were the only hosts in the
 * live tables on 2026-10-15; a picture stored on any other host would not
 * show, so add its host here rather than widening this to https:.
 *
 * Connections: this origin, Supabase, the Stellar network's Soroban RPC and
 * Horizon (and Friendbot on Testnet), CoinGecko for the XLM price, and data:
 * for the saved listing draft's picture.
 * Freighter talks to the page through window.postMessage, which a CSP does not
 * govern.
 *
 * Self-contained (no imports) so `npm test` can load it directly.
 */

export type CspInput = {
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string;
  sorobanRpcUrl?: string;
  horizonUrl?: string;
  /** Null on Mainnet, which has no faucet. */
  friendbotUrl?: string | null;
  /** Whether the Google Maps embed is configured (frame-src). */
  mapsEmbed?: boolean;
  /** next dev needs eval for React's debugging features. */
  dev?: boolean;
};

/** The origin of a URL, or null when it is not an http(s) URL. */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

/** A random nonce: 16 bytes, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp(input: CspInput): string {
  const supabase = originOf(input.supabaseUrl);
  const connect = [
    "'self'",
    // Restoring a saved listing draft fetches its picture back from a data: URI.
    "data:",
    supabase,
    originOf(input.sorobanRpcUrl),
    originOf(input.horizonUrl),
    originOf(input.friendbotUrl),
    "https://api.coingecko.com",
  ];

  const directives: Record<string, (string | null | false | undefined)[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${input.nonce}'`,
      "'strict-dynamic'",
      input.dev && "'unsafe-eval'",
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://gateway.pinata.cloud",
      "https://*.googleusercontent.com",
      "https://i.pravatar.cc",
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": input.dev ? [...connect, "ws:"] : connect,
    "frame-src": input.mapsEmbed ? ["https://www.google.com"] : ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // Google sign-in is a server action that redirects to Supabase, which
    // redirects to Google. Hydrated, that is a fetch plus a navigation; before
    // hydration it is a native form post, and form-action is checked on each
    // redirect that follows it.
    "form-action": ["'self'", supabase, "https://accounts.google.com"],
    "frame-ancestors": ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => {
      const kept = [...new Set(values.filter((v): v is string => Boolean(v)))];
      return `${name} ${kept.join(" ")}`;
    })
    .join("; ");
}
