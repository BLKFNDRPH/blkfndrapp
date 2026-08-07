# Multi-stage build for Next.js 16 with React 19.
#
# Node 24, not 20. Node 20 reached end of life in April 2026, and
# @supabase/supabase-js warns on every boot that 20 and below are deprecated:
#
#   Node.js 20 and below are deprecated and will no longer be supported in
#   future versions of @supabase/supabase-js
#
# 24 is the current LTS and matches what the project is developed on, so the
# runtime that builds the image is the runtime the code was written against.
# Stage 1: Dependencies
FROM node:24-alpine AS deps
WORKDIR /app

# Install dependencies based on package manager
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# Stage 2: Builder
FROM node:24-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public config. These are inlined into the client JS bundle by
# `next build` and are visible to every browser — never pass a secret here.
# Each var must be listed as an ARG or it silently inlines as "" (consumers use
# `process.env.X || ""`, so a missing value fails at runtime, not at build).
# Supabase first: without these two the app cannot reach its database at all,
# and because they are inlined at build time a missing value produces a running
# container that 500s on every page rather than a build that fails.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

ARG NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID
ARG NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID
ARG NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID
ARG NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID
ARG NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID
ARG NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID
ARG NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS
ARG NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS
# Both default to TESTNET in src/lib/stellar-clients.ts. A mainnet deployment
# that leaves them unset builds cleanly and then talks to testnet.
ARG NEXT_PUBLIC_SOROBAN_RPC_URL
ARG NEXT_PUBLIC_HORIZON_URL
ARG NEXT_PUBLIC_APP_URL
# Optional. Unset means project locations render as a Maps link instead of an
# embedded map, which is a supported mode rather than a degraded one.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID
ENV NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID
ENV NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID
ENV NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID=$NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID
ENV NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID=$NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID
ENV NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID=$NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID
ENV NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS=$NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS
ENV NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS=$NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS
ENV NEXT_PUBLIC_SOROBAN_RPC_URL=$NEXT_PUBLIC_SOROBAN_RPC_URL
ENV NEXT_PUBLIC_HORIZON_URL=$NEXT_PUBLIC_HORIZON_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

# Fail the build rather than ship a container that cannot reach its database.
# These are inlined into the client bundle, so an empty value is not recoverable
# at runtime — the image is simply wrong and has to be rebuilt. Catching it here
# turns a confusing production outage into an obvious build failure.
#
# Only guard NEXT_PUBLIC_ values here. Docker echoes each RUN with its arguments
# already substituted, so whatever is named on this line appears in the build log
# in plain text. That is harmless for values which are compiled into the browser
# bundle anyway, and would be a leak for anything else.
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" \
      || (echo "ERROR: NEXT_PUBLIC_SUPABASE_URL build arg is empty." >&2 && exit 1) \
 && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
      || (echo "ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY build arg is empty." >&2 && exit 1) \
 && test -n "$NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID" \
      || (echo "ERROR: NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID build arg is empty." >&2 && exit 1)

# Set environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the Next.js application
RUN npm run build

# Stage 3: Runner
FROM node:24-alpine AS runner
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
