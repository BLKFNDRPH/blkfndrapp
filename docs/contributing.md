# Contributing to blkfndr

How to set up the repo, what CI checks, and the rules a change has to follow. Read [Architecture](architecture.md) first for how the pieces fit together.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js + npm | Node 22 or later (`engines` in [package.json](../package.json)). CI and the Docker image use Node 24 | The app |
| Rust | 1.81.0 with the `wasm32-unknown-unknown` target, pinned in [rust-toolchain.toml](../rust-toolchain.toml). Add `clippy` to match CI | The contracts |
| Stellar CLI (`stellar`) | — | Regenerating contract bindings, [scripts/deploy-contracts.sh](../scripts/deploy-contracts.sh) |
| Supabase CLI | — | Applying migrations, regenerating database types |
| Freighter | Browser extension | Any wallet flow |
| Docker | — | Building the deploy image only |

On a Windows GNU host, [.cargo/config.toml](../.cargo/config.toml) adds a linker flag so contract tests link. It does not affect the wasm builds.

## Getting started

```bash
git clone https://github.com/BLKFNDRPH/blkfndrapp.git
cd blkfndrapp
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

The app runs on **http://localhost:9002**. The variables are listed in the [README](../README.md#environment-variables), and [.env.example](../.env.example) explains each one.

`.env.local` decides which Supabase project and contracts you work against. Pointed at the testnet project, you are working on live data.

To build and test the contracts:

```bash
bash scripts/build-contracts.sh   # first: the factory tests need the vault wasm
cargo test --workspace
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server on port 9002, with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run genkit:dev` | Genkit Developer UI for the AI flows (see [AI Features](ai-features.md#local-development)) |
| `npm run genkit:watch` | The same, restarting on file changes |
| `bash scripts/build-contracts.sh` | Build every contract to wasm and print its size and sha256 |
| `cargo test --workspace` | Contract tests |
| `cargo clippy --workspace --all-targets -- -D warnings` | Contract lints, as CI runs them |
| `bash scripts/deploy-contracts.sh --source <key>` | Deploy and wire the contract set |

## Branches, commits and pull requests

**Branches.** Branch from `main`, one branch per change. Recent branches are named `claude/<short-name>`. Older ones are a short kebab-case description, such as `contracts-hardening-fund-safety`. There are no `feat/` or `fix/` prefixes.

**Commits.** The subject is a plain imperative sentence that says what changes, capitalized, with no type prefix and no trailing period. From `main`:

```
Keep the indexer moving through quiet stretches
Refuse a Freighter signature from an account nobody asked for
Drop the phantom percentage fee from the stake dialog
```

The body explains why. Say what was wrong and how it showed up, then what the change does.

**Pull requests.** Open them against `main`. They are merged with a merge commit. To pick up newer work, merge `origin/main` into your branch.

The description covers:

- **Why** — the problem, with evidence.
- **What changed.**
- **Verification** — what you ran and what you saw. A checklist works. Leave a box unchecked for anything that still needs a person, such as a Freighter signature.
- **Deploy notes** — anything that has to happen outside the merge. That means migrations to apply and in what order, an image rebuild, a contract redeploy, or a factory `update_wasm_hash`.

`main` has no branch protection. CI runs on every pull request and every push to `main`, so check it is green before merging.

Report bugs in [GitHub Issues](https://github.com/BLKFNDRPH/blkfndrapp/issues).

## What CI runs

[.github/workflows/ci.yml](../.github/workflows/ci.yml) has two jobs.

| Job | Steps |
|---|---|
| **Web app** | Node 24, `npm ci`, `npm run typecheck`, `npm run lint`, then `npm audit --omit=dev`, which reports without failing |
| **Soroban contracts** | Rust 1.81.0 with `wasm32-unknown-unknown`, `bash scripts/build-contracts.sh`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`. It writes each wasm's size and sha256 to the job summary and uploads the wasm files |

CI does not run `npm run build`, does not check formatting, and there is no JavaScript test suite.

## Testing a change

