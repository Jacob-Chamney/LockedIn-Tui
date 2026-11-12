/** WP-703 — usage and budget settings. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const usage = await import("../../src/ui/settings/usage")
type State = import("../../src/ui/settings/usage").UsageState
type Snapshot = import("../../src/ui/settings/usage").UsageSnapshot
const { crimson } = await import("../../src/ui/theme")

const budget = (overrides = {}) => ({ budget: 5, period: "day" as const, warn_at: 0.8, pause_at_limit: true, ...overrides })

const RUNS = [
  { model: "openai/gpt-4.1-mini", input: 812, output: 340, costMicroUsd: 3000, at: "2026-11-01T10:00:00Z", failed: false, scope: "school" },
  { model: "openai/gpt-4.1-mini", input: 500, output: 0, costMicroUsd: 900, at: "2026-11-01T11:00:00Z", failed: true, scope: "school" },
] as const

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  today: { input: 1312, output: 340, costMicroUsd: 3900, runs: 2, failed: 1 },
  month: { input: 9000, output: 2000, costMicroUsd: 42000, runs: 9, failed: 2 },
  runs: RUNS as never,
  spentMicroUsd: 3_900_000,
  ...overrides,
})

const state = (overrides: Partial<State> = {}): State => ({ ...usage.initialUsage(budget()), ...overrides })

async function mount(width: number, height: number, value = state(), snap = snapshot()) {
  const setup = await testRender(
    () => <usage.UsagePanel theme={crimson} width={width} height={height} focused state={value} snapshot={snap} />,
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: { captureCharFrame: () => string }): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("totals", () => {
  test("today and month match the snapshot exactly, failed runs included", async () => {
    const setup = await mount(120, 30)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("today  1652 tok · $0.0039 · 2 runs · 1 failed")
      expect(frame).toContain("month  11000 tok · $0.0420 · 9 runs · 2 failed")
    } finally {
      await setup.dispose()
    }
  })

  test("a failed run is labelled in the breakdown, never hidden", async () => {
    const setup = await mount(120, 30)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("failed run")
      expect(frame.split("failed run").length - 1).toBe(1)
    } finally {
      await setup.dispose()
    }
    expect(usage.runLine(RUNS[1] as never)).toContain("failed run")
  })
})

describe("budget", () => {
  test("budget 0 renders no limit and never blocks", async () => {
    const zero = state({ budget: budget({ budget: 0 }) })
    expect(usage.budgetLabel(zero.budget)).toBe("no limit")
    expect(usage.limitReached(snapshot({ spentMicroUsd: 999_000_000 }), zero.budget)).toBe(false)
    const setup = await mount(120, 30, zero)
    try {
      expect(lines(setup).join("\n")).toContain("USAGE · no limit")
      expect(lines(setup).join("\n")).not.toContain("budget reached")
    } finally {
      await setup.dispose()
    }
  })

  test("warn thresholds outside 10-100% are refused with the range", () => {
    for (const ratio of [0, 0.05, 1.5]) {
      const result = usage.setWarnAt(state(), ratio)
      expect(result.kind).toBe("refused")
      if (result.kind !== "refused") throw new Error("expected a refusal")
      expect(result.reason).toContain("10–100%")
    }
    expect(usage.setWarnAt(state(), 0.6)).toEqual({ kind: "patch", patch: { "usage.warn_at": 0.6 } })
  })

  test("a negative amount is refused", () => {
    const result = usage.setBudgetAmount(state(), -1)
    expect(result.kind).toBe("refused")
  })

  test("changing the period states its effect and keeps recorded usage", () => {
    const before = JSON.stringify(snapshot())
    const { next, line } = usage.periodEffect(state(), "month")
    expect(line).toContain("today's total is kept")
    expect(line).toContain("month period restarts")
    expect(usage.confirmPeriod(next)).toEqual({ kind: "patch", patch: { "usage.period": "month" } })
    // nothing in the snapshot moved
    expect(JSON.stringify(snapshot())).toBe(before)
    expect(next.pendingPeriod).toBe("month")
  })
})

describe("pause at limit and override", () => {
  test("at the limit the request is refused with the documented copy", async () => {
    const atLimit = snapshot({ spentMicroUsd: 5_000_000 })
    const setup = await mount(120, 30, state(), atLimit)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("day budget reached ($5.00)")
      expect(frame).toContain("press o to override once")
    } finally {
      await setup.dispose()
    }
    expect(usage.limitReached(atLimit, budget())).toBe(true)
  })

  test("the override arms one request and is not remembered", () => {
    const armed = usage.armOverride(state())
    expect(armed.overrideArmed).toBe(true)
    expect(armed.notice).toContain("not remembered")
    expect(usage.consumeOverride(armed).overrideArmed).toBe(false)
    expect(usage.overrideNote()).toContain("next request asks again")
  })

  test("pause is a single toggle patch", () => {
    expect(usage.togglePause(state())).toEqual({ kind: "patch", patch: { "usage.pause_at_limit": false } })
  })
})

describe("disclaimer and one source", () => {
  test("the disclaimer and price-table date render in every state", async () => {
    for (const variant of [state(), state({ budget: budget({ budget: 0 }) }), state({ pendingPeriod: "month" })]) {
      const setup = await mount(80, 24, variant)
      try {
        const frame = lines(setup).join("\n")
        expect(frame).toContain("prices are estimates, not a bill")
        expect(frame).toContain(usage.PRICE_TABLE_DATE)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("status-bar numbers come from the same snapshot", () => {
    const snap = snapshot()
    expect(usage.statusNumbers(snap)).toEqual({ tokens: 1652, costMicroUsd: 3900 })
  })
})

describe("layout and keys", () => {
  test("80x24 collapses the breakdown to two lines behind Enter", async () => {
    const three = snapshot({ runs: [...RUNS, { ...RUNS[0], at: "2026-11-01T12:00:00Z" }] as never })
    const setup = await mount(80, 24, state(), three)
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
      // two rows shown, the rest behind the key
      expect(out.join("\n")).toContain("Enter expand")
      expect(out.join("\n").match(/openai\/gpt-4\.1-mini/g)!.length).toBe(2)
    } finally {
      await setup.dispose()
    }
    expect(usage.breakdownLinesFor(snapshot(), 80, true)).toHaveLength(2)
    const more = snapshot({
      runs: [...RUNS, { ...RUNS[0], at: "2026-11-01T12:00:00Z" }] as never,
    })
    expect(usage.breakdownLinesFor(more, 80, false)).toHaveLength(2)
    expect(usage.breakdownLinesFor(more, 80, true)).toHaveLength(3)
  })

  test("200x60 shows the whole breakdown", async () => {
    const setup = await mount(200, 60)
    try {
      const out = lines(setup)
      expect(out.length).toBe(60)
      expect(out.join("\n")).toContain("openai/gpt-4.1-mini")
    } finally {
      await setup.dispose()
    }
  })

  test("keys come from one table and the view never recomputes cost", () => {
    expect(usage.intentFor("p")).toBe("period")
    expect(usage.intentFor("t")).toBe("pause")
    expect(usage.intentFor("o")).toBe("override")
    expect(usage.footerHints()).toContain("o override")

    const source = readFileSync(join(import.meta.dir, "../../src/ui/settings/usage.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(/)
    expect(source).not.toContain("src/llm/usage")
  })
})
