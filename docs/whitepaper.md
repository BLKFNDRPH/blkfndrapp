# **blkfndr: A Secure, On-Chain Vault for Real-World Projects**

**Motto:** Transparency you can verify, not trust.

## **Abstract**

blkfndr gives every real-world project its own secure vault on Stellar, built so that no one — least of all the platform — has to be trusted with the money or the record. The funds a vault holds, the milestones it tracks and every release it makes are on-chain and governed by the project's own stakeholders, and its entire history is public and permanent.

Each project's vault is a contract deployed for that project alone. The builder's performance bond is locked in the same contract, taken in the transaction that creates the vault, so no project can begin taking stakes before its builder has capital of their own at risk. Money leaves the vault in milestone tranches, and a tranche is released only when the stakeholders — weighted by the stake each holds — vote to release it. A milestone that fails forfeits the bond to those stakeholders automatically. Closing a project writes a permanent record to an append-only registry.

There is no appointed signer, no admin key and no platform role anywhere in the path that moves money. This document describes the mechanism that makes that claim true, the economics around it, and — in [Section 7](#7-what-this-does-not-protect-against) — the things it deliberately does not solve.

**Status: deployed to Stellar testnet.** Mainnet is planned and not yet deployed. Nothing in this document should be read as an offer, a security, or investment advice.

---

## **1. The Problem**

### **1.1 You have to trust whoever holds the money**

The moment you back someone else's project, you are trusting whoever holds the funds — a platform, a team, an escrow account — to release them as promised and to tell you the truth about what happened to them. On a conventional platform the honest answer to *who can move this money* is that a company holds it and its own policy governs its release. On most on-chain funding the answer is worse: a team wallet with a withdrawal key, which is precisely the structure every rugpull has ever needed.

An exit scam is not a sophisticated attack. It is the default outcome of letting the party who benefits from moving the money be the party who is able to move it.

### **1.2 The record belongs to the party with the most reason to edit it**

Even when the money is handled honestly, you usually cannot see the account, cannot audit the decisions, and cannot check the history against anyone else's copy of it. When a project goes wrong, the account of what was promised and what was delivered belongs to whoever has the most reason to revise it. Accountability that rests on one party's private bookkeeping is not accountability.

### **1.3 The access problem underneath**

This trust problem sits on top of a real one. Local developers — particularly across the Philippines and Southeast Asia — meet red tape, high interest rates and localized liquidity bottlenecks the moment they approach a traditional bank, and ordinary people are priced out of the asset class entirely. Connecting the two sides is the easy part, and platforms have done it for years. What none of them removed is the question the backer is really asking: *once I send this money, who can move it, and what happens to me if the project never gets built?*

blkfndr treats that as a design constraint rather than a policy problem.

---

## **2. Design Principles**

1. **Custody belongs to a contract, not to a company.** Funds sit in a per-project vault. blkfndr operates the interface, not the money.
2. **The party who benefits from a release must not be the party who authorizes it.** The builder can request a tranche. Contributors decide it.
3. **Authority follows stake, with a ceiling.** Voting weight is what you contributed — capped, so that concentration cannot become control.
4. **Doing nothing must be safe for contributors.** Every timeout in the protocol resolves toward returning money, never toward releasing it.
5. **The builder must have something to lose.** A bond, locked in the same contract as the raise, forfeited on failure.
6. **History must be unforgeable.** Outcomes are appended on-chain and cannot be edited or deleted before the next raise.
7. **Every claim here must be checkable.** Contract addresses and build hashes are published so a reader can verify the deployment rather than believe this document.

---

## **3. Protocol Architecture**

### **3.1 Technology**

| Layer | Technology |
|---|---|
| Network | Stellar — Soroban smart contracts, written in Rust |
| Frontend | Next.js and React, for a Web2-grade user experience |
| Database | Supabase (Postgres with Row Level Security) |
| Auth | Supabase Auth (email/password, Google); Freighter for wallet linking and signing |
| Storage | Pinata (IPFS) for blueprints and listing media; private Supabase Storage for identity documents |
| AI | Google Genkit with Gemini 2.5 Flash, for listing-quality analysis |

Stellar is purpose-built for global payments and asset issuance, which makes it a natural home for a protocol whose unit of work is a small international contribution.

*Historical note: blkfndr's first implementation targeted Sui (Move). The protocol has since been rebuilt on Stellar/Soroban, and the release model described here replaces the earlier admin-approved and multi-signature designs entirely.*

### **3.2 Contract set**

| Contract | Responsibility |
|---|---|
| `blkfndr-vault` | Per-project vault: stakes, bond, stakeholder-weighted milestone voting, refunds, forfeiture |
| `blkfndr-factory` | Deploys vaults and pins the platform addresses each one trusts |
| `blkfndr-attestation` | Append-only builder completion record. No update or delete entrypoint exists |
| `blkfndr-identity` | KYC attestation registry |
| `blkfndr-admin` | Platform administrator roster. **Not in the path that releases funds** |
| `blkfndr-treasury` | Platform fee treasury and owner-voted governance (fee, bond, ops-funding cut) |
| `blkfndr-operations` | Operations Vault: the governed gas budget for moderation. Holds no project funds |

The vault is not deployed as a single shared contract. Its wasm is uploaded once and the factory instantiates one instance per project from that hash, so every project's funds are isolated from every other project's, and any vault can be checked against a published hash. The treasury and Operations Vault hold only the platform's own money — pooled listing fees and a gas budget — and both move it only on an owner vote (two-thirds by headcount), never on a single key. See [Smart Contracts](smart-contracts.md) for the full API.

### **3.3 Vault lifecycle**

A vault moves through six states:

```
Raising ──► Funded ──► Active ──► Completed
   │                      │
   └──► Failed            └──► Refunding
```

| State | Meaning |
|---|---|
| `Raising` | Accepting contributions, goal not yet met |
| `Funded` | Goal met; the raise is closed |
| `Active` | Milestone tranches are being voted on and released |
| `Failed` | The deadline passed without the goal being met |
| `Refunding` | A milestone failed; remaining funds and the forfeited bond are claimable |
| `Completed` | Closed out, with an attestation written |

---

## **4. Release Authority**

This section is the protocol. Everything else is arrangement around it.

### **4.1 Contribution is voting weight**

A contribution both funds the project and confers the right to decide when its funds move. There is no separate governance token to acquire, no snapshot to be present for, and no fee deducted on the way in — the entire deposit counts, and the entire deposit remains claimable by the contributor in the paths where money comes back.

The minimum contribution is 5 units.

### **4.2 A release needs a majority of the money**

To release a tranche, approving weight must exceed **50% of the total raised** — not a majority of voters, but a majority of the capital actually contributed. In the contract this is `RELEASE_THRESHOLD_BPS = 5_000`, evaluated as a strict inequality, so an exact tie does not release.

### **4.3 No wallet counts for more than 20%**

However much a single wallet contributed, its voting weight is capped at **20% of the raise** (`WEIGHT_CAP_BPS = 2_000`). This is the provision that makes the majority threshold meaningful. Without it, one wallet holding most of a raise would hold unilateral release authority — and the cheapest way to obtain that is for the builder to fund their own project.

Clearing a threshold above 50% in increments of at most 20% requires **at least three distinct wallets**, always.

#### Worked example

Three backers contribute 100 USDC each toward a 300 USDC goal. The cap is 20% of the raise, so each counts for 60 regardless. A release needs more than 150:

| Approvers | Weight | Outcome |
|---|---|---|
| one | 60 | short |
| two | 120 | short |
| three | 180 | releases |

A backer holding two thirds of the raise still counts for 60 and still cannot release alone. Both properties are pinned down by the contract test suite, in `a_majority_contributor_cannot_release_alone` and `release_requires_at_least_three_distinct_wallets`.

### **4.4 Execution is permissionless**

`release_milestone` takes no authorizing caller. Once a vote has carried, anyone at all can execute it — a contributor, the builder, a bot, a stranger. There is nobody to petition and nobody positioned to withhold funds the contributors have already approved. The same is true of `settle_lapsed_milestone`.

This is the difference between *decentralized in principle* and *decentralized in the path that matters*. A vote that only a privileged account can enact is not a vote; it is a recommendation.

### **4.5 Silence returns money**

The builder opens a milestone vote, which runs for a window fixed at project creation (currently 7 days). If that window lapses without a carrying vote, **the milestone fails**. Remaining vault funds and the forfeited bond become claimable pro-rata by contributors.

Contributor apathy is the normal failure mode of on-chain governance, and most designs quietly convert it into approval by way of a quorum that is easy to satisfy or a timeout that defaults to release. Here the default runs the other way. A builder cannot wait out their contributors; waiting is the one behaviour guaranteed to cost them their bond.

### **4.6 The bond**

The performance bond and a flat platform fee are taken **in the same transaction that creates the vault**. There is no ordering of operations in which a project accepts a contribution before its builder is exposed. The minimum bond is 5% of the funding goal.

The bond resolves in one of three ways:

- **Goal missed by the deadline** — every contribution is returned in full and the bond returns to the builder. Failing to raise is not misconduct.
- **Milestone failed** — the bond is forfeited to contributors, claimable pro-rata alongside the remaining funds.
- **Project completed** — the bond returns to the builder.

The bond is what converts a promise into a position. A builder who abandons a funded project does not merely forgo future tranches; they lose capital they have already committed.

### **4.7 Refunds**

`claim_refund` is called by the contributor, for their own balance, in the `Failed` and `Refunding` states. It requires no cooperation from the builder and no action by blkfndr. A refund path that depends on a counterparty choosing to honour it is not a refund path.

### **4.8 The permanent record**

Closing a project appends to the attestation registry: builder, project, outcome, amount raised, bond, milestones approved, and timestamp. The contract exposes no update entrypoint and no delete entrypoint, so a builder's history is cumulative and cannot be laundered between raises. Over time this is the asset an honest builder accrues on the platform — and the one a dishonest builder cannot discard.

---

## **5. Economics**

### **5.1 The fee is flat, and the builder pays it**

blkfndr charges a **flat fee per project**, paid by the builder at vault creation. It is never a percentage of funds raised, and contributor deposits are never touched by it.

This matters beyond pricing. A platform earning a percentage of every raise has an interest in raises completing, which is an interest in releases happening — exactly the incentive that ought not to sit near the release mechanism. A flat creation fee leaves the platform indifferent to whether any individual tranche is released, and that indifference is load-bearing.

It also means a contributor's whole deposit is theirs both to reclaim and to vote with, with no discrepancy between the amount at risk and the weight it carries.

### **5.2 What the platform does not do**

- It does not take custody of contributions.
- It does not take a percentage of a raise.
- It does not hold a key that can release, withhold or redirect funds.
- It does not have an entrypoint to accept donations. The bonded-vault contracts have none; money reaches the platform only as the flat per-project fee.

### **5.3 Future economic modules**

The following are **designed but not implemented**, and are documented here as direction rather than as available features:

- **Debt with interest** — funders as decentralized lenders, receiving principal plus interest as a property is developed and sold.
- **Fractionalized equity** — issuing shares in a completed property so contributors earn from rental income or sale, which requires real-world corporate structuring to be lawful in each jurisdiction.
- **Secondary transfer** — allowing a contributor to exit a position before a project closes.

Each of these changes the legal character of a contribution and none will ship ahead of the corresponding structuring work.

---

## **6. Security Model**

### **6.1 On-chain**

The properties in [Section 4](#4-release-authority) are enforced by contract logic, not by application code or platform policy. The admin roster contract exists for platform administration and is deliberately absent from the release path.

The bonded-vault contract alone stands at **38 passing tests**, with the treasury and Operations Vault adding a further **45** and **26**, covering the threshold arithmetic, the weight cap, the distinct-wallet requirement, lapse handling, forfeiture, refund accounting, and the two-thirds governance model.

### **6.2 Off-chain**

Authorization is enforced by the database, not only by the application:

- Every table carries Row Level Security.
- Identity columns on KYC records are granted to no browser-facing role at all — `select *` on your own row fails with a publishable key. They are reachable only with the service-role key, from `server-only` modules, after an explicit admin check.
- Identity documents are never stored in the database. They live in a private Storage bucket reached through short-lived signed URLs minted server-side.
- Roles are read from `app_metadata`, never `user_metadata`, which a user can edit. On-chain state remains the source of truth for who is an admin.
- Every exported async function in a `"use server"` file is treated as a public HTTP endpoint: it re-authenticates, re-authorizes and validates its arguments, with the argument list treated as hostile.

### **6.3 Verifiability**

A reader should not have to take this document's word for any of it. The vault wasm hash is published, and `scripts/build-contracts.sh` reproduces it from source:

```
blkfndr_vault.wasm  sha256:70e5f3a81a3d66155b46780f0c7bc1bd7574721d5477865f7a2cd471d9746b53
```

Any project's vault can be checked against that hash. Deployed contract addresses are listed in the [README](../README.md) and are viewable on stellar.expert.

---

## **7. What This Does Not Protect Against**

A protocol that claimed to eliminate risk would be lying, and the omissions are more useful to a reader than the guarantees.

- **The oracle problem.** No contract can see a building. The chain enforces *who decides* a milestone was met; it cannot itself verify that concrete was poured. Contributors are the oracle, and their diligence is the protocol's real quality bound.
- **Collusion.** The 20% cap forces a release to involve at least three distinct wallets. It cannot establish that those wallets are three distinct *people*. A builder who recruits or controls enough independent-looking backers to clear the threshold defeats the mechanism — the cap raises the cost and coordination burden of that attack rather than making it impossible.
- **Contributor apathy has a price.** Timeouts resolve safely, toward refunds. But a project where nobody votes fails, which is a poor outcome for an honest builder who did the work.
- **Off-chain and legal risk.** Nothing here guarantees a permit is genuine, a title is clean, or a jurisdiction will recognize a contributor's interest in a physical asset. On-chain funds are protected; a building is not an on-chain object.
- **Smart contract risk.** The contracts are tested and the build is reproducible. They have not been through a third-party audit. Treat testnet as a live rehearsal, not a place to commit funds you need back.
- **Not yet on mainnet.** Everything described here is deployed to Stellar testnet.

---

## **8. Platform Parameters as Deployed**

| Parameter | Value |
|---|---|
| Platform fee | Flat, 10 units, builder-paid at creation |
| Minimum contribution | 5 units |
| Minimum bond | 5% of the funding goal |
| Milestone voting window | 7 days |
| Release threshold | > 50% of total raised (`RELEASE_THRESHOLD_BPS = 5_000`) |
| Per-wallet weight cap | 20% of total raised (`WEIGHT_CAP_BPS = 2_000`) |
| Minimum wallets to release | 3 |

---

## **9. Roadmap**

**Phase 1 — Bonded vault protocol (current).** Contributor-weighted release, bond and forfeiture, refunds, and the attestation registry, deployed to Stellar testnet. Pinata/IPFS for blueprint storage. Supabase with full Row Level Security.

**Phase 2 — Mainnet and assurance.** Third-party audit of the contract set, mainnet deployment, and independent verification tooling so a contributor can check a vault against the published hash from the interface itself.

**Phase 3 — Builder reputation.** Surfacing the attestation registry as a first-class builder profile, so completion history visibly affects a builder's ability to raise again.

**Phase 4 — The property investment module.** Post-build investment, legal and corporate structuring for distributing real-world property shares on-chain, and a secondary market for fractional ownership of completed properties.

---

## **10. Conclusion**

Real estate is the oldest and most reliable asset class in the world, and one of the most exclusive. Opening it up is not primarily a liquidity problem — the money exists, and it is willing. It is a trust problem, and trust problems are not solved by asking people to extend more of it.

blkfndr's answer is to remove the discretion. The builder posts a bond before the vault exists. Contributors, weighted by their stake and capped so no one dominates, decide when each tranche is earned. Anyone can execute a decision once it carries, silence returns money rather than releasing it, and every outcome is written somewhere it cannot be edited.

What is left is a platform that cannot rug you, because it was never given the ability to — and a record you can verify instead of trust.

*A secure vault for real-world projects, on Stellar.*
