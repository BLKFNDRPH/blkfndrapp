# BLKFNDR — Progress

_Last updated: 2026-10-21 · `main` at `d1496c6` (#220, the last of #208–#221 to merge). This week: #171–#221, merged 13–21 Oct 2026._

Where the platform stands: what is live on testnet, what is merged but not yet active, and what is still open. This week's work comes first. Earlier work (#67–#170) is summarized under [Before this week](#before-this-week).

> ⚠️ **Merged is not deployed.**
> A Soroban contract only changes when it is redeployed. A vault change reaches only vaults the factory creates after it is repointed with `update_wasm_hash`, and vaults never change code afterwards. A migration file changes nothing until it is applied to the live database. See [Live vs shelf-ready](#live-vs-shelf-ready).

---

## Snapshot — verified on testnet, 2026-10-21

Read-only checks, not inferred from merges, made at 09:37–09:43 UTC on 21 Oct: both site addresses' response headers and the `/projects/22` page, the live Supabase project (`eqnheftmstapthlblpbx`), the Soroban RPC, contract reads through it (simulation only, nothing sent), Horizon, the governance keeper's local dry run (`scripts/keeper-dry-run.mjs`) and `scripts/replay-check.mjs`. Rows marked "read 2026-10-20" were not read again.

| Area | State |
|---|---|
| **App** | ✅ https://blkfndr.com answers 200 with #204's nonce-based Content-Security-Policy and no `X-Powered-By` header (#203). `https://testnetv2.blkfndr.com/projects/22` answers `308` with `Location: https://blkfndr.com/projects/22`, so #220's redirect is live and the stack was rebuilt with the new `NEXT_PUBLIC_APP_URL`. `/projects/22` reads "Ends 31 Dec 2027 (436 days)" (#216). The host runs `main` through #220, on Next 16.4.1 (#194). #217–#219 and #221 change no app code; #221 moves one lockfile entry, which can't be seen from outside |
| **Stellar SDK** | ✅ 16.3.1. The RPC now runs stellar-rpc 30.0.0 on stellar-core 30.0.0 (built 20 Oct 22:36 UTC), but `getVersionInfo` still reports protocol 29, which no JS SDK supports yet ([item 14](#14-protocol-29-and-the-stellar-sdk)) |
| **Indexer** | ✅ Current: the cursor moved at 09:38 UTC (ledger 5,310,383, a few ledgers behind the chain's tip), nothing is unprocessed and no event has been skipped. 176 events stored, four more than on 20 Oct: #28's `VAULT/FAILED` and three `BOND/RETURNED` |
| **Vault state rebuilt from events (#164)** | ✅ **28 of 28 vaults match the chain**, field by field, at 09:43 UTC. The first run, at 09:38 UTC, matched 27 and reported #23 as unreadable: the RPC answered that one read with a 502. A rerun read it and everything matched |
| **Projects** | 19 raising, 6 refunding (#1, #5, #7, #8, #10, #11), 3 failed to fund (#2, #3 and #28). The factory's `get_project_count` reads 28. No stage has been paid out and no vault has stalled, on any vault. The only refunds collected are still #5 and #7 on 15 Oct and #10 on 19 Oct. #26 (20 USDC goal, 0 raised) ends its raise on 2026-10-26 11:04 UTC and #27 on 18 Nov; both have no stakes |
| **Governance keeper (#131, #214)** | ✅ Running, and the bond return has fired. On 20 Oct it returned the 50 USDC bonds of #2 ([`6c450678…`](https://stellar.expert/explorer/testnet/tx/6c4506782fb89ae448aad277405f7622c86e67b9bbdfca82f200bfa516d517ce), 13:49:17 UTC) and #3 ([`caf121f0…`](https://stellar.expert/explorer/testnet/tx/caf121f021ee4a1955d8d1fa408855f13a0fb33e47dffbd8082dfed974b9682a), 13:49:32). It then settled #28, which missed its 50 USDC goal at 17:10 UTC with no backers ([`9fda4325…`](https://stellar.expert/explorer/testnet/tx/9fda43255821f3c2ff9d5a570244ad2d9ef665c17d95d1532d64e5107d6bcfee), 17:23:52), and returned its 2.5 USDC bond five seconds later ([`05a894d1…`](https://stellar.expert/explorer/testnet/tx/05a894d18f67a7d7d2806442093629ca581655eb09842b193f6d01fce053d5d2)). All four were sent by the keeper key `GDOCUSXG…`. `get_info` reads `bond_returned: true` on all three vaults. Its dry run at 09:42 UTC today answered "Nothing was due (checked 22 vault(s))". No vote has been opened or closed since the closures of 12 Oct |
| **Refusals on the reference factory (#213)** | ✅ Project D's vault `CC6QVIVR…` still holds its 0.75 USDC bond with no record yet and 15 USDC raised (`get_info`, 21 Oct). Its milestone 1 vote, open with one approval of weight 3 on 20 Oct, closes 2026-10-27 11:50:12 UTC, left to lapse on purpose |
| **Missed-goal path (#210)** | ✅ Ran on the reference deployment on 2026-10-20 as Project C: settle [`56785fa8…`](https://stellar.expert/explorer/testnet/tx/56785fa811fd00f968d3b16fdd733f3d2bc2e072dc56ee362780a2a8cd8eb206) at ledger 5,292,993, two full refunds and the bond returned, all four confirmed on Horizon. The reference registry's `get_builder_summary` reads `[1, 1, 1]`. The production registry `CDEN2LU4…`, which held no record on 20 Oct, now holds one from #28: that builder reads `[0, 0, 1]`, one unfunded. #2 and #3 wrote to the previous registry `CDLL2A4R…`, where their builder reads `[0, 1, 2]` |
| **First live payout (#211)** | ⏳ Prepared, not run. #22 still has 3 stakers, so none of the payout wallets has staked there. The wallets held 5 USDC each on 20 Oct (not read again) ([item 17](#17-run-the-first-live-payout)) |
| **Operations Vault cutover** | ⚠️ Unchanged since 2026-10-02. The treasury's `get_ops_funding` still returns `null` (read 2026-10-21, [item 1](#1-finish-the-operations-vault-cutover)) |
| **Factory admin** | ⚠️ Still the deployer key `GDR4TPUF…`, not the treasury (`get_admin`, read 2026-10-21) ([item 2](#2-hand-the-factory-admin-to-the-treasury)) |
| **Database migrations** | ✅ Live is at `20261015150429` (#202), 41 recorded, none applied since 15 Oct. Two repo files live doesn't record: the no-op `20261001160000` and `correct_bootstrap_admin` ([item 6](#6-migration-history-drift-m-09)) |
| **Browser table grants (#139)** | ✅ Applied 2026-10-15 as `20261015141432`. `anon` holds no write or `TRUNCATE` grant on any public table, and `feature_requests_author_edit` is gone (re-read 2026-10-21, [item 5](#5-apply-the-browser-table-grant-revocation)) |
| **Email (#138)** | ⚠️ Unchanged: a Resend key is set, but Resend refuses every send with `422 Invalid from field`. 0 sent, 0 pending, 63 skipped, 13 failed: the 11 of 15–17 Oct and two more at 17:24 UTC on 20 Oct, the builder's notices that #28 missed its goal and its $2.50 deposit came back ([item 3](#3-switch-on-email)) |
| **Testnet demo** | ✅ Recorded 2026-10-17: a 5 USDC stake on #22 ([`3c8a6b61…`](https://stellar.expert/explorer/testnet/tx/3c8a6b61dbc7b8ea8b159ff3b84db6d719e36f74938bfbac60641cee8d00f2e2)), replay check 25 of 25 after it. ⏳ The video's public link is still to be added ([item 15](#15-record-the-testnet-demo)) |
| **Network** | Testnet |

---

## This week (#171–#221)

### #208–#221 (19–21 Oct)

**In short:**
- **The vault's last untried path ran on testnet, and the gap it showed is closed and working.** A raise that misses its goal was settled, refunded in full and its bond returned, on the reference deployment on 2026-10-20 (#210). The bond had to be returned by hand, so the governance keeper now sends `return_bond` itself (#214). It fired the same day, on the app's own vaults: #2 and #3 at 13:49 UTC, and #28, which missed its goal at 17:10 UTC, settled and returned by 17:23 UTC with nobody pressing a button. Every vault path has a testnet transaction except a stall, a stage payout and a vote window closing on a funded vault.
- **The site moved to https://blkfndr.com (#220).** The old address now answers `308` and sends visitors to the same page on the new one. The docs and scripts point at the new address.
- **The refusals have testnet evidence too (#213).** Project D on the reference factory captured nine refusal cases in simulation, from a bond below 5% to a non-contributor's vote, and read the production registry's interface: nothing updates or deletes a record.
- **The first live payout is prepared, not run (#211).** A script drives three stakeholder wallets on the app's own factory, and a checklist walks the owner through launching a one-stage 15 USDC project and asking for its payout. The governance keeper's release path has never fired live.
- **Coverage is measured, with no target set (#215),** and the contracts' untested entrypoints are now tested: 18 new tests take the workspace from 199 to 217 (#218, #219). Two cosmetic defects are fixed: the deadline's year and the fee's token (#216).
- **The keeper can be rehearsed against live from a checkout (#217),** and the dependency gate is green again after a new advisory on `follow-redirects` (#221).
- **The evidence caught up with testnet (#208, #209, #212):** the progress updates of 19 and 20 Oct, and the first three refunds recorded in the deliverable docs.
- **On-chain, 19–21 Oct:** 3 vaults opened on the app's factory (#26–#28), none staked into. #28 failed its raise at 17:10 UTC on 20 Oct and the keeper settled it and returned its 2.5 USDC bond, which also wrote a record into the production attestation registry (its builder reads `[0, 0, 1]`). The keeper returned #2's and #3's 50 USDC bonds. On the reference deployment, 17 transactions sent and 15 refusals captured in simulation for Projects C and D. No vote, no payout and no stall on the app's vaults.
- **Still not working:** email. Resend refuses the sender address, so 13 notifications have failed and none has been sent (item 3).

| PR | What changed | Live? |
|----|--------------|-------|
| #208 | Progress update for #171–#207 (dated 2026-10-19): the Snapshot re-verified read-only, one row per PR, Gate 4's leftovers as item 16 | — |
| #209 | **The first testnet refunds recorded** in the [demo evidence](docs/deliverables/web-app-indexer-demo.md) and the [QA plan](docs/deliverables/qa-test-plan.md): #5 and #7 on 15 Oct, #10 on 19 Oct, the only three `DEPOSIT/REFUND` events indexed. VLT-36 gains them. VLT-28 stayed open: no missed goal had been refunded yet | — |
| #210 | **The missed-goal scenario: Project C on the reference deployment, 2026-10-20.** A 20 USDC goal with a five-minute raise; two backers put in 5 USDC each and the deadline passed at 10 of 20. An unrelated account settled it, with `FailedToFund` recorded in the same transaction ([`56785fa8…`](https://stellar.expert/explorer/testnet/tx/56785fa811fd00f968d3b16fdd733f3d2bc2e072dc56ee362780a2a8cd8eb206), ledger 5,292,993). Each backer took the whole 5 USDC back with their own signature ([`46c3287b…`](https://stellar.expert/explorer/testnet/tx/46c3287b585b44a471c686a188389ef48dd6666e650239873fd4f5d7fd016802), [`09460e24…`](https://stellar.expert/explorer/testnet/tx/09460e248141b9512fd63ba991445691d6273a1ef8af22a7a8f2431bcab40b6b)), and an unrelated account returned the 1 USDC bond to the builder ([`97f5c650…`](https://stellar.expert/explorer/testnet/tx/97f5c650b2e0ec76f1a2c6ac24b6d4aec389a1a1ecb4fc05bdc8d55d02017970)), who ended down exactly the flat fee. The builder's summary reads `[1, 1, 1]`: one completed, one forfeited, one unfunded. Six refusals were captured in simulation, and one expectation was wrong: a deposit after the deadline is refused `#2` InvalidStatus, not `#7`, because the state check runs first ([QA plan](docs/deliverables/qa-test-plan.md) finding 9; contract and unit test were right). VLT-14, 15, 27–32 and CTA-26 are closed. `reference-scenario.sh` gains the Project C steps, and the [evidence](docs/deliverables/contribution-threshold-attestation.md) a Project C section | ✅ Reference deployment |
| #211 | **The first live payout, prepared.** [payout-run.sh](scripts/payout-run.sh) sets up, stakes, approves and watches from three Stellar CLI wallets on the production factory, and asks the live keeper for a dry run; `--dry-run` simulates every write and sends nothing. The [checklist](docs/deliverables/payout-run-checklist.md) is the session plan. Done so far: `pay-s1`, `pay-s2` and `pay-s3` funded with 5 USDC each, a dry-run stake on #22 accepted in simulation, and the preconditions read on 2026-10-20 (the builder wallet is KYC-approved, the factory charges 1 USDC with a 5 USDC minimum stake, the attestation registry trusts the factory, the keeper answered "Nothing was due"). **The run itself has not happened** ([item 17](#17-run-the-first-live-payout)) | ⏳ Not run |
| #212 | Progress update for #208–#216 (dated 2026-10-20). The Snapshot was re-read twice, before and after #213–#216 deployed, with new rows for the missed-goal path, the reference-factory refusals and the prepared payout run. `returnBond` leaves item 10, and the #171–#207 content moves into its own subsection | — |
| #213 | **The refusal cases: Project D on the reference factory, 2026-10-20 11:48–11:50 UTC.** A 15 USDC goal in stages of 10 and 5 with the minimum 0.75 USDC bond; three backers closed the raise after [`ac971553…`](https://stellar.expert/explorer/testnet/tx/ac971553c39bb457728e9449b39cc89347e6242737df2119cc469b5cd3a32645) opened it. Simulated and refused: a bond below 5% (factory `#12`), a builder without KYC approval (vault `#12`, told apart by which contract raised it), a KYC-approved builder holding no USDC (the token's `#10`), a deposit after the raise closed (`#2`), an approval before the vote opened (`#15`), the vote opened twice (`#16`), an approval twice (`#18`), a non-contributor's approval (`#19`) and an approval on Project B's settled stage (`#2`). The production registry `CDEN2LU4…` was read: 13 entrypoints, none updates or deletes a record. A wrong signer can't be shown in simulation, so VLT-19 and half of VLT-21 stay unit-only. Milestone 1's vote was left open with one approval ([`3d876161…`](https://stellar.expert/explorer/testnet/tx/3d8761610552bb92cbb3a2ce9ce0e14a8d924b6ca62c47d39ab85bf3cd5d25c8)); it lapses on 2026-10-27 11:50 UTC, when `#17` VotingClosed can be shown | ✅ Reference deployment |
| #214 | **The keeper returns a missed goal's bond.** For a vault in `Failed` it still sends `settle` when no record exists, and now sends `return_bond` while the bond is held, record first when both are due, simulated first and counted against the run's budget of 20. Failed projects stay on its list until the vault reports the bond returned; they were skipped before, so #2 and #3 had never been read. The decisions moved to `governance-keeper-pass.ts`, which imports nothing, with 11 unit tests. The hook's unused `returnBond` callback is deleted ([item 10](#10-unwired-features--wire-up-or-delete)). A dry run of this code against live listed `return-bond` for #2 and #3, 50 USDC each; the live keeper said the same at 13:41 UTC, and sent both returns at 13:49 UTC ([`6c450678…`](https://stellar.expert/explorer/testnet/tx/6c4506782fb89ae448aad277405f7622c86e67b9bbdfca82f200bfa516d517ce), [`caf121f0…`](https://stellar.expert/explorer/testnet/tx/caf121f021ee4a1955d8d1fa408855f13a0fb33e47dffbd8082dfed974b9682a)). At 17:23 UTC it settled #28, a raise that missed its goal with no backers, and returned its bond in the next ledger ([`9fda4325…`](https://stellar.expert/explorer/testnet/tx/9fda43255821f3c2ff9d5a570244ad2d9ef665c17d95d1532d64e5107d6bcfee), [`05a894d1…`](https://stellar.expert/explorer/testnet/tx/05a894d18f67a7d7d2806442093629ca581655eb09842b193f6d01fce053d5d2)) | ✅ Live, fired 20 Oct |
| #215 | **Test coverage measured** ([QA plan §11](docs/deliverables/qa-test-plan.md#11-entry-exit-and-sign-off)). No target is written anywhere, so the figures are read against the Gate 4 playbook's 80% default: the 13 modules `npm test` loads sit at 95.84% of lines, all of `src/lib` at 13.98%, because 75 of its 88 modules are loaded by no test. Contract line coverage is not measured (`cargo llvm-cov` is not installed); the fallback entrypoint map shows every one of the vault's 20 entrypoints called by a test, and eight on the other contracts not, `update_wasm_hash` first among them (#218 and #219 then closed those gaps). `npm run test:coverage` and `scripts/contract-test-map.sh` repeat it. No test changed, nothing in CI | — Scripts and docs |
| #216 | The project page, stake sheet and refund sheet show a deadline's year when it falls outside the current year ("Ends 31 Dec 2027 (437 days)" on #22), through one shared `formatDeadlineDate`. The governance view's fee reads "1 USDC or XLM, flat" instead of "XLM flat", since the vault charges it in the project's own token. Three unit tests. Both were item 11 rows | ✅ Seen live on #22 |
| #217 | **The governance keeper's dry run, from a checkout.** `node scripts/keeper-dry-run.mjs --env-file <path>` (or `npm run keeper:dry-run`) bundles the checkout's own `governance-keeper.ts`, deletes the operations submitter secret before the bundle loads so the keeper can only simulate, runs it against live and names the project behind each vault it would act on. `payout-run.sh keeper-dry-run` only asks the deployed app, so it can't show what an unmerged change would do; #214 had used a scratch harness for the same job. README, `docs/deployment.md` and the payout checklist cover it. On 21 Oct it answered "Nothing was due (checked 22 vault(s))" | — Script and docs |
| #218 | **Contract entrypoints no test called now have one.** `contract-test-map.sh` (#215) had flagged eight and found no `try_` refusal test for the vault's `settle` and `return_bond`. Twelve tests close them and the map flags nothing: vault 65 → 69, treasury 46 → 50, identity 19 → 20, factory 17 → 20, workspace 199 → 211. They pin that `settle` is a state sync with no early refusal (before the deadline it returns `Raising` and writes nothing), and that `update_wasm_hash`, which has no getter, decides what the next deploy instantiates. No production code changed; the vault wasm is still `e9009410…` | — Tests only |
| #219 | The same for the operations vault: six `try_` tests on `propose` and `approve` refusals and `TooManyOwners`, each asserting the state after the refusal (no proposal opened, no approval moved, the balance unchanged). Operations 27 → 33, workspace 211 → 217. No production code changed | — Tests only |
| #220 | **The site moves to blkfndr.com.** `LEGACY_HOSTS` lists retired hostnames (`testnetv2.blkfndr.com` by default in `docker-compose.yml`). A request from one gets a `308` to the same path and query on `NEXT_PUBLIC_APP_URL`, before anything else runs. Only listed hosts are redirected, only to the canonical origin, so a forged header can't make it an open redirect, and a listed host equal to the canonical one is ignored, so it can't loop. Seven unit tests. The README, deployment docs, demo script, QA plan, `.env.example` and two scripts name the new address; the four Lighthouse baselines keep the old name as history. The redirect stays inert until the stack's `NEXT_PUBLIC_APP_URL` build argument is `https://blkfndr.com`; on 21 Oct it was live (`308` on `/projects/22`). Left for the host: Supabase's URL settings, and `www.blkfndr.com`, which has no DNS record ([item 18](#18-finish-the-move-to-blkfndrcom)) | ✅ Redirect seen live |
| #221 | `follow-redirects` 1.16.0 → 1.16.1 clears two new high advisories ([GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8), [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c)) that turned the dependency audit red on every branch on 21 Oct, #220 included. The audit gate's entry for the accepted Prometheus advisory goes, because it is no longer reported; the Jaeger entry stays. `audit:gate` reports 0 blocking and 1 accepted | — Lockfile and CI |

### #171–#207 (13–18 Oct)

**In short:**
- **The week's target is met, except the video's public link.** The testnet demo was recorded on 2026-10-17: a stake on project #22 signed in Freighter, and after it the replay check matched 25 of 25 vaults (#207). The reference deployment's Project B was finished on 2026-10-13, and the QA and test plan for all three deliverables was written (#177, #172).
- **QA Cycle 7 is fixed (#181–#190), with follow-ups (#191–#193).** Identity details are checked on the server, the home address is asked for in parts, a listing's words are checked before its vault opens, each account keeps its own listing draft, and desktop gets an account menu in place of the phone drawer.
- **Gate 4 security QA is worked through (#194–#206).** Next.js and its image library were upgraded and production advisories went from 4 critical and 25 high to none critical, with CI now failing on new ones. Five authorization and sign-in gaps were closed, four of them with migrations applied to live before merging. CI now runs a deny-by-default check on every route and server action, replays every migration against the database policies, and the contracts have re-entrancy, signature and expiry tests. The site sends a nonce-based Content-Security-Policy, and the live ZAP baseline had no failures.
- **Speed.** Signed-out visitors share database reads, the Stages tab paints its rule at once, and the header renders on the server. Live mobile scores went from 42 to 82 on `/projects` and from 30 to 76 on a project page.
- **On-chain, 13–19 Oct:** 3 vaults opened (#23–#25), 6 stakes, the first 3 refunds collected (#5, #7, #10). No vote was opened or closed, and no stage was paid out.
- **SDK and indexer:** no change this week. The SDK stays at 16.3.1 and the indexer was re-read only: current, nothing skipped.

#### Deliverable evidence and the testnet demo

| PR | What changed | Live? |
|----|--------------|-------|
| #171 | Progress update for the week of #152–#170, and the deliverable evidence refreshed after #169 (replay check on SDK 16.3.1) | — |
| #172 | [QA and test plan](docs/deliverables/qa-test-plan.md) for the three deliverables: about 100 numbered cases, each with its expected result, the unit test that proves it and its testnet status. Five new vault tests close two gaps the plan found: a deposit that overshoots the goal, and a call signed by the wrong address (deposit, vote, refund, opening a vote). Tests only; the vault wasm stays `e9009410…` | — |
| #177 | **Reference deployment's Project B finished** on 2026-10-13 14:17 UTC. The lapsed stage was settled by an unrelated account, the five backers got 2.5 USDC each back, and the builder's record reads one completed, one forfeited. Every check in the script passed, and the transactions are in [the evidence](docs/deliverables/contribution-threshold-attestation.md) | ✅ Reference deployment |
| #207 | **The demo stake recorded** in [the deliverable evidence](docs/deliverables/web-app-indexer-demo.md): transaction `3c8a6b61…` on #22 (ledger 5235071, 2026-10-17), the project page and Record tab afterwards, and the replay check at 25 of 25. The video's public link is still to be added | ✅ |

#### QA Cycle 7 (report v7.0) and follow-ups

QA's report lists BF-108 to BF-120. The PRs below cover BF-108 to 113, 115 to 118 and 120. No PR names BF-114. Not adopted, by the owner's decisions: BF-119, the fee drift, KYC-01 and VLT-01 (drafting while unverified stays allowed). The minimum validity for an ID is "not expired".

| PR | Finding | What changed | Live? |
|----|---------|--------------|-------|
| #180 | — | "Open a vault" came up pre-filled with the last project: the draft was saved again after its vault opened. It now stops saving once the vault is open | ✅ |
| #181 | BF-108, 109, 110 | Identity details are checked on the server, where it counts: under 18, an expiry of today or earlier, impossible dates, an odd document number, a name with digits or symbols, a one-word address. Nothing is saved when one fails. Reviewers also see the account's display name beside the legal name, flagged when they look like different people | ✅ |
| #182 | BF-111 | The home address is asked for in parts (street, district, city, province, postal code, country), with Philippine labels by default. The parts are joined one way, and the stored line and the details hash are unchanged | ✅ |
| #183 | BF-112, 115 | Contrast was measured, not estimated: one real failure (the footer line, 3.61:1), now fixed. A fainter card hover and drawer backdrop in light mode. Picking a theme in Settings applies at once, and the "Update Theme" button is gone. Not done: saving the theme to the account, which needs a migration | ✅ |
| #184, #185 | — | The gold BLKFNDR emblem is the favicon, app icon and header mark, and tilts toward the pointer in the header and the hero. The BLKFNDR text stays in the site's own font | ✅ |
| #186 | BF-118 | From 950 px the hamburger is hidden. The account menu holds Your stakes, Your projects, Settings, Admin and Appearance, and signed-out desktop visitors get a theme button. Phones keep the drawer | ✅ |
| #187 | BF-113 | One listing draft per account, kept under the account's id. Signing out clears every listing draft in the browser. A draft typed while signed out goes to the next account that signs in | ✅ |
| #188, #191 | — | A 1200×630 share card for links, with proper `og:` and Twitter tags on the home and project pages. #191 replaced the bare logo with a designed card. Platforms cache the old card, so a link preview may need a re-scrape | ✅ |
| #189 | BF-117, 078 | **Listing quality check.** Keyboard mash, placeholder text, a held-down letter and text pasted twice are caught. It warns while drafting and blocks "Review and open the vault". All 20 live listings' titles and taglines pass it. It runs in the browser only, because the builder signs the vault's opening in their own wallet | ✅ |
| #190 | BF-120, 116, 109 | One identity privacy statement on the form and the status page. "Expires" now reads "Document valid until". Email switches confirm that they saved | ✅ |
| #192 | — | A title pasted twice and then cut off at 80 characters is now caught too (found on a live listing, fixed there by hand) | ✅ |
| #193 | — | An identity approval with no wallet attached ends after 30 days: reminders on days 7 and 25, then the check is turned down and the held details are deleted. Attaching a wallet to an expired ID is refused with its date | ✅ No migration |

One approved check was waiting for a wallet when #193 went live: reminders on 21 Oct and 8 Nov, and it would have ended on 13 Nov. On 21 Oct no approved check is waiting for a wallet, so no reminder is due.

#### Gate 4 security remediation (security and test QA, 2026-10-15)

Findings are named as the Gate 4 report names them: M for medium, L for low, F for finding, SCA for dependency scans, A01 for broken access control. The five migrations (#197–#200, #202) were each dry-run in a rolled-back transaction, then applied to live before their PR merged.

| PR | Finding | What changed | Live? |
|----|---------|--------------|-------|
| #194 | SCA | Next 16.0.10 → 16.4.1 (a critical image-optimizer remote-code hole and about 15 highs) and sharp 0.35. The image optimizer is switched off, so `/_next/image` answers 404. CI fails on a critical advisory and emits an SBOM. Production advisories: 4 critical and 25 high → 0 and 14 | ✅ |
| #195 | SCA | `axios` pinned to 1.20.0 clears eleven advisories, and a build-only plugin moved to dev dependencies. `npm run audit:gate` fails CI on any high or critical advisory except two accepted by id. Result: 0 critical, 7 high packages (2 accepted advisories, [item 16](#16-gate-4--what-is-left)) | ✅ |
| #196 | M2 | A KYC reviewer can no longer decide, attest or revoke their own identity check. The refusal is audit-logged and, for attesting, comes before anything is written on-chain | ✅ |
| #197 | M1 | Only an owner can ban an administrator, and nobody can ban themselves. `banned_by` is set by the database. Migration `20261015140313` | ✅ |
| #198 | L2 | Only the owners' vote plans or declines a feature request. Migration `20261015142340` | ✅ |
| #199 | F1 | An admin invite binds only to an account whose email is confirmed. Migration `20261015143157` | ✅ |
| #200 | M3, L4 | **Wallet link.** The challenge belongs to the signed-in account, and the wallet signs a readable message naming the site, account, wallet address, network and expiry, not a bare number. Migration `20261015144208`. The owner's real Freighter link on 15 Oct went through the new path | ✅ |
| #201 | A01 | `npm run test:authz` in CI calls every route and server action as each identity below its level and expects a refusal with no side effect: 206 probes over 34 route files and 11 action files. It found two gaps, now fixed: `grantAdmin` accepted any admin role at the app level, and the AI listing check was marked as its own server action, with no sign-in check of its own | ✅ CI check |
| #202 | — | Dropped the old `auth_challenges` table and its purge function. Migration `20261015150429` | ✅ |
| #203 | DAST | ZAP baseline against the live site: no failures, 11 warnings, 56 passes over 109 URLs, nothing exploitable. The `X-Powered-By: Next.js` header is gone | ✅ |
| #204 | DAST | A nonce-based Content-Security-Policy on every page, with zero violations across the site's pages. `CSP_REPORT_ONLY=1` backs it out without a rebuild. `style-src 'unsafe-inline'` remains ([item 16](#16-gate-4--what-is-left)) | ✅ |
| #205 | M-09, abuse cases | `npm run test:db` replays every migration into an in-memory Postgres and runs 30 abuse cases as `anon` and `authenticated`. It also made the repo replayable: it adds the missing `add_platform_admin_role` file and renames nine files to the versions live recorded. No change to the live database | ✅ CI check |
| #206 | Abuse cases | Contract tests for re-entrancy, signatures and TTL expiry, 199 passing. The Soroban host refuses re-entry itself, so these pin the property (one payout), not the code order. Contract code is unchanged, so no wasm hash moved | — Tests only |

Test counts on `main`: `npm test` 94 at #207, 108 at #216 (11 keeper tests from #214, 3 deadline tests from #216), 115 at #220 (7 redirect tests); `test:authz` 206 probes, `test:db` 30 cases; `cargo test --workspace` 199 at #207, 217 at #219 (210 without the wasm build).

#### Performance

| PR | What changed | Effect |
|----|--------------|--------|
| #173 | Recorded the live baselines after #160–#170, and the first live run with real throttling, in [performance.md](docs/performance.md) | Live mobile scores, before the work (12 Oct) → 13 Oct: home 35 → 59, `/projects` 42 → 82, project page 30 → 76. Desktop 94–97 on every page |
| #174 | Signed-out visitors share one set of project reads (fresh for 30 s, served stale up to five minutes while it refreshes). Signed-in visitors read their own, uncached | First byte on `/projects` 234–269 → 14–34 ms (local). Live had been 0.4–0.6 s |
| #175 | The Stages tab paints its rule paragraph from the server's HTML, and the builders' proof pictures are resized | Stages tab LCP 7.0 → 2.1 s, layout shift 0.064 → 0.014, pictures 477 → 106 KB (local, real throttling) |
| #176 | The menu's theme switch loads when the menu opens. Records what was tried against blocking time | About 27 KB less script per page. Blocking time unchanged: it did not fix it, and the doc says so |
| #178 | The header renders on the server, and the menu rows read their own data when opened | Blocking time `/` 1,239 → 1,155 ms, project page 905 → 838 ms. Exposed a first-paint race on `/projects`, fixed by #179 |
| #179 | Only the first card's picture on `/projects` is fetched at high priority | `/projects` LCP 3.0 → 2.4 s; all 10 runs got the fast first paint |

Still open from [performance.md](docs/performance.md): blocking time of 0.8–1.5 s on a phone with real throttling (it takes fewer client components in the shared layout), and a picture's first request after a deploy.

---
## Live vs shelf-ready

**Live on testnet:**
- **App:** everything on `main` through #220 at https://blkfndr.com (#216's deadline year and #220's `308` from the old address were both seen live on 2026-10-21; #214's keeper bond return fired on 20 Oct; #205–#213, #215 and #217–#219 change no app code, and #221 moves one lockfile entry), on Stellar SDK 16.3.1 and Next 16.4.1, with the nonce-based Content-Security-Policy (#204).
- **Vault** wasm `e9009410…`, deployed by the factory since 2026-10-06. Vaults are immutable, so older projects keep `70e5f3a8…` or `9c20bca3…` and the rule they were created with.
- **Factory** [`CBRUIRJX…`](https://stellar.expert/explorer/testnet/contract/CBRUIRJXRU6NGHOSF5KMPUOFIXIANCPI43QC6JX2PKNOKD3QSAHPLINO), **attestation** `CDEN2LU4…`, **identity** `CAILTHEY…`, **admin roster** `CAKANFZH…` and **treasury** [`CAGMEGMS…`](https://stellar.expert/explorer/testnet/contract/CAGMEGMS6MS6ENADUWDRW3GQ4XRBDYFFKHMRFVDEBHFCZW7NRO3TQPZW). They were redeployed 2026-10-06 and have been live in the app since 2026-10-07. Projects #1–#11 keep the previous factory `CDIXGE5M…` (closed to new launches) and attestation registry `CDLL2A4R…`. Details are in [smart-contracts.md](docs/smart-contracts.md#the-registry-redeploy).
- **Operations Vault** [`CCVXM3YP…`](https://stellar.expert/explorer/testnet/contract/CCVXM3YPPEMWG4INHFTZ4NBJ3PQW3ZUNYIZMBJBNYQOMSNOENQG7FDSN), unfunded until [item 1](#1-finish-the-operations-vault-cutover) is done.
- **Crons:** indexer, ops funding, stalled-vault keeper, storage keep-alive and governance keeper, all in `docker-compose.yml`. Since #214 the governance keeper also returns a missed goal's bond; it has returned three so far (#2, #3 and #28). The notification-emails cron also sends the identity reminders and ends walletless approvals after 30 days (#193). Its emails all fail until [item 3](#3-switch-on-email) is fixed; the bell is unaffected.
- **Replay check** ([scripts/replay-check.mjs](scripts/replay-check.mjs), #164): run by hand, read-only. It is not scheduled. 28 of 28 on 2026-10-21 (on its first run that morning one read got a 502 from the RPC and the check named #23 unreadable, not as a difference; the rerun matched).
- **Keeper dry run** ([scripts/keeper-dry-run.mjs](scripts/keeper-dry-run.mjs), #217): run by hand against live from a checkout. It deletes the submitter secret first, so it can only simulate.
- **Payout run script** ([scripts/payout-run.sh](scripts/payout-run.sh), #211): run by hand from the owner's PC, where its four Stellar CLI identities live. Only its `setup` step has sent anything (three wallets funded with 5 USDC each). Nothing has been staked, approved or released with it ([item 17](#17-run-the-first-live-payout)).
- **Coverage** (`npm run test:coverage` and `scripts/contract-test-map.sh`, #215): run by hand, no threshold, not in CI.
- **CI checks added this week:** `test:authz` (#201), `test:db` (#205), the dependency gate and SBOM (#194, #195) and the contract abuse tests (#206). They run on every PR and change nothing live.
- **Database:** every repo migration except `20261001160000` (kept as a no-op, superseded by `20261006155050`) and `correct_bootstrap_admin` ([item 6](#6-migration-history-drift-m-09)). Applied this week: `20261015140313` (#197), `20261015141432` (the grant revocation drafted in #139, applied by the owner), `20261015142340` (#198), `20261015143157` (#199), `20261015144208` (#200) and `20261015150429` (#202). Every one with a PR of its own was applied before that PR merged.

**Not active:**
- Email (#138): a Resend key is set, but Resend refuses the sender address ([item 3](#3-switch-on-email)).

There is no contract source ahead of testnet. Every contract's deployed wasm matches `main`. Hashes reproduce only on the same build paths ([item 11](#11-known-defects-found-not-yet-fixed)).

**Reference deployment (2026-10-06), not used by the app:** a standalone set built from source, holding the test transactions for the contribution, threshold-release and attestation deliverable ([evidence](docs/deliverables/contribution-threshold-attestation.md)). Projects A, B and C are finished and Project D is waiting. Project A completed on 2026-10-06. Project B failed closed on 2026-10-13: its lapsed stage was settled by an unrelated account, its five backers were refunded 2.5 USDC each, and the builder's record reads one completed, one forfeited ([`968e1ad8…`](https://stellar.expert/explorer/testnet/tx/968e1ad8b7156173cc2c6635aa59072ee26f56a15b79ee8b5d7d9172592afbc1)). Project C missed its goal on 2026-10-20 (#210): an unrelated account settled it ([`56785fa8…`](https://stellar.expert/explorer/testnet/tx/56785fa811fd00f968d3b16fdd733f3d2bc2e072dc56ee362780a2a8cd8eb206)), both backers took their whole 5 USDC back, and the 1 USDC bond went back to the builder. The builder's record reads one completed, one forfeited, one unfunded. These are the only missed-goal refunds on testnet so far. On the app's own vaults the keeper has returned three bonds after a missed goal (#2, #3 and #28), none of which had backers to refund. Project D (#213) is funded, with milestone 1's vote open on one approval; it closes on 2026-10-27 11:50 UTC and is left to lapse on purpose, so that `#17` VotingClosed can be shown and the lapse settled afterwards. On the app's factory, no stage has been paid out and no vault has stalled.

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
#138 emails notifications once Resend is set up. Until then the bell works as before, and the "one day left to vote" reminders still reach it.

**Where it stands (2026-10-21):** a Resend key is set, because the cron gets as far as Resend. But Resend refuses every send with `422 Invalid from field`, so the sender address on the host is not in a form it accepts. 13 notifications have failed: 11 between 15 Oct 03:24 and 17 Oct 01:02 UTC, and two at 17:24 UTC on 20 Oct. A refusal like this is final, not retried, so those 13 stay unsent. The count is 0 sent, 0 pending, 63 skipped, 13 failed. An email not sent within a day of its notification is marked skipped, so fixing the sender sends only new notifications, not a backlog.
1. Check `EMAIL_FROM` in the Portainer stack environment. It must read `BLKFNDR <notifications@blkfndr.com>` (or just the address), with no quotation marks around it, on a domain that shows as verified in Resend. Leaving it unset uses `BLKFNDR <notifications@blkfndr.com>`, which needs `blkfndr.com` verified. If it isn't yet, add the domain in Resend and its DNS records, and wait until it shows as verified.
2. Update the stack once. A plain `docker restart` keeps the old environment.
3. Run the cron's dry run ([deployment.md](docs/deployment.md#notification-emails-cron)) and check `wouldSend`, then confirm the next notification arrives.

The free plan sends 100 emails a day. People can turn off each category in Settings, or from any email. The identity reminders from #193 are also emailed; none is due at the moment (no approved check is waiting for a wallet).

### 4. Set `PINATA_GATEWAY_KEY` on the host
Without a Gateway Key, the dedicated gateway (`nft.blkfndr.com`) answers `401 ERR_ID:00024` for this account's pins, and reads fall back to the rate-limited shared gateway. #104 sends the key to the dedicated gateway only and doesn't follow redirects. **Host action:** add `PINATA_GATEWAY_KEY` to the Portainer stack environment and **Update the stack** (a plain `docker restart` keeps the old environment). **Success:** the app logs stop showing `nft.blkfndr.com answered 401`.

### 5. Apply the browser table-grant revocation
**Done 2026-10-15.** The owner applied the revocation drafted in #139 as `20261015141432`, after a dry run. It took `anon` off every write and `TRUNCATE`, cut `authenticated` back to the verbs and columns the app uses on eleven tables, and dropped `feature_requests_author_edit`. #205 renamed the repo file to the live version. Checked on live on 2026-10-19: `anon` holds no write or `TRUNCATE` grant on any public table, and the policy is gone.

### 6. Migration history drift (M-09)
**Mostly closed by #205.** A clean replay of the repo's migrations now works and is checked on every PR (`npm run test:db`). #205 added the missing `add_platform_admin_role` file, so the `admin_role` enum is created before it is used, and it renamed nine files to the versions live recorded: `community_feature_requests`, `moderator_roles`, `my_role`, `managed_attestor_keys`, `project_restrictions`, the three identity migrations of 2026-10-07 and the grant revocation. File order is now live order, and `supabase db push` would see those as applied.

What is left:
- **Two repo files live doesn't record:** `20260808090000_correct_bootstrap_admin` and the no-op `20261001160000`.
- **Different text:** of live's 41 recorded migrations, 17 match a repo file by statement hash and 23 differ in text (the 41st is the file #205 added). The replay can't show whether any difference is semantic.
- **The replay is a stand-in:** it runs in an in-memory Postgres with a model of Supabase's `auth`, `storage` and `vault`, not a real `supabase db reset`.

Closing this needs the Supabase CLI to compare a real reset with live.

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
- **Stakeholders have started collecting.** Refunds were collected on #5 and #7 on 2026-10-15 and on #10 on 2026-10-19, the first three refunds on the app's projects. #1, #8 and #11 are refunding with nothing collected yet.
- **Every funded project on the old code has now failed a stage**, and no stage has been paid out on any vault, old code or new. #4, #6 and #9 are still raising on the old code. The other way a raise ends, a missed goal with backers to refund, has run only on the reference deployment (Project C, 2026-10-20, #210): the app's three failed raises, #2, #3 and #28, had no backers. The keeper returned each builder's bond (#214).
- Nothing can change a deployed vault. A builder in this position can only tell stakeholders early, or relaunch on the new factory.

### 10. Unwired features — wire up or delete
#95 kept these because each is the only way into a feature that is otherwise built. Each needs a call from the owner.

| Code | Missing without a caller |
|---|---|
| `flagProjectAction` | Nothing can put a listing into owner-consensus review |
| `requestPasswordReset` | No "forgot password" UI. Email users can't recover a password |
| `respondToFeatureRequestAction` | Roadmap responses render, but nothing writes them. #198 limited the action to owners and to marking a request shipped |
| `getAdminAuditLogAction` | The audit log is written, but has no viewer |
| `attestationClient()` | A builder's track record is never shown |

`returnBond` left this list on 2026-10-20. Project C had shown the gap that morning (#210): after the settle and both refunds, the 1 USDC bond sat in the vault until `return_bond` was sent from the CLI by an unrelated account. The call is permissionless, so #214 made the governance keeper send it itself after a missed goal, in the run after the one that records it or in the same run; a builder has nothing to press. The hook's unused `returnBond` callback was deleted rather than wired to a button, since a button would only race the keeper. Backers still claim their own refunds. The new path has fired on the app's own vaults: it returned the 50 USDC bonds of #2 and #3 at 13:49 UTC on 2026-10-20, and #28's 2.5 USDC bond at 17:23 UTC, five seconds after settling that vault.

### 11. Known defects (found, not yet fixed)

| Where | Defect |
|---|---|
| [Header.tsx](src/components/layout/Header.tsx) | The side-menu Admin link follows on-chain admin status (`useAdminStatus`), not the roster, so console-only admins don't see it |
| [profiles.ts](src/lib/data/profiles.ts) | `syncAdminClaim` still writes `app_metadata.role`, which nothing reads |
| Operations Vault | `SetVotingWindow` has no bounds. A carried vote setting it to 0, or to an overflowing value, would stop the vault from ever passing another vote |
| Contract build | The wasm embeds absolute cargo paths, so hashes are machine-dependent. A pinned Docker build would fix it |
| Admin dashboard | Wider than a phone screen, so dialogs open off to the side |
| Location | Nothing writes `location_lat` / `location_lng`, so the map pin can't appear |
| Project #9 | Its deadline is in the year 9999 (read 2026-10-19). Its title was stored twice in a row ("OpenNode: … OpenNode: …"); it now reads once. #189's check found the descriptions of #9, AquaPure and MediPulse pasted in 4–6 times on 14 Oct. Worth checking whether it came through the launch form, since the factory accepts launches from anyone. #189 and #192 now stop a pasted-twice title or description at the form |
| Possible duplicate launch | #15 and #16 are the same listing ("AquaSense") from the same builder, opened 8 minutes apart on 2026-10-07 with separately uploaded metadata. The duplicate-launch guard (#86) matches creator and metadata CID, so it only catches an unchanged draft launched again. Ask the builder whether the first launch looked failed to them |

**Resolved this week:**
- QA Cycle 7's findings BF-108 to 113, 115 to 118 and 120 (#181–#190), and the follow-ups #192 and #193. Identity details are now checked on the server (BF-108), which closes the gap where a check with a date of birth of today was accepted.
- The Gate 4 findings M1, M2, M3, L2, L4 and F1 (#196–#200), the A01 gap in `grantAdmin` (#201), and the dependency findings (#194, #195). The ZAP baseline's one real Medium, a missing Content-Security-Policy, is fixed (#204), along with the `X-Powered-By` header (#203).
- The browser table-grant revocation (item 5) is applied, and M-09's failing clean replay is fixed (#205, item 6).
- The listing draft coming up pre-filled with the last launched project (#180, #187).
- A slow first byte on `/projects` and the project page (#174), and the Stages tab's late first paint (#175).
- The QA plan expected a deposit after the deadline to be refused `#7`; the vault refuses it `#2`, because the state check runs first. Project C showed it on testnet, and the plan's expected code is fixed (#210, finding 9). Contract and unit test were right.
- The deadline shown without its year, and the fee labelled "XLM flat" (#216). The builder's bond after a missed goal, which nothing returned (#214, item 10).

### 12. Manual passes still owed
Since 2026-10-13 the owner has done two of the passes that were owed: a Freighter stake (the demo, 17 Oct, #22) and a Freighter wallet link with #200's new signed message (15 Oct). Refunds were collected on #5, #7 and #10. Still not seen with a real wallet or account:
- a Freighter decline and a timeout in the stake and launch flows
- an admin clicking Hide or Lock in the console (the last restriction was 2026-10-01)
- linking a different Freighter account from the header
- QA's retest of the boundary cases TC-01 to TC-09 against #109–#111
- the Cycle 7 changes with a real signed-in account: the identity form's server checks and address parts (#181, #182), the listing-quality block on a real launch (#189, #192), the account menu (#186) and per-account drafts (#187). Their PRs were checked with stand-in sessions
- the 30-day limit on a walletless approval (#193): its day-30 step was dry-run on live and rolled back, and no approved check is waiting for a wallet any more, so its reminders have not been seen
- an email actually arriving ([item 3](#3-switch-on-email))

### 13. Delete the legacy identity data
The 2026-10-07 deletion audit found the app clean. Three things are left ([privacy.md](docs/privacy.md#open-items)):
- **MongoDB Atlas.** From 2026-07-17 to 2026-08-07 the app stored ID images as base64 in a `KycRequest` collection, never migrated. An owner checks whether the cluster still exists, and if so deletes the collection or the cluster, with its snapshots.
- **Pinata.** One private, PGP-encrypted file from 2026-07-21 isn't from this app. Confirm with whoever uploaded it.
- **Display name fallback.** `handle_new_user` uses the email as the display name when an account has no name. No live profile does today, but the fallback should change.

### 14. Protocol 29 and the Stellar SDK
Testnet reports protocol 29 (`getVersionInfo`, 2026-10-21), but the RPC and core software are now 30.0.0 (stellar-rpc and stellar-core, built 20 Oct 22:36 UTC), so a protocol 30 upgrade may follow. No JS SDK supports protocol 29 yet: 16.3.1 and 17.2.1 stop at protocol 28. #169 made every scheduled job read the latest ledger from `getHealth`, which decodes no XDR, and the app's own transactions decode only their own envelopes, so nothing depends on other users' XDR any more. If someone's transaction uses a protocol 29 feature (muxed contracts, ML-DSA keys, millisecond close times), anything that still decodes whole ledgers would fail again. Upgrade once an SDK with protocol 29 ships. 17.x also makes v2 auth entries the default, so Freighter signing must be re-checked then.

### 15. Record the testnet demo
**Recorded 2026-10-17; only the public link is outstanding.** The [demo script](docs/deliverables/testnet-demo-script.md) was followed on project #22: a 5 USDC stake, signed in Freighter by the owner's wallet, [`3c8a6b61…`](https://stellar.expert/explorer/testnet/tx/3c8a6b61dbc7b8ea8b159ff3b84db6d719e36f74938bfbac60641cee8d00f2e2) at ledger 5235071. Afterwards the project page showed $205 of $5,500 and "Your stake $5", and the replay check matched 25 of 25 vaults. The video is `BLKFNDR-Demo-Stake-Proof.mp4` (landscape and portrait, 1:49). The stake, the replay output and the video are recorded in the [deliverable evidence](docs/deliverables/web-app-indexer-demo.md#3-the-testnet-demo) (#207). **Left, unchanged on 2026-10-21:** upload the video and add its public link there.

### 16. Gate 4 — what is left
Gate 4 (security and test QA, 2026-10-15) is worked through for everything fixable in code. These need the owner or a separate approval:
- **Scans not run:** an authenticated DAST scan (it needs a signed-in session) and ZAP's active scan, which sends attack payloads to the live site. #203 ran the passive baseline only.
- **Coverage measured, target unset.** Measured 2026-10-20 ([qa-test-plan.md §11](docs/deliverables/qa-test-plan.md#11-entry-exit-and-sign-off); `npm run test:coverage` repeats it). No coverage target is written down anywhere, so the figures are read against the Gate 4 playbook's 80% default. The 13 modules `npm test` loads sit at 95.84% of lines, 87.86% of branches and 91.82% of functions, but they are 13 of the 88 modules under `src/lib`, which comes to 13.98% of lines over every module and 3.91% over all of `src`. Against 80% the suite meets the target only for the modules that have tests, not for the code base. The contracts have no line figure: `cargo llvm-cov` is not installed on the build machine. The fallback was 199 passing tests after the wasm build (193 without it) and a direct test call on every one of the vault's 20 entrypoints, with eight admin and read entrypoints on the other contracts untested, the factory's `update_wasm_hash` among them. #218 and #219 then added 18 tests (217 after the wasm build, 210 without it), and the map flags no untested entrypoint. The owner sets the number and whether it applies to `src/lib` or to the tested modules.
- **`style-src 'unsafe-inline'`** remains in the Content-Security-Policy (#204): Radix, framer-motion and next-themes insert `<style>` elements at runtime without a nonce. Injected CSS cannot run script, and the script policy is what stops XSS, so #204 proposes accepting it. The owner's call.
- **One accepted dependency advisory** (#195, #221): the Jaeger propagator in genkit's OpenTelemetry tree, not reachable because `OTEL_PROPAGATORS` is unset. The second one #195 accepted, the Prometheus exporter's, is no longer reported, and #221 removed its entry. The one left stays until genkit ships OpenTelemetry 2.x, or the owner drops the AI listing check. `npm run audit:gate` warns when an accepted one stops being reported.
- **Role decisions** (#201, #197): `POST /api/admin/platform-settings` (the fee contact email) and project-moderation flag, vote and clear accept any admin role. Should accountants and KYC reviewers be able to? Separately, an owner can still ban another owner alone. Should that need a vote?
- **A reviewer's own attestor key** (#196): a reviewer who also holds a self-custodied attestor key on the identity registry could attest themselves on-chain, outside the app. Only an owner appoints those keys.
- **`grantAdmin` reads the first 50 accounts only** (#199). Live has 23, and an account beyond the first page is bound by the confirmation trigger anyway.
- **Cloudflare's pages** under `/cdn-cgi/` (email obfuscation) carry none of the security headers (#203). Switching off Email Address Obfuscation removes them. COOP, COEP and CORP are not set, a hardening suggestion.

### 17. Run the first live payout
No stage has been paid out on an app vault, and the governance keeper's release path has never fired live; only its lapse and missed-goal paths have. #211 prepared the run. The [checklist](docs/deliverables/payout-run-checklist.md) is the session plan: about 45 minutes, 15 of them waiting for the keeper.
- **The owner, in the app with their own wallet:** launch a one-stage project of 15 USDC, in their own words and with a picture, with a deposit of 0.75 USDC or more, and sign in Freighter. Once the three stakes are in, open the stage's vote with **Ask stakeholders for this payout** and sign again.
- **The script, from the owner's PC:** [payout-run.sh](scripts/payout-run.sh) reads the vault (`status`), sends three 5 USDC stakes from `pay-s1`, `pay-s2` and `pay-s3`, which close the raise (`stake`), sends their three approvals and reads the three release conditions (`approve`), then waits for the keeper's `release_milestone` and prints the release transaction, the `Completed` record and the builder's summary (`watch`). `release` is a fallback that sends the same permissionless call from `pay-anyone`. Every write can be rehearsed with `--dry-run`.
- **Done so far:** the three wallets hold 5 USDC each (read on Horizon, 2026-10-20), a dry-run stake on #22 passed, and the preconditions were read: the builder wallet is KYC-approved on the production identity registry, the factory charges 1 USDC with a 5 USDC minimum stake, the attestation registry trusts the factory, and the keeper answers its dry run.
- **Afterwards:** the replay check, then the demo evidence, the QA plan (VLT-22, VLT-25, CTA-23, CTA-24) and this file's Snapshot, in the order the checklist gives.

### 18. Finish the move to blkfndr.com
The site answers at https://blkfndr.com, and `testnetv2.blkfndr.com` sends a `308` to the same path there (#220, both read 2026-10-21). What can't be seen from outside, or is still open:
- **Supabase's URL settings.** #220 asks for the Site URL and the two Redirect URL entries to name `https://blkfndr.com`, keeping the old entries and listing the old origin in `APP_URLS` while sign-ins can still start there. Sign-in at the new address has not been checked here, because it needs a real account: do one Google sign-in and one email sign-in on `https://blkfndr.com`, and one that starts from an old link.
- **`www.blkfndr.com` has no DNS record** (it answers NXDOMAIN, 2026-10-21). Add one at Cloudflare if it should work.
- **The Facebook preview** (#188, #191) caches by address: re-scrape `https://blkfndr.com/` in the Sharing Debugger.
- **Docs:** the first line of the [web app, indexer and demo evidence](docs/deliverables/web-app-indexer-demo.md) has its note about the old address inside the link's parentheses (`(https://blkfndr.com; it was … redirects)`), so the link target is wrong.

---

## Next week
1. **Watch #26's raise end** on 2026-10-26 at 11:04 UTC. It has a 20 USDC goal and nothing staked so far, so the keeper should settle it and return its bond within one run (15 minutes), as it did for #28. Check for `VAULT/FAILED` and `BOND/RETURNED`, the builder told, and the replay check still matching.
2. **Run the first live payout** per the [checklist](docs/deliverables/payout-run-checklist.md): the owner launches a one-stage 15 USDC project and asks for its payout in the app; the script stakes, approves and watches the keeper release (item 17).
3. **Publish the demo video** and add its public link to the deliverable evidence (item 15).
4. **Fix the email sender** so Resend accepts it, and set `PINATA_GATEWAY_KEY` (items 3 and 4). One stack update covers both.
5. **Owner votes:** move or write off the old Operations Vault's 25 XLM, and `SetOpsFunding` on the treasury (item 1).
6. **Owner decisions:** a coverage target, and whether it applies to the tested modules or to the code base (#215, item 16); the Phase 2 items on Wallets Kit, fee sponsorship and stakeholder names (item 7); and Gate 4's other leftovers (item 16).
7. **On or after 27 Oct:** simulate an approval of Project D's milestone 1 after its window has closed, to show `#17`, then settle the lapse ([QA plan §10](docs/deliverables/qa-test-plan.md#10-execution-schedule-and-evidence-to-collect), #213).
8. Close M-09: delete or record the two repo-only migration files, and compare a real `supabase db reset` with live (item 6).
9. Ask the builder of #15 and #16 why the listing was opened twice, and of #9 about its deadline (item 11).
10. Check MongoDB Atlas for the legacy identity data (item 13).
11. **Finish the move to blkfndr.com** (#220): sign in once there with Google and with email, check Supabase's URL settings, decide on `www`, and re-scrape the Facebook preview (item 18).

---

## Before this week

### #152–#170 (2026-10-10 to 2026-10-12)

**In short:**
- **The week's target is two-thirds done.** The web app with Freighter (backing a project in six taps) and the indexer were already live. This week proved the indexer's events rebuild every vault exactly (#164). The demo script is written and dry-run (#166), and the evidence is in [web-app-indexer-demo.md](docs/deliverables/web-app-indexer-demo.md) (#167). **The video is still to be recorded.**
- **Indexer.** New vaults' opening events are no longer missed, and the 40 missing rows were backfilled (#152). A failing event is retried, then skipped after five attempts, instead of holding every project back (#153).
- **Speed.** QA's performance audit is worked through (#154–#162, #168, #170). The browser no longer calls the Soroban RPC, pictures are resized, and pages render on the server. On a throttled phone, `/projects`' largest paint went from about 8.6 s to 2.9 s.
- **Testnet moved ahead of the SDK.** Testnet runs protocol 29. SDK 15.1 failed to decode about one ledger in five, which broke `getLatestLedger` and with it keep-alive about one run in five. Upgraded to 16.3.1 (#169).

#### Web interface, indexer and testnet demo

| PR | What changed | Live? |
|----|--------------|-------|
| #152 | **New vaults' opening events.** The indexer reads a vault the factory deploys in the same pass, so its `VAULT/INIT` and `BOND/POSTED` are stored. The 40 rows it had missed (#2–#9, #11–#22) were backfilled on 2026-10-10. Health check: one `BOND/POSTED` per `FACTORY/DEPLOY` (22 of 22) | ✅ |
| #153 | **Retries.** A failed event is retried on later passes and skipped after five attempts. Builder-supplied data (a NUL in a CID, malformed metadata) no longer fails an event on every attempt. Migration `20261010153244` | ✅ |
| #164 | **Vault state rebuilt from events.** [vault-replay.ts](src/lib/vault-replay.ts) replays a vault's stored events with the contract's rules: status, raise, payouts, stages, votes, the deposit and every staker's balance. Only the goal, deadline and stage ids are read from the vault, because no event carries them. [replay-check.mjs](scripts/replay-check.mjs) compares the result with the chain for every vault. All 22 match. With one stake left out, it reports the vault and fails | ✅ Script, read-only |
| #165 | Found in the demo dry run: at 1280×720 the open stake sheet made the desktop card taller than the screen, so **Review and sign** only came into view at the bottom of the page. The card is now capped at the screen height and scrolls | ✅ |
| #166 | [Demo script](docs/deliverables/testnet-demo-script.md): project #22, six taps from the list to a confirmed stake, seven shots with voiceover notes, a pre-recording checklist and fallbacks | — |
| #167 | [Deliverable evidence](docs/deliverables/web-app-indexer-demo.md) for the web app, the indexer and the demo. The video, its stake transaction and the replay output after it are still to be added | — |

#### Performance (QA report of 2026-10-04)

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

#### Platform

| PR | What changed | Live? |
|----|--------------|-------|
| #169 | **Stellar SDK 15.1 → 16.3.1.** `getLatestLedger` decodes the newest ledger's full meta, including other users' transactions, and protocol 27/28 XDR in them failed to decode in 32 of 160 ledgers. 16.3.1 decoded all of them. Keep-alive and the replay check now read the latest sequence from `getHealth`, which decodes no XDR, as the indexer already did. 17.x was not chosen: it rewrites the XDR API and makes v2 auth entries the default | ✅ |

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
- **QA-RPT-BLKFNDR-2026-10-04-BT and -CON:** fixed by #107 and #109–#114. A retest is owed ([item 12](#12-manual-passes-still-owed)).
- **QA Cycle 7 (report v7.0, BF-108…120):** fixed by #181–#190 and the follow-ups #192 and #193 (see [This week](#this-week-171221)).
- **Gate 4 security and test QA (2026-10-15):** remediated by #194–#206, coverage measured by #215. What is left is [item 16](#16-gate-4--what-is-left).

_Per-finding audit detail is in the security-audit PDF. Per-PR detail is in the PR descriptions._
