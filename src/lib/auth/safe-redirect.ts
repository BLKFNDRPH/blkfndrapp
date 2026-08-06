/**
 * Resolve a post-login redirect target against our own origin.
 *
 * `startsWith('/')` is not sufficient on its own: "//evil.example" and
 * "/\evil.example" both pass it, and `new URL()` resolves them to
 * https://evil.example — a protocol-relative URL, not a local path.
 */
export function safeInternalPath(candidate: string | null | undefined, fallback = "/profile"): string {
  if (!candidate) return fallback;

  const path = candidate.trim();

  // Must be a rooted path, and must not be protocol-relative.
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//") || path.startsWith("/\\")) return fallback;

  // Reject control characters and anything resembling a scheme.
  if (/[\x00-\x1f\x7f]/.test(path)) return fallback;
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(path)) return fallback;

  return path;
}
