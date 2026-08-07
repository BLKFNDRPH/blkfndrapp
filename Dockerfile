# Multi-stage build for Next.js 16 with React 19
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies based on package manager
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public config. These are inlined into the client JS bundle by
# `next build` and are visible to every browser — never pass a secret here.
# Each var must be listed as an ARG or it silently inlines as "" (consumers use
# `process.env.X || ""`, so a missing value fails at runtime, not at build).
ARG NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID
ARG NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID
ARG NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID
ARG NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID
ARG NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID
ARG NEXT_PUBLIC_STELLAR_USDT_TOKEN_ID
ARG NEXT_PUBLIC_STELLAR_WBTC_TOKEN_ID
ARG NEXT_PUBLIC_STELLAR_WETH_TOKEN_ID
ARG NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS
ARG NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID

ENV NEXT_PUBLIC_BLKFNDR_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_CONTRACT_ID
ENV NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID
ENV NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID
ENV NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID
ENV NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID=$NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID
ENV NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID=$NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID
ENV NEXT_PUBLIC_STELLAR_USDT_TOKEN_ID=$NEXT_PUBLIC_STELLAR_USDT_TOKEN_ID
ENV NEXT_PUBLIC_STELLAR_WBTC_TOKEN_ID=$NEXT_PUBLIC_STELLAR_WBTC_TOKEN_ID
ENV NEXT_PUBLIC_STELLAR_WETH_TOKEN_ID=$NEXT_PUBLIC_STELLAR_WETH_TOKEN_ID
ENV NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS=$NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS
ENV NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS=$NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID

# Set environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the Next.js application
# Note: Uses webpack for production builds (as per package.json)
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Copy Next.js build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

# Expose port (default: 3000, can be overridden)
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the Next.js application
CMD ["node", "server.js"]
