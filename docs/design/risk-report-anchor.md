# Risk report and report-anchor registry

_Drafted 2026-11-24 (Sprint 2, Day 1 item 4). Covers plan items 1.2 and 1.3. D1 and D5 decided 2026-11-25; the input list is still assumed._

A risk report is written off-chain for one vault. Its SHA-256 is anchored on Stellar, so anyone holding the report can prove it is the one that was published and when. This document fixes the two things the rest of week 1 builds on: the report's schema, and the anchor contract's interface.

## Decisions

| | Question | Answer | Decided |
|---|---|---|---|
| D1 | Which key signs anchors | **A dedicated attestor key**, not the ops key | 2026-11-25, project owner |
| D5 | Is the band on-chain, or only the hash | **The report hash only** | 2026-11-25, project owner |
| — | The SOW's "three inputs" | _Still assumed:_ listing, builder record, vault terms | Open |

**D1: a dedicated attestor key.** The ops key is about to sponsor fees (item 1.6), which puts it behind a public endpoint. A key that can be drained of XLM should not also be the key whose signature says "this is the platform's risk report". A roster of attestors also lets the key be rotated without redeploying.

**D5: hash only.** The band is inside the report, and the report is what the hash commits to, so the band is already verifiable. Writing it on-chain as well makes a model's judgement about a named builder permanent and readable out of context, and adds a second place the band could disagree with the report. The week 2 expected output asks only that hashes be verifiable on Stellar Expert.

**The three inputs** are not named anywhere in the repository; the plan was built from a partial copy of the SOW. Check them against SOW page 8 before 1.2 is built.

## The risk report

Implemented in [`src/lib/risk/report.ts`](../../src/lib/risk/report.ts), with the serialisation in [`src/lib/canonical-json.ts`](../../src/lib/canonical-json.ts).

```jsonc
{
  "schema": "blkfndr.risk-report/1",
  "subject": {
    "network": "testnet",
    "vault": "C…",          // the vault the report is about
    "projectId": "12",      // the factory's project id, a decimal string
    "builder": "G…"
  },
  "inputs": {               // SHA-256 of each input, as the pipeline read it
    "listing": "…64 hex…",
    "builderRecord": "…64 hex…",
    "vaultTerms": "…64 hex…"
  },
  "score": 40,              // 0–100, higher is riskier
  "band": "medium",         // derived from score: low < 34 ≤ medium < 67 ≤ high
  "factors": [
    { "code": "first-vault", "input": "builder-record", "effect": "raises",
      "detail": "This builder has not closed a vault before." }
  ],
  "engine": { "model": "gemma4:12b", "rules": 1 },
  "generatedAt": 1795000000 // epoch seconds
}
```

Rules that make the hash repeatable:

- **Canonical bytes.** Object keys sorted, no whitespace, strings in NFC, integers only. A float, `undefined`, or an unknown key is an error, not something dropped quietly.
- **Factors sorted** by input, then code, then detail, so the order the model listed them in does not matter.
- **The band is derived from the score**, never taken from the model. A report whose band disagrees with its score does not validate.
- **Inputs are named by hash, not embedded.** A re-run after a listing change (item 2.1) produces a report with a different `inputs.listing`, which is how a reader tells a re-run from a duplicate.
- **`generatedAt` is in the report**, so two runs are two reports with two hashes. Repeatable means the same report always hashes the same, not that the model answers the same twice.

The band thresholds (34 and 67) are placeholders until the pipeline has run on the 28 existing listings.

The builder-record input is the output of [`src/lib/builder-record.ts`](../../src/lib/builder-record.ts) (item 1.1), hashed with the same `canonicalHash`. The listing and vault-terms inputs still need their own fixed shapes; that is the first job in 1.2.

### Where the report is stored

Not decided here. The anchor proves a report; it does not serve one. The report has to be retrievable by hash for "verifiable" to mean anything, so 1.2 needs a `risk_reports` table (vault, sequence, hash, report JSON, anchor transaction) and a public read by hash.

## The report-anchor registry

