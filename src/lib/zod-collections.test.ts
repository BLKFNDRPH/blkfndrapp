// No collection whose size a request controls reaches zod unbounded. Since
// 4.6.6 (GHSA-mrhx-c7xc-m3w5) zod checks an array's .max() or .length(), or a
// set's .size(), before it parses the elements, so a bounded collection refuses
// an oversized one with a single issue. An unbounded array, a record or a map
// still parses every element, one issue per bad element: 200,000 bad ids make
// 200,000 issues in zod 4.6.7, and in zod 3 a 1 MB list built 500,000 issues and
// ~180 MB of heap in markRead before it took at most 201 ids.
//
// This fails on any zod collection schema in code that runs on the server
// (everything under src/ except "use client" modules) that isn't listed below.
// A new one needs a bound zod checks first, or its input bounded before zod
// sees it as markRead's is, and an entry here saying how.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED: Record<string, { count: number; why: string }> = {
  "src/lib/data/notifications.ts": {
    count: 1,
    why: "markRead's ids are .max(200), and it hands zod at most 201 of them besides",
  },
  "src/ai/flows/improve-listing-quality.ts": {
    count: 2,
    why: "the model's reply: suggestions and flags are each .max(10)",
  },
};

/** The names a module binds zod to: `import { z } from "zod"`, `import * as z from "zod"`, `import { z as y } from "zod/v4"`. */
function zodNames(source: string): string[] {
  const names = new Set<string>();
  for (const [, name] of source.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+["']zod(?:\/[^"']*)?["']/g)) {
    names.add(name);
  }
  for (const [, specs] of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']zod(?:\/[^"']*)?["']/g)) {
    for (const spec of specs.split(",")) {
      const [name, alias] = spec.trim().split(/\s+as\s+/);
      if (name === "z") names.add(alias ?? name);
    }
  }
  return [...names];
}

/** How many zod array, record, set or map schemas a module builds. */
function zodCollections(source: string): number {
  const names = zodNames(source);
  if (names.length === 0) return 0;
  const built = new RegExp(String.raw`\b(?:${names.join("|")})\s*\.\s*(?:array|record|set|map)\s*\(`, "g");
  const chained = /\.\s*array\s*\(\s*\)/g; // z.string().array()
  return (source.match(built)?.length ?? 0) + (source.match(chained)?.length ?? 0);
}

const repo = fileURLToPath(new URL("../..", import.meta.url));
const useClient = /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/;

function serverModules(): string[] {
  return readdirSync(path.join(repo, "src"), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|d)\.ts$/.test(f))
    .map((f) => path.join("src", f).split(path.sep).join("/"))
    .filter((f) => !useClient.test(readFileSync(path.join(repo, f), "utf8")));
}

test("the scanner sees each way of building a zod collection", () => {
  const z = 'import { z } from "zod";\n';
  assert.equal(zodCollections(z + "z.array(z.string())"), 1);
  assert.equal(zodCollections(z + "z\n  .record(z.string(), z.number())"), 1);
  assert.equal(zodCollections(z + "z.set(z.string()); z.map(z.string(), z.string())"), 2);
  assert.equal(zodCollections(z + "z.string().array()"), 1);
  assert.equal(zodCollections('import * as zod from "zod";\nzod.array(zod.string())'), 1);
  assert.equal(zodCollections('import { z as y } from "zod/v4";\ny.array(y.string())'), 1);
  assert.equal(zodCollections("const z = { array: () => 1 }; z.array()"), 0);
  assert.equal(zodCollections(z + "[1, 2].map((n) => n); new Set(); z.string().max(3)"), 0);
});

test("no zod collection schema runs on the server unless it is bounded and listed", () => {
  const found: Record<string, number> = {};
  for (const file of serverModules()) {
    const count = zodCollections(readFileSync(path.join(repo, file), "utf8"));
    if (count > 0) found[file] = count;
  }
  const allowed = Object.fromEntries(Object.entries(ALLOWED).map(([f, { count }]) => [f, count]));
  assert.deepEqual(
    found,
    allowed,
    "zod collection schemas changed. A new one must bound its input before zod sees it " +
      "(a .max(), .length() or .size() zod checks first, or a cap applied before zod runs) and be " +
      "listed in ALLOWED in src/lib/zod-collections.test.ts with how; a removed one comes out of ALLOWED.",
  );
});
