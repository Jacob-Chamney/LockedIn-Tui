/**
 * Stats aggregation (WP-132).
 *
 * Counters are fixture files copied into a temp "data directory". The clock is
 * fixed and boundaries are built with local `Date` constructors, so the test is
 * timezone-safe: it asserts "local midnight", exactly as the requirement words
 * it.
 */
import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { aggregate, createStatsService, rangeStart, toCsv, toMarkdown } from "../../src/stats/summary"
import { readLearning, readUsage } from "../../src/stats/read"
import type { LearningEvent, UsageRun } from "../../src/stats/types"

const ROOT = join(import.meta.dir, "..", "..")
const FIXTURES = join(ROOT, "tests", "fixtures", "stats")

/** Fixed local clock: 1 Nov 2026, 13:00 local. */
const NOW = new Date(2026, 10, 1, 13, 0, 0)

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "stats-"))
  copyFileSync(join(FIXTURES, "usage.json"), join(dir, "usage.json"))
  copyFileSync(join(FIXTURES, "events.json"), join(dir, "stats.json"))
  return dir
}

const service = (dir: string) => createStatsService({ dir, now: () => NOW })

describe("stats ranges", () => {
  test("rangeStart is local midnight and includes today", () => {
    expect(rangeStart("7d", NOW)).toEqual(new Date(2026, 9, 26, 0, 0, 0, 0))
    expect(rangeStart("30d", NOW)).toEqual(new Date(2026, 9, 3, 0, 0, 0, 0))
    expect(rangeStart("90d", NOW)).toEqual(new Date(2026, 7, 4, 0, 0, 0, 0))
    expect(rangeStart("all", NOW)).toBeNull()
  })

  test("a run at the boundary is included, the instant before is not", () => {
    const start = rangeStart("7d", NOW)!
    const runs: UsageRun[] = [
      { model: "m", input: 1, output: 0, costMicroUsd: 1, at: start.toISOString(), failed: false },
      {
        model: "m",
        input: 100,
        output: 0,
        costMicroUsd: 100,
        at: new Date(start.getTime() - 1).toISOString(),
        failed: false,
      },
    ]
    const summary = aggregate(runs, [], { range: "7d", scope: "all", now: NOW })
    expect(summary.overview.runs).toBe(1)
    expect(summary.overview.input).toBe(1)
  })
})

describe("stats summary", () => {
  test("fixture counters produce exact expected sums", async () => {
    const dir = dataDir()
    const all = await service(dir).summary("30d", "all")

    expect(all.overview).toEqual({ runs: 4, failed: 1, input: 3110, output: 1560 })
    // One run has no price, so the view's cost is genuinely unknown.
    expect(all.costMicroUsd).toBeNull()
    expect(all.costLabel).toBe("cost unknown")

    const school = await service(dir).summary("30d", "school")
    expect(school.overview).toEqual({ runs: 2, failed: 0, input: 3000, output: 1500 })
    expect(school.costMicroUsd).toBe(3600)
    expect(school.costLabel).toBe("$0.0036")

    const skills = await service(dir).summary("30d", "skills")
    // A failed call still counts, with the tokens it spent.
    expect(skills.overview).toEqual({ runs: 1, failed: 1, input: 100, output: 50 })
    expect(skills.costMicroUsd).toBe(1050)

    const work = await service(dir).summary("30d", "work")
    expect(work.costLabel).toBe("cost unknown")
  })

  test("bounds exclude older runs without deleting them", async () => {
    const dir = dataDir()
    const events = await readLearning(dir)
    const sep = events.value.filter((e) => e.at.startsWith("2026-09")).length
    expect(sep).toBe(1)

    const d30 = await service(dir).summary("30d", "all")
    const d90 = await service(dir).summary("90d", "all")
    const all = await service(dir).summary("all", "all")

    expect(d30.learning.steps).toBe(2)
    expect(d90.learning.steps).toBe(3) // the September event is inside 90 days
    expect(all.learning.steps).toBe(3)
    // Older runs stay on disk: "all" sees more runs than 30d.
    expect(all.overview.runs).toBeGreaterThanOrEqual(d30.overview.runs)
  })

  test("daily activity, streak and period come from the same scoped runs", async () => {
    const dir = dataDir()
    const all = await service(dir).summary("all", "all")
    expect(all.activity).toHaveLength(2)
    expect(all.activeDays).toBe(2)
    expect(all.bestStreak).toBe(2)
    expect(all.period.to).toBe("2026-11-01")
    expect(all.activity.reduce((sum, day) => sum + day.tokens, 0)).toBe(all.overview.input + all.overview.output)
  })

  test("model and tool totals are grouped and sorted", async () => {
    const dir = dataDir()
    const summary = await service(dir).summary("30d", "all")

    const openai = summary.models.find((m) => m.model === "openai/gpt-4.1-mini")
    expect(openai).toMatchObject({ runs: 2, input: 3000, output: 1500, costMicroUsd: 3600 })

    expect(summary.tools).toEqual([
      { name: "read_note", calls: 2 },
      { name: "search_files", calls: 1 },
    ])
    expect(summary.learning).toEqual({ steps: 2, cardsKnown: 1, cardsMissed: 1, lessons: 1 })
  })

  test("an unknown model inside a scope makes that model's cost unknown, not zero", async () => {
    const dir = dataDir()
    const work = await service(dir).summary("30d", "work")
    expect(work.models[0]!.costMicroUsd).toBeNull()
  })

  test("scope never mixes another side's counters", async () => {
    const dir = dataDir()
    const school = await service(dir).summary("all", "school")
    expect(school.models.map((m) => m.model)).not.toContain("anthropic/claude-sonnet-4-5")
    expect(school.learning.lessons).toBe(0)

    const skills = await service(dir).summary("all", "skills")
    expect(skills.learning.lessons).toBe(1)
    expect(skills.tools).toEqual([])
  })
})

