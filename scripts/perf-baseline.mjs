#!/usr/bin/env node
// Lighthouse performance baseline: each page, desktop and throttled mobile,
// several runs, median of each metric. QA asked for this (PERF-04) so that
// "faster" is a number rather than one DevTools session.
//
//   npm run perf:baseline                                   # live site, 5 runs
//   npm run perf:baseline -- --url http://localhost:3000 --runs 3
//   npm run perf:baseline -- --pages /,/projects/11 --form mobile
//
// Options:
//   --url    base URL                    (default https://testnetv2.blkfndr.com)
//   --pages  comma-separated paths       (default /,/projects,/projects/11,/projects/11?tab=stages)
//   --runs   runs per page and form      (default 5)
//   --form   desktop | mobile | both     (default both)
//   --out    output directory            (default perf-reports/<timestamp>)
//   --from   summarise the raw reports already in this directory, without
//            running Lighthouse again (same --pages, --runs, --form)
//
// Mobile is Lighthouse's default: a mid-range phone on simulated slow 4G with
// a 4x CPU slowdown. Desktop is its desktop preset. Lab runs have no INP (it
// needs real interaction); Total Blocking Time is the lab stand-in.
//
// Lighthouse is run through npx at a pinned version rather than installed:
// the image's `npm ci` installs dev dependencies too, and nothing in the app
// needs it. It drives the Chrome installed on this machine (or CHROME_PATH).
// Run it from a quiet machine and connection: other load skews the numbers.
//
// From Git Bash, set MSYS_NO_PATHCONV=1 before passing --pages: otherwise
// the shell rewrites "/" into a Windows path before the script sees it.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const LIGHTHOUSE = "lighthouse@13.5.0";

const METRICS = [
  { id: "score", label: "Performance score", unit: "" },
  { id: "first-contentful-paint", label: "First Contentful Paint", unit: "ms" },
  { id: "largest-contentful-paint", label: "Largest Contentful Paint", unit: "ms" },
  { id: "total-blocking-time", label: "Total Blocking Time", unit: "ms" },
  { id: "cumulative-layout-shift", label: "Cumulative Layout Shift", unit: "" },
  { id: "speed-index", label: "Speed Index", unit: "ms" },
  { id: "server-response-time", label: "Server response (TTFB)", unit: "ms" },
  { id: "requests", label: "Requests", unit: "" },
  { id: "rpcRequests", label: "Soroban RPC requests", unit: "" },
  { id: "bytes", label: "Bytes transferred", unit: "KB" },
  { id: "imageBytes", label: "of which pictures", unit: "KB" },
];

function parseArgs(argv) {
  const args = {
    url: "https://testnetv2.blkfndr.com",
    pages: "/,/projects,/projects/11,/projects/11?tab=stages",
    runs: "5",
    form: "both",
    out: "",
    from: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in args)) throw new Error(`Unknown option --${key}`);
    args[key] = argv[++i] ?? "";
  }
  const runs = Number(args.runs);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a whole number");
  const forms = args.form === "both" ? ["desktop", "mobile"] : [args.form];
  for (const form of forms) {
    if (form !== "desktop" && form !== "mobile") throw new Error("--form is desktop, mobile or both");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    base: args.url.replace(/\/$/, ""),
    pages: args.pages.split(",").map((p) => p.trim()).filter(Boolean),
    runs,
    forms,
    from: args.from,
    out: args.out || args.from || join("perf-reports", stamp),
  };
}

/** One Lighthouse run; the parsed report, or null when it produced none. */
function runLighthouse(url, form, outFile) {
  // A command string, quoted here, because npx on Windows is a .cmd and needs
  // a shell, which would otherwise split the URL at "&" or "?".
  const parts = [
    "npx", "--yes", LIGHTHOUSE, `"${url}"`,
    "--output=json", `--output-path="${outFile}"`,
    "--only-categories=performance",
    "--chrome-flags=--headless=new",
    "--quiet",
    ...(form === "desktop" ? ["--preset=desktop"] : []),
  ];
  const result = spawnSync(parts.join(" "), { shell: true, stdio: ["ignore", "ignore", "pipe"] });
  // Chrome's temp profile sometimes cannot be removed on Windows (EPERM) after
  // the report is written, which fails the exit code of a good run. The
  // report itself is the test of success.
  if (existsSync(outFile)) {
    try {
      return JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      /* fall through */
    }
  }
  const err = result.stderr?.toString().trim().split("\n").slice(-3).join(" | ");
  console.error(`    run failed: ${err || `exit ${result.status}`}`);
  return null;
}

