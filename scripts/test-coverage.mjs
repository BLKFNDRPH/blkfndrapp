#!/usr/bin/env node
// Measures how much of the TypeScript source the unit suite executes.
//
//   npm run test:coverage
//
// Runs the same suite as `npm test` under Node's built-in coverage
// (--experimental-test-coverage, nothing to install), prints Node's per-file
// table for the modules the tests load, writes coverage/lcov.info for tools
// that read lcov, then adds the two figures Node does not print: coverage of
// every module under src/lib, and of everything under src, counting a module
// no test loads as 0%.
//
// Lines are counted the way Node and c8 count them, every line of the file,
// so the figures compare with `npx c8 --all`. Left out: tests, type-only
// modules (types.ts, database.types.ts, *.d.ts) and the generated bindings
// under src/packages. Nothing fails on a number. This measures and records;
// the Gate 4 target and the measured figures are in
// docs/deliverables/qa-test-plan.md §11.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lcovPath = path.join(root, 'coverage', 'lcov.info');
fs.mkdirSync(path.dirname(lcovPath), { recursive: true });

const run = spawnSync(
  process.execPath,
  [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-include=src/**',
    '--test-coverage-exclude=src/**/*.test.ts',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${lcovPath}`,
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    'src/**/*.test.ts',
  ],
  { cwd: root, stdio: 'inherit' },
);

if (run.status !== 0 || !fs.existsSync(lcovPath)) {
  process.exit(run.status ?? 1);
}

// lcov: one record per file the tests loaded, with found/hit counts for
// lines (LF/LH), functions (FNF/FNH) and branches (BRF/BRH).
const records = new Map();
let current = null;
for (const line of fs.readFileSync(lcovPath, 'utf8').split('\n')) {
  const colon = line.indexOf(':');
  const key = colon === -1 ? line.trim() : line.slice(0, colon);
  const value = colon === -1 ? '' : line.slice(colon + 1).trim();
  if (key === 'SF') {
    current = { LF: 0, LH: 0, FNF: 0, FNH: 0, BRF: 0, BRH: 0 };
    records.set(path.resolve(root, value), current);
  } else if (current && Object.hasOwn(current, key)) {
    current[key] = Number(value);
  } else if (key === 'end_of_record') {
    current = null;
  }
}

const isTypeOnly = (file) =>
  file.endsWith('.d.ts') ||
  path.basename(file) === 'types.ts' ||
  file.endsWith('database.types.ts');

function* sourceFiles(dir, skip) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (skip.has(file)) continue;
    if (entry.isDirectory()) yield* sourceFiles(file, skip);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && !isTypeOnly(file)) yield file;
  }
}

const countLines = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
const pct = (hit, found) => `${found ? ((100 * hit) / found).toFixed(2) : '0.00'}%`;
const rel = (file) => path.relative(root, file).split(path.sep).join('/');

function measure(label, files) {
  const all = { LF: 0, LH: 0 };
  const loaded = { files: 0, LF: 0, LH: 0, FNF: 0, FNH: 0, BRF: 0, BRH: 0 };
  const missing = [];
  for (const file of files) {
    const record = records.get(file);
    if (record) {
      loaded.files += 1;
      for (const key of Object.keys(record)) loaded[key] += record[key];
      all.LF += record.LF;
      all.LH += record.LH;
    } else {
      missing.push(file);
      all.LF += countLines(fs.readFileSync(file, 'utf8'));
    }
  }
  console.log(`\n${label}: ${files.length} modules, ${loaded.files} loaded by a test`);
  console.log(`  every module      lines ${pct(all.LH, all.LF)} (${all.LH} of ${all.LF}; a module no test loads counts as 0%)`);
  console.log(
    `  loaded modules    lines ${pct(loaded.LH, loaded.LF)}  branches ${pct(loaded.BRH, loaded.BRF)}  functions ${pct(loaded.FNH, loaded.FNF)}`,
  );
  return missing;
}

const src = path.join(root, 'src');
const lib = path.join(src, 'lib');
const neverLoaded = measure('src/lib', [...sourceFiles(lib, new Set())]);
measure('src (without src/packages)', [...sourceFiles(src, new Set([path.join(src, 'packages')]))]);
console.log(`\nsrc/lib modules no test loads (${neverLoaded.length}):`);
console.log(`  ${neverLoaded.map(rel).join(', ')}`);
console.log(`\nlcov written to ${rel(lcovPath)}`);
