// BF-M-08 / G4-CSP against the production server: starts the standalone build
// (`next build` first) and checks what a browser actually receives, which is
// the proxy's per-request policy merged with next.config.js headers() by Next
// itself. scripts/route-behaviour.test.mjs checks the two halves directly;
// this checks the merge, and that Next stamps the nonce on every script.
//
// Run with `npm run build && npm run test:headers`. The build needs no real
// configuration: CI builds with a Supabase URL that refuses connections.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(repo, ".next", "standalone", "server.js");

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

let base;
let child;
let log = "";

before(async () => {
  assert.ok(fs.existsSync(server), "no standalone build: run `npm run build` first");
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [server], {
    cwd: path.dirname(server),
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    if (child.exitCode !== null || Date.now() > deadline) assert.fail(`the server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
});

after(() => child?.kill());

const directives = (csp) =>
  new Map(csp.split(/;\s*/).filter(Boolean).map((d) => {
    const [name, ...values] = d.trim().split(/\s+/);
    return [name, values];
  }));

function baseline(res) {
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("strict-transport-security") ?? "")?.[1]);
  assert.ok(maxAge >= 31536000, `HSTS max-age is ${maxAge}`);
  assert.equal(res.headers.get("x-powered-by"), null);
}

describe("BF-M-08 / G4-CSP: what the production server sends", () => {
  for (const page of ["/", "/projects", "/roadmap"]) {
    test(`${page} carries the full nonce CSP, and every script has its nonce`, async () => {
      const res = await fetch(base + page, { redirect: "manual" });
      assert.equal(res.status, 200);
      baseline(res);
      assert.equal(res.headers.get("content-security-policy-report-only"), null);
      const csp = res.headers.get("content-security-policy");
      assert.ok(csp, "no Content-Security-Policy");
      const d = directives(csp);
      const script = d.get("script-src") ?? [];
      const nonce = /^'nonce-(.+)'$/.exec(script.find((v) => v.startsWith("'nonce-")) ?? "")?.[1];
      assert.ok(nonce, `script-src has no nonce: ${csp}`);
      assert.ok(script.includes("'strict-dynamic'"));
      assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"));
      assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
      assert.deepEqual(d.get("object-src"), ["'none'"]);
      assert.deepEqual(d.get("base-uri"), ["'self'"]);

      // A script without the nonce would not run, so the page would not work.
      const scripts = (await res.text()).match(/<script\b[^>]*>/g) ?? [];
      assert.ok(scripts.length > 0, "the page has no scripts");
      const without = scripts.filter((s) => !s.includes(`nonce="${nonce}"`));
      assert.deepEqual(without, [], "scripts without the response's nonce");
    });
  }

  test("each response has its own nonce", async () => {
    const nonce = async () => /'nonce-([^']+)'/.exec((await fetch(`${base}/`)).headers.get("content-security-policy"))?.[1];
    const [a, b] = [await nonce(), await nonce()];
    assert.ok(a && b);
    assert.notEqual(a, b);
  });

  test("an API response carries the headers too", async () => {
    const res = await fetch(`${base}/api/health`);
    baseline(res);
    assert.deepEqual(directives(res.headers.get("content-security-policy") ?? "").get("frame-ancestors"), ["'none'"]);
  });

  test("a static file the proxy skips still cannot be framed", async () => {
    const res = await fetch(`${base}/favicon.ico`);
    assert.equal(res.status, 200);
    baseline(res);
    assert.deepEqual(directives(res.headers.get("content-security-policy") ?? "").get("frame-ancestors"), ["'none'"]);
  });
});
