# BLKFNDR — Progress

_Last updated: 2026-09-28_

Status of the repositioning work and the security-audit remediation. Everything through PR **#75** is merged to `main`; the open items are a coordinated contract **redeploy**, one DB migration to apply, and two findings that need a human decision or a tool the agent can't run.

> ⚠️ **Deployment reality — read this first.**
> **The source now carries more fixes than the live testnet does.** Merging a PR does *not* put a contract fix on-chain — a Soroban contract only changes when it is redeployed (or, for the vault, when a *new* vault is created from the repointed factory). Do **not** assume the deployed contracts carry the source fixes. See [Live vs shelf-ready](#live-vs-shelf-ready).

---

## Done

### Positioning & docs — PR #67 (merged)
- Landing page + repo docs repositioned from "crowdfunding" → **a secure on-chain vault for real-world projects**; funding de-emphasised.

### Security audit — delivered
- Full multi-domain audit: 5-agent static review + dynamic VAPT. **Security analysis PDF delivered.**

### Remediation — merged PRs
| PR | Tier | What | On testnet? |
|----|------|------|-------------|
| #68 | App | Removed unauth `createNotification`; security headers; `platform-settings` auth-order fix | ✅ Live |
| #69 | Contract | Vault **H-02** fund-lock timeout (`settle_stalled`), **M-03** milestone cap, **M-07** `return_bond` CEI; treasury/operations **M-05/M-06** CEI | ⚠️ Vault live via #71; treasury/ops CEI **not** redeployed |
| #70 | DB | KYC `requireKycReviewer` gate (owner \| platform_admin \| kyc_manager); `profiles` write-only column grants | ✅ Code live · ⏳ migration to apply (below) |
| #71 | Deploy | Redeployed hardened **vault** wasm `70e5f3a8`; factory repointed via `update_wasm_hash`; bindings + docs | ✅ Live |
| #72 | Keeper | `settle_stalled` keeper cron (auto-reclaims abandoned funded vaults) | ✅ Live |
| #73 | Contract | Attestation **H-07** (records keyed by vault addr — fixes cross-factory `project_id` collision), **M-04** `disable_factory`; identity **M-02** (TTL re-extend on use + permissionless bumps) | ❌ Shelf-ready |
| #74 | Contract | **H-03**: `initialize` → Soroban `__constructor` on **treasury + operations** | ❌ Shelf-ready |
| #75 | Contract | **H-03**: `initialize` → `__constructor` on **factory + attestation + identity + admin**; broke the factory↔attestation deploy cycle; rewrote `scripts/deploy-contracts.sh` | ❌ Shelf-ready |

**H-03 is now fully closed in source** — every contract configures itself in a constructor except the **vault**, which is deployed+initialized atomically inside `create_vault` (no deploy→init gap), so it deliberately keeps `initialize`.

---

## Live vs shelf-ready

**Live on testnet (deployed + active):**
- **Vault** hardened wasm `70e5f3a8` — factory repointed to it. *New* projects get H-02/M-03/M-07. **Existing vaults keep their original code (`9c20bca3`) — immutable per project.**
- **App layer** — #68 fixes, #70 KYC-reviewer gate, #72 keeper cron (reuses `OPS_FUNDING_SUBMITTER_SECRET`).

**Shelf-ready in source — NOT yet on testnet** (activates only on a redeploy):
- **factory, attestation, identity, admin, treasury, operations** all carry un-deployed source changes: H-03 constructors (#74/#75), attestation H-07 + M-04 (#73), identity M-02 (#73), treasury/operations CEI M-05/M-06 (#69). The deployed wasm for these predates all of it.
- Authoritative current hashes come from a fresh `bash scripts/build-contracts.sh` — the older per-finding hashes are now superseded by the constructor work.

> **Verified on-chain 2026-09-28** (read-only, `stellar contract info interface`, addresses from `docs/smart-contracts.md`): the live **factory**, **treasury**, and **attestation** contracts all still expose `initialize`, and the live attestation still keys `get_record` by `project_id: u64`. So #73 (H-07), #74, and #75 are confirmed **not** deployed.

---

## Not yet done

### 1. Coordinated contract redeploy _(biggest open item)_
Redeploy the full contract set with `scripts/deploy-contracts.sh` to activate every shelf-ready fix at once. This is also the **live-verification gap**: the deploy-order rewrite in #75 (attestation deployed before factory, then one post-deploy `add_factory`) is **reasoning-verified and covered by the factory deployment unit test, but has not been run against live testnet.**
- Redeploy mints **new contract addresses** → update `NEXT_PUBLIC_BLKFNDR_{FACTORY,ATTESTATION,IDENTITY,ADMIN}_CONTRACT_ID`, then **rebuild** — new `NEXT_PUBLIC_*` vars need Docker build args + a rebuild, not just a redeploy.
- **Re-attest existing KYC** into the new identity registry, and re-establish attestation trust.
- Constructor args are passed at deploy time (`stellar contract deploy … -- --admin … --attestation_registry …`); no separate `invoke initialize`.
- On-chain action — needs the deployer key and explicit go-ahead.

### 2. Apply the #70 `profiles` column-grant migration
`supabase/migrations/…profiles_column_grants.sql` must be applied to the live DB via `supabase db push` (owner action). Confirm whether this has been run. Note: `profiles` is now write-only column-granted, so any code path writing it must use column-scoped writes, not PostgREST `.upsert()`.

### 3. M-09 — admin-role enum + migration ordering
`admin_role` enum is missing `platform_admin`, and a migration-timestamp ordering issue breaks a clean `supabase db reset`. **Needs the Supabase CLI**, which isn't available in the agent environment.

### 4. M-01 — contributor Sybil resistance
The 20% contribution cap binds **addresses, not people**. Open **policy decision**: gate contribution on the identity registry (one KYC'd human = one cap)? Needs a product call before implementation.

---

## Suggested next step
Do a full **testnet redeploy** (item 1). It activates six contracts' worth of shelf-ready fixes in one pass and closes the only remaining H-03 verification gap. Everything else is either blocked on a tool (M-09), a product decision (M-01), or a one-command DB push (#70).

_Per-finding detail is in the security-audit PDF; per-PR detail is in the commit/PR history (#67–#75)._
