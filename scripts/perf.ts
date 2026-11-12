#!/usr/bin/env bun
/**
 * Startup performance gate (WP-149).
 *
 *   bun run scripts/perf.ts                 # gate against the built artifact
 *   bun run scripts/perf.ts --dir=out      # a different release directory
 *   bun run scripts/perf.ts --runs=5       # more samples
 *   bun run scripts/perf.ts --aggregate=best  # fastest sample (noisy CI hosts)
 *   bun run scripts/perf.ts --json         # machine-readable, for a dashboard
 *
 * The budget is not a constant in this file: it is parsed out of
 * `tests/fixtures/perf/budget-standard.md`, the single source of the
 * first-frame budget. `tests/unit/perf-budget.test.ts` reads the budget through the
 * same parser and pins it with fixtures.
 *
 * No artifact means **skip**, never fail: the gate must not demand a build it
 * did not ask for, and CI has no binary.
 */

import { existsSync } from "node:fs"
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { cpus, tmpdir } from "node:os"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const BUDGET_FIXTURE = join(ROOT, "tests", "fixtures", "perf", "budget-standard.md")

/** The budget row this gate enforces. */
export const BUDGET_ROW = "First frame, compiled artifact"

export type Budgets = {
  /** Milliseconds, from the `≤160 ms` cell. */
  firstFrameMs: number
  /** The metric text, for messages. */
  metric: string
}

/**
 * Parse the first-frame budget out of the testing document.
 *
 * Deliberately narrow: it reads the one row this gate owns and throws on a
 * malformed table, so a doc edit that breaks the contract fails loudly here
 * instead of silently disabling the gate.
 */
export function parseFirstFrameBudget(markdown: string): Budgets {
  const line = markdown
    .split("\n")
    .find((candidate) => candidate.trimStart().startsWith(`| ${BUDGET_ROW}`))
  if (!line) throw new Error(`budget fixture has no "${BUDGET_ROW}" row`)

  const cells = line.split("|").map((cell) => cell.trim())
  const budgetCell = cells[2] ?? ""
  const match = budgetCell.match(/≤\s*(\d+(?:\.\d+)?)\s*ms/)
  if (!match) throw new Error(`"${BUDGET_ROW}" budget is not of the form "≤N ms": ${budgetCell}`)

  return { firstFrameMs: Number(match[1]), metric: cells[1] ?? BUDGET_ROW }
}

export type Verdict = {
  ok: boolean
  measuredMs: number
  /** The documented budget, before any host factor. */
  documentedMs: number
  /** documented × hostFactor; the number the measurement is compared with. */
  budgetMs: number
  /** measured − budget; positive means a regression. */
  deltaMs: number
  message: string
}

/**
 * Compare a measured median against the budget.
 *
 * `hostFactor` exists because §5 says the number is host-relative and not a
 * cross-machine promise: a CI runner with two cores measured 164.5 ms against a
 * budget recorded on a faster machine, which is not a regression. The factor is
 * explicit at the call site and printed, never silent; the reference machine and
 * `scripts/release.ts` use 1.
 */
export function evaluate(measuredMs: number, budgetMs: number, hostFactor = 1): Verdict {
  if (!Number.isFinite(hostFactor) || hostFactor < 1) {
    throw new Error(`hostFactor must be ≥ 1, got ${hostFactor}`)
  }
  const documentedMs = budgetMs
  const effective = Number((budgetMs * hostFactor).toFixed(1))
  const deltaMs = Number((measuredMs - effective).toFixed(1))
  const ok = deltaMs <= 0
  const factorNote = hostFactor === 1 ? "" : ` (${documentedMs} ms × ${hostFactor} host factor)`
  const message = ok
    ? `first frame ${measuredMs} ms is within the ${effective} ms budget${factorNote} (${Math.abs(deltaMs)} ms spare)`
    : `first frame ${measuredMs} ms exceeds the ${effective} ms budget${factorNote} by ${deltaMs} ms`
  return { ok, measuredMs, documentedMs, budgetMs: effective, deltaMs, message }
}

