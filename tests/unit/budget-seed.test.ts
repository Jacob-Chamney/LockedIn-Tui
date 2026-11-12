/**
 * Budget gate seeding (WP-141).
 *
 * The gate used to count only the current process, so a restart forgot what had
 * already been spent today. These tests seed it from `usage.json` and prove the
 * boundary maths, the unpriced-runs rule and the one-shot override.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBudgetGate } from "../../src/llm/budget"
import { usdToMicroUsd } from "../../src/llm/pricing"
import {
  USAGE_FILE,
  createUsageStore,
  runRecord,
  spentFor,
  spentFromUsage,
  type StoredRunRecord,
} from "../../src/llm/usage"
import { createChatController } from "../../src/app/chat-controller"
import type { ChatEvent } from "../../src/llm/events"
import type { ChatService } from "../../src/llm/chat"

const ROOT = join(import.meta.dir, "..", "..")
const FIXTURES = join(ROOT, "tests", "fixtures", "budget-seed")
const fixture = JSON.parse(readFileSync(join(FIXTURES, "runs.json"), "utf8")) as {
  day: { offsetMs: number; model: string; input: number; output: number; costMicroUsd: number | null; failed: boolean; scope: "school" | "skills" | "work" }[]
  expectedDay: { spentMicroUsd: number; unpriced: number; runs: number }
  month: { offsetMs: number; model: string; input: number; output: number; costMicroUsd: number | null; failed: boolean; scope: "school" | "skills" | "work" }[]
}

/** 1 Nov 2026, 15:00 local — safely inside the day in any timezone. */
const NOW = new Date(2026, 10, 1, 15, 0, 0)
const DAY_START = new Date(2026, 10, 1, 0, 0, 0, 0)
const MONTH_START = new Date(2026, 10, 1, 0, 0, 0, 0)

function materialize(
  rows: { offsetMs: number; model: string; input: number; output: number; costMicroUsd: number | null; failed: boolean; scope: "school" | "skills" | "work" }[],
  base: Date,
): StoredRunRecord[] {
  return rows.map((row) => ({
    model: row.model,
    input: row.input,
    output: row.output,
    costMicroUsd: row.costMicroUsd,
    at: new Date(base.getTime() + row.offsetMs).toISOString(),
    failed: row.failed,
    scope: row.scope,
  }))
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "budget-seed-"))
}

describe("spentFor", () => {
  test("sums the period exactly and excludes the instant before it", () => {
    const runs = materialize(fixture.day, DAY_START)
    const spend = spentFor(runs, "day", NOW)

    expect(spend).toEqual(fixture.expectedDay)
    // The -1 ms run is outside; the 0 ms run is inside.
    expect(spend.spentMicroUsd).toBe(fixture.expectedDay.spentMicroUsd)
  })

  test("a failing run keeps its cost in the seed", () => {
    const runs = materialize(fixture.day, DAY_START)
    const failed = runs.find((run) => run.failed)!
    expect(failed.costMicroUsd).toBe(2100)

    const without = spentFor(runs.filter((run) => !run.failed), "day", NOW)
    expect(without.spentMicroUsd).toBe(fixture.expectedDay.spentMicroUsd - 2100)
  })

  test("an unpriced run counts as zero spend and is reported", () => {
    const runs = materialize(fixture.day, DAY_START)
    const spend = spentFor(runs, "day", NOW)
    expect(spend.unpriced).toBe(1)
    expect(spend.runs).toBe(3)
    expect(spend.spentMicroUsd).toBe(1200 + 2100)
  })

  test("month uses the first local midnight of the month", () => {
    const runs = materialize(fixture.month, DAY_START)
    // 24 h before 1 Nov is still October, so it is outside the month window.
    expect(spentFor(runs, "month", NOW).spentMicroUsd).toBe(0)
    expect(MONTH_START.getDate()).toBe(1)
    // …but inside the day window only if it were after midnight; it is not.
    expect(spentFor(runs, "day", NOW).spentMicroUsd).toBe(0)
  })

  test("a malformed timestamp is ignored rather than counted", () => {
    const runs: StoredRunRecord[] = [
      { model: "m", input: 1, output: 0, costMicroUsd: 500, at: "not-a-date", failed: false },
      { model: "m", input: 1, output: 0, costMicroUsd: 25, at: new Date(DAY_START.getTime() + 1000).toISOString(), failed: false },
    ]
    expect(spentFor(runs, "day", NOW).spentMicroUsd).toBe(25)
  })
})

