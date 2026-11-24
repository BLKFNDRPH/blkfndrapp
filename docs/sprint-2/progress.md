# BLKFNDR — Sprint 2 progress (Instawards SOW)

_Last updated: 2026-11-24 · Day 1 checklist run on Tue 24 Nov, a day late · sprint runs Mon 23 Nov to Fri 18 Dec 2026_

Progress against the [Sprint 2 plan](plan.md). Item numbers match the plan. The platform-wide status stays in the root [progress.md](../../progress.md).

> **Merged is not deployed.** An item is ✅ only when its expected output has been seen on testnet or on the live site, with the evidence linked. A merged PR alone is 🔶.

**Status key:** ⬜ not started · 🔧 in progress · 🔶 merged, not live · ✅ live with evidence · ⛔ blocked

---

## Summary

| Week | Dates | Items | Done | Expected output met? |
|---|---|---:|---:|---|
| 1 | 23–27 Nov | 7 | 1 | ⬜ |
| 2 | 30 Nov–4 Dec | 7 | 0 | ⬜ |
| 3 | 7–11 Dec | 7 | 0 | ⬜ |
| 4 | 14–18 Dec | 5 | 0 | ⬜ |

**This week in short:** Day 1 checklist run on 24 Nov. Live state re-read and baseline recorded (1.5 done). Builder-record reader (1.1) and the risk report schema are written and tested on a local branch, not merged. D1 and D5 decided on 25 Nov; the report-anchor contract (1.3) is written and tested, not deployed. Testnet is now on protocol 30.

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
| 1.1 | Unified builder-record reader | 🔧 | — | Written with tests on local branch `sprint-2/day-1`: `src/lib/builder-record.ts`, `src/lib/data/builder-record.ts`. Nothing reads it yet, and it has not been run against the live registry from the app |
| 1.2 | Risk analysis pipeline (three inputs, band and factors) | 🔧 | — | Report schema and deterministic hash only (`src/lib/risk/report.ts`). No pipeline yet. The three inputs are assumed, see blockers |
| 1.3 | Report-anchor registry written, tested, deployed on testnet | 🔧 | — | Contract written with 16 tests on local branch `sprint-2/day-1` (`contracts/blkfndr-report-anchor`), wasm sha256 `c4ff0e4b…` built locally. Not deployed: needs the attestor key and a deploy test on protocol 30 |
| 1.4 | Campaign landing page, Freighter guide, testnet USDC claim, referral tracking | ⬜ | — | — |
| 1.5 | User baseline recorded | ✅ | — | [Campaign baseline](#campaign-baseline) above |
| 1.6 | Fee-bump sponsorship with caps, allowlist, kill switch | ⬜ | — | — |
| 1.7 | Reproducible build set up | ⬜ | — | — |

| Expected output | Met? | Evidence |
|---|---|---|
| Report-anchor registry live on testnet | ⬜ | contract address: — |
| First risk reports generated on existing listings | ⬜ | anchor tx: — |
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
| — | — | — | — |

## Update log

| Date | Update |
|---|---|
| 2026-11-20 | Document prepared. Nothing started. |
| 2026-11-25 | D1 (dedicated attestor key) and D5 (hash only) decided. Report-anchor contract written with 16 tests, added to the workspace and `build-contracts.sh`; not deployed. |
| 2026-11-24 | Day 1 checklist run. Checkout synced, CI green. Live state re-read and campaign baseline recorded (1.5). Builder-record reader and risk report schema written with tests, and the report-anchor interface drafted, on local branch `sprint-2/day-1` (uncommitted). |
