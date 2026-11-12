/**
 * Persisting runs to `usage.json` (WP-145).
 *
 * The controller is driven with a fake `ChatService`, so the whole test is
 * deterministic: no network, no key. `usage.json` is a real file in a temp
 * data directory, written through WP-203's store.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createChatController, type ControllerDeps } from "../../src/app/chat-controller"
import type { ChatEvent, Usage } from "../../src/llm/events"
import type { ChatRequest, ChatService } from "../../src/llm/chat"
import type { BudgetGate } from "../../src/llm/budget"
import { USAGE_FILE, createUsageStore, type RunScope } from "../../src/llm/usage"

const ROOT = join(import.meta.dir, "..", "..")
const expected = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "usage-persist", "expected.json"), "utf8"))

const NOW = new Date(2026, 10, 1, 15, 0, 0)

/** Emits a scripted event sequence, and counts how many sends it saw. */
function fakeService(events: ChatEvent[]) {
  const state = { sends: 0, requests: [] as ChatRequest[] }
  const service: ChatService = {
    active: () => [],
    cancel: () => {},
    // eslint-disable-next-line require-yield
    async *send(request): AsyncGenerator<ChatEvent> {
      state.sends += 1
      state.requests.push(request)
      for (const event of events) yield event
    },
  }
  return { service, state }
}

function fakeGate(limit = 1_000_000) {
  const gate = {
    checks: [] as number[],
    overrides: 0,
    key: () => "2026-11-01",
    isOverridden: () => false,
    overrideOnce() {
      gate.overrides += 1
    },
    check(spentMicroUsd: number) {
      gate.checks.push(spentMicroUsd)
      const blocked = spentMicroUsd >= limit
      return {
        block: blocked ? { kind: "budget" as const, limitMicroUsd: limit, period: "day" as const } : null,
        state: {
          spentMicroUsd,
          limitMicroUsd: limit,
          ratio: spentMicroUsd / limit,
          warning: false,
          blocked,
          overridden: false,
          periodKey: gate.key(),
        },
      }
    },
  }
  return gate as BudgetGate & { checks: number[]; overrides: number }
}

function build(options: {
  events: ChatEvent[]
  scope?: RunScope
  model?: string
  dir?: string
  usage?: ControllerDeps["usage"]
  onUsageError?: (message: string) => void
  spentMicroUsd?: number
}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "usage-persist-"))
  const store = createUsageStore({ dir })
  const { service, state } = fakeService(options.events)
  const gate = fakeGate()
  const controller = createChatController({
    service,
    budget: gate,
    scope: options.scope ?? "school",
    usage: options.usage ?? { append: (run) => store.append(run) },
    ...(options.onUsageError ? { onUsageError: options.onUsageError } : {}),
    history: { load: async () => [], save: async () => {} },
    config: () => ({
      model: options.model ?? expected.model,
      maxToolCalls: 4,
      maxTokens: 16_000,
      chillHistoryLimit: 20,
    }),
    ...(options.spentMicroUsd === undefined ? {} : { spentMicroUsd: options.spentMicroUsd }),
    now: () => NOW,
  })
  return { controller, gate, state, dir, store }
}

const usage = (input: number, output: number): Usage => ({ input, output, total: input + output })

const done = (u: Usage): ChatEvent => ({ type: "done", text: "hello", steps: ["hello"], usage: u, durationMs: 5 })

function readRuns(dir: string): { runs: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(join(dir, USAGE_FILE), "utf8"))
}

