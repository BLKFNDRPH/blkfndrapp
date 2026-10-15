#!/usr/bin/env node
// Negative authorization check: every route handler and every server action is
// called as each identity that must NOT reach it, and must refuse it without a
// side effect. QA asked for this (Gate 4, A01): the guards were only ever
// reviewed, never exercised.
//
//   npm run test:authz              check against scripts/authz-manifest.mjs
//   npm run test:authz -- --discover   print who each endpoint lets through
//
// How: each file under src/app/**/route.ts and every "use server" file is
// bundled with esbuild, with the Supabase clients, next/headers, next/server,
// next/cache, next/navigation and the AI flow swapped for scripts/authz/stubs.mjs.
// The guards and the data functions behind them run for real. The stub session
// answers getClaims and the role functions as the database would for the
// identity under test, and records every write, storage call, auth call, other
// RPC and outbound fetch.
//
// For each endpoint the manifest names who may call it:
//   public          anyone (not probed; listed so a new endpoint must be classified)
//   user            any signed-in account
//   admin           any administrator role
//   roles:[...]     those roles (owner always included by the caller)
//   owner           owners only
//   cron            the INDEXER_SECRET bearer token
// Every identity below that is probed and must be refused: a route answers 401
// or 403, an action returns { success: false } or throws, and in both cases
// nothing is recorded. One identity that is allowed is probed too and must not
// be refused with 401/403 or "Unauthorized"/"Forbidden", so a manifest entry
// stricter than the code is caught as well.

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stubs = path.join(repo, "scripts", "authz", "stubs.mjs");
const outdir = path.join(repo, "node_modules", ".cache", "authz-check");
const discover = process.argv.includes("--discover");

const ROLES = ["owner", "platform_admin", "kyc_manager", "project_approver", "accountant"];
const SECRET = "authz-check-secret-0123456789abcdef";
const WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const UUID = "00000000-0000-4000-8000-000000000001";

// Endpoints that would otherwise reach the network fail fast instead.
Object.assign(process.env, {
  INDEXER_SECRET: SECRET,
  NEXT_PUBLIC_SOROBAN_RPC_URL: "https://127.0.0.1:9",
  NEXT_PUBLIC_HORIZON_URL: "https://127.0.0.1:9",
  NEXT_PUBLIC_APP_URL: "http://localhost:9002",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub",
  SUPABASE_SERVICE_ROLE_KEY: "stub",
});

const { authz } = await import(pathToFileURL(stubs).href);
globalThis.fetch = async (url) => {
  authz.effects.push(`fetch ${new URL(String(url?.url ?? url)).host}`);
  return new Response("stubbed", { status: 503 });
};

// ── Find the endpoints ────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(repo, f).split(path.sep).join("/");
const files = walk(path.join(repo, "src"));
const routeFiles = files.filter((f) => /[\\/]route\.ts$/.test(f));
const actionFiles = files.filter(
  (f) => /\.tsx?$/.test(f) && /^\s*["']use server["'];?/.test(fs.readFileSync(f, "utf8")),
);

// ── Bundle them ───────────────────────────────────────────────────────────

const STUBBED = /^(@\/lib\/supabase\/(server|admin)|@\/ai\/flows\/improve-listing-quality|next\/(headers|server|cache|navigation)|server-only)$/;
fs.rmSync(outdir, { recursive: true, force: true });
const entries = [...routeFiles, ...actionFiles];
const result = await build({
  entryPoints: Object.fromEntries(entries.map((f, i) => [`e${i}`, f])),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  outdir,
  absWorkingDir: repo,
  logLevel: "error",
  metafile: true,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: "authz-stubs",
    setup(b) {
      b.onResolve({ filter: STUBBED }, () => ({ path: stubs }));
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
const bundled = new Map();
for (const [out, meta] of Object.entries(result.metafile.outputs)) {
  if (meta.entryPoint) bundled.set(path.resolve(repo, meta.entryPoint), path.resolve(repo, out));
}
const load = (file) => import(pathToFileURL(bundled.get(file)).href);

// ── Call them ─────────────────────────────────────────────────────────────

const IDENTITIES = {
  anon: null,
  user: { sub: UUID, email: "user@authz.test", role: null },
  ...Object.fromEntries(ROLES.map((r, i) => [r, { sub: `00000000-0000-4000-8000-00000000010${i}`, email: `${r}@authz.test`, role: r }])),
};

const BODY = {
  publicKey: WALLET, signature: "c2ln", nonce: "n", addresses: [WALLET], address: WALLET, ids: [UUID], id: UUID,
  key: "fee_wallet_email", value: "x", token: "t", category: "all", path: `${UUID}/x.jpg`, cid: "bafy",
};

// The endpoints log their own failures, which is noise here: muted while one runs.
const quiet = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function withTimeout(promise, ms = 15000) {
  console.error = console.warn = console.info = () => {};
  let timer;
  return Promise.race([promise, new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("timed out")), ms)))])
    .finally(() => { clearTimeout(timer); Object.assign(console, { warn: quiet.warn, error: quiet.error, info: quiet.info }); });
}

