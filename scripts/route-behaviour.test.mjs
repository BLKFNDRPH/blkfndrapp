// Route-level abuse-case tests: each one sends the request a threat in the
// Gate 4 register describes to the real route handler, server action or proxy,
// and checks it is refused (or, for the headers, that the response carries
// them), while the legitimate version of the same request still works. Threat
// ids refer to threat-register-blkfndr.md (Gate 4, 4.1-abuse).
//
// Run with `npm run test:routes`. Nothing here touches a real database or
// signs in as anyone: the endpoints are bundled with esbuild as in
// scripts/authz-check.mjs, the Supabase clients are scripts/authz/stubs.mjs,
// and the service-role client reads and writes the in-memory rows each test
// puts in globalThis.__authz.db.

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { bundle, repo, stubs } from "./authz/bundle.mjs";

const require = createRequire(import.meta.url);
const cache = path.join(repo, "node_modules", ".cache");

Object.assign(process.env, {
  NEXT_PUBLIC_SOROBAN_RPC_URL: "https://127.0.0.1:9",
  NEXT_PUBLIC_HORIZON_URL: "https://127.0.0.1:9",
  NEXT_PUBLIC_APP_URL: "http://localhost:9002",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub",
  SUPABASE_SERVICE_ROLE_KEY: "stub",
});

const { authz, NextRequest } = await import(pathToFileURL(stubs).href);
globalThis.fetch = async (url) => {
  authz.effects.push(`fetch ${new URL(String(url?.url ?? url)).host}`);
  return new Response("stubbed", { status: 503 });
};

const src = (p) => path.join(repo, "src", p);
const FILES = {
  notifications: src("app/api/notifications/route.ts"),
  notificationsData: src("lib/data/notifications.ts"),
  userByAddresses: src("app/api/user-by-addresses/route.ts"),
  nonce: src("app/api/auth/freighter/nonce/route.ts"),
  verify: src("app/api/auth/freighter/verify/route.ts"),
  platformSettings: src("app/api/admin/platform-settings/route.ts"),
  health: src("app/api/health/route.ts"),
  actions: src("app/actions.ts"),
  moderation: src("actions/moderation.ts"),
  kyc: src("lib/data/kyc.ts"),
  selfReview: src("lib/kyc/self-review.ts"),
};
let mods;

before(async () => {
  const load = await bundle(Object.values(FILES), { outdir: path.join(cache, "route-behaviour") });
  mods = Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([k, f]) => [k, await load(f)])));
});

// ── Identities and requests ───────────────────────────────────────────────

const REVIEWER = { sub: "00000000-0000-4000-8000-0000000000a1", email: "reviewer@behaviour.test", role: "kyc_manager" };
const OTHER_REVIEWER = { sub: "00000000-0000-4000-8000-0000000000a2", email: "reviewer2@behaviour.test", role: "kyc_manager" };
const ALICE = { sub: "00000000-0000-4000-8000-0000000000b1", email: "alice@behaviour.test", role: null };
const MALLORY = { sub: "00000000-0000-4000-8000-0000000000b2", email: "mallory@behaviour.test", role: null };
const PLATFORM_ADMIN = { sub: "00000000-0000-4000-8000-0000000000c1", email: "padmin@behaviour.test", role: "platform_admin" };

const OWN_CHECK = "10000000-0000-4000-8000-000000000001";
const ALICE_CHECK = "10000000-0000-4000-8000-000000000002";
const WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

/** Fresh rows, no recorded effects, signed in as `who` (null: signed out). */
function reset(who, db = {}) {
  authz.who = who;
  authz.db = db;
  authz.effects = [];
  authz.writes = [];
}