describe("usage persistence", () => {
  test("a completed turn appends exactly one run with the right scope and tokens", async () => {
    const { controller, dir } = build({ events: [done(usage(expected.input, expected.output))] })

    const outcome = await controller.send("hi")
    expect(outcome.kind).toBe("sent")
    if (outcome.kind === "sent") expect(outcome.outcome).toBe("done")

    const file = readRuns(dir)
    expect(file.runs).toHaveLength(1)
    expect(file.runs[0]).toMatchObject({
      model: expected.model,
      input: expected.input,
      output: expected.output,
      scope: "school",
      failed: false,
      costMicroUsd: expected.costMicroUsd,
    })
  })

  test("a failed turn appends one run with failed: true and its tokens", async () => {
    const { controller, dir } = build({
      scope: "skills",
      events: [
        { type: "text", delta: "partial" },
        { type: "usage", tokens: { input: 120, output: 30, total: 150 } },
        { type: "error", error: { kind: "network", message: "boom" } },
      ],
    })

    const outcome = await controller.send("hi")
    if (outcome.kind === "sent") expect(outcome.outcome).toBe("error")

    const runs = readRuns(dir).runs
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ scope: "skills", failed: true, input: 120, output: 30 })
  })

  test("a cancelled turn writes nothing: the file is byte-identical", async () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-persist-"))
    const store = createUsageStore({ dir })
    await store.append({
      model: "openai/gpt-4.1-mini",
      input: 10,
      output: 5,
      costMicroUsd: 12,
      at: NOW.toISOString(),
      failed: false,
      scope: "school",
    })
    const before = readFileSync(join(dir, USAGE_FILE))

    const { controller } = build({
      dir,
      events: [{ type: "text", delta: "partial" }, { type: "cancelled" }],
    })
    const outcome = await controller.send("hi")
    if (outcome.kind === "sent") expect(outcome.outcome).toBe("cancelled")

    expect(readFileSync(join(dir, USAGE_FILE)).equals(before)).toBe(true)
  })

  test("an unpriced model writes costMicroUsd: null, never 0", async () => {
    const { controller, dir } = build({
      model: expected.unpricedModel,
      events: [done(usage(100, 100))],
    })
    await controller.send("hi")

    const run = readRuns(dir).runs[0]!
    expect(run["costMicroUsd"]).toBeNull()
    expect(run["scope"]).toBe("school")
  })

  test("a failed write is reported once, never retried, and the turn still completes", async () => {
    let appends = 0
    const reports: string[] = []
    const { controller, state } = build({
      events: [done(usage(10, 5))],
      usage: {
        append: async () => {
          appends += 1
          throw new Error("disk full")
        },
      },
      onUsageError: (message) => reports.push(message),
    })

    const outcome = await controller.send("hi")
    expect(outcome.kind).toBe("sent")
    if (outcome.kind === "sent") expect(outcome.outcome).toBe("done")
    expect(appends).toBe(1)
    expect(state.sends).toBe(1)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain("usage counters")
  })

  test("the gate's spend equals the sum of today's records after two turns", async () => {
    const { controller, gate, dir } = build({ events: [done(usage(expected.input, expected.output))] })

    await controller.send("one")
    await controller.send("two")

    const runs = readRuns(dir).runs
    expect(runs).toHaveLength(2)
    const total = runs.reduce((sum, run) => sum + ((run["costMicroUsd"] as number | null) ?? 0), 0)
    expect(total).toBe(expected.costMicroUsd * 2)

    // `check()` runs before a send, so its history is the spend at each turn:
    // 0 before the first, one run's cost before the second.
    expect(gate.checks).toEqual([0, expected.costMicroUsd])

    await controller.send("three")
    // The third check sees both completed runs — the gate and the file agree.
    expect(gate.checks.at(-1)).toBe(total)

    // A controller seeded from the file starts where the file says.
    const seeded = build({ events: [done(usage(1, 0))], dir, spentMicroUsd: total })
    await seeded.controller.send("four")
    expect(seeded.gate.checks).toEqual([total])
  })
})

describe("records hold no content", () => {
  test("byte scan: keys only, no prompt or answer text", async () => {
    const { controller, dir } = build({ events: [done(usage(10, 5))] })
    await controller.send("this prompt must never be stored")

    const text = readFileSync(join(dir, USAGE_FILE), "utf8")
    expect(text).not.toContain("this prompt must never be stored")
    expect(text).not.toContain("hello")

    const allowed = new Set(["model", "input", "output", "costMicroUsd", "at", "failed", "scope"])
    for (const run of readRuns(dir).runs) {
      for (const key of Object.keys(run)) expect(allowed.has(key)).toBe(true)
    }
  })

  test("a corrupt file is replaced by a fresh one on the next write, with no crash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-persist-"))
    writeFileSync(join(dir, USAGE_FILE), "{ broken")

    const { controller } = build({ dir, events: [done(usage(10, 5))] })
    const outcome = await controller.send("hi")
    expect(outcome.kind).toBe("sent")
    expect(readRuns(dir).runs).toHaveLength(1)
  })
})
