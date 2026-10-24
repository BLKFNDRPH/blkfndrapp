import { test } from "node:test";
import assert from "node:assert/strict";
import { withVaultState } from "./live-project.ts";
import type { Project } from "./types.ts";
import type { VaultState } from "./vault-state.ts";

const indexed: Project = {
  id: "11",
  title: "AquaPure 2",
  tagline: "",
  description: "",
  category: "Infrastructure & Energy",
  fundingGoal: 3000,
  currentFunding: 2400,
  imageUrl: "",
  creator: "Freya",
  creatorAvatar: "",
  status: "raising",
  vaultAddress: "CVAULT",
  milestones: [
    { id: 1, amount: 1800, released: false, title: "Phase 1", description: "Procurement" },
    { id: 2, amount: 1200, released: false, title: "Phase 2" },
  ],
};

const ledger: VaultState = {
  creator: "GBUILDER",
  token: "CUSDC",
  status: "funded",
  currentFunding: 3000,
  currentFundingRaw: "30000000000",
  fundingGoal: 3000,
  fundingGoalRaw: "30000000000",
  fundingDeadline: 1_762_300_000_000,
  bondPosted: true,
  bondAmount: 300,
  releasedTotal: 1800,
  milestones: [
    { id: 1, amount: 1800, released: true, failed: false },
    { id: 2, amount: 1200, released: false, failed: false },
  ],
};

test("the ledger's state and money replace the indexed copy", () => {
  const live = withVaultState(indexed, ledger);
  assert.equal(live.status, "funded");
  assert.equal(live.currentFunding, 3000);
  assert.equal(live.currentFundingRaw, "30000000000");
  assert.equal(live.bondAmount, 300);
  assert.equal(live.releasedTotal, 1800);
});

test("stages keep the listing's words and take the vault's amount and payout", () => {
  const live = withVaultState(indexed, ledger);
  assert.deepEqual(live.milestones, [
    { id: 1, amount: 1800, released: true, title: "Phase 1", description: "Procurement" },
    { id: 2, amount: 1200, released: false, title: "Phase 2" },
  ]);
  assert.equal(live.title, "AquaPure 2");
});

test("the vault's word on its deposit carries over", () => {
  assert.equal(withVaultState(indexed, { ...ledger, bondReturned: true }).bondReturned, true);
  assert.equal(withVaultState(indexed, { ...ledger, bondReturned: false }).bondReturned, false);
  // Vault code older than the flag says nothing, and nor does the project.
  assert.equal(withVaultState(indexed, ledger).bondReturned, undefined);
});

test("a vault reporting no stages leaves the listing's stages alone", () => {
  const live = withVaultState(indexed, { ...ledger, milestones: [] });
  assert.equal(live.milestones, indexed.milestones);
});