// The handlers log their own failures, which is noise here.
async function quietly(fn) {
  const saved = { error: console.error, warn: console.warn };
  console.error = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

async function call(mod, method, { body, raw, query = {} } = {}) {
  const url = new URL("http://localhost:9002/api/x");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const init = { method, headers: { "content-type": "application/json" } };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  const res = await quietly(() => mod[method](new NextRequest(url, init), { params: Promise.resolve({}) }));
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

const writesTo = (table) => authz.writes.filter((w) => w.table === table);

// ── BF-M-08 / G4-CSP: security headers are delivered ─────────────────────

describe("BF-M-08 / G4-CSP: every page is served with the nonce CSP and the security headers", () => {
  let proxy, config, RealNextRequest;

  before(async () => {
    // The proxy runs with the real next/server and @supabase/ssr: the headers
    // it sets and the request override Next reads the nonce from are theirs.
    const load = await bundle([src("proxy.ts")], {
      outdir: path.join(cache, "route-behaviour-proxy"),
      stubbed: /^(server-only)$/,
    });
    ({ proxy, config } = await load(src("proxy.ts")));
    ({ NextRequest: RealNextRequest } = require("next/server"));
  });

  const directives = (csp) =>
    new Map(csp.split(/;\s*/).filter(Boolean).map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }));

  async function page(pathname) {
    authz.effects = [];
    return proxy(new RealNextRequest(new URL(pathname, "http://localhost:9002"), { headers: { host: "localhost:9002" } }));
  }

  test("a page response carries the full nonce Content-Security-Policy", async () => {
    const res = await page("/projects/12");
    const csp = res.headers.get("content-security-policy");
    assert.ok(csp, "no Content-Security-Policy header on the response");
    assert.equal(res.headers.get("content-security-policy-report-only"), null);
    const d = directives(csp);
    const nonce = d.get("script-src")?.find((v) => /^'nonce-[A-Za-z0-9+/=]{16,}'$/.test(v));
    assert.ok(nonce, `script-src has no nonce: ${d.get("script-src")}`);
    assert.ok(d.get("script-src").includes("'strict-dynamic'"));
    assert.ok(!d.get("script-src").includes("'unsafe-inline'"));
    assert.ok(!d.get("script-src").includes("'unsafe-eval'"));
    assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(d.get("object-src"), ["'none'"]);
    assert.deepEqual(d.get("base-uri"), ["'self'"]);
    assert.deepEqual(d.get("default-src"), ["'self'"]);

    // Next copies the proxy's response headers onto the request and stamps its
    // own scripts with the nonce in that CSP; the root layout's theme script
    // gets it from the x-nonce request header. Both must be the same nonce.
    assert.equal(`'nonce-${res.headers.get("x-middleware-request-x-nonce")}'`, nonce,
      "the root layout's theme script would not get the policy's nonce");
  });

  test("every request gets a new nonce", async () => {
    const a = (await page("/")).headers.get("x-middleware-request-x-nonce");
    const b = (await page("/")).headers.get("x-middleware-request-x-nonce");
    assert.ok(a && b);
    assert.notEqual(a, b);
  });

  test("the proxy runs for pages and API routes, not for static files", () => {
    const matchers = config.matcher.map((m) => new RegExp(`^${m}$`));
    const runs = (p) => matchers.some((re) => re.test(p));
    for (const p of ["/", "/projects", "/projects/12", "/profile/kyc-attestation", "/admin", "/api/health"]) {
      assert.ok(runs(p), `the proxy skips ${p}, so it is served without the CSP`);
    }
    for (const p of ["/_next/static/chunks/app.js", "/favicon.ico", "/logo.png"]) {
      assert.ok(!runs(p), `the proxy runs for static file ${p}`);
    }
  });

  test("next.config.js sends the baseline headers on every path", async () => {
    const cfg = require(path.join(repo, "next.config.js"));
    assert.equal(cfg.poweredByHeader, false);
    const all = (await cfg.headers()).find((h) => h.source === "/:path*");
    assert.ok(all, "no header rule for /:path*");
    const h = Object.fromEntries(all.headers.map(({ key, value }) => [key.toLowerCase(), value]));
    assert.equal(h["x-frame-options"], "DENY");
    assert.equal(h["x-content-type-options"], "nosniff");
    assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
    const maxAge = Number(/max-age=(\d+)/.exec(h["strict-transport-security"] ?? "")?.[1]);
    assert.ok(maxAge >= 31536000, `HSTS max-age is ${maxAge}`);
    // Static files skip the proxy; this policy still stops them being framed.
    assert.deepEqual(directives(h["content-security-policy"] ?? "").get("frame-ancestors"), ["'none'"]);
  });
});

// ── G4-M2: no reviewer decides their own identity check ──────────────────

