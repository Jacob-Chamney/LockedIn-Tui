/**
 * Usage accounting (WP-203).
 *
 * Every file lives in a temp directory that stands in for the app data dir.
 * The test also proves nothing is ever written inside the workspace.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ChatEvent } from "../../src/llm/events"
import {
  USAGE_FILE,
  USAGE_SCHEMA,
  createUsageStore,
  runRecord,
  sumUsageEvents,
} from "../../src/llm/usage"

const usage = (input: number, output: number): ChatEvent => ({
  type: "usage",
  tokens: { input, output, total: input + output },
})

function dirs() {
  const dataDir = mkdtempSync(join(tmpdir(), "usage-data-"))
  const workspace = mkdtempSync(join(tmpdir(), "usage-ws-"))
  return { dataDir, workspace }
}

describe("usage append serialisation", () => {
  test("concurrent turns keep every run", async () => {
    const { dataDir } = dirs()
    const store = createUsageStore({ dir: dataDir })
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.append(
          runRecord({
            model: "openai/gpt-4.1-mini",
            usage: { input: index, output: 1, total: index + 1 },
            costMicroUsd: 1,
            scope: "school",
            failed: false,
            at: new Date(2026, 10, 1, 12, 0, index),
          }),
        ),
      ),
    )
    expect((await store.load()).runs).toHaveLength(12)
  })
})

describe("usage", () => {
  test("sums tool-loop steps for one answer (S5: 29 then 36)", () => {
    const events: ChatEvent[] = [
      { type: "text", delta: "Checking." },
      usage(20, 9),
      { type: "text", delta: "The answer." },
      usage(30, 6),
      { type: "done", text: "Checking.The answer.", usage: { input: 50, output: 15, total: 65 }, durationMs: 10, steps: [] },
    ]
    expect(sumUsageEvents(events)).toEqual({ input: 50, output: 15, total: 65 })
  })

  test("a run is persisted with schema, and the file is replaced atomically", async () => {
    const { dataDir, workspace } = dirs()
    const store = createUsageStore({ dir: dataDir })

    await store.append(runRecord({ model: "openai/gpt-4.1-mini", usage: { input: 1000, output: 500, total: 1500 }, costMicroUsd: 1200, scope: "school" }))

    const file = JSON.parse(readFileSync(join(dataDir, USAGE_FILE), "utf8"))
    expect(file.schema).toBe(USAGE_SCHEMA)
    expect(file.runs).toHaveLength(1)
    expect(file.runs[0]).toMatchObject({ model: "openai/gpt-4.1-mini", input: 1000, output: 500, costMicroUsd: 1200, failed: false })

    await store.append(runRecord({ model: "openai/gpt-4.1-mini", usage: { input: 10, output: 5, total: 15 }, costMicroUsd: 12, scope: "school" }))
    const after = JSON.parse(readFileSync(join(dataDir, USAGE_FILE), "utf8"))
    expect(after.runs).toHaveLength(2)

    // Atomic replace leaves no temp files behind.
    expect(readdirSync(dataDir)).toEqual([USAGE_FILE])
    // Never inside the workspace tree.
    expect(readdirSync(workspace)).toEqual([])
  })

  test("a failed run is recorded and visible in the totals", async () => {
    const { dataDir } = dirs()
    const store = createUsageStore({ dir: dataDir })
    await store.append(runRecord({ model: "openai/gpt-4.1-mini", usage: { input: 0, output: 0, total: 0 }, costMicroUsd: 0, scope: "school" }))
    await store.append(
      runRecord({ model: "openai/gpt-4.1-mini", usage: { input: 120, output: 0, total: 120 }, costMicroUsd: 48, failed: true, scope: "school" }),
    )

    const totals = await store.totals()
    expect(totals.runs).toBe(2)
    expect(totals.failed).toBe(1)
    expect(totals.input).toBe(120)
    expect(totals.costMicroUsd).toBe(48)
  })

  test("an unknown price makes the period total unknown, never zero", async () => {
    const { dataDir } = dirs()
    const store = createUsageStore({ dir: dataDir })
    await store.append(runRecord({ model: "x/unknown", usage: { input: 10, output: 10, total: 20 }, costMicroUsd: null, scope: "skills" }))
    await store.append(runRecord({ model: "openai/gpt-4.1-mini", usage: { input: 10, output: 10, total: 20 }, costMicroUsd: 20, scope: "work" }))
    expect((await store.totals()).costMicroUsd).toBeNull()
  })

  test("a corrupt file resets with a diagnostic and the next write still works", async () => {
    const { dataDir } = dirs()
    writeFileSync(join(dataDir, USAGE_FILE), "{ this is not json")
    const store = createUsageStore({ dir: dataDir })

    const loaded = await store.load()
    expect(loaded.runs).toEqual([])
    expect(loaded.diagnostic?.code).toBe("corrupt")
    expect(loaded.diagnostic?.next.length ?? 0).toBeGreaterThan(0)

    await store.append(runRecord({ model: "m", usage: { input: 1, output: 1, total: 2 }, costMicroUsd: 2, scope: "work" }))
    expect((await store.load()).runs).toHaveLength(1)
  })

  test("a missing file is an empty history, not a diagnostic", async () => {
    const { dataDir } = dirs()
    const store = createUsageStore({ dir: join(dataDir, "nested") })
    expect(await store.load()).toEqual({ runs: [], diagnostic: null })
    expect((await store.totals()).runs).toBe(0)
  })

  test("totals filter from a period start without losing older runs", async () => {
    const { dataDir } = dirs()
    const store = createUsageStore({ dir: dataDir })
    const yesterday = new Date(2026, 10, 1, 23, 30)
    const today = new Date(2026, 10, 2, 9, 0)

    await store.append(runRecord({ model: "m", usage: { input: 100, output: 0, total: 100 }, costMicroUsd: 100, at: yesterday, scope: "school" }))
    await store.append(runRecord({ model: "m", usage: { input: 10, output: 0, total: 10 }, costMicroUsd: 10, at: today, scope: "school" }))

    const sinceMidnight = new Date(2026, 10, 2, 0, 0, 0, 0)
    expect((await store.totals(sinceMidnight)).input).toBe(10)
    // The older run is still on disk.
    expect((await store.totals()).input).toBe(110)
  })
})
