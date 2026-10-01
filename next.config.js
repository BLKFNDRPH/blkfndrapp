/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",
  serverExternalPackages: ["genkit", "@genkit-ai/ai", "@genkit-ai/googleai", "@genkit-ai/core"],

  // Baseline security headers on every response. A conservative, non-breaking
  // set: clickjacking (frame-ancestors + X-Frame-Options), MIME sniffing,
  // referrer and permissions hardening, and HSTS for the HTTPS origin. A full
  // content Content-Security-Policy (script/style/connect sources) is a
  // deliberate follow-up — it must be tested against Next.js, Supabase, Pinata
  // and the wallet flows — so only frame-ancestors is set here, which does not
  // affect resource loading.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },

  // This is the only next.config in the tree. Two others existed alongside it
  // (next.config.ts and src/next.config.ts) with conflicting settings that
  // silently never applied, because Next resolves next.config.js first.

  // No webpack override: the former resolve.fallback stubbed fs/net/tls/dns
  // for grpc-node (pulled in by genkit), but genkit only ever loads behind a
  // 'use server' boundary and is listed in serverExternalPackages, so it never
  // reaches a browser bundle. Verified by building with --webpack after
  // removing it: webpack hard-errors on unresolved Node builtins in browser
  // bundles, and the build compiles clean. Keeping it forced every Turbopack
  // invocation to error out on the webpack/Turbopack config mismatch.

  // No images block: nothing renders next/image (listing images are plain
  // <img> through ImageWithFallback), so a remotePatterns allowlist would only
  // let anyone use this server's /_next/image optimizer to fetch and resize
  // images from those hosts.
};

module.exports = nextConfig;
