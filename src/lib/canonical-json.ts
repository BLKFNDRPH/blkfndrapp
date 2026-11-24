/**
 * One byte-for-byte form of a JSON value, so that hashing it gives the same
 * answer on every machine, every run.
 *
 * JSON.stringify is not that: it writes object keys in insertion order, and it
 * will happily write a float whose last digit depends on how it was computed.
 * A risk report's hash goes on the ledger, where a hash that cannot be
 * reproduced from the report proves nothing, so the rules here are strict:
 *
 *   - object keys in code-unit order, no whitespace;
 *   - strings normalised to NFC;
 *   - numbers must be safe integers. Amounts travel as decimal strings, as
 *     they do everywhere else in the app;
 *   - no undefined, NaN, Infinity, bigint, Date or other class instance. A
 *     value that JSON would drop or rewrite silently is refused instead.
 *
 * Self-contained so node --test can load it.
 */

import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return write(value, "$");
}

/** SHA-256 of the canonical form's UTF-8 bytes, as 64 lowercase hex characters. */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function write(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value.normalize("NFC"));
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${path}: ${value} is not a safe integer; send amounts as decimal strings`);
      }
      // -0 would print as "0" here and "-0" elsewhere.
      return String(value === 0 ? 0 : value);
    case "object":
      break;
    default:
      throw new TypeError(`${path}: a ${typeof value} has no canonical form`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, i) => write(item, `${path}[${i}]`)).join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${path}: only plain objects have a canonical form`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys
    .map((key) => `${JSON.stringify(key.normalize("NFC"))}:${write(record[key], `${path}.${key}`)}`)
    .join(",")}}`;
}
