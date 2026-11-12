/**
 * Pricing and the budget gate (WP-203).
 *
 * Expected costs are hand-computed in `tests/fixtures/pricing/expected-costs.json`
 * so the numbers in this test are checked against a fixture, not against the
 * implementation's own arithmetic.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  PRICE_TABLE,
  estimateCostMicroUsd,
  formatCost,
  isLoopbackUrl,
  priceDisclaimer,
  priceFor,
  usdToMicroUsd,
} from "../../src/llm/pricing"
import { budgetCopy, createBudgetGate, periodKey, periodStart, type BudgetConfig } from "../../src/llm/budget"

const ROOT = join(import.meta.dir, "..", "..")
const fixture = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "pricing", "expected-costs.json"), "utf8"))

const baseConfig: BudgetConfig = { budget: 5, period: "day", warn_at: 0.8, pause_at_limit: true }

describe("pricing", () => {
  test("cost is exact to the micro-USD, including a two-step tool loop", () => {
    const price = priceFor(fixture.model).price
    expect(price).not.toBeNull()

    expect(estimateCostMicroUsd(price, { input: 1000, output: 500 })).toBe(fixture.expected.singleStep.costMicroUsd)
    expect(formatCost(fixture.expected.singleStep.costMicroUsd)).toBe(fixture.expected.singleStep.label)

    const loop = fixture.expected.toolLoopSteps as { input: number; output: number }[]
    const steps = loop.map((step) => estimateCostMicroUsd(price, step) ?? 0)
    expect(steps.reduce((a, b) => a + b, 0)).toBe(fixture.expected.toolLoopCostMicroUsd)
  })

  test("an unknown model is null and formats as 'cost unknown', never $0.0000", () => {
    const lookup = priceFor(fixture.unknownModel)
    expect(lookup.price).toBeNull()
    expect(estimateCostMicroUsd(lookup.price, { input: 100, output: 100 })).toBeNull()
    expect(formatCost(null)).toBe("cost unknown")
  })

  test("OpenCode Go DeepSeek V4.1 Flash is priced", () => {
    const price = priceFor("opencode-go/deepseek-v4.1-flash").price
    expect(price).toEqual({
      inputPerMTok: 0.15,
      outputPerMTok: 0.6,
      cacheReadPerMTok: 0.003,
      cacheWritePerMTok: 0,
    })
    expect(estimateCostMicroUsd(price, { input: 1_000_000, output: 1_000_000 })).toBe(750_000)
  })

  test("a loopback endpoint is free and says so", () => {
    expect(isLoopbackUrl(fixture.loopbackBaseUrl)).toBe(true)
    expect(isLoopbackUrl("http://localhost:1234/v1")).toBe(true)
    expect(isLoopbackUrl("http://[::1]:8080")).toBe(true)
    expect(isLoopbackUrl("https://api.openai.com/v1")).toBe(false)

    const local = priceFor("ollama/llama3", { baseUrl: fixture.loopbackBaseUrl })
    expect(local.free).toBe(true)
    expect(estimateCostMicroUsd(local.price, { input: 999, output: 999 })).toBe(fixture.expected.freeCostMicroUsd)
    expect(formatCost(0, { free: true })).toBe("free")
  })

  test("the table is dated and the copy says estimates, not a bill", () => {
    expect(PRICE_TABLE.asOf).toBe(fixture.asOf)
    expect(PRICE_TABLE.version).toBe(fixture.tableVersion)
    expect(priceDisclaimer()).toContain(fixture.asOf)
    expect(priceDisclaimer()).toContain("not a bill")
  })

  test("USD from config converts to integer micro-USD without float drift", () => {
    expect(usdToMicroUsd(5)).toBe(5_000_000)
    expect(usdToMicroUsd(0.1)).toBe(100_000)
    expect(Number.isInteger(usdToMicroUsd(0.07))).toBe(true)
  })
})

describe("budget gate", () => {
  function gateAt(config: Partial<BudgetConfig> = {}) {
    let clock = new Date(2026, 10, 1, 12, 0, 0)
    const gate = createBudgetGate({
      config: () => ({ ...baseConfig, ...config }),
      now: () => clock,
    })
    return { gate, setTime: (date: Date) => (clock = date) }
  }

  test("at the limit with pause_at_limit blocks before any request is made", () => {
    const { gate } = gateAt()
    let requests = 0
    const spend = usdToMicroUsd(baseConfig.budget)

    const result = gate.check(spend)
    expect(result.block).toEqual({ kind: "budget", limit: spend, period: "day" })
    if (result.block) {
      // The caller only sends when there is no block — this is the fake log.
      const copy = budgetCopy(result.block)
      expect(copy.title).toContain("budget")
      expect(copy.next).toContain("Settings")
    } else {
      requests += 1
    }
    expect(requests).toBe(0)
  })

  test("no limit (budget 0) never blocks and never warns", () => {
    const { gate } = gateAt({ budget: 0 })
    const result = gate.check(999_999_999)
    expect(result.block).toBeNull()
    expect(result.state.limitMicroUsd).toBeNull()
    expect(result.state.warning).toBe(false)
  })

  test("crossing warn_at warns exactly once per period", () => {
    const { gate, setTime } = gateAt()
    const limit = usdToMicroUsd(baseConfig.budget)

    expect(gate.check(limit * 0.5).state.warning).toBe(false)
    expect(gate.check(limit * 0.85).state.warning).toBe(true)
    expect(gate.check(limit * 0.9).state.warning).toBe(false)

    // A new day is a new period, so it may warn again.
    setTime(new Date(2026, 10, 2, 9, 0, 0))
    expect(gate.check(limit * 0.85).state.warning).toBe(true)
  })

  test("one-shot override allows exactly one request and re-arms the gate", () => {
    const { gate } = gateAt()
    const limit = usdToMicroUsd(baseConfig.budget)

    gate.overrideOnce()
    expect(gate.isOverridden()).toBe(true)

    const first = gate.check(limit)
    expect(first.block).toBeNull()
    expect(first.state.overridden).toBe(true)
    expect(gate.isOverridden()).toBe(false)

    const second = gate.check(limit)
    expect(second.block).not.toBeNull()
  })

  test("an explicit override allows one request without arming anything", () => {
    const { gate } = gateAt()
    const limit = usdToMicroUsd(baseConfig.budget)
    expect(gate.check(limit, { override: true }).block).toBeNull()
    expect(gate.check(limit).block).not.toBeNull()
  })

  test("pause_at_limit off means warn but never block", () => {
    const { gate } = gateAt({ pause_at_limit: false })
    const limit = usdToMicroUsd(baseConfig.budget)
    const result = gate.check(limit * 3)
    expect(result.block).toBeNull()
    expect(result.state.warning).toBe(true)
  })

  test("day boundary is local midnight and month boundary is the first", () => {
    const evening = new Date(2026, 10, 1, 23, 59, 59)
    const nextDay = new Date(2026, 10, 2, 0, 0, 1)

    expect(periodStart(evening, "day")).toEqual(new Date(2026, 10, 1, 0, 0, 0, 0))
    expect(periodStart(nextDay, "day")).toEqual(new Date(2026, 10, 2, 0, 0, 0, 0))
    expect(periodKey(evening, "day")).not.toBe(periodKey(nextDay, "day"))
    expect(periodKey(evening, "day")).toBe("2026-11-01")

    const endOfMonth = new Date(2026, 10, 30, 23, 0, 0)
    const newMonth = new Date(2026, 11, 1, 0, 5, 0)
    expect(periodKey(endOfMonth, "month")).toBe("2026-11")
    expect(periodKey(newMonth, "month")).toBe("2026-12")
    expect(periodStart(newMonth, "month")).toEqual(new Date(2026, 11, 1, 0, 0, 0, 0))
  })

  test("a period rollover resets the gate's own warning state", () => {
    const { gate, setTime } = gateAt()
    const limit = usdToMicroUsd(baseConfig.budget)
    expect(gate.check(limit * 0.85).state.warning).toBe(true)
    setTime(new Date(2026, 11, 1, 0, 30, 0))
    expect(gate.check(limit * 0.85).state.warning).toBe(true)
    // This gate is on a daily period, so its key is the new day.
    expect(gate.key()).toBe("2026-12-01")

    const monthly = createBudgetGate({
      config: () => ({ ...baseConfig, period: "month" }),
      now: () => new Date(2026, 11, 15, 0, 30, 0),
    })
    expect(monthly.key()).toBe("2026-12")
  })
})
