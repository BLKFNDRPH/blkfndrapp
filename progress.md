# BLKFNDR — Progress

_Last updated: 2026-10-13 · `main` at #170 (`1f4ccca`). This week: #152–#170, merged 10–12 Oct 2026._

Where the platform stands: what is live on testnet, what is merged but not yet active, and what is still open. This week's work comes first. Earlier work (#67–#150) is summarized under [Before this week](#before-this-week).

> ⚠️ **Merged is not deployed.**
> A Soroban contract only changes when it is redeployed. A vault change reaches only vaults the factory creates after it is repointed with `update_wasm_hash`, and vaults never change code afterwards. A migration file changes nothing until it is applied to the live database. See [Live vs shelf-ready](#live-vs-shelf-ready).

---

## Snapshot — verified on testnet, 2026-10-13

Read-only checks, not inferred from merges: the deployed site, the live Supabase project (`eqnheftmstapthlblpbx`), Horizon, contract reads through the RPC, and `scripts/replay-check.mjs`.

| Area | State |
|---|---|
| **App** | ✅ The host runs `main` through #170. `/projects` sends its first row's pictures with `fetchPriority="high"` (#170), and the desktop stake card carries #165's height cap |
| **Stellar SDK** | ✅ 16.3.1 (#169). Testnet runs protocol 29, which no JS SDK supports yet ([item 14](#14-protocol-29-and-the-stellar-sdk)) |
| **Indexer** | ✅ Current: the cursor moved at 08:17 UTC, nothing is unprocessed. 145 events stored |
| **Vault state rebuilt from events (#164)** | ✅ **22 of 22 vaults match the chain**, field by field, 3 runs out of 3 on SDK 16.3.1 |
| **Projects** | 14 raising, 6 refunding (#1, #5, #7, #8, #10, #11), 2 failed to fund (#2, #3). The factory has issued 22 project ids. No stage has been paid out yet |
| **Governance keeper (#131)** | ✅ Running. On 2026-10-12 it closed the stage-1 votes of #11 ([`91202582…`](https://stellar.expert/explorer/testnet/tx/9120258275e79b01fce63feb8f06ef0bc0ff52da6d7e846bc59bfaae54cfc6c7)) and #10 ([`96bbeab3…`](https://stellar.expert/explorer/testnet/tx/96bbeab37446665ee55f3c5bd98599e4319d7f25a5c4e8b12f3253484cbef511)), which fell short ([item 9](#9-older-vaults-that-could-not-release)) |
| **Operations Vault cutover** | ⚠️ Unchanged since 2026-10-02. The treasury's `get_ops_funding` still returns `null` ([item 1](#1-finish-the-operations-vault-cutover)) |
| **Factory admin** | ⚠️ Still the deployer key `GDR4TPUF…`, not the treasury ([item 2](#2-hand-the-factory-admin-to-the-treasury)) |
| **Database migrations** | ✅ Live is at `20261010153244` (#153's `attempts` column). Not applied: the #139 draft, the no-op `20261001160000` and `correct_bootstrap_admin` ([item 6](#6-migration-history-drift-m-09)) |
| **Email (#138)** | ⏳ Sending nothing: no Resend key. 0 sent, 2 pending, 63 skipped. An email not sent within a day is marked skipped, so no backlog builds up ([item 3](#3-switch-on-email)) |
| **Browser table grants (#139)** | ⏳ Not applied. `feature_requests_author_edit` is still in place, and `anon` still holds `INSERT` on `feature_requests` ([item 5](#5-apply-the-browser-table-grant-revocation)) |
| **Testnet demo video** | ⏳ Not recorded yet. No stake on #22 since the script was written ([item 15](#15-record-the-testnet-demo)) |
| **Network** | Testnet |

---

## This week (#152–#170)

**In short:**
- **The week's target is two-thirds done.** The web app with Freighter (backing a project in six taps) and the indexer were already live. This week proved the indexer's events rebuild every vault exactly (#164). The demo script is written and dry-run (#166), and the evidence is in [web-app-indexer-demo.md](docs/deliverables/web-app-indexer-demo.md) (#167). **The video is still to be recorded.**
- **Indexer.** New vaults' opening events are no longer missed, and the 40 missing rows were backfilled (#152). A failing event is retried, then skipped after five attempts, instead of holding every project back (#153).
- **Speed.** QA's performance audit is worked through (#154–#162, #168, #170). The browser no longer calls the Soroban RPC, pictures are resized, and pages render on the server. On a throttled phone, `/projects`' largest paint went from about 8.6 s to 2.9 s.
- **Testnet moved ahead of the SDK.** Testnet runs protocol 29. SDK 15.1 failed to decode about one ledger in five, which broke `getLatestLedger` and with it keep-alive about one run in five. Upgraded to 16.3.1 (#169).

### Web interface, indexer and testnet demo

| PR | What changed | Live? |
|----|--------------|-------|
| #152 | **New vaults' opening events.** The indexer reads a vault the factory deploys in the same pass, so its `VAULT/INIT` and `BOND/POSTED` are stored. The 40 rows it had missed (#2–#9, #11–#22) were backfilled on 2026-10-10. Health check: one `BOND/POSTED` per `FACTORY/DEPLOY` (22 of 22) | ✅ |
| #153 | **Retries.** A failed event is retried on later passes and skipped after five attempts. Builder-supplied data (a NUL in a CID, malformed metadata) no longer fails an event on every attempt. Migration `20261010153244` | ✅ |
| #164 | **Vault state rebuilt from events.** [vault-replay.ts](src/lib/vault-replay.ts) replays a vault's stored events with the contract's rules: status, raise, payouts, stages, votes, the deposit and every staker's balance. Only the goal, deadline and stage ids are read from the vault, because no event carries them. [replay-check.mjs](scripts/replay-check.mjs) compares the result with the chain for every vault. All 22 match. With one stake left out, it reports the vault and fails | ✅ Script, read-only |
| #165 | Found in the demo dry run: at 1280×720 the open stake sheet made the desktop card taller than the screen, so **Review and sign** only came into view at the bottom of the page. The card is now capped at the screen height and scrolls | ✅ |
| #166 | [Demo script](docs/deliverables/testnet-demo-script.md): project #22, six taps from the list to a confirmed stake, seven shots with voiceover notes, a pre-recording checklist and fallbacks | — |
| #167 | [Deliverable evidence](docs/deliverables/web-app-indexer-demo.md) for the web app, the indexer and the demo. The video, its stake transaction and the replay output after it are still to be added | — |

### Performance (QA report of 2026-10-04)

| PR | What changed | Effect |
|----|--------------|--------|
| #154 | Platform settings read on demand; no second simulation per contract read | RPC calls on load: home 14 → 0, project page 18 → 2 |
| #155 | Chain reads through same-origin, cached routes; server-only `SOROBAN_RPC_URL` | No page calls the RPC from the browser; no CORS preflights |
| #156 | Listing pictures resized by `/api/images/[cid]`; a repeatable Lighthouse baseline (`npm run perf:baseline`) | Home page 14.9 MB → about 1 MB |
| #157 | No overlay while the session is checked; the wallet panel and SDK load on demand; self-hosted fonts | Mobile home score 36 → 56 (local A/B) |
| #158 | The Stellar SDK loads on the project page only when someone acts | Mobile project page score 38 → 54 (local A/B) |
| #159 | Recorded the live before/after baseline for #154–#158 in [performance.md](docs/performance.md) | Live mobile scores: home 35 → 48, project page 30 → 50 |
| #160, #161 | `/projects` renders on the server as it ends up; skeletons a screen tall | Desktop `/projects` layout shift 0.43 → 0.01; mobile project page 0.16 → 0 |
| #162 | The project page renders on the server with the indexed project; live figures replace it when they arrive | Mobile project page score 59 → 65 |
| #168 | No root `loading.tsx`, so content isn't held behind a streaming boundary; the hero's 26 SVG animations wait until the page is idle and on screen. Adds real-throttling runs (`--throttling devtools`) | Home page mobile LCP 3.4 → 2.4 s (real throttling) |
| #170 | `/projects` sends its list in the first HTML, with the first row's pictures fetched first | `/projects` mobile LCP 8.6 → **2.9 s** (real throttling), score 43 → 64 |

The A/B numbers for #160–#170 are from local production builds. #163 (inlining CSS) was closed: it helped first paint but not LCP.

### Platform

| PR | What changed | Live? |
|----|--------------|-------|
| #169 | **Stellar SDK 15.1 → 16.3.1.** `getLatestLedger` decodes the newest ledger's full meta, including other users' transactions, and protocol 27/28 XDR in them failed to decode in 32 of 160 ledgers. 16.3.1 decoded all of them. Keep-alive and the replay check now read the latest sequence from `getHealth`, which decodes no XDR, as the indexer already did. 17.x was not chosen: it rewrites the XDR API and makes v2 auth entries the default | ✅ |

---
## Live vs shelf-ready

**Live on testnet:**
- **App:** everything on `main` through #170, on Stellar SDK 16.3.1.
- **Vault** wasm `e9009410…`, deployed by the factory since 2026-10-06. Vaults are immutable, so older projects keep `70e5f3a8…` or `9c20bca3…` and the rule they were created with.
- **Factory** [`CBRUIRJX…`](https://stellar.expert/explorer/testnet/contract/CBRUIRJXRU6NGHOSF5KMPUOFIXIANCPI43QC6JX2PKNOKD3QSAHPLINO), **attestation** `CDEN2LU4…`, **identity** `CAILTHEY…`, **admin roster** `CAKANFZH…` and **treasury** [`CAGMEGMS…`](https://stellar.expert/explorer/testnet/contract/CAGMEGMS6MS6ENADUWDRW3GQ4XRBDYFFKHMRFVDEBHFCZW7NRO3TQPZW). They were redeployed 2026-10-06 and have been live in the app since 2026-10-07. Projects #1–#11 keep the previous factory `CDIXGE5M…` (closed to new launches) and attestation registry `CDLL2A4R…`. Details are in [smart-contracts.md](docs/smart-contracts.md#the-registry-redeploy).
- **Operations Vault** [`CCVXM3YP…`](https://stellar.expert/explorer/testnet/contract/CCVXM3YPPEMWG4INHFTZ4NBJ3PQW3ZUNYIZMBJBNYQOMSNOENQG7FDSN), unfunded until [item 1](#1-finish-the-operations-vault-cutover) is done.
- **Crons:** indexer, ops funding, stalled-vault keeper, storage keep-alive and governance keeper, all in `docker-compose.yml`. The notification-emails cron sends nothing without a Resend key.
- **Replay check** ([scripts/replay-check.mjs](scripts/replay-check.mjs), #164): run by hand, read-only. It is not scheduled.
- **Database:** every repo migration except the #139 draft, `20261001160000` (kept as a no-op, superseded by `20261006155050`) and `correct_bootstrap_admin` ([item 6](#6-migration-history-drift-m-09)).

**Not active:**
- `20261007104544_revoke_browser_table_grants` (#139): a draft, dry-run only.
- Email (#138): needs a Resend key and a verified sending domain.

There is no contract source ahead of testnet. Every contract's deployed wasm matches `main`. Hashes reproduce only on the same build paths ([item 11](#11-known-defects-found-not-yet-fixed)).

**Reference deployment (2026-10-06), not used by the app:** a standalone set built from source, holding the test transactions for the contribution, threshold-release and attestation deliverable ([evidence](docs/deliverables/contribution-threshold-attestation.md)). Its Project B finishes after 2026-10-13 14:14:52 UTC.

---

## Not yet done

### 1. Finish the Operations Vault cutover
The app addresses the new vault `CCVXM3YP…`. Two owner votes remain:
1. **Move the old vault's 25 XLM.** `CDZXCWKY…` still holds 250,000,000 stroops. The governance panel now addresses the new vault, so this `Release` has to be proposed and approved outside the panel, with each owner's key in Stellar Lab or the CLI. Since it is testnet XLM, writing it off is also an option.
2. **`SetOpsFunding`** on the treasury `CAGMEGMS…`, pointing at `CCVXM3YP…`. `get_ops_funding` returns `null`, so the monthly gas transfer has nothing to send to. The panel already addresses this treasury.

### 2. Hand the factory admin to the treasury
The factory's admin is the deployer key `GDR4TPUF…`, by owner decision, until the new set has run cleanly for a while.
- Until `transfer_admin` hands it to the treasury, a carried treasury proposal that calls the factory can't execute: `SetFee`, `SetBondBps`, `SetWasmHash`, `SetFeeWallet`, `SetIdentityRegistry`, `SetVotingWindow`, `SetMinContribution` and `TransferAdmin`.
- Today a fee or policy change takes one signature, not an owner vote.

### 3. Switch on email
#138 emails notifications once Resend is set up. Until then the bell works as before, and the "one day left to vote" reminders still reach it. On 2026-10-13, 0 emails had been sent, 2 were pending and 63 were marked skipped. An email not sent within a day of its notification is marked skipped, so switching Resend on sends only new notifications, not a backlog.
1. Create a Resend account and add the sending domain (`blkfndr.com`, or a subdomain with `EMAIL_FROM` set to match). Add the DNS records it lists, and wait until it shows as verified.
2. Create an API key with sending access and paste it into the admin console under **Settings → Resend API key**.
3. Update the stack once.
4. Run the cron's dry run ([deployment.md](docs/deployment.md#notification-emails-cron)) and check `wouldSend`.

The free plan sends 100 emails a day. People can turn off each category in Settings, or from any email.

### 4. Set `PINATA_GATEWAY_KEY` on the host
Without a Gateway Key, the dedicated gateway (`nft.blkfndr.com`) answers `401 ERR_ID:00024` for this account's pins, and reads fall back to the rate-limited shared gateway. #104 sends the key to the dedicated gateway only and doesn't follow redirects. **Host action:** add `PINATA_GATEWAY_KEY` to the Portainer stack environment and **Update the stack** (a plain `docker restart` keeps the old environment). **Success:** the app logs stop showing `nft.blkfndr.com answered 401`.

### 5. Apply the browser table-grant revocation
`20261007104544_revoke_browser_table_grants` (#139) takes `anon` off every write and `TRUNCATE`, and cuts `authenticated` back to the verbs and columns the app uses on eleven tables. It also drops `feature_requests_author_edit`, which lets an author mark their own request planned. No app change goes with it. Applying it is the owner's call. Afterwards, rename the file to the version live records.

### 6. Migration history drift (M-09)
A clean `supabase db reset` from the repo does not reproduce live:
- **Enum:** live has `admin_role` with `platform_admin`, from a live-only migration (`20260809015229 add_platform_admin_role`) with no file in the repo.
- **Missing from live history:** `correct_bootstrap_admin`.
- **Different version numbers:** `community_feature_requests`, `moderator_roles`, `my_role`, `managed_attestor_keys` and `project_restrictions` (repo `20261001120000`, live `20261001064107`).
- **New this week:** the three identity migrations were recorded under new versions when applied: `kyc_identity_deleted_after_decision` as `20261007134943` (repo `…130000`), `kyc_renewal_before_id_expires` as `20261007134605` (repo `…150000`) and `kyc_review_server_only` as `20261007134955` (repo `…170000`). Live applied the renewal first. Rename the files to match, as #127 and #137 did.

The fix needs the Supabase CLI to verify.

### 7. Phase 2 decisions for the owner
The rest of Phase 2 in the [brief](docs/design/web3-accessibility-redesign.md#delivery-phases) needs decisions before it can be built:
- **Stellar Wallets Kit**, so phones can use Lobstr and xBull. Needs a device spike first.
- **Fee sponsorship** from the Operations Vault, with per-account caps, an allowlist and a kill switch. Depends on item 1.
- **Public stakeholder names** on the Record tab.

### 8. M-01 — contributor Sybil resistance
The 20% cap and the three-wallet floor count addresses, not people. The money majority (#119) already makes splitting a stake useless for carrying a release. What's left is a policy decision: whether to gate staking on the identity registry (one verified person, one cap).

### 9. Older vaults that could not release
Projects created before 2026-10-06 keep the original bar: more than half of the raw raise. A raise with one or two backers, or one concentrated in a single wallet, can never release under it.
- **#5 (Me Comida) and #7 (AquaPure)** hit this. Their stage votes lapsed, and on 2026-10-08 the governance keeper closed them ([`1c7ec500…`](https://stellar.expert/explorer/testnet/tx/1c7ec5008ad1ef384cf79a892a680dd0161153cd9f8b50c66a8808296fa71ac2), [`503c1ba1…`](https://stellar.expert/explorer/testnet/tx/503c1ba1afd382d507b5985a00fcde0484a789bec5ed0781cc96c1635a2c0bde)). Their bonds were forfeited, and their stakeholders can now collect refunds.
- **#8, #10 and #11** then ended the same way. The governance keeper closed their stage-1 votes, which fell short: #8 on 2026-10-10 ([`c98187e3…`](https://stellar.expert/explorer/testnet/tx/c98187e374c3558a2411f390b4b207895dc068333903e64f5df485075afd3870)), #11 ([`91202582…`](https://stellar.expert/explorer/testnet/tx/9120258275e79b01fce63feb8f06ef0bc0ff52da6d7e846bc59bfaae54cfc6c7)) and #10 ([`96bbeab3…`](https://stellar.expert/explorer/testnet/tx/96bbeab37446665ee55f3c5bd98599e4319d7f25a5c4e8b12f3253484cbef511)) on 2026-10-12. #10's vote had no approvals at all. All three were funded by a single stakeholder. Each vault is now refunding, with the builder's deposit forfeited to its stakeholders.
- **Every funded project on the old code has now failed a stage**, and no stage has been paid out on testnet. #4, #6 and #9 are still raising on the old code.
- Nothing can change a deployed vault. A builder in this position can only tell stakeholders early, or relaunch on the new factory.

### 10. Unwired features — wire up or delete
#95 kept these because each is the only way into a feature that is otherwise built. Each needs a call from the owner.

| Code | Missing without a caller |
|---|---|
| `flagProjectAction` | Nothing can put a listing into owner-consensus review |
| `requestPasswordReset` | No "forgot password" UI. Email users can't recover a password |
| `returnBond` | A builder whose raise fails has no button to reclaim the bond. Settling a missed goal is wired (#118, and the keeper since #131); returning the bond is not |
| `respondToFeatureRequestAction` | Roadmap responses render, but nothing writes them |
| `getAdminAuditLogAction` | The audit log is written, but has no viewer |
| `attestationClient()` | A builder's track record is never shown |

### 11. Known defects (found, not yet fixed)

| Where | Defect |
|---|---|
| [Header.tsx](src/components/layout/Header.tsx) | The side-menu Admin link follows on-chain admin status (`useAdminStatus`), not the roster, so console-only admins don't see it |
| [profiles.ts](src/lib/data/profiles.ts) | `syncAdminClaim` still writes `app_metadata.role`, which nothing reads |
| [PlatformGovernanceView.tsx](src/components/admin/PlatformGovernanceView.tsx) | Labels the platform fee "XLM flat", but it is charged in the project's own token |
| Operations Vault | `SetVotingWindow` has no bounds. A carried vote setting it to 0, or to an overflowing value, would stop the vault from ever passing another vote |
| Contract build | The wasm embeds absolute cargo paths, so hashes are machine-dependent. A pinned Docker build would fix it |
| Admin dashboard | Wider than a phone screen, so dialogs open off to the side |
| Location | Nothing writes `location_lat` / `location_lng`, so the map pin can't appear |
| Project page | The deadline is shown without its year ("Ends 31 Dec (445 days)" for a 2027 deadline). Found in the demo dry run |
| Project #9 | Its title is stored twice in a row ("OpenNode: … OpenNode: …") and its deadline is in the year 9999. Worth checking whether it came through the launch form, since the factory accepts launches from anyone |
| Possible duplicate launch | #15 and #16 are the same listing ("AquaSense") from the same builder, opened 8 minutes apart on 2026-10-07 with separately uploaded metadata. The duplicate-launch guard (#86) matches creator and metadata CID, so it only catches an unchanged draft launched again. Ask the builder whether the first launch looked failed to them |

**Resolved this week:**
- New vaults' missing opening events (#152) and an event that failed on every attempt holding the indexer back (#153).
- The desktop stake card hiding **Review and sign** on laptop screens (#165, verified in the deployed CSS).
- Keep-alive failing on about one run in five once testnet carried protocol 27/28 XDR (#169).
- Layout shift on `/projects` and the project page (#160, #161).

### 12. Manual passes still owed
There was no new launch or stake on testnet this week. The only on-chain activity was the keeper closing three votes. Still not seen with a real wallet or account:
- a stake with Freighter since #164–#170; the demo recording will be the first ([item 15](#15-record-the-testnet-demo))
- a Freighter decline and a timeout in the stake and launch flows
- an admin clicking Hide or Lock in the console (the last restriction was 2026-10-01)
- linking a different Freighter account from the header
- QA's retest of the boundary cases TC-01 to TC-09 against #109–#111

### 13. Delete the legacy identity data
The 2026-10-07 deletion audit found the app clean. Three things are left ([privacy.md](docs/privacy.md#open-items)):
- **MongoDB Atlas.** From 2026-07-17 to 2026-08-07 the app stored ID images as base64 in a `KycRequest` collection, never migrated. An owner checks whether the cluster still exists, and if so deletes the collection or the cluster, with its snapshots.
- **Pinata.** One private, PGP-encrypted file from 2026-07-21 isn't from this app. Confirm with whoever uploaded it.
- **Display name fallback.** `handle_new_user` uses the email as the display name when an account has no name. No live profile does today, but the fallback should change.

### 14. Protocol 29 and the Stellar SDK
Testnet runs protocol 29 (stellar-rpc 29.0.0). No JS SDK supports it yet: 16.3.1 and 17.2.1 stop at protocol 28. #169 made every scheduled job read the latest ledger from `getHealth`, which decodes no XDR, and the app's own transactions decode only their own envelopes, so nothing depends on other users' XDR any more. If someone's transaction uses a protocol 29 feature (muxed contracts, ML-DSA keys, millisecond close times), anything that still decodes whole ledgers would fail again. Upgrade once an SDK with protocol 29 ships. 17.x also makes v2 auth entries the default, so Freighter signing must be re-checked then.

### 15. Record the testnet demo
The last part of the week's target. The [demo script](docs/deliverables/testnet-demo-script.md) is written and dry-run. It needs a demo Freighter wallet on Testnet with test XLM, a USDC trustline and at least 30 test USDC, signed in to a demo BLKFNDR account with the wallet linked. Then add the video link, the stake's transaction hash and the replay-check output after the stake to the [deliverable evidence](docs/deliverables/web-app-indexer-demo.md#still-to-do).

---

## Next week
1. **Record the testnet demo** and finish its deliverable evidence (item 15).
2. **Today, after 2026-10-13 14:14:52 UTC:** finish the reference deployment's Project B (`bash scripts/reference-scenario.sh project-b-finish`) and add its transactions to the [contribution deliverable](docs/deliverables/contribution-threshold-attestation.md#still-to-run).
3. **Owner votes:** move or write off the old Operations Vault's 25 XLM, and `SetOpsFunding` on the treasury (item 1).
4. **Host settings:** a Resend account, its DNS records and the key (item 3), and `PINATA_GATEWAY_KEY` (item 4). One stack update covers both.
5. **Owner approvals:** the #139 grant revocation (item 5), and the Phase 2 decisions on Wallets Kit, fee sponsorship and stakeholder names (item 7).
6. Rename the three identity migration files to their live versions (item 6).
7. Ask the builder of #15 and #16 why the listing was opened twice, and of #9 about its title and deadline (item 11).
8. Check MongoDB Atlas for the legacy identity data (item 13).

---

## Before this week

### #105–#150 (2026-10-03 to 2026-10-08)

**In short:**
- **Contracts.** The factory switched to the new vault code, with the money majority adopted by the owner on 2026-10-06. The factory, attestation, identity, admin and treasury contracts were redeployed from source. Eleven vaults have been opened on the new factory since.
- **Plain-language redesign.** Every Phase 1 item of the [Web3-accessibility brief](docs/design/web3-accessibility-redesign.md) is built, along with four Phase 2 items: the governance keeper, the Record tab, notifications and email. On 2026-10-08 the owner brought the Web3 terms back while keeping project wording plain (#149).
- **QA.** Both 2026-10-04 QA reports, boundary testing and the consolidated audit, were fixed (#107, #109–#114).
- **Security and personal data.** The profile column grants are applied, so a wallet can no longer be linked without a signature. ID documents and details are deleted once a check is decided, verifications renew when the ID expires, and review is server-only.
- **Mainnet readiness.** The app reads its network from one variable (#150).

#### Contracts and deployment

| PR | What changed | Live? |
|----|--------------|-------|
| #106 | Landed #99's missing commit `d212b37`: `settle_stalled` spares a carried milestone, and the 20% cap never drops below one base unit | ✅ In vault `e9009410…` |
| #119 | **Money majority.** A release also needs approvers who put in more than half the raise between them, counted uncapped. A wallet holding more than half can block a release, never make one alone. Adds the builder-topic attestation event and a standalone reference deployment with recorded test transactions ([deliverable](docs/deliverables/contribution-threshold-attestation.md)) | ✅ |
| #121 | The vote panel reads `get_milestone_stake` and counts the money condition toward "Approved". Older vaults without the function are read as their own rule, not as a failed read | ✅ |
| #122, #123 | Recorded the factory's switch to `e9009410…` (tx [`9dd7ed93…`](https://stellar.expert/explorer/testnet/tx/9dd7ed938ad0ef0db7e357cc6567e70c1620abb296a7baa301932888d7a13508), 2026-10-06). The homepage describes the release rule as it now runs | ✅ |
| #126 | The factory constructor takes `first_project_id`, so a replacement factory continues the previous one's ids. The new factory started at #12 | ✅ |
| #128, #130 | `deploy-contracts.sh` deploys the treasury, seeds the admin roster and the attestors, and reads every piece back in one run. `migrate-kyc.mjs` copies approved builders into a new identity registry, dry run by default. Both were used for the 2026-10-06 redeploy, which copied 3 KYC approvals | ✅ |
| #135 | Recorded the registry redeploy: addresses, transactions and checks in [smart-contracts.md](docs/smart-contracts.md#the-registry-redeploy) | — |
| #133 | The homepage's contract list comes from the same build variables the app uses, so it follows a redeploy with no code change | ✅ |
| #112, #125 | **Keep-alive.** It now tops up anything under 40 days to 60, above the contracts' own 30-day top-up, so a launch or a stake never pays the platform's rent (QA OBS-04). It also tracks the code and contracts every existing vault depends on. A dry run had found the earliest vault code at 23.9 days | ✅ |

**On-chain this week (indexed 3–8 Oct):** 15 vaults opened (#8–#22), 23 stakes, 6 votes opened, 5 approvals. Three vaults reached their goal (#8, #10, #11). The governance keeper closed four projects' outcomes (#2, #3, #5, #7). No milestone was released this week.

#### Plain-language redesign

Phase 1 of the [brief](docs/design/web3-accessibility-redesign.md) is complete, and Phase 2 has started. Shared pieces later work must reuse: `money.ts`, `project-status.ts`, `network.ts`, `explain-error.ts`, `wallet-readiness.ts`, `OutcomeCard`, `WalletConfirm` and `MoneyActionPanel`.

| PR | Phase | What changed | Live? |
|----|-------|--------------|-------|
| #108 | 1 | Discovery and join: landing page, header, project cards and filters in dollars, plain status pills, sign-in copy, wallet panel | ✅ |
| #115 | 1 | Every project is a page at `/projects/[id]`, with Overview, Stages, Record and Builder tabs. It lands a commit that was pushed after #108 merged | ✅ |
| #116 | 1 | The stake sheet. Amount in dollars with presets. The minimum, goal and deadline come from the vault. Every wallet gate is fixed inside the sheet, and every failure is in plain words with a line saying whether money moved | ✅ |
| #117 → #118 | 1 | Votes and refunds through the same simulate-first confirm flow. Stakeholder status comes from the linked wallet, and the refund sheet works out the amount the way the vault does. #117 merged into the stake-sheet branch, so #118 landed it on `main` | ✅ |
| #120 | 1 | The profile as a home for stakes, projects, activity and wallet, with a "Getting set up" checklist | ✅ |
| #124 | 1 | Opening a vault: live readiness checks with their fixes, a cost card, a deposit field that no longer resets itself, and a draft that survives the identity detour | ✅ |
| #127 | 1 | Identity verification without a wallet first; the wallet is attached later. Migration `20261006155050` | ✅ |
| #129 | 1 | A five-step wallet setup flow, honest on phones. It names a wrong-network wallet and a wallet linked to another account | ✅ |
| #131 | 2 | **Governance keeper.** Every 15 minutes it sends carried payouts, closes lapsed stages and settles missed goals. It simulates first and can delay but never decide | ✅ |
| #132 | 2 | **Record tab.** The vault's history in sentences, read from the indexed events. Each line links to its transaction | ✅ |
| #134 | 2 | **Notifications.** Stakeholders and builders hear when a vote opens, a payout goes out or money is waiting. "Needs you" lists open votes and uncollected money. Fixed the bell's broken project links | ✅ |
| #138 | 2 | **Email**, plus a reminder a day before a vote closes. Per-category switches in Settings | ⏳ Needs a Resend key ([item 3](#3-switch-on-email)) |
| #149 | — | **Web3 terms are back** (owner, 2026-10-08): Testnet, on-chain, transaction, sign, wallet address, trustline, View on Stellar Expert. Project wording stays plain: stake, vault, stage, payout, goal, dollars first | ✅ |
| #150 | — | `src/lib/network.ts` decides the passphrase, endpoints, Friendbot and explorer from `NEXT_PUBLIC_STELLAR_NETWORK`. Wallet connect and link signing no longer hard-code Testnet. The variable is now a Docker build arg, and `next.config.js` fails a Mainnet build without a Mainnet RPC URL | ✅ |

#### QA fixes (reports of 2026-10-04)

| PR | Finding | What changed | Live? |
|----|---------|--------------|-------|
| #107 | Stake showed "USDC balance 0.00" | The balance is read from the vault's own token, by issuer, not the first line called USDC | ✅ |
| #109 | BUG-006, 008, 010 | A raising project shows its stage plan, with each stage's amount, share and deliverable | ✅ |
| #110, #111 | BUG-007, 011 | Listing text limits (title 80, description 2,000, stage description 500) in the form, the upload route, the indexer and as database checks | ✅ Migration `20261005150059` |
| #112 | OBS-04 | Keep-alive threshold above 30 days (see above) | ✅ |
| #113 | DEFECT-001, 002 | No raw launch errors. A refused simulation stops before the review, and the deposit plus fee is checked first | ✅ |
| #114 | OBS-01, 03, DEFECT-001, T3 DEFECT-005 | The deadline sent is the deadline shown. An in-flight launch survives a reload. "Enable USDC" in one step | ✅ |

#### Security, personal data and admin

| PR | What changed | Live? |
|----|--------------|-------|
| #137 | **Profile column grants.** The browser can update only `display_name` and `avatar_url`. Before this, a signed-in user could link any wallet to their account with no signature. All 13 linked wallets at the time carried the link stamp, so there was no sign the gap had been used | ✅ `20261007100549` |
| #139 | Revokes the table writes the browser roles hold but the app never uses, on eleven tables. A live dry run passed all 20 app writes and refused all 19 unused ones | ⏳ Draft, needs the owner ([item 5](#5-apply-the-browser-table-grant-revocation)) |
| #142 | A decision deletes the ID document. The ID number, date of birth, address and email go once the details hash is final | ✅ |
| #143 | A verification holds until its ID expires, and renewal opens 30 days before. A lapsed verification blocks a launch. Adds a hash-based record check | ✅ |
| #144 | Dropped the KYC-manager browser policies, which had let any KYC manager or owner rewrite any check. Review is server-only | ✅ |
| #145–#147 | *See details* shows what a decided check keeps. The record check asks only for what isn't kept. Documents are shown from memory, so reviewers' browsers keep no copy | ✅ |
| #148 | "How your personal data is protected" on the landing page, and [privacy.md](docs/privacy.md) | ✅ |
| #136 | Admin dashboard: no blank page for a role that can't open a tab, and no false "No pending requests" when the queue fails to load | ✅ |
| #140, #141 | "Clear all" notifications works (it had failed on every press with `22P02`). The bell changes its list only once the server agrees | ✅ |

The three identity migrations were applied on 2026-10-07, after the app had deployed. #143's code read a column that didn't exist yet, and the review queue failed until its migration ran. Since then, a PR that needs new schema gets its migration applied before it merges.

#### Docs
#105 refreshed every page against `main` and the live testnet. #122, #135 and #148 recorded the vault switch, the registry redeploy and the personal-data rules.

### #76–#104 (2026-09-28 to 2026-10-02)

| PR | What changed |
|----|--------------|
| #76, #77 | This tracker. Treasury and Operations Vault redeployed 2026-09-28 |
| #78 | `/login` reads `?checkEmail=1` and `?error=`, so new email users are no longer told "Login failed" |
| #79 | KYC applicants are notified of the decision, with the reviewer's reason on a rejection |
| #80, #83 | Launch pre-flight: a missing trustline, low balance or unfunded wallet each get their own instructions. Validation lists what to fix |
| #81, #82 | Launch button size and spinner; one page width rule |
| #84, #93 | One shared `freighterSigner`. Before #93, every stake, vote, release, refund and treasury action failed before Freighter opened |
| #85 | Platform-level **hide** and **lock**, with a reason, audit-logged and enforced in Postgres. A lock binds this interface, never the vault |
| #86 | **QA Trial #3.** The keep-alive cut the launch fee from 172.83 to 5.88 XLM. Review dialog with the simulated fee, duplicate-launch guard, recovery of an unconfirmed launch |
| #87, #92, #94 | Project locations; creator and backer names from the linked profile |
| #88 | Admin status comes from the `platform_admins` roster |
| #89 | The linked wallet comes from the session, and the signer must match it. KYC is filed against the linked wallet |
| #90, #91, #104 | Indexer follows the RPC cursor through quiet ledger windows. IPFS falls back to the shared gateway. #104 sends the Gateway Key to the dedicated gateway only |
| #95 | Removed 52 unreachable files, Firebase, two unread env vars and 13 npm packages |
| #96 | Profile activity from Horizon operations |
| #97, #103 | Per-milestone proof, decided server-side from the live vault |
| #98 | View Vault shows the real release authority and the flat fee |
| #99 | **Release rule:** more than half the capped total, from at least three wallets or every backer when there are fewer. Live since the 2026-10-06 switch |
| #100 | The [Web3-accessibility redesign brief](docs/design/web3-accessibility-redesign.md) |
| #101, #102 | No phantom 3% fee on stakes. Sign-in opens above the project and returns to it |

### Security-audit remediation (#67–#75)

| PR | Tier | What | On testnet? |
|----|------|------|-------------|
| #67 | Docs | Repositioned from "crowdfunding" to **a secure on-chain vault for real-world projects** | ✅ |
| #68 | App | Removed the unauthenticated `createNotification`. Security headers. Auth order in `platform-settings` | ✅ |
| #69 | Contract | Vault **H-02** (`settle_stalled`), **M-03** milestone cap, **M-07** `return_bond` CEI. Treasury and operations **M-05/M-06** CEI | ✅ |
| #70 | DB | `requireKycReviewer` gate. Write-only column grants on `profiles` | ✅ Grants applied 2026-10-07 (#137) |
| #71 | Deploy | Hardened vault wasm `70e5f3a8`, factory repointed | ✅ Superseded by `e9009410…` |
| #72 | Keeper | `settle_stalled` keeper cron | ✅ |
| #73 | Contract | Attestation **H-07** (records keyed by vault) and **M-04** `disable_factory`. Identity **M-02** (TTL) | ✅ Redeployed 2026-10-06 |
| #74 | Contract | **H-03**: `__constructor` on treasury and operations | ✅ |
| #75 | Contract | **H-03**: `__constructor` on factory, attestation, identity and admin | ✅ Redeployed 2026-10-06 |

**H-03 is closed on testnet.** Every contract configures itself in a constructor, except the vault, which `create_vault` deploys and initializes atomically. Still open from the audit: **M-01** ([item 8](#8-m-01--contributor-sybil-resistance)) and **M-09** ([item 6](#6-migration-history-drift-m-09)).

### QA trials
- **QA-RPT-2026-09-30 (BUG-001…005):** fixed by #79–#82.
- **QA Trial #3:** fixed by #84 and #86. Defects 002, 003 and 007 are Freighter's own behaviour; an upstream issue was drafted.
- **QA-RPT-BLKFNDR-2026-10-04-BT and -CON:** fixed this week by #107 and #109–#114. A retest is owed ([item 12](#12-manual-passes-still-owed)).

_Per-finding audit detail is in the security-audit PDF. Per-PR detail is in the PR descriptions._
