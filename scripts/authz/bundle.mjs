// Bundles route handlers, server actions and other server modules with esbuild
// so plain Node can load them, with the modules that reach outside the process
// swapped for scripts/authz/stubs.mjs. Shared by scripts/authz-check.mjs and
// scripts/route-behaviour.test.mjs.

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const stubs = path.join(repo, "scripts", "authz", "stubs.mjs");

/** Everything the stubs stand in for. */
export const STUBBED = /^(@\/lib\/supabase\/(server|admin)|@\/ai\/flows\/improve-listing-quality|next\/(headers|server|cache|navigation)|server-only)$/;

/**
 * Bundle `files` (absolute paths) into `outdir`, replacing every import that
 * matches `stubbed` with the stubs. Returns a loader: file → its module.
 */
export async function bundle(files, { outdir, stubbed = STUBBED }) {
  fs.rmSync(outdir, { recursive: true, force: true });
  const result = await build({
    entryPoints: Object.fromEntries(files.map((f, i) => [`e${i}`, f])),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    outdir,
    absWorkingDir: repo,
    logLevel: "error",
    metafile: true,
    // CommonJS dependencies bundled into ESM still reach for these.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url';" +
        " import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url);" +
        " const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
    },
    plugins: [{
      name: "authz-stubs",
      setup(b) {
        b.onResolve({ filter: stubbed }, () => ({ path: stubs }));
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
  return (file) => import(pathToFileURL(bundled.get(path.resolve(file))).href);
}
