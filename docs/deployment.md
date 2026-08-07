# Deployment

## Prerequisites

1. **Portainer installed** on your server (Community or Business Edition)
2. **Docker** and **Docker Compose** installed
3. A **Supabase project** with the migrations in `supabase/migrations/` applied
4. **Deployed contract addresses** (see `scripts/deploy-contracts.sh`)
5. **Environment variables** configured

## The one thing to get right

Two kinds of variable reach the container by different routes, and confusing
them is the most common way this deployment goes wrong:

| | Build time (`build.args`) | Runtime (`environment`) |
|---|---|---|
| Who can see it | **Every visitor** — compiled into the browser bundle | Server only |
| Changing it needs | A **rebuild** | A **restart** |
| Prefix | `NEXT_PUBLIC_` | anything else |

**A secret behind `NEXT_PUBLIC_` is published to every visitor.** The prefix is
not a naming convention — it is the switch that decides whether Next.js inlines
the value into JavaScript sent to browsers. `SUPABASE_SECRET_KEY` and
`PINATA_JWT` must never carry it.

The reverse is also a failure: a `NEXT_PUBLIC_` value supplied only at runtime is
empty in the bundle, so the app builds cleanly and then breaks in the browser.

## Quick Start

### 1. Prepare environment variables

Keep your Portainer variables in `portainer-env.txt` at the repository root. It
is gitignored — it holds the service-role key, the Pinata JWT and the indexer
secret, none of which belong in the repository.

```bash
cp .env.example portainer-env.txt
```

Fill it in, then paste the whole file into Portainer.

For a local Docker run instead of Portainer, Compose reads `.env` from the
working directory:

```bash
cp .env.local .env
```

### 2. Deploy via Portainer UI

Portainer supplies your variables to **both** the build and the container, which
is what makes the build-time/runtime split above work.

#### Option A: Web editor

1. **Stacks** → **Add stack**, name it `blkfndr`
2. Choose **Web editor**
3. Paste the contents of `docker-compose.yml`
4. **Environment variables** — click **Advanced mode** and paste `portainer-env.txt`
5. **Deploy the stack** (first build takes 5–10 minutes)

#### Option B: Git repository

1. **Stacks** → **Add stack** → **Repository**
2. Repository URL, reference `refs/heads/main`, compose path `docker-compose.yml`
3. **Environment variables** — **Advanced mode**, paste `portainer-env.txt`
4. **Deploy the stack**

### 3. Deploy via command line

```bash
docker compose up -d --build
```

```bash
docker compose logs -f blkfndr-app
```

## Required variables

### Build time — public

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Build fails if empty** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Build fails if empty.** Public by design; RLS protects the data |
| `NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID` | **Build fails if empty** |
| `NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID` | KYC gating |
| `NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID` | On-chain admin roster |
| `NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID` | Builder completion record |
| `NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID` | A currency left blank is simply not offered |
| `NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID` | ditto |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | **Defaults to testnet** — see below |
| `NEXT_PUBLIC_HORIZON_URL` | **Defaults to testnet** — see below |
| `NEXT_PUBLIC_APP_URL` | Must match the Supabase Site URL |
| `NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS` | |
| `NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS` | |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional. Unset renders a Maps link instead of an embedded map |

> **Both RPC URLs default to testnet.** A mainnet stack that leaves them blank
> builds without complaint and then quietly talks to testnet. It presents as
> "no projects appear", which looks like a data problem rather than a
> configuration one.
>
> | | Soroban RPC | Horizon |
> |---|---|---|
> | testnet | `https://soroban-testnet.stellar.org` | `https://horizon-testnet.stellar.org` |
> | mainnet | `https://mainnet.sorobanrpc.com` | `https://horizon.stellar.org` |

### Runtime — secret

| Variable | Notes |
|---|---|
| `SUPABASE_SECRET_KEY` | Bypasses RLS. Without it the indexer writes nothing and **no project ever appears** |
| `PINATA_JWT` | Project creation fails without it. **Not** `NEXT_PUBLIC_PINATA_JWT` |
| `PINATA_GATEWAY_URL` | |
| `PINATA_GROUP_BLKDFNDR` | |
| `INDEXER_SECRET` | Bearer token for `POST /api/indexer`. Invent a long random value |
| `GEMINI_API_KEY` | Optional, AI listing review. The Genkit plugin reads `GEMINI_API_KEY`, `GOOGLE_API_KEY` or `GOOGLE_GENAI_API_KEY` — not `GOOGLE_GENERATIVEAI_API_KEY` |
| `INDEX_INTERVAL_SECONDS` | Optional, defaults to 60 |

### Token contract addresses

Derived, not looked up, and different on each network:

```bash
stellar contract id asset --asset native --network testnet
```

