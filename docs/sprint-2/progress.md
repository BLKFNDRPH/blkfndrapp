# BLKFNDR — Sprint 2 progress (Instawards SOW)

_Last updated: 2026-11-27 · sprint runs Mon 23 Nov to Fri 18 Dec 2026_

Progress against the [Sprint 2 plan](plan.md). Item numbers match the plan. The platform-wide status stays in the root [progress.md](../../progress.md).

> **Merged is not deployed.** An item is ✅ only when its expected output has been seen on testnet or on the live site, with the evidence linked. A merged PR alone is 🔶.

**Status key:** ⬜ not started · 🔧 in progress · 🔶 merged, not live · ✅ live with evidence · ⛔ blocked

---

## Summary

| Week | Dates | Items | Done | Expected output met? |
|---|---|---:|---:|---|
| 1 | 23–27 Nov | 7 | 3 | 🔧 2 of 5 met |
| 2 | 30 Nov–4 Dec | 7 | 0 | ⬜ |
| 3 | 7–11 Dec | 7 | 0 | ⬜ |
| 4 | 14–18 Dec | 5 | 0 | ⬜ |

**This week in short:** The report-anchor registry is live on both testnet sets, and the first 28 risk reports, one per listed vault, are stored and anchored (rules only). Campaign and fee sponsorship are written and tested on local branch `sprint-2/day-1`, not pushed. The campaign and sponsorship migrations are not applied, so the onboarding path and the campaign are not live yet.

---

## Snapshot at sprint start

Read on 24 Nov 2026 (about 15:55 UTC), read-only, not inferred from merges. The "21 Oct" column is the last verified reading, from the root progress.md.