describe("G4-M2: a KYC reviewer cannot decide, attest or revoke their own check", () => {
  const rows = () => ({
    kyc_requests: [
      { id: OWN_CHECK, user_id: REVIEWER.sub, stellar_address: WALLET, details_hash: "ab".repeat(32), status: "pending", verified_until: null, document_expires_on: null, rejection_reason: "" },
      { id: ALICE_CHECK, user_id: ALICE.sub, stellar_address: WALLET, details_hash: "cd".repeat(32), status: "pending", verified_until: null, document_expires_on: null, rejection_reason: "" },
    ],
    platform_admins: [
      { email: REVIEWER.email, role: "kyc_manager", managed_wallet: WALLET },
      { email: OTHER_REVIEWER.email, role: "kyc_manager", managed_wallet: WALLET },
    ],
    admin_audit_log: [],
  });

  function assertRefusedAndLogged(attempt) {
    assert.deepEqual(writesTo("kyc_requests"), [], "the reviewer's own check was written");
    assert.deepEqual(authz.effects.filter((e) => !e.endsWith("insert admin_audit_log")), [],
      "something besides the audit entry happened (a chain write, a notification, a file deletion)");
    const log = authz.db.admin_audit_log;
    assert.equal(log.length, 1, "the attempt is not on the audit log");
    assert.equal(log[0].action, "kyc.self_review_refused");
    assert.equal(log[0].actor_id, REVIEWER.sub);
    assert.match(log[0].detail, new RegExp(`${attempt} on their own submission ${OWN_CHECK}`));
  }

  for (const [label, decision, attempt] of [["approving", "approved", "Approve"], ["turning down", "rejected", "Turn down"]]) {
    test(`${label} their own check is refused with 403`, async () => {
      reset(REVIEWER, rows());
      await assert.rejects(quietly(() => mods.kyc.decideSubmission(OWN_CHECK, decision, "x")), (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.message, mods.selfReview.SELF_REVIEW_MESSAGE);
        return true;
      });
      assertRefusedAndLogged(attempt);
      assert.equal(authz.db.kyc_requests[0].status, "pending");

      reset(REVIEWER, rows());
      const res = await quietly(() => mods.actions.updateKycRequestStatus(OWN_CHECK, decision, "x"));
      assert.deepEqual(res, { success: false, error: mods.selfReview.SELF_REVIEW_MESSAGE });
      assertRefusedAndLogged(attempt);
    });
  }

  test("attesting their own check is refused before anything goes on-chain", async () => {
    reset(REVIEWER, rows());
    await assert.rejects(quietly(() => mods.kyc.attestSubmission(OWN_CHECK)), (err) => err.status === 403);
    assertRefusedAndLogged("Attest");

    reset(REVIEWER, rows());
    const res = await quietly(() => mods.actions.attestKycAction(OWN_CHECK));
    assert.deepEqual(res, { success: false, error: mods.selfReview.SELF_REVIEW_MESSAGE });
    assertRefusedAndLogged("Attest");
  });

  test("revoking their own check is refused before anything goes on-chain", async () => {
    reset(REVIEWER, rows());
    await assert.rejects(quietly(() => mods.kyc.revokeSubmissionAttestation(OWN_CHECK)), (err) => err.status === 403);
    assertRefusedAndLogged("Revoke");

    reset(REVIEWER, rows());
    const res = await quietly(() => mods.actions.revokeKycAction(OWN_CHECK));
    assert.deepEqual(res, { success: false, error: mods.selfReview.SELF_REVIEW_MESSAGE });
    assertRefusedAndLogged("Revoke");
  });

  test("a reviewer still decides someone else's check", async () => {
    reset(REVIEWER, rows());
    const res = await quietly(() => mods.actions.updateKycRequestStatus(ALICE_CHECK, "approved"));
    assert.deepEqual(res, { success: true });
    assert.equal(authz.db.kyc_requests[1].status, "approved");
    assert.equal(authz.db.admin_audit_log.length, 0);
  });

  test("and another reviewer decides the first reviewer's check", async () => {
    reset(OTHER_REVIEWER, rows());
    const res = await quietly(() => mods.actions.updateKycRequestStatus(OWN_CHECK, "rejected", "blurry"));
    assert.deepEqual(res, { success: true });
    assert.equal(authz.db.kyc_requests[0].status, "rejected");
  });
});

// ── G4-M3: a wallet is linked only by signing the stored challenge ───────