Implemented in [`contracts/blkfndr-report-anchor`](../../contracts/blkfndr-report-anchor/src/lib.rs), in the style of `blkfndr-attestation`: constructor-initialised, no entrypoint that edits or deletes a record. 16 tests; not yet deployed.

```rust
#[contracttype]
pub struct Anchor {
    pub vault:          Address,
    /// Position in this vault's history, from 0.
    pub seq:            u32,
    /// SHA-256 of the report's canonical bytes.
    pub report_hash:    BytesN<32>,
    /// The report schema's number (1 for blkfndr.risk-report/1).
    pub schema_version: u32,
    pub attestor:       Address,
    /// Ledger close time.
    pub anchored_at:    u64,
}

// Admin
fn __constructor(env: Env, admin: Address);
fn add_attestor(env: Env, attestor: Address);       // admin
fn remove_attestor(env: Env, attestor: Address);    // admin
fn transfer_admin(env: Env, new_admin: Address);    // admin

// Write: attestor-gated, append-only
fn anchor(
    env: Env,
    attestor: Address,          // require_auth, must be on the roster
    vault: Address,
    report_hash: BytesN<32>,
    schema_version: u32,
) -> u32;                       // the new anchor's seq

// Reads
fn get_latest(env: Env, vault: Address) -> Option<Anchor>;
fn get_anchor(env: Env, vault: Address, seq: u32) -> Anchor;
fn get_count(env: Env, vault: Address) -> u32;
fn get_history(env: Env, vault: Address, offset: u32, limit: u32) -> Vec<Anchor>; // limit clamped to 100
fn find(env: Env, report_hash: BytesN<32>) -> Option<Anchor>;   // verify a report you hold
fn get_attestors(env: Env) -> Vec<Address>;
fn is_attestor(env: Env, address: Address) -> bool;
fn get_admin(env: Env) -> Address;
```

**Event**, one per anchor, which the indexer reads in item 3.6:

```
topics: ("ANCHOR", "RECORDED", vault)
data:   (seq, report_hash, schema_version, attestor, anchored_at)
```

**Errors:** `NotInitialized` (1), `NotAnAttestor` (2), `AttestorAlreadyListed` (3), `AttestorNotListed` (4), `TooManyAttestors` (5, the roster holds 16), `HashAlreadyAnchored` (6), `AnchorNotFound` (7), `UnknownSchemaVersion` (8, for zero).

**Roster events:** `("ANCHOR", "INIT")`, `("ANCHOR", "ATT_ADD")`, `("ANCHOR", "ATT_DEL")`, `("ANCHOR", "ADMIN_TX")`, each with the address as data.

**Behaviour:**

- **Append-only.** A re-run adds `seq + 1`; nothing is replaced. `get_latest` is what the project page shows, `get_history` is the trail.
- **A hash is anchored once.** `anchor` refuses a hash that already has an anchor, so `find` has one answer and a replayed transaction cannot pad a vault's history.
- **Removing an attestor stops future writes only.** Reads never consult the roster, as with `disable_factory` on the attestation registry.
- **The vault is not checked against the factory.** The attestor is already trusted to say which vault a report is about, and binding this registry to one factory would orphan it at the next factory upgrade. The app only anchors for vaults it has indexed.
- **Storage.** Anchors in persistent storage keyed `(vault, seq)`, a `(hash) -> (vault, seq)` index, and a per-vault count. The TTL keeper (`src/lib/ttl-keeper.ts`) has to learn these keys, or old anchors will be archived.
- **Admin** starts as the deployer and moves to the treasury with the factory's in week 3 (item 3.3).

## Before 1.3 can deploy

Read on 2026-11-24: testnet reports **protocol 30** (stellar-rpc 30.0.1). The workspace is on `soroban-sdk` 22.0.0 and the app on `@stellar/stellar-sdk` 16.3.1; 17.4.0 is the newest on npm. The existing contracts still answer reads through the installed CLI (27.0.0). Whether a new contract built with `soroban-sdk` 22 deploys cleanly on protocol 30, and whether the JS SDK decodes protocol 30 ledgers, has not been tested and should be the first thing 1.3 does, on the reference deployment.
