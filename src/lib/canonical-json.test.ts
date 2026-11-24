import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalHash, canonicalJson } from "./canonical-json.ts";

test("key order does not change the bytes", () => {
  const a = { b: 1, a: { d: "x", c: [3, 2, 1] } };
  const b = { a: { c: [3, 2, 1], d: "x" }, b: 1 };
  assert.equal(canonicalJson(a), '{"a":{"c":[3,2,1],"d":"x"},"b":1}');
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalHash(a), canonicalHash(b));
});

test("array order is kept: it is part of the value", () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("strings are normalised to NFC", () => {
  // "é" precomposed, and "e" followed by a combining acute accent.
  assert.equal(canonicalJson("é"), canonicalJson("é"));
});

test("the hash is SHA-256 of the canonical bytes", () => {
  // sha256 of the two bytes "{}".
  assert.equal(canonicalHash({}), "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
});

test("values JSON would drop or rewrite are refused", () => {
  assert.throws(() => canonicalJson({ a: undefined }), /\$\.a/);
  assert.throws(() => canonicalJson(1.5), /safe integer/);
  assert.throws(() => canonicalJson(Number.NaN), /safe integer/);
  assert.throws(() => canonicalJson(2 ** 53), /safe integer/);
  assert.throws(() => canonicalJson(10n), /bigint/);
  assert.throws(() => canonicalJson(new Date(0)), /plain objects/);
  assert.throws(() => canonicalJson([() => 1]), /\$\[0\]/);
});

test("negative zero prints as zero", () => {
  assert.equal(canonicalJson(-0), "0");
});
