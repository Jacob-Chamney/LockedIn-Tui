/** Stats dashboard: figures, calendar, trend and the model/tool column. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const stats = await import("../../src/ui/stats")
const big = await import("../../src/ui/stats/big-number")
const heatmap = await import("../../src/ui/stats/heatmap")
type StatsView = import("../../src/ui/stats").StatsView
type Summary = import("../../src/stats/types").StatsSummary
const { crimson } = await import("../../src/ui/theme")

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/stats-ui/summary.json"), "utf8"))
const summary = (overrides: Partial<Summary> = {}): Summary => ({ ...FIXTURE, ...overrides }) as Summary

async function mount(
  width: number,
  height: number,
  props: { view?: StatsView; summary?: Summary } = {},
) {
  const setup = await testRender(
    () => (
      <stats.StatsPage
        theme={crimson}
        width={width}
        height={height}
        focused
        view={props.view ?? stats.initialStatsView}
        summary={props.summary ?? summary()}
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function backgrounds(setup: Awaited<ReturnType<typeof mount>>, needle: string): string[] {
  const out: string[] = []
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (!span.text.includes(needle)) continue
      const buffer = (span.bg as unknown as { buffer: ArrayLike<number> }).buffer
      out.push(`#${[buffer[0], buffer[1], buffer[2]].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("")}`)
    }
  }
  return out
}

function lines(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

function emptySummary(): Summary {
  return summary({
    overview: { runs: 0, failed: 0, input: 0, output: 0 },
    costMicroUsd: null,
    models: [],
    tools: [],
    learning: { steps: 0, cardsKnown: 0, cardsMissed: 0, lessons: 0 },
    activity: [],
    bestStreak: 0,
    activeDays: 0,
    period: { from: "2026-11-01", to: "2026-11-02" },
    diagnostic: null,
  })
}

describe("header and filters", () => {
  test("the page names itself, its period and its filters", async () => {
    const setup = await mount(140, 44, {
      view: { ...stats.initialStatsView, range: "30d", scope: "skills" },
    })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("STATS")
      expect(frame).toContain("Jan – Nov 2026")
      expect(frame).toContain("range")
      expect(frame).toContain("30d")
      expect(frame).toContain("scope")
      expect(frame).toContain("skills")
      expect(backgrounds(setup, " 30d ")).toContain(crimson.primary.toLowerCase())
      expect(backgrounds(setup, " skills ")).toContain(crimson.primary.toLowerCase())
      expect(backgrounds(setup, " 7d ")).not.toContain(crimson.primary.toLowerCase())
      // The old wordmark hero is gone; the page title is the chrome.
      expect(frame).not.toContain("lockedin / stats")
    } finally {
      await setup.dispose()
    }
  })

  test("the minimum width keeps both filter strips", async () => {
    const setup = await mount(80, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("range")
      expect(frame).toContain("scope")
    } finally {
      await setup.dispose()
    }
  })

  test("a narrow pane keeps the range strip and drops the scope strip", async () => {
    const setup = await mount(70, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("range")
      expect(frame).not.toContain("scope  all")
    } finally {
      await setup.dispose()
    }
  })
})

describe("the figures band", () => {
  test("five figures carry the tokens, runs, days, streak and cost", async () => {
    const setup = await mount(140, 44)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("TOKENS")
      expect(frame).toContain("24.4K")
      expect(frame).toContain("18.2K in · 6.1K out")
      expect(frame).toContain("SESSIONS")
      expect(frame).toContain("2 failed")
      expect(frame).toContain("ACTIVE DAYS")
      expect(frame).toContain("6% of range")
      expect(frame).toContain("STREAK")
      expect(frame).toContain("14 days")
      expect(frame).toContain("COST")
      expect(frame).toContain("$0.1284")
      expect(frame).toContain("est. spend")
    } finally {
      await setup.dispose()
    }
  })

  test("four figures at 100 columns fold the streak into the active days", async () => {
    const setup = await mount(100, 38)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("18.2K in · 6.1K out")
      expect(frame).toContain("6% · 14d streak")
      expect(frame).not.toContain("STREAK")
    } finally {
      await setup.dispose()
    }
  })

  test("the short page keeps all five figures without their detail lines", async () => {
    const setup = await mount(80, 24)
    try {
      const frame = lines(setup).join("\n")
      for (const label of ["TOKENS", "SESSIONS", "ACTIVE DAYS", "STREAK", "COST"]) {
        expect(frame).toContain(label)
      }
      expect(frame).toContain("14 days")
      expect(frame).not.toContain("est. spend")
    } finally {
      await setup.dispose()
    }
  })

  test("an empty range invites work instead of drawing zero figures", async () => {
    const setup = await mount(100, 38, { summary: emptySummary() })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("NO ACTIVITY IN THIS RANGE")
      expect(frame).toContain("send a message or run a generation")
      expect(frame).not.toContain("TOKENS")
      expect(frame).not.toContain("COST")
    } finally {
      await setup.dispose()
    }
  })
})

describe("activity and trend", () => {
  test("the calendar has one row per weekday and a legend", async () => {
    const setup = await mount(140, 44)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("▍ ACTIVITY")
      expect(frame).toContain("18 active days")
      for (const month of ["Jan", "Feb", "Mar", "Oct"]) expect(frame).toContain(month)
      for (const day of ["M ", "T ", "W ", "F ", "S "]) expect(frame).toContain(day)
      expect(frame).toContain("· less")
      expect(frame).toContain("█ more")
    } finally {
      await setup.dispose()
    }
  })

  test("the trend charts the busiest day per column under the calendar", async () => {
    const setup = await mount(140, 44)
    try {
      const out = lines(setup)
      const calendar = out.findIndex((line) => line.includes("▍ ACTIVITY"))
      const trend = out.findIndex((line) => line.includes("TOKENS OVER TIME"))
      expect(trend).toBeGreaterThan(calendar)
      expect(out[trend]).toContain("peak 3.2K/day")
      const chart = out.slice(trend + 1, trend + 6).join("\n")
      expect(chart).toContain("│")
      expect(chart).toContain("•")
      expect(chart).toMatch(/3\.2K│/)
    } finally {
      await setup.dispose()
    }
  })

  test("the compact page keeps the calendar and drops the trend", async () => {
    const setup = await mount(80, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("▍ ACTIVITY")
      expect(frame).toContain("· less")
      expect(frame).not.toContain("TOKENS OVER TIME")
      expect(frame).not.toContain("│")
    } finally {
      await setup.dispose()
    }
  })

  test("an empty range has no calendar or trend", async () => {
    const setup = await mount(140, 44, { summary: emptySummary() })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).not.toContain("▍ ACTIVITY")
      expect(frame).not.toContain("TOKENS OVER TIME")
      expect(frame).not.toContain("less")
    } finally {
      await setup.dispose()
    }
  })
})

describe("the right column", () => {
  test("models, tools and learning sit beside the calendar", async () => {
    const setup = await mount(140, 44)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("▍ MODELS")
      expect(frame).toContain("openai/gpt-4.1-mini")
      expect(frame).toContain("9r · 78%")
      expect(frame).toContain("2 models · 12 runs")
      expect(frame).toContain("▍ TOOLS")
      expect(frame).toContain("read_file")
      expect(frame).toContain("7 calls")
      expect(frame).toContain("▍ LEARNING")
      expect(frame).toContain("1 lesson")
      expect(frame).toContain("4 known · 2 missed")
      expect(frame).toContain("▍ LAST 7 DAYS")
      expect(frame).toContain("Nov 01")
      expect(frame).toContain("1.8K")
    } finally {
      await setup.dispose()
    }
  })

  test("the right column survives a 100-column page", async () => {
    const setup = await mount(100, 38)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("▍ MODELS")
      expect(frame).toContain("▍ TOOLS")
      expect(frame).toContain("▍ LEARNING")
      expect(frame).toContain("read_file")
    } finally {
      await setup.dispose()
    }
  })

  test("a compact page has no room for the right column", async () => {
    const setup = await mount(80, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).not.toContain("MODELS")
      expect(frame).not.toContain("TOOLS")
      expect(frame).not.toContain("LEARNING")
      expect(frame).not.toContain("LAST")
    } finally {
      await setup.dispose()
    }
  })

  test("the last-days strip shrinks to the rows that are left", async () => {
    const setup = await mount(105, 26)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("▍ LAST 2 DAYS")
      expect(frame).toContain("Nov 01")
      expect(frame).toContain("Nov 02")
      expect(frame).not.toContain("Oct 27")
    } finally {
      await setup.dispose()
    }
  })

  test("more than four models are counted, not silently dropped", async () => {
    const many = summary({
      models: Array.from({ length: 6 }, (_, index) => ({
        model: `openai/model-${index}`,
        runs: 1,
        input: 100,
        output: 50,
        costMicroUsd: null,
      })),
    })
    const setup = await mount(140, 44, { summary: many })
    try {
      expect(lines(setup).join("\n")).toContain("+2 more")
    } finally {
      await setup.dispose()
    }
  })
})

describe("layout", () => {
  test("80x24 and 200x60 fit their bounds", async () => {
    for (const [w, h] of [[80, 24], [200, 60]] as const) {
      const setup = await mount(w, h)
      try {
        const out = lines(setup)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("the two columns are separated by a vertical rule", async () => {
    const setup = await mount(140, 44)
    try {
      const out = lines(setup)
      const body = out.slice(out.findIndex((line) => line.includes("▍ ACTIVITY")))
      expect(body.filter((line) => line.includes("│")).length).toBeGreaterThan(4)
    } finally {
      await setup.dispose()
    }
  })

  test("the header and figures sit at the left edge", async () => {
    const setup = await mount(140, 44)
    try {
      const out = lines(setup)
      const header = out.find((line) => line.includes("STATS"))!
      const tokens = out.find((line) => line.includes("TOKENS"))!
      expect(header.indexOf("STATS")).toBeLessThan(8)
      expect(tokens.indexOf("TOKENS")).toBeLessThan(8)
    } finally {
      await setup.dispose()
    }
  })
})

describe("notices", () => {
  test("a corrupt-counter diagnostic renders on the page", async () => {
    const corrupt = summary({ diagnostic: "usage.json was unreadable; totals exclude 3 runs" })
    const setup = await mount(100, 38, { summary: corrupt })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("usage.json was unreadable")
      expect(frame).toContain("STATS")
    } finally {
      await setup.dispose()
    }
  })

  test("the footer names the range, scope, export and exit keys", async () => {
    const setup = await mount(100, 38)
    try {
      expect(lines(setup).join("\n")).toContain("r range · s scope · x export · Esc back")
    } finally {
      await setup.dispose()
    }
  })
})

describe("calendar helpers", () => {
  test("compact totals and block digits", () => {
    expect(big.compactTokens(0)).toBe("0")
    expect(big.compactTokens(999)).toBe("999")
    expect(big.compactTokens(24_350)).toBe("24.4K")
    expect(big.compactTokens(24_350, 0)).toBe("24K")
    expect(big.compactTokens(23_400_000_000)).toBe("23.4B")
    expect(big.compactTokens(23_400_000_000, 0)).toBe("23B")
  })

  test("periods read as months, not ISO strings", () => {
    expect(stats.periodLabel({ from: "2026-01-05", to: "2026-11-02" })).toBe("Jan – Nov 2026")
    expect(stats.periodLabel({ from: "2026-11-01", to: "2026-11-30" })).toBe("Nov 2026")
    expect(stats.periodLabel({ from: "2025-12-01", to: "2026-01-31" })).toBe(
      "Dec 2025 – Jan 2026",
    )
  })

  test("the period day count includes both ends and ignores DST", () => {
    expect(stats.periodDays({ from: "2026-11-01", to: "2026-11-02" })).toBe(2)
    expect(stats.periodDays({ from: "2026-01-05", to: "2026-11-02" })).toBe(302)
    expect(stats.periodDays({ from: "2026-03-08", to: "2026-03-09" })).toBe(2)
    expect(stats.periodDays({ from: "2026-11-02", to: "2026-11-01" })).toBe(0)
  })

  test("the calendar keeps a seven-row week and marks active days", () => {
    const heat = heatmap.buildHeatmap(FIXTURE.activity, FIXTURE.period, 60)
    expect(heat.weeks.length).toBeGreaterThan(1)
    expect(heat.weeks.every((week) => week.length === 7)).toBe(true)
    expect(heat.months.map((month) => month.label)).toContain("Jan")
    expect(heat.months.map((month) => month.label)).toContain("Oct")
    expect(heat.weeks.flat().some((day) => day !== null && day.runs > 0)).toBe(true)
  })
})

describe("range and scope", () => {
  test("ranges and scopes cycle in one documented order", () => {
    expect(stats.RANGE_ORDER).toEqual(["7d", "30d", "90d", "all"])
    expect(stats.SCOPE_ORDER).toEqual(["all", "school", "skills", "work"])
    expect(stats.cycleRange(stats.initialStatsView, 1).range).toBe("7d")
    expect(stats.cycleRange(stats.initialStatsView, -1).range).toBe("90d")
    expect(stats.cycleScope(stats.initialStatsView, 1).scope).toBe("school")
    expect(stats.cycleScope(stats.initialStatsView, -1).scope).toBe("work")
  })

  test("scope rows never contain another side's model", () => {
    const school = summary({
      models: [{ model: "openai/gpt-4.1-mini", runs: 4, input: 1, output: 1, costMicroUsd: 1 }],
      tools: [{ name: "read_file", calls: 1 }],
    })
    const rows = stats.rowsForScope(school).join("\n")
    expect(rows).toContain("openai/gpt-4.1-mini")
    expect(rows).not.toContain("local/llama")
  })
})

describe("export", () => {
  test("export asks for a format and names the path; the page writes nothing", () => {
    const request = stats.exportRequest(stats.initialStatsView, "csv")
    expect(request).toEqual({ format: "csv", range: "all", scope: "all" })
    expect(stats.exportNotice("md", "/tmp/stats.md")).toContain("save as /tmp/stats.md")
    expect(stats.intentFor("x")).toBe("export-md")
    expect(stats.intentFor("x", { shift: true })).toBe("export-csv")

    const source = readFileSync(join(import.meta.dir, "../../src/ui/stats/stats.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(/)
  })
})

describe("formatting helpers", () => {
  test("cost and rows keep the existing contract", () => {
    expect(stats.costLabel(summary({ costMicroUsd: null }))).toBe("cost unknown")
    expect(stats.costLabel(summary({ costMicroUsd: 128400 }))).toBe("$0.1284")
    expect(stats.modelRows(summary())[0]).toContain("openai/gpt-4.1-mini")
    expect(stats.toolRows(summary())[0]).toContain("read_file")
    expect(stats.learningRows(summary())).toContain("steps     5")
  })
})