describe("spentFromUsage", () => {
  test("seeds from a real file with one run per scope", async () => {
    const dir = tempDir()
    const store = createUsageStore({ dir })
    await store.append(runRecord({ model: "a", usage: { input: 1, output: 1, total: 2 }, costMicroUsd: 1200, scope: "school", at: NOW }))
    await store.append(runRecord({ model: "b", usage: { input: 1, output: 1, total: 2 }, costMicroUsd: 2100, scope: "skills", at: NOW, failed: true }))
    await store.append(runRecord({ model: "c", usage: { input: 1, output: 1, total: 2 }, costMicroUsd: null, scope: "work", at: NOW }))

    const seed = await spentFromUsage(dir, "day", NOW)
    expect(seed).toEqual({ spentMicroUsd: 3300, unpriced: 1, runs: 3, diagnostic: null })
  })

  test("a corrupt file yields zero with a diagnostic, never an exception", async () => {
    const dir = tempDir()
    writeFileSync(join(dir, USAGE_FILE), "{ broken")

    const seed = await spentFromUsage(dir, "day", NOW)
    expect(seed.spentMicroUsd).toBe(0)
    expect(seed.unpriced).toBe(0)
    expect(seed.diagnostic).toContain("usage.json")
  })

  test("a missing file is zero with no diagnostic", async () => {
    const seed = await spentFromUsage(tempDir(), "day", NOW)
    expect(seed).toEqual({ spentMicroUsd: 0, unpriced: 0, runs: 0, diagnostic: null })
  })
})

describe("controller seed", () => {
  function controllerAt(spentMicroUsd: number, budgetUsd: number) {
    const requests: unknown[] = []
    const service: ChatService = {
      active: () => [],
      cancel: () => {},
      // Yields one `done` so a permitted send completes deterministically.
      async *send(request): AsyncGenerator<ChatEvent> {
        requests.push(request)
        yield { type: "done", text: "ok", steps: ["ok"], usage: { input: 0, output: 0, total: 0 }, durationMs: 1 }
      },
    }
    const gate = createBudgetGate({
      config: () => ({ budget: budgetUsd, period: "day", warn_at: 0.8, pause_at_limit: true }),
      now: () => NOW,
    })
    const controller = createChatController({
    scope: "school" as const,
      service,
      budget: gate,
      history: { load: async () => [], save: async () => {} },
      config: () => ({ model: "openai/gpt-4.1-mini", maxToolCalls: 4, maxTokens: 100, chillHistoryLimit: 20 }),
      spentMicroUsd,
      now: () => NOW,
    })
    return { controller, requests }
  }

  test("a seeded spend blocks the first send before any request", async () => {
    const limit = usdToMicroUsd(1)
    const { controller, requests } = controllerAt(limit, 1)

    const outcome = await controller.send("hello")
    expect(outcome.kind).toBe("blocked")
    expect(requests).toHaveLength(0)
  })

  test("one override still permits exactly one request", async () => {
    const limit = usdToMicroUsd(1)
    const { controller, requests } = controllerAt(limit, 1)

    controller.override()
    const first = await controller.send("hello")
    expect(first.kind).toBe("sent")
    expect(requests).toHaveLength(1)

    const second = await controller.send("again")
    expect(second.kind).toBe("blocked")
    expect(requests).toHaveLength(1)
  })

  test("no seed means no block", async () => {
    const { controller, requests } = controllerAt(0, 1)
    const outcome = await controller.send("hello")
    expect(outcome.kind).toBe("sent")
    expect(requests).toHaveLength(1)
  })
})
