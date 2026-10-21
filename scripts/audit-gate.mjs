#!/usr/bin/env node
// CI gate on production dependency advisories: fails on any high or critical
// advisory except the ones accepted below. npm audit has no way to ignore one
// advisory, so --audit-level=high would fail on these for as long as no fix
// exists upstream, and a gate that is always red gets switched off.
//
//   npm run audit:gate
//
// Each accepted advisory says why it cannot be reached here. Remove the entry
// once a fix lands; the gate warns when an entry no longer matches anything.

import { spawnSync } from "node:child_process";

const ACCEPTED = {
  // JaegerPropagator DoS on a malformed header. Reaches us through genkit's
  // OpenTelemetry tree (@genkit-ai/core pins @opentelemetry/sdk-node ^0.52; no
  // genkit release, latest or next, moves past it). The propagator only runs
  // when OTEL_PROPAGATORS names jaeger, which nothing sets. The Prometheus
  // exporter advisory that sat beside it (GHSA-q7rr-3cgh-j5r3) is no longer
  // reported, so its entry is gone.
  "GHSA-45rx-2jwx-cxfr": "Jaeger propagator is never configured",
};

const BLOCKING = new Set(["high", "critical"]);

const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 64 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error("npm audit did not return JSON:\n" + (run.stderr || run.stdout));
  process.exit(2);
}
if (report.error) {
  console.error("npm audit failed:", report.error.summary ?? report.error);
  process.exit(2);
}

// One entry per advisory, with the packages it reaches us through.
const advisories = new Map();
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
    const id = via.url.split("/").pop();
    const entry = advisories.get(id) ?? { ...via, id, packages: new Set() };
    entry.packages.add(name);
    advisories.set(id, entry);
  }
}

const blocking = [...advisories.values()].filter((a) => !ACCEPTED[a.id]);
const accepted = [...advisories.values()].filter((a) => ACCEPTED[a.id]);
const stale = Object.keys(ACCEPTED).filter((id) => !advisories.has(id));

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `Production advisories: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ` +
    `${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low (by package)`,
);
for (const a of accepted) {
  console.log(`accepted  ${a.severity.padEnd(8)} ${a.id}  ${ACCEPTED[a.id]}`);
}
for (const id of stale) {
  console.warn(`warning   ${id} is accepted but no longer reported; remove it from ACCEPTED`);
}
for (const a of blocking) {
  console.error(`BLOCKING  ${a.severity.padEnd(8)} ${a.id}  ${a.title}`);
  console.error(`          ${a.name} ${a.range}, via ${[...a.packages].join(", ")}`);
}
process.exit(blocking.length ? 1 : 0);
