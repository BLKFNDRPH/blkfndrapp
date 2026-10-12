# Testnet demo: script and shot list

A recorded end-to-end demo on Stellar Testnet. A contributor stakes in a project with Freighter in a few taps, the indexer picks the stake up from the on-chain events, and the replay check shows that the events alone rebuild every vault's state.

**Length:** about 4 minutes. **Project:** #22, AniDry – Smart Hybrid Rice Dryer (`CDLU…RXAK`).

**What the video shows:**

| Target | Shot |
|---|---|
| A React web app with Freighter, where a contributor backs a project in a few taps | 2–4: six taps from the project list to a confirmed transaction |
| A lightweight indexer that reconstructs vault state from on-chain events | 5–6: the Record tab and total update from the stored event, and the replay check rebuilds all vaults from events and matches the chain |
| A recorded end-to-end testnet demo | The whole video, with the transaction opened on Stellar Expert |

---

## Dry run, 2026-10-12

I walked the flow on the live site (`testnetv2.blkfndr.com`) up to the point where you sign in. The steps after sign-in come from the stake sheet's code.

- **Project #22** is open for stakes until 31 Dec 2027: $200 staked of $5,500, from 2 stakers, with a $275 deposit locked. It runs the current vault code (`e9009410…`), raises USDC and has 8 stages. Avoid #9: its title shows twice and its deadline is set in the year 9999.
- **Taps**, for someone signed in with a ready wallet:
  1. Project card
  2. **Stake from $5**
  3. **$25** preset
  4. **Review and sign**
  5. **Open Freighter**
  6. **Confirm** in Freighter

  That is 4 taps once you're on the project page.
