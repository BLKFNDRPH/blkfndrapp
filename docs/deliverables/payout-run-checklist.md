# Payout Run: the first stage payout on a live project

Prepared 2026-10-20. A small project on the app's own factory goes from launch to a paid stage in one sitting: the builder launches it and opens the vote in the app, three scripted stakeholder wallets back it and approve, and the governance keeper sends the payout. About 45 minutes, of which 15 are waiting for the keeper.

Everything the script does is in [scripts/payout-run.sh](../../scripts/payout-run.sh). Every transaction it sends is appended to [deployments/testnet-production/payout-run.tsv](../../deployments/testnet-production/payout-run.tsv).

## What it proves

None of these has happened on the app's vaults yet:

- a stage vote that carries on an app vault;
- the governance keeper sending `release_milestone` (its payout path has never fired live; only its lapse and missed-goal paths have);
- a payout and the bond returned to a builder on testnet;
- a `Completed` record on the production attestation registry, which holds no record today;
- the Record tab's "Sent an approved payout to the builder" line, and the indexer handling `MILESTN/RELEASE` live;
- in the QA plan: VLT-22 and VLT-25 on production, the payout half of CTA-23, CTA-24 on production; and the end of "No stage has been paid out yet" in progress.md.

## Preconditions, checked 2026-10-20

