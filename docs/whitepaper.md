# **blkfndr: A Secure, On-Chain Vault for Real-World Projects**

**Motto:** Transparency you can verify, not trust.

## **Abstract**

blkfndr gives every real-world project its own secure vault on Stellar, built so that no one — least of all the platform — has to be trusted with the money or the record. The funds a vault holds, the milestones it tracks and every release it makes are on-chain and governed by the project's own stakeholders, and its entire history is public and permanent.

Each project's vault is a contract deployed for that project alone. The builder's performance bond is locked in the same contract, taken in the transaction that creates the vault, so no project can accept a stake before its builder has capital of their own at risk. Money leaves the vault in milestone tranches, and a tranche is released only when the stakeholders — weighted by the stake each holds — vote to release it. A milestone that fails forfeits the bond to those stakeholders. Closing a project writes a permanent record to an append-only registry.

There is no appointed signer, no admin key and no platform role anywhere in the path that moves money. This document describes the mechanism that makes that claim true, the economics around it, and — in [Section 7](#7-what-this-does-not-protect-against) — the things it deliberately does not solve.

**Status: deployed to Stellar testnet.** Mainnet is planned and not yet deployed. The contract source is ahead of the deployment in places; where it matters, this document says which rule a live vault runs. Nothing in this document should be read as an offer, a security, or investment advice.

---

## **1. The Problem**

### **1.1 You have to trust whoever holds the money**

The moment you take a stake in someone else's project, you are trusting whoever holds the funds — a platform, a team, an escrow account — to release them as promised and to tell you the truth about what happened to them. On a conventional platform the honest answer to *who can move this money* is that a company holds it and its own policy governs its release. On-chain the answer is often worse: a team wallet with a withdrawal key, which is precisely the structure every rugpull has ever needed.

An exit scam is not a sophisticated attack. It is the default outcome of letting the party who benefits from moving the money be the party who is able to move it.

### **1.2 The record belongs to the party with the most reason to edit it**

Even when the money is handled honestly, you usually cannot see the account, cannot audit the decisions, and cannot check the history against anyone else's copy of it. When a project goes wrong, the account of what was promised and what was delivered belongs to whoever has the most reason to revise it. Accountability that rests on one party's private bookkeeping is not accountability.

### **1.3 Real-world projects make it harder**

Real-world projects — construction, property, local infrastructure — spend money in stages against physical progress, over months. Every stage is another moment where someone has to decide whether the money should move, and another entry in a record someone could later rewrite. Local builders, particularly across the Philippines and Southeast Asia, already meet red tape, high interest rates and slow intermediaries when they approach a traditional bank. The question every stakeholder is really asking is the same: *once I send this money, who can move it, and what happens to me if the project never gets built?*

blkfndr treats that as a design constraint rather than a policy problem.

---

## **2. Design Principles**

1. **Custody belongs to a contract, not to a company.** Funds sit in a per-project vault. blkfndr operates the interface, not the money.
2. **The party who benefits from a release must not be the party who authorizes it.** The builder can request a tranche. Stakeholders decide it.
3. **Authority follows stake, with a ceiling.** Voting weight is what you staked — capped, so that concentration cannot become control.
4. **Doing nothing must be safe for stakeholders.** Every timeout in the protocol resolves toward returning money, never toward releasing it.
5. **The builder must have something to lose.** A bond, locked in the same contract as the stakes, forfeited on failure.
6. **History must be unforgeable.** Outcomes are appended on-chain and cannot be edited or deleted before the next project.
7. **Every claim here must be checkable.** Contract addresses and the vault code hash are published so a reader can verify the deployment rather than believe this document.

---

## **3. Protocol Architecture**

### **3.1 Technology**

| Layer | Technology |
|---|---|
| Network | Stellar — Soroban smart contracts, written in Rust |
| Frontend | Next.js and React |
| Database | Supabase (Postgres with Row Level Security) |
| Auth | Supabase Auth (email/password, Google); Freighter for wallet linking and signing |
| Storage | Pinata (IPFS) for blueprints and listing media; private Supabase Storage for identity documents |
| AI | Google Genkit with Gemini 2.5 Flash, for listing-quality review |

Stellar is purpose-built for payments and asset issuance, which makes it a natural home for a protocol whose unit of work is a small stake that may come from anywhere.

*Historical note: blkfndr's first implementation targeted Sui (Move). The protocol has since been rebuilt on Stellar/Soroban, and the release model described here replaces the earlier admin-approved and multi-signature designs entirely.*

### **3.2 Contract set**

| Contract | Responsibility |
|---|---|
| `blkfndr-vault` | Per-project vault: stakes, bond, stake-weighted milestone voting, refunds, forfeiture |
| `blkfndr-factory` | Deploys vaults and pins the platform addresses each one trusts |
| `blkfndr-attestation` | Append-only builder completion record. No update or delete entrypoint exists |
| `blkfndr-identity` | KYC attestation registry. The builder must be approved before a vault can be created |
| `blkfndr-admin` | Platform administrator roster. **Not in the path that releases funds** |
| `blkfndr-treasury` | Platform fee treasury and owner-voted governance (fee, bond, ops-funding cut) |
| `blkfndr-operations` | Operations Vault: the governed gas budget for moderation. Holds no project funds |

The vault is not deployed as a single shared contract. Its wasm is uploaded once and the factory instantiates one instance per project from that hash, so every project's funds are isolated from every other project's, and any vault can be checked against the code it was created from. The treasury and Operations Vault hold only the platform's own money — pooled fees and a gas budget — and both move it only on an owner vote (two-thirds by headcount), never on a single key. See [Smart Contracts](smart-contracts.md) for the full API.

### **3.3 Vault lifecycle**

A vault moves through six states:

```
Raising ──► Funded ──► Active ──► Completed
   │           │          │
   └─► Failed  └──────────┴──► Refunding
```

| State | Meaning |
|---|---|
| `Raising` | Accepting stakes, goal not yet met |
| `Funded` | Goal met; no further stakes are accepted |
| `Active` | At least one tranche released, more to come |
| `Failed` | The deadline passed without the goal being met |
| `Refunding` | A milestone failed, or the builder abandoned the project; remaining funds and the forfeited bond are claimable |
| `Completed` | Every tranche released, the bond returned and an attestation written |

---

## **4. Release Authority**

This section is the protocol. Everything else is arrangement around it.

### **4.1 A stake is voting weight**

A stake both backs the project and confers the right to decide when its funds move. There is no separate governance token to acquire, no snapshot to be present for, and no fee deducted on the way in — the entire deposit counts, up to the per-wallet cap in 4.3, and the entire deposit remains claimable by the stakeholder in the paths where money comes back.

The minimum stake is 5 units of the project's token (USDC or XLM).

### **4.2 A release needs a majority of the capped weight**

To release a tranche, approving weight must exceed **50% of the capped total**: the sum of every stakeholder's voting weight after the cap described in 4.3. In the contract this is `RELEASE_THRESHOLD_BPS = 5_000`, evaluated as a strict inequality, so an exact tie does not release. When no wallet is over the cap, the capped total is simply the total raised.

It is a majority of capped weight, not of voters, and because weight above the cap counts neither for nor against a release, it is not always a majority of the money. With 230 from one stakeholder and 10 from each of seven others on a 300 raise, the capped total is 130, and the seven small stakeholders (70, under a quarter of the money) release over the large stakeholder's objection.

The bar is measured against the capped total rather than the raw raise because weight above the cap is weight nobody can cast. Against the raw raise, a sole stakeholder would count for 20% of the vote and two stakeholders for 40% at most. A project with one or two stakeholders, or one where a single wallet holds most of the raise, could never release anything, even with everyone in favour. Every milestone would lapse and forfeit the bond of a builder who delivered.

### **4.3 No wallet counts for more than 20%**

However much a single wallet staked, its voting weight is capped at **20% of the raise** (`WEIGHT_CAP_BPS = 2_000`). This is the provision that makes the majority threshold meaningful. Without it, one wallet holding most of a raise would outweigh every other stakeholder combined — and the cheapest way to obtain that is for the builder to fund their own project.

The cap alone does not fix how many wallets a release takes: measured against the capped total, the bar drops whenever someone is capped, and one or two wallets could clear it. So the contract also counts approving wallets. A release needs **at least three distinct approving wallets** (`MIN_APPROVING_WALLETS = 3`), or every stakeholder when there are fewer than three. Two properties follow. No release is ever carried over a dissenting stakeholder by fewer than three wallets. And a vote every stakeholder approves always carries, so concentration can never deadlock a vault.

#### Worked example

Three stakeholders put in 100 USDC each toward a 300 USDC goal. The cap is 20% of the raise, so each counts for 60 regardless. The capped total is 180, so a release needs more than 90, from three wallets:

| Approvers | Weight | Outcome |
|---|---|---|
| one | 60 | short |
| two | 120 | short — enough weight, but only two wallets |
| three | 180 | releases |

A stakeholder holding two thirds of the raise still counts for 60 and still cannot release alone. With 200 from one and 50 from each of two others, the capped total is 60 + 50 + 50 = 160 and the bar is more than 80. The large stakeholder and one other reach 110, which clears the weight, but they are two wallets and the release waits for the third. The contract test suite pins both properties, in `a_majority_contributor_cannot_release_alone` and `release_requires_at_least_three_distinct_wallets`.

With fewer than three stakeholders, every one must approve. Had a single stakeholder put in the whole 300, they would count for 60 of a capped total of 60, and their one approval would release the tranche (`a_sole_backer_releases_with_one_vote`). Two stakeholders at 250 and 50 count for 60 and 50; the larger clears the bar of more than 55 alone, but the release waits for both (`two_backers_release_when_both_approve`).

#### Which vaults run this rule

**None on testnet yet.** The rule in 4.2 and 4.3 is in the contract source. It reaches a vault only when the factory is pointed at the new code with `update_wasm_hash`, and as of 2026-10-02 the factory still deploys the earlier vault wasm (`70e5f3a8…`). Vaults are not upgradeable, so every existing vault keeps the old bar: approving capped weight above half of the **raw raise**, with no wallet floor. Under that bar a raise with one or two stakeholders, or one concentrated in a single wallet, cannot release, and its milestones can only lapse.

The switch is waiting on two things. One is an open security decision, described in [Section 7](#7-what-this-does-not-protect-against). The other is two fixes from the rule's review that are written but not yet merged (see 4.5).

### **4.4 Execution is permissionless**

`release_milestone` takes no authorizing caller. Once a vote has carried, anyone at all can execute it — a stakeholder, the builder, a bot, a stranger. There is nobody to petition and nobody positioned to withhold funds the stakeholders have already approved. The same is true of `settle_lapsed_milestone` and `settle_stalled`.

This is the difference between *decentralized in principle* and *decentralized in the path that matters*. A vote that only a privileged account can enact is not a vote; it is a recommendation.

### **4.5 Silence returns money**

The builder opens a milestone vote, which runs for a window fixed at project creation (currently 7 days). If that window closes without a carrying vote, anyone can settle it and **the milestone fails**. Remaining vault funds and the forfeited bond become claimable pro-rata by stakeholders.

Contributor apathy is the normal failure mode of on-chain governance, and most designs quietly convert it into approval by way of a quorum that is easy to satisfy or a timeout that defaults to release. Here the default runs the other way. A builder cannot wait out their stakeholders; waiting is the one behaviour guaranteed to cost them their bond.

A builder who goes silent is covered too. A funded vault moves forward only when the builder opens the next vote. If 90 days pass with no release since funding or since the last release, and no vote is open, anyone can call `settle_stalled`. It fails the next milestone, forfeits the bond and opens refunds. The platform runs a daily job that does this for any vault where it would succeed, so an abandoned project's money is not stranded by a lost key.

**Known defect in deployed vaults.** In the deployed vault code, `settle_stalled` refuses only while a vote window is open, and opening a vote does not reset the 90-day clock. So a milestone stakeholders approved but nobody released before its window closed can still be failed once the clock runs out, forfeiting the bond of a builder whose work was approved. Executing a carried release promptly avoids it. The source is fixed: `settle_stalled` now spares a carried milestone. The fix reaches only vaults created after the factory is switched to the new vault code.

### **4.6 The bond**

The performance bond and the flat platform fee are taken **in the same transaction that creates the vault**. There is no ordering of operations in which a project accepts a stake before its builder is exposed. The minimum bond is 5% of the funding goal.

The bond resolves in one of three ways:

- **Goal missed by the deadline** — every stake is returned in full and the bond returns to the builder. Failing to raise is not misconduct.
- **Milestone failed, or project abandoned** — the bond is forfeited to stakeholders, claimable pro-rata alongside the remaining funds.
- **Project completed** — the bond returns to the builder with the last tranche.

The bond is what converts a promise into a position. A builder who abandons a funded project does not merely forgo future tranches; they lose capital they have already committed.

### **4.7 Refunds**

`claim_refund` is called by the stakeholder, for their own balance, in the `Failed` and `Refunding` states. It requires no cooperation from the builder and no action by blkfndr. A refund path that depends on a counterparty choosing to honour it is not a refund path.

### **4.8 The permanent record**

Closing a project appends to the attestation registry: builder, project, outcome, amount raised, bond, milestones approved, and timestamp. The outcome is one of completed, failed with forfeiture, or failed to fund — and failing to fund carries no fault. The contract exposes no update entrypoint and no delete entrypoint, so a builder's history is cumulative and cannot be laundered between projects. Over time this is the asset an honest builder accrues on the platform — and the one a dishonest builder cannot discard.

---

## **5. Economics**

### **5.1 The fee is flat, and the builder pays it**

blkfndr charges a **flat fee per project**, paid by the builder at vault creation, in the project's own token. It is never a percentage of the stakes, and stakeholder deposits are never touched by it.

This matters beyond pricing. A platform earning a percentage of every project has an interest in releases happening — exactly the incentive that ought not to sit near the release mechanism. A flat creation fee leaves the platform indifferent to whether any individual tranche is released, and that indifference is load-bearing.

It also means no fee stands between a stakeholder's deposit and the weight it carries: the whole deposit is theirs to reclaim and, up to the 20% cap, to vote with.

The fee recorded in the testnet factory today is 300 base units — 0.00003 of the project's token, effectively nothing. It is most likely left over from an earlier percentage model (300 basis points). The amount is a platform setting; the shape is not. There is no percentage setting to change.

### **5.2 Where the fee goes**

Fees pool in the **treasury** contract, which the factory names as every new vault's fee wallet. The treasury's owners hold equal shares by default and decide everything by **two-thirds by headcount** — two of three, three of four:

- **Distributions.** An owner opens a cycle over the unreserved balance of one token, the owners vote, and each shareholder then claims their own share. At most one distribution carries every 30 days.
- **Platform policy.** The flat fee, the minimum bond, the minimum stake, the milestone voting window, the identity registry, the fee wallet and the vault code every future vault runs are all changed by an owner vote. These votes reach the factory only once the treasury is its admin; on testnet that handover has not happened yet, and the factory still answers to the deployer key.
- **Operations funding.** Owners vote once on a monthly percentage of the treasury's unreserved XLM. After that, anyone can trigger the transfer to the Operations Vault once every 30 days, and it never touches money owed to a shareholder.

The **Operations Vault** pays the gas for moderation: the managed wallets that sign KYC attestations hold a little XLM and nothing else. It holds no project funds. Its owners release gas by the same two-thirds vote, and anyone can execute a carried vote. Neither contract has a key that can move money on its own signature. On testnet the monthly cut is not yet configured for the current Operations Vault.

### **5.3 What the platform does not do**

- It does not take custody of stakes.
- It does not take a percentage of a project's money.
- It does not hold a key that can release, withhold or redirect a vault's funds.
- It has no entrypoint to accept donations. Money reaches the platform only as the flat per-project fee.

### **5.4 Future economic modules**

The following are **ideas, not features**. None is implemented, and each changes the legal character of a stake:

- **Debt with interest** — stakeholders as lenders, repaid with interest as a property is developed and sold.
- **Fractionalized equity** — shares in a completed property, so stakeholders earn from rental income or sale. This needs real-world corporate structuring in each jurisdiction.
- **Secondary transfer** — letting a stakeholder exit a position before a project closes.

None will ship ahead of the corresponding legal structuring.

---

## **6. Security Model**

### **6.1 On-chain**

The properties in [Section 4](#4-release-authority) are enforced by contract logic, not by application code or platform policy. The admin roster contract exists for platform administration and is deliberately absent from the release path.

The full contract suite passes 175 tests on `main`: the vault 52, the treasury 45, the Operations Vault 25, the factory 15, the identity registry 15, the attestation registry 14 and the admin roster 9. They cover the threshold arithmetic, the weight cap, the capped total, the distinct-wallet requirement, lapse and stall handling, forfeiture, refund accounting, and the two-thirds governance model.

### **6.2 Off-chain**

Authorization is enforced by the database, not only by the application:

- Every table carries Row Level Security.
- Identity columns on KYC records are readable by no browser-facing role: `select *` on your own row fails with a publishable key. Reviewers read them only through `server-only` code using the service-role key, after a reviewer-role check.
- Identity documents are never stored in the database. They live in a private Storage bucket, reached through signed URLs that expire after five minutes.
- Admin roles come from the `platform_admins` roster in Postgres, asked fresh on every request through `my_role()`. They are never read from `user_metadata`, which a user can edit.
- Every exported async function in a `"use server"` file is treated as a public HTTP endpoint: it re-authenticates, re-authorizes and validates its arguments, with the argument list treated as hostile.

### **6.3 Verifiability**

A reader should not have to take this document's word for any of it. The factory records the hash of the vault code it deploys, and the homepage reads it live from the factory. As of 2026-10-02:

```
blkfndr_vault.wasm  sha256:70e5f3a81a3d66155b46780f0c7bc1bd7574721d5477865f7a2cd471d9746b53
```

Any vault's code can be fetched from the network and compared with that hash. `scripts/build-contracts.sh` rebuilds the contracts from source, with one caveat: the wasm embeds absolute build paths, so a rebuild matches byte-for-byte only on the same paths. A pinned build environment would remove that caveat. Deployed contract addresses are listed in the [README](../README.md) and are viewable on stellar.expert.

---

## **7. What This Does Not Protect Against**

A protocol that claimed to eliminate risk would be lying, and the omissions are more useful to a reader than the guarantees.

- **The oracle problem.** No contract can see a building. The chain enforces *who decides* a milestone was met; it cannot itself verify that concrete was poured. Stakeholders are the oracle, and their diligence is the protocol's real quality bound. A builder can attach proof to each milestone in the app, but the vote is what counts.
- **Collusion and Sybil wallets.** The three-wallet floor forces any release carried over a dissenting stakeholder to involve at least three distinct wallets. It cannot establish that those wallets are three distinct *people*: stakes are not identity-gated. Measuring the bar against the capped total has a cost of its own. A large stakeholder's weight above the cap counts neither for nor against a release, so a coordinated group can carry a release with less than half the money. On a 1,000 raise, three wallets of 140 (42%) outvote two honest stakeholders of 290, because each of those counts for only 200.
- **The open decision.** The sharpest form of that attack is the reason the new rule is not yet live. On a 1,000 raise, one honest stakeholder puts in 790, capped at 200. A builder who puts 70 into each of three fresh wallets holds 210 of a capped total of 410, clears the bar, and releases every tranche while the 790 stakeholder can only object. The proposed fix is a dual majority: the approvers' *uncapped* stake must also exceed half the raise. Unanimity would still always carry and the worked examples above would keep their outcomes, but any wallet holding more than half the raise would gain a veto. That is a product decision, and it is waiting on the owner.
- **Self-funding.** Because a vote every stakeholder approves always carries, a builder who funds their own project from a single wallet can release it to themselves. That moves only their own money, but it does earn a `Completed` record, so a record backed by one or two stakeholders says little about a builder.
- **Stakeholder apathy has a price.** Timeouts resolve safely, toward refunds. But a project where nobody votes fails, which is a poor outcome for an honest builder who did the work.
- **Off-chain and legal risk.** Nothing here guarantees a permit is genuine, a title is clean, or a jurisdiction will recognize a stakeholder's interest in a physical asset. On-chain funds are protected; a building is not an on-chain object.
- **Smart contract risk.** The contracts are tested, and one known defect is described in 4.5. They have not been through a third-party audit. Treat testnet as a live rehearsal, not a place to commit funds you need back.
- **Not yet on mainnet.** Everything described here is deployed to Stellar testnet, and the release rule in 4.2–4.3 is not yet live there.

---

## **8. Platform Parameters**

Read from the testnet factory on 2026-10-02, except where a row names a contract constant.

| Parameter | Value |
|---|---|
| Platform fee | Flat, builder-paid at creation, in the project's token. Currently 300 base units (0.00003) |
| Minimum stake | 5 units of the project's token |
| Minimum bond | 5% of the funding goal |
| Milestone voting window | 7 days |
| Milestones per project | 1 to 20, summing exactly to the goal (`MAX_MILESTONES`) |
| Per-wallet weight cap | 20% of total raised (`WEIGHT_CAP_BPS = 2_000`) |
| Release threshold, new rule | > 50% of the capped total (`RELEASE_THRESHOLD_BPS = 5_000`), from at least 3 wallets or every stakeholder when there are fewer (`MIN_APPROVING_WALLETS = 3`). Not yet live |
| Release threshold, live vaults | > 50% of the raw raise, counted in capped weight |
| Builder stall window | 90 days without a release (`BUILDER_STALL_WINDOW`) |
| Treasury and Operations Vault votes | Two-thirds of owners by headcount, 7-day window |

---

## **9. Roadmap**

**Phase 1 — Vault protocol on testnet (current).** Stake-weighted release, bond and forfeiture, refunds, the abandonment timeout and the attestation registry, deployed to Stellar testnet. The fee treasury and Operations Vault, governed by owner vote. Pinata/IPFS for blueprints, Supabase with Row Level Security, and keep-alive jobs that stop shared contract storage from expiring. Still open in this phase: the decision in Section 7, merging the two review fixes and switching the factory to the new vault code, and redeploying the factory and registries with their audit fixes.

**Phase 2 — Mainnet and assurance.** Third-party audit of the contract set, a pinned build so anyone can reproduce the vault hash, and mainnet deployment. The homepage already shows the vault hash the factory deploys; the next step is checking an individual project's vault against it from the interface.

**Phase 3 — Builder reputation.** Surfacing the attestation registry as a first-class builder profile, so completion history visibly affects a builder's next project.

**Phase 4 — Property modules.** Legal and corporate structuring for the ideas in 5.4. Nothing here is built.

---

## **10. Conclusion**

The hard part of a real-world project is not finding people willing to back it. It is giving them a reason to believe the money will move only when it should, and that the record of what happened will still be true later. Trust problems are not solved by asking people to extend more trust.

blkfndr's answer is to remove the discretion. The builder posts a bond before the vault exists. Stakeholders, weighted by their stake and capped so no one dominates, decide when each tranche is earned. Anyone can execute a decision once it carries, silence returns money rather than releasing it, and every outcome is written somewhere it cannot be edited.

What is left is a platform that cannot rug you, because it was never given the ability to — and a record you can verify instead of trust.

*A secure vault for real-world projects, on Stellar.*