- **Signed out**, the sheet still opens. It shows the amount presets, the minimum ($5) and the maximum ($5,300, what's left to reach the goal), and one **Sign in** card. After sign-in, the person comes straight back to the stake.
- **Wallet gates** are cards inside the sheet: no wallet, wrong network, no account (Friendbot), no USDC trustline, not enough USDC (Circle's faucet). Do them all **before** recording so the take stays short. Shot 3b covers them if you want to show them.
- **Fixed during the dry run:** at 1280×720 the open sheet made the desktop card taller than the screen, so **Review and sign** only came into view at the bottom of the page ([#165](https://github.com/BLKFNDRPH/blkfndrapp/pull/165)). Until that is deployed, record at **1920×1080**, where the whole card fits.
- **Minor, not fixed:** the project page says "Ends 31 Dec (445 days)" without the year. Say "end of 2027" in the voiceover.

## Before recording

**Wallet (Freighter, a fresh demo account, not your main one)**
- [ ] Freighter set to **Testnet**.
- [ ] Account funded with test XLM (Friendbot, or the sheet's **Activate your Stellar account** card).
- [ ] USDC trustline added for the app's USDC (the sheet's card does it in one signature).
- [ ] At least **30 test USDC** from [faucet.circle.com](https://faucet.circle.com/) (Stellar, Testnet).

**BLKFNDR account**
- [ ] Signed in to `testnetv2.blkfndr.com` with a demo account, not one that shows a personal email.
- [ ] Wallet linked in **Settings → Wallet**. Already linked means no link signature on camera.
- [ ] Open project #22's stake sheet once and check that every gate card is gone. Then close it.

**Screen**
- [ ] Browser at 1920×1080, zoom 100%, bookmarks bar hidden, no other extensions showing.
- [ ] Tab 1: `https://testnetv2.blkfndr.com/projects`
- [ ] Tab 2: `https://stellar.expert/explorer/testnet/contract/CDLUNKTDXPCCOEBKE4UCWVVQ2UUCLD43LSCLAO64NKQV2APS7TDTRXAK`
- [ ] A terminal at the repo root, font large enough to read, with the command ready:

  ```bash
  node --env-file=.env.local scripts/replay-check.mjs
  ```

- [ ] Run the replay check once now. Expect `22 of 22 vaults match the chain` and #22 at `200` raised. If anything differs, stop and look before recording.

---

## Shots

Times are targets. The voiceover is a guide, not a script to read word for word. Use the platform's wording: **vault**, **stake**, **stage**, **payout**, **goal**. Lead with the vault and what you can see on-chain, not with fundraising.

### 1. The vault (0:00–0:20)

**Screen:** the projects list. Scroll slowly past a few cards.
**Say:** "BLKFNDR holds money for real-world projects in a vault on Stellar. Every stake sits in that project's own smart contract, not in a BLKFNDR account. The builder is paid stage by stage, only when stakeholders vote yes. This is Testnet, so no real money moves."

### 2. The project (0:20–0:50)

**Tap 1:** the **AniDry** card.
**Screen:** title, "$200 staked of $5,500", "Counted in USDC", the deposit line, then the **Stages** tab (8 stages with amounts). Open **What happens to my money?** for a second.
**Say:** "AniDry is raising for a solar rice dryer. The builder locked a $275 deposit when the vault opened. The money is released in eight stages, and each one needs a stakeholder vote."

### 3. Stake (0:50–1:40)

**Tap 2:** **Stake from $5**. The sheet opens in the side card.
**Tap 3:** **$25**. Point at the line showing the minimum and what's left to reach the goal.
**Tap 4:** **Review and sign**. Hold on the confirm card: "Leaves your wallet $25.00 · 25 USDC", the network fee in XLM (under a cent), and "Fee to BLKFNDR $0.00".
**Say:** "Four taps on the page. Before anything is signed, the app has already run the transaction as a test, so it shows the exact network fee and confirms it will go through."

**Tap 5:** **Open Freighter**. **Tap 6:** **Confirm** in Freighter.
**Say:** "Freighter shows the same amount. I sign in my own wallet. BLKFNDR never holds my keys."

*(3b, optional, +40 s: on a second, unprepared wallet, show the gate cards being cleared inside the sheet: activate the account, add the USDC trustline. Cut this if the video runs long.)*

### 4. On-chain (1:40–2:10)

**Screen:** the done card: "You're a stakeholder in AniDry…", **Recorded on-chain**, and the transaction hash. Click the hash.
**Screen (Stellar Expert):** the transaction calls `contribute` on the vault, with the 25 USDC transfer and the `DEPOSIT / CONTRIB` event.
**Say:** "The stake is a transaction anyone can check. The vault emitted a contribution event with my address, the amount and the new total."

### 5. The indexer (2:10–2:50)

**Screen:** back on the project page. Within a minute (the indexer runs every 60 seconds), the total shows **$225 staked**. Open the **Record** tab: the newest line is "You staked $25.", linked to the same transaction.
**Say:** "A lightweight indexer reads the vault's events and stores them. The Record tab is the vault's history, written from those events, with each line linked to its transaction."

*If the line hasn't appeared after 60 s, keep the camera on the Record tab and reload once. When the staking account is on the admin roster, the app starts an indexer pass right after the transaction, so the line shows up sooner.*

### 6. Rebuilt from events (2:50–3:40)

**Screen:** the terminal. Run the replay check. The table prints every project, with #22 now at **225** raised and **3** stakers, and ends with `22 of 22 vaults match the chain.`
**Say:** "To prove the events are enough, this check ignores the database's figures. It replays every vault's stored events with the contract's rules: stakes, votes, payouts, refunds, the deposit. Then it compares the result with what each vault reports on-chain, field by field, including every staker's balance. All 22 vaults match, including the stake I just made."

### 7. Close (3:40–4:00)

**Screen:** back on the project page, the **Stages** tab.
**Say:** "From here, when the goal is reached, the builder opens a vote for stage one. Stakeholders approve it in the same few taps, and the vault pays out. If a stage fails, what's left and the builder's deposit go back to the stakeholders."

---

## If something goes wrong on camera

| What happens | What to do |
|---|---|
| A gate card appears in the sheet (network, trustline, funds) | Follow the card, then retake shot 3. Everything before it can stay |
| Freighter is on the wrong network | The sheet names the network. Switch Freighter to Testnet and retake from tap 4 |
| The transaction fails | The sheet says in plain words what happened and whether money moved. Retake. Nothing is lost |
| The total or Record line lags | Wait, or reload. The indexer runs every 60 s |
| The replay check shows #22 as "behind" | The indexer hasn't stored the newest event yet. Rerun in a minute |

## After recording

- [ ] Note the stake's transaction hash for the deliverable document.
- [ ] Rerun the replay check and keep its output (`--json`) with the video.
- [ ] Upload the video and add its link to the deliverable document and `progress.md`.
