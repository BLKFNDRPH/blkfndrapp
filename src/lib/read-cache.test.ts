import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedRead, clearReadCache, recall, remember } from "./read-cache.ts";

/** A read that counts its calls and answers with `value` after a tick. */
function counter<T>(value: T) {
  let calls = 0;
  const read = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return value;
  };
  return { read, calls: () => calls };
}

test("a kept answer is served without reading again", async () => {
  clearReadCache();
  const r = counter({ raised: 3000 });
  assert.deepEqual(await cachedRead("vault:A", 10_000, r.read), { raised: 3000 });
  assert.deepEqual(await cachedRead("vault:A", 10_000, r.read), { raised: 3000 });
  assert.equal(r.calls(), 1);
});

test("callers arriving together share one read", async () => {
  clearReadCache();
  const r = counter("terms");
  const answers = await Promise.all([1, 2, 3, 4, 5].map(() => cachedRead("platform", 60_000, r.read)));
  assert.deepEqual(answers, ["terms", "terms", "terms", "terms", "terms"]);
  assert.equal(r.calls(), 1);
});

test("fresh reads again, and what it read is kept for the next caller", async () => {
  clearReadCache();
  let raised = 1000;
  const read = async () => ({ raised });
  await cachedRead("vault:B", 10_000, read);
  raised = 1600;
  assert.deepEqual(await cachedRead("vault:B", 10_000, read), { raised: 1000 });
  assert.deepEqual(await cachedRead("vault:B", 10_000, read, { fresh: true }), { raised: 1600 });
  assert.deepEqual(await cachedRead("vault:B", 10_000, read), { raised: 1600 });
});

test("a null answer is not kept, so the next caller tries again", async () => {
  clearReadCache();
  const r = counter(null);
  assert.equal(await cachedRead("vault:C", 10_000, r.read), null);
  assert.equal(await cachedRead("vault:C", 10_000, r.read), null);
  assert.equal(r.calls(), 2);
});

test("a failed read is not kept and does not block the next one", async () => {
  clearReadCache();
  let fail = true;
  const read = async () => {
    if (fail) throw new Error("RPC down");
    return "ok";
  };
  await assert.rejects(cachedRead("vault:D", 10_000, read), /RPC down/);
  fail = false;
  assert.equal(await cachedRead("vault:D", 10_000, read), "ok");
});

test("an answer expires after its time", () => {
  clearReadCache();
  remember("vault:E", 42, 10_000, 1_000);
  assert.equal(recall("vault:E", 10_999), 42);
  assert.equal(recall("vault:E", 11_000), undefined);
});

test("the cache stays bounded, dropping the oldest first", () => {
  clearReadCache();
  for (let i = 0; i < 501; i++) remember(`k${i}`, i, 60_000);
  assert.equal(recall("k0"), undefined);
  assert.equal(recall("k1"), 1);
  assert.equal(recall("k500"), 500);
});
