# BLKFNDR — Sprint 2 plan (Instawards SOW)

_Written 2026-11-20. Day 1 is Monday 2026-11-23. Planned against `origin/main` at `8ca2f65` (#230, 2026-10-28)._

Four weeks, one SOW table row per week, **Mon 23 Nov to Fri 18 Dec 2026**. Progress against this plan is tracked in [progress.md](progress.md).

> **Source gap.** This plan was built from pages 8–9 of the SOW. The week 1 row starts on page 8 and the copy used here cuts in partway through it, so week 1 may have planned work above "Unified builder-record reader" that is missing below. Check against the full SOW before Day 1.

> **Merged is not deployed.** A Soroban contract only changes when it is redeployed, and a migration changes nothing until it is applied to the live database. Every "expected output" below means seen on testnet, not merged.

---

## Starting point

What `origin/main` already has for each SOW item. The live state was last verified on 2026-10-21 (root `progress.md`); it has to be re-read on Day 1.

| SOW item | State on `main` | Starting point |
|---|---|---|
| Builder-record reader | Partly there | Attestation registry `get_builder_summary` / `get_builder_history`; `src/lib/data/vault-record.ts` |
| Risk analysis pipeline | Not started | The Ollama vision-model call in `src/ai/flows/improve-listing-quality.ts` is reusable |
| Report-anchor registry | Not started | New contract. `scripts/deploy-contracts.sh` and `deployments/testnet-reference/` are ready for it |
| Fee-bump sponsorship | Designed, not built | `docs/design/web3-accessibility-redesign.md` specifies `/api/sponsor` on the ops key with caps, allowlist and kill switch |
| Campaign landing, USDC claim, referrals, funnel | Not started | `WalletSetupFlow.tsx`, `WalletReadinessCard.tsx`, `enable-asset.ts` |
| Reproducible build | Partly there | CI records wasm hashes and pins Rust 1.81. No second-machine proof |
| KYC AI pre-check | Not started | Server-side rules in `src/lib/kyc/rules.ts`. No selfie capture, no duplicate check |
| KYC reviewer screen | Exists without AI | Reviewer gate, self-review refusal and attestation write are live |
| SEP-1 `stellar.toml` | Not started | — |
| SEP-10 wallet linking | Not started | The wallet-link challenge (#200) signs a custom message, not a SEP-10 transaction |
| Factory admin to treasury | Not done | Admin was still the deployer key on 2026-10-21; the Operations Vault cutover was also unfinished |
| Public builder profile | Not started | Same builder-record reader |
| Indexer for report-anchor and KYC events | Not started | `src/lib/event-indexer.ts`, `src/lib/indexer-scan.ts` |
| Security QA gate, dependency scans | Mostly there | `audit:gate`, SBOM, `test:authz`, `test:db`, ZAP baseline |

---

## Week 1 — 23–27 Nov: foundations and campaign open

| # | Planned work | Notes |
|---|---|---|
| 1.1 | Unified builder-record reader | One typed output, read by the risk pipeline and the builder profile |
| 1.2 | Risk analysis pipeline: three inputs, risk band and factors | Report serialized deterministically so its hash is repeatable |
| 1.3 | Report-anchor registry written, tested and deployed on testnet | Append-only, attestor-gated, emits an event. Reference set first, then production testnet |
| 1.4 | Campaign landing page, Freighter guide, testnet USDC claim, referral tracking | Referral table needs a migration |
| 1.5 | Record the user baseline | Day 1, before the campaign opens |
| 1.6 | Fee-bump sponsorship with caps, allowlist and kill switch | Self-pay fallback stays in every sheet |
| 1.7 | Reproducible build set up | Pinned Docker build; hashes compared between CI and a second machine |

**Expected output (cumulative):** report-anchor registry live on testnet · first risk reports generated on existing listings · onboarding path live with sponsored fees · campaign opens · same wasm hashes from two machines.

## Week 2 — 30 Nov–4 Dec: visible to backers

| # | Planned work | Notes |
|---|---|---|
| 2.1 | Risk report shown on the project page before the stake step; re-run on listing change | |
| 2.2 | KYC AI pre-check: document, consistency, selfie-match and duplicate checks | Test submissions only this week |
| 2.3 | SEP-1 `stellar.toml` | Served at `/.well-known/stellar.toml` |
| 2.4 | SEP-10 challenge/response for wallet linking | Replaces the custom wallet-link message |
| 2.5 | Governance handover rehearsed on the reference deployment | |
| 2.6 | Funnel view | Admin dashboard |
| 2.7 | First live onboarding session | |

**Expected output (cumulative):** Risk Analysis visible to backers, hashes verifiable on Stellar Expert · KYC pre-check running on test submissions · `stellar.toml` online, SEP-10 working · first campaign users staking.

## Week 3 — 7–11 Dec: KYC end to end and the live handover

| # | Planned work | Notes |
|---|---|---|
| 3.1 | KYC reviewer screen with AI recommendation and reasons; review log | |
| 3.2 | Attestation write for approved users | Existing path; confirm it end to end with the pre-check in front |
| 3.3 | Factory admin handed to the treasury on the live set | Needs 2-of-3 owner signatures |
| 3.4 | Owner-voted proposal executed | |
| 3.5 | Public builder profile page | |
| 3.6 | Indexer extended to report-anchor and KYC events | |
| 3.7 | Second live onboarding session; builder outreach for new projects | |

**Expected output (cumulative):** KYC AI Attestation live end to end · factory governed by the treasury · builder profiles public · campaign users attested, new builder vaults opened.

## Week 4 — 14–18 Dec: proof and close-out

| # | Planned work | Notes |
|---|---|---|
| 4.1 | Negative-path testing across all deliverables | |
| 4.2 | Security QA gate and dependency scans; fixes | |
| 4.3 | Audit-Readiness Pack | |
| 4.4 | Campaign close-out: evidence sheet, funnel report, user survey | |
| 4.5 | Documentation, architecture diagram, public demo video, final evidence index | |

**Expected output (cumulative):** all acceptance criteria demonstrated · Audit-Readiness Pack and campaign results report published · documentation and demo complete.

---

## Day 1 — Monday 23 Nov

1. Bring the local checkout up to `origin/main` and confirm CI is green.
2. Re-read live state: Operations Vault cutover, factory admin, email, SDK and protocol version.
3. Record the campaign user baseline: accounts, linked wallets, KYC-approved, stakers.
4. Write the report-anchor contract interface and the risk report schema. The rest of week 1 depends on these two.
5. Start the builder-record reader.

---

## Risks

| Risk | Affects | What to do |
|---|---|---|
| Owner votes are on the critical path | 2.5, 3.3, 3.4 | Book signing dates now; finish the Operations Vault cutover before week 3 |
| Email was failing on 2026-10-21 (Resend refused the sender address) | Campaign notifications, receipts | Re-check on Day 1; fix before the campaign opens |
| Selfie-match on a general vision model is weak, and storing selfies changes `docs/privacy.md` | 2.2, 3.1 | Decide the engine and the retention rule in week 1 |
| Sponsored fees can be drained | 1.6 | Caps and the kill switch ship with the endpoint, not after it |
| Protocol 29 SDK support was open on 2026-10-21 | 1.3 and any deploy | Re-check on Day 1 |
| Week 1 scope may be incomplete (source gap above) | Week 1 | Check against the full SOW |

## Open decisions

| # | Decision | Needed by |
|---|---|---|
| D1 | Which key signs report anchors: a managed attestor key or the ops key | Day 1 (blocks 1.3) |
| D2 | Selfie-match engine, and whether selfies are stored or discarded after the check | End of week 1 |
| D3 | Fee sponsorship: daily cap per account and total budget | Before 1.6 ships |
| D4 | Dates the owners can sign in weeks 2 and 3 | End of week 1 |
| D5 | Whether the risk band itself goes on-chain, or only the report hash | Day 1 (blocks 1.3) |
