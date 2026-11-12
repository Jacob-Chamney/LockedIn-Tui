/**
 * Usage retention (WP-153).
 *
 * `usage.json` gains a run per turn, so it is trimmed to the longest stats
 * window. The safety rules matter more than the trimming: a clock jump must not
 * reset the budget and must not erase history.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  RETENTION_DAYS,
  USAGE_FILE,
  createUsageStore,
  retentionCutoff,
  retainRuns,
  spentFor,
  type StoredRunRecord,
} from "../../src/llm/usage"
import { readUsage } from "../../src/stats/read"
import { aggregate } from "../../src/stats/summary"

const ROOT = join(import.meta.dir, "..", "..")
const fixture = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "usage-retention", "runs.json"), "utf8")) as {
  runs: {
    daysAgo: number
    model: string
    input: number
    output: number
    costMicroUsd: number | null
    failed: boolean
    scope: "school" | "skills" | "work"
  }[]
}

/** 1 Nov 2026, 15:00 local. */
const NOW = new Date(2026, 10, 1, 15, 0, 0)

function at(daysAgo: number, base = NOW): string {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString()
}

function materialize(base = NOW): StoredRunRecord[] {
  return fixture.runs.map((row) => ({
    model: row.model,
    input: row.input,
    output: row.output,
    costMicroUsd: row.costMicroUsd,
    at: at(row.daysAgo, base),
    failed: row.failed,
    scope: row.scope,
  }))
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "usage-retention-"))
}

describe("retention window", () => {
  test("the cap is one constant with a stated reason", () => {
    expect(RETENTION_DAYS).toBe(90)
    expect(retentionCutoff(NOW)).toEqual(new Date(2026, 7, 4, 0, 0, 0, 0))
  })

  test("a run older than 90 days is dropped; a run at 89 days is kept", () => {
    const { runs, report } = retainRuns(materialize(), NOW)
    const daysAgo = runs.map((run) => Math.round((NOW.getTime() - new Date(run.at).getTime()) / 86_400_000))

    expect(report.dropped).toBe(1)
    expect(report.refused).toBe(false)
    expect(daysAgo).not.toContain(91)
    expect(daysAgo).toContain(89)
    // Failed and unpriced runs are retained like any other.
    expect(runs.some((run) => run.failed)).toBe(true)
    expect(runs.some((run) => run.costMicroUsd === null)).toBe(true)
  })

  test("trimming is deterministic: two passes give identical runs", () => {
    const first = retainRuns(materialize(), NOW)
    const second = retainRuns(first.runs, NOW)
    expect(JSON.stringify(second.runs)).toBe(JSON.stringify(first.runs))
    expect(second.report.dropped).toBe(0)
  })
})

