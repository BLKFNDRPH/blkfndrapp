# BLKFNDR — Progress

_Last updated: 2026-10-03 · `main` at #104_

Where the platform stands: what is live on testnet, what is merged but not yet active, and what is still open. It covers:
- the repositioning (#67)
- the security-audit remediation (#68–#75)
- the treasury and Operations Vault redeploy (#77)
- the QA trials and launch hardening (#79–#86)
- the indexer, governance, proof and stake-flow work since (#85–#104)

> ⚠️ **Merged is not deployed.**
> A Soroban contract only changes when it is redeployed. A vault change reaches only vaults the factory creates after it is repointed with `update_wasm_hash`. **The source carries contract fixes the testnet does not**, including the new vault release rule (#99). See [Live vs shelf-ready](#live-vs-shelf-ready).

---

## Snapshot — verified on testnet, 2026-10-02

Read-only checks, not inferred from merges: the deployed `/_next/static` bundle, the live Supabase project (`eqnheftmstapthlblpbx`), Supabase edge logs, and `stellar contract invoke --send=no`.

| Area | State |
|---|---|
| **App** | ✅ The host runs `main` through at least #103. The deployed bundle contains #102 and #103, and its Operations Vault address is `CCVXM3YP…`. #104 is server-only, so the bundle can't show whether it is deployed |
| **Google sign-in** | ✅ Fixed on the host. Since 2026-10-01 its redirects use `https://`, and the PKCE exchanges complete |
| **Indexer** | ✅ Current. The cursor was updated 2026-10-02, and all 7 live projects carry their real titles except the three test rows (#1–3) |
| **Vault release rule (#99) and money majority** | ✅ Live for new projects since 2026-10-06. The factory deploys vault wasm `e9009410…`, as `/api/vault-wasm-hash` confirms ([item 2](#2-switch-the-factory-to-the-99-vault-wasm)) |
| **Operations Vault cutover** | ⚠️ Half done. The app points at the new vault, but the old one still holds 25 XLM, the new one 0, and the treasury's ops funding is unset |
| **`profiles` column grants (#70)** | ❌ Not applied. `authenticated` can still `UPDATE profiles.stellar_public_key` |
| **KYC linked-wallet policy (#89)** | ❌ Not applied, and it has to follow the grants above |
| **Project hide/lock (#85)** | ✅ Migration applied, 4 restrictions in use |
| **IPFS reads** | ⏳ #104 (merged 2026-10-02) sends the Pinata Gateway Key, but it only helps once the host runs #104 and has `PINATA_GATEWAY_KEY` set ([item 3b](#3b-set-pinata_gateway_key-on-the-host)). Until then the dedicated gateway refuses (401) and reads fall back to the rate-limited shared gateway |

---

## Done

### Since 2026-09-28 (#76–#104)

Every app-layer change below is live, because the host was rebuilt from `main`. The exceptions are marked.

| PR | Area | What changed | Live? |
|----|------|--------------|-------|
| #76, #77 | Docs / deploy | This tracker. Treasury and Operations Vault references moved to the 2026-09-28 redeploy | ✅ |
| #78 | Auth | `/login` reads `?checkEmail=1` and `?error=`, so new email users are no longer told "Login failed". A log line warns when the configured origin is plain `http://` | ✅ |
| #79 | KYC | The applicant is notified of the decision, and rejections carry the reviewer's reason. The bell toasts any newly arrived notification | ✅ |
| #80 | Launch | Bond pre-flight. A missing USDC trustline, an insufficient balance or an unfunded wallet each get their own instructions, instead of `VM call trapped` | ✅ |
| #81, #82 | UI | The Launch button holds its size and shows a visible spinner. The header and pages share one width rule | ✅ |
| #83 | Launch | Launch no longer fails silently. Validation runs through zod plus an explicit milestone check, and a blocked launch lists what to fix | ✅ |
| #84, #93 | Signing | One shared `freighterSigner` that checks Freighter's reply, names a decline as "Signing cancelled", and builds every transaction from the signer's own account. Before #93, every `signerFor` action (stake, vote, release, refund, treasury) failed before Freighter opened | ✅ |
| #85 | Moderation | Platform-level **hide** and **lock**, which need a reason and are audit-logged. Enforced in Postgres (RPCs, RLS, a proof trigger) and in the app. A lock binds this interface, never the vault. It also fixed an indexer bug that would have re-keyed hidden projects | ✅ Migration applied |
| #86 | Launch / ops | **QA Trial #3.** The `keep-alive-cron` keeps shared contract storage from expiring, which cut the launch fee from 172.83 to 5.88 XLM. Also a review dialog with the simulated fee, a duplicate-launch guard, and recovery when a launch was sent but never confirmed | ✅ |
| #87 | Data | Project reads now select `location`, `location_lat` and `location_lng` | ✅ |
| #88 | Admin | "Is this an admin" comes from the `platform_admins` roster. `notifyAdmins` notifies roster members | ✅ |
| #89 | Wallet / KYC | The linked wallet comes from the session, and Freighter is no longer snapped back to it. The signer must match the requested account. A failed unlink is reported. KYC can be filed only against the linked wallet | ✅ Code · ⏳ migration `20261001160000` |
| #90 | Indexer | Follows the RPC cursor through quiet 10,000-ledger windows, and restarts at the oldest retained ledger instead of skipping a gap | ✅ |
| #91, #104 | Indexer / IPFS | Falls back from the dedicated gateway to `gateway.pinata.cloud`, and retries projects still titled "Project #N". #91's Gateway Key commit was pushed after its merge. #104 landed it: `PINATA_GATEWAY_KEY` goes to the dedicated gateway only, and redirects are not followed, so the key cannot leak | ✅ #91 · ⏳ #104 needs the host env var |
| #92, #94 | Profiles | Creator and backer names and photos come from the linked profile. The indexer fills `creator_display`, and syncs no longer reset titles | ✅ |
| #95 | Cleanup | Removed 52 unreachable files, Firebase config, the image allowlist, two unread env vars and 13 npm packages. The unwired entry points were kept (see [item 7](#7-unwired-features--wire-up-or-delete)) | ✅ |
| #96 | Profile | Recent Activity reads Horizon `/operations` and labels contract calls ("Fund vault", "Open milestone vote") with signed amounts | ✅ |
| #97, #103 | Milestones | Each milestone shows its own proof (description and photo) in the project dialog. The builder adds or edits proof per milestone, and the server decides from the live vault (funded or active, milestone not released or failed). Proof is capped at 4,000 characters, photos at 8 MB (PNG, JPEG, WebP, GIF) | ✅ |
| #98 | Admin | **View Vault** shows the real release authority (contributor vote, no admin key) and the flat fee | ✅ |
| #99 | **Contract** | **Release rule.** A release needs more than half of the *capped* total, from at least three wallets (or every backer when there are fewer than three). The homepage reads the vault hash live from the factory. The PR's last commit (`d212b37`: `settle_stalled` sparing approved milestones, the cap floor, +5 tests) was pushed after the merge and landed on `main` separately on 2026-10-03. Vault tests on `main`: 52 ([item 2](#2-switch-the-factory-to-the-99-vault-wasm)) | ✅ App · ✅ contract switched 2026-10-06, with the money majority (#119) |
| #100 | Design | [Web3-accessibility redesign brief](docs/design/web3-accessibility-redesign.md): the friction map, 14 Claude Design prompts and four delivery phases | — |
| #101 | Stake flow | Removed the phantom 3% fee from the stake dialog. Stakes were never charged a fee | ✅ |
| #102 | Stake flow | Sign-in opens above the project dialog. After sign-in (Google reload or password remount), the project reopens, in the fund flow when that was the intent | ✅ |

### Security-audit remediation (#67–#75)

| PR | Tier | What | On testnet? |
|----|------|------|-------------|
| #67 | Docs | Repositioned from "crowdfunding" to **a secure on-chain vault for real-world projects** | ✅ |
| #68 | App | Removed the unauthenticated `createNotification`. Security headers. Fixed the auth order in `platform-settings` | ✅ |
| #69 | Contract | Vault **H-02** (`settle_stalled`), **M-03** milestone cap, **M-07** `return_bond` CEI. Treasury and operations **M-05/M-06** CEI | ✅ Vault via #71, treasury and ops via the 2026-09-28 redeploy |
| #70 | DB | `requireKycReviewer` gate. Write-only column grants on `profiles` | ✅ Code · ❌ **migration not applied** ([item 3](#3-apply-the-two-pending-migrations-in-order)) |
| #71 | Deploy | Hardened vault wasm `70e5f3a8`, with the factory repointed | ✅ |
| #72 | Keeper | `settle_stalled` keeper cron | ✅ |
| #73 | Contract | Attestation **H-07** (records keyed by vault) and **M-04** `disable_factory`. Identity **M-02** (TTL) | ❌ Shelf-ready |
| #74 | Contract | **H-03**: `__constructor` on treasury and operations | ✅ |
| #75 | Contract | **H-03**: `__constructor` on factory, attestation, identity and admin. New deploy order | ❌ Shelf-ready |

**H-03 is closed in source.** Every contract configures itself in a constructor, except the vault, which `create_vault` deploys and initializes atomically.

### QA trials

- **QA-RPT-2026-09-30 (BUG-001…005).** Fixed by #79–#82. BUG-003's off-centre logo does not reproduce: it measures centred, and the offset is the scrollbar.
- **QA Trial #3.** Fixed by #84 and #86. Defects 002, 003 and 007 (favicon, empty wallet space, prompt position) are Freighter's own behaviour, and an upstream issue was drafted.

---

## Live vs shelf-ready

**Live on testnet:**

- **App:** everything on `main` through #103, including the #68 fixes, the #70 reviewer gate, the keeper (#72), the keep-alive (#86) and the hide/lock migration (#85).
- **Vault** wasm `e9009410…`, since 2026-10-06. The factory deploys it, so new projects get the #99 release rule, the money majority (#119) and the `d212b37` fixes, along with H-02, M-03 and M-07. Vaults are immutable, so older vaults keep their original code: `70e5f3a8…` or `9c20bca3…`.
- **Treasury** [`CDA5XDY5…M44COAXU`](https://stellar.expert/explorer/testnet/contract/CDA5XDY564RV2OSZNF2S6CXQYCABFASBOHUCXJEGII6M232VM44COAXU), redeployed 2026-09-28. The factory routes fees to it.
- **Operations Vault** [`CCVXM3YP…NQG7FDSN`](https://stellar.expert/explorer/testnet/contract/CCVXM3YPPEMWG4INHFTZ4NBJ3PQW3ZUNYIZMBJBNYQOMSNOENQG7FDSN), which the app now points at. It is unfunded until [item 1](#1-finish-the-operations-vault-cutover) is done.

**Merged, not active:**

- **Factory, attestation, identity, admin.** They carry #73 and #75. Read from testnet on 2026-10-02:
  - all four still expose `initialize`;
  - attestation still keys records by `project_id` and has no `disable_factory`;
  - identity has no `bump_kyc` or `bump_attestor`.
- **Migrations** `20260809160000_profiles_column_grants` and `20261001160000_kyc_filed_against_linked_wallet`.

Current hashes come from a fresh `bash scripts/build-contracts.sh`. The wasm embeds absolute build paths, so a hash only reproduces on the same paths (see item 8).

**Reference deployment (2026-10-06), not used by the app:** a standalone factory, attestation, identity and admin built from source, with the vault's money majority. It holds the test transactions for the contribution, threshold-release and attestation deliverable. Contract IDs, hashes and transactions are in [docs/deliverables/contribution-threshold-attestation.md](docs/deliverables/contribution-threshold-attestation.md). Its Project B finishes after 2026-10-13 14:14:52 UTC with `bash scripts/reference-scenario.sh project-b-finish`.

---

## Not yet done

### 1. Finish the Operations Vault cutover
The host step is done: the app addresses `CCVXM3YP…`. Two owner votes remain:

1. **Move the old vault's 25 XLM.** `CDZXCWKY…` still holds 250,000,000 stroops. The governance panel now addresses the new vault, so this `Release` has to be proposed and approved outside the panel, with each owner's key in Stellar Lab or the CLI. Since it is testnet XLM, writing it off is also an option.
2. **`SetOpsFunding`** on the treasury, pointing at `CCVXM3YP…`. `get_ops_funding` returns `null` today, so the monthly gas transfer has nothing to send to. This can be done from the panel now.

### 2. Switch the factory to the #99 vault wasm
✅ **Done 2026-10-06.** The factory admin ran `update_wasm_hash` to `e9009410…` in [`9dd7ed93…`](https://stellar.expert/explorer/testnet/tx/9dd7ed938ad0ef0db7e357cc6567e70c1620abb296a7baa301932888d7a13508), after the host was running the #121 vote panel. Checks:
- Both `/api/vault-wasm-hash` and the factory's storage read the new hash.
- The new vault's `VaultInitConfig` matches the live factory's field for field.
- Its `attest` call matches the live registry's signature and `Outcome` values.
- A simulated launch on the production factory, sent with `--send=no`, deployed a vault from the new code and ran its `initialize` as far as the KYC check.

Projects created before the switch keep the old bar (more than half the raw raise), under which a raise with one or two backers can never release.

- ✅ **`d212b37` has landed.** #99's final commit was pushed 17 minutes after the merge and landed on `main` separately on 2026-10-03:
  - `settle_stalled` now spares a carried milestone. The deployed `70e5f3a8…` vaults still don't: once an *approved* milestone's window closes past the 90-day stall clock, anyone can fail it and forfeit the bond. Opening a vote does not reset that clock, so a dissenter can race the release. `settle-stalled-cron` submits `settle_stalled` wherever it simulates successfully, so a carried but unreleased milestone should be released promptly.
  - The 20% cap never drops below one base unit, so a raise under 5 base units can still release.

- ✅ **Decided 2026-10-06: the dual majority.** Under #99 alone, a builder with just over 20% of the raise spread across three wallets could out-vote one backer holding the rest. A release now also needs the approvers' *uncapped* stake to exceed half the raise. A wallet holding more than half the raise can block a release but never make one alone. With it, `main` builds the vault to `e9009410…` on the maintainer's machine, and the reference deployment runs that hash.
- ✅ **The vote panel shows the money condition.** It reads `get_milestone_stake(id)` from the regenerated binding, counts it toward "Approved", and shows what the approvers put in against the raise. Older vaults have no such function, and the panel reads that as their rule rather than as a failed read. The admin View Vault names the rule the same way.
- ✅ **Switched**, with the commands in [deployment.md](docs/deployment.md#switching-the-vault-code). The code was already on testnet from the reference deployment, so no upload was needed.

### 3. Apply the two pending migrations, in order
1. `20260809160000_profiles_column_grants`. Without it, anyone signed in can set their own linked wallet without a signature.
2. `20261001160000_kyc_filed_against_linked_wallet`. Without step 1, this policy can be bypassed by rewriting your own link first.

Both are owner actions (`supabase db push`, or the MCP with approval). Once the grants apply, `profiles` writes must stay column-scoped, so no PostgREST `.upsert()`.

### 3b. Set `PINATA_GATEWAY_KEY` on the host
Without a Gateway Key, the dedicated gateway (`PINATA_GATEWAY_URL`, `nft.blkfndr.com`) answers `401 ERR_ID:00024` for this account's pins. The API JWT only authorizes pinning.

- **#104 landed the fix on `main`.** It cherry-picks #91's late commit, `900082d`, plus one addition: the indexer no longer follows redirects, which would otherwise carry the key to another host.
- **Host action:** add `PINATA_GATEWAY_KEY` to the Portainer stack environment, then **Update the stack**. It is a runtime variable, so no rebuild is needed, but a plain `docker restart` keeps the old environment. See [deployment.md](docs/deployment.md).
- **Success:** the app logs stop showing `nft.blkfndr.com answered 401`.

### 4. Redeploy the factory and registries (#73 + #75)
Redeploy the factory, attestation, identity and admin with `scripts/deploy-contracts.sh`.

- **Deploy order is proven live.** Attestation goes before the factory, then one `add_factory`. The reference deployment ran it on 2026-10-06 and the script's read-back checks passed.
- **Continue the project ids.** Pass `--first-project-id` set to the live factory's `get_project_count` + 1 (12 on 2026-10-06). `projects.project_id` is unique, so a new factory starting at 1 would collide with project #1 and its first project would fail to index.
- **New addresses:** update `NEXT_PUBLIC_BLKFNDR_{FACTORY,ATTESTATION,IDENTITY,ADMIN}_CONTRACT_ID` and **rebuild**. These are build args.
- **The script carries the rest over.** Pass `--shareholders-from` the live treasury, `--roster-admins` and `--attestors`. It then:
  - deploys the treasury against the new factory and repoints the fee wallet, since the treasury's `factory` is fixed at construction;
  - seeds the roster and the attestors;
  - reads every piece back.

  A throwaway testnet run on 2026-10-07 passed all 12 checks.
- **Re-attest** existing KYC into the new identity registry.
- **Keep-alive:** nothing to add. #125 tracks the env contracts, and every contract and code an existing vault depends on.
- This is an on-chain action. It needs the deployer key and an explicit go-ahead.

### 4b. Hand the factory admin to the treasury
The live factory's admin is still the deployer key `GDR4TPUF…`.

- Until `transfer_admin` hands it to the treasury, a carried treasury proposal that calls the factory cannot execute. That covers `SetFee`, `SetBondBps`, `SetWasmHash`, `SetFeeWallet`, `SetIdentityRegistry`, `SetVotingWindow`, `SetMinContribution` and `TransferAdmin`.
- Today, fee and policy changes are one signature, not an owner vote.
- If item 4 redeploys the factory, construct the new one with the treasury as admin, or transfer it straight after.

### 5. M-09 — migration history drift
- **Enum:** live has `admin_role` with `platform_admin`, added by a live-only migration (`20260809015229 add_platform_admin_role`) that has no file in the repo. The repo's `moderator_roles.sql` creates the enum without it.
- **Timestamps:** four repo files carry different timestamps from their live versions: `community_feature_requests`, `moderator_roles`, `my_role` and `managed_attestor_keys`.
- **Missing from live history:** `correct_bootstrap_admin` exists in the repo but not in the live history.
- **Result:** a clean `supabase db reset` from the repo does not reproduce live.
- **Fix:** add the missing migration and align the filenames to the live versions. This needs the Supabase CLI to verify.

### 6. M-01 — contributor Sybil resistance
The 20% cap and the three-wallet floor count addresses, not people. The open policy decision is whether to gate staking on the identity registry (one verified person, one cap). Item 2's money majority already makes splitting a stake useless for carrying a release.

### 7. Unwired features — wire up or delete
#95 kept these because each is the only way into a feature that is otherwise built. Each needs a call from the owner.

| Code | Missing without a caller |
|---|---|
| `flagProjectAction` / `flagForConsensus` | Nothing can put a listing into owner-consensus review |
| `requestPasswordReset` | No "forgot password" UI. Email users cannot recover a password |
| `returnBond` / `settleVault` | A builder whose raise fails has no button to reclaim the bond |
| `respondToFeatureRequestAction` | Roadmap responses render, but nothing writes them |
| `getAdminAuditLogAction` | The audit log is written, but has no viewer |
| `attestationClient()` | A builder's track record is never shown |

The Settings "Resend API key" is saved but never read, because nothing sends email.

### 8. Known defects (found, not yet fixed)

| Where | Defect |
|---|---|
| [FundDialog.tsx](src/components/project/FundDialog.tsx) | The balance it compares a stake with is the token's whole `balance()`, which includes amounts locked by open DEX offers and, for XLM, the minimum reserve. A stake within that margin passes the dialog and is refused by contribute's simulation with a raw error. It also lets through stakes below the vault's `min_contribution` (5 units), and the close-to-goal auto-fill rounds to 4 decimals, which can overshoot the goal or round to 0 and lock the field |
| [profile/page.tsx:1245](src/app/profile/page.tsx) | The "most investors" sort counts `r.investor`, but receipts carry `contributor` |
| 5 files, 6 places (profile ×2, KYC page, ListingForm, ProjectDetailsDialog, IdentityRegistryPanel) | Hard-code the testnet Soroban RPC URL instead of using `stellar-clients`. `stellar-clients` itself pins `Networks.TESTNET`. Both block mainnet |
| [Header.tsx](src/components/layout/Header.tsx) | The side-menu Admin link follows on-chain admin status, not the roster, so console-only admins don't see it |
| [profiles.ts:168](src/lib/data/profiles.ts) | `syncAdminClaim` still writes `app_metadata.role`, which nothing reads, and the landing security copy still says roles come from `app_metadata` |
| MilestoneVoting | Offers vote buttons on refunding or completed vaults. A window that closes while open is judged on stale data until reload |
| Factory | Recorded `platform_fee` is 300 base units (0.00003 of the project's token), likely a leftover 3% from the percentage model. Changing it needs `update_platform_fee` from the factory admin (see item 4b) |
| PlatformGovernanceView | Labels the platform fee "XLM flat", but it is charged in the project's own token |
| Operations Vault | `SetVotingWindow` has no bounds. A carried vote setting it to 0, or to an overflowing value, would stop the vault from ever passing another vote |
| Contract build | The wasm embeds absolute cargo paths, so hashes are machine-dependent. A pinned Docker build would fix it |
| Admin dashboard | Wider than a phone screen, so dialogs open off to the side |
| Location | Nothing writes `location_lat` / `location_lng`, so the map pin can't appear |

### 9. Manual passes still owed
These were verified with harnesses, but not with a real wallet or account:

- a real Freighter launch, stake, decline and timeout
- a signed-in builder saving milestone proof with a photo
- an admin clicking Hide/Lock in the console
- linking a different Freighter account from the header
- a full KYC submit from the verification page

---

## Next
1. Finish the Operations Vault cutover (item 1): two owner votes.
2. Apply the two migrations (item 3): a one-command push, in order. Set the gateway key on the host (item 3b), a one-variable stack update.
3. After 2026-10-13 14:14:52 UTC, finish the reference deployment's Project B (`bash scripts/reference-scenario.sh project-b-finish`) and add its transactions to the deliverable evidence.
4. Start Phase 1 of the [Web3-accessibility redesign](docs/design/web3-accessibility-redesign.md): copy, information architecture and flow, with no chain changes. #103 was its first item.

_Per-finding audit detail is in the security-audit PDF. Per-PR detail is in the PR descriptions._