- **Typecheck and lint.** `npm run typecheck` must pass. `npm run lint` must report no errors. `main` carries some warnings, so add no new ones.
- **Build** with `npm run build` when you touch `next.config.js`, the boundary between server and client code, or imports. CI will not catch a broken build.
- **Contracts.** Run `bash scripts/build-contracts.sh` before `cargo test --workspace`. The factory's deployment tests need `blkfndr_vault.wasm` and skip themselves when it is missing. Then run clippy as above.
- **Run it.** Reading the code is not verification. Run the app and use the change. For logic, a small `tsx` or esbuild script that stubs the `@/` modules it doesn't need is enough. When a check needs a signed-in user, stub the session, for example `/api/auth/session`. Never sign in with someone's credentials.
- **Say what you ran** in the pull request.

## Code conventions

- TypeScript `strict`. Import internal code through the `@/` alias, which maps to `src/`.
- Components are PascalCase `.tsx` under `src/components/<area>/`. shadcn/ui primitives live in `src/components/ui/`. Library modules are kebab-case under `src/lib/`. Hooks are `use-*.ts(x)` under `src/hooks/`.
- Shared types are in [src/lib/types.ts](../src/lib/types.ts).
- Database access goes through the data layer in `src/lib/data/`. Every module there imports `server-only`.
- There are two Supabase clients. [src/lib/supabase/server.ts](../src/lib/supabase/server.ts) acts as the caller, with RLS applied. [src/lib/supabase/admin.ts](../src/lib/supabase/admin.ts) is the service role and bypasses RLS. Use the admin client only from server-only code, after an explicit authorization check.
- Server Actions live in `src/actions/*.ts`, [src/app/actions.ts](../src/app/actions.ts), `src/app/auth/actions.ts` and `src/app/settings/actions.ts`.
- On-chain amounts are `i128`. Keep them as `bigint` or strings, never `number`. `*_raw` database columns are read cast to text for the same reason.

## Security rules

These are requirements, not style preferences.

1. **Every `"use server"` export is a public HTTP endpoint.** So is every route handler. Each one authenticates and authorizes on its own, through `requireCaller`, `requireAdmin` or `requireWalletOwnerOrAdmin` in [src/lib/auth/guards.ts](../src/lib/auth/guards.ts). Treat its arguments as hostile and validate them. Map an `AuthError` to a result with `authFailure`. Never export an unguarded helper from a `"use server"` file. `notify`, for example, is deliberately not an action.
2. **RLS on every table.** The guards are the second line of defence, not the first.
3. **No PostgREST `.upsert()` on tables with column-scoped grants.** `.upsert()` compiles to `INSERT … ON CONFLICT DO UPDATE`, and Postgres requires SELECT on every column that statement assigns. On a table where a role may write a column it cannot read, the upsert is refused before RLS runs, with `permission denied for table …`. That message reads like a missing grant, but it isn't one. Do not widen the grants. Read the row, then INSERT or UPDATE explicitly, as `submitOwnKyc` does in [src/lib/data/kyc.ts](../src/lib/data/kyc.ts). This applies to `profiles`, `kyc_requests`, `notifications` and any table that gets the same pattern.
4. **Non-custodial.** No platform-held key may ever control stakeholder funds or votes. Platform-managed keys exist only for KYC attestors and gas.
5. **Secrets stay server-side.** Nothing secret takes a `NEXT_PUBLIC_` prefix, and the service-role key is read only from `server-only` modules.

## Environment variables and the Docker build

`NEXT_PUBLIC_*` values are inlined into the client bundle by `next build`, so they are fixed when the image is built. Adding one takes four steps:

1. An `ARG` and a matching `ENV` in the builder stage of the [Dockerfile](../Dockerfile). A variable that isn't listed inlines as an empty string, with no error.
2. An entry under `build.args` in [docker-compose.yml](../docker-compose.yml).
3. An entry in [.env.example](../.env.example) and in the README's variable table.
4. **A rebuild of the image.** A redeploy or restart does not re-inline a public value.

Server-only variables go under the app service's `environment:` in `docker-compose.yml` instead. They are read at request time, so they never need a rebuild.

The Dockerfile refuses to build when `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID` is empty.

## Database migrations

Migrations are tracked SQL in [supabase/migrations/](../supabase/migrations/), named `YYYYMMDDHHMMSS_snake_case.sql`. Each one covers schema, RLS policies and grants.