async function callRoute(mod, method, file, identity, header) {
  const url = new URL("http://localhost:9002/api/x");
  for (const [k, v] of Object.entries({ address: WALLET, id: UUID, all: "true", token: "t", limit: "1" })) url.searchParams.set(k, v);
  const init = { method, headers: { "content-type": "application/json", ...(header ? { authorization: header } : {}) } };
  if (method !== "GET" && method !== "HEAD") init.body = JSON.stringify(BODY);
  const { NextRequest } = await import(pathToFileURL(stubs).href);
  const req = new NextRequest(url, init);
  const ctx = { params: Promise.resolve({ id: "1", cid: "bafkreig3d4wurc5qwmi3yyllky4bx2yl23jphymkk6tar5efatou3jrimy" }) };
  authz.who = identity; authz.effects = [];
  try {
    const res = await withTimeout(mod[method](req, ctx));
    let text = "";
    try { text = await res.clone().text(); } catch {}
    return { status: res.status, text: text.slice(0, 160), effects: authz.effects };
  } catch (err) {
    return { status: "threw", text: String(err?.message ?? err).slice(0, 160), effects: authz.effects };
  }
}

const ARGS = [UUID, "approved", "authz", true];

async function callAction(fn, identity, args = ARGS) {
  authz.who = identity; authz.effects = [];
  try {
    const value = await withTimeout(fn(...args));
    const refused = value && typeof value === "object" && value.success === false;
    return { outcome: refused ? "refused" : "returned", value, text: JSON.stringify(value ?? null).slice(0, 160), effects: authz.effects };
  } catch (err) {
    return { outcome: "threw", text: `${err?.name ?? "Error"}: ${String(err?.message ?? err)}`.slice(0, 160), effects: authz.effects };
  }
}

const AUTH_WORDS = /\b(401|403)\b|unauthori[sz]ed|forbidden|sign in|signed in|only an? (owner|admin|platform administrator|kyc)|not allowed|permission/i;
const refusedRoute = (r) => (r.status === 401 || r.status === 403) && r.effects.length === 0;
const nullish = (v) => v === null || v === undefined ||
  (typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x === null));
const refusedAction = (r, entry) =>
  (r.outcome === "refused" || r.outcome === "threw" || (entry.refusedWhen === "null" && r.outcome === "returned" && nullish(r.value))) &&
  r.effects.length === 0;
const authRefusal = (r, entry = {}) =>
  !(entry.positiveOk && entry.positiveOk.test(r.text)) &&
  (r.status === 401 || r.status === 403 || ((r.outcome === "refused" || r.outcome === "threw") && AUTH_WORDS.test(r.text)));

// A manifest entry as { level, ...options }.
const norm = (entry) =>
  entry === undefined ? undefined : typeof entry === "string" || entry.roles ? { level: entry } : entry;
const skipped = [];

// ── Discover or check ─────────────────────────────────────────────────────

const { ROUTES, ACTIONS } = await import(pathToFileURL(path.join(repo, "scripts", "authz-manifest.mjs")).href);
const failures = [];
const fail = (msg) => failures.push(msg);

function allowedFor(level) {
  if (level === "public") return Object.keys(IDENTITIES);
  if (level === "user") return ["user", ...ROLES];
  if (level === "admin") return ROLES;
  if (level === "owner") return ["owner"];
  if (Array.isArray(level?.roles)) return ["owner", ...level.roles];
  return [];
}

let probes = 0;

