# BLKFNDR — Sprint 2 progress (Instawards SOW)

_Last updated: 2026-11-20 · prepared before Day 1 · sprint runs Mon 23 Nov to Fri 18 Dec 2026_

Progress against the [Sprint 2 plan](plan.md). Item numbers match the plan. The platform-wide status stays in the root [progress.md](../../progress.md).

> **Merged is not deployed.** An item is ✅ only when its expected output has been seen on testnet or on the live site, with the evidence linked. A merged PR alone is 🔶.

**Status key:** ⬜ not started · 🔧 in progress · 🔶 merged, not live · ✅ live with evidence · ⛔ blocked

---

## Summary

| Week | Dates | Items | Done | Expected output met? |
|---|---|---:|---:|---|
| 1 | 23–27 Nov | 7 | 0 | ⬜ |
| 2 | 30 Nov–4 Dec | 7 | 0 | ⬜ |
| 3 | 7–11 Dec | 7 | 0 | ⬜ |
| 4 | 14–18 Dec | 5 | 0 | ⬜ |

**This week in short:** _the sprint has not started._

---

## Snapshot at sprint start

To be read on Day 1 (23 Nov), read-only, not inferred from merges. The "21 Oct" column is the last verified reading, from the root progress.md.

| Area | 21 Oct reading | Day 1 reading |
|---|---|---|
| `main` | `d1496c6` (#220) then; `8ca2f65` (#230) on 28 Oct | _to read_ |
| App | Live at https://blkfndr.com | _to read_ |
| Factory admin | Deployer key, not the treasury | _to read_ |
| Operations Vault cutover | Unfinished; `get_ops_funding` returned `null` | _to read_ |
| Email | Resend refused every send (`422 Invalid from field`) | _to read_ |
| Stellar SDK / protocol | SDK 16.3.1; RPC reported protocol 29 | _to read_ |
| Indexer | Current, nothing skipped | _to read_ |
| Projects | 28 on the factory | _to read_ |

## Campaign baseline

Recorded once on Day 1, before the campaign opens (plan item 1.5). Every campaign result is measured against this.

| Measure | Baseline (23 Nov) | Latest | Change |
|---|---:|---:|---:|
| Accounts | _to record_ | — | — |
| Accounts with a linked wallet | _to record_ | — | — |
| KYC-approved accounts | _to record_ | — | — |
| Distinct stakers | _to record_ | — | — |
| Builder vaults opened | _to record_ | — | — |
| Referred sign-ups | 0 | — | — |

---

## Week 1 — 23–27 Nov

| # | Planned work | Status | PR | Evidence |
|---|---|---|---|---|
| 1.1 | Unified builder-record reader | ⬜ | — | — |
| 1.2 | Risk analysis pipeline (three inputs, band and factors) | ⬜ | — | — |
| 1.3 | Report-anchor registry written, tested, deployed on testnet | ⬜ | — | — |
| 1.4 | Campaign landing page, Freighter guide, testnet USDC claim, referral tracking | ⬜ | — | — |
| 1.5 | User baseline recorded | ⬜ | — | — |
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
| D1 | Which key signs report anchors: managed attestor key or ops key | Day 1 | _open_ | — |
| D2 | Selfie-match engine; selfies stored or discarded | End of week 1 | _open_ | — |
| D3 | Fee sponsorship: daily cap per account, total budget | Before 1.6 ships | _open_ | — |
| D4 | Owner signing dates in weeks 2 and 3 | End of week 1 | _open_ | — |
| D5 | Risk band on-chain, or only the report hash | Day 1 | _open_ | — |

## Blockers and risks

| Item | State | Affects | Next step |
|---|---|---|---|
| Week 1 scope read from a partial copy of the SOW | Open | Week 1 | Check against the full SOW page 8 |
| Local checkout 335 commits behind `origin/main` (20 Nov) | Open | Day 1 | Sync before any work starts |
| Owner votes on the critical path | Open | 2.5, 3.3, 3.4 | Book dates (D4) |
| Email failing on 21 Oct | To re-check | Campaign | Read on Day 1 |
| Protocol 29 SDK support | To re-check | 1.3 | Read on Day 1 |

## On-chain log

One row per transaction that counts as evidence: deploys, anchors, sponsored fee-bumps, attestations, governance votes.

| Date (UTC) | What | Network / deployment | Transaction or address |
|---|---|---|---|
| — | — | — | — |

## Update log

| Date | Update |
|---|---|
| 2026-11-20 | Document prepared. Nothing started. |