- **Never edit an applied migration.** Add a new one that corrects it.
- **Start with a header comment** that says what the migration fixes and why. If it depends on app code being live first, say so under `DEPLOY ORDER`. [20260809160000_profiles_column_grants.sql](../supabase/migrations/20260809160000_profiles_column_grants.sql) is an example.
- **Apply** with `supabase link --project-ref <ref> && supabase db push`. Applying to the live project is the owner's call.
- **Regenerate the types** afterwards: `supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts`.

The live project does not match the repo file for file. It records its own version numbers, applied some migrations in a different order from their filenames, and has `add_platform_admin_role`, which the repo doesn't. Check the live migration list before you apply or replay anything. Some repo migrations are not applied yet — see [progress.md](../progress.md).

To test a migration before it reaches live:

- **Locally, with PGlite.** PGlite is Postgres compiled to WASM (`@electric-sql/pglite`). Replay the migrations in the order the live project applied them, with a small Supabase shim: the `anon`, `authenticated` and `service_role` roles, `auth.users`, and `auth.uid()` and `auth.jwt()` reading `request.jwt.claims`. Then probe each role.
- **On live, as a dry run.** Send the migration and your probes as one SQL string through a single `execute_sql` call of the Supabase MCP. The call runs as one transaction. End it with a `DO` block that raises an exception carrying the probe results. The raise rolls everything back, migration included, and the results come back in the error. Do not open an explicit `BEGIN`, because a transaction left open holds locks. Afterwards, confirm nothing persisted. This touches the live database, so get the owner's approval first.

## Smart contracts

The seven contracts are workspace crates under [contracts/](../contracts/), built on `soroban-sdk` 22. See [Smart Contracts](smart-contracts.md) for what each one does.

- **Build** with [scripts/build-contracts.sh](../scripts/build-contracts.sh). It adds the wasm target if it is missing, builds each crate in release mode, and prints the sha256 that a reviewer checks a deployment against.
- **Test and lint** with `cargo test --workspace` after the build, then clippy with `-D warnings`.
- **Merged is not deployed.** A contract changes on testnet only when it is redeployed. A vault change reaches only the vaults the factory creates after `update_wasm_hash`, because existing vaults are immutable.
- **Add new struct fields last.** Bindings decode `#[contracttype]` structs by field position, so a new field must sort last. The app has to ship with the new binding before a deployed contract returns the new shape. See [Contract Bindings](blkfndr-stellar-cntrct-setup.md).

### Regenerating contract bindings

The TypeScript bindings in `src/packages/` are generated from the wasm and consumed as source through `@/packages/*`. Regenerate them after any interface change, as [src/packages/README.md](../src/packages/README.md) describes:

```bash
bash scripts/build-contracts.sh
stellar contract bindings typescript \
  --wasm target/wasm32-unknown-unknown/release/blkfndr_vault.wasm \
  --output-dir src/packages/blkfndr_vault --overwrite
rm src/packages/blkfndr_vault/{package.json,tsconfig.json,README.md}
```

Delete the generated `package.json`, `tsconfig.json` and `README.md`. Installing a binding as a package creates a second copy of `@stellar/stellar-sdk`, and its types no longer match the app's. Never hand-edit a binding. ESLint ignores `src/packages/` for this reason.

## AI flows

The single Genkit flow and how to add another are in [AI Features](ai-features.md#adding-a-flow).

## Documentation

When a change alters behaviour, configuration or deployment, update the docs in the same pull request:

- [README.md](../README.md) — status, the variable table, scripts and structure, whichever is affected.
- The relevant page in [docs/](./).
- [docs/SUMMARY.md](SUMMARY.md) when you add, remove or rename a page. It is the GitBook sidebar.
- [progress.md](../progress.md) — what is live on testnet and what is merged but not yet live.
- [docs/content-migration.md](content-migration.md) when feature coverage changes.

Write plainly and concretely. Describe blkfndr as a secure, non-custodial vault governed by its stakeholders. Use its vocabulary: vault, stakeholder, builder, milestone, release. Never call it crowdfunding.
