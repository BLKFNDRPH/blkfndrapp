# API Reference

blkfndr exposes four interaction surfaces. Which one you use depends on whether the operation touches value, whether it needs a signature, and whether it needs privileged data.

| Surface | Use it for | Trust boundary |
|---|---|---|
| **Contract calls** (Soroban RPC) | Anything that holds or moves value: staking, voting, releases, refunds, governance | Signed by the user's own wallet (Freighter), or permissionless once a vote has carried |
| **Server Actions** (`"use server"`) | Privileged reads and writes over Supabase: KYC, moderation, the admin roster, settings, milestone proof | Every export re-authenticates and re-authorizes; arguments are treated as hostile |
| **REST routes** (`/api/*`, `/auth/*`) | Session and wallet linking, listing reads, uploads, notifications, and the machine jobs | Session cookie, a bearer secret for the machine jobs, or public |
| **Horizon** | Account balances, trustlines, account history | Read-only and public |

The rule of thumb: **the money path never goes through the server.** A stake, a milestone vote, a release and a governance proposal are all contract calls that the user, or any permissionless caller, submits directly. The server exists for identity, moderation and convenience reads. Where the server does sign a transaction, the key pays gas and carries no authority over project funds (see [Server-signed transactions](#server-signed-transactions)).

---

## 1. Contract calls (Soroban RPC)

Each contract has a generated TypeScript binding under `src/packages/<contract>/src`. See [Smart Contracts](smart-contracts.md) for every entrypoint.

All clients are built in one place, [src/lib/stellar-clients.ts](../src/lib/stellar-clients.ts):

| Export | What it is |
|---|---|
| `SOROBAN_RPC_URL` | `NEXT_PUBLIC_SOROBAN_RPC_URL`, default `https://soroban-testnet.stellar.org` |
| `HORIZON_URL` | `NEXT_PUBLIC_HORIZON_URL`, default `https://horizon-testnet.stellar.org` |
| `NETWORK_PASSPHRASE` | Hard-coded to `Networks.TESTNET`. A mainnet deployment needs a code change here as well as new URLs |
| `vaultClient(address)` | A project's vault |
| `factoryClient()`, `identityClient()`, `attestationClient()`, `adminClient()`, `operationsClient()` | Fixed addresses from `NEXT_PUBLIC_BLKFNDR_*_CONTRACT_ID`. Each throws a clear error when its variable is unset |
| `treasuryClient(address)` | The fee treasury. Its address is read from the factory (`get_fee_wallet`), never from configuration |
| `simulate(build, label)` | A free read. Returns `null` instead of throwing |

Every client accepts an optional signer `{ publicKey, signTransaction, signAuthEntry }`. Reads need none.

**Reads** are simulations: no signature, no fee.

```ts
import { vaultClient, simulate } from "@/lib/stellar-clients";

const state = await simulate(() => vaultClient(vaultAddress).get_state(), "get_state");
```

**Writes** are built, simulated, signed by the user's wallet, then submitted:

```
build + simulate (the binding) → Freighter signs → sendTransaction → poll getTransaction
```

Browser signing goes through `freighterSigner(publicKey)` in [src/lib/freighter-signer.ts](../src/lib/freighter-signer.ts). It checks Freighter's reply before the SDK reads it:

- A decline, or a request Freighter dropped without a signature, throws `FreighterDeclined` with a readable message.
- A signature from a different account than the one requested is refused before anything is sent.
- It carries `publicKey`, which the bindings use as the transaction's source account.

The wallet used for these calls is the one linked to the account (`stellarPublicKey` from `/api/auth/session`), or Freighter's active account when none is linked.

Governance proposals take an action encoded as the binding's discriminated union, `{ tag: "SetOpsFunding", values: [...] }`. The `{ SetOpsFunding: ... }` shorthand is rejected by the contract spec. The treasury's proposal entrypoints are `propose` / `approve_proposal` / `execute_proposal`; the Operations Vault's are `propose` / `approve` / `execute`.

### Permissionless entrypoints

These take no authorizing caller. A carried vote, an elapsed window or a time gate is the authority, so anyone may submit them.

| Contract | Entrypoint | Condition |
|---|---|---|
| `blkfndr-vault` | `release_milestone` | The vote has carried |
| | `settle_lapsed_milestone` | The window closed without carrying |
| | `settle_stalled` | 90 days since funding or the last release, and no vote window currently open |
| | `settle` | Persists a pending lifecycle transition (deadline passed) |
| | `return_bond` | The raise failed to fund |
| `blkfndr-treasury` | `fund_operations` | Ops funding is set, 30 days since the last top-up, no distribution cycle mid-vote |
| | `execute_proposal`, `settle_lapsed_cycle` | A carried proposal; a cycle that closed below threshold |
| `blkfndr-operations` | `execute` | A carried proposal |

The vault rule these follow is in [Smart Contracts](smart-contracts.md). That page also lists which vaults run which rule: projects created since 2026-10-06 run the current source (`e9009410…`), with the #99 release rule and the money majority, and older projects keep the code they were created with.

### Server-signed transactions

The server signs in exactly two capacities. Neither key can move a project's funds.

| Key | Where it lives | What it signs |
|---|---|---|
| A KYC attestor's managed key | Supabase Vault, read by the service role only ([src/lib/managed-wallet.ts](../src/lib/managed-wallet.ts)) | `attest` and `revoke` on `blkfndr-identity`; the sweep of its own gas back to the Operations Vault on removal |
| `OPS_FUNDING_SUBMITTER_SECRET` | Host environment | `fund_operations`, `settle_stalled`, and `RestoreFootprint` / `ExtendFootprintTTL`. It pays the fee; the call's authority is the contract's own rule |

### Raw ledger reads

A few reads bypass the bindings:

- [src/lib/factory-vault-hash.ts](../src/lib/factory-vault-hash.ts) reads `VaultWasmHash` straight out of the factory's instance storage with `getLedgerEntries`. The factory has no getter for it.
- [src/lib/ttl-keeper.ts](../src/lib/ttl-keeper.ts) reads the live-until ledger of each shared instance and code entry.
- [src/lib/vault-deploy-guard.ts](../src/lib/vault-deploy-guard.ts) reads the factory's project count, `get_vault` and each vault's `get_info` to find an earlier launch of the same draft.
- [src/lib/bond-readiness.ts](../src/lib/bond-readiness.ts) simulates `name()` and `balance(address)` on a token contract directly (`bondAssetFor`, `tokenBalance`). The stake dialog reads the vault's `get_info().token`, then `tokenBalance`, so the balance it shows is the exact asset a stake moves, not the first Horizon line called USDC. A refusal is classified from the host's text: "trustline entry is missing" (no trustline, or no account, which `getAccount` then tells apart) and "account entry is missing" (no account). Anything else reads as unknown and does not block the stake.

---

## 2. Server Actions

Every exported async function in a `"use server"` file is a public HTTP endpoint, reachable by its action id whether or not a component calls it. Each one re-authenticates the caller, re-authorizes against their role and validates its arguments. The wrappers in `src/actions/` mostly add no authorization of their own; the guard sits in the data-access layer (`src/lib/data/`) and in the database underneath it.

### Guards

| Guard | Passes | Defined in |
|---|---|---|
| `requireCaller()` | Any signed-in user. Verifies the JWT with `getClaims()`, never `getSession()` | [src/lib/supabase/auth.ts](../src/lib/supabase/auth.ts) |
| `requireAdmin()` | Anyone on the `platform_admins` roster, in any role. The role is read fresh with `my_role()` on every call | same |
| `requireKycReviewer()` | Roster role `owner`, `platform_admin` or `kyc_manager` | same |
| `requireWalletOwnerOrAdmin(address)` | The caller whose linked wallet is `address`, or any roster member | [src/lib/auth/guards.ts](../src/lib/auth/guards.ts) |
| `is_owner()` | Roster role `owner` | Postgres |
| `has_admin_role(r)` | Roster role `r`, or an owner (owners hold every capability) | Postgres |
| `can_restrict_projects()` | `owner`, `platform_admin` or `project_approver` | Postgres |

"Any admin" below means `requireAdmin`: every roster role, including `kyc_manager`, `project_approver` and `accountant`.

### [src/app/actions.ts](../src/app/actions.ts)

| Action | Who may call | What it does |
|---|---|---|
| `runImproveListingQuality(input)` | Signed in | Runs the Genkit listing review (Gemini 2.5 Flash). Returns `{ suggestions[], flags[], overallQualityScore }`, or `null` when signed out, when the model fails, or without `GEMINI_API_KEY` |
| `submitKycRequest(input)` | Signed in | Files or resubmits the caller's own KYC, through their own session. The address must be the caller's linked wallet. An approved check cannot be resubmitted, and a resubmission cannot change the address |
| `getMyKycStatus()` | Signed in | The caller's own status fields |
| `getKycRequests(status?)` | KYC reviewer | The review queue, without identity fields |
| `getKycSubmission(id)` | KYC reviewer | One full record plus a 5-minute signed URL to the document |
| `updateKycRequestStatus(id, status, reason?)` | KYC reviewer | Records approve/reject in the database and notifies the applicant. Writes nothing on chain |
| `attestKycAction(id)` | KYC reviewer holding a managed key | Signs `attest` on chain with the reviewer's managed key, then records the approval and notifies the applicant |
| `revokeKycAction(id)` | KYC reviewer holding a managed key | Signs `revoke` on chain, then records a rejection |
| `getMyManagedAttestorAction()` | KYC reviewer (others get `null`) | The managed attestor address the platform holds for the caller |
| `triggerIndexerSync()` | Any admin | Runs one indexer pass. The client calls it after every transaction (`refreshAfterTx`); for anyone not on the roster it returns `{ success: false }` and the change waits for the next scheduled pass |
| `submitMilestoneProof(vault, milestoneId, proof)` | The vault's builder (linked wallet equals the vault's `creator`), or any admin | See below |

`submitMilestoneProof` decides from the live vault, not the indexed copy. It reads `readVaultState(vault)`, then accepts proof only while the vault is `funded` or `active` and the milestone is neither released nor failed. Proof is a JSON document of at most 4,000 characters; the project dialog ([MilestoneProof.tsx](../src/components/project/MilestoneProof.tsx)) also limits the description to 2,000 characters and a photo to PNG, JPEG, WebP or GIF of 8 MB or less. The write goes through the service role, and a database trigger refuses it while the project is locked. On success it notifies the admins who look after projects.

`notify` is deliberately not exported as an action. It is a service-role insert with no authorization, so exposing it would let anyone message any user.

### [src/app/auth/actions.ts](../src/app/auth/actions.ts)

All public. Form fields are validated with zod, and any `next` path is checked to be internal before it is followed.

| Action | What it does |
|---|---|
| `signUpWithPassword(formData)` | Name, email, password (12–72 characters). Redirects to `/login?checkEmail=1`. One error message for every failure, so it cannot enumerate accounts |
| `signInWithPassword(formData)` | Redirects to a validated internal `next` path |
| `signInWithGoogle(formData)` | Starts the OAuth flow. `next` travels in a short-lived cookie, not on the URL |
| `requestPasswordReset(formData)` | Sends a recovery link. Same answer whether or not the address exists. Kept on purpose; no screen calls it yet |
| `signOut()` | Ends the session and redirects to `/` |

### [src/app/settings/actions.ts](../src/app/settings/actions.ts)

| Action | Who may call | What it does |
|---|---|---|
| `updateUserDisplayName(newName)` | Signed in | Updates the caller's own display name (1–80 characters). RLS confines the write to their row |

### [src/actions/admins.ts](../src/actions/admins.ts)

| Action | Who may call | What it does |
|---|---|---|
| `getAdminsAction()` | Any admin | The roster |
| `getMyRoleAction()` | Anyone | The caller's roster role, or `null` |
| `grantAdminAction(email, wallet?, name?, role?, note?)` | Owner (RLS on `platform_admins`) | Adds a roster row. For `kyc_manager` it also generates, stores and (on testnet) Friendbot-funds a managed attestor key, and rolls the row back if that fails. Writes nothing on chain: appointing the key on `blkfndr-identity` is a separate owner-signed step |
| `revokeAdminAction(email)` | Owner (checked in code before any side effect, and by RLS) | Sweeps a managed key's gas to the Operations Vault, deletes the key, then deletes the row. Nobody can remove themselves or the last admin |
| `recognizeWalletAction(address)` | Any admin | Whether the connected wallet is on the roster, is the caller's own, or differs from the one on file |
| `getAdminAuditLogAction()` | Any admin | The last 100 audit entries. Kept on purpose; no screen calls it yet |

### [src/actions/moderation.ts](../src/actions/moderation.ts)

All require `has_admin_role('platform_admin')`, that is a platform administrator or an owner. Writes go through the caller's session, so RLS enforces the same rule.

| Action | What it does |
|---|---|
| `getUsersAction()` | Every profile with its ban state |
| `banUserAction(userId, reason)` | Records the ban (hides the user's listings through RLS) and sets the Supabase Auth ban (blocks sign-in) |
| `unbanUserAction(userId)` | Lifts both |
| `getHealthAction()` | Counts of users, projects, pending KYC, bans and events, plus the indexer cursor and when it last moved |

### [src/actions/project-moderation.ts](../src/actions/project-moderation.ts)

Listing approval by owner consensus. Each passes `requireAdmin` in code; RLS then narrows it.

| Action | Who may call | What it does |
|---|---|---|
| `flagProjectAction(projectId, reason?)` | Project administrator or owner (RLS) | Puts a listing under review, which hides it from the public until decided. Kept on purpose; no screen calls it yet |
| `voteOnProjectAction(projectId, approve)` | Owner (RLS) | Casts or changes the caller's vote. A trigger settles the review at two-thirds of owners |
| `clearModerationAction(projectId)` | Project administrator or owner (RLS) | Removes the review |
| `getModerationAction(projectId)` | Anyone | The review state. Signed-in callers also get the tally and their own vote |
| `getPendingReviewsAction()` | Any admin | Every listing awaiting a decision |

### [src/actions/project-restrictions.ts](../src/actions/project-restrictions.ts)

| Action | Who may call | What it does |
|---|---|---|
| `setProjectHiddenAction(vault, hidden, reason?)` | Owner, platform administrator or project administrator, enforced by `set_project_hidden` in Postgres | Hides or unhides a listing. A reason is required to hide. Audit-logged; the builder is notified |
| `setProjectLockedAction(vault, locked, reason?)` | Same, via `set_project_locked` | Locks or unlocks a project. A reason is required to lock. Audit-logged; the builder is notified |
| `checkVaultLockAction(vault)` | Anyone | `{ locked: true \| false \| null }`. `null` means the question could not be answered |

### [src/actions/secrets.ts](../src/actions/secrets.ts)

| Action | Who may call | What it does |
|---|---|---|
| `getSecretStatusAction()` | Owner (others get an empty list) | Which platform secrets are set, never their values |
| `setPlatformSecretAction(name, value)` | Owner, enforced by `set_platform_secret` | Writes `pinata_jwt` or `resend_api_key` to Supabase Vault. Only the service role can read a value back |

### [src/actions/categories.ts](../src/actions/categories.ts)

| Action | Who may call | What it does |
|---|---|---|
| `getCategoriesAction()` | Anyone | The listing categories |
| `addCategoryAction(name)`, `removeCategoryAction(name)` | Any admin | Edits the list. Removing one does not change existing listings |

### [src/actions/feature-requests.ts](../src/actions/feature-requests.ts)

The community roadmap.

| Action | Who may call | What it does |
|---|---|---|
| `getFeatureRequestsAction()` | Anyone | Requests with upvote counts. Signed-in callers see their own upvotes |
| `submitFeatureRequestAction(title, body)` | Signed in | Files a request in the caller's name |
| `toggleUpvoteAction(requestId, upvote)` | Signed in | Adds or removes the caller's upvote |
| `decideFeatureRequestAction(requestId, approve)` | Owner (RLS) | Casts an owner decision. Two-thirds moves it to planned or declined |
| `respondToFeatureRequestAction(requestId, response, status?)` | Any admin | Sets the public response or status. Kept on purpose; no screen calls it yet |

---

## 3. REST routes

Route handlers live under `src/app/api/` and `src/app/auth/`. Signed-in routes read the Supabase session cookie and fail with `401` (no session) or `403` (wrong role) as `{ "error": "..." }`. No route is statically cached. Only `/api/vault-wasm-hash` holds a short in-memory cache.

### Sign-in and session

| Method | Route | Auth | Request | Response |
|---|---|---|---|---|
| `GET` | `/api/auth/session` | None | — | `{}` when signed out, else `{ user: { uid, email, name, creatorAvatar, role, wallet, stellarPublicKey } }`. `role` is `"admin"` for any roster member, else `"user"`. `wallet` is `"connected"` or `"disconnected"` |
| `POST` | `/api/auth/logout` | Session | — | `{ success: true }` |
| `POST` | `/api/auth/freighter/nonce` | Signed in | `{ publicKey }` | `{ nonce }`: 32 random bytes as hex, valid 5 minutes, one per address |
| `POST` | `/api/auth/freighter/verify` | Signed in | `{ publicKey, signature, nonce }`. `signature` is base64 or a byte array, over SHA-256 of `"Stellar Signed Message:\n" + nonce` | `{ success: true }` and the wallet is linked. `401` for an unknown, expired or mismatched challenge or a bad signature; `403` if another account already links that wallet. The nonce is burned before the signature is checked |
| `POST` | `/api/auth/freighter/disconnect` | Signed in | — | `{ success: true }`. Clears the linked wallet |
| `GET` | `/auth/callback` | None | `?code=` from the OAuth provider | Exchanges the PKCE code for a session and redirects to the remembered `next` path. Failures redirect to `/login?error=Provider`, `NoCode` or `Exchange` |
| `GET` | `/auth/confirm` | None | `?token_hash=&type=` from an email link | Verifies the one-time token. Recovery goes to `/settings`, everything else to `/profile`. Failures redirect to `/login?error=InvalidLink` or `LinkExpired` |

Linking a wallet writes `profiles.stellar_public_key` with the service role, after the signature check. The browser holds no write grant on that column (`20261007100549_profiles_column_grants`, applied 2026-10-07).

### Listings and user data

| Method | Route | Auth | Request | Response |
|---|---|---|---|---|
| `GET` | `/api/projects` | None | — | `Project[]`, newest first. RLS picks the set: the public gets public listings; the builder, a stakeholder or an admin also gets hidden ones, each marked `restriction.hidden`. `500` returns `[]` |
| `GET` | `/api/projects/[id]` | None | `id` is the on-chain project id | One `Project` with its `restriction`, or `404` |
| `GET` | `/api/vault-wasm-hash` | None | — | `{ hash, factory }`: the vault wasm hash the factory deploys new projects from, read live. Cached 5 minutes per server process. `502` if the factory cannot be read |
| `GET` | `/api/user/contributions` | Signed in | `?address=G…&projectId=` | `{ success, contributedVaults: string[], hasContributed }` |
| `GET` | `/api/user/funds` | Signed in | `?address=G…` (optional) | Stake receipts from indexed `DEPOSIT/CONTRIB` events: `[{ fund_id, project_id, contributor, amount, usdc_amount, share_percentage, fee_paid, fund_date, vault_address }]`. Without `address`, the 500 most recent on the platform. `usdc_amount` repeats `amount` whatever the asset, and `share_percentage` and `fee_paid` are always `"0"`: legacy fields kept for the client |
| `GET` | `/api/user-by-address` | Signed in | `?address=G…` | The public profile linked to that wallet (`id, display_name, avatar_url, stellar_public_key, wallet_status`), or `null` |
| `POST` | `/api/user-by-addresses` | Signed in | `{ addresses: string[] }` | `{ [address]: profile }`. Invalid addresses are dropped; at most 200 are looked up |
| `GET` | `/api/notifications` | Signed in | — | Up to 200 of the caller's notifications, newest first: `[{ id, userId, title, caption, timestamp, isRead, url, object }]`. `object` is the project row id |
| `PATCH` | `/api/notifications` | Signed in | `{ ids: uuid[] }`, at most 200 | `{ success: true }`. Marks them read |
| `DELETE` | `/api/notifications` | Signed in | `?id=<uuid>` or `?all=true` | `{ success: true }`. Dismisses one or all |

The two profile lookups are signed-in only because contributor addresses are public on the ledger; anonymous access would make them a deanonymization oracle. Every notifications handler runs through the caller's own session, so RLS, not a filter in the route, confines it to their rows.

### Uploads

| Method | Route | Auth | Request | Response |
|---|---|---|---|---|
| `POST` | `/api/upload-image` | Signed in | Multipart `file`, at most 8 MB. PNG, JPEG, WebP, GIF, SVG or JSON, checked against the actual bytes (JSON must parse) | `{ cid }`. Pins to Pinata with the JWT from Supabase Vault (`pinata_jwt`), falling back to `PINATA_JWT`, into group `PINATA_GROUP_BLKDFNDR` if set. Used for listing images, listing metadata and milestone proof photos |
| `POST` | `/api/kyc-document` | Signed in | Multipart `file`, at most 10 MB. PNG, JPEG, WebP or PDF, checked against the bytes | `{ path }`: `<user id>/document-<timestamp>.<ext>` in the private `kyc-documents` bucket. The prefix comes from the session, never the request. Each upload gets a new path, so earlier uploads stay in the bucket. Never sent to IPFS. Reviewers reach it only through a 5-minute signed URL |

### Admin

| Method | Route | Auth | Request | Response |
|---|---|---|---|---|
| `GET` | `/api/admin/kyc-count` | Any admin | — | `{ count }` of pending KYC submissions |
| `GET` | `/api/admin/platform-settings` | Any admin | — | `{ feeWalletEmail }` |
| `POST` | `/api/admin/platform-settings` | Any admin | `{ feeWalletEmail }` (a valid email) | `{ success: true }` |

### Health

| Method | Route | Auth | Response |
|---|---|---|---|
| `GET` | `/api/health` | None | `{ status: "ok", timestamp }`. A liveness check only; the Docker healthcheck calls it. The platform-health view in the console is `getHealthAction` |

### Machine jobs (bearer `INDEXER_SECRET`)

| Method | Route | Calls | Response |
|---|---|---|---|
| `GET`, `POST` | `/api/indexer` | `runIndexer()` in [src/lib/event-indexer.ts](../src/lib/event-indexer.ts) | `{ success, count, failed, currentLedger, metadata, creatorsNamed }`. `success` is false when an event handler failed |
| `POST` | `/api/ops-funding` | `triggerOpsFunding()` in [src/lib/ops-funding.ts](../src/lib/ops-funding.ts) | `{ success: true, status: "funded" \| "skipped", detail, amount? }` |
| `POST` | `/api/settle-stalled` | `triggerSettleStalled()` in [src/lib/settle-stalled.ts](../src/lib/settle-stalled.ts) | `{ success: true, status: "done" \| "skipped", detail, reclaimed, checked, vaults? }` |
| `POST` | `/api/keep-alive` | `runKeepAlive()` in [src/lib/ttl-keeper.ts](../src/lib/ttl-keeper.ts). Body `{ "dryRun": true }` reports what is due and its simulated cost without sending | `{ success: true, status: "done" \| "skipped" \| "dry-run", detail, entries[], restored, extended, feeXlm }` |

Every machine route requires `Authorization: Bearer <INDEXER_SECRET>`, compared in constant time. With `INDEXER_SECRET` unset, every request is refused. An unexpected error returns `500` with `{ success: false, error }`.

The three that transact are signed by `OPS_FUNDING_SUBMITTER_SECRET`, a funded account with no owner authority, since each call is permissionless. Without it they return a skip, except a keep-alive dry run, which only simulates. The gates live in the contracts or in the TTLs, so any schedule is safe: an extra call skips. The compose stack calls them on a timer; see [Architecture](architecture.md#scheduled-jobs).

---

## 4. Horizon

Horizon serves read-only account data. It is used for display and pre-flight checks, never for an authorization decision. The base URL is `HORIZON_URL` (testnet unless `NEXT_PUBLIC_HORIZON_URL` is set), and the calls run in the browser through `horizonClient` in [src/lib/stellar.ts](../src/lib/stellar.ts).

| Function | Horizon call | Used by |
|---|---|---|
| `getAccountInfo(address)`, `getBalance(address)` | `loadAccount` (`/accounts/{id}`). A `404` reads as an empty native balance | Balances in the profile view. The stake dialog reads the vault token's `balance()` instead (see [Raw ledger reads](#raw-ledger-reads)) |
| `getRecentAccountOperations(address, limit)` | `/accounts/{id}/operations`, newest first, failed transactions included | The profile's Recent Activity. Each record is labelled ("Fund vault", "Open milestone vote", "Payment") with its net change per asset. `/payments` is not enough: it drops contract calls that moved no tokens |
| `checkBondReadiness(...)` in [src/lib/bond-readiness.ts](../src/lib/bond-readiness.ts) | `loadAccount` | The launch pre-flight: no account, no trustline, or a balance below the bond |

`checkIsAdminOnChain` in the same file reads the `blkfndr-admin` roster over Soroban RPC, not Horizon.

---

## 5. IPFS (Pinata)

Pinning goes through `/api/upload-image`. Reading has two paths:

- **The browser** renders `getIPFSGatewayUrl(cid)`: `https://gateway.pinata.cloud/ipfs/<cid>`, or an absolute URL passed through unchanged for older records.
- **The server** (the indexer) uses `getIPFSFetchUrls(cid)` in [src/lib/pinata-client.ts](../src/lib/pinata-client.ts). It accepts only a bare CIDv0 or CIDv1, never a URL, because the value comes from an on-chain event any builder controls. It tries the dedicated gateway from `PINATA_GATEWAY_URL` first, then `gateway.pinata.cloud`. Each fetch times out after 8 seconds, and a body over 256 KB is ignored.

The dedicated gateway gets `PINATA_GATEWAY_KEY` as an `x-pinata-gateway-token` header. The shared gateway never does. Redirects are not followed (`redirect: "manual"`), so the key cannot be carried to another host, and a 3xx counts as a refusal. Without the key the dedicated gateway answers `401` for this account's pins, and reads fall back to the shared gateway, which rate-limits.

---

## Authentication model

- **Supabase Auth** issues the session: email and password, or Google OAuth with PKCE. The cookie gates every signed-in route and server action. [src/proxy.ts](../src/proxy.ts) only refreshes the session; it is not a security boundary.
- **Wallet linking** is a challenge-response on top of that session: `/api/auth/freighter/nonce`, a Freighter signature, then `/api/auth/freighter/verify`. Linking proves control of a key. It grants no role.
- **Roles** come from the `platform_admins` table, asked fresh on every request (`my_role()`, `is_admin()`, `is_owner()`, `has_admin_role()`). They are not read from a token claim. See [Architecture → Roles](architecture.md#roles).

## External services

| Service | Used for | Secret |
|---|---|---|
| Pinata (IPFS) | Listing images and metadata, milestone proof photos | `pinata_jwt` in Supabase Vault, or `PINATA_JWT` (server-only) |
| Gemini 2.5 Flash (Genkit) | AI listing review | `GEMINI_API_KEY` (server-only, optional) |
| Supabase Storage | Private KYC documents behind signed URLs | Service role (`SUPABASE_SECRET_KEY`, server-only) |
| Supabase Vault | Managed attestor keys, platform secrets | Service role (server-only) |
| Friendbot (testnet only) | Funding a newly generated attestor key | None |

No secret is ever prefixed `NEXT_PUBLIC_`; that prefix inlines a value into the browser bundle at build time. See the [README](../README.md#environment-variables) for the full variable list.
