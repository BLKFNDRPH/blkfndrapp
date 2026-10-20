# QA and Test Plan: Bonded Vault, Threshold Release & Attestation, Web App + Indexer + Demo

Version 1.1, 2026-10-20 (§11 gains the measured coverage); first issued 2026-10-13. Covers the three grant deliverables below, as built on `main` at `1f4ccca`.

| # | Deliverable | Evidence document |
|---|---|---|
| I | Bonded Vault smart contract (Soroban / Rust) | [smart-contracts.md](../smart-contracts.md), this plan |
| II | Contribution, threshold-release & attestation flow | [contribution-threshold-attestation.md](contribution-threshold-attestation.md) |
| III | Web interface, lightweight indexer and testnet demo | [web-app-indexer-demo.md](web-app-indexer-demo.md), [testnet-demo-script.md](testnet-demo-script.md) |

The plan says what is tested, how, by which existing test or transaction, and what still has to run before each deliverable can be signed off. Test case IDs are stable so a reviewer can tick them off.

---

## 1. Scope

### In scope

- **Contracts:** [blkfndr-vault](../../contracts/blkfndr-vault/src/lib.rs), [blkfndr-attestation](../../contracts/blkfndr-attestation/src/lib.rs), [blkfndr-factory](../../contracts/blkfndr-factory/src/lib.rs). The factory is in scope because it creates the vault, locks the bond and fixes the voting window and minimum contribution.
- **Web app:** the project page, stake sheet, vote panel, refund sheet, Record tab, Freighter wallet linking and signing, wallet readiness gates.
- **Indexer:** [event-indexer.ts](../../src/lib/event-indexer.ts), [indexer-scan.ts](../../src/lib/indexer-scan.ts), `POST /api/indexer`, the `indexer-cron` container, the [vault replay](../../src/lib/vault-replay.ts) and [replay check](../../scripts/replay-check.mjs).
- **Governance keeper:** [governance-keeper.ts](../../src/lib/governance-keeper.ts). It sends permissionless calls (`release_milestone`, `settle_lapsed_milestone`, `settle`, `return_bond`) the vault has already decided. It is what makes "automatic" refund, forfeiture and bond return happen without a stakeholder or builder pressing a button.
- **The recorded demo.**

### Out of scope

Identity/KYC, admin roster, treasury and operations contracts beyond their role as a precondition (a builder must be KYC-approved to open a vault); Mainnet; email notifications; AI features; performance of pages other than the project list and project page.

---

## 2. Environments and test data

