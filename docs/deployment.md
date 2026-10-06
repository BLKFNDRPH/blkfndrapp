# Deployment

blkfndr runs as one Docker Compose stack: the Next.js app plus four small cron
containers that call it on a schedule. The stack is deployed through Portainer.
The database and sign-in live in Supabase, and the contracts live on Stellar.

The current deployment is testnet, at `https://testnetv2.blkfndr.com`. Nothing
deploys automatically. CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml))
type-checks and lints the app and builds and tests the contracts. The host is
rebuilt by hand.

For on-chain and database steps that are merged but not yet applied on testnet,
see [Pending live operations](#pending-live-operations).

## Prerequisites

1. A host with Docker and Docker Compose, managed by Portainer (Community or Business)
2. A Supabase project, set up as in [Supabase setup](#supabase-setup)
3. Deployed contracts, as in [Contracts](#contracts)
4. A reverse proxy that terminates TLS (see [Reverse proxy](#reverse-proxy))

## What the stack runs

Defined in [docker-compose.yml](../docker-compose.yml).

| Service | Image | Schedule | Calls | Needs |
|---|---|---|---|---|
| `blkfndr-app` | Built from [Dockerfile](../Dockerfile) (`node:24-alpine`, Next.js standalone) | Always on | — | Every variable below |
| `indexer-cron` | `curlimages/curl:8.11.1` | Every `INDEX_INTERVAL_SECONDS` (default 60) | `POST /api/indexer` | `INDEXER_SECRET` |
| `ops-funding-cron` | `curlimages/curl:8.11.1` | Every `OPS_FUNDING_INTERVAL_SECONDS` (default 86400, daily) | `POST /api/ops-funding` | `INDEXER_SECRET`; the app needs `OPS_FUNDING_SUBMITTER_SECRET` |
| `settle-stalled-cron` | `curlimages/curl:8.11.1` | Every `SETTLE_STALLED_INTERVAL_SECONDS` (default 86400, daily) | `POST /api/settle-stalled` | `INDEXER_SECRET`; the app needs `OPS_FUNDING_SUBMITTER_SECRET` |
| `keep-alive-cron` | `curlimages/curl:8.11.1` | Every `KEEP_ALIVE_INTERVAL_SECONDS` (default 86400, daily) | `POST /api/keep-alive` | `INDEXER_SECRET`; the app needs `OPS_FUNDING_SUBMITTER_SECRET` |

Each cron waits until the app passes its healthcheck, then loops. It calls
`http://blkfndr-app:3000` over the stack's internal network, sending
`Authorization: Bearer $INDEXER_SECRET` and an empty JSON body. `curl --fail`
makes an HTTP error visible: the log shows `<name>: run failed at <time>`. A
successful run prints the route's JSON reply. The request timeout is 120 seconds,
or 600 seconds for keep-alive.

All four routes check the bearer token with a constant-time compare. If
`INDEXER_SECRET` is unset in the app, they refuse every request and the app logs
`INDEXER_SECRET is not set — rejecting request.`

### indexer-cron

Copies chain state into Postgres. The ledger is the source of truth, but the
site reads Postgres, and nothing in the app triggers the indexer itself. Without
this service a new project never appears and a funded one never updates.

[src/lib/event-indexer.ts](../src/lib/event-indexer.ts) records each event once,
keyed by event id, and stores a ledger cursor. It follows the RPC cursor through
quiet stretches; Soroban RPC scans at most about 10,000 ledgers per request. A
cursor older than the RPC's retention restarts at the oldest retained ledger.
Each run also retries metadata for up to 5 projects still titled `Project #<id>`.

### ops-funding-cron

Calls the treasury's permissionless `fund_operations`. The contract allows one
transfer every 30 days, so polling daily moves money at most once a month. The
route reads first and returns a skip when funding is not configured, not yet
due, or has nothing to move. It does nothing until the owners vote
`SetOpsFunding`. See [src/lib/ops-funding.ts](../src/lib/ops-funding.ts).

### settle-stalled-cron

Simulates `settle_stalled` on every vault whose project is `funded` or `active`
in Postgres. The contract reverts unless the vault has been abandoned past its
stall window, so only vaults that are due are sent. See
[src/lib/settle-stalled.ts](../src/lib/settle-stalled.ts).

### keep-alive-cron

Keeps shared contract storage from expiring. Soroban archives any entry whose
rent lapses, and the next transaction to touch it pays to restore it. A lapsed
vault code once added about 60 XLM to every project launch.

[src/lib/ttl-keeper.ts](../src/lib/ttl-keeper.ts) reads the TTL of every shared
instance and code entry: the factory, identity registry, attestation registry,
admin roster, Operations Vault, the treasury (read from the factory's fee
wallet), and the vault code the factory currently deploys. It restores anything
archived and extends anything with under 40 days left to 60 days. The threshold
sits above the contracts' own 30-day top-up, which otherwise charges the first
launch or stake after a quiet spell for the days since the last one. When
nothing is due it sends nothing and returns `skipped`. Project vault instances are not
included; each one is extended by its own calls.

A dry run reports what is due and the simulated cost, and sends nothing:

```bash
docker exec <keep-alive-cron container> sh -c \
  'curl -s -X POST http://blkfndr-app:3000/api/keep-alive \
     -H "Authorization: Bearer $INDEXER_SECRET" \
     -H "Content-Type: application/json" \
     -d "{\"dryRun\": true}"'
```

In Portainer, run the `curl` part from the container's console. Without
`OPS_FUNDING_SUBMITTER_SECRET` a dry run still lists the entries, but cannot
estimate the cost.

### The gas payer

`OPS_FUNDING_SUBMITTER_SECRET` pays the network fees for ops-funding,
settle-stalled and keep-alive. It is gas-only. Every call it pays for is
permissionless, and it holds no authority over project vaults, the treasury or
any vote. Unset, all three routes return `skipped` with
`OPS_FUNDING_SUBMITTER_SECRET is not set.`

Keep it funded. On testnet, keeping all shared entries alive costs roughly 180
XLM a month, and the first restore pass on 2026-10-01 cost about 390 XLM.

## Build time vs runtime

Two kinds of variable reach the container by different routes. Confusing them
is the most common way this deployment goes wrong.

| | Build time | Runtime |
|---|---|---|
| Prefix | `NEXT_PUBLIC_` | anything else |
| Reaches Docker through | `build.args` in compose, plus an `ARG` and `ENV` line in the Dockerfile | `environment:` in compose |
| Who can see it | **Every visitor.** `next build` inlines it into the JavaScript | Server only |
| A change needs | A **rebuild** of the image | A redeploy that recreates the container |

**A secret behind `NEXT_PUBLIC_` is published to every visitor.** The prefix is
the switch that makes Next.js inline the value. `SUPABASE_SECRET_KEY`,
`PINATA_JWT`, `INDEXER_SECRET` and `OPS_FUNDING_SUBMITTER_SECRET` must never
carry it.

The reverse also fails. A `NEXT_PUBLIC_` value set only in the stack environment
is empty in the bundle, so the app builds cleanly and then breaks in the browser.
A new `NEXT_PUBLIC_` variable needs three things: an `ARG` and an `ENV` line in
the Dockerfile, a `build.args` entry in compose, and the value in the Portainer
stack environment. Then rebuild.

A plain `docker restart` keeps the container's old environment. A runtime change
takes effect when the container is recreated: a Portainer stack update, or
`docker compose up -d`.

## Environment variables

Every variable the code reads, from a search of `process.env` in `src/`, plus the
ones the Genkit plugin and compose read.

### Build time (public)

| Variable | Required | Read in | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes.** The build fails if empty | [supabase/server.ts](../src/lib/supabase/server.ts), [supabase/admin.ts](../src/lib/supabase/admin.ts), [proxy.ts](../src/proxy.ts) | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes.** The build fails if empty | [supabase/server.ts](../src/lib/supabase/server.ts), [proxy.ts](../src/proxy.ts) | Public by design. Row Level Security protects the data |
| `NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID` | **Yes.** The build fails if empty | [stellar-clients.ts](../src/lib/stellar-clients.ts), [ListingForm.tsx](../src/components/create/ListingForm.tsx) | |
| `NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID` | Yes | [stellar-clients.ts](../src/lib/stellar-clients.ts), the profile and KYC pages, [IdentityRegistryPanel.tsx](../src/components/admin/IdentityRegistryPanel.tsx), [ListingForm.tsx](../src/components/create/ListingForm.tsx) | KYC registry. The builder check reads it |
| `NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID` | Yes | [stellar-clients.ts](../src/lib/stellar-clients.ts) | On-chain admin roster |
| `NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID` | Yes | [stellar-clients.ts](../src/lib/stellar-clients.ts) | Builder completion record |
| `NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID` | Yes | [stellar-clients.ts](../src/lib/stellar-clients.ts), [managed-wallet.ts](../src/lib/managed-wallet.ts) | Operations Vault. Unset, the governance panel shows "Not configured" |
| `NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID` | At least one currency | [currencies.ts](../src/lib/currencies.ts) | A currency left blank is not offered when creating a project |
| `NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID` | At least one currency | [currencies.ts](../src/lib/currencies.ts) | Same |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | No. Defaults to testnet | [stellar-clients.ts](../src/lib/stellar-clients.ts) | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_HORIZON_URL` | No. Defaults to testnet | [stellar-clients.ts](../src/lib/stellar-clients.ts) | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_APP_URL` | Yes in production | [auth/app-origin.ts](../src/lib/auth/app-origin.ts) | Public origin, `https://` included. Must match the Supabase Site URL. Read only by the server, but still inlined at build |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | No | [ProjectLocation.tsx](../src/components/project/ProjectLocation.tsx) | Unset shows a Maps link instead of an embedded map. Restrict the key by HTTP referrer, since every visitor can read it |

Token contract addresses are derived from the asset and network, not looked up,
and differ between testnet and mainnet:

```bash
stellar contract id asset --asset native --network testnet
stellar contract id asset --asset USDC:<ISSUER_G_ADDRESS> --network testnet
```

### Runtime (server only)

| Variable | Required | Read in | Notes |
|---|---|---|---|
| `SUPABASE_SECRET_KEY` | **Yes** | [supabase/admin.ts](../src/lib/supabase/admin.ts) | Service-role key. Bypasses RLS. The indexer, the crons, KYC review and the Vault secret reads use it. Unset, every service-role call throws `SUPABASE_SECRET_KEY is not set` |
| `INDEXER_SECRET` | **Yes** | The four machine routes under [src/app/api](../src/app/api) | Bearer token shared by the app and the crons. Use a long random value |
| `PINATA_JWT` | Yes, unless set in the Vault | [secrets.ts](../src/lib/secrets.ts) | Pinning key. Read from Supabase Vault first (see below). Without either, uploads fail and no project can be created |
| `PINATA_GATEWAY_URL` | No | [pinata-client.ts](../src/lib/pinata-client.ts), [upload-image/route.ts](../src/app/api/upload-image/route.ts) | Dedicated gateway host, e.g. `nft.blkfndr.com`. Only the hostname is used. The indexer tries it first, then `gateway.pinata.cloud` |
| `PINATA_GATEWAY_KEY` | With a dedicated gateway | [pinata-client.ts](../src/lib/pinata-client.ts) | The dedicated gateway's Gateway Key (Pinata → Gateways → Access Controls → Gateway Keys), **not** the JWT. See the note below |
| `PINATA_GROUP_BLKDFNDR` | No | [upload-image/route.ts](../src/app/api/upload-image/route.ts) | Pinata group id that uploads are added to. The spelling is the one the code reads |
| `OPS_FUNDING_SUBMITTER_SECRET` | No | [ops-funding.ts](../src/lib/ops-funding.ts), [settle-stalled.ts](../src/lib/settle-stalled.ts), [ttl-keeper.ts](../src/lib/ttl-keeper.ts) | Stellar secret seed of a funded, gas-only account. See [The gas payer](#the-gas-payer) |
| `APP_URLS` | No | [auth/app-origin.ts](../src/lib/auth/app-origin.ts) | Extra origins, comma separated. See [Serving from more than one domain](#serving-from-more-than-one-domain) |
| `GEMINI_API_KEY` | No | The `@genkit-ai/googleai` plugin, set up in [src/ai/genkit.ts](../src/ai/genkit.ts) | AI listing review. The plugin reads `GEMINI_API_KEY`, then `GOOGLE_API_KEY`, then `GOOGLE_GENAI_API_KEY`. Compose passes only `GEMINI_API_KEY` |
| `RESEND_API_KEY` | No | [secrets.ts](../src/lib/secrets.ts) | Env fallback for the `resend_api_key` Vault secret. Nothing sends email yet, so nothing uses it. Compose does not pass it |

The image also sets `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0` and
`NEXT_TELEMETRY_DISABLED=1`. Leave them alone.

**Secrets in Supabase Vault.** [src/lib/secrets.ts](../src/lib/secrets.ts) reads
`pinata_jwt` and `resend_api_key` from Supabase Vault through the service role,
and falls back to `PINATA_JWT` and `RESEND_API_KEY` only when the Vault has no
value. An owner sets them in the admin console under Settings, without a
redeploy. Once set in the Vault, the Vault wins. Owners can write these values
but cannot read them back.

**Pinata Gateway Key.** For this account's pins, the dedicated gateway
(`PINATA_GATEWAY_URL`) answers `401 ERR_ID:00024` unless the request carries the
gateway's own Gateway Key, which is separate from the JWT. `PINATA_GATEWAY_KEY`
is sent as `x-pinata-gateway-token` to the dedicated gateway only, never to the
shared one, and metadata reads do not follow redirects (fetch would carry the
header to the redirect target). Without the key, every server-side metadata
read falls back to the shared `gateway.pinata.cloud`, which rate-limits (429)
after a few dozen requests.

To set it on a running stack: add it to the stack environment in Portainer and
**Update the stack**, which recreates the app container. No rebuild is needed,
and a plain `docker restart` keeps the old environment. Afterwards the app logs
stop showing `[Indexer] nft.blkfndr.com answered 401 for metadata …`, and
projects still titled `Project #N` fill in over the next indexer runs. The key
reached `main` in #104; it was first written for #91 but pushed after that PR
merged.

### Read by compose only

| Variable | Default | Effect |
|---|---|---|
| `APP_PORT` | `8788` | Host port the app is published on |
| `INDEX_INTERVAL_SECONDS` | `60` | Seconds between indexer runs |
| `OPS_FUNDING_INTERVAL_SECONDS` | `86400` | Seconds between ops-funding runs |
| `SETTLE_STALLED_INTERVAL_SECONDS` | `86400` | Seconds between settle-stalled runs |
| `KEEP_ALIVE_INTERVAL_SECONDS` | `86400` | Seconds between keep-alive runs |

### Testnet only, today

Setting mainnet RPC and Horizon URLs does not make a mainnet deployment.
[stellar-clients.ts](../src/lib/stellar-clients.ts) hard-codes
`Networks.TESTNET` as the network passphrase, and five places hard-code the
testnet Soroban RPC URL instead of using `stellar-clients`: the profile page
(twice), the KYC attestation page, `ListingForm` and `IdentityRegistryPanel`
(the project page, `ProjectView`, reads them from `lib/stellar`). Mainnet
needs a code change first.

## Quick start

### 1. Prepare the variables

Keep the Portainer variables in `portainer-env.txt` at the repository root. It
is gitignored, because it holds the service-role key, the Pinata JWT and the
indexer secret.

```bash
cp .env.example portainer-env.txt
```

Fill it in, then paste the whole file into Portainer.

For a local Docker run instead, Compose reads `.env` from the working directory.
`.dockerignore` keeps `.env` and `.env*.local` out of the build context.

```bash
cp .env.local .env
```

### 2. Deploy through Portainer

Portainer supplies the stack variables to both the build and the container,
which is what makes the build-time/runtime split work.

**Option A: Web editor**

1. **Stacks** → **Add stack**, and name it
2. Choose **Web editor** and paste `docker-compose.yml`
3. **Environment variables** → **Advanced mode**, and paste `portainer-env.txt`
4. **Deploy the stack**. The first build takes 5–10 minutes

**Option B: Git repository**

1. **Stacks** → **Add stack** → **Repository**
2. Repository URL, reference `refs/heads/main`, compose path `docker-compose.yml`
3. **Environment variables** → **Advanced mode**, and paste `portainer-env.txt`
4. **Deploy the stack**

The app service has no `image:` key, so Compose names the image after the stack
(for example `<stack>-blkfndr-app`). Two stacks on one host therefore never share
an image, and with it each other's inlined `NEXT_PUBLIC_` values.

### 3. Or from the command line

```bash
docker compose up -d --build
docker compose logs -f blkfndr-app
```

## Ports

| Where | Port |
|---|---|
| `npm run dev` | `9002` |
| Inside the container | `3000` (`PORT=3000`, `EXPOSE 3000`) |
| Published on the host | `APP_PORT`, default `8788` |

If 8788 is taken on the host, the whole stack fails at container networking:

```
Bind for 0.0.0.0:8788 failed: port is already allocated
```

Set `APP_PORT` to a free port (`ss -ltnp` lists the taken ones) and point the
reverse proxy at it. You can also publish `"3000"` alone and let Docker pick a
port. That never collides, but the host port changes on every recreate, which a
proxy configuration cannot follow.

## Healthcheck

The app's healthcheck runs `node -e` against `http://localhost:3000/api/health`
every 30 seconds, with a 10-second timeout, 3 retries and a 40-second start
period. [/api/health](../src/app/api/health/route.ts) returns
`{"status":"ok","timestamp":…}`. It is liveness only. It does not touch
Supabase or the RPC, so a database blip does not restart the app.

## Supabase setup

### 1. Apply the migrations

The schema, RLS policies and functions are in
[supabase/migrations/](../supabase/migrations). Apply them in filename order with
the Supabase CLI:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

The repository carries only the `migrations` folder, with no `config.toml`. If
the CLI asks for one, run `supabase init` once; it does not touch existing
migrations.

**Change the bootstrap administrator first** on any deployment other than this
one. See [First administrator](#first-administrator).

The live project's migration history has drifted from the repository (M-09 in
[progress.md](../progress.md)), so a clean replay does not reproduce live
exactly.

### 2. Enable the providers

- **Google:** Authentication → Providers → Google, with the Google OAuth client id
  and secret. In Google Cloud, the authorised redirect URI is
  `https://<project-ref>.supabase.co/auth/v1/callback`. Google sign-in goes
  through Supabase, so the app holds no Google client secret.
- **Email:** sign-up with password, with email confirmation.

### 3. URL configuration

Authentication → URL Configuration:

| Setting | Value on testnet |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://testnetv2.blkfndr.com` |
| **Site URL** | `https://testnetv2.blkfndr.com` |
| **Redirect URLs** | `https://testnetv2.blkfndr.com/auth/callback`<br>`https://testnetv2.blkfndr.com/auth/confirm` |

Use `https://`, and exact paths with no wildcard. The app asks Supabase to
return to `<origin>/auth/callback` (Google) and `<origin>/auth/confirm` (email
links). The post-sign-in destination travels in a short-lived cookie
([next-cookie.ts](../src/lib/auth/next-cookie.ts)), not in the query string, so
those bare paths are all an entry has to match.

**An unmatched redirect does not fail.** Supabase silently sends the user to the
Site URL instead. Its default Site URL is `http://localhost:3000`, so a wrong
setting lands users on localhost, or back on the home page still signed out.
The allow-list is matched as a glob against the whole URL: `*` matches anything
except `.` and `/`, and `**` matches anything.

### 4. Email templates

[/auth/confirm](../src/app/auth/confirm/route.ts) accepts only the `token_hash`
form of email link. Without `token_hash` and `type` it redirects to
`/login?error=InvalidLink`. Point the templates at it:

| Template | Link |
|---|---|
| Confirm signup | `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email` |
| Reset password | `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` |

`{{ .RedirectTo }}` is the `<origin>/auth/confirm` the app sent, so this also
works for a second domain. There is no "forgot password" screen yet
(`requestPasswordReset` is unwired), so only the signup template is reachable
today.

### Serving from more than one domain

`NEXT_PUBLIC_APP_URL` is one origin, inlined at build. `APP_URLS` adds more,
comma separated:

```
NEXT_PUBLIC_APP_URL=https://testnetv2.blkfndr.com
APP_URLS=https://app.blkfndr.com,https://staging.blkfndr.com
```

A request arriving on any configured origin is sent back to the same origin
after sign-in. The app checks `X-Forwarded-Host`, then `Host`, against the list.
Anything else, including a forged header, gets `NEXT_PUBLIC_APP_URL`, so this is
not an open redirect.

- Every origin needs its own two Redirect URL entries in Supabase.
- `APP_URLS` is runtime. Adding a domain needs a redeploy, not a rebuild.
- Hosts are compared including the port. `https://example.com` does not match
  `example.com:8443`.

### First administrator

The console roster is the `platform_admins` table. One bootstrap address is
seeded, currently `tzarumang@gmail.com`, by
[20260808090000_correct_bootstrap_admin.sql](../supabase/migrations/20260808090000_correct_bootstrap_admin.sql).
Whoever controls that mailbox becomes the first administrator on first sign-in
and can add others from the console.

**On any other deployment, change that address before applying the
migrations.** The roster cannot be bootstrapped from the app. With an empty
roster `is_admin()` is false for everyone, and RLS then refuses the insert that
would add the first administrator.

To replace the address later, write another migration in the same shape: insert
the replacement, then delete the old row. `guard_admin_removal` refuses to
remove the last administrator, so the other order fails.

### Platform secrets

After the first sign-in, an owner can store the Pinata JWT in the Vault from the
admin console under Settings. The app then reads it from there instead of
`PINATA_JWT`.

## Contracts

The contract sources are in [contracts/](../contracts). The app uses the
generated TypeScript bindings in [src/packages/](../src/packages). Contract
behaviour is in [smart-contracts.md](smart-contracts.md).

### Build

```bash
bash scripts/build-contracts.sh
```

[build-contracts.sh](../scripts/build-contracts.sh) builds all seven contracts
(vault, factory, attestation, identity, admin, treasury, operations) for
`wasm32-unknown-unknown` with the toolchain pinned in
[rust-toolchain.toml](../rust-toolchain.toml) (1.81.0). It prints each wasm's
size and SHA-256. Run it before `cargo test --workspace`, because the factory's
deployment tests need `blkfndr_vault.wasm`.

**Hashes only reproduce on the same build paths.** The wasm embeds absolute
cargo registry paths (for example `C:\Users\admin\.cargo\registry\…`) in panic
locations. The same source built on another machine gives a different hash,
and the hashes CI records in its run summary come from CI's own paths. A pinned
Docker build would fix this; there is none yet.

### Deploy

```bash
bash scripts/deploy-contracts.sh --network testnet --source <cli-identity> [--fee-wallet <address>]
```

[deploy-contracts.sh](../scripts/deploy-contracts.sh) builds, uploads the vault
wasm, and deploys the rest with constructors. Each contract is configured inside
its own deploy transaction, so there is no window in which anyone could
initialise it first. The order matters:

1. Upload the vault wasm. It is not deployed; the factory instantiates one vault
   per project from its hash.
2. Deploy identity, admin and attestation. Attestation takes no factory at
   construction, which breaks the old factory↔attestation cycle.
3. Deploy the factory with both registry addresses, the vault wasm hash, the fee
   wallet, platform fee (default 100,000,000 stroops), voting window (default 7
   days) and minimum contribution (default 50,000,000 stroops).
4. Call `add_factory` on attestation. This is the one post-deploy step, and it
   is admin-gated.
5. Read the wiring back, and exit non-zero if anything is wrong.

The IDs go to `deployed-contracts.env` (gitignored). Copy them into the
`NEXT_PUBLIC_BLKFNDR_*` variables and **rebuild**.

The script does not deploy the **treasury** or the **Operations Vault**. Both are
deployed separately with their own constructors (see
[smart-contracts.md](smart-contracts.md)). The treasury's `factory` is fixed at
construction, so a new factory needs a new treasury. Deploy the factory with an
interim fee wallet, deploy the treasury against it, then call the factory's
`update_fee_wallet`. The app, ops-funding and keep-alive all read the treasury
from the factory's fee wallet, so nothing else needs the address.

### Switching the vault code

The factory deploys new vaults from a stored wasm hash, and its admin can change
it. Existing vaults are immutable and keep the code they were created with.

The commands, with the factory admin key (the CLI identity
`ba-escrow-deployer`, address `GDR4TPUF…`). Run them from the maintainer's
machine, which holds that key. The Portainer stack has neither the Stellar CLI
nor the admin key, and should not:

```bash
bash scripts/build-contracts.sh
stellar contract upload --wasm target/wasm32-unknown-unknown/release/blkfndr_vault.wasm --source-account ba-escrow-deployer --network testnet
stellar contract invoke --id CDIXGE5MWFAYXA7FKLB4CDRSSQZ6VQSGHT6O6OY3TFTWVF6F7BGKR7D5 --source-account ba-escrow-deployer --network testnet -- update_wasm_hash --new_hash <hash printed by the upload>
```

Built from `main` on the maintainer's machine, that wasm hashes `e9009410…`.
Another machine gives a different hash (see the build caveat above). Use the hash
the upload prints. If that code is already on testnet, the upload only reprints
its hash.

Last switch: 2026-10-06, from `70e5f3a8…` to `e9009410…` (the #99 release rule
plus the money majority), in transaction
[`9dd7ed93…`](https://stellar.expert/explorer/testnet/tx/9dd7ed938ad0ef0db7e357cc6567e70c1620abb296a7baa301932888d7a13508).

To check, `GET /api/vault-wasm-hash` reads the hash straight from the factory's
storage and caches it for 5 minutes. The homepage's "check it yourself" box shows
the same value. keep-alive follows the factory's current hash, so the new code
is kept alive with no change.

Deploy the app before switching the hash. Contract structs decode by field
position, so an older binding can fail on a newer vault shape. #99 is the
exception: its structs are unchanged, so either order works.

## Pending live operations

Merged is not the same as live. The Operations Vault cutover votes, two
unapplied migrations and the factory and registry redeploy are tracked in
**[progress.md](../progress.md)** under "Not yet done".
They are not repeated here.

## Verifying a deployment

In order, because each step depends on the one before:

1. **Containers healthy.** All five running, `blkfndr-app` marked healthy.
2. **App answers.** `GET /api/health` returns `{"status":"ok",…}`.
3. **Supabase wired.** The projects list renders, even if empty. A blank page
   with console errors about a missing URL means the build args were not set,
   which needs a rebuild.
4. **Indexer running.** `indexer-cron` prints a JSON reply every interval. A
   wrong `INDEXER_SECRET` shows as repeated `run failed` lines and 401s.
5. **Projects appear.** Create one and wait one interval.
6. **Crons.** The three daily services print a reply once a day. `skipped` is
   normal when nothing is due or the gas payer is unset.

## Updating

| Change | What it needs |
|---|---|
| New code from `main` | Rebuild the image |
| Any `NEXT_PUBLIC_` value | Rebuild the image |
| A runtime variable (`SUPABASE_SECRET_KEY`, `PINATA_*`, `APP_URLS`, …) | Recreate the container. No rebuild |
| A cron interval | Recreate that cron container |
| A Vault secret (`pinata_jwt`) | Nothing. Set it in the console |

**Portainer:** **Stacks** → your stack → **Update the stack** (Web editor), or
**Pull and redeploy** (Git repository). The app image is built here, not pulled
from a registry, so **Re-pull image** does not apply to it. Only the curl images
come from a registry.

**CLI:**

```bash
git pull && docker compose up -d --build
```

**Check the bundle is new.** A redeploy that reused the old image still serves
the old JavaScript, with the old inlined values. To check without signing in,
fetch a page, list its `/_next/static/…js` chunks, and grep them for a string
from the change:

```bash
curl -sL https://testnetv2.blkfndr.com/ | grep -o '/_next/static/[^"]*\.js' | sort -u
```

## Troubleshooting

### Build fails on a missing variable

The Dockerfile fails on purpose when `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID` is
empty. An image built without them cannot be fixed at runtime.

### Stack fails to start: port already allocated

`Bind for 0.0.0.0:<port> failed`. See [Ports](#ports). The crons then wait for an
app that never becomes healthy.

### No projects appear

In order of likelihood:

1. **`SUPABASE_SECRET_KEY` unset.** `indexer-cron` logs `run failed`, and the app
   logs `Error in indexer API route: Error: SUPABASE_SECRET_KEY is not set`.
2. **Wrong `INDEXER_SECRET`.** The cron gets 401.
3. **Wrong network.** The RPC URL points somewhere other than the factory's
   network.

The indexer cannot replay events older than the RPC's retention window. A stack
left down longer than that misses those events.

### Projects are listed as "Project #N"

The indexer could not fetch the project's metadata from IPFS. Look for
`[Indexer] <host> answered <status> for metadata <cid>` in the app logs.

- `401` from the dedicated gateway means `PINATA_GATEWAY_KEY` is missing, wrong
  or not yet in the container's environment. See the note under
  [Runtime](#runtime-server-only). The shared gateway then serves the read.
- `429` from `gateway.pinata.cloud` is the shared gateway's rate limit. Each
  indexer run retries up to 5 unresolved projects, so they fill in over later
  runs.
- `400` on every gateway means the CID is not valid content.

### Sign-in lands on the wrong host or on localhost

`NEXT_PUBLIC_APP_URL` and the Supabase Site URL disagree, or the redirect is not
on the allow-list. Both must be the public `https://` origin. Changing
`NEXT_PUBLIC_APP_URL` needs a rebuild.

### Google sign-in succeeds, but the user comes back signed out

`NEXT_PUBLIC_APP_URL` (or an entry in `APP_URLS`) uses `http://` on a site served
over https. The app then asks Supabase to return to `http://…/auth/callback`,
which does not match the `https://` Redirect URLs. Supabase returns the user to
the Site URL with a one-time code that nothing exchanges. Users see the home
page, still signed out.

How to recognise it:

- Supabase auth logs show `/authorize` → `/callback` pairs with no following
  `/token` (`grant_type=pkce`).
- The API gateway logs show `redirect_to=http%3A%2F%2F…` on `/auth/v1/authorize`.
- The app logs `[auth] Public origin configured over plain http` once, at the
  first sign-in.

Fix: set `NEXT_PUBLIC_APP_URL=https://…`, remove any `http://` entry from
`APP_URLS`, then **rebuild**.

This caused the 2026-09-28 testnet outage. It was fixed on the live host by
2026-10-01: Google redirects now use https and PKCE exchanges complete.

### Email confirmation link says "That link is not valid"

The email template does not use the `token_hash` form. See
[Email templates](#4-email-templates).

### Image upload fails

The app answers `/api/upload-image` with a reason:

| Status | Cause |
|---|---|
| 401 | Not signed in |
| 413 | Over 8 MB |
| 415 | Not PNG, JPEG, WebP, GIF, SVG or JSON, or the bytes do not match the type |
| 500 `Server misconfiguration: the Pinata key is not set.` | No `pinata_jwt` in the Vault and no `PINATA_JWT` |

### The Operations Vault panel says "Not configured"

`NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID` was not set at build time. Set it
in the stack environment and rebuild.

### A launch suddenly costs tens of XLM more

Shared contract storage has lapsed and the launch is paying to restore it. Check
that `keep-alive-cron` is running and that `OPS_FUNDING_SUBMITTER_SECRET` is set
and funded, then run a [dry run](#keep-alive-cron).

### AI listing review does nothing

`GEMINI_API_KEY` is unset. `GOOGLE_GENERATIVEAI_API_KEY` is not a name the
plugin reads.

### Contract calls fail

- The contract IDs are deployed on the network the RPC URL points at.
- No firewall blocks the Soroban RPC or Horizon endpoints.

## Reverse proxy

```nginx
server {
    listen 80;
    server_name testnetv2.blkfndr.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name testnetv2.blkfndr.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        # Must match APP_PORT (default 8788).
        proxy_pass http://localhost:8788;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Keep `proxy_set_header Host $host`. nginx's default replaces `Host` with the
upstream address, and the app only uses the header to pick among configured
origins, so a rewritten host falls back to `NEXT_PUBLIC_APP_URL`.

## Volume

The app mounts `next-cache` at `/app/.next/cache`. Compose prefixes the volume
with the stack name.

```bash
docker volume ls | grep next-cache
docker run --rm -v <stack>_next-cache:/data -v $(pwd):/backup alpine tar czf /backup/next-cache-backup.tar.gz -C /data .
```

## Production checklist

- [ ] `portainer-env.txt` filled in and not committed (it is gitignored)
- [ ] `SUPABASE_SECRET_KEY` and `INDEXER_SECRET` set as runtime variables
- [ ] No secret carries a `NEXT_PUBLIC_` prefix
- [ ] `NEXT_PUBLIC_APP_URL` is `https://` and matches the Supabase Site URL
- [ ] Supabase Redirect URLs list `/auth/callback` and `/auth/confirm` on https
- [ ] Email templates use the `token_hash` link
- [ ] Bootstrap administrator address changed before the migrations ran
- [ ] Pinata JWT in the Vault or in `PINATA_JWT`
- [ ] `OPS_FUNDING_SUBMITTER_SECRET` set and funded
- [ ] TLS terminated at the reverse proxy
- [ ] All four crons running and printing replies

## Scaling

Run one of each cron. The indexer is safe to call twice, since each event is
recorded once by id, but extra copies only cost RPC calls.

The app publishes a fixed host port, so `docker compose up --scale
blkfndr-app=N` fails with a port conflict. To run several replicas, publish no
host port, and put a load balancer on the stack network in front of them.
