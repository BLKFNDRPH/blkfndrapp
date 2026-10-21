import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyHostRedirect, legacyHosts } from "./legacy-hosts.ts";

const env = { legacyHosts: "testnetv2.blkfndr.com", appUrl: "https://blkfndr.com" };
const req = (host: string, pathname = "/projects/22", search = "", forwardedHost: string | null = null) => ({
  forwardedHost,
  host,
  pathname,
  search,
});

test("a request on the retired host goes to the same path and query on the canonical origin", () => {
  assert.equal(
    legacyHostRedirect(req("testnetv2.blkfndr.com", "/projects/22", "?tab=record"), env),
    "https://blkfndr.com/projects/22?tab=record",
  );
  assert.equal(legacyHostRedirect(req("testnetv2.blkfndr.com", "/"), env), "https://blkfndr.com/");
});

test("the compose default sends www to the bare domain as well", () => {
  const compose = { ...env, legacyHosts: "testnetv2.blkfndr.com,www.blkfndr.com" };
  assert.equal(
    legacyHostRedirect(req("www.blkfndr.com", "/projects/22", "?tab=record"), compose),
    "https://blkfndr.com/projects/22?tab=record",
  );
  assert.equal(legacyHostRedirect(req("WWW.blkfndr.com", "/"), compose), "https://blkfndr.com/");
  assert.equal(legacyHostRedirect(req("blkfndr-app:3000", "/", "", "www.blkfndr.com"), compose), "https://blkfndr.com/");
  assert.equal(legacyHostRedirect(req("testnetv2.blkfndr.com", "/"), compose), "https://blkfndr.com/");
  assert.equal(legacyHostRedirect(req("blkfndr.com"), compose), null);
});

test("the canonical host and unlisted hosts are served as usual", () => {
  assert.equal(legacyHostRedirect(req("blkfndr.com"), env), null);
  assert.equal(legacyHostRedirect(req("staging.blkfndr.com"), env), null);
  assert.equal(legacyHostRedirect(req("blkfndr-app:3000"), env), null);
  assert.equal(legacyHostRedirect(req("localhost:3000"), env), null);
});

test("X-Forwarded-Host wins over Host, as it does for the sign-in origin", () => {
  assert.equal(
    legacyHostRedirect(req("blkfndr-app:3000", "/x", "", "testnetv2.blkfndr.com"), env),
    "https://blkfndr.com/x",
  );
  assert.equal(legacyHostRedirect(req("testnetv2.blkfndr.com", "/x", "", "blkfndr.com"), env), null);
});

test("host matching ignores case, a trailing dot and a stray path, and includes the port", () => {
  assert.equal(legacyHostRedirect(req("TestNetV2.BLKFNDR.com."), env), "https://blkfndr.com/projects/22");
  assert.equal(legacyHostRedirect(req("testnetv2.blkfndr.com:8443"), env), null);
  assert.equal(
    legacyHostRedirect(req("testnetv2.blkfndr.com:8443"), { ...env, legacyHosts: "testnetv2.blkfndr.com:8443" }),
    "https://blkfndr.com/projects/22",
  );
  assert.deepEqual([...legacyHosts(" https://Old.Example.com/ , old2.example.com/path, ,bad://")], [
    "old.example.com",
    "old2.example.com",
  ]);
});

test("nothing happens without a list or without a usable canonical origin", () => {
  assert.equal(legacyHostRedirect(req("testnetv2.blkfndr.com"), { appUrl: "https://blkfndr.com" }), null);
  assert.equal(legacyHostRedirect(req("testnetv2.blkfndr.com"), { legacyHosts: "testnetv2.blkfndr.com" }), null);
  assert.equal(
    legacyHostRedirect(req("testnetv2.blkfndr.com"), { legacyHosts: "testnetv2.blkfndr.com", appUrl: "not a url" }),
    null,
  );
  assert.equal(
    legacyHostRedirect(req("testnetv2.blkfndr.com"), { legacyHosts: "testnetv2.blkfndr.com", appUrl: "ftp://blkfndr.com" }),
    null,
  );
});

test("a list that names the canonical host itself never loops", () => {
  assert.equal(
    legacyHostRedirect(req("blkfndr.com"), { legacyHosts: "blkfndr.com,testnetv2.blkfndr.com", appUrl: "https://blkfndr.com" }),
    null,
  );
});

test("a missing leading slash or question mark is repaired rather than producing a broken URL", () => {
  assert.equal(
    legacyHostRedirect({ forwardedHost: null, host: "testnetv2.blkfndr.com", pathname: "projects", search: "a=1" }, env),
    "https://blkfndr.com/projects?a=1",
  );
});