| Environment | What | Used for |
|---|---|---|
| **Unit (Soroban test env)** | `cargo test --workspace`, mocked ledger time, Stellar Asset Contract test token | Every contract rule, including paths that take days or months on a real network (7-day window, 90-day stall) |
| **Reference testnet deployment** | Factory `CBYDZWQQ…3ZK6`, attestation `CDKERKLK…I4UG`, vault wasm `e9009410…`, accounts builder + c1–c5 + an unrelated caller | Scripted end-to-end transactions ([reference-scenario.sh](../../scripts/reference-scenario.sh)), log in [transactions.tsv](../../deployments/testnet-reference/transactions.tsv) |
| **Production testnet** | [testnetv2.blkfndr.com](https://testnetv2.blkfndr.com), factory `CBRUIRJX…PLINO`, attestation `CDEN2LU4…SQFX` ([contracts.env](../../deployments/testnet-production/contracts.env)) | Web app, Freighter, indexer, replay check, demo |
| **Local web** | `npm test` (node --test), `npm run dev` | Indexer scan, vault replay, vote panel, live-project parsing |

**Token.** Circle testnet USDC, SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, 7 decimals (5 USDC = 50,000,000 base units).

**Wallets.** Freighter on Testnet. A fresh demo account for anything recorded. Never a personal or Mainnet key.

**Factory parameters under test** (read back from the chain): voting window 604,800 s (7 days); minimum contribution 5 USDC; minimum bond 500 bps (5% of goal); flat builder fee 1 USDC.

---

## 3. Test approach

Each requirement is proved at the lowest level that can prove it, then shown once on testnet.

| Level | Tool | Proves | Gate |
|---|---|---|---|
| L1 Unit | `cargo test --workspace` | Every contract rule, every refusal, every event payload | All pass |
| L1 Lint | `cargo clippy --workspace --all-targets -- -D warnings` | No warnings | Clean |
| L2 Build reproducibility | `scripts/build-contracts.sh`, then `stellar contract fetch` + `sha256sum` | Deployed wasm = reviewed source | Hashes match |
| L3 Testnet scenario | `scripts/reference-scenario.sh` | Each claim has a real transaction. Refusals are simulated and must fail with the expected `Error(Contract, #n)` | Script exits 0 |
| L4 Web unit | `npm test` | Indexer scan, replay rules, vote panel | All pass |
| L5 State reconstruction | `node --env-file=.env.local scripts/replay-check.mjs` | Events alone rebuild every vault, field by field | `N of N vaults match`, exit 0 |
| L6 Manual UI | Browser + Freighter on the live site | The few-taps stake, gates, vote, refund, Record tab | Checklists in §6 |
| L7 Demo | Recording per [demo script](testnet-demo-script.md) | End-to-end on camera | Video + tx hash published |

**How a refusal is tested on testnet.** The transaction is simulated, not submitted, and the test passes only when simulation fails with the exact contract error. A refusal never costs a fee and never lands on chain, so the evidence is the simulation result logged in `transactions.tsv`.

**Error codes referenced below** (vault): 2 InvalidStatus, 5 GoalAlreadyReached, 6 InvalidConfiguration, 7 FundingDeadlinePassed, 9 NoFundsToRefund, 10 AlreadyInitialized, 12 KYCInvalid, 14 MilestoneAlreadyReleased, 15 VotingNotOpen, 16 VotingAlreadyOpen, 17 VotingClosed, 18 AlreadyVoted, 19 NotAContributor, 20 ThresholdNotMet, 21 ThresholdMet, 22 VotingWindowNotElapsed, 23 MilestoneFailed, 24 BelowMinimumContribution, 25 NotStalled. Attestation: 3 NotAVault, 4 AlreadyAttested, 5 RecordNotFound, 6 InvalidRecord, 7 UntrustedFactory.

---

## 4. Deliverable I: Bonded Vault contract

Status key: **✅** passing in unit tests and/or shown on testnet; **⏳** scheduled; **🔲** not yet run; **—** not applicable at that level.

### 4.1 Vault creation and the performance bond

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| VLT-01 | Create a vault through the factory with a valid goal, deadline, milestones and bond | One transaction creates the vault, transfers the bond into it and the 1 USDC fee to the treasury. Events `VAULT/INIT`, `BOND/POSTED`, `FACTORY/DEPLOY` | `bond_is_locked_at_creation_and_fee_is_flat`, `deploys_a_vault_with_the_bond_already_locked` | ✅ Project A `ca0f0455…` |
| VLT-02 | Builder lacks the USDC for the bond | Whole call fails; no vault exists | `a_builder_who_cannot_fund_the_bond_gets_no_vault` | 🔲 |
| VLT-03 | Bond below 5% of goal | Refused | `rejects_a_bond_below_the_platform_minimum` | 🔲 |
| VLT-04 | Builder not KYC-approved | Refused, `#12` | `rejects_a_builder_without_kyc` | 🔲 |
| VLT-05 | Milestone amounts do not sum to the goal | Refused, `#6` | `rejects_milestones_that_do_not_sum_to_the_goal` | — |
| VLT-06 | More than 20 milestones | Refused | `rejects_more_milestones_than_the_cap` | — |
| VLT-07 | Deadline in the past | Refused | `rejects_a_deadline_in_the_past` | — |
| VLT-08 | `initialize` called a second time | Refused, `#10` | `cannot_be_initialized_twice` | — |
| VLT-09 | Vault trusts only modules the factory supplies (token, identity, attestation) | A caller cannot point a vault at its own registry | `the_vault_trusts_only_factory_supplied_modules` | — |
| VLT-10 | Every vault gets its own address and project id; a replacement factory continues numbering | Unique ids; production starts at 12 | `each_vault_gets_its_own_address_and_project_id`, `a_replacement_factory_continues_the_numbering` | ✅ production #12–#22 |
| VLT-11 | Fee is flat and paid by the builder only | No percentage setting exists; contributor deposits are never reduced | `the_fee_is_flat_and_has_no_percentage_setting`, `contributions_are_recorded_whole_with_no_fee_deducted` | ✅ Project A: builder net +29 USDC |

### 4.2 Pooled contributions

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| VLT-12 | Deposit ≥ 5 USDC while raising | Balance recorded whole, `DEPOSIT/CONTRIB (project, contributor, amount, new_total)` | `contributions_are_recorded_whole_with_no_fee_deducted` | ✅ `15b348b6…` |
| VLT-13 | Deposit that reaches the goal | Raise closes in the same call, state `Funded`, `VAULT/FUNDED` | `reaching_the_goal_closes_the_raise` | ✅ `3797f538…` |
| VLT-14 | Deposit that would overshoot the goal | Refused, `#5`; nothing moves; exactly the remainder still fits | `rejects_a_deposit_that_overshoots_the_goal` (added with this plan, finding 6) | ✅ Project C, 2026-10-20: a 16 USDC deposit into a raise 15 short was refused `#5` in simulation; 5 USDC then went in |
| VLT-15 | Deposit after the deadline | Refused. The state check runs first, so the call fails `#2` (the vault already reads Failed or Funded); the `#7` guard behind it is a backstop | `rejects_contributions_after_the_deadline` | ✅ Project C, 2026-10-20: refused `#2` in simulation after the deadline |
| VLT-16 | Deposit after the raise closed | Refused, `#2` | `reaching_the_goal_closes_the_raise` | 🔲 |
| VLT-17 | A wallet tops up | Still one contributor; count unchanged; balance sums | `a_backer_who_tops_up_is_still_one_wallet` | — |
| VLT-18 | Contributor list read | Paged, page size clamped to 100 | `contributors_are_paged_rather_than_returned_whole`, `an_oversized_page_request_is_clamped` | — |
| VLT-19 | Deposit, vote or refund signed by someone other than the contributor | Refused by `require_auth`; the same call signed by the right address succeeds | `a_deposit_needs_the_contributors_own_signature`, `a_vote_needs_the_contributors_own_signature`, `a_refund_needs_the_contributors_own_signature` (added with this plan, finding 7) | 🔲 |

### 4.3 Milestone release

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| VLT-20 | Builder opens a milestone vote on a funded vault | `MILESTN/VOTEOPEN (project, id, opens, closes)`; closes = opens + 604,800 | `only_the_builder_opens_a_window_and_only_once` | ✅ `031a72fc…` |
| VLT-21 | Non-builder opens a vote; builder opens twice | Refused (auth), `#16` | `only_the_builders_signature_opens_a_vote`, `only_the_builder_opens_a_window_and_only_once` | 🔲 |
| VLT-22 | Carried milestone released by an unrelated account | Tranche to the builder, `MILESTN/RELEASE (project, id, tranche, released_total)` | `release_is_permissionless_once_contributors_have_voted` | ✅ `d12da348…` |
| VLT-23 | Release a milestone twice | Refused, `#14` | `a_milestone_cannot_be_released_twice` | — |
| VLT-24 | Release before a vote opened / below threshold | `#15` / `#20` | `release_requires_at_least_three_distinct_wallets` | ✅ `#20` refused, Project A |
| VLT-25 | Last milestone released | State `Completed`, bond returned to builder (`BOND/RETURNED`), attestation `Completed` written, vault balance 0 | `releasing_every_milestone_completes_the_project_and_returns_the_bond` | ✅ `99e01fee…` |
| VLT-26 | Release resets the 90-day stall clock | `settle_stalled` refused `#25` until 90 days after the last release | `releasing_a_milestone_resets_the_stall_clock` | — |

### 4.4 All-or-nothing refund when the goal is missed

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| VLT-27 | Deadline passes below goal; anyone calls `settle` | State `Failed`, `VAULT/FAILED`, attestation `FailedToFund` | `failing_to_fund_is_recorded_without_blaming_the_builder` | ✅ Project C, 2026-10-20: settled by `ref-anyone`, [`56785fa8…`](https://stellar.expert/explorer/testnet/tx/56785fa811fd00f968d3b16fdd733f3d2bc2e072dc56ee362780a2a8cd8eb206), record outcome 2. Production #2, #3 read `failed` (replay check) |
| VLT-28 | Each contributor claims after a failed raise | Exactly their principal, `DEPOSIT/REFUND` | `an_unfunded_project_returns_principal_and_the_builders_bond` | ✅ Project C: c1 and c2 each received exactly 5 USDC, [`46c3287b…`](https://stellar.expert/explorer/testnet/tx/46c3287b585b44a471c686a188389ef48dd6666e650239873fd4f5d7fd016802) and [`09460e24…`](https://stellar.expert/explorer/testnet/tx/09460e248141b9512fd63ba991445691d6273a1ef8af22a7a8f2431bcab40b6b). Refunds after a forfeiture are VLT-36 |
| VLT-29 | Builder's bond returned after a failed raise, called by anyone | Bond to builder, `BOND/RETURNED`; second call `#9` | same | ✅ Project C: [`97f5c650…`](https://stellar.expert/explorer/testnet/tx/97f5c650b2e0ec76f1a2c6ac24b6d4aec389a1a1ecb4fc05bdc8d55d02017970) sent by `ref-anyone`; the second call refused `#9` in simulation |
| VLT-30 | Last claimant in a `Failed` vault | Does **not** sweep the builder's unreturned bond | `an_unfunded_project_returns_principal_and_the_builders_bond`: both backers claim before `return_bond`, and the builder still receives the whole bond | ✅ Project C: after c2's claim, the last, the vault still held the 1 USDC bond, and `return_bond` then paid it whole |
| VLT-31 | Refund while still raising / funded / active | Refused, `#2` | `refunds_are_unavailable_while_a_project_is_still_live` | ✅ Project C: `claim_refund` and `return_bond` while the raise was open, both refused `#2` in simulation |
| VLT-32 | A contributor claims twice | Second claim `#9` | `a_backer_claims_once` | ✅ Project C: c1's second claim refused `#9` in simulation |

### 4.5 Bond forfeiture and pro-rata distribution on milestone failure

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| VLT-33 | Window closes below threshold; an unrelated account calls `settle_lapsed_milestone` | Milestone failed, state `Refunding`, `MILESTN/FAILED`, `BOND/SLASHED`, attestation `FailedWithForfeiture`, all in one tx | `a_window_that_closes_below_threshold_fails_the_milestone` | ✅ Project B, 2026-10-13: [`968e1ad8…`](https://stellar.expert/explorer/testnet/tx/968e1ad8b7156173cc2c6635aa59072ee26f56a15b79ee8b5d7d9172592afbc1) |
| VLT-34 | Settle before the window closes | Refused, `#22` | `a_lapsed_window_cannot_be_settled_early` | ✅ Project B, simulated |
| VLT-35 | Settle a window that carried | Refused, `#21` (it is a release waiting to happen) | `a_window_that_met_threshold_cannot_be_declared_failed` | — |
| VLT-36 | Each contributor claims after forfeiture | `contribution × (raised − released) / raised + contribution × bond / raised` | `forfeited_bond_is_distributed_pro_rata_with_the_remaining_balance` | ✅ Project B: exactly 2.5 USDC each to c1–c5, five transactions. Production: one claim each on #5 and #7 (2026-10-15) and #10 (2026-10-19), and the replay check matched 25 of 25 vaults after them |
| VLT-37 | Truncation dust | Last claimant sweeps the remainder; vault ends at exactly 0 | same | ✅ Project B: vault balance 0 after c5, the last claimant |
| VLT-38 | Builder abandons a funded vault (no vote opened for 90 days) | Anyone calls `settle_stalled`: first open milestone failed, `VAULT/STALLED`, `BOND/SLASHED`, refunds open | `an_abandoned_funded_vault_can_be_reclaimed_for_contributors` | — (90 days; unit only) |
| VLT-39 | Stall attempted while a vote is open, or while a carried vote awaits release | `#16` / `#21` | `an_open_vote_is_not_abandonment`, `a_carried_vote_cannot_be_stalled_out` | — |

### 4.6 Events, queries and storage

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| VLT-40 | Every money movement emits an event | Deposit `DEPOSIT/CONTRIB`; release `MILESTN/RELEASE`; refund `DEPOSIT/REFUND`; forfeiture `BOND/SLASHED` (+ `MILESTN/FAILED` or `VAULT/STALLED`); bond `BOND/POSTED` / `BOND/RETURNED` | asserted per test above | ✅ visible on Stellar Expert per tx; replay check consumes them (IDX-08) |
| VLT-41 | Read-only queries | `get_state`, `get_info`, `get_balance`, `get_voting_weight`, `get_milestone_*` never change state or move tokens | `queries_do_not_mutate_state_or_move_tokens` | — |
| VLT-42 | Lazy state | A vault past its deadline reads `Funded`/`Failed` from `get_state` before anyone settles it | `effective_state` via several tests | ✅ replay check, production #2/#3 |
| VLT-43 | Storage TTL | Persistent entries extended ~30 days on write; the keep-alive cron keeps vault code and instances live | — | 🔲 check `keep-alive-cron` last run and a vault instance's `liveUntilLedger` |
| VLT-44 | Re-entrancy (checks-effects-interactions) | `bond_returned` / state persisted before the external attestation call and the transfer | code review of `return_bond`, `settle_stalled`, `release_milestone` | — |
| VLT-45 | Arithmetic | All sums use `checked_*`; overflow panics instead of wrapping | code review + `the_capped_total_matches_a_direct_sum` (randomised) | — |

### 4.7 Build and deployment integrity

| ID | Case | Expected |
|---|---|---|
| VLT-46 | `cargo test --workspace` | All pass |
| VLT-47 | `cargo clippy --workspace --all-targets -- -D warnings` | Clean |
| VLT-48 | Fetch each deployed wasm and hash it | Vault `e9009410…` and attestation `66f73252…` match a build of the current source. Factory: production `CBRUIRJX…` = current source `eb20ce0f…`; the reference factory `ab2ad12e…` was built from `5df0bb7`, before `ebc2c1e` (project id continuation). A local build on 2026-10-13 reproduced `e9009410…`, `66f73252…` and `eb20ce0f…`; the on-chain fetch is still to do |
| VLT-49 | Factory stores the vault hash | `BLKFNDR_VAULT_WASM_HASH` = `e9009410…` on the production factory |
| VLT-50 | Source is public, MIT | Repo and licence reachable at the commit cited |

---

## 5. Deliverable II: Contribution, threshold release and attestation

### 5.1 The $5 contribution path and vote weight

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| CTA-01 | 4.99 USDC deposit | Refused, `#24` | `enforces_the_five_dollar_minimum` | ✅ simulated, Project A |
| CTA-02 | Exactly 5.00 USDC | Accepted | same | ✅ Project A c2–c5 |
| CTA-03 | One vote unit per 1 USDC, recorded at deposit | `get_voting_weight` = balance until the cap applies | `voting_weight_is_one_unit_per_unit_contributed` | ✅ Project A |
| CTA-04 | 20% cap | A wallet with 10 of 30 votes with 6 | same, `a_majority_contributor_cannot_release_alone` | ✅ c1 weight 6 |
| CTA-05 | Weights cannot shift during a vote | Raise is closed when votes open; cap computed from the fixed total | `a_late_whale_is_counted_in_the_capped_total` | — |
| CTA-06 | Capped total is exact for skewed raises | Equals a direct sum over all balances | `the_capped_total_matches_a_direct_sum`, `a_fourth_capped_wallet_is_counted_in_the_capped_total` | — |

### 5.2 Threshold rule (all three conditions)

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| CTA-07 | > 50% of capped weight but only two wallets | `#20` | `release_requires_at_least_three_distinct_wallets` | ✅ Project A M1, 11 of 26 |
| CTA-08 | Three wallets clear the weight but hold ≤ 50% of the money | `#20`; `get_milestone_stake` = `(150000000, 150000001)` | `small_wallets_cannot_outvote_most_of_the_money` | ✅ Project A M2 |
| CTA-09 | Weight + three wallets + money majority | Release succeeds | `a_capped_majority_carries_without_every_backer` | ✅ `d12da348…`, `99e01fee…` |
| CTA-10 | Largest holder alone | Can block but never release | `a_majority_holder_can_block_a_release_but_never_make_one_alone` | ✅ (c1 alone did not carry) |
| CTA-11 | Unanimous vote | Always carries, whatever the distribution | `a_unanimous_vote_always_carries`, `a_concentrated_raise_releases_when_every_backer_approves` | — |
| CTA-12 | One or two backers | Every backer must approve; then it carries | `a_sole_backer_releases_with_one_vote`, `two_backers_release_when_both_approve`, `a_tiny_raise_still_releases_when_every_backer_approves` | — |
| CTA-13 | Sole backer silent | Milestone fails at window close | `a_sole_backer_who_does_not_vote_still_fails_the_milestone` | — |
| CTA-14 | Window short of the wallet floor | Lapses and fails | `a_window_short_of_the_wallet_floor_lapses` | — |
| CTA-15 | Vote twice on one milestone | `#18` | `a_contributor_votes_once_per_milestone` | 🔲 |
| CTA-16 | Non-contributor votes | `#19` | `non_contributors_have_no_vote` | 🔲 |
| CTA-17 | Vote before window opens / after it closes | `#15` / `#17` | `votes_are_rejected_before_the_window_opens_and_after_it_closes` | 🔲 |
| CTA-18 | No multisig, no appointed keys | Vault has no admin entrypoint; release callable by anyone; only contributor signatures count | `release_is_permissionless_once_contributors_have_voted`; `stellar contract info interface` on the vault | ✅ releases sent by the unrelated caller |
| CTA-19 | Fixed 7-day window, set at creation | Factory reads 604,800 s; vault copies it; `closes − opens` in `VOTEOPEN` = 604,800 | factory `stores_the_platform_configuration` | ✅ Project B M2 window |

### 5.3 Fail-closed and the permissionless refund path

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| CTA-20 | Silence never pays the builder | No approvals → window closes → failed, never released | `silence_never_releases_funds` | ✅ Project B M2: one approval, failed, never released ([`968e1ad8…`](https://stellar.expert/explorer/testnet/tx/968e1ad8b7156173cc2c6635aa59072ee26f56a15b79ee8b5d7d9172592afbc1)) |
| CTA-21 | Lapse settled by an unrelated account | Succeeds without builder, admin or platform | VLT-33 | ✅ Project B, settled by `ref-anyone` |
| CTA-22 | Each contributor claims with their own signature | Pro-rata principal remaining + pro-rata bond | VLT-36 | ✅ Project B, each refund signed by its own contributor |
| CTA-23 | Keeper closes lapsed stages without being asked | Within one keeper interval (900 s) after a window lapses on a production vault, `settle_lapsed_milestone` is sent by the keeper key; it never sends a call the vault refuses | keeper dry run | ✅ observed: the keeper key `GDOCUSXG…` closed real lapses on #8 ([`c98187e3…`](https://stellar.expert/explorer/testnet/tx/c98187e374c3558a2411f390b4b207895dc068333903e64f5df485075afd3870), 2026-10-10), #11 ([`91202582…`](https://stellar.expert/explorer/testnet/tx/9120258275e79b01fce63feb8f06ef0bc0ff52da6d7e846bc59bfaae54cfc6c7)) and #10 ([`96bbeab3…`](https://stellar.expert/explorer/testnet/tx/96bbeab37446665ee55f3c5bd98599e4319d7f25a5c4e8b12f3253484cbef511), 2026-10-12). Every lapse since #131 was settled within one interval of its window closing: #5 after 285 s, #7 after 710 s, #8 after 760 s, #11 after 560 s and #10 after 765 s (window close from `VOTEOPEN`, settle time from `MILESTN/FAILED`). 🔲 the dry run against live |

### 5.4 Builder attestation

| ID | Case | Expected | Unit test | Testnet |
|---|---|---|---|---|
| CTA-24 | Completed project | Record: builder, vault, project id, outcome 0 `Completed`, total raised, bond, milestones total/approved, `closed_at` | `completion_writes_a_permanent_builder_record` | ✅ Project A, `get_record` JSON in the evidence doc |
| CTA-25 | Forfeited project | Outcome 1 `FailedWithForfeiture`, milestones approved = those released before failure | `forfeiture_writes_a_record_against_the_builder` | ✅ Project B: outcome 1, 1 of 2 milestones approved ([`968e1ad8…`](https://stellar.expert/explorer/testnet/tx/968e1ad8b7156173cc2c6635aa59072ee26f56a15b79ee8b5d7d9172592afbc1)) |
| CTA-26 | Unfunded project | Outcome 2 `FailedToFund` | `failing_to_fund_is_recorded_without_blaming_the_builder` | ✅ Project C: outcome 2, 0 of 2 milestones approved, `get_record` JSON in the evidence doc ([`56785fa8…`](https://stellar.expert/explorer/testnet/tx/56785fa811fd00f968d3b16fdd733f3d2bc2e072dc56ee362780a2a8cd8eb206)) |
| CTA-27 | Written once | Second `attest` for the same vault refused `#4`; vault's own `attested` flag makes later calls no-ops | `a_record_cannot_be_overwritten`, `a_projects_record_is_written_once_and_never_amended` | — |
| CTA-28 | No update or delete | Registry interface lists no such entrypoint | `stellar contract info interface --id <registry>` | ✅ reference registry; 🔲 production registry |
| CTA-29 | Only trusted factories' vaults can write | Unknown contract `#3`; untrusted factory `#7`; disabled factory cannot write but its records remain | `rejects_writes_from_contracts_the_factory_does_not_know`, `naming_an_untrusted_factory_is_refused`, `a_disabled_factory_can_no_longer_attest_but_its_records_remain` | — |
| CTA-30 | Incoherent record | e.g. approved > total, refused `#6` | `rejects_incoherent_records` | — |
| CTA-31 | Emitted as an event with the builder as a topic | `getEvents` filter `(ATTEST, RECORDED, <builder>)` returns it | `a_record_is_emitted_as_an_event_filterable_by_builder` | ✅ ledger 5,054,473 (A); ledger 5,175,489 (B); ledger 5,292,993 (C) |
| CTA-32 | History across projects and builders | `get_builder_history`, `get_builder_summary` = `(completed, forfeited, unfunded)` | `builds_a_portable_history_across_projects`, `a_second_builder_has_a_separate_history` | ✅ summary reads `[1, 1, 1]` after Project C, and `get_builder_history` returns all three records |
| CTA-33 | Cross-contract read | A third-party contract gates on a builder's record | `another_contract_can_gate_on_a_builders_record` | — |
| CTA-34 | Colliding project ids from two factories | Both recorded (keyed by vault) | `a_second_factory_with_a_colliding_project_id_still_records` | — |

---

## 6. Deliverable III: Web app, indexer and demo

### 6.1 Freighter and the few-taps stake (manual, live site)

Run on desktop (1280×720 and 1920×1080) and a phone-width viewport (375×812), Freighter on Testnet, a demo account.

| ID | Case | Expected |
|---|---|---|
| WEB-01 | Link a wallet: Settings → Wallet | Nonce from `POST /api/auth/freighter/nonce`, Freighter signs, `/verify` accepts, address saved. A replayed or foreign signature is refused |
| WEB-02 | Six-tap stake on project #22 | Card → **Stake from $5** → preset → **Review and sign** → **Open Freighter** → **Confirm**. Done card shows "Recorded on-chain" and a Stellar Expert link |
| WEB-03 | Confirm card before signing | Shows amount leaving the wallet, the simulated network fee in XLM, "Fee to BLKFNDR $0.00". Freighter shows the same amount |
| WEB-04 | Amount limits in the sheet | Min $5; max = what is left to the goal; below-min and over-max cannot be submitted |
| WEB-05 | Gate: no wallet linked | Card with the fix, inside the sheet |
| WEB-06 | Gate: Freighter on the wrong network | The sheet names the network; nothing is signed |
| WEB-07 | Gate: unfunded account | Friendbot activation card |
| WEB-08 | Gate: no USDC trustline | One-signature trustline card |
| WEB-09 | Gate: not enough USDC | Circle faucet card |
| WEB-10 | Signed out | Sheet opens with one **Sign in** card; after sign-in the person lands back on the stake |
| WEB-11 | User rejects in Freighter | Plain-words message, "no money moved"; sheet recoverable |
| WEB-12 | Contract refusal (e.g. deadline passed) | Caught at simulation; plain-words reason from `explain-error.ts`; nothing sent |
| WEB-13 | Vote: a contributor approves an open stage | Same confirm flow; vote panel shows weight, wallets and money against the three bars |
| WEB-14 | Refund sheet on a failed / refunding vault | Shows the amount the contract will pay (principal, or share + bond share); claim signed in Freighter |
| WEB-15 | Builder opens a stage vote | Only the builder sees the action; 7-day close time shown |
| WEB-16 | Non-custodial check | No server route ever holds or requests a contributor secret; every stake, vote and refund XDR is signed client-side in Freighter (inspect network calls during WEB-02) |
| WEB-17 | Accessibility basics | Sheet reachable and operable by keyboard; focus visible; buttons labelled; text contrast ≥ 4.5:1 |

### 6.2 Indexer

| ID | Case | Method | Expected |
|---|---|---|---|
| IDX-01 | Scan covers factory and every vault, five contracts per filter, follows the RPC cursor across quiet ledgers | `npm test` (`indexer-scan.test.ts`) | Pass |
| IDX-02 | A vault deployed during a pass gets its opening events in that pass | `indexer-scan.test.ts`; live: `BOND/POSTED` count = `FACTORY/DEPLOY` count | Equal |
| IDX-03 | Idempotent | Re-run a pass over the same ledgers | No duplicate rows (unique event id) |
| IDX-04 | Failed event retried, skipped after 5 attempts | Unit + `contract_events.attempts` on live | No event stuck below 5 blocking the cursor |
| IDX-05 | Cursor only moves past fully handled events | Kill a pass mid-way (local) | Next pass resumes without loss |
| IDX-06 | Lag | `indexer_state.last_processed_ledger` vs RPC `getLatestLedger` | ≤ ~12 ledgers (one 60 s pass) |
| IDX-07 | New stake appears | After WEB-02 | Project total and Record tab update within 60 s; Record line links the same tx |
| IDX-08 | **Reconstruction from events** | `node --env-file=.env.local scripts/replay-check.mjs` | Every vault: state, raised, paid out, bond, unrefunded stakes, staker count, every balance, each stage's flags and weight match the chain. Exit 0 |
| IDX-09 | Replay check catches a gap | Omit one stored event (as done for #16) | Mismatch reported, exit 1 |
| IDX-10 | Replay rules match the contract on paths testnet has not run | `vault-replay.test.ts` (payouts to completion, stall + sweep, failed vote) | Pass |
| IDX-11 | Protocol 29 ledgers decode | Indexer + replay check on SDK 16.3.1 across 24 h | No XDR decode errors in logs |
| IDX-12 | Route is protected | `POST /api/indexer` without `INDEXER_SECRET` | 401; no write grants on indexer tables for anon/authenticated |
| IDX-13 | After Project-B-style events on production (refund, slash) | Replay check after the first real lapse + refunds | Still N of N match; Record tab shows refund lines |

### 6.3 Demo video

| ID | Case | Expected |
|---|---|---|
| DEMO-01 | Pre-recording checklist in the [demo script](testnet-demo-script.md) | All boxes ticked; replay check `22 of 22` before recording |
| DEMO-02 | Video shows: vault → project → six-tap stake → tx on Stellar Expert (`contribute`, `DEPOSIT/CONTRIB`) → total + Record update → replay check → close | All seven shots present, ~4 min |
| DEMO-03 | After recording | Replay check shows #22 at 225 raised, 3 stakers, all vaults matching; output saved with `--json` |
| DEMO-04 | Published | Video link and stake tx hash in [web-app-indexer-demo.md](web-app-indexer-demo.md) and `progress.md` |
| DEMO-05 | No personal data on screen | Demo account email, no secret keys, no other extensions |

---

## 7. Security and adversarial tests

| ID | Threat | Test | Covered by |
|---|---|---|---|
| SEC-01 | Whale releases alone | One wallet holding > 50% approves | CTA-10 |
| SEC-02 | Sybil split: one person spreads money across many small wallets | Small wallets clear weight + wallet floor but not the money majority | CTA-08 |
| SEC-03 | Builder self-funds to vote own release | Builder contributes from a second wallet: still capped at 20% and needs two more wallets plus the money majority | CTA-04, CTA-07, CTA-08 |
| SEC-04 | Platform or admin moves contributor funds | Vault interface has no admin entrypoint; factory admin can repoint modules only for **future** vaults | CTA-18, `admin_can_repoint_platform_modules` + VLT-09 |
| SEC-05 | Keeper key abuse | Keeper only sends calls the vault accepts; it cannot release an uncarried stage or fail a carried one | CTA-23, VLT-35 |
| SEC-06 | Builder stalls forever | `settle_stalled` after 90 days | VLT-38 |
| SEC-07 | Dissenter races a carried release with a stall | Refused `#21` | VLT-39 |
| SEC-08 | Re-entrant attestation registry | State persisted before external calls | VLT-44 |
| SEC-09 | Fake vault writes a record | `#3` / `#7` | CTA-29 |
| SEC-10 | Record tampering | No update/delete entrypoint; written once | CTA-27, CTA-28 |
| SEC-11 | Double refund / double vote | `#9` / `#18` | VLT-32, CTA-15 |
| SEC-12 | Page-size DoS on reads | Clamp to 100 | VLT-18 |
| SEC-13 | Signature replay on wallet linking | One-time nonce | WEB-01 |
| SEC-14 | Indexer write path exposed | Bearer secret; tables owned by the service role | IDX-12 |

---

## 8. Requirements traceability

Each phrase of the deliverable text, mapped to the cases that prove it.

**Deliverable I**

| Requirement | Cases |
|---|---|
| Pooled USDC contributions into a per-project vault | VLT-01, VLT-10, VLT-12, VLT-13 |
| Builder performance-bond lock at project creation | VLT-01–VLT-04 |
| Milestone-based release logic | VLT-20–VLT-26 |
| All-or-nothing automatic refund if the goal is not met | VLT-27–VLT-32, CTA-23 |
| Automatic bond forfeiture and pro-rata distribution on milestone failure | VLT-33–VLT-39, CTA-23 |
| On-chain events for every deposit, release, refund and forfeiture | VLT-40, IDX-08 |
| Deployed open source on Stellar testnet | VLT-48–VLT-50 |

**Deliverable II**

| Requirement | Cases |
|---|---|
| $5 USDC contribution path | CTA-01, CTA-02, WEB-02, WEB-04 |
| One vote unit per 1 USDC, recorded at deposit | CTA-03, CTA-05 |
| 20% cap per wallet | CTA-04, CTA-06 |
| > 50% threshold, at least three distinct wallets | CTA-07, CTA-09, CTA-12, CTA-14 |
| No multisig, no appointed or chapter-held keys | CTA-18, SEC-04, SEC-05 |
| Fixed 7-day window set at creation | CTA-17, CTA-19 |
| Fails closed; inactivity never strands funds or pays the builder | CTA-13, CTA-20–CTA-22, VLT-38 |
| Attestation fields, written once, append-only, emitted as an event | CTA-24–CTA-31 |
| Readable by any contract and any indexer | CTA-31–CTA-33 |
| Test transactions for deposit, approval, release, refund, forfeiture, attestation | §10 evidence table |

**Deliverable III**

| Requirement | Cases |
|---|---|
| React web app with Freighter | WEB-01, WEB-16 |
| A contributor backs a project in a few taps | WEB-02–WEB-12 |
| Lightweight indexer that reconstructs vault state from events | IDX-01–IDX-13 |
| Recorded end-to-end demo | DEMO-01–DEMO-05 |

---

## 9. Findings from preparing this plan

Things a reviewer will ask about. None blocks the plan; each needs an owner decision or a small follow-up.

**Wording vs. behaviour.** These are already documented in the [Deliverable II evidence](contribution-threshold-attestation.md#wording-changes-from-the-original-text) and should be cited, not re-argued, in sign-off:
1. The three-wallet rule is explicit (or every contributor when fewer than three), and a money majority is also required. The original text derived three wallets from the 20% cap alone.
2. Records are keyed by vault and indexed by builder, not keyed by builder.
3. A third outcome, `FailedToFund`, exists.

**Two more that the Deliverable I text raises:**
4. **"Automatic refund"** is a pull, not a push. Nothing is sent to contributors unasked. Each contributor claims with their own signature, and settling (`settle`, `settle_lapsed_milestone`) is permissionless and done by the governance keeper. Suggest the evidence doc say "automatic and permissionless: no approval is needed, and the keeper settles; each contributor claims their own refund."
5. **Forfeiture has no per-contributor distribution event.** `BOND/SLASHED` marks the forfeiture, and each contributor's bond share is inside their `DEPOSIT/REFUND` amount. The replay check reconstructs it correctly. Worth one sentence in the evidence.

**Unit-test gaps found and closed with this plan** (in [test.rs](../../contracts/blkfndr-vault/src/test.rs)):
6. **VLT-14: overshoot.** `contribute` refuses a deposit that would take the raise past the goal with `#5`, but no test reached that branch. `reaching_the_goal_closes_the_raise` tries a deposit after the goal is met, which fails earlier with `#2`. Added `rejects_a_deposit_that_overshoots_the_goal`: 105 into a raise 100 short is refused with exactly `#5`, nothing moves, and 100 then fits and closes the raise.
7. **VLT-19 / VLT-21: forged signer.** Every vault test ran under `env.mock_all_auths()`, which approves any signature, so nothing proved a call signed by the wrong address is refused. Added four tests that authorise exactly one signer: a deposit, a vote and a refund signed by another contributor in Alice's name, and a vote opened by a contributor instead of the builder. Each is refused with nothing changed, and the same call signed by the right address goes through. The contract already called `require_auth()` in each, so this closed a gap in proof, not a bug. Checked by mutation: with the `require_auth()` line removed from the contract, the matching test fails.
8. VLT-30 was already covered. Checked while preparing this plan.
9. **VLT-15: the `#7` guard is a backstop.** `contribute` checks the lifecycle state before the deadline, and the state reads `Failed` or `Funded` from the moment the deadline passes, so a late deposit is refused `#2`, never `#7`. Project C showed it on testnet (2026-10-20). The unit test asserts only that the call fails, so it stays correct; the plan's expected code was wrong and is fixed above.

**Testnet paths not yet exercised** (updated 2026-10-20): no stall, and no payout on a production vault. The missed-goal path ran on the reference deployment on 2026-10-20 as Project C: `settle` by an unrelated account, two full refunds, `return_bond`, and a `FailedToFund` record (VLT-27–VLT-32, CTA-26). Refunds after a forfeiture have been collected on production #5, #7 (2026-10-15) and #10 (2026-10-19), and Project B covered forfeiture and refunds on the reference deployment on 2026-10-13.

---

## 10. Execution schedule and evidence to collect

| When | Action | Cases closed | Evidence |
|---|---|---|---|
| Now | `cargo test --workspace`, clippy, `npm test` on `main` | VLT-46, VLT-47, IDX-01, IDX-10 | Pass counts in §11 |
| Now | Hash check of deployed wasm vs build | VLT-48, VLT-49 | `sha256sum` output |
| ✅ **Done 2026-10-13 14:17 UTC** | `bash scripts/reference-scenario.sh project-b-finish` | VLT-33, VLT-36, VLT-37, CTA-20–CTA-22, CTA-25, CTA-31, CTA-32 | Tx hashes for settle, 5 refunds; `get_record`; `getEvents` by builder; summary `(1, 1, 0)` |
| ✅ **Done 2026-10-20 09:29 UTC** | `bash scripts/reference-scenario.sh project-c-start`, then `project-c-finish` once the five-minute raise had closed | VLT-14, VLT-15, VLT-27–VLT-32, CTA-26 | Tx hashes for settle, 2 refunds and `return_bond`; `get_record` outcome 2; `getEvents` by builder; summary `(1, 1, 1)` |
| Next session | The first payout on a live project, per the [payout run checklist](payout-run-checklist.md): launch a 15 USDC project in the app, three scripted stakes, the builder opens the vote, three approvals, the keeper releases | VLT-22, VLT-25 and CTA-24 on production; CTA-23's payout path | Tx hashes for the stakes, the vote opening, the approvals and the keeper's release; `get_record` outcome 0; replay check N of N |
| This week | Negative simulations on testnet: VLT-21, CTA-15–CTA-17 | listed | `Error(Contract, #n)` per case in `transactions.tsv` |
| This week | Governance keeper dry run on live, then observe one real lapse | CTA-23, SEC-05 | Keeper response JSON, tx hash sent by the keeper key |
| This week | Manual web pass §6.1 on desktop + phone | WEB-01–WEB-17 | Screenshots per case, LIVE |
| Demo day | Record per script | DEMO-01–DEMO-05, IDX-07 | Video link, stake tx, replay-check JSON |
| After demo | Replay check | IDX-08, IDX-13 | `N of N vaults match` |

---

## 11. Entry, exit and sign-off

**Entry.** Contracts build from the cited commit; reference and production deployments reachable; test accounts funded (XLM + USDC trustline + USDC); indexer within one pass of the chain.

**Exit, per deliverable.**
- **I:** every VLT case ✅ or explicitly accepted as unit-only (the 90-day stall); wasm hashes match; the new unit tests from findings 6 and 7 passing.
- **II:** every CTA case ✅, including Project B's settle, refunds and attestation on testnet; findings 1–5 reflected in the evidence doc.
- **III:** WEB and IDX cases ✅ on the live site; replay check N of N; demo video published with its tx hash.

**Defect severity.**

| Severity | Meaning | Release rule |
|---|---|---|
| S1 | Funds can move against the rules, be stranded, or a record can be altered | Blocks sign-off; contract fix + redeploy |
| S2 | A rule is right on-chain but the app shows or sends something wrong | Blocks sign-off of III |
| S3 | Wrong or unclear wording, cosmetic | Logged; does not block |

**Baseline run, 2026-10-13** (`main` at `1f4ccca` plus the five tests added with this plan):

| Suite | Result |
|---|---|
| `npm test` | 36 of 36 pass |
| `cargo test --workspace`, after `scripts/build-contracts.sh` | 188 of 188 pass: vault 61 (56 before this plan), attestation 16, factory 17 including the vault deployment tests, and the other workspace contracts. Without the wasm build the factory's deployment tests skip themselves and the total is 182 |
| `cargo clippy --workspace --all-targets -- -D warnings` | Clean |

**Coverage, measured 2026-10-20** (`main` at `cda3050`; `npm run test:coverage` and `bash scripts/contract-test-map.sh` repeat it, see [contributing.md](../contributing.md#coverage)).

No coverage target is written down for this project: not in this plan, the deliverable documents, progress.md or the Gate 4 remediation record. The Gate 4 playbook takes the target as an input, "Coverage target (e.g. 80%) and which paths are considered critical", and its evidence scanner defaults to 80%. The figures below are therefore read against **80% line coverage as an assumption**, until the owner sets a number and says whether it applies to the modules that have tests or to the code base.

| Measurement | Lines | Branches | Functions | Against 80% |
|---|---|---|---|---|
| TypeScript, the 13 modules `npm test` loads (94 tests; Node `--experimental-test-coverage`) | 95.84% (1,868 of 1,949) | 87.86% | 91.82% | Meets |
| TypeScript, every module under `src/lib` (88 modules; the 75 no test loads count as 0%; type-only modules left out) | 13.98% (1,868 of 13,358) | not meaningful | not meaningful | Does not meet |
| TypeScript, everything under `src` except the generated bindings (300 modules; pages, components, hooks and context are React code the unit suite never loads) | 3.91% (1,868 of 47,810) | not meaningful | not meaningful | Does not meet |
| Contracts, line coverage | Not measured: `cargo llvm-cov` is not installed on the build machine. The `llvm-tools` component exists for the pinned 1.81.0 toolchain, so `rustup component add llvm-tools-preview` and `cargo install cargo-llvm-cov` would make `cargo llvm-cov --workspace --summary-only` possible | | | Not measured |
| Contracts, fallback: `cargo test --workspace` and the entrypoint map | 199 of 199 pass after the wasm build (vault 65, treasury 46, operations 27, identity 19, factory 17, attestation 16, admin 9); without the build the factory's seven deployment tests give way to one marker test and the total is 193. Every one of the vault's 20 public entrypoints is called directly by at least one test. On the other contracts eight entrypoints have no test calling them: factory `update_wasm_hash` and `update_fee_wallet`; identity `get_admin`; treasury `next_release_at`, `get_available`, `has_claimed`, `get_ops_funding` and `next_ops_funding_at` | | | Call sites, not lines |

Least covered among the modules that hold logic (generated bindings, React components and type files left out): the largest modules no test loads are `src/lib/data/kyc.ts` (807 lines), `explain-error.ts` (626), `event-indexer.ts` (583), `ttl-keeper.ts` (438), `data/admins.ts` (384), `data/projects.ts` (325), `managed-wallet.ts` (324), `email/notification-emails.ts` (310), `bond-readiness.ts` (270) and `stellar.ts` (264). Of the modules with tests, `listing-draft.ts` (74.6% of lines) and `live-project.ts` (74.6%) are the least covered.

| Deliverable | QA lead | Date | Result |
|---|---|---|---|
| I Bonded Vault | | | |
| II Threshold release & attestation | | | |
| III Web app, indexer, demo | | | |