| Check | Result |
|---|---|
| Builder wallet `GCU5OQLXJXSPK7RNEPGMM6VKKXNBB3GCRYBHNFA2ID2GJQURIFY7KDZM` is KYC-approved on the production identity registry `CAILTHEY…` | `is_kyc_approved` reads `true`. The app's own check is approved until 2074-03-16. The wallet holds 9,433 USDC and 15,833 XLM, and has launched #5 and #6 before |
| Production factory `CBRUIRJX…` parameters | Fee 1 USDC, minimum stake 5 USDC, bond 5% of the goal, voting window 7 days. 28 project ids issued, so the new project is #29 unless someone launches first |
| The attestation registry `CDEN2LU4…` trusts the factory | `is_factory_trusted` reads `true`. A completing release writes the record in the same transaction, so an untrusted factory would make the payout revert |
| Governance keeper | Live dry run at 09:56 UTC: "Nothing was due (checked 20 vaults)". It polls every 900 s and acts on every project not yet completed or refunding in Postgres; a failed raise stays on its list until the vault reports the bond returned |
| Stake wallets, 5 USDC each, funded from `ba-escrow-deployer` | `pay-s1` `GCPFTAWZHRULWHIKKKHTKJGAH7EDRLSTRBK4VWIKIXTLWTUEJIBXZG5J` ([`b1fa0eb1…`](https://stellar.expert/explorer/testnet/tx/b1fa0eb1dd2eab8c37d1d35d0e8d8d7357d74c09ae9bde3878c98a0cd0f2c742)), `pay-s2` `GA2YRIWG6PXTK7CD36EKR5JH3O2EZHF65HU3OONJYEFUARQWNPZDHZVB` ([`e550f7e4…`](https://stellar.expert/explorer/testnet/tx/e550f7e4014eb4727ae3e54b8c2ea92badc09dcc6c303104eb4f0caea680c2c7)), `pay-s3` `GBEVEU2AVY42WWTE4XUDNCM74OJTBKRT3BA4TQ7GPCB7L2U3A4Z5FGQU` ([`fc2f5693…`](https://stellar.expert/explorer/testnet/tx/fc2f56935789f65f2499207e0a80d3f5a87ec6179ac849395a603765042b2592)). `pay-anyone` `GBNGJS3T…` reads and sends the fallback. All four are Stellar CLI identities on the owner's PC only |
| The stake step | Rehearsed against #22 with `--dry-run`: all three stakes accepted in simulation, nothing sent |

## The run

The builder does steps 1 and 4 in the app with their own wallet. The script does the rest. Commands run from the repo root.

| # | Who | Do | Expect | Capture |
|---|---|---|---|---|
| 1 | Builder, in the app | Sign in and launch a project with the values below. Review, then sign in Freighter | The project page opens. Its number is in the URL | The launch transaction hash from the outcome card; the project number |
| 2 | Script | `bash scripts/payout-run.sh status <n>` after about a minute | State 0, raised 0 of 150000000, one stage, "next stage to pay 1", builder summary `[0,0,0]` | Screenshot of the project page, LIVE: $0 of $15, one stage, Record tab "Opened a vault" |
| 3 | Script | `bash scripts/payout-run.sh stake <n>` | Three transactions. "goal reached, raise closed" with state 1 | The three hashes. Screenshot: the page shows the goal reached and three stakeholders; the Record tab shows three stakes |
| 4 | Builder, in the app | Stages tab, stage 1: add a line of proof if you like, then **Ask stakeholders for this payout**. Sign in Freighter | The stage shows an open vote with 7 days to run | The hash; screenshot of the open vote |
| 5 | Script | `bash scripts/payout-run.sh approve <n>` | Three transactions, then weight `[90000000,45000001,true]`, wallets `[3,3]`, money `[150000000,75000001]`, and "the vault accepts a release: yes" | The three hashes; screenshot of the vote panel showing it carried |
| 6 | Script, then the keeper | `bash scripts/payout-run.sh watch <n>` and wait. The keeper sends `release_milestone` within 15 minutes | State 5, vault balance 0, bond returned, record outcome 0, builder summary `[1,0,0]`, the `ATTEST/RECORDED` event | The release hash the script prints; screenshot of the project page completed and the Record tab's "Sent an approved payout to the builder" |
| 7 | Script, from the main checkout | `node --env-file=.env.local scripts/replay-check.mjs` | Every vault matches, the new one included, with its stage paid | The "N of N vaults match" line |

**Launch form values.** Keep the words your own: the listing check refuses pasted or repeated text, and it looks at the picture too.

| Field | Value |
|---|---|
| Title, tagline, description | A real small build, in two or three sentences. Not "test" or "payout run" |
| Picture | Required |
| Category | Any |
| Currency | USDC |
| Stages | One. Name it after the work, amount **15**. The goal fills in as the sum |
| Deposit | The minimum, 5% of the goal, is 0.75 USDC. Any amount at or above it works |
| Deadline | At least a day out. A week is fine: the raise closes the moment the goal is met, and the deadline matters only if it is not |
| Cost to the builder | 1 USDC fee, the deposit, and a little XLM for the opening transaction. The deposit comes back with the payout |

**Why 15 USDC and three wallets.** Each wallet stakes 5, the minimum. The weight cap is 20% of the raise, so each counts 3 of a capped total of 9, and a release needs more than 4.5. The wallet floor is three distinct approvers, or every stakeholder when fewer backed the project. The money majority needs approvers holding more than 7.5 of the 15. Three approvals clear all three bars; two clear none of the last two.

## Afterwards

Record it, in this order:

1. `payout-run.tsv` already has every transaction. Add the builder's two hashes (launch, vote opened) to it by hand.
2. [web-app-indexer-demo.md](web-app-indexer-demo.md): the "Testnet has so far exercised these paths" paragraph, and a short section with the hashes, the replay-check line and the screenshots.
3. [qa-test-plan.md](qa-test-plan.md): VLT-22 and VLT-25 gain a production hash; CTA-23 gains the payout observation (time from the carrying approval to the keeper's release); CTA-24 gains the production record; the §9 paragraph loses "no payout on a production vault".
4. `progress.md`: the Snapshot's Projects row and the "No stage has been paid out yet" sentences.
5. If the demo video is still to be re-recorded, this run is the natural second clip: the vote, the payout and the Record tab.

## If something goes wrong

| Symptom | What it means | Do |
|---|---|---|
| The launch stops on the quality check | The text reads as pasted or repeated, or the picture is missing | Rewrite in your own words; add the picture |
| `stake` stops with "Only N base units are left" | Someone else staked first; the project is public | Launch another project and stake right after it opens. If a stranger holds 7.5 USDC or more, their approval is needed too |
| `approve` says the vote is not open | Step 4 has not happened, or a later stage is meant | Open it in the app, or pass `--milestone <id>` |
| An approval is refused `#19` | That wallet is not a stakeholder on this vault | Check the project number; `status <n>` lists the stakers |
| `approve` ends with "does not accept a release yet" | One of the three conditions is short; the script prints all three | Read them. With other stakeholders present, their votes count too |
| `watch` sees nothing after 20 minutes | The keeper has not run, or its key cannot pay | `bash scripts/payout-run.sh keeper-dry-run --env-file <path to .env.local>`. "would-send release" with nothing sent points at the keeper's key or interval on the host. The fallback, `bash scripts/payout-run.sh release <n>`, sends the same permissionless call from `pay-anyone` |
| A release is refused in simulation | `#20` threshold short, `#15` vote not open, `#17` window closed. A registry error (`#3`, `#7`) would mean the factory is not trusted, which was checked today | Read the code; nothing is lost, the vault refused |
| The project page lags the chain | Figures and the Record tab update once per indexer pass, up to 60 s | "Read the vault again" on the page, or wait a minute |

A dry run of any writing step (`--dry-run`) simulates every call against the real vault and sends nothing, so steps 3 and 5 can be rehearsed on the day before pressing anything.
