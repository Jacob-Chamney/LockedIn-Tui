#!/usr/bin/env bun
/**
 * The one gate every other check depends on: format-free, deterministic,
 * offline — and the same command on Linux, macOS and Windows.
 *
 * `scripts/check.sh` is a thin POSIX wrapper for people who type it out of
 * habit; CI and `bun run check` call this file directly.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
/** `--ci` applies the documented host tolerance used by the release gate. */
const CI = process.argv.includes("--ci")

function run(label: string, args: string[]): void {
  console.log(`== ${label}`)
  const result = Bun.spawnSync({
    cmd: [process.execPath, ...args],
    cwd: ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1)
}

if (!existsSync(join(ROOT, "bun.lock"))) {
  console.error("bun.lock is missing; commit it before merging")
  process.exit(1)
}

run("bounds", ["run", "scripts/check-bounds.ts"])
run("typecheck", ["run", "typecheck"])
// The `test` script is the single source of truth for the runner flags, so CI,
// `bun run check` and a contributor's `bun run test` run the identical command.
// It runs every test file in parallel worker processes (docs/testing.md §1.2).
run("tests", ["run", "test"])
// Startup gate. Skips with exit 0 when there is no built artifact, so CI and a
// fresh clone stay green; it only ever fails a regression it could measure.
run("perf", [
  "run",
  "scripts/perf.ts",
  // The same estimator everywhere: nine samples, fastest. A dev machine under
  // load and a two-core CI runner both produce inflated medians, and a real
  // regression raises every sample, so the fastest one is the stable estimate.
  "--runs=9",
  "--aggregate=best",
  ...(CI ? ["--host-factor=1.9"] : []),
])