describe("stats resilience", () => {
  test("a corrupt counter file returns an empty summary with a diagnostic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stats-bad-"))
    writeFileSync(join(dir, "usage.json"), "{ not json")
    writeFileSync(join(dir, "stats.json"), "also not json")

    const summary = await service(dir).summary("7d", "all")
    expect(summary.overview.runs).toBe(0)
    expect(summary.costMicroUsd).toBe(0)
    expect(summary.diagnostic).toContain("usage.json")
  })

  test("a missing file is an empty history, not a diagnostic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stats-empty-"))
    const summary = await service(dir).summary("7d", "all")
    expect(summary.overview.runs).toBe(0)
    expect(summary.diagnostic).toBeNull()
    expect((await readUsage(dir)).diagnostic).toBeNull()
  })
})

describe("stats export", () => {
  test("markdown and csv match the view", async () => {
    const dir = dataDir()
    const stats = service(dir)
    const summary = await stats.summary("30d", "school")

    const md = await stats.export("30d", "school", "md")
    expect(md).toContain("# Stats — 30d · school")
    expect(md).toContain("| openai/gpt-4.1-mini | 2 | 3000 | 1500 | $0.0036 |")
    expect(md).toContain("cost: $0.0036")
    expect(md).toContain("read_note")

    const csv = await stats.export("30d", "school", "csv")
    const lines = csv.trim().split("\n")
    expect(lines[0]).toBe("section,model,runs,input,output,cost_micro_usd,cost_label")
    expect(lines.some((line) => line.startsWith("model,openai/gpt-4.1-mini,2,3000,1500,3600,"))).toBe(true)
    expect(lines.at(-2)).toContain("total,all,2,3000,1500,3600")
    expect(lines.at(-1)).toContain("learning,steps,2")

    // The export is a string; nothing was written.
    expect(toMarkdown(summary)).toContain("cost: $0.0036")
    expect(toCsv(summary)).toContain("total,all,2,3000,1500,3600")
  })

  test("an unknown price exports 'cost unknown', never $0.0000", async () => {
    const dir = dataDir()
    const csv = await service(dir).export("30d", "work", "csv")
    expect(csv).toContain("cost unknown")
    expect(csv).not.toContain("$0.0000")
  })
})

describe("stats boundaries", () => {
  test("stats code reads only the data directory and never the workspace", () => {
    for (const file of ["types.ts", "read.ts", "summary.ts"]) {
      const raw = readFileSync(join(ROOT, "src", "stats", file), "utf8")
      // Comments are allowed to say "workspace"; only code is scanned.
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      expect({ file, code: /workspace|vault|notes\//.test(source) }).toEqual({ file, code: false })
      expect(source).not.toMatch(/fetch\(|node:http|node:https/)
    }
  })

  test("learning events are validated on read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stats-events-"))
    writeFileSync(
      join(dir, "stats.json"),
      JSON.stringify({
        schema: 1,
        events: [
          { kind: "step-toggled", at: "2026-11-01T09:00:00.000Z", scope: "school" },
          { kind: "not-a-kind", at: "2026-11-01T09:00:00.000Z", scope: "school" },
          { kind: "card-known", at: "2026-11-01T09:00:00.000Z", scope: "school" },
        ],
      }),
    )
    const events: LearningEvent[] = (await readLearning(dir)).value
    expect(events).toHaveLength(2)
  })
})
