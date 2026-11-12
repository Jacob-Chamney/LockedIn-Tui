/** Stats dashboard: hero totals, contribution calendar and honest empties. */
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

function lines(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("the hero", () => {
  test("shows the context, period, token total and calendar stats", async () => {
    const setup = await mount(140, 44)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("lockedin / stats")
      expect(frame).toContain("Jan – Nov 2026")
      expect(frame).toContain("T O K E N S")
      expect(frame).toContain("14 days")
      expect(frame).toContain("best streak")
      expect(frame).toContain("active days")
      expect(frame).toContain("sessions")
      expect(frame).not.toContain("MODELS")
      expect(frame).not.toContain("TOOLS")
      expect(frame).not.toContain("LEARNING")
    } finally {
      await setup.dispose()
    }
  })

  test("the heatmap labels months and weekdays", async () => {
    const setup = await mount(140, 44)
    try {
      const frame = lines(setup).join("\n")
      for (const month of ["Jan", "Feb", "Mar", "Oct"]) expect(frame).toContain(month)
      for (const day of ["M ", "T ", "W ", "F ", "S "]) expect(frame).toContain(day)
      expect(frame).toContain("■")
      expect(frame).toContain("·")
    } finally {
      await setup.dispose()
    }
  })

  test("an empty range renders a zero hero and zero stats", async () => {
    const empty = summary({
      overview: { runs: 0, failed: 0, input: 0, output: 0 },
      costMicroUsd: null,
      models: [],
      tools: [],
      learning: { steps: 0, cardsKnown: 0, cardsMissed: 0, lessons: 0 },
      activity: [],
      bestStreak: 0,
      activeDays: 0,
      period: { from: "2026-11-01", to: "2026-11-02" },
    })
    const setup = await mount(120, 30, { summary: empty })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("T O K E N S")
      expect(frame).toContain("0 days")
      expect(frame).toContain("active days")
      expect(frame).toContain("sessions")
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

describe("diagnostics and export", () => {
  test("a corrupt-counter diagnostic renders on the page", async () => {
    const corrupt = summary({ diagnostic: "usage.json was unreadable; totals exclude 3 runs" })
    const setup = await mount(80, 24, { summary: corrupt })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("usage.json was unreadable")
      expect(frame).toContain("T O K E N S")
    } finally {
      await setup.dispose()
    }
  })

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

describe("layout", () => {
  test("80x24 keeps the hero, calendar and footer without clipping", async () => {
    const setup = await mount(80, 24)
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
      const frame = out.join("\n")
      expect(frame).toContain("T O K E N S")
      expect(frame).toContain("best streak")
      expect(frame).toContain("lockedin / stats")
    } finally {
      await setup.dispose()
    }
  })

  test("200x60 keeps every hero detail", async () => {
    const setup = await mount(200, 60)
    try {
      const out = lines(setup)
      expect(out.length).toBe(60)
      for (const line of out) expect(line.length).toBe(200)
      const frame = out.join("\n")
      expect(frame).toContain("T O K E N S")
      expect(frame).toContain("14 days")
      expect(frame).toContain("sessions")
    } finally {
      await setup.dispose()
    }
  })

  test("the hero label is centred and the header sits at the edges", async () => {
    const setup = await mount(140, 44)
    try {
      const out = lines(setup)
      const header = out.find((line) => line.includes("lockedin / stats"))!
      const tokens = out.find((line) => line.includes("T O K E N S"))!
      expect(header.indexOf("lockedin")).toBeLessThan(8)
      expect(header).toContain("Jan – Nov 2026")
      expect(tokens.indexOf("T O K E N S")).toBeGreaterThan(20)
      expect(tokens.length - tokens.indexOf("T O K E N S")).toBeGreaterThan(20)
    } finally {
      await setup.dispose()
    }
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
