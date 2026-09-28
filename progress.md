# BLKFNDR — Progress

_Last updated: 2026-09-28_

Status of the repositioning work and the security-audit remediation. Everything below is merged to `main`. On 2026-09-28 the **treasury and Operations Vault were redeployed** with their audit fixes: the treasury is live, and the Operations Vault cutover is in progress. The open items are that cutover, the remaining **factory + registries redeploy**, one DB migration to apply, and two findings that need a human decision or a tool the agent can't run.

> ⚠️ **Deployment reality — read this first.**
> **The source still carries more fixes than the live testnet does.** Merging a PR does *not* put a contract fix on-chain — a Soroban contract only changes when it is redeployed (or, for the vault, when a *new* vault is created from the repointed factory). Do **not** assume the deployed contracts carry the source fixes. See [Live vs shelf-ready](#live-vs-shelf-ready).

---

## Done

### Positioning & docs — PR #67 (merged)
- Landing page + repo docs repositioned from "crowdfunding" → **a secure on-chain vault for real-world projects**; funding de-emphasised.

### Security audit — delivered
- Full multi-domain audit: 5-agent static review + dynamic VAPT. **Security analysis PDF delivered.**

### Remediation — merged PRs and deploys
| PR | Tier | What | On testnet? |
|----|------|------|-------------|
| #68 | App | Removed unauth `createNotification`; security headers; `platform-settings` auth-order fix | ✅ Live |
| #69 | Contract | Vault **H-02** fund-lock timeout (`settle_stalled`), **M-03** milestone cap, **M-07** `return_bond` CEI; treasury/operations **M-05/M-06** CEI | ✅ Vault live via #71; treasury/ops CEI live via the 2026-09-28 redeploy |
| #70 | DB | KYC `requireKycReviewer` gate (owner \| platform_admin \| kyc_manager); `profiles` write-only column grants | ✅ Code live · ⏳ migration to apply (below) |
| #71 | Deploy | Redeployed hardened **vault** wasm `70e5f3a8`; factory repointed via `update_wasm_hash`; bindings + docs | ✅ Live |
| #72 | Keeper | `settle_stalled` keeper cron (auto-reclaims abandoned funded vaults) | ✅ Live |
| #73 | Contract | Attestation **H-07** (records keyed by vault addr — fixes cross-factory `project_id` collision), **M-04** `disable_factory`; identity **M-02** (TTL re-extend on use + permissionless bumps) | ❌ Shelf-ready |
| #74 | Contract | **H-03**: `initialize` → Soroban `__constructor` on **treasury + operations** | ✅ Live (2026-09-28 redeploy) |
| #75 | Contract | **H-03**: `initialize` → `__constructor` on **factory + attestation + identity + admin**; broke the factory↔attestation deploy cycle; rewrote `scripts/deploy-contracts.sh` | ❌ Shelf-ready |
| — | Deploy | 2026-09-28: redeployed **treasury + Operations Vault** from `main` (#69 CEI + #74 constructors); factory fee wallet repointed to the new treasury | ✅ Treasury live · ⏳ ops cutover |

**H-03 is now fully closed in source** — every contract configures itself in a constructor except the **vault**, which is deployed+initialized atomically inside `create_vault` (no deploy→init gap), so it deliberately keeps `initialize`. The treasury/ops redeploy is the first live proof that constructor-based deploys work on testnet.

---

## Live vs shelf-ready

**Live on testnet (deployed + active):**
- **Vault** hardened wasm `70e5f3a8` — factory repointed to it. *New* projects get H-02/M-03/M-07. **Existing vaults keep their original code (`9c20bca3`) — immutable per project.**
- **Treasury** [`CDA5XDY5…M44COAXU`](https://stellar.expert/explorer/testnet/contract/CDA5XDY564RV2OSZNF2S6CXQYCABFASBOHUCXJEGII6M232VM44COAXU) — redeployed 2026-09-28 with #69 CEI + #74 constructor. The factory routes fees to it ([repoint tx `69e3d4c3…`](https://stellar.expert/explorer/testnet/tx/69e3d4c3cc9ba7adad7ad354d845d524bf7435f9c4c84b608f9b64cbdbc7487e)); the old treasury `CCNID3UW…` was empty and is superseded.
- **App layer** — #68 fixes, #70 KYC-reviewer gate, #72 keeper cron (reuses `OPS_FUNDING_SUBMITTER_SECRET`).

**Deployed, cutover in progress:**
- **Operations Vault** [`CCVXM3YP…NQG7FDSN`](https://stellar.expert/explorer/testnet/contract/CCVXM3YPPEMWG4INHFTZ4NBJ3PQW3ZUNYIZMBJBNYQOMSNOENQG7FDSN) — deployed 2026-09-28 with #69 CEI + #74 constructor, same 3 owners. The app still points at the old vault `CDZXCWKY…` (25 XLM) until the steps in [item 1](#1-operations-vault-cutover-in-progress) are done.

**Shelf-ready in source — NOT yet on testnet** (activates only on a redeploy):
- **factory, attestation, identity, admin** carry un-deployed source changes: H-03 constructors (#75), attestation H-07 + M-04 (#73), identity M-02 (#73). The deployed wasm for these predates all of it.
- Authoritative current hashes come from a fresh `bash scripts/build-contracts.sh`.

> **Verified on-chain 2026-09-28** (read-only, `stellar contract info interface`, addresses from `docs/smart-contracts.md`): the live **factory** and **attestation** still expose `initialize`, and the live attestation still keys `get_record` by `project_id: u64` — so #73 (H-07) and #75 are **not** deployed. The new **treasury** and **Operations Vault** expose `__constructor` and no `initialize`, carry the same shareholders/owners as the contracts they replace, and their on-chain wasm is byte-identical to the audited build (`3dc2b67d…` / `08360ea4…`).

---

## Not yet done

### 1. Operations Vault cutover (in progress)
The new vault is deployed and verified. Three steps remain, **in this order**:
1. **Owners (2-of-3, Freighter):** vote a `Release` of the old vault's 25 XLM to `CCVXM3YP…` — while the app still points at the old vault.
2. **Host:** set `NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID=CCVXM3YPPEMWG4INHFTZ4NBJ3PQW3ZUNYIZMBJBNYQOMSNOENQG7FDSN` and **rebuild** the image (it's a build arg, not runtime). The same rebuild ships the landing page's new contract links. Update local `.env.local` too.
3. **Owners:** vote `SetOpsFunding` on the new treasury → the new vault. The governance panel sends it to the vault named in the app's env, hence after step 2.

### 2. Redeploy the factory + registries (#73 + #75)
Redeploy factory, attestation, identity and admin with `scripts/deploy-contracts.sh` to activate the remaining shelf-ready fixes. Constructor deploys are proven on testnet now, but **#75's deploy order** (attestation before factory, then one post-deploy `add_factory`) is still reasoning-verified and unit-tested only — never run live.
- Redeploy mints **new contract addresses** → update `NEXT_PUBLIC_BLKFNDR_{FACTORY,ATTESTATION,IDENTITY,ADMIN}_CONTRACT_ID`, then **rebuild** — new `NEXT_PUBLIC_*` vars need Docker build args + a rebuild, not just a redeploy.
- **Re-attest existing KYC** into the new identity registry, and re-establish attestation trust.
- **Redeploy the treasury again in the same pass.** Its `factory` is set once by the constructor and no governed action changes it, so after a factory redeploy its factory-policy votes (`SetFee`, `SetWasmHash`, `TransferAdmin`, …) would still target the old factory. The factory in turn takes its fee wallet at construction, so: deploy the factory with an interim fee wallet, deploy the new treasury against it, then `update_fee_wallet` on the new factory. Cheap while the treasury holds no funds.
- Constructor args are passed at deploy time (`stellar contract deploy … -- --admin … --attestation_registry …`); no separate `invoke initialize`.
- On-chain action — needs the deployer key and explicit go-ahead.

### 3. Apply the #70 `profiles` column-grant migration
`supabase/migrations/…profiles_column_grants.sql` must be applied to the live DB via `supabase db push` (owner action). Confirm whether this has been run. Note: `profiles` is now write-only column-granted, so any code path writing it must use column-scoped writes, not PostgREST `.upsert()`.

### 4. M-09 — admin-role enum + migration ordering
`admin_role` enum is missing `platform_admin`, and a migration-timestamp ordering issue breaks a clean `supabase db reset`. **Needs the Supabase CLI**, which isn't available in the agent environment.

### 5. M-01 — contributor Sybil resistance
The 20% contribution cap binds **addresses, not people**. Open **policy decision**: gate contribution on the identity registry (one KYC'd human = one cap)? Needs a product call before implementation.

---

## Suggested next step
Finish the **Operations Vault cutover** (item 1: an owner vote, a host rebuild, another owner vote). Then schedule the **factory + registries redeploy** (item 2) together with the second treasury redeploy against the new factory. Everything else is blocked on a tool (M-09), a product decision (M-01), or a one-command DB push (#70).

_Per-finding detail is in the security-audit PDF; per-PR detail is in the commit/PR history (#67 onward)._