describe("retention safety", () => {
  test("every run inside the current budget period is kept", () => {
    const monthStart: StoredRunRecord = {
      model: "m",
      input: 10,
      output: 5,
      costMicroUsd: 20,
      at: new Date(NOW.getFullYear(), NOW.getMonth(), 1, 0, 0, 0, 0).toISOString(),
      failed: false,
      scope: "work",
    }
    const justNow: StoredRunRecord = { ...monthStart, at: new Date(NOW.getTime() - 3_600_000).toISOString() }
    const ancient: StoredRunRecord = { ...monthStart, at: at(400) }

    const { runs } = retainRuns([ancient, monthStart, justNow], NOW)
    // monthStart is 60 days old here but still inside the period; ancient is not.
    expect(runs.map((run) => run.at)).toEqual([monthStart.at, justNow.at])
  })

  test("a forward clock jump is refused instead of erasing the history", () => {
    const runs = materialize()
    // The clock jumps ten years forward: every live run now looks ancient.
    const jumped = new Date(2036, 10, 1, 15, 0, 0)
    const { runs: kept, report } = retainRuns(runs, jumped)

    expect(report.refused).toBe(true)
    expect(report.diagnostic).toContain("Nothing was removed")
    expect(kept).toHaveLength(runs.length)
  })

  test("a single old run inside the current month is kept even if the window says otherwise", () => {
    // Clock moved forward two years: the run is 400 days old but the month
    // floor is the clock's own month, so the run predates it and is dropped…
    const forward = new Date(2028, 10, 1, 15, 0, 0)
    const run: StoredRunRecord = {
      model: "m",
      input: 1,
      output: 1,
      costMicroUsd: 10,
      at: new Date(2028, 10, 1, 9, 0, 0).toISOString(), // same month, same day
      failed: false,
      scope: "school",
    }
    const old: StoredRunRecord = { ...run, at: at(400, forward) }
    const { runs } = retainRuns([old, run], forward)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.at).toBe(run.at)
  })

  test("a trim that would drop more than half is refused with a diagnostic and no write", async () => {
    const dir = tempDir()
    writeFileSync(join(dir, USAGE_FILE), JSON.stringify({ schema: 1, runs: materialize() }))
    const before = readFileSync(join(dir, USAGE_FILE))

    const store = createUsageStore({ dir, now: () => NOW })
    const report = await store.compact(new Date(2030, 0, 1, 12, 0, 0))

    expect(report.refused).toBe(true)
    expect(report.diagnostic).toContain("clock problem")
    expect(readFileSync(join(dir, USAGE_FILE)).equals(before)).toBe(true)
  })

  test("a normal compact rewrites once and the file still reloads", async () => {
    const dir = tempDir()
    writeFileSync(join(dir, USAGE_FILE), JSON.stringify({ schema: 1, runs: materialize() }))
    const store = createUsageStore({ dir, now: () => NOW })

    const report = await store.compact(NOW)
    expect(report).toMatchObject({ dropped: 1, refused: false })

    const reloaded = await readUsage(dir)
    expect(reloaded.diagnostic).toBeNull()
    expect(reloaded.value).toHaveLength(4)
    expect(readFileSync(join(dir, USAGE_FILE), "utf8")).toContain('"schema": 1')
  })

  test("append trims in the same atomic rewrite, never leaving a partial file", async () => {
    const dir = tempDir()
    writeFileSync(join(dir, USAGE_FILE), JSON.stringify({ schema: 1, runs: materialize() }))
    const store = createUsageStore({ dir, now: () => NOW })

    await store.append({
      model: "openai/gpt-4.1-mini",
      input: 1,
      output: 1,
      costMicroUsd: 2,
      at: nowIso(NOW),
      failed: false,
      scope: "work",
    })

    const runs = JSON.parse(readFileSync(join(dir, USAGE_FILE), "utf8")).runs as StoredRunRecord[]
    // The 91-day run is gone and the new run is present.
    expect(runs).toHaveLength(5)
    expect(runs.some((run) => run.input === 900 && run.output === 900)).toBe(false)
    // Temp files are not left behind.
    expect(readdirSafe(dir)).toEqual([USAGE_FILE])
  })
})

describe("retention vs the windows it must not disturb", () => {
  test("stats totals are unchanged for 7d/30d/90d after a trim", async () => {
    const before = materialize()
    const after = retainRuns(before, NOW).runs

    for (const range of ["7d", "30d", "90d"] as const) {
      const a = aggregate(before, [], { range, scope: "all", now: NOW })
      const b = aggregate(after, [], { range, scope: "all", now: NOW })
      expect({ range, runs: b.overview.runs, input: b.overview.input }).toEqual({
        range,
        runs: a.overview.runs,
        input: a.overview.input,
      })
      expect(b.learning).toEqual(a.learning)
    }

    // The budget seed for the current day is untouched too.
    expect(spentFor(after, "day", NOW)).toEqual(spentFor(before, "day", NOW))
  })

  test("only the runs outside every window are gone", async () => {
    const after = retainRuns(materialize(), NOW).runs
    const all = aggregate(materialize(), [], { range: "all", scope: "all", now: NOW })
    const kept = aggregate(after, [], { range: "all", scope: "all", now: NOW })
    expect(all.overview.runs - kept.overview.runs).toBe(1)
  })
})

function nowIso(now: Date): string {
  return now.toISOString()
}

function readdirSafe(dir: string): string[] {
  return require("node:fs").readdirSync(dir) as string[]
}
