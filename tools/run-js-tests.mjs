#!/usr/bin/env node
/**
 * Runs every JavaScript specification in the Maven build.
 *
 * The logic that decides a race is JavaScript, because that is where it runs. Its specs
 * therefore have to run in `mvn test` or they rot. Each spec module exports one `run`
 * that takes a `check(description, ok)` callback, so the same file drives this runner
 * and its browser page without either copying the other.
 *
 * Exits non-zero on any failure.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const www = join(here, '..', 'client', 'www');

const SPECS = [
  'crossing-test.js',
  'geo-test.js',
  'coursedraw-test.js',
  'boatsim-test.js',
  'raceclient-test.js',
  'markscreen-test.js',
];

let total = 0;
let failed = 0;

for (const spec of SPECS) {
  const module = await import(join(www, spec));
  const failures = [];
  let passed = 0;
  const check = (description, ok) => {
    total += 1;
    if (ok) passed += 1;
    else failures.push(description);
  };
  // Every exported run* is a suite, so adding one to a spec file needs no change here.
  for (const [name, fn] of Object.entries(module)) {
    if (name === 'run' || name.startsWith('run')) fn(check);
  }
  for (const failure of failures) console.error(`FAIL  ${spec}: ${failure}`);
  failed += failures.length;
  console.log(`${spec.padEnd(20)} ${passed} passed${failures.length ? `, ${failures.length} FAILED` : ''}`);
}

console.log(`${total} assertions, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
