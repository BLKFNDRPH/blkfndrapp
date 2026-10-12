# Web Interface, Lightweight Indexer & Testnet Demo

Evidence for the deliverable, as of 2026-10-12. Everything below runs on Stellar Testnet against the live app at [testnetv2.blkfndr.com](https://testnetv2.blkfndr.com). The recorded video and its stake transaction are still to come; they are marked **⏳ pending** and listed under [Still to do](#still-to-do).

## The deliverable

A React web app with Freighter wallet integration, where a contributor backs a project in a few taps; a lightweight indexer that reconstructs vault state from on-chain events; and a recorded end-to-end demo video.

| Part | Status | Evidence |
|---|---|---|
| React web app with Freighter, backing a project in a few taps | ✅ Live | [Six taps](#backing-a-project-in-six-taps) from the project list to a confirmed transaction; every on-chain action is signed in the person's own Freighter wallet |
| Lightweight indexer that reconstructs vault state from on-chain events | ✅ Live | One route plus one cron container. The [replay check](#reconstructing-vault-state-from-events) rebuilds all 22 testnet vaults from their stored events alone, and all 22 match the chain |
| Recorded end-to-end testnet demo | ⏳ Script ready, recording pending | [Demo script](testnet-demo-script.md) dry-run on the live site; video link below once recorded |

---

## 1. The web app and Freighter

**Stack.** Next.js 16 with React 19 (App Router), Tailwind and Radix UI, on Supabase (Postgres with row-level security) and Soroban smart contracts. Open source, MIT: [BLKFNDRPH/blkfndrapp](https://github.com/BLKFNDRPH/blkfndrapp).

**Freighter integration** (`@stellar/freighter-api` 6, `@stellar/stellar-sdk` 15):

- **Linking a wallet** proves the signed-in account controls a Stellar address. The server issues a one-time challenge (`POST /api/auth/freighter/nonce`), Freighter signs it, and the server checks the signature (`/verify`) before writing the address to the profile. Signing in never touches a wallet, and linking a wallet never signs anyone in. See [authentication.md](../authentication.md#linking-a-wallet-freighter).
- **Every on-chain action** (stake, vote, refund, opening a vault) is built by the app, run as a test first, then signed in Freighter and sent. The platform holds no key over stakes or votes.
- **The network** comes from one setting (`NEXT_PUBLIC_STELLAR_NETWORK`, [src/lib/network.ts](../../src/lib/network.ts)). A wallet on the wrong network is named in the sheet rather than failing at signing (#150).

### Backing a project in six taps

Measured on the live site on 2026-10-12, project #22 ([AniDry – Smart Hybrid Rice Dryer](https://testnetv2.blkfndr.com/projects/22)), for a signed-in person with a ready wallet:

| # | Tap | What the person sees |
|---|---|---|
| 1 | The project card on `/projects` | The project page: amount staked of the goal, the asset, the deadline, the builder's locked deposit, the stage plan |
| 2 | **Stake from $5** | The stake sheet, in the side card (desktop) or in the page (phone) |
| 3 | A preset (**$5**, **$25**, **$100**) or a typed amount | The minimum and the most that can go in, from the vault |
| 4 | **Review and sign** | The app runs the transaction as a test, then shows what leaves the wallet, the exact network fee in XLM, and "Fee to BLKFNDR $0.00" |
| 5 | **Open Freighter** | Freighter, showing the same amount |
| 6 | **Confirm** in Freighter | "You're a stakeholder in …", **Recorded on-chain**, and the transaction hash linked to Stellar Expert |

Four of the six taps are on the project page. A signed-out visitor can open the sheet too. It shows one **Sign in** card, and after signing in the person comes straight back to the stake.

**Wallet gates live inside the sheet.** No wallet, wrong network, an inactive account, no USDC trustline and not enough USDC each show as a card with its fix: activating the account with Friendbot, adding the trustline with one signature, or Circle's test faucet. The person never leaves the stake to sort out their wallet. Every failure is explained in plain words, with a line saying whether money moved.

**Built over these PRs:** the stake sheet (#116), votes and refunds through the same confirm flow (#118), the wallet setup flow (#129), the network setting (#150), a server-rendered project page that loads the Stellar SDK only when someone acts (#157–#162), and the desktop card fix from the dry run (#165).

---

## 2. The lightweight indexer

**What it is.** [src/lib/event-indexer.ts](../../src/lib/event-indexer.ts) behind one route, `POST /api/indexer`. An `indexer-cron` container (`curlimages/curl`, in [docker-compose.yml](../../docker-compose.yml)) calls the route every 60 seconds. There is no separate service, queue or database: events go into one Postgres table (`contract_events`), with one cursor (`indexer_state.last_processed_ledger`).

**What a pass does.**

1. Reads `getEvents` from the RPC, from one ledger after the cursor. It covers the factory and every known vault, five contracts per filter, and follows the RPC's cursor across quiet ledgers. See [indexer-scan.ts](../../src/lib/indexer-scan.ts).
2. Picks up a vault the factory deploys during the pass straight away, including its opening events (#152).
3. Stores each event under its unique id, so a replayed pass changes nothing. It then handles the event:

   | Event | Handling |
   |---|---|
   | `FACTORY/DEPLOY` | Creates the project: listing text from the metadata on IPFS, figures and stages from the vault |
   | `VAULT/*`, `BOND/*`, `DEPOSIT/*`, `MILESTN/*` | Refreshes the project's figures, status and stages |

4. Retries a failed event on later passes, and gives up after five attempts so one bad event cannot hold every project back (#153).
5. Moves the cursor only past what was fully handled.

**What reads the events.** The project page's **Record** tab is the vault's history written from the stored events, such as "Stakeholder #2 staked $25.", each line linked to its transaction (#132). Notifications ("a vote opened", "money is waiting") are produced from the same events (#134).

**Health on 2026-10-12, 13:48 UTC:**
- The indexer was 5 ledgers behind the chain (5157849 vs 5157854), and no event was failing.
- It held 141 events: 112 from the vaults, the 22 vault openings (one per project), and 7 other factory events.
- Every vault had its `BOND/POSTED`: 22 of 22.

### Reconstructing vault state from events

To keep the figures exact, the indexer re-reads a vault when one of its events arrives. To show that the events are enough on their own, [src/lib/vault-replay.ts](../../src/lib/vault-replay.ts) replays a vault's stored events in chain order, with the same rules as the [vault contract](../../contracts/blkfndr-vault/src/lib.rs), and rebuilds:

- the status: raising, funded, active, failed, refunding or completed. A raise past its deadline that nobody has settled reads as funded or failed, as `get_state` does;
- the amount raised and the amount paid out;
- each stage: paid, failed, when its vote opened, and the approval weight behind it;
- the builder's deposit: posted, returned;
- the stakes not yet refunded, and every staker's balance.

It also checks the running totals the events carry (the new total after each stake, each approval and each payout), so a missing or duplicated event shows up in the events themselves.

Only the terms fixed when a vault opens are read from the vault: its goal, deadline and stage ids. No event carries them. The opening events carry only the metadata CID, and the metadata document is the builder's word, not the vault's.

[scripts/replay-check.mjs](../../scripts/replay-check.mjs) runs the replay for every vault and compares it, field by field, with what the vault reports: `get_state`, `get_info`, `contributor_count`, and `get_balance` for each staker. It only reads, and it exits 1 on any difference (#164).

**Result, 2026-10-12 13:48 UTC: 22 of 22 vaults match the chain.**

| Project | Events | State | Raised | Stakers | Stages |
|---|---|---|---|---|---|
| #1 | 11 | refunding | 1,000 | 3 | failed, open |
| #2 | 3 | failed | 0 | 0 | open |
| #3 | 3 | failed | 0 | 0 | open |
| #4 | 4 | raising | 55 | 2 | open ×2 |
| #5 | 12 | refunding | 2,000 | 1 | failed, voting |
| #6 | 2 | raising | 0 | 0 | open ×2 |
| #7 | 12 | refunding | 4,000 | 2 | failed, voting |
| #8 | 10 | refunding | 2,000 | 1 | failed, voting |
| #9 | 5 | raising | 183 | 3 | open ×2 |
| #10 | 7 | funded | 3,000 | 1 | voting, open |
| #11 | 8 | funded | 3,000 | 1 | voting ×2 |
| #12 | 2 | raising | 0 | 0 | open ×3 |
| #13 | 5 | raising | 225 | 2 | open ×3 |
| #14 | 3 | raising | 25 | 1 | open ×4 |
| #15 | 2 | raising | 0 | 0 | open ×2 |
| #16 | 6 | raising | 630 | 2 | open ×2 |
| #17 | 3 | raising | 100 | 1 | open ×8 |
| #18 | 3 | raising | 100 | 1 | open ×3 |
| #19 | 3 | raising | 100 | 1 | open ×3 |
| #20 | 2 | raising | 0 | 0 | open ×6 |
| #21 | 2 | raising | 0 | 0 | open ×2 |
| #22 | 4 | raising | 200 | 2 | open ×8 |

Amounts are in each vault's asset (USDC, except #19 in XLM). Nothing has been paid out yet on any vault.

Every vault, old code and new, exposes every field compared, so no field was skipped. Each vault's state, raise, payouts, deposit (amount, posted, returned), unrefunded stakes, staker count, every staker's balance, and each stage's paid/failed flags, vote opening time and approval weight all matched.

Testnet has so far exercised these paths: stakes, goals reached (#10, #11 and others), missed goals (#2, #3), votes and approvals, and failed votes with the deposit kept for stakers (#1, #5, #7, #8). No payout, stall, refund or deposit return has happened on testnet yet. Those paths are covered by the unit tests until one does.

**The check can fail.** With one stored stake of #16 left out of the replay, the script reported #16 as a mismatch: the amount raised, the unrefunded stakes and one staker's balance, plus three broken running totals. It exited 1. [vault-replay.test.ts](../../src/lib/vault-replay.test.ts) covers stakes, a deadline passing, payouts through to completion, a stall and the final refund sweep, a failed vote, event order, and the detection of a missing event or a wrong field (`npm test`, 36 of 36 passing).

---

## 3. The testnet demo

**Script:** [testnet-demo-script.md](testnet-demo-script.md) (#166). It runs about 4 minutes in seven shots: the vault, the project, the six-tap stake, the transaction on Stellar Expert, the total and the Record tab updating, the replay check, and a close. It includes a pre-recording checklist and what to do if a take goes wrong.

**Dry run, 2026-10-12**, on the live site:
- **Demo project:** #22 runs the current vault code (`e9009410…`), raises USDC, has 8 stages and is open until 31 Dec 2027.
- **Fix found:** at 1280×720 the open stake sheet made the desktop card taller than the screen, so **Review and sign** only came into view at the bottom of the page. Fixed in #165, which caps the card at the screen height and scrolls it. Live since 2026-10-12: the deployed CSS carries the new rule.
- **Minor, not fixed:** the project page gives the deadline without its year ("Ends 31 Dec (445 days)").

**The recording**

| Item | Value |
|---|---|
| Video | ⏳ pending |
| Stake transaction | ⏳ pending |
| Replay check after the stake | ⏳ pending (expect #22 at 225 raised, 3 stakers, and 22 of 22 matching) |

---

## Rerun it

```bash
npm test
node --env-file=.env.local scripts/replay-check.mjs
node --env-file=.env.local scripts/replay-check.mjs --json
```

The check needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (read-only use of `contract_events` and `indexer_state`), plus the RPC. A vault with events newer than the indexer's cursor is reported as "behind", not as a difference; rerun a minute later.

## Limits worth knowing

- **The terms come from the vault.** The goal, deadline and stage ids are not in any event, so the replay reads them once from the vault. Everything that changes afterwards is rebuilt from events.
- **The replay is only as complete as the stored events.** Before #152, the indexer missed new vaults' opening events. Those 40 rows were backfilled on 2026-10-10, and every vault now has its `VAULT/INIT` and `BOND/POSTED`. The RPC keeps events for about 7 days, so a gap older than that has to be restored from the transactions' meta, which testnet Horizon no longer serves (Stellar Expert's API does).
- **Stored figures and the Record tab lag the chain by up to one pass** (60 seconds). The project page can also read the vault directly ("Read the vault again"), which shows a new total sooner.
- **Testnet now runs protocol 29.** On 2026-10-12, one replay-check run stopped on an XDR type the installed Stellar SDK (15.x) does not know (`SorobanCredentialsType` 2). Two reruns minutes later passed, and the indexer kept running. Whether the SDK needs an upgrade for protocol 29 is being checked separately.
- **Vault code that lacks a read** the check compares would have that field skipped, not counted as a match. No vault on testnet today lacks any of them.

## Still to do

- [ ] Record the video with the [demo script](testnet-demo-script.md), and add its link above.
- [ ] Add the stake's transaction hash and the replay-check output taken after the stake.
- [ ] Update `progress.md` for this week.