/** A report written by an earlier run, or null when that run left none. */
function readReport(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The figures this baseline tracks, from one report. */
function extract(report) {
  const audits = report.audits;
  const items = audits["network-requests"]?.details?.items ?? [];
  const rpc = items.filter((item) => {
    try {
      return /soroban|sorobanrpc/i.test(new URL(item.url).hostname);
    } catch {
      return false;
    }
  });
  return {
    score: Math.round((report.categories.performance.score ?? 0) * 100),
    "first-contentful-paint": audits["first-contentful-paint"]?.numericValue,
    "largest-contentful-paint": audits["largest-contentful-paint"]?.numericValue,
    "total-blocking-time": audits["total-blocking-time"]?.numericValue,
    "cumulative-layout-shift": audits["cumulative-layout-shift"]?.numericValue,
    "speed-index": audits["speed-index"]?.numericValue,
    "server-response-time": audits["server-response-time"]?.numericValue,
    requests: items.length,
    rpcRequests: rpc.length,
    // Summed from the requests rather than read from total-byte-weight,
    // which left out large cross-origin pictures in some runs (3.5 MB
    // downloads in a report totalling 1.3 MB).
    bytes: sum(items) / 1024,
    imageBytes: sum(items.filter((item) => item.resourceType === "Image")) / 1024,
    runtimeError: report.runtimeError?.code ?? null,
  };
}

/** Bytes over the wire for these requests. */
function sum(items) {
  return items.reduce((total, item) => total + (item.transferSize ?? 0), 0);
}

function median(values) {
  const sorted = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function format(value, unit) {
  if (value === null || value === undefined) return "–";
  if (unit === "ms") return `${Math.round(value).toLocaleString("en-US")} ms`;
  if (unit === "KB") return `${Math.round(value).toLocaleString("en-US")} KB`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rawDir = join(opts.from || opts.out, "raw");
  mkdirSync(rawDir, { recursive: true });

  console.log(
    opts.from
      ? `Summarising the reports in ${rawDir}`
      : `Lighthouse ${LIGHTHOUSE.split("@")[1]} against ${opts.base}`,
  );
  console.log(`${opts.pages.length} pages × ${opts.forms.join(" + ")} × ${opts.runs} runs → ${opts.out}`);

  const results = [];
  for (const form of opts.forms) {
    for (const page of opts.pages) {
      const url = opts.base + page;
      const runs = [];
      console.log(`\n${form} ${page}`);
      for (let i = 1; i <= opts.runs; i++) {
        const slug = page.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
        const file = join(rawDir, `${form}-${slug}-${i}.json`);
        const report = opts.from ? readReport(file) : runLighthouse(url, form, file);
        if (!report) continue;
        const figures = extract(report);
        // A run Lighthouse could not complete (an interstitial, no page)
        // reports zeros, which would drag every median down.
        if (figures.runtimeError) {
          console.error(`  run ${i}: not counted, Lighthouse reported ${figures.runtimeError}`);
          continue;
        }
        runs.push(figures);
        console.log(
          `  run ${i}: score ${figures.score}, LCP ${format(figures["largest-contentful-paint"], "ms")}, ` +
            `TBT ${format(figures["total-blocking-time"], "ms")}, RPC ${figures.rpcRequests}`,
        );
      }
      const medians = Object.fromEntries(METRICS.map((m) => [m.id, median(runs.map((r) => r[m.id]))]));
      results.push({ form, page, url, runs: runs.length, medians, all: runs });
    }
  }

  const summary = {
    lighthouse: LIGHTHOUSE,
    base: opts.base,
    date: new Date().toISOString(),
    runsPerPage: opts.runs,
    results,
  };
  writeFileSync(join(opts.out, "summary.json"), JSON.stringify(summary, null, 2));

  const lines = [
    `# Lighthouse baseline: ${opts.base}`,
    "",
    `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${LIGHTHOUSE} · median of ${opts.runs} runs per row.`,
    "Mobile: simulated slow 4G, 4x CPU slowdown. Desktop: Lighthouse desktop preset.",
    "",
  ];
  for (const form of opts.forms) {
    const rows = results.filter((r) => r.form === form);
    lines.push(`## ${form === "desktop" ? "Desktop" : "Mobile (throttled)"}`, "");
    lines.push(`| Metric | ${rows.map((r) => `\`${r.page}\``).join(" | ")} |`);
    lines.push(`|---|${rows.map(() => "---").join("|")}|`);
    for (const m of METRICS) {
      lines.push(`| ${m.label} | ${rows.map((r) => format(r.medians[m.id], m.unit)).join(" | ")} |`);
    }
    lines.push(`| Runs completed | ${rows.map((r) => `${r.runs}/${opts.runs}`).join(" | ")} |`, "");
  }
  writeFileSync(join(opts.out, "summary.md"), lines.join("\n"));
  console.log(`\nSummary: ${join(opts.out, "summary.md")}`);
}

main();