```bash
stellar contract id asset --asset USDC:<ISSUER_G_ADDRESS> --network testnet
```

Deriving them again after a network change is not optional.

## Port configuration

The app listens on **3000** inside the container and is published on **8788**.
Point your reverse proxy at 8788. To change the host port, edit
`docker-compose.yml`:

```yaml
ports:
  - "YOUR_PORT:3000"
```

## The indexer service

The stack runs two services. The second, `indexer-cron`, calls
`POST /api/indexer` on a loop.

This is not optional housekeeping. The ledger is the source of truth but the
site reads Postgres, and nothing in the app self-triggers — without it a newly
created project never appears and a funded one never updates its total. The
failure is silent: pages load, nothing errors, there is simply never any data.

It calls over the stack's internal network, so the indexer endpoint never needs
to be reachable from outside.

## Supabase dashboard settings

Two things live in Supabase rather than in this stack, and Google sign-in fails
without both:

- **Site URL** must equal `NEXT_PUBLIC_APP_URL`
- **Redirect URLs** must include `<NEXT_PUBLIC_APP_URL>/auth/callback`

Enable the Google provider there, with the callback set to
`https://<project-ref>.supabase.co/auth/v1/callback`. Google OAuth is routed
through Supabase — there is no longer a client secret in this application.

## First administrator

The `platform_admins` migration seeds one bootstrap email address. Whoever
controls that mailbox becomes the first administrator on their first sign-in and
can add others from the console. **On a fresh deployment, change that address in
the migration before applying it.**

## Verifying a deployment

In order, because each step depends on the one before:

1. **Containers healthy.** Both running, `blkfndr-app` marked healthy. The
   healthcheck is liveness only — it reports that the process is serving, not
   that Supabase is reachable, so a database blip does not restart the app.
2. **App answers.** `GET /api/health` returns `{"status":"ok"}`.
3. **Supabase is wired.** The projects list renders, even if empty. A blank page
   with console errors about a missing URL means the build args were not set —
   and that needs a rebuild, not a restart.
4. **Indexer running.** `indexer-cron` logs a POST every interval. Failures are
   logged rather than swallowed, so a wrong `INDEXER_SECRET` shows as repeated 401.
5. **Projects appear.** Create one, wait one interval. If 1–4 pass but this does
   not, the usual cause is an unset `SUPABASE_SECRET_KEY`: the indexer can read
   the chain but cannot write the row.

## Updating

### Via Portainer

**Stacks** → `blkfndr` → **Update the stack**, with **Re-pull image and redeploy**.

Changing a **build-time** variable requires a rebuild. Restarting is not enough —
the old value is already compiled into the JavaScript being served.

### Via CLI

```bash
git pull && docker compose up -d --build
```

## Troubleshooting

### Container won't start

```bash
docker compose logs blkfndr-app
```

- **Build failed on a missing variable** — the Dockerfile fails deliberately when
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` or
  `NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID` is empty, because an image built
  without them cannot be fixed at runtime.
- **Port conflict** — check 8788 is free.

### No projects appear

Almost always one of three things, in order of likelihood:

1. `SUPABASE_SECRET_KEY` unset — the indexer reads the chain but cannot write
2. `indexer-cron` failing — check its logs for 401 (wrong `INDEXER_SECRET`)
3. The RPC URLs point at the wrong network

### Sign-in redirects to the wrong host

`NEXT_PUBLIC_APP_URL` and the Supabase **Site URL** disagree. Both must be the
public origin, and changing the former requires a rebuild.

### Blockchain connection issues

- Contract IDs correct and deployed to the network you are pointing at
- No firewall blocking the Soroban RPC or Horizon endpoints

## Reverse proxy setup

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
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

## Volume management

```bash
docker volume ls | grep blkfndr
```

```bash
docker run --rm -v blkfndr_next-cache:/data -v $(pwd):/backup alpine tar czf /backup/next-cache-backup.tar.gz -C /data .
```

## Production checklist

- [ ] `portainer-env.txt` filled in and **not** committed (it is gitignored)
- [ ] `SUPABASE_SECRET_KEY` set, and set as a **runtime** variable
- [ ] No secret carries a `NEXT_PUBLIC_` prefix
- [ ] RPC and Horizon URLs set explicitly for the target network
- [ ] `NEXT_PUBLIC_APP_URL` matches the Supabase Site URL and redirect list
- [ ] Bootstrap administrator address changed in the `platform_admins` migration
- [ ] SSL terminated at the reverse proxy
- [ ] `indexer-cron` confirmed running and succeeding

## Scaling

Running multiple app replicas is safe; running multiple `indexer-cron` replicas
is wasteful but not harmful, since the indexer records a cursor and skips events
it has already processed.

```bash
docker compose up -d --scale blkfndr-app=3
```
