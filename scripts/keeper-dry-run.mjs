#!/usr/bin/env node
// Run this checkout's governance keeper in dry-run mode against the live RPC
// and Supabase, so a keeper change can be proven before it is merged.
//
//   node scripts/keeper-dry-run.mjs --env-file <path> [--source <G...>]
//   npm run keeper:dry-run -- --env-file G:/blkfndrapp/.env.local
//
// `scripts/payout-run.sh keeper-dry-run` asks the deployed app, so it can only
// show what the deployed code would do. This script bundles
// src/lib/governance-keeper.ts from the checkout it sits in (esbuild, with
// `server-only` swapped for an empty module, `@/` resolved to src/ and
// `sodium-native` left external, as scripts/authz-check.mjs does) and calls
// runGovernanceKeeper({ dryRun: true, sourcePublicKey }).
//
// Nothing can be signed: OPS_FUNDING_SUBMITTER_SECRET is deleted from the
// environment before the bundle loads, so the keeper takes its dry-run branch,
// which simulates every call from a public key alone and throws if asked to
// sign. The source defaults to the keeper key's public address, so the
// simulations run as the account that would really send them.
//
// The env file is loaded over the current environment (the file named on the
// command line wins). It needs what the keeper reads: NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SECRET_KEY and the Stellar settings, for which network.ts falls back
// to testnet. Node reads `--env-file` itself wherever it appears before a bare
// `--`, even after the script name, so a missing file is refused by Node ("not
// found", exit 9) before this script starts; put `--` before the arguments to
// reach this script's own checks. Either way the file is loaded here again and
// the secret removed before the keeper loads.
//
// Output: one header line, the keeper's result as JSON, then one line per
// action naming the project behind its vault (project_id, title and status
// from projects by vault_address, read with the admin client as the keeper
// itself does). Nothing is sent, whatever the outcome.

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { build } from "esbuild";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(repo, "node_modules", ".cache", "keeper-dry-run");
const KEEPER_PUBLIC_KEY = "GDOCUSXGSMA246WO6UETP6EGIRHXZAH326MJ6BG3SEGXFR4HSF67FITV";
const SECRET_NAME = "OPS_FUNDING_SUBMITTER_SECRET";
const USAGE = "usage: node scripts/keeper-dry-run.mjs --env-file <path> [--source <G...>]";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// ── Arguments ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const options = { envFile: undefined, source: KEEPER_PUBLIC_KEY };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--") continue;
  const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
  const name = eq > 0 ? arg.slice(0, eq) : arg;
  const value = () => (eq > 0 ? arg.slice(eq + 1) : args[++i]);
  if (name === "--env-file") options.envFile = value();
  else if (name === "--source") options.source = value();
  else if (name === "--help" || name === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else fail(`${USAGE}\nunknown argument: ${arg}`, 2);
}
if (!options.envFile) fail(USAGE, 2);
if (!/^G[A-Z2-7]{55}$/.test(options.source ?? "")) {
  fail(`--source must be a Stellar public key (G...), got ${options.source}`, 2);
}

// ── Environment ───────────────────────────────────────────────────────────

const envFile = path.resolve(options.envFile);
if (!fs.existsSync(envFile)) fail(`env file not found: ${envFile}`, 2);
Object.assign(process.env, dotenv.parse(fs.readFileSync(envFile, "utf8")));

// The keeper reads the secret when it runs, not when it loads, but removing it
// before the bundle exists leaves no window in which a signer could be built.
delete process.env[SECRET_NAME];
if (process.env[SECRET_NAME] !== undefined) {
  fail(`${SECRET_NAME} is still set after removing it from the environment; refusing to run.`);
}

// ── Bundle the checkout's keeper ──────────────────────────────────────────

fs.rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: {
    "governance-keeper": path.join(repo, "src", "lib", "governance-keeper.ts"),
    "supabase-admin": path.join(repo, "src", "lib", "supabase", "admin.ts"),
  },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  outdir,
  outExtension: { ".js": ".mjs" },
  absWorkingDir: repo,
  logLevel: "error",
  external: ["sodium-native"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: "keeper-dry-run-stubs",
    setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};", loader: "js" }));
      b.onResolve({ filter: /^@\// }, (a) => {
        const base = path.join(repo, "src", a.path.slice(2));
        for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
          if (fs.existsSync(base + ext)) return { path: base + ext };
        }
        return null;
      });
    },
  }],
});
const load = (name) => import(pathToFileURL(path.join(outdir, `${name}.mjs`)).href);
const { runGovernanceKeeper } = await load("governance-keeper");
const { createAdminClient } = await load("supabase-admin");

// ── Run it ────────────────────────────────────────────────────────────────

const startedAt = new Date().toISOString();
const result = await runGovernanceKeeper({ dryRun: true, sourcePublicKey: options.source });

// Name the projects behind the vaults the keeper reported on.
const vaults = [...new Set(result.actions.map((a) => a.vault))];
const byVault = new Map();
if (vaults.length > 0) {
  const { data, error } = await createAdminClient()
    .from("projects")
    .select("project_id, title, status, vault_address")
    .in("vault_address", vaults);
  if (error) fail(`Could not name the projects behind the vaults: ${error.message}`);
  for (const row of data ?? []) byVault.set(row.vault_address, row);
}

console.log(
  `Dry run of ${path.relative(process.cwd(), repo) || "."} started ${startedAt}, source ${options.source}, ` +
    `${SECRET_NAME} present: ${process.env[SECRET_NAME] !== undefined}`,
);
console.log(JSON.stringify(result, null, 2));
for (const a of result.actions) {
  const p = byVault.get(a.vault);
  const stage = a.milestoneId === undefined ? "" : ` stage ${a.milestoneId}`;
  console.log(
    `${a.kind}${stage} -> ${a.outcome}: ${a.vault} = project #${p?.project_id ?? "?"} ` +
      `"${p?.title ?? "?"}" (${p?.status ?? "?"} in Postgres)`,
  );
}
