import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, createNonce } from "./csp.ts";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values];
    }),
  );
}

const base = {
  nonce: "abc123",
  supabaseUrl: "https://eqnheftmstapthlblpbx.supabase.co",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org/",
  horizonUrl: "https://horizon-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
};

test("scripts need the nonce, and nothing inline or eval'd runs", () => {
  const d = directives(buildCsp(base));
  assert.deepEqual(d.get("script-src"), ["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  assert.deepEqual(d.get("object-src"), ["'none'"]);
  assert.deepEqual(d.get("base-uri"), ["'self'"]);
  assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(d.get("default-src"), ["'self'"]);
});

test("connect-src lists each backend by origin only", () => {
  const d = directives(buildCsp(base));
  assert.deepEqual(d.get("connect-src"), [
    "'self'",
    "data:",
    "https://eqnheftmstapthlblpbx.supabase.co",
    "https://soroban-testnet.stellar.org",
    "https://horizon-testnet.stellar.org",
    "https://friendbot.stellar.org",
    "https://api.coingecko.com",
  ]);
});

test("Mainnet has no faucet, and a missing or bad URL is left out", () => {
  const d = directives(
    buildCsp({ ...base, friendbotUrl: null, supabaseUrl: undefined, horizonUrl: "javascript:alert(1)" }),
  );
  assert.deepEqual(d.get("connect-src"), [
    "'self'",
    "data:",
    "https://soroban-testnet.stellar.org",
    "https://api.coingecko.com",
  ]);
  assert.deepEqual(d.get("form-action"), ["'self'", "https://accounts.google.com"]);
});

test("the maps frame is allowed only when the embed is configured", () => {
  assert.deepEqual(directives(buildCsp(base)).get("frame-src"), ["'none'"]);
  assert.deepEqual(directives(buildCsp({ ...base, mapsEmbed: true })).get("frame-src"), [
    "https://www.google.com",
  ]);
});

test("eval is allowed only in next dev", () => {
  assert.ok(!buildCsp(base).includes("unsafe-eval"));
  assert.ok(directives(buildCsp({ ...base, dev: true })).get("script-src")!.includes("'unsafe-eval'"));
});

test("nonces are fresh base64", () => {
  const a = createNonce();
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
  assert.notEqual(a, createNonce());
});

test("images come from named hosts, not any https URL", () => {
  const img = directives(buildCsp(base)).get("img-src")!;
  assert.ok(!img.includes("https:") && !img.includes("*"));
  assert.ok(img.includes("https://gateway.pinata.cloud"));
});
