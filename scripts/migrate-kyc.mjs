#!/usr/bin/env node
//
// Copy every approved KYC attestation into a new identity registry.
//
// A redeployed identity registry starts empty, and a builder it has not
// approved cannot launch: the vault checks is_kyc_approved at creation. So
// before the app is pointed at a new registry, every builder the platform has
// approved is attested into it, with the same details hash the original
// attestation committed to.
//
// Source of truth: approved rows of public.kyc_requests (stellar_address,
// details_hash), read with the service-role key. With --from, each is also
// checked against the registry being replaced, and a row that registry does
// not approve, or approves with a different hash, is reported and skipped:
// it may have been revoked on-chain, and copying it would re-approve it.
//
// Dry run by default: prints what it would do and writes nothing. --send
// attests each row the plan marks "migrate", then reads every one back.
// The signer is a Stellar CLI identity, so no key passes through this script;
// it must be the target registry's admin or one of its attestors.
//
// Usage:
//   node --env-file=.env.local scripts/migrate-kyc.mjs \
//     --registry <new identity C…> --source <cli identity> [--from <old identity C…>] \
//     [--network testnet] [--send] [--include-unattested] [--input <rows.json>]
//
// --input replaces the database with a JSON array of
// {"stellar_address", "details_hash"} rows, for testing against a throwaway
// registry without copying real builders' records into it.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY unless --input is
// given, and the Stellar CLI on PATH.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(name);

const registry = opt("--registry");
const source = opt("--source");
const from = opt("--from");
const network = opt("--network") ?? "testnet";
const input = opt("--input");
const send = flag("--send");
const includeUnattested = flag("--include-unattested");

if (!registry || !source || flag("--help")) {
  console.error(
    "Usage: node --env-file=.env.local scripts/migrate-kyc.mjs --registry <C…> --source <cli identity>\n" +
      "       [--from <old registry C…>] [--network testnet] [--send] [--include-unattested] [--input <rows.json>]",
  );
  process.exit(flag("--help") ? 0 : 1);
}

// ── Stellar CLI ────────────────────────────────────────────────────────────

/**
 * Run the CLI. `out` is its result (stdout); `log` is everything, since the
 * CLI reports a submitted transaction's link, and any error, on stderr.
 */
function stellar(argv) {
  const r = spawnSync("stellar", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { ok: r.status === 0, out: r.stdout ?? "", log: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const signer = stellar(["keys", "address", source]);
if (!signer.ok) {
  console.error(`No Stellar CLI identity named ${source}.`);
  process.exit(1);
}
const attestor = signer.out.trim();

/** The line that says what went wrong, out of the CLI's output. */
function firstError(log) {
  const lines = log.trim().split("\n");
  return (lines.find((l) => /error|Error\(/.test(l)) ?? lines[0] ?? "").trim();
}

/** A read: simulated, never submitted. Throws on anything but a clean answer. */
function read(contract, fn, fnArgs) {
  const r = stellar(["contract", "invoke", "--id", contract, "--source", source, "--network", network, "--send=no", "--", fn, ...fnArgs]);
  if (!r.ok) throw new Error(`${fn} on ${contract} failed: ${firstError(r.log)}`);
  return r.out.trim().replace(/^"|"$/g, "");
}

/** The hash a registry holds for an address, or null when it does not approve it. */
function attestation(contract, address) {
  if (read(contract, "is_kyc_approved", ["--address", address]) !== "true") return null;
  return read(contract, "get_attestation", ["--address", address]).toLowerCase();
}

// ── Rows ───────────────────────────────────────────────────────────────────

async function approvedRows() {
  if (input) return JSON.parse(readFileSync(input, "utf8"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (run with --env-file=.env.local).");
  }
  const res = await fetch(
    `${url}/rest/v1/kyc_requests?select=stellar_address,details_hash&status=eq.approved&order=created_at.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`Reading kyc_requests failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Plan ───────────────────────────────────────────────────────────────────

const rows = await approvedRows();
console.log(`network   ${network}`);
console.log(`registry  ${registry}${from ? `\nfrom      ${from}` : ""}`);
console.log(`signer    ${source} (${attestor})`);
console.log(`approved  ${rows.length} row${rows.length === 1 ? "" : "s"}${input ? ` from ${input}` : " in kyc_requests"}`);
console.log(send ? "mode      SEND\n" : "mode      dry run (pass --send to write)\n");

const plan = [];
for (const row of rows) {
  const address = String(row.stellar_address ?? "");
  const hash = String(row.details_hash ?? "").toLowerCase();
  const entry = { address, hash, action: "migrate", note: "" };
  plan.push(entry);

  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    Object.assign(entry, { action: "invalid", note: "not a Stellar account address" });
    continue;
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    Object.assign(entry, { action: "invalid", note: "details_hash is not 32 bytes of hex" });
    continue;
  }

  const present = attestation(registry, address);
  if (present !== null) {
    Object.assign(
      entry,
      present === hash
        ? { action: "present", note: "already attested with this hash" }
        : { action: "conflict", note: `target holds a different hash ${present.slice(0, 12)}…` },
    );
    continue;
  }

  if (from) {
    const before = attestation(from, address);
    if (before === null) {
      if (!includeUnattested) {
        Object.assign(entry, { action: "skip", note: "not approved in the old registry (revoked, or archived?)" });
      } else {
        entry.note = "not approved in the old registry; migrating per the database";
      }
    } else if (before !== hash) {
      Object.assign(entry, { action: "skip", note: `old registry holds a different hash ${before.slice(0, 12)}…` });
    } else {
      entry.note = "matches the old registry";
    }
  }
}

const width = Math.max(...plan.map((p) => p.action.length), 6);
for (const p of plan) console.log(`  ${p.action.padEnd(width)}  ${p.address}  ${p.note}`);
const count = (action) => plan.filter((p) => p.action === action).length;
console.log(
  `\n${count("migrate")} to migrate, ${count("present")} already present, ${count("skip")} skipped, ` +
    `${count("conflict")} conflicting, ${count("invalid")} invalid`,
);

if (!send) {
  process.exit(count("conflict") + count("invalid") > 0 ? 1 : 0);
}

// ── Send ───────────────────────────────────────────────────────────────────

let failed = 0;
console.log("");
for (const p of plan.filter((p) => p.action === "migrate")) {
  const r = stellar([
    "contract", "invoke", "--id", registry, "--source", source, "--network", network, "--",
    "attest", "--attestor", attestor, "--address", p.address, "--kyc_hash", p.hash,
  ]);
  const tx = (r.log.match(/tx\/([0-9a-f]{64})/) ?? [])[1];
  if (!r.ok) {
    failed += 1;
    console.log(`  FAIL  ${p.address}  ${firstError(r.log)}`);
    continue;
  }
  const back = attestation(registry, p.address);
  if (back !== p.hash) {
    failed += 1;
    console.log(`  FAIL  ${p.address}  read back ${back ?? "nothing"}`);
    continue;
  }
  console.log(`  ok    ${p.address}  ${tx ?? ""}`);
}

console.log(`\n${count("migrate") - failed} attested, ${failed} failed`);
process.exit(failed + count("conflict") + count("invalid") > 0 ? 1 : 0);
