# blkfndr

> A secure, on-chain vault for real-world projects — built on Stellar and Soroban.

**Live on testnet: [testnetv2.blkfndr.com](https://testnetv2.blkfndr.com/)**

Running against the Stellar test network. Balances are testnet assets with no
value, and the data is not a rehearsal for mainnet so much as a live one — treat
anything there as disposable.

This repository is the technical source of truth for blkfndr documentation. The same content is structured for GitBook publishing via Git Sync.

## Overview

blkfndr gives every real-world project its own vault on Stellar. The funds it holds, the milestones it tracks, and every release it makes are recorded on-chain and governed by the project's own stakeholders — not by the platform. A project's whole history is public and permanent, so anyone can verify what happened instead of trusting the people running it to report it honestly.

Under the hood the vault is bonded and stakeholder-governed. The builder's performance bond is locked in the same contract that holds the stakes; milestone tranches are released only when the stakeholders vote to release them, weighted by the stake each holds; a failed milestone forfeits the bond automatically; and closing a project writes a permanent completion record. There is no appointed signer, no admin key, and no platform role anywhere in the path that moves money.

## Status

**Current phase: Testnet, mid-rebuild.**

Release authority is contribution-weighted rather than held by appointed signers, the contracts are **deployed to testnet**, and the app runs against them at [testnetv2.blkfndr.com](https://testnetv2.blkfndr.com/). MongoDB is gone: every table is Postgres with Row Level Security.

| Area | State |
|---|---|
| Bonded vault with contributor-weighted release | ✅ Deployed to testnet, 38 tests passing |
| Builder attestation registry | ✅ Deployed to testnet |
| Platform treasury + owner-voted governance (fee, bond, ops funding) | ✅ Deployed to testnet, 45 tests passing |
| Operations Vault (governed gas budget) + managed KYC-attestor keys | ✅ Deployed to testnet, 26 tests passing |
| Four admin groups, user bans, platform health, KYC review | ✅ Live |
| Supabase schema, RLS, and auth | ✅ Applied, verified, and the app runs on it |
| MongoDB | ✅ Fully removed |
| TypeScript contract bindings | ✅ Regenerated from the deployed wasm |
| Mainnet | 🔜 Planned, not deployed |
| AI listing quality analysis | ✅ Live (Genkit + Gemini 2.5 Flash) |
| AI query analysis & sentiment tracking | 📝 Documented, not implemented |

See [the rebuild PR](https://github.com/BLKFNDRPH/blkfndrapp/pull/1) for what changed and why.

## How a project's vault works

1. **A project gets its own vault.** The builder's performance bond and a flat platform fee are taken in the same transaction that creates the vault — there is no path to a vault without a bond behind it.
2. **Stakeholders take a position,** from $5 USDC upward. The stake held is the voting weight it carries, and it stays the stakeholder's to reclaim. No fee is deducted from a stake.
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
| `blkfndr-identity` | KYC attestation registry. Named attestors write approvals; the platform holds their signing keys so reviewers never touch a wallet |
| `blkfndr-admin` | Platform administrator roster. **Not in the path that releases funds** |
| `blkfndr-treasury` | Platform fee treasury and governance: fees pool here, owners vote (two-thirds by headcount) to release to shareholders and to set the fee, bond and a monthly cut to the Operations Vault |
| `blkfndr-operations` | Operations Vault: the gas budget for moderation, released by owner vote to fund the managed KYC-attestor wallets. Holds no project funds |

### Deployed Contracts (Testnet)

The rebuilt set, deployed with `scripts/deploy-contracts.sh` and wiring verified by reading it back off the ledger.

| Contract | Address |
|---|---|
| Factory | [`CDIXGE5M...F7BGKR7D5`](https://stellar.expert/explorer/testnet/contract/CDIXGE5MWFAYXA7FKLB4CDRSSQZ6VQSGHT6O6OY3TFTWVF6F7BGKR7D5) |
| Attestation registry | [`CDLL2A4R...JSNB2SO7`](https://stellar.expert/explorer/testnet/contract/CDLL2A4RBSQPKSPTEE3O4HNSDICSJEGCHAWIGUYVRPGOKVEPJSNB2SO7) |
| Identity registry | [`CCDBWBFE...RWZT27TGW`](https://stellar.expert/explorer/testnet/contract/CCDBWBFEK3YVXD2CDTJ4NFDPO7DB3OLB4YVX7BZI22M7QM4RWZT27TGW) |
| Admin roster | [`CAHAOAX5...AU6WAGOG`](https://stellar.expert/explorer/testnet/contract/CAHAOAX52JAQ75C3INJIDVKT7EITWDVPYP2K27NJTD4CPYZUAU6WAGOG) |
| Treasury (fee destination + governance) | [`CCNID3UW...H3XGIGZS`](https://stellar.expert/explorer/testnet/contract/CCNID3UWTBEV67U7COG7LEWGTT63KYBM42M5XQ2OX6TWFLE3H3XGIGZS) |
| Operations Vault (gas budget) | [`CDZXCWKY...Z3PDHJQAP`](https://stellar.expert/explorer/testnet/contract/CDZXCWKY7J4CEF7MFXMOHB377OREDLM3LESNIZIQ4LIVIR6Z3PDHJQAP) |

The treasury is the factory's fee wallet, so the app reads its address from the factory rather than from configuration. It was redeployed to add the operations-funding transfer; the previous treasury (`CC5SKZMP…`, empty) is superseded.

The **vault is not deployed as a contract**. Its wasm is uploaded and the factory instantiates one instance per project from that hash:

```
blkfndr_vault.wasm  sha256:70e5f3a81a3d66155b46780f0c7bc1bd7574721d5477865f7a2cd471d9746b53
```

A reviewer checks any project's vault against that hash. `scripts/build-contracts.sh` reproduces it from source.

Platform parameters as deployed: flat fee 10 units, minimum contribution 5 units, voting window 7 days, minimum bond 5% of goal.

#### Previous generation

Still on-chain and still running the live site until the UI migrates. **Superseded — do not build against these.** The crowdfunding contract in particular carries a refund defect that can pay an early investor money already released to the creator.

| Contract | Address |
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
| `NEXT_PUBLIC_APP_URL` | Yes | Application origin. `http://localhost:9002` locally, `https://testnetv2.blkfndr.com` on testnet. Must match the Supabase Site URL |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID` | Yes | Factory contract ID |
| `NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID` | Yes | Identity registry contract ID |
| `NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID` | Yes | Admin roster contract ID |
| `NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID` | Yes | Attestation registry contract ID |
| `NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID` | Recommended | Operations Vault contract ID. Its governance panel reads "Not configured" without it |
| `NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID` | Yes | XLM token contract ID (also `_USDC_`, `_USDT_`, `_WBTC_`, `_WETH_`) |
| `NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS` | Yes | Platform admin public key |
| `NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS` | Yes | Fallback account public key |
| `PINATA_JWT` | Yes | Pinata API JWT for IPFS uploads. Server-only |
| `PINATA_GATEWAY_URL` | Recommended | Dedicated Pinata gateway hostname. The shared public one rate-limits |
| `GEMINI_API_KEY` | Optional | Gemini API key for the AI listing review. Server-only. Without it that feature is simply off |
| `INDEXER_SECRET` | Yes | Bearer token for `POST /api/indexer` and `POST /api/ops-funding`. Generate with `openssl rand -hex 32` |
| `OPS_FUNDING_SUBMITTER_SECRET` | Optional | Funded account that pays the fee for the monthly operations-funding transfer. Server-only. Unset means the transfer cleanly skips |

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
│   ├── blkfndr-admin/          # Platform admin roster
│   ├── blkfndr-treasury/       # Fee treasury and owner-voted governance
│   └── blkfndr-operations/     # Operations Vault: governed gas budget
├── supabase/
│   └── migrations/             # Tracked SQL, schema plus RLS
├── scripts/
│   ├── build-contracts.sh      # Builds wasm, prints build hashes
│   └── deploy-contracts.sh     # Deploys and wires the contract set
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
| `bash scripts/deploy-contracts.sh --source <key>` | Deploy and wire the contract set, verifying the result |
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

> The core docs — [whitepaper.md](docs/whitepaper.md), [architecture.md](docs/architecture.md), [smart-contracts.md](docs/smart-contracts.md) and [api-reference.md](docs/api-reference.md) — were rewritten for the current vault / factory / attestation / identity / admin / treasury / operations suite, the two-thirds governance model, and the gas-funding transfer. [authentication.md](docs/authentication.md), [ai-features.md](docs/ai-features.md) and [deployment.md](docs/deployment.md) round out the set.

## GitHub to GitBook Single Source of Truth

1. All technical docs live under [docs](docs/).
2. The GitBook sidebar is controlled by [docs/SUMMARY.md](docs/SUMMARY.md).
3. Git Sync targets `main` and keeps markdown in sync both ways.
4. Doc changes in pull requests should update [docs/content-migration.md](docs/content-migration.md) when feature coverage changes.

## License

MIT
