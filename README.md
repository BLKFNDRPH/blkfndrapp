# blkfndr

> A decentralized crowdfunding platform built on Stellar and Soroban.

This repository is the technical source of truth for blkfndr documentation. The same content is structured for GitBook publishing via Git Sync.

## Overview

blkfndr enables creators to launch fundraising campaigns on the Stellar blockchain. Projects are submitted by creators, reviewed by admins through a multi-sig governance system, and funded by investors using Stellar assets (XLM, USDC, USDT, WBTC, WETH). All campaign logic is managed by Soroban smart contracts, ensuring transparency and trustless execution.

## Tech Stack

| Layer | Technology |
|---|---|
| **Blockchain** | Stellar (Soroban smart contracts) |
| **Frontend** | Next.js 16, React 19, TailwindCSS, shadcn/ui |
| **AI** | Google Genkit + Gemini 2.5 Flash |
| **Storage** | Pinata IPFS |
| **Database** | MongoDB (user profiles, notifications) |
| **Auth** | Stellar Freighter wallet |
| **Deployment** | Docker, Portainer |

## Features

- **Project Listing Creation** — Creators submit campaigns with title, description, category, funding goal, and images stored on IPFS via Pinata.
- **Admin Approval Workflow** — Multi-sig admin panel for reviewing, approving, or rejecting submissions.
- **Multi-Currency Funding** — Investors can fund projects using XLM, USDC, USDT, WBTC, or WETH.
- **AI-Powered Listing Quality Analysis** — Genkit flow using Gemini 2.5 Flash to score listings, suggest improvements, and flag issues before admin review.
- **AI Query Analysis (Documentation-Ready)** — Search-intent and listing-query analysis flow documented for implementation and rollout.
- **AI Sentiment Tracking (Documentation-Ready)** — Comment/update sentiment scoring documented with payload contracts and dashboard usage.
- **Investment Receipts (SBTs)** — Soulbound tokens minted on-chain as proof of investment; non-transferable, burnable by the investor.
- **Multi-Sig Governance** — Platform admin actions (fee changes, withdrawals) require multi-sig approval from configured admins.
- **Configurable Platform Fee** — Default 3% fee on investments, adjustable by admins via on-chain governance.
- **Funding Deadlines** — Projects with expired deadlines automatically prevent new investments and allow investor refunds.

## Prerequisites

- **Node.js** 20+
- **npm** 10+
- **Stellar Freighter** browser extension ([freighter.app](https://freighter.app))
- **Docker** (for containerized deployment)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/tmdc-it-solutions/blkfndr.git
cd blkfndr

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your configuration (see Environment Variables below)

# 4. Start the development server
npm run dev
```

The app runs on **http://localhost:9002**.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | Yes | `testnet` or `mainnet` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Yes | Soroban RPC endpoint (e.g., `https://soroban-testnet.stellar.org`) |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Yes | Deployed crowdfunding Soroban contract ID |
| `NEXT_PUBLIC_PLATFORM_ADDRESS` | Yes | Platform admin account public key |
| `NEXT_PUBLIC_PINATA_JWT` | Yes | Pinata API JWT for IPFS uploads |
| `NEXT_PUBLIC_PINATA_GATEWAY_URL` | Yes | Pinata IPFS gateway URL |
| `NEXT_PUBLIC_PINATA_API_KEY` | Yes | Pinata API key |
| `NEXT_PUBLIC_PINATA_API_SECRET` | Yes | Pinata API secret |
| `NEXT_PUBLIC_APP_URL` | Yes | Application URL (e.g., `http://localhost:9002`) |
| `GOOGLE_GENERATIVEAI_API_KEY` | Yes | Gemini API key for AI features |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `NEXTAUTH_SECRET` | Yes | NextAuth secret key |
| `NEXTAUTH_URL` | Yes | NextAuth callback URL |

See [Deployment](docs/deployment.md) for container and production configuration details.

## API Usage

### REST Endpoints

```bash
# Health check
curl -s http://localhost:9002/api/health

# User lookup by address
curl -s http://localhost:9002/api/user-by-address?address=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Server Action Example

```typescript
import { createNotification } from '@/actions/notifications';

await createNotification({
	userId: 'user_123',
	type: 'system',
	title: 'Deployment Complete',
	message: 'Documentation and runtime are in sync.',
});
```

## Project Structure

```
blkfndr/
├── src/
│   ├── ai/                  # Genkit AI flows & configuration
│   │   ├── genkit.ts        # Genkit initialization (Gemini plugin)
│   │   └── flows/           # AI flow definitions
│   ├── app/                 # Next.js App Router pages & API routes
│   │   ├── admin/           # Admin dashboard & approval UI
│   │   ├── api/             # REST API endpoints
│   │   ├── create-listing/  # Project creation form
│   │   ├── login/           # Authentication page
│   │   ├── profile/         # User profile & investments
│   │   ├── projects/        # Project detail & funding pages
│   │   └── settings/        # User & platform settings
│   ├── components/          # React components (shadcn/ui based)
│   ├── context/             # React context providers
│   ├── hooks/               # Custom React hooks
│   └── lib/                 # Utilities, contracts, DB, GraphQL
├── blkfndr/                 # Soroban smart contracts (Rust)
│   └── sources/
├── bridge/                  # Token bridge contracts (USDC, USDT, WBTC, WETH)
│   └── sources/
├── docs/                    # Documentation
├── public/                  # Static assets
├── docker-compose.yml       # Docker Compose configuration
├── Dockerfile               # Multi-stage Docker build
└── package.json
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server on port 9002 with Turbopack |
| `npm run build` | Production build with Webpack |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run genkit:dev` | Start Genkit developer UI |

## Documentation

- [Architecture](docs/architecture.md) — System design and data flow
- [Smart Contracts](docs/smart-contracts.md) — Soroban contract API reference
- [AI Features](docs/ai-features.md) — Genkit flows and AI integration
- [API Reference](docs/api-reference.md) — Horizon API, Soroban RPC, and server actions
- [Authentication](docs/authentication.md) — Freighter wallet setup and auth flow
- [Deployment](docs/deployment.md) — Docker, Portainer, and production setup
- [Migration: Tusky → Pinata](docs/migration-tusky-pinata.md) — File storage migration guide
- [GitBook Sync](docs/gitbook-sync.md) — Bi-directional GitHub/GitBook synchronization setup
- [Content Migration](docs/content-migration.md) — Feature-level migration and documentation coverage checklist
- [Blueprint](docs/blueprint.md) — Product and technical blueprint
- [Contributing](docs/contributing.md) — Development setup and contribution guidelines

## GitHub to GitBook Single Source of Truth

1. All technical docs live in this repository under [docs](docs/).
2. GitBook sidebar is controlled by [docs/SUMMARY.md](docs/SUMMARY.md).
3. Git Sync must target the `main` branch and keep markdown in sync both ways.
4. Any doc change in pull requests should include updates to [docs/content-migration.md](docs/content-migration.md) when feature coverage changes.

## License

MIT