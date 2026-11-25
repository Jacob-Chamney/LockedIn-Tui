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
// The desktop startup budget is measured on the packaged Flutter bundle by the
// desktop workflow, not here: the core is a sidecar with no first frame of its
// own. `scripts/desktop-check.sh` is the frontend gate.
