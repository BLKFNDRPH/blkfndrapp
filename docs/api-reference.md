# API Reference

blkfndr exposes four interaction surfaces. Which one you reach for depends on whether the operation touches value, whether it needs a signature, and whether it needs privileged data.

| Surface | Use it for | Trust boundary |
|---|---|---|
| **Contract calls** (Soroban RPC) | Anything that holds or moves value: staking, voting, releases, governance | Signed by the user's own wallet (Freighter) or a carried vote; no server in the path |
| **Server Actions** (`"use server"`) | Privileged reads/writes over Supabase: moderation, admin, KYC review, settings | Every export re-authenticates and re-authorizes; arguments treated as hostile |
| **REST API routes** (`/api/*`) | Client data fetching, auth/session, uploads, and machine-to-machine triggers | Session cookie, or a bearer secret for the two machine endpoints |
| **Horizon** | Account balances, transaction history, asset metadata | Read-only, public |

The rule of thumb: **the money path never goes through the server.** A stake, a milestone vote, a release, a governance proposal — all are contract calls the user (or a permissionless executor) submits directly. The server exists for identity, moderation, and convenience reads.

---

## 1. Contract calls (Soroban RPC)

On-chain state is read and written through the generated TypeScript bindings in `src/packages/` (one package per contract). See [Smart Contracts](smart-contracts.md) for every entrypoint.

**Reads** are free simulations — no signature, no fee:

```ts
import { Client, networks } from "@/packages/blkfndr_vault";

const vault = new Client({ ...networks.testnet, rpcUrl, contractId });
const { result } = await vault.get_state();          // simulateTransaction under the hood
```

**Writes** are built, signed by the user's wallet, then submitted:

```
build tx (assembleTransaction) → Freighter signs → sendTransaction → poll getTransaction
```

Governance proposals (`propose` / `approve` / `execute` on the treasury and Operations Vault) take an action encoded as `{ tag: "SetOpsFunding", values: [...] }` — the binding's discriminated-union shape, **not** the `{ SetOpsFunding: ... }` shorthand, which the contract spec rejects.

Client construction lives in `src/lib/stellar-clients.ts`; both the RPC and Horizon URLs default to **testnet** when their `NEXT_PUBLIC_` vars are unset.

### Permissionless entrypoints

Some writes take no authorizing caller — a carried vote is the authority, so anyone may submit them:

- `blkfndr-vault`: `release_milestone`, `settle_lapsed_milestone`, `settle`
- `blkfndr-treasury`: `fund_operations` (30-day-gated)
- `blkfndr-operations`: `execute`

---

## 2. Server Actions

Every exported async function in a `"use server"` file is a public HTTP endpoint. Each one **re-authenticates the caller, re-authorizes against their role, and validates its arguments** — the argument list is treated as hostile, never trusted because it came from our own client. Roles are read from `app_metadata`; the service-role key is used only inside these server-only modules, never shipped to the browser.

| Module | Exports (selected) | Guard |
|---|---|---|
| `src/actions/admins.ts` | `getAdminsAction`, `getMyRoleAction`, `grantAdminAction`, `revokeAdminAction`, `setAdminWalletAction`, `recognizeWalletAction`, `getAdminAuditLogAction` | Owner / platform-admin. `grantAdminAction` also provisions a managed attestor wallet (rolled back on failure); `revokeAdminAction` sweeps and deletes it |
| `src/actions/moderation.ts` | `getUsersAction`, `banUserAction`, `unbanUserAction`, `getHealthAction` | Platform administrator |
| `src/actions/project-moderation.ts` | `flagProjectAction`, `voteOnProjectAction`, `clearModerationAction`, `getModerationAction`, `getPendingReviewsAction` | Project administrator |
| `src/actions/secrets.ts` | `getSecretStatusAction`, `setPlatformSecretAction` | Platform administrator; writes to Supabase Vault |
| `src/actions/claims.ts` | `createClaimRequest`, `getClaimRequests`, `deleteClaimRequest` | Session |
| `src/actions/feature-requests.ts` | `getFeatureRequestsAction`, `submitFeatureRequestAction`, `toggleUpvoteAction`, `decideFeatureRequestAction`, `respondToFeatureRequestAction` | Session; decide/respond are admin |
| `src/actions/categories.ts` | `getCategoriesAction`, `addCategoryAction`, `removeCategoryAction` | Read public; writes admin |
| `src/actions/notifications.ts` | `markNotificationsAsRead`, `dismissNotification`, `dismissAllNotifications` | Session, own rows only |
| `src/app/actions.ts` | Listing/project creation and reads | Session |
| `src/app/auth/actions.ts` | Sign-in / sign-up / OAuth start | Public (auth) |
| `src/app/settings/actions.ts` | Profile and platform settings | Session |

