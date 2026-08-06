# blkfndr

> A bonded crowdfunding platform built on Stellar and Soroban.

This repository is the technical source of truth for blkfndr documentation. The same content is structured for GitBook publishing via Git Sync.

## Overview

blkfndr lets creators raise funds on Stellar with the builder economically accountable on-chain. Contributions pool into a per-project vault, the builder's performance bond is locked in the same contract, and milestone tranches are released only when contributors themselves vote to release them — weighted by what they contributed. A milestone that fails forfeits the bond to contributors automatically, and every project leaves a permanent completion record on-chain.

There is no appointed signer, no admin key, and no platform role anywhere in the path that moves money.

## Status

**Current phase: Testnet, mid-rebuild.**

The contracts have been rebuilt so that release authority is contribution-weighted rather than held by appointed signers. That work is complete and tested but **not yet deployed** — the contract IDs below are the previous generation, which the live site still runs.

| Area | State |
|---|---|
| Bonded vault with contributor-weighted release | ✅ Built, 94 tests passing — **not deployed** |
| Builder attestation registry | ✅ Built and tested — **not deployed** |
| Supabase schema, RLS, and auth | ✅ Applied and verified — app not yet cut over |
| MongoDB removal | 🔜 Schema exists for all nine collections; call sites not yet repointed |
| TypeScript contract bindings | ⚠️ Stale against the rebuilt contracts |
| Mainnet | 🔜 Planned, not deployed |
| AI listing quality analysis | ✅ Live (Genkit + Gemini 2.5 Flash) |
| AI query analysis & sentiment tracking | 📝 Documented, not implemented |

