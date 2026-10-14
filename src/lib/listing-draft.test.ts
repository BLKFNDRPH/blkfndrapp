import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearAllDrafts, clearDraft, loadDraft, saveDraft, type ListingDraft } from "./listing-draft.ts";

/** A localStorage in memory, as the browser's behaves for these calls. */
class MemoryStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
  keys() {
    return [...this.items.keys()].sort();
  }
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: store };
});

const draft = (title: string, savedAt: number): ListingDraft => ({
  v: 1,
  savedAt,
  values: { title, tagline: "", description: "", category: "", location: "", currencyType: "USDC", fundingDeadline: null },
  deadlineInput: "",
  stages: [],
  deposit: { kind: "min" },
});

test("each account has its own draft (BF-113)", () => {
  saveDraft(draft("Kira's water project", 1), "kira");
  assert.equal(loadDraft("adam"), null);
  assert.equal(loadDraft("kira")?.values.title, "Kira's water project");
});

test("a draft typed while signed out goes to whoever signs in next, once", () => {
  saveDraft(draft("Typed before signing in", 5), null);
  assert.equal(loadDraft("kira")?.values.title, "Typed before signing in");
  assert.deepEqual(store.keys(), ["blkfndr:listing-draft:kira"]);
  assert.equal(loadDraft("adam"), null);
});

test("an account's own newer draft wins over an older signed-out one", () => {
  saveDraft(draft("Older, signed out", 1), null);
  saveDraft(draft("Newer, mine", 2), "kira");
  assert.equal(loadDraft("kira")?.values.title, "Newer, mine");
});

test("a newer signed-out draft replaces an older one of the account's", () => {
  saveDraft(draft("Older, mine", 1), "kira");
  saveDraft(draft("Newer, signed out", 2), null);
  assert.equal(loadDraft("kira")?.values.title, "Newer, signed out");
});

test("signing out clears every listing draft in the browser and nothing else", () => {
  saveDraft(draft("a", 1), "kira");
  saveDraft(draft("b", 1), "adam");
  saveDraft(draft("c", 1), null);
  store.setItem("theme", "dark");
  store.setItem("blkfndr:launch-in-flight", "{}");
  clearAllDrafts();
  assert.deepEqual(store.keys(), ["blkfndr:launch-in-flight", "theme"]);
});

test("clearing one account's draft leaves the others", () => {
  saveDraft(draft("a", 1), "kira");
  saveDraft(draft("b", 1), "adam");
  clearDraft("kira");
  assert.deepEqual(store.keys(), ["blkfndr:listing-draft:adam"]);
});
