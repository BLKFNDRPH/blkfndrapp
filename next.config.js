/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",
  serverExternalPackages: ["genkit", "@genkit-ai/ai", "@genkit-ai/googleai", "@genkit-ai/core"],

  // Disable telemetry
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
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