See [the rebuild PR](https://github.com/BLKFNDRPH/blkfndrapp/pull/1) for what changed and why.

## How funding works

1. **A builder creates a project.** The performance bond and a flat platform fee are taken in the same transaction that creates the vault — there is no path to a vault without a bond behind it.
2. **Contributors back it,** from $5 USDC upward. The amount contributed is also the voting weight it carries. No fee is deducted from a contribution.
3. **The goal closes the raise.** Reaching it moves the vault to `Funded`; missing it by the deadline returns every contribution in full and the bond to the builder.
4. **The builder opens a milestone vote,** which runs for a fixed window set at project creation.
5. **Contributors vote.** A release needs more than 50% of the total raise behind it, and no single wallet counts for more than 20% however much it put in — so a release always takes at least three distinct wallets.
6. **Release is permissionless.** Once the vote carries, anyone can execute it; nobody can withhold it.
7. **A lapsed window fails the milestone.** Contributor silence returns money — it never releases it. Remaining funds and the forfeited bond become claimable pro-rata.
8. **Close writes a permanent record** to the attestation registry: builder, project, outcome, raise, bond, milestones approved, timestamp.

### The 20% cap, concretely

Three backers at 100 USDC each on a 300 USDC goal. The cap is 20% of the raise, so each counts for 60 regardless. A release needs more than 150:

| Approvers | Weight | Outcome |
|---|---|---|
| one | 60 | short |
| two | 120 | short |
| three | 180 | releases |

A backer holding two thirds of the raise still counts for 60 and still cannot release alone. This is covered by `a_majority_contributor_cannot_release_alone` and `release_requires_at_least_three_distinct_wallets`.

## Tech Stack

| Layer | Technology |
|---|---|
| **Blockchain** | Stellar (Soroban smart contracts, Rust) |
| **Frontend** | Next.js 16, React 19, TailwindCSS, shadcn/ui |
| **Database** | Supabase (Postgres with Row Level Security) |
| **Auth** | Supabase Auth — email/password and Google; Freighter for wallet linking |
| **Storage** | Supabase Storage (identity documents), Pinata IPFS (listing media) |
| **AI** | Google Genkit + Gemini 2.5 Flash |
| **Deployment** | Docker, Portainer |

MongoDB is still present in the codebase and is being removed collection by collection as each call site moves to Supabase.

## Smart Contracts

| Contract | Responsibility |
|---|---|
| `blkfndr-vault` | Per-project vault: contributions, bond, contributor-weighted milestone voting, refunds, forfeiture |
| `blkfndr-factory` | Deploys vaults and pins the platform addresses each one trusts |
| `blkfndr-attestation` | Append-only builder completion record. No update or delete entrypoint exists |
| `blkfndr-identity` | KYC attestation registry |
| `blkfndr-approval` | Platform administrator roster. **Not in the path that releases funds** |
| `blkfndr-soroban` | Legacy monolithic crowdfunding contract, superseded by the vault. Scheduled for removal once the UI migrates |

### Deployed Contracts (Testnet)

These are the **previous generation**, still running the live site. The rebuilt contracts above are not among them.

| Contract | Explorer |
|---|---|
| blkfndr (legacy crowdfunding) | [`CAWH7WBX...WVZ45FSS`](https://stellar.expert/explorer/testnet/contract/CAWH7WBXWROIDJ5ZGYVRZGUAY2B7537Z6QNTIZRZ2CZKHCNEWVZ45FSS) |
| Factory | [`CDWTUCD5...XBATIH3I`](https://stellar.expert/explorer/testnet/contract/CDWTUCD5AUO3LR5GSWXGULGWWMHE5IW6TGTKEPYN34OWFD5GXBATIH3I) |
| Identity | [`CDAJP56Q...LAJ6LR2IQ`](https://stellar.expert/explorer/testnet/contract/CDAJP56QRHPLDXHUYZ54XJCPHA7Y2EPN3XBZA7JZQBIYFBPLAJ6LR2IQ) |
| Approval | [`CAK6ZR2U...HY3FHCU5`](https://stellar.expert/explorer/testnet/contract/CAK6ZR2U5Y2J2J22NU73V5LMDSGWYXGZITK5TDFTH7ZFIQCYHY3FHCU5) |

## Fees

blkfndr charges a **flat fee per project**, paid by the builder when the vault is created. It is never a percentage of funds raised, and contributor deposits are never touched by it — a contributor's whole deposit is theirs to reclaim and to vote with.

## Prerequisites

- **Node.js** 20+ and **npm** 10+
- **Rust** 1.81.0 with the `wasm32-unknown-unknown` target (see [rust-toolchain.toml](rust-toolchain.toml))
- **Stellar Freighter** browser extension ([freighter.app](https://freighter.app))
- A **Supabase** project
- **Docker** for containerized deployment

## Quick Start

```bash
git clone https://github.com/BLKFNDRPH/blkfndrapp.git
cd blkfndrapp
npm install
cp .env.example .env.local   # then fill it in — see Environment Variables
npm run dev
```

The app runs on **http://localhost:9002**.

To build the contracts and print the wasm hashes a reviewer checks a deployment against:

```bash
bash scripts/build-contracts.sh
```

Then run the contract test suite:

```bash
cargo test --workspace
```

`scripts/build-contracts.sh` must run first — the factory's deployment tests need the vault compiled to wasm and skip themselves when it is absent.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Publishable key. Public — RLS is what protects the data |
| `SUPABASE_SECRET_KEY` | Yes | Service-role key. Bypasses RLS. **Server-only — never prefix `NEXT_PUBLIC_`** |
| `SESSION_SECRET` | Yes | Session signing secret. Generate with `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | Yes | Application origin, e.g. `http://localhost:9002` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `NEXT_PUBLIC_BLKFNDR_CONTRACT_ID` | Yes | Core crowdfunding contract ID |
| `NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID` | Yes | Factory contract ID |
| `NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID` | Yes | Identity registry contract ID |
| `NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID` | Yes | Admin roster contract ID |
| `NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID` | No | Attestation registry. Set once deployed |
| `NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID` | Yes | XLM token contract ID (also `_USDC_`, `_USDT_`, `_WBTC_`, `_WETH_`) |
| `NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS` | Yes | Platform admin public key |
| `NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS` | Yes | Fallback account public key |
| `PINATA_JWT` | Yes | Pinata API JWT for IPFS uploads. Server-only |
| `PINATA_GATEWAY_URL` | Recommended | Dedicated Pinata gateway hostname. The shared public one rate-limits |
| `GOOGLE_GENERATIVEAI_API_KEY` | Yes | Gemini API key for AI features |
| `INDEXER_SECRET` | Yes | Bearer token for `POST /api/indexer`. Generate with `openssl rand -hex 32` |
| `MONGODB_URI` | Transitional | Still required until the last collection moves to Supabase |

Anything prefixed `NEXT_PUBLIC_` is inlined into the client bundle at build time and visible to every visitor. Never put a secret behind that prefix. See [.env.example](.env.example) for how each variable reaches the container.

### Supabase setup

Migrations live in [supabase/migrations/](supabase/migrations/) and apply with:

```bash
supabase link --project-ref <your-project-ref> && supabase db push
```

Then, in the dashboard:

- **Authentication → Providers → Google** — enable it, and add the callback URL it shows to your Google OAuth client's authorized redirect URIs.
- **Authentication → URL Configuration** — set the Site URL, or confirmation links point at the wrong host.

## Security model

Authorization is enforced by the database, not only by application code. Every table has Row Level Security, and the identity columns on `kyc_requests` are not granted to any browser-facing role at all — `select *` on your own row fails with a publishable key. Those columns are reachable only with the service-role key, from `server-only` modules, after an explicit admin check.

Identity documents are not stored in the database. They live in a private Storage bucket reached through short-lived signed URLs minted server-side.

Roles are read from `app_metadata`, never `user_metadata`, which a user can edit. On-chain state remains the source of truth for who is an admin.

Every exported async function in a `"use server"` file is a public HTTP endpoint. Each one re-authenticates, authorizes, and validates its arguments — the argument list is treated as hostile.

## Project Structure

```
blkfndrapp/
├── contracts/                  # Soroban smart contracts (Rust)
│   ├── blkfndr-vault/          # Per-project bonded vault
│   ├── blkfndr-factory/        # Vault deployment and registry
│   ├── blkfndr-attestation/    # Append-only builder record
│   ├── blkfndr-identity/       # KYC attestation registry
│   ├── blkfndr-approval/       # Platform admin roster
│   └── blkfndr-soroban/        # Legacy contract, being retired
├── supabase/
│   └── migrations/             # Tracked SQL, schema plus RLS
├── scripts/
│   └── build-contracts.sh      # Builds wasm, prints build hashes
├── src/
│   ├── ai/                     # Genkit flows and configuration
│   ├── app/                    # Next.js App Router pages and API routes
│   │   ├── auth/               # Supabase auth actions and callbacks
│   │   └── api/                # REST endpoints
│   ├── components/             # React components (shadcn/ui)
│   ├── context/                # React context providers
│   ├── hooks/                  # Custom hooks
│   ├── lib/
│   │   ├── auth/               # Authorization guards
│   │   ├── data/               # Server-only data-access layer
│   │   ├── supabase/           # Client setup and generated types
│   │   └── models/             # Mongoose models, being removed
│   ├── packages/               # Generated contract bindings
│   └── proxy.ts                # Session refresh (not a security boundary)
├── docs/
├── .github/workflows/ci.yml
├── docker-compose.yml
└── Dockerfile
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server on port 9002 with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run genkit:dev` | Genkit developer UI |
| `bash scripts/build-contracts.sh` | Compile contracts to wasm, print sha256 hashes |
| `cargo test --workspace` | Contract test suite |
| `cargo clippy --workspace --all-targets -- -D warnings` | Contract lints |

## Documentation

- [Architecture](docs/architecture.md) — System design and data flow
- [Smart Contracts](docs/smart-contracts.md) — Soroban contract API reference
- [AI Features](docs/ai-features.md) — Genkit flows and AI integration
- [API Reference](docs/api-reference.md) — Horizon, Soroban RPC, and server actions
- [Authentication](docs/authentication.md) — Auth and wallet linking
- [Deployment](docs/deployment.md) — Docker, Portainer, and production setup
- [Whitepaper](docs/whitepaper.md) — Product and economic model
- [Blueprint](docs/blueprint.md) — Product and technical blueprint
- [Contributing](docs/contributing.md) — Development setup and guidelines
- [Migration: Tusky → Pinata](docs/migration-tusky-pinata.md) — File storage migration
- [GitBook Sync](docs/gitbook-sync.md) — GitHub/GitBook synchronization
- [Content Migration](docs/content-migration.md) — Feature coverage checklist

> Several documents predate the contract rebuild and describe the superseded multi-sig release model. [smart-contracts.md](docs/smart-contracts.md) and [architecture.md](docs/architecture.md) are the ones to read with that in mind.

## GitHub to GitBook Single Source of Truth

1. All technical docs live under [docs](docs/).
2. The GitBook sidebar is controlled by [docs/SUMMARY.md](docs/SUMMARY.md).
3. Git Sync targets `main` and keeps markdown in sync both ways.
4. Doc changes in pull requests should update [docs/content-migration.md](docs/content-migration.md) when feature coverage changes.

## License

MIT