| Area | 21 Oct reading | Day 1 reading |
|---|---|---|
| `main` | `d1496c6` (#220) then; `8ca2f65` (#230) on 28 Oct | `d54f61e` (#231, 20 Nov). CI green on that commit. No open PRs |
| App | Live at https://blkfndr.com | Answers 200. `/.well-known/stellar.toml` is 404, as expected before 2.3 |
| Factory admin | Deployer key, not the treasury | Unchanged: `get_admin` returns the deployer key `GDR4TPUF…`. The treasury has no open proposal |
| Operations Vault cutover | Unfinished; `get_ops_funding` returned `null` | Unchanged: `get_ops_funding` still returns `null` |
| Email | Resend refused every send (`422 Invalid from field`) | Unchanged and still failing: 0 ever sent, 47 failed, 62 skipped, 20 with no status. Latest failure 20 Nov, same `422` |
| Stellar SDK / protocol | SDK 16.3.1; RPC reported protocol 29 | RPC now reports **protocol 30** (stellar-rpc 30.0.1). App still on JS SDK 16.3.1 (17.4.0 is newest on npm); contracts on `soroban-sdk` 22.0.0. Reads through the CLI work; a deploy on protocol 30 is untested |
| Indexer | Current, nothing skipped | Current: last processed ledger 5902409 against a tip of 5902418. 189 events, none unprocessed, none in error |
| Projects | 28 on the factory | 28 (`get_project_count`), 28 in the listings table |

## Campaign baseline

Recorded once, before the campaign opens (plan item 1.5). Every campaign result is measured against this. Read from the live database on 24 Nov 2026, 15:55 UTC; no account had been created since 19 Nov, so the account figures are what they were on 23 Nov.

| Measure | Baseline (24 Nov) | Latest | Change |
|---|---:|---:|---:|
| Accounts | 30 | — | — |
| Accounts with a linked wallet | 18 | — | — |
| KYC-approved accounts | 16 | — | — |
| Distinct stakers | 15 wallets (10 of them linked to an account) | — | — |
| Builder vaults opened | 28, by 15 builders | — | — |
| Referred sign-ups | 0 | — | — |

How each was counted: accounts from `auth.users`; linked wallets from profiles with a wallet address; KYC-approved from distinct users with an approved request (2 more were rejected); stakers from distinct wallets in indexed `DEPOSIT/CONTRIB` events, across 16 vaults; vaults from the factory's `get_project_count`.

---

## Week 1 — 23–27 Nov

| # | Planned work | Status | PR | Evidence |
|---|---|---|---|---|
| 1.1 | Unified builder-record reader | ✅ | — | Read by the risk pipeline; run against the live attestation registry for all 15 builders on 27 Nov. Each report names the record it used by hash (`inputs.builderRecord`). Local branch, not merged |
| 1.2 | Risk analysis pipeline (three inputs, band and factors) | ✅ | — | `src/lib/risk/` (inputs, rules, model, build, pipeline), `POST /api/risk-run`, public reads at `/api/risk-reports?vault=` and `/api/risk-reports/<hash>`. `risk_reports` table applied to the live database on 27 Nov. 28 reports written on 27 Nov, rules only: 1 low, 23 medium, 4 high. The three inputs are still assumed, see blockers |
| 1.3 | Report-anchor registry written, tested, deployed on testnet | ✅ | — | Deployed on the reference set (`CD64QR4B…JHYC`) then on production testnet (`CAQ3KAVM…UQHF`), wasm sha256 `c4ff0e4b…`, admin the deployer key, attestor `GBT3SV7N…N6PP` (D1). Protocol 30 deploy works with `soroban-sdk` 22. `scripts/deploy-report-anchor.sh` |
| 1.4 | Campaign landing page, Freighter guide, testnet USDC claim, referral tracking | 🔧 | — | `/campaign`, `/campaign/freighter`, `POST /api/campaign/claim`, `GET /api/campaign/me`, migration `20261127100000_campaign_referrals.sql`. Tested locally, not live: needs the migration applied, a funded USDC distributor account, and `CAMPAIGN_USDC_*` env set. Email still failing |
| 1.5 | User baseline recorded | ✅ | — | [Campaign baseline](#campaign-baseline) above |
| 1.6 | Fee-bump sponsorship with caps, allowlist, kill switch | 🔧 | — | `POST /api/sponsor` on the ops key, wired into `use-stellar-contract.ts` with a self-pay fallback; migration `20261127110000_sponsor_usage.sql`. Off by default (`SPONSOR_ENABLED`); caps are placeholders until D3. Not live: migration not applied, no fee-bump on testnet yet |
| 1.7 | Reproducible build set up | ⬜ | — | — |

| Expected output | Met? | Evidence |
|---|---|---|
| Report-anchor registry live on testnet | ✅ | `CAQ3KAVM2MOWVAMEZIODYUIZFLTHYLZTPFDE45JZFXEF5X7RE3EFUQHF` (production testnet); `CD64QR4B743HQX4COLPKBGO7DSQDR5QPODQ7NREEMKZ4JOZLWNJNJHYC` (reference) |
| First risk reports generated on existing listings | ✅ | 28 of 28 anchored. First: project 20, report `ab63f45d…437c`, anchor tx `f069133c73492d6763505885ec5ebca59a9d468b93ebaf83dcd333e6d224a170`; `sha256sum` of `/api/risk-reports/ab63f45d…` equals the hash, and `find` on the registry returns it |
| Onboarding path live with sponsored fees | ⬜ | fee-bump tx: — |
| Campaign opens | ⬜ | URL: — |
| Same wasm hashes from two machines | ⬜ | hash table: — |

## Week 2 — 30 Nov–4 Dec

| # | Planned work | Status | PR | Evidence |
|---|---|---|---|---|
| 2.1 | Risk report on the project page before the stake step; re-run on listing change | ⬜ | — | — |
| 2.2 | KYC AI pre-check: document, consistency, selfie-match, duplicate | ⬜ | — | — |
| 2.3 | SEP-1 `stellar.toml` | ⬜ | — | — |
| 2.4 | SEP-10 challenge/response for wallet linking | ⬜ | — | — |
| 2.5 | Governance handover rehearsed on the reference deployment | ⬜ | — | — |
| 2.6 | Funnel view | ⬜ | — | — |
| 2.7 | First live onboarding session | ⬜ | — | — |

| Expected output | Met? | Evidence |
|---|---|---|
| Risk Analysis visible to backers, hashes verifiable on Stellar Expert | ⬜ | — |
| KYC pre-check running on test submissions | ⬜ | — |
| `stellar.toml` online; SEP-10 working | ⬜ | — |
| First campaign users staking | ⬜ | stake tx: — |

## Week 3 — 7–11 Dec

| # | Planned work | Status | PR | Evidence |
|---|---|---|---|---|
| 3.1 | KYC reviewer screen with AI recommendation and reasons; review log | ⬜ | — | — |
| 3.2 | Attestation write for approved users | ⬜ | — | — |
| 3.3 | Factory admin handed to the treasury on the live set | ⬜ | — | — |
| 3.4 | Owner-voted proposal executed | ⬜ | — | — |
| 3.5 | Public builder profile page | ⬜ | — | — |
| 3.6 | Indexer extended to report-anchor and KYC events | ⬜ | — | — |
| 3.7 | Second live onboarding session; builder outreach | ⬜ | — | — |

| Expected output | Met? | Evidence |
|---|---|---|
| KYC AI Attestation live end to end | ⬜ | attest tx: — |
| Factory governed by the treasury | ⬜ | `get_admin` reading: — |
| Builder profiles public | ⬜ | URL: — |
| Campaign users attested; new builder vaults opened | ⬜ | — |

## Week 4 — 14–18 Dec

| # | Planned work | Status | PR | Evidence |
|---|---|---|---|---|
| 4.1 | Negative-path testing across all deliverables | ⬜ | — | — |
| 4.2 | Security QA gate and dependency scans; fixes | ⬜ | — | — |
| 4.3 | Audit-Readiness Pack | ⬜ | — | — |
| 4.4 | Campaign close-out: evidence sheet, funnel report, user survey | ⬜ | — | — |
| 4.5 | Documentation, architecture diagram, public demo video, final evidence index | ⬜ | — | — |

| Expected output | Met? | Evidence |
|---|---|---|
| All acceptance criteria demonstrated | ⬜ | — |
| Audit-Readiness Pack and campaign results report published | ⬜ | — |
| Documentation and demo complete | ⬜ | — |

---

## Decisions

Open decisions from the plan. Record the answer, who gave it and the date.

| # | Decision | Needed by | Answer | Decided |
|---|---|---|---|---|
| D1 | Which key signs report anchors: managed attestor key or ops key | Day 1 | A dedicated attestor key, not the ops key | 2026-11-25, project owner |
| D2 | Selfie-match engine; selfies stored or discarded | End of week 1 | _open_ | — |
| D3 | Fee sponsorship: daily cap per account, total budget | Before 1.6 ships | _open_ | — |
| D4 | Owner signing dates in weeks 2 and 3 | End of week 1 | _open_ | — |
| D5 | Risk band on-chain, or only the report hash | Day 1 | The report hash only; the band stays in the off-chain report | 2026-11-25, project owner |

## Blockers and risks

| Item | State | Affects | Next step |
|---|---|---|---|
| Week 1 scope read from a partial copy of the SOW | Open | Week 1 | Check against the full SOW page 8. The risk pipeline's "three inputs" are not named in the repo; the schema assumes listing, builder record and vault terms |
| Local checkout 335 commits behind `origin/main` (20 Nov) | Closed 24 Nov | Day 1 | Local `main` fast-forwarded to `d54f61e`; dependencies reinstalled from the lockfile (zod 3 was installed against a zod 4 lockfile) |
| Day 1 ran a day late | Open | Week 1 | Six items remain for three working days |
| Owner votes on the critical path | Open | 2.5, 3.3, 3.4 | Book dates (D4) |
| Email still failing on 24 Nov (Resend `422 Invalid from field`, 0 ever sent) | Open | Campaign (1.4) | Fix the sender address before the campaign opens |
| Testnet moved to protocol 30; app on JS SDK 16.3.1, contracts on `soroban-sdk` 22 | Open | 1.3 and any deploy | Test a deploy on the reference set first; decide whether to move to JS SDK 17 |

## On-chain log

One row per transaction that counts as evidence: deploys, anchors, sponsored fee-bumps, attestations, governance votes.

| Date (UTC) | What | Network / deployment | Transaction or address |
|---|---|---|---|
| 2026-11-26 | Report-anchor registry deployed, attestor added | testnet-reference | `CD64QR4B743HQX4COLPKBGO7DSQDR5QPODQ7NREEMKZ4JOZLWNJNJHYC`; add_attestor tx `19b425d8…1e31` |
| 2026-11-26 | Report-anchor registry deployed, attestor added | testnet-production | `CAQ3KAVM2MOWVAMEZIODYUIZFLTHYLZTPFDE45JZFXEF5X7RE3EFUQHF`; txs `4cde64a3…c63d`, `c2a3c5ea…82a3` |
| 2026-11-26 17:56 | First risk report anchored (project 20, seq 0) | testnet-production | `f069133c73492d6763505885ec5ebca59a9d468b93ebaf83dcd333e6d224a170` |
| 2026-11-26 17:56–17:59 | 27 more risk reports anchored | testnet-production | `select anchor_tx from risk_reports` |

## Update log

| Date | Update |
|---|---|
| 2026-11-20 | Document prepared. Nothing started. |
| 2026-11-25 | D1 (dedicated attestor key) and D5 (hash only) decided. Report-anchor contract written with 16 tests, added to the workspace and `build-contracts.sh`; not deployed. |
| 2026-11-27 | Week 1 close: risk pipeline built, report-anchor registry deployed on both testnet sets, 28 reports stored and anchored. Campaign (1.4) and fee sponsorship (1.6) built and tested locally, not live. `risk_reports` migration applied to the live database through the Supabase connector, so its recorded version is the apply time, not `20261127120000`. |
| 2026-11-24 | Day 1 checklist run. Checkout synced, CI green. Live state re-read and campaign baseline recorded (1.5). Builder-record reader and risk report schema written with tests, and the report-anchor interface drafted, on local branch `sprint-2/day-1` (uncommitted). |