describe("G4-M3: /api/auth/freighter/verify accepts only a signature over the stored challenge", () => {
  const { createHash } = require("node:crypto");
  const sep53 = (text) => createHash("sha256").update("Stellar Signed Message:\n" + text, "utf8").digest();
  const sign = (kp, digest) => kp.sign(digest).toString("base64");

  async function challenge(who, kp, db = { wallet_link_challenges: [], profiles: [{ id: ALICE.sub }, { id: MALLORY.sub }] }) {
    reset(who, db);
    const res = await call(mods.nonce, "POST", { body: { publicKey: kp.publicKey() } });
    assert.equal(res.status, 200, res.text);
    return { ...res.json, db: authz.db };
  }

  async function verify(who, db, body) {
    authz.who = who;
    authz.db = db;
    authz.effects = [];
    authz.writes = [];
    return call(mods.verify, "POST", { body });
  }

  const linked = () => writesTo("profiles").filter((w) => w.values?.stellar_public_key);

  test("the challenge names the site, the account and the wallet, and is stored against the account", async () => {
    const kp = Keypair.random();
    const { nonce, message, db } = await challenge(ALICE, kp);
    assert.match(message, /^localhost:9002 wants you to link this Stellar wallet/);
    assert.ok(message.includes(`Account: ${ALICE.email}`));
    assert.ok(message.includes(`Wallet: ${kp.publicKey()}`));
    assert.ok(message.includes(`Nonce: ${nonce}`));
    assert.equal(db.wallet_link_challenges.length, 1);
    assert.equal(db.wallet_link_challenges[0].user_id, ALICE.sub);
    assert.equal(db.wallet_link_challenges[0].message, message);
  });

  test("a SEP-53 signature over the stored message links the wallet", async () => {
    const kp = Keypair.random();
    const { nonce, message, db } = await challenge(ALICE, kp);
    const res = await verify(ALICE, db, { publicKey: kp.publicKey(), nonce, signature: sign(kp, sep53(message)) });
    assert.equal(res.status, 200, res.text);
    assert.equal(linked().length, 1);
    assert.equal(linked()[0].values.stellar_public_key, kp.publicKey());
  });

  const forgeries = {
    "the bare nonce (SEP-53)": (kp, { nonce }) => sign(kp, sep53(nonce)),
    "the bare nonce, raw": (kp, { nonce }) => kp.sign(Buffer.from(nonce)).toString("base64"),
    "the message without the SEP-53 prefix": (kp, { message }) => sign(kp, createHash("sha256").update(message).digest()),
    "the message for another site": (kp, { message }) => sign(kp, sep53(message.replace(/^localhost:9002/, "evil.example"))),
    "the message naming another account": (kp, { message }) => sign(kp, sep53(message.replace(ALICE.email, MALLORY.email))),
    "some other text": (kp) => sign(kp, sep53("Sign in to BLKFNDR")),
    "the right message, by another key": (_kp, { message }) => sign(Keypair.random(), sep53(message)),
  };
  for (const [label, forge] of Object.entries(forgeries)) {
    test(`a signature over ${label} is refused and burns the challenge`, async () => {
      const kp = Keypair.random();
      const issued = await challenge(ALICE, kp);
      const body = { publicKey: kp.publicKey(), nonce: issued.nonce, signature: forge(kp, issued) };
      const res = await verify(ALICE, issued.db, body);
      assert.equal(res.status, 401, res.text);
      assert.deepEqual(linked(), [], "the wallet was linked");
      // Single use: the right signature does not work after a failed one.
      const retry = await verify(ALICE, issued.db, { ...body, signature: sign(kp, sep53(issued.message)) });
      assert.equal(retry.status, 401, retry.text);
      assert.deepEqual(linked(), []);
    });
  }

  test("a challenge issued to one account cannot be redeemed by another", async () => {
    // Mallory asks for a challenge for her own session and gets Alice to sign
    // it; or Alice's signed challenge reaches Mallory's session.
    const kp = Keypair.random();
    const issued = await challenge(ALICE, kp);
    const body = { publicKey: kp.publicKey(), nonce: issued.nonce, signature: sign(kp, sep53(issued.message)) };
    const res = await verify(MALLORY, issued.db, body);
    assert.equal(res.status, 401, res.text);
    assert.deepEqual(linked(), []);
  });

  test("an expired challenge is refused", async () => {
    const kp = Keypair.random();
    const issued = await challenge(ALICE, kp);
    issued.db.wallet_link_challenges[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await verify(ALICE, issued.db, { publicKey: kp.publicKey(), nonce: issued.nonce, signature: sign(kp, sep53(issued.message)) });
    assert.equal(res.status, 401, res.text);
    assert.deepEqual(linked(), []);
  });
});

// ── BF-L-01: malformed bodies get 400 after authentication ───────────────

describe("BF-L-01: malformed input is refused with 401 signed out and 400 signed in, never 500", () => {
  const MALFORMED = {
    "not JSON": { raw: "notjson" },
    "empty": { raw: "" },
    "null": { raw: "null" },
    "an array": { raw: "[]" },
    "a string": { raw: '"x"' },
  };
  const BAD_IDS = {
    "ids that aren't uuids": { body: { ids: ["x"] } },
    "ids that aren't strings": { body: { ids: [1] } },
    "a quote for an id": { body: { ids: ["'\"<"] } },
  };

  const ROUTES = [
    // [name, module, method, who may call it, what a malformed body gets once signed in, extra cases]
    ["PATCH /api/notifications", "notifications", "PATCH", ALICE, 200, BAD_IDS],
    ["POST /api/user-by-addresses", "userByAddresses", "POST", ALICE, 200, { "addresses that aren't an array": { body: { addresses: "x" }, status: 200 }, "addresses that aren't addresses": { body: { addresses: ["x", 1, null] }, status: 200 } }],
    ["POST /api/auth/freighter/nonce", "nonce", "POST", ALICE, 400, { "a public key that isn't an address": { body: { publicKey: "x" } }, "a number": { body: { publicKey: 1 } } }],
    ["POST /api/auth/freighter/verify", "verify", "POST", ALICE, 400, { "a public key that isn't an address": { body: { publicKey: "x", nonce: "n", signature: "c2ln" } }, "a nonce that isn't a string": { body: { publicKey: WALLET, nonce: 1, signature: "c2ln" } } }],
    ["POST /api/admin/platform-settings", "platformSettings", "POST", PLATFORM_ADMIN, 400, { "an email that isn't one": { body: { feeWalletEmail: "x" } }, "an email that isn't a string": { body: { feeWalletEmail: 1 } } }],
  ];

  for (const [name, mod, method, who, signedInStatus, extra] of ROUTES) {
    for (const [label, input] of Object.entries({ ...MALFORMED, ...extra })) {
      test(`${name} with ${label}: 401 signed out`, async () => {
        reset(null);
        const res = await call(mods[mod], method, input);
        assert.equal(res.status, 401, res.text);
        assert.deepEqual(authz.effects, []);
      });

      // A body with no ids or addresses in it is a no-op for notifications and
      // user-by-addresses (nothing to mark, nothing to resolve), so 200 with
      // nothing done is their answer; what matters is that it is not a 500.
      const expected = label in MALFORMED ? signedInStatus : (input.status ?? 400);
      test(`${name} with ${label}: ${expected} signed in, nothing written`, async () => {
        reset(who);
        const res = await call(mods[mod], method, input);
        assert.equal(res.status, expected, res.text);
        assert.deepEqual(authz.effects, []);
      });
    }
  }

  test("DELETE /api/notifications with an id that isn't a uuid: 400 signed in, 401 signed out", async () => {
    reset(ALICE);
    const res = await call(mods.notifications, "DELETE", { query: { id: "'\"<" } });
    assert.equal(res.status, 400, res.text);
    assert.deepEqual(authz.effects, []);
    reset(null);
    assert.equal((await call(mods.notifications, "DELETE", { query: { id: "x" } })).status, 401);
  });

  test("the well-formed requests still work", async () => {
    reset(ALICE);
    const id = "20000000-0000-4000-8000-000000000001";
    assert.equal((await call(mods.notifications, "PATCH", { body: { ids: [id] } })).status, 200);
    assert.deepEqual(authz.effects, ["session: update notifications"]);
    reset(PLATFORM_ADMIN, { platform_settings: [{ id: true, fee_wallet_email: "old@behaviour.test" }] });
    assert.equal((await call(mods.platformSettings, "POST", { body: { feeWalletEmail: "fees@behaviour.test" } })).status, 200);
    assert.equal(authz.db.platform_settings[0].fee_wallet_email, "fees@behaviour.test");
  });
});

// ── GHSA-mrhx-c7xc-m3w5: an oversized id list is refused cheaply ─────────

describe("GHSA-mrhx-c7xc-m3w5: an oversized notification id list costs no more than a full one", () => {
  // zod 3 parsed every element before it applied .max(200), one issue per bad
  // element. 500,000 numbers is a 1 MB body; it used to build 500,001 issues
  // and ~180 MB of heap in one request. zod 4.6.6 checks .max() first, and
  // markRead slices the list to 201 besides; this holds either way.
  const HUGE = Array(500_000).fill(0);
  const uuids = (n) => Array.from({ length: n }, (_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  test("markRead refuses it having looked at no more than 201 elements", async () => {
    reset(ALICE);
    const error = await mods.notificationsData.markRead(HUGE).catch((e) => e);
    assert.ok(Array.isArray(error?.issues), String(error));
    assert.ok(error.issues.length <= 202, `${error.issues.length} issues`);
    assert.ok(error.issues.some((i) => i.code === "too_big"));
    assert.deepEqual(authz.effects, []);
  });

  test("PATCH /api/notifications with it: 400, nothing written", async () => {
    reset(ALICE);
    const res = await call(mods.notifications, "PATCH", { body: { ids: HUGE } });
    assert.equal(res.status, 400, res.text);
    assert.deepEqual(authz.effects, []);
  });

  test("200 ids are still marked read, 201 are still refused", async () => {
    reset(ALICE);
    assert.equal((await call(mods.notifications, "PATCH", { body: { ids: uuids(200) } })).status, 200);
    assert.deepEqual(authz.effects, ["session: update notifications"]);
    reset(ALICE);
    assert.equal((await call(mods.notifications, "PATCH", { body: { ids: uuids(201) } })).status, 400);
    assert.deepEqual(authz.effects, []);
  });
});

// ── BF-L-04 / BF-I-02: platform health ────────────────────────────────────

describe("BF-L-04: the platform health counts are the real ones", () => {
  test("getHealth counts rows the browser roles cannot read", async () => {
    const event = (n, processed, attempts = 0) => ({ event_id: `e${n}`, processed_at: processed ? "2026-10-20T00:00:00Z" : null, attempts });
    reset(PLATFORM_ADMIN, {
      profiles: [{ id: "a" }, { id: "b" }, { id: "c" }],
      projects: [{ project_id: 1 }, { project_id: 2 }],
      kyc_requests: [{ id: "k1", status: "pending" }, { id: "k2", status: "approved" }, { id: "k3", status: "pending" }],
      platform_bans: [{ user_id: "b" }],
      contract_events: [event(1, true), event(2, true), event(3, false), event(4, false, 2), event(5, false, 99)],
      indexer_state: [{ key: "last_processed_ledger", value: 123456, updated_at: "2026-10-22T01:02:03Z" }],
    });
    const res = await quietly(() => mods.moderation.getHealthAction());
    assert.equal(res.success, true, JSON.stringify(res));
    assert.deepEqual(res.health, {
      users: 3,
      projects: 2,
      pendingKyc: 2,
      bannedUsers: 1,
      unprocessedEvents: 3,
      givenUpEvents: 1,
      totalEvents: 5,
      lastProcessedLedger: 123456,
      indexerUpdatedAt: "2026-10-22T01:02:03Z",
    });
  });

  test("and only a platform administrator reads them", async () => {
    reset(ALICE, { profiles: [{ id: "a" }] });
    const res = await quietly(() => mods.moderation.getHealthAction());
    assert.equal(res.success, false);
    assert.equal(res.health, undefined);
  });
});

describe("BF-I-02: /api/health says it is up and nothing else", () => {
  test("the body is a status and a time, with no service or version identifier", async () => {
    reset(null);
    const res = await call(mods.health, "GET");
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json).sort(), ["status", "timestamp"]);
    assert.equal(res.json.status, "ok");
    assert.ok(!Number.isNaN(Date.parse(res.json.timestamp)));
    assert.doesNotMatch(res.text, /blkfndr|next|node|version|service/i);
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.deepEqual(authz.effects, []);
  });
});