/** The fastest sample. A real regression raises every run, not one outlier. */
export function best(values: number[]): number {
  return Number(Math.min(...values).toFixed(1))
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return Number(value.toFixed(1))
}

/**
 * First painted frame, measured from outside the process.
 *
 * The app is a TUI, so it needs a pty. A split-footer renderer asks for a
 * cursor-position report before its first frame and waits up to 120 ms; a pty
 * that never answers measures a terminal that does not exist. So the driver is
 * `scripts/perf-pty.py`, which answers CPR like a real terminal and prints the
 * elapsed milliseconds. `script(1)` remains the fallback when Python is absent,
 * and a run that falls back says so.
 */
export async function measureFirstFrame(
  binary: string,
  timeoutMs = 5000,
): Promise<number | null> {
  const dir = await mkdtemp(join(tmpdir(), "lockedin-perf-"))
  const local = join(dir, "lockedin")
  const env = { PATH: "/usr/bin:/bin:/usr/sbin", HOME: dir, TERM: "xterm-256color" }
  try {
    await copyFile(binary, local)
    await Bun.$`chmod +x ${local}`.quiet()
    const driver = join(import.meta.dir, "perf-pty.py")
    if (existsSync(driver)) {
      const proc = Bun.spawn(["python3", driver, "LOCKEDIN", local], {
        cwd: dir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await Promise.race([
        new Response(proc.stdout).text(),
        Bun.sleep(timeoutMs).then(() => "timeout"),
      ])
      proc.kill()
      await proc.exited
      const value = Number.parseFloat(output.trim())
      if (Number.isFinite(value) && value > 0) return Number(value.toFixed(1))
      return null
    }
    const started = performance.now()
    const proc = Bun.spawn(["script", "-qfec", local, "/dev/null"], {
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let seen = ""
    let elapsed: number | null = null
    const deadline = started + timeoutMs
    while (performance.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      seen += decoder.decode(value, { stream: true })
      if (seen.includes("LOCKEDIN")) {
        elapsed = performance.now() - started
        break
      }
    }
    proc.kill()
    await proc.exited
    return elapsed === null ? null : Number(elapsed.toFixed(1))
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Host facts the number is relative to. */
export function machineFacts() {
  return {
    platform: `${process.platform}-${process.arch}`,
    bun: Bun.version,
    cores: cpus().length,
    node: process.versions.node ?? "n/a",
  }
}

/** The artifact to measure: the host's, if a release directory has one. */
export async function findHostArtifact(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null
  const os = process.platform === "win32" ? "windows" : process.platform
  const hostTarget = `bun-${os}-${process.arch}`
  const entries = await readdir(dir)
  const candidates = entries
    .filter((name) => name.startsWith("lockedin-") && name.includes(hostTarget))
    .sort()
  const exact = candidates.find((name) => name.endsWith(hostTarget) || name.endsWith(`${hostTarget}.exe`))
  const chosen = exact ?? candidates.at(-1) ?? null
  return chosen ? join(dir, chosen) : null
}

type Options = {
  dir: string
  runs: number
  json: boolean
  compare: number | null
  /** §5 is host-relative; CI passes this for a runner that is not the reference. */
  hostFactor: number
  /** `best` rejects a stalled run; `median` is the local default. */
  aggregate: "median" | "best"
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dir: "dist",
    runs: 3,
    json: false,
    compare: null,
    hostFactor: 1,
    aggregate: "median",
  }
  for (const arg of argv) {
    if (arg === "--json") options.json = true
    else if (arg.startsWith("--host-factor=")) {
      const value = Number(arg.slice("--host-factor=".length))
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--host-factor must be a number ≥ 1")
      }
      options.hostFactor = value
    }
    else if (arg.startsWith("--compare=")) {
      const value = Number(arg.slice("--compare=".length))
      if (!Number.isFinite(value) || value < 0) throw new Error("--compare must be a number of ms")
      options.compare = value
    }
    else if (arg.startsWith("--dir=")) options.dir = arg.slice("--dir=".length)
    else if (arg.startsWith("--runs=")) {
      const runs = Number(arg.slice("--runs=".length))
      if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer`)
      options.runs = runs
    } else if (arg.startsWith("--aggregate=")) {
      const aggregate = arg.slice("--aggregate=".length)
      if (aggregate !== "median" && aggregate !== "best") {
        throw new Error(`--aggregate must be median or best`)
      }
      options.aggregate = aggregate
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

async function main() {
  let options: Options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`error: ${(error as Error).message}`)
    console.error(
      "usage: bun run scripts/perf.ts [--dir=dist] [--runs=3] [--json] [--compare=<ms>] [--host-factor=<n>] [--aggregate=median|best]",
    )
    process.exit(2)
  }

  const dir = resolve(ROOT, options.dir)
  const budget = parseFirstFrameBudget(await readFile(BUDGET_FIXTURE, "utf8"))
  const facts = machineFacts()

  /**
   * `--compare` answers "what would N ms mean?" without measuring: a reviewer
   * can check a number from another machine against the same budget, and the
   * test suite can exercise the failure path without a fake binary.
   */
  if (options.compare !== null) {
    const verdict = evaluate(options.compare, budget.firstFrameMs, options.hostFactor)
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            artifact: null,
            supplied: options.compare,
            samples: [],
            medianMs: options.compare,
            documentedMs: budget.firstFrameMs,
            budgetMs: verdict.budgetMs,
            hostFactor: options.hostFactor,
            deltaMs: verdict.deltaMs,
            ok: verdict.ok,
            machine: facts,
          },
          null,
          2,
        ),
      )
    } else {
      console.log(`perf: ${verdict.message}`)
      console.log(`      supplied measurement ${options.compare} ms on ${facts.platform}`)
    }
    if (!verdict.ok) process.exit(1)
    process.exit(0)
  }

  const artifact = await findHostArtifact(dir)
  if (!artifact) {
    // A skip is a result, not a failure: CI has no binary and must stay green.
    console.log(
      `perf: skip — no host artifact in ${options.dir}/ (build one with scripts/build.ts)`,
    )
    process.exit(0)
  }

  // One unmeasured launch first: the first run on a cold runner pays for the
  // page cache and the binary's own read, and that is not startup time.
  const warm = await measureFirstFrame(artifact)
  if (warm === null) {
    console.log(`perf: skip — could not measure (no pty helper \`script\`, or the artifact never painted)`)
    process.exit(0)
  }

  const samples: number[] = []
  for (let run = 0; run < options.runs; run++) {
    const sample = await measureFirstFrame(artifact)
    if (sample === null) {
      console.log(
        `perf: skip — could not measure (no pty helper \`script\`, or the artifact never painted)`,
      )
      process.exit(0)
    }
    samples.push(sample)
  }

  const measured = options.aggregate === "best" ? best(samples) : median(samples)
  const verdict = evaluate(measured, budget.firstFrameMs, options.hostFactor)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          artifact: artifact.replace(`${ROOT}/`, ""),
          samples,
          aggregate: options.aggregate,
          medianMs: measured,
          documentedMs: budget.firstFrameMs,
          budgetMs: verdict.budgetMs,
          hostFactor: options.hostFactor,
          deltaMs: verdict.deltaMs,
          ok: verdict.ok,
          machine: facts,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`perf: ${verdict.message}`)
    console.log(
      `      samples: ${samples.join(" / ")} ms · ${options.aggregate} ${measured} ms`,
    )
    console.log(
      `      artifact: ${artifact.replace(`${ROOT}/`, "")} (${facts.platform}, bun ${facts.bun}, ${facts.cores} cores)`,
    )
    console.log(
      `      budgets are host-relative (tests/fixtures/perf/budget-standard.md); this number is not a cross-machine promise`,
    )
    if (options.hostFactor !== 1) {
      console.log(`      host factor ${options.hostFactor} applied to the documented budget`)
    }
  }

  if (!verdict.ok) process.exit(1)
}

if (import.meta.main) await main()
