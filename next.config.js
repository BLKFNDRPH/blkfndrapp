/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",
  serverExternalPackages: ["genkit", "@genkit-ai/ai", "@genkit-ai/googleai", "@genkit-ai/core"],

  // This is the only next.config in the tree. Two others existed alongside it
  // (next.config.ts and src/next.config.ts) with conflicting settings that
  // silently never applied, because Next resolves next.config.js first.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      // grpc-node resolves dns at build time; see grpc/grpc-node#2126.
      dns: false,
    };
    return config;
  },

  // Image optimization for Docker
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "nft.blkfndr.xyz",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.ipfs.nftstorage.link",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "static.cdnlogo.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

module.exports = nextConfig;
