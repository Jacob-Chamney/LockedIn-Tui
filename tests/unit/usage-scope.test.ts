/**
 * Usage records carry their scope (WP-136).
 *
 * The write side (`src/llm/usage.ts`) must record school/skills/work; the read
 * side (`src/stats/read.ts`) must sum each scope and nothing else. Old lines
 * without a scope keep loading, count toward "all" only, and are never
 * rewritten.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  RUN_SCOPES,
  USAGE_FILE,
  createUsageStore,
  isRunScope,
  runRecord,
  type RunRecord,
  type StoredRunRecord,
} from "../../src/llm/usage"
import { readUsage } from "../../src/stats/read"
import { aggregate } from "../../src/stats/summary"

const ROOT = join(import.meta.dir, "..", "..")
const FIXTURES = join(ROOT, "tests", "fixtures", "usage-scope")
const expected = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8"))

const usage = (input: number, output: number) => ({ input, output, total: input + output })

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "usage-scope-"))
}

describe("scope on write", () => {
  test("a school chat writes scope: school and appears in the school total", async () => {
    const dir = tempDir()
    const store = createUsageStore({ dir })
    await store.append(
      runRecord({ model: "openai/gpt-4.1-mini", usage: usage(1000, 500), costMicroUsd: 1200, scope: "school" }),
    )

    const raw = JSON.parse(readFileSync(join(dir, USAGE_FILE), "utf8"))
    expect(raw.runs[0].scope).toBe("school")

    const read = await readUsage(dir)
    expect(read.value[0]!.scope).toBe("school")

    const summary = aggregate(read.value, [], { range: "all", scope: "school", now: new Date() })
    expect(summary.overview.runs).toBe(1)
    expect(summary.costMicroUsd).toBe(expected.scopes.school.costMicroUsd)
    // …and it is absent from the other scopes.
    expect(aggregate(read.value, [], { range: "all", scope: "skills", now: new Date() }).overview.runs).toBe(0)
  })

  test("skills and work scopes are written as given, never inferred", async () => {
    const dir = tempDir()
    const store = createUsageStore({ dir })
    await store.append(runRecord({ model: "anthropic/claude-sonnet-4-5", usage: usage(200, 100), costMicroUsd: 2100, scope: "skills" }))
    await store.append(runRecord({ model: "openai/gpt-4.1-mini", usage: usage(300, 150), costMicroUsd: 360, scope: "work" }))

    const raw = JSON.parse(readFileSync(join(dir, USAGE_FILE), "utf8"))
    expect(raw.runs.map((run: RunRecord) => run.scope)).toEqual(["skills", "work"])
  })

  test("a failed run keeps its scope and its tokens", async () => {
    const dir = tempDir()
    const store = createUsageStore({ dir })
    const failed = runRecord({
      model: "openai/gpt-4.1-mini",
      usage: usage(300, 150),
      costMicroUsd: 360,
      scope: "work",
      failed: true,
    })
    await store.append(failed)

    const raw = JSON.parse(readFileSync(join(dir, USAGE_FILE), "utf8"))
    expect(raw.runs[0]).toMatchObject({ scope: "work", failed: true, input: 300, output: 150 })
  })

  test("only the three real scopes are valid", () => {
    expect(RUN_SCOPES).toEqual(["school", "skills", "work"])
    expect(isRunScope("school")).toBe(true)
    expect(isRunScope("all")).toBe(false)
    expect(isRunScope(undefined)).toBe(false)
    expect(isRunScope("School")).toBe(false)
  })
})

describe("scope on read", () => {
  test("an old line without a scope still loads and counts toward all only", async () => {
    const dir = tempDir()
    const mixed = JSON.parse(readFileSync(join(FIXTURES, "usage-mixed.json"), "utf8")) as { runs: StoredRunRecord[] }
    writeFileSync(join(dir, USAGE_FILE), JSON.stringify(mixed))

    const read = await readUsage(dir)
    expect(read.diagnostic).toBeNull()
    expect(read.value).toHaveLength(4)

    const legacy = read.value.at(-1)!
    expect(legacy.scope).toBeUndefined()

    const all = aggregate(read.value, [], { range: "all", scope: "all", now: new Date() })
    const school = aggregate(read.value, [], { range: "all", scope: "school", now: new Date() })

    // The legacy line is in "all" but in no named scope.
    expect(all.overview.runs).toBe(expected.all.runs)
    expect(all.overview.input).toBe(expected.all.input)
    expect(all.overview.output).toBe(expected.all.output)
    expect(all.costMicroUsd).toBe(expected.all.costMicroUsd)
    expect(school.overview.runs).toBe(expected.scopes.school.runs)
  })

  test("an invalid scope value is ignored, not trusted", async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, USAGE_FILE),
      JSON.stringify({
        schema: 1,
        runs: [
          { model: "m", input: 1, output: 0, costMicroUsd: 1, at: "2026-11-01T09:00:00.000Z", failed: false, scope: "all" },
        ],
      }),
    )
    const read = await readUsage(dir)
    expect(read.value[0]!.scope).toBeUndefined()
  })
})

describe("scope totals", () => {
  test("school + skills + work === all for a window of new runs", async () => {
    const dir = tempDir()
    const store = createUsageStore({ dir })
    await store.append(runRecord({ model: "openai/gpt-4.1-mini", usage: usage(1000, 500), costMicroUsd: 1200, scope: "school" }))
    await store.append(runRecord({ model: "anthropic/claude-sonnet-4-5", usage: usage(200, 100), costMicroUsd: 2100, scope: "skills" }))
    await store.append(
      runRecord({ model: "openai/gpt-4.1-mini", usage: usage(300, 150), costMicroUsd: 360, scope: "work", failed: true }),
    )

    const { value: runs } = await readUsage(dir)
    const now = new Date()
    const school = aggregate(runs, [], { range: "all", scope: "school", now })
    const skills = aggregate(runs, [], { range: "all", scope: "skills", now })
    const work = aggregate(runs, [], { range: "all", scope: "work", now })
    const all = aggregate(runs, [], { range: "all", scope: "all", now })

    expect(school.overview.runs + skills.overview.runs + work.overview.runs).toBe(all.overview.runs)
    expect(school.overview.input + skills.overview.input + work.overview.input).toBe(all.overview.input)
    expect(school.overview.output + skills.overview.output + work.overview.output).toBe(all.overview.output)
    expect(
      (school.costMicroUsd ?? 0) + (skills.costMicroUsd ?? 0) + (work.costMicroUsd ?? 0),
    ).toBe(all.costMicroUsd as number)
  })

  test("a legacy line never leaks into a named scope's total", async () => {
    const dir = tempDir()
    const mixed = JSON.parse(readFileSync(join(FIXTURES, "usage-mixed.json"), "utf8"))
    writeFileSync(join(dir, USAGE_FILE), JSON.stringify(mixed))

    const { value: runs } = await readUsage(dir)
    const now = new Date()
    for (const scope of ["school", "skills", "work"] as const) {
      const scoped = aggregate(runs, [], { range: "all", scope, now })
      const want = expected.scopes[scope]
      expect({ scope, runs: scoped.overview.runs, input: scoped.overview.input }).toEqual({
        scope,
        runs: want.runs,
        input: want.input,
      })
      expect(scoped.costMicroUsd).toBe(want.costMicroUsd)
    }
  })
})

describe("records hold no content", () => {
  test("byte scan: no prompt, note or chat body in any record", async () => {
    const dir = tempDir()
    const store = createUsageStore({ dir })
    await store.append(
      runRecord({
        model: "openai/gpt-4.1-mini",
        usage: usage(10, 5),
        costMicroUsd: 12,
        scope: "school",
        failed: true,
      }),
    )
    const raw = JSON.parse(readFileSync(join(dir, USAGE_FILE), "utf8"))
    const allowed = new Set(["model", "input", "output", "costMicroUsd", "at", "failed", "scope"])
    for (const run of raw.runs as Record<string, unknown>[]) {
      for (const key of Object.keys(run)) expect(allowed.has(key)).toBe(true)
    }
    const text = JSON.stringify(raw)
    for (const forbidden of ["prompt", "content", "body", "messages", "reasoning", "note"]) {
      expect(text.toLowerCase()).not.toContain(forbidden)
    }
  })
})
