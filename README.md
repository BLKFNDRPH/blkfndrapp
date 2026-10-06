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

**Current phase: Testnet.**

Release authority is contribution-weighted rather than held by appointed signers, the contracts are **deployed to testnet**, and the app runs against them at [testnetv2.blkfndr.com](https://testnetv2.blkfndr.com/). Every table is Postgres with Row Level Security.

**[progress.md](progress.md)** tracks what is live, what is merged but not yet active on-chain, and the owner actions still pending. Merged is not deployed: a contract change reaches testnet only when it is redeployed.

| Area | State |
|---|---|
| Bonded vault with contributor-weighted release | ✅ Deployed to testnet, 56 tests passing. The capped-total release rule (#99) and the money majority are live for projects created since 2026-10-06. Earlier projects keep the rule they were created with. Test transactions are in the [deliverable evidence](docs/deliverables/contribution-threshold-attestation.md) |
| Builder attestation registry | ✅ Deployed to testnet, 16 tests passing |
| Platform treasury + owner-voted governance (fee, bond, ops funding) | ✅ Deployed to testnet, 45 tests passing |
| Operations Vault (governed gas budget) + managed KYC-attestor keys | ✅ Deployed to testnet, 25 tests passing |
| Four admin groups, user bans, platform health, KYC review | ✅ Live |
| Supabase schema, RLS, and auth | ✅ Applied, verified, and the app runs on it |
| MongoDB | ✅ Fully removed |
| TypeScript contract bindings | ✅ Generated from source. The factory, attestation, identity and admin bindings are ahead of their deployed contracts until the redeploy in [progress.md](progress.md) |
| Listing moderation — owner-consensus approval, platform-level hide and lock | ✅ Live |
| Per-milestone delivery proof, shown to stakeholders before they vote | ✅ Live |
| Event indexer, stalled-vault keeper, storage keep-alive (compose crons) | ✅ Live |
| Mainnet | 🔜 Planned, not deployed |
| AI listing quality analysis | ✅ Live (Genkit + Gemini 2.5 Flash) |
| AI query analysis & sentiment tracking | 📝 Documented, not implemented |

See [the rebuild PR](https://github.com/BLKFNDRPH/blkfndrapp/pull/1) for what changed and why.

## How a project's vault works

1. **A project gets its own vault.** The builder's performance bond and a flat platform fee are taken in the same transaction that creates the vault — there is no path to a vault without a bond behind it.
2. **Stakeholders take a position,** from $5 USDC upward. The stake held is the voting weight it carries, and it stays the stakeholder's to reclaim. No fee is deducted from a stake.
3. **The goal closes the raise.** Reaching it moves the vault to `Funded`; missing it by the deadline returns every contribution in full and the bond to the builder.
4. **The builder opens a milestone vote,** which runs for a fixed window set at project creation.
5. **Contributors vote.** No single wallet counts for more than 20% of the raise, however much it put in. A release needs more than half of the vault's capped total — every backer's weight after the cap — behind it, from at least three distinct wallets, or from every backer when there are fewer than three. The approving wallets must also have put in more than half the raise between them.
6. **Release is permissionless.** Once the vote carries, anyone can execute it; nobody can withhold it.
7. **A lapsed window fails the milestone.** Contributor silence returns money — it never releases it. Remaining funds and the forfeited bond become claimable pro-rata.
8. **Close writes a permanent record** to the attestation registry: builder, project, outcome, raise, bond, milestones approved, timestamp.

### The 20% cap, concretely

Three backers at 100 USDC each on a 300 USDC goal. The cap is 20% of the raise, so each counts for 60 regardless. Together they count for 180, so a release needs more than 90, from three wallets:

| Approvers | Weight | Outcome |
|---|---|---|
| one | 60 | short |
| two | 120 | short — enough weight, but only two wallets |
| three | 180 | releases |

The bar is half the capped total, not half the raise, because weight above the cap is weight nobody can cast. Measured against the raise, a sole backer would count for 20% and two backers for 40% at most: they could never release, even unanimously, and a builder who delivered would forfeit their bond.

A backer holding two thirds of the raise still counts for 60 and still cannot release alone. Put 200 against two backers of 50: the capped total is 160, so the bar is more than 80. The large backer and one other reach 110 — enough weight, but two wallets, so nothing moves until the third approves. Covered by `a_majority_contributor_cannot_release_alone` and `release_requires_at_least_three_distinct_wallets`.

With fewer than three backers, every backer must approve. A sole backer of the whole 300 counts for 60 of a capped total of 60, so their one vote releases. Covered by `a_sole_backer_releases_with_one_vote` and `two_backers_release_when_both_approve`.

Wallets cost nothing to make, so the approvers must also hold more than half the money. Without that, three wallets of 70 could clear the capped bar over a 790 backer on a 1,000 raise, who counts for only 200. A wallet holding more than half the raise can block a release but never make one alone. Covered by `small_wallets_cannot_outvote_most_of_the_money` and `a_majority_holder_can_block_a_release_but_never_make_one_alone`.

This rule applies to vaults the factory creates after its wasm hash was switched to `e9009410…` on 2026-10-06 ([transaction](https://stellar.expert/explorer/testnet/tx/9dd7ed938ad0ef0db7e357cc6567e70c1620abb296a7baa301932888d7a13508)). Vaults are not upgradeable, so the projects created before then keep the old bar for good: more than half of the raw raise, under which a raise with one or two backers, or one concentrated in a single wallet, cannot release.

## Tech Stack

| Layer | Technology |
|---|---|
| **Blockchain** | Stellar (Soroban smart contracts, Rust) |
| **Frontend** | Next.js 16, React 19, TailwindCSS, shadcn/ui |
| **Database** | Supabase (Postgres with Row Level Security) |
| **Auth** | Supabase Auth — email/password and Google; Freighter for wallet linking |
| **Storage** | Supabase Storage (identity documents), Pinata IPFS (listing metadata, media, milestone proof photos) |
| **AI** | Google Genkit + Gemini 2.5 Flash |
| **Deployment** | Docker Compose on Portainer: the app plus four cron services (indexer, ops funding, stalled-vault keeper, storage keep-alive) |

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
| Treasury (fee destination + governance) | [`CDA5XDY5...M44COAXU`](https://stellar.expert/explorer/testnet/contract/CDA5XDY564RV2OSZNF2S6CXQYCABFASBOHUCXJEGII6M232VM44COAXU) |
| Operations Vault (gas budget) | [`CCVXM3YP...NQG7FDSN`](https://stellar.expert/explorer/testnet/contract/CCVXM3YPPEMWG4INHFTZ4NBJ3PQW3ZUNYIZMBJBNYQOMSNOENQG7FDSN) |

The treasury is the factory's fee wallet, so the app reads its address from the factory rather than from configuration. The treasury and Operations Vault were redeployed on 2026-09-28 with their audit fixes: each is configured by a constructor inside its own deploy transaction (H-03), and both follow checks-effects-interactions (M-05/M-06). The previous instances are superseded: treasury `CCNID3UW…` (empty) and Operations Vault `CDZXCWKY…`, which still holds 25 XLM until the owners vote it across ([progress.md](progress.md#1-finish-the-operations-vault-cutover)).

The factory, attestation, identity and admin contracts above predate the #73 and #75 source fixes (constructor-based configuration, attestation records keyed by vault, identity TTL). Those reach testnet with the coordinated redeploy tracked in [progress.md](progress.md#4-redeploy-the-factory-and-registries-73--75), which mints new addresses.

Shared contract storage on Soroban expires when nobody pays its rent, and the next caller pays to restore it. The `keep-alive-cron` service checks the factory, both registries, the admin roster, the treasury, the Operations Vault, the code they run and the code every existing vault runs, plus any older factory or registry an existing vault still depends on, on a schedule, restoring anything archived and topping up anything under 40 days to 60. The contracts top themselves up to 30 days at the caller's expense, so keeping them above that means a launch or a stake never pays the platform's rent.

The **vault is not deployed as a contract**. Its wasm is uploaded and the factory instantiates one instance per project from that hash. Since 2026-10-06 it is:

```
blkfndr_vault.wasm  sha256:e9009410b9cbb4c5bfb7cca747812dcad6a044d09c648a1e392a84fe7e182d95
```

Projects created before then run `70e5f3a8…` or the earlier `9c20bca3…`.

A reviewer checks any project's vault against that hash. The landing page's "Check it yourself" box reads the factory's current hash live from [`/api/vault-wasm-hash`](https://testnetv2.blkfndr.com/api/vault-wasm-hash) rather than quoting a constant. `scripts/build-contracts.sh` builds it from source; the wasm embeds absolute dependency paths in its panic locations, so a matching hash needs the same build paths (a pinned Docker build would remove that caveat).

Platform parameters as deployed, read from the factory on 2026-10-02:
- **Flat fee:** 300 base units (0.00003 of the project's token). This is almost certainly a leftover 3% from the earlier percentage model. `scripts/deploy-contracts.sh` defaults to 1 unit.
- **Minimum contribution:** 5 units.
- **Voting window:** 7 days.
- **Minimum bond:** 5% of the goal.

The factory's admin is still the deployer key, not the treasury, so these change by one signature until the admin is handed over ([progress.md](progress.md#4b-hand-the-factory-admin-to-the-treasury)).

The contract suite has 175 tests: vault 52, treasury 45, operations 25, factory 15, identity 15, attestation 14 and admin 9.

#### Previous generation

Still on-chain, no longer used by the app. **Superseded — do not build against these.** The crowdfunding contract in particular carries a refund defect that can pay an early investor money already released to the creator.

| Contract | Address |
|---|---|
| blkfndr (legacy crowdfunding) | [`CAWH7WBX...WVZ45FSS`](https://stellar.expert/explorer/testnet/contract/CAWH7WBXWROIDJ5ZGYVRZGUAY2B7537Z6QNTIZRZ2CZKHCNEWVZ45FSS) |
| Factory | [`CDWTUCD5...XBATIH3I`](https://stellar.expert/explorer/testnet/contract/CDWTUCD5AUO3LR5GSWXGULGWWMHE5IW6TGTKEPYN34OWFD5GXBATIH3I) |
| Identity | [`CDAJP56Q...LAJ6LR2IQ`](https://stellar.expert/explorer/testnet/contract/CDAJP56QRHPLDXHUYZ54XJCPHA7Y2EPN3XBZA7JZQBIYFBPLAJ6LR2IQ) |
| Approval | [`CAK6ZR2U...HY3FHCU5`](https://stellar.expert/explorer/testnet/contract/CAK6ZR2U5Y2J2J22NU73V5LMDSGWYXGZITK5TDFTH7ZFIQCYHY3FHCU5) |

## Fees

blkfndr charges a **flat fee per project**, paid by the builder when the vault is created. It is never a percentage of funds raised, and contributor deposits are never touched by it — a contributor's whole deposit is theirs to reclaim and to vote with.

## Prerequisites

- **Node.js** 22+ (`engines` in [package.json](package.json)) and **npm** 10+
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
| `NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID` | Yes | Factory contract ID |
| `NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID` | Yes | Identity registry contract ID |
| `NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID` | Yes | Admin roster contract ID |
| `NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID` | Yes | Attestation registry contract ID |
| `NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID` | Recommended | Operations Vault contract ID. Its governance panel reads "Not configured" without it |
| `NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID` | Yes | XLM token contract ID (also `_USDC_`) |
| `NEXT_PUBLIC_SOROBAN_RPC_URL`, `NEXT_PUBLIC_HORIZON_URL` | Optional | RPC and Horizon endpoints. Default to testnet. The network passphrase is pinned to testnet in code, so these alone do not make a mainnet build |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional | Map on a project's Location section |
| `APP_URLS` | Optional | Extra allowed origins, comma-separated, for a host answering on several domains. Read at runtime, so a change needs the container recreated (a stack update), not a rebuild. Use https only on a public host |
| `PINATA_JWT` | Yes | Pinata API JWT for IPFS uploads. Server-only. An owner can instead store it in the Supabase Vault from the console, which then takes precedence |
| `PINATA_GATEWAY_URL` | Recommended | Dedicated Pinata gateway hostname. The indexer reads metadata from it first, then from the shared `gateway.pinata.cloud`, which rate-limits |
| `PINATA_GATEWAY_KEY` | With a dedicated gateway | That gateway's Gateway Key (not the JWT), sent only to it as `x-pinata-gateway-token`. Without it the dedicated gateway answers 401 and every read falls back to the shared one. Server-only, runtime |
| `PINATA_GROUP_BLKDFNDR` | Optional | Pinata group that uploads are filed into |
| `GEMINI_API_KEY` | Optional | Gemini API key for the AI listing review, read by the Genkit plugin at runtime. Server-only. Without it the AI Suggestions button still shows, and every press fails with a toast |
| `INDEXER_SECRET` | Yes | Bearer token for the cron endpoints: `/api/indexer`, `/api/ops-funding`, `/api/settle-stalled`, `/api/keep-alive`. Generate with `openssl rand -hex 32` |
| `OPS_FUNDING_SUBMITTER_SECRET` | Recommended | Gas-only funded account that pays the fees for the ops-funding transfer, the stalled-vault keeper and the storage keep-alive. Server-only. Unset means those jobs skip cleanly |

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

Console roles come from the `platform_admins` roster — the four groups the platform is run by: owner, platform administrator, KYC manager and project administrator — asked through `my_role()` and `is_admin()` in the database and `requireCaller()` on the server, never from `user_metadata`, which a user can edit. The on-chain `blkfndr-admin` roster is separate, and neither is in the path that moves funds.

Every exported async function in a `"use server"` file is a public HTTP endpoint. Each one re-authenticates, authorizes, and validates its arguments — the argument list is treated as hostile.

Platform moderation binds the platform, not the vault. Hiding a project removes it from explore, search and the home page while its builder and stakeholders can still reach it; locking one stops this interface from building new stakes, vote openings and proof. Neither touches the contract, which stays permissionless — refunds, open votes and carried releases always go through.

Transactions are signed in the user's own Freighter wallet through one shared signer ([src/lib/freighter-signer.ts](src/lib/freighter-signer.ts)) that builds every transaction from the signing account and refuses a signature from any other. The platform holds keys only for gas and for KYC attestation — never over a stake, a vote or a vault.

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
│   ├── deploy-contracts.sh     # Deploys and wires the contract set
│   ├── migrate-kyc.mjs         # Copies approved KYC into a new identity registry
│   └── reference-scenario.sh   # Test transactions on the reference deployment
├── src/
│   ├── actions/                # Server actions: admins, moderation, restrictions, secrets…
│   ├── ai/                     # Genkit flows and configuration
│   ├── app/                    # Next.js App Router pages and API routes
│   │   ├── auth/               # Supabase auth actions and callbacks
│   │   └── api/                # REST endpoints (indexer, crons, session, uploads…)
│   ├── components/             # React components (shadcn/ui)
│   ├── context/                # Auth, Freighter wallet, project dialog, chain state
│   ├── hooks/                  # Custom hooks, incl. use-stellar-contract
│   ├── lib/
│   │   ├── auth/               # Authorization guards, app origin, safe redirects
│   │   ├── data/               # Server-only data-access layer
│   │   ├── supabase/           # Client setup and generated types
│   │   ├── event-indexer.ts    # Chain → Postgres indexer
│   │   ├── stellar-clients.ts  # Configured contract clients
│   │   ├── freighter-signer.ts # The one Freighter signer
│   │   └── ttl-keeper.ts       # Shared-storage keep-alive
│   ├── packages/               # Generated contract bindings (source, no package.json)
│   └── proxy.ts                # Session refresh (not a security boundary)
├── docs/
├── progress.md                 # Live vs pending status
├── .github/workflows/ci.yml
├── docker-compose.yml          # App + indexer, ops-funding, settle-stalled, keep-alive crons
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
| `npm run genkit:dev` | Genkit developer UI (`genkit:watch` reloads on change) |
| `bash scripts/build-contracts.sh` | Compile contracts to wasm, print sha256 hashes |
| `bash scripts/deploy-contracts.sh --source <key>` | Deploy and wire the contract set, verifying the result |
| `node --env-file=.env.local scripts/migrate-kyc.mjs --registry <C…> --source <key>` | Copy every approved KYC into a new identity registry. A dry run unless `--send` is given |
| `cargo test --workspace` | Contract test suite |
| `cargo clippy --workspace --all-targets -- -D warnings` | Contract lints |

## Documentation

- [Progress](progress.md) — What is live, merged-but-pending, and open
- [Whitepaper](docs/whitepaper.md) — Product and economic model
- [Architecture](docs/architecture.md) — System design and data flow
- [Smart Contracts](docs/smart-contracts.md) — Soroban contract API reference
- [Contract Bindings](docs/blkfndr-stellar-cntrct-setup.md) — Generated TypeScript bindings
- [API Reference](docs/api-reference.md) — HTTP routes, server actions, Horizon and Soroban RPC
- [Authentication](docs/authentication.md) — Supabase Auth, wallet linking and signing, admin roles
- [AI Features](docs/ai-features.md) — Genkit flows and AI integration
- [Deployment](docs/deployment.md) — Docker, Portainer, crons, and contract deploys
- [Contributing](docs/contributing.md) — Development setup and guidelines
- [Blueprint](docs/blueprint.md) — Product and technical blueprint
- [Web3 Accessibility Redesign](docs/design/web3-accessibility-redesign.md) — Design brief for users with no Web3 background
- [Migration: Tusky → Pinata](docs/migration-tusky-pinata.md) — Completed file-storage migration
- [Documentation Coverage](docs/content-migration.md) — Which page covers what, last review date
- [GitBook Sync](docs/gitbook-sync.md) — GitHub/GitBook synchronization

Every page was re-checked against the code on 2026-10-02 and 2026-10-03 (`main` at #104).

## GitHub to GitBook Single Source of Truth

1. All technical docs live under [docs](docs/); this README and [progress.md](progress.md) sit at the root.
2. The GitBook sidebar is controlled by [docs/SUMMARY.md](docs/SUMMARY.md).
3. Git Sync targets `main`.
4. A PR that changes behaviour updates the affected docs in the same PR, [progress.md](progress.md) when it changes what is live or open, and [docs/content-migration.md](docs/content-migration.md) when coverage changes.

## License

MIT
