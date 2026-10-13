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

test("within its stale window an old answer is served at once, and refreshed behind it", async () => {
  clearReadCache();
  let version = 1;
  let calls = 0;
  const read = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { version };
  };
  await cachedRead("list", 30, read, { staleMs: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 40)); // past its time
  version = 2;
  const started = Date.now();
  assert.deepEqual(await cachedRead("list", 30, read, { staleMs: 10_000 }), { version: 1 });
  assert.ok(Date.now() - started < 15, "the stale answer did not wait for the read");
  await new Promise((resolve) => setTimeout(resolve, 40)); // the background read lands
  assert.deepEqual(await cachedRead("list", 30, read, { staleMs: 10_000 }), { version: 2 });
  assert.equal(calls, 2);
});

test("past its stale window the caller waits for the fresh read", async () => {
  clearReadCache();
  let version = 1;
  const read = async () => ({ version });
  await cachedRead("list", 10, read, { staleMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  version = 2;
  assert.deepEqual(await cachedRead("list", 10, read, { staleMs: 10 }), { version: 2 });
});

test("a failed background refresh keeps the stale answer and does not throw", async () => {
  clearReadCache();
  let fail = false;
  const read = async () => {
    if (fail) throw new Error("database unreachable");
    return "first";
  };
  await cachedRead("list", 10, read, { staleMs: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  fail = true;
  assert.equal(await cachedRead("list", 10, read, { staleMs: 10_000 }), "first");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await cachedRead("list", 10, read, { staleMs: 10_000 }), "first");
});

test("fresh skips a stale answer and waits for the read", async () => {
  clearReadCache();
  let version = 1;
  const read = async () => ({ version });
  await cachedRead("list", 10, read, { staleMs: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  version = 2;
  assert.deepEqual(await cachedRead("list", 10, read, { staleMs: 10_000, fresh: true }), { version: 2 });
});