for (const file of routeFiles) {
  const name = rel(file).replace(/^src\/app/, "").replace(/\/route\.ts$/, "") || "/";
  const mod = await load(file);
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function");
  for (const method of methods) {
    const key = `${method} ${name}`;
    const entry = norm(ROUTES[key]);
    const level = entry?.level;
    if (discover) {
      const row = [];
      for (const [who, identity] of Object.entries(IDENTITIES)) {
        const r = await callRoute(mod, method, file, identity);
        row.push(`${who}=${r.status}${r.effects.length ? `!${r.effects.length}` : ""}`);
      }
      const noSecret = await callRoute(mod, method, file, null);
      const withSecret = await callRoute(mod, method, file, null, `Bearer ${SECRET}`);
      console.log(`${key.padEnd(46)} ${row.join(" ")}  | secret: none=${noSecret.status} right=${withSecret.status}  [manifest: ${JSON.stringify(level)}]`);
      continue;
    }
    if (level === undefined) { fail(`${key}: not in the manifest. Classify it in scripts/authz-manifest.mjs.`); continue; }
    if (level === "public") continue;
    if (level === "cron") {
      for (const [label, header] of [["no token", undefined], ["wrong token", `Bearer ${"x".repeat(SECRET.length)}`], ["short token", "Bearer x"], ["admin session, no token", undefined]]) {
        const r = await callRoute(mod, method, file, label.startsWith("admin") ? IDENTITIES.owner : null, header);
        probes++;
        if (!refusedRoute(r)) fail(`${key} with ${label}: expected 401/403 and no side effect, got ${r.status} ${r.text} ${JSON.stringify(r.effects)}`);
      }
      const ok = await callRoute(mod, method, file, null, `Bearer ${SECRET}`);
      probes++;
      if (authRefusal(ok, entry)) fail(`${key} with the right token: refused (${ok.status} ${ok.text}); the manifest or the check is wrong`);
      continue;
    }
    const allowed = allowedFor(level);
    for (const [who, identity] of Object.entries(IDENTITIES)) {
      if (allowed.includes(who)) continue;
      const r = await callRoute(mod, method, file, identity);
      probes++;
      if (!refusedRoute(r)) fail(`${key} as ${who}: expected 401/403 and no side effect, got ${r.status} ${r.text} ${JSON.stringify(r.effects)}`);
    }
    const ok = await callRoute(mod, method, file, IDENTITIES[allowed[allowed.length - 1]]);
    probes++;
    if (authRefusal(ok, entry)) fail(`${key} as ${allowed[allowed.length - 1]} (allowed): refused (${ok.status} ${ok.text}); the manifest is stricter than the code`);
  }
}

for (const file of actionFiles) {
  const mod = await load(file);
  for (const [exported, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    const key = `${rel(file)}#${exported}`;
    const entry = norm(ACTIONS[key]);
    const level = entry?.level;
    const args = entry?.args ?? ARGS;
    if (discover) {
      const row = [];
      for (const [who, identity] of Object.entries(IDENTITIES)) {
        const r = await callAction(fn, identity, args);
        row.push(`${who}=${r.outcome === "refused" ? "R" : r.outcome === "threw" ? "T" : "ok"}${r.effects.length ? `!${r.effects.length}` : ""}`);
      }
      const anon = await callAction(fn, null, args);
      console.log(`${key.padEnd(62)} ${row.join(" ")}  [manifest: ${JSON.stringify(level)}]  anon: ${anon.text}`);
      continue;
    }
    if (level === undefined) { fail(`${key}: not in the manifest. Classify it in scripts/authz-manifest.mjs.`); continue; }
    if (level === "public") continue;
    if (level === "db-only" || level === "untestable") { skipped.push(`${key} (${level}): ${entry.why}`); continue; }
    const allowed = allowedFor(level);
    for (const [who, identity] of Object.entries(IDENTITIES)) {
      if (allowed.includes(who)) continue;
      const r = await callAction(fn, identity, args);
      probes++;
      if (!refusedAction(r, entry)) fail(`${key} as ${who}: expected a refusal with no side effect, got ${r.outcome} ${r.text} ${JSON.stringify(r.effects)}`);
    }
    const who = allowed[allowed.length - 1];
    const ok = await callAction(fn, IDENTITIES[who], args);
    probes++;
    if (authRefusal(ok, entry)) fail(`${key} as ${who} (allowed): refused (${ok.text}); the manifest is stricter than the code`);
  }
}

// Manifest entries that no longer match an endpoint.
if (!discover) {
  const seenRoutes = new Set();
  for (const file of routeFiles) {
    const name = rel(file).replace(/^src\/app/, "").replace(/\/route\.ts$/, "") || "/";
    const mod = await load(file);
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) if (typeof mod[m] === "function") seenRoutes.add(`${m} ${name}`);
  }
  for (const key of Object.keys(ROUTES)) if (!seenRoutes.has(key)) fail(`manifest route ${key} matches no handler; remove it`);
  const seenActions = new Set();
  for (const file of actionFiles) {
    const mod = await load(file);
    for (const [k, v] of Object.entries(mod)) if (typeof v === "function") seenActions.add(`${rel(file)}#${k}`);
  }
  for (const key of Object.keys(ACTIONS)) if (!seenActions.has(key)) fail(`manifest action ${key} matches no export; remove it`);

  for (const s of skipped) console.log(`not probed: ${s}`);
  for (const f of failures) console.error(`FAIL ${f}`);
  console.log(`${probes} probes over ${routeFiles.length} route files and ${actionFiles.length} action files: ${failures.length ? `${failures.length} failed` : "all refused as expected"}`);
  process.exit(failures.length ? 1 : 0);
}