The AI listing review is a Genkit flow, not a plain action: `src/ai/flows/improve-listing-quality.ts` runs on Gemini 2.5 Flash and returns `{ suggestions[], flags[], score }`. It is inert without `GEMINI_API_KEY`.

---

## 3. REST API routes

All under `/api`. Session routes require the Supabase auth cookie; the two machine routes require a bearer token.

### Auth & session
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/auth/session` | Current session/user |
| `POST` | `/api/auth/logout` | End the session |
| `POST` | `/api/auth/freighter/nonce` | Issue a nonce to sign for wallet linking |
| `POST` | `/api/auth/freighter/verify` | Verify the signed nonce and link the wallet |
| `POST` | `/api/auth/freighter/disconnect` | Unlink the wallet |

### Projects & user data
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/[id]` | One project |
| `POST` | `/api/projects/resolve-id` | Resolve a listing to its on-chain project id |
| `GET` | `/api/user/funds` | A user's funds view |
| `GET` | `/api/user/contributions` | A user's stakes |
| `GET` | `/api/user-by-address` | Resolve one wallet → public profile |
| `POST` | `/api/user-by-addresses` | Resolve many wallets → public profiles |
| `GET`·`PATCH`·`DELETE` | `/api/notifications` | List / mark-read / dismiss own notifications |

### Uploads (session)
| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/upload-image` | Pin listing media to IPFS (Pinata) |
| `POST` | `/api/kyc-document` | Mint a short-lived signed URL for a private KYC document |

### Admin (platform-admin gated)
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/admin/kyc-count` | Pending-KYC count for the dashboard |
| `GET`·`POST` | `/api/admin/platform-settings` | Read / update platform settings |
| `GET` | `/api/health` | Platform health snapshot |

### Machine-to-machine (bearer `INDEXER_SECRET`)
| Method | Route | Purpose |
|---|---|---|
| `GET`·`POST` | `/api/indexer` | Reconcile on-chain state into Supabase |
| `POST` | `/api/ops-funding` | Fire the monthly `fund_operations()` transfer when configured and due |

`Authorization: Bearer <INDEXER_SECRET>` is required on both machine routes; the ops-funding transfer is additionally signed by `OPS_FUNDING_SUBMITTER_SECRET`, a funded gas-payer with **no** owner authority (the call itself is permissionless). Both cleanly no-op when their secrets are unset. Schedule `POST /api/ops-funding` on any cadence — the 30-day gate lives in the contract, so extra calls simply skip.

Exact request and response bodies are defined at each route's source under `src/app/api/`. Validate against the source rather than against this table.

---

## 4. Horizon

Read-only account and transaction data — balances, history, asset metadata — via the Horizon REST API. Used for display and reconciliation, never for authorization decisions (on-chain contract state is the source of truth for anything that matters). The base URL defaults to testnet Horizon and is overridable with `NEXT_PUBLIC_HORIZON_URL`.

---

## Authentication model

- **Supabase Auth** issues the session: email/password and Google OAuth. The session cookie gates every session route and server action.
- **Freighter wallet linking** is a challenge/response bolted onto that session: request a nonce (`/api/auth/freighter/nonce`), sign it in Freighter, verify it (`/api/auth/freighter/verify`). Linking proves control of a key; it does not by itself grant any role.
- **Roles** (`platform_admin`, `kyc_manager`, `project_approver`, owner) come from `app_metadata`, which a user cannot edit, with on-chain state as the source of truth for platform-admin. See [Architecture → Roles](architecture.md#roles--the-four-groups).

## External services

| Service | Used for | Secret |
|---|---|---|
| Pinata (IPFS) | Listing media, pinned so a funding decision's material cannot be swapped | `PINATA_JWT` (server-only) |
| Gemini 2.5 Flash | AI listing-quality review | `GEMINI_API_KEY` (server-only, optional) |
| Supabase Storage | Private KYC documents behind signed URLs | Service role (server-only) |
| Supabase Vault | Managed attestor keys, platform secrets | Service role (server-only) |

No secret is ever prefixed `NEXT_PUBLIC_` — that inlines it into the browser bundle at build time. See the [README](../README.md#environment-variables) for the full variable list.
